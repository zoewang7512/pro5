import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DemoConfig } from "./config";
import type { DemoEntryLimitResult } from "./rate-limit";

// **僅限伺服器端使用**：一鍵進入端點（app/api/demo/enter/route.ts）的核心邏輯，依賴注入以便單元測試。
//
// 設計重點（架構筆記 D3）：
// - 所有失敗回同一個結果（只有內部的 reason 不同，reason 只用於 log 類別，絕不回給呼叫端）。
// - **Supabase 寫出的 cookie 一律先暫存，不直接寫進回應**：驗證 `is_demo === true` 且不需要 aal2 兩項都通過，
//   呼叫端才拿得到暫存的 cookie。失敗路徑天生不帶 session cookie，不依賴 `signOut` 是否成功。
// - 暫存區自己就是 Supabase client 的 cookie 儲存：`getAll` 只回暫存內容，**不讀進來的請求 cookie**，
//   所以請求端原本帶的任何 session 都不會干擾本次登入與 aal 判斷。
// - 被登入的帳號只由伺服器環境變數決定；請求的 body、query 完全不讀。

export type DemoEnterFailure =
  | "config_missing"
  | "cross_origin"
  | "rate_limited"
  | "sign_in_failed"
  | "not_demo"
  | "aal2"
  | "aal_error"
  | "error";

export type StagedCookie = { name: string; value: string; options: Record<string, unknown> };

export type DemoEnterResult =
  | { ok: true; cookies: StagedCookie[] }
  | { ok: false; reason: DemoEnterFailure; detail?: string };

type DemoAuthClient = {
  auth: Pick<SupabaseClient["auth"], "signInWithPassword" | "signOut"> & {
    mfa: Pick<SupabaseClient["auth"]["mfa"], "getAuthenticatorAssuranceLevel">;
  };
};

export type CookieAdapter = {
  getAll: () => { name: string; value: string }[];
  setAll: (cookies: { name: string; value: string; options?: Record<string, unknown> }[]) => void;
};

export type DemoEnterDeps = {
  getConfig: () => DemoConfig | null;
  checkLimit: (ip: string | null) => Promise<DemoEntryLimitResult>;
  createAuthClient: (adapter: CookieAdapter) => DemoAuthClient;
};

export type DemoEnterInput = {
  // 請求的 Origin 標頭（缺少為 null）。
  origin: string | null;
  // 請求本身的來源（協定＋host），來自請求 URL。
  requestOrigin: string;
  siteUrl: string | undefined;
  ip: string | null;
};

// 暫存區：同名 cookie 後寫的覆蓋先寫的；值為空字串（Supabase 用它表示清除）不會出現在 getAll。
// `entries()` 保留全部（含清除指令），讓呼叫端在成功時一併寫出（例如清掉舊的分塊 cookie）。
export function createCookieStage() {
  const jar = new Map<string, StagedCookie>();
  const adapter: CookieAdapter = {
    getAll: () =>
      [...jar.values()].filter((c) => c.value !== "").map(({ name, value }) => ({ name, value })),
    setAll: (cookies) => {
      for (const { name, value, options } of cookies) jar.set(name, { name, value, options: options ?? {} });
    },
  };
  return { adapter, entries: () => [...jar.values()] };
}

// Origin 必須和 NEXT_PUBLIC_SITE_URL 或請求自身的 origin 完全相同（協定＋host＋port）。缺少、"null"、
// 無法解析一律視為不同源。瀏覽器的跨站請求無法偽造 Origin 標頭。
export function isSameOrigin(input: Pick<DemoEnterInput, "origin" | "requestOrigin" | "siteUrl">): boolean {
  if (!input.origin) return false;
  let origin: string;
  try {
    origin = new URL(input.origin).origin;
  } catch {
    return false;
  }
  if (origin === "null") return false;

  const allowed = new Set<string>([input.requestOrigin]);
  if (input.siteUrl) {
    try {
      allowed.add(new URL(input.siteUrl).origin);
    } catch {
      // 設定壞掉就只剩請求自身的 origin 可比對。
    }
  }
  return allowed.has(origin);
}

// 失敗後的清理：登出剛建立的 session（只撤銷這一個，scope: "local"）。**盡力而為**：丟例外或回錯誤都吞掉，
// 呼叫端不得依賴它成功。
async function bestEffortSignOut(client: DemoAuthClient | null) {
  if (!client) return;
  try {
    await client.auth.signOut({ scope: "local" });
  } catch {
    // 網路錯誤等：忽略。回應本來就不帶 cookie，沒人拿得到這個 session 的 token。
  }
}

export async function enterDemo(input: DemoEnterInput, deps: DemoEnterDeps): Promise<DemoEnterResult> {
  let client: DemoAuthClient | null = null;
  const stage = createCookieStage();
  // 暫存區的內容在任何失敗路徑都不會寫進回應，所以失敗結果不帶 cookie 名稱：回應的 Set-Cookie 只能由
  // 呼叫端用固定規則決定，才不會因「session 分成幾塊」洩漏「帳密正確但不是 Demo」（架構審查發現）。
  // detail 只放固定字串（限流原因、例外類別名稱），供營運分辨「整站被灌爆」與「單一 IP 被擋」；不含 IP、訊息。
  const fail = (reason: DemoEnterFailure, detail?: string): DemoEnterResult => ({ ok: false, reason, detail });
  try {
    // 同源檢查放在最前面：跨站請求在任何情況（含 Demo 未啟用）都只會得到 cross_origin，呼叫端對它不寫任何 cookie
    // （避免登出式 CSRF：惡意網站自動送出跨站 POST，讓店長在本機被登出）。
    if (!isSameOrigin(input)) return fail("cross_origin");

    const config = deps.getConfig();
    if (!config) return fail("config_missing");

    // 限流：不通過或出錯（checkLimit 本身把錯誤轉成 allowed: false）都拒絕；萬一它丟例外也由外層 catch 拒絕。
    const limit = await deps.checkLimit(input.ip);
    if (!limit.allowed) return fail("rate_limited", limit.reason);

    client = deps.createAuthClient(stage.adapter);

    const { data, error } = await client.auth.signInWithPassword({
      email: config.email,
      password: config.password,
    });
    if (error || !data?.user) return fail("sign_in_failed");

    // 只認 app_metadata.is_demo === true（嚴格布林；app_metadata 只有 service_role 能寫）。
    if (data.user.app_metadata?.is_demo !== true) {
      await bestEffortSignOut(client);
      return fail("not_demo");
    }

    // 需要 aal2（帳號啟用了 MFA）就拒絕：一鍵進入拿到的是 aal1，進了 /admin 也會被擋，等於登入卡死。
    // user 物件來自這次 signInWithPassword 的伺服器回應（不是 cookie 快取），factors 可信；
    // nextLevel 為規格要求的判斷，兩者任一顯示有已驗證的 TOTP 就拒絕。
    const hasVerifiedTotp = (data.user.factors ?? []).some(
      (f) => f.factor_type === "totp" && f.status === "verified",
    );
    const { data: aal, error: aalError } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    // 讀不到 aal（含 currentLevel 為 null：暫存區沒有 session）一律失敗，比照 lib/auth/aal.ts 的 fail-closed。
    // 這段 TOTP 判斷與 lib/auth/aal.ts 的 requiresAal2 同源；這裡刻意更嚴（nextLevel 涵蓋所有已驗證 factor）。
    if (aalError || !aal || aal.currentLevel !== "aal1" || !aal.nextLevel) {
      await bestEffortSignOut(client);
      return fail("aal_error");
    }
    if (hasVerifiedTotp || aal.nextLevel === "aal2") {
      await bestEffortSignOut(client);
      return fail("aal2");
    }

    // 成功前再確認暫存區真的有 session cookie；否則會回 { ok: true } 卻沒帶任何登入狀態。
    const cookies = stage.entries();
    if (!cookies.some((c) => c.name.startsWith("sb-") && c.value !== "")) {
      await bestEffortSignOut(client);
      return fail("error");
    }
    return { ok: true, cookies };
  } catch (err) {
    await bestEffortSignOut(client);
    // 只記例外類別名稱（不含訊息，訊息可能夾帶帳密）。
    return fail("error", err instanceof Error ? err.name : "unknown");
  }
}
