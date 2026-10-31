import "server-only";
import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { getDemoConfig } from "@/lib/demo/config";
import { enterDemo, type DemoEnterFailure } from "@/lib/demo/enter";
import { checkDemoEntryLimit, getClientIp } from "@/lib/demo/rate-limit";

// 一鍵進入體驗帳號（TASK-103）。公開端點：伺服器端以 Demo 帳戶登入並建立 session，所有防線與
// 「為什麼不是先寫 cookie 再撤銷」見 lib/demo/enter.ts 與架構筆記 D3。
//
// 回應刻意不洩漏原因：所有失敗的狀態碼與本文完全相同（reason 只進 log，且只是固定的類別字串）。
// 請求的 body、query 完全不讀；被登入的帳號只由伺服器環境變數決定。

// 只做登入與一次限流 RPC，遠低於預設上限；明寫出來避免平台預設值改動時被拖長。
export const maxDuration = 30;

const GENERIC_FAILURE = { ok: false } as const;
const FAILURE_STATUS = 403;

function json(body: unknown, init: { status: number; headers?: Record<string, string> }) {
  return NextResponse.json(body, {
    status: init.status,
    headers: { "Cache-Control": "no-store", ...init.headers },
  });
}

// log 只記失敗類別，不記 Email、密碼、token、IP、錯誤訊息。
function logFailure(reason: DemoEnterFailure, detail?: string) {
  if (detail) console.warn("[demo-enter] 失敗", reason, detail);
  else console.warn("[demo-enter] 失敗", reason);
}

const EXPIRED = { path: "/", maxAge: 0, expires: new Date(0) } as const;

// Supabase 的預設 cookie 名稱是 `sb-<專案 ref>-auth-token`，太大時分成 `.0`、`.1`…；PKCE 另有 `-code-verifier`。
function supabaseCookieBase(): string | null {
  try {
    return `sb-${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(".")[0]}-auth-token`;
  } catch {
    return null;
  }
}

// 失敗時要讓過期的 cookie 名稱：請求帶來的所有 sb-*（含分塊）＋固定的預設名稱清單，排序後輸出。
// 這是「不依賴 signOut」的那道保證：即使登出失敗，回應也明確把瀏覽器端的 sb-* 清掉。
// **名稱只由請求與固定清單決定，與這次登入走到哪一步無關**：失敗時暫存的 session 從沒寫進回應，瀏覽器端
// 根本沒有，不必過期；若併入暫存名稱，session 分成幾塊會讓 Set-Cookie 不同，洩漏「帳密正確但不是 Demo」。
// 預設清單涵蓋分塊上限（3180 字元一塊，Supabase session 通常 2 塊，留到 .4）。
const CHUNK_SLOTS = 5;

function namesToExpire(req: NextRequest): string[] {
  const names = new Set<string>();
  for (const { name } of req.cookies.getAll()) if (name.startsWith("sb-")) names.add(name);
  const base = supabaseCookieBase();
  if (base) {
    names.add(base);
    for (let i = 0; i < CHUNK_SLOTS; i += 1) names.add(`${base}.${i}`);
    names.add(`${base}-code-verifier`);
  }
  return [...names].sort();
}

// 唯一例外：跨站請求（cross_origin）**不寫任何 cookie**。否則惡意網站可自動送出跨站 POST，讓店長或正在體驗的
// 面試官在本機被登出（登出式 CSRF；Set-Cookie 對頂層導覽的回應仍會被瀏覽器接受）。這一類請求本來就沒有嘗試登入，
// 沒有任何 session 需要清理。代價：非瀏覽器端能分辨「是否通過同源檢查」，但它本來就知道自己送了什麼 Origin。
function failure(req: NextRequest, reason?: DemoEnterFailure) {
  const response = json(GENERIC_FAILURE, { status: FAILURE_STATUS });
  if (reason === "cross_origin") return response;
  for (const name of namesToExpire(req)) response.cookies.set(name, "", EXPIRED);
  return response;
}

export async function POST(req: NextRequest) {
  try {
    const result = await enterDemo(
      {
        origin: req.headers.get("origin"),
        requestOrigin: req.nextUrl.origin,
        siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
        ip: getClientIp(req.headers),
      },
      {
        getConfig: getDemoConfig,
        checkLimit: checkDemoEntryLimit,
        createAuthClient: (adapter) =>
          createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
            cookies: { getAll: adapter.getAll, setAll: adapter.setAll },
          }),
      },
    );

    if (!result.ok) {
      logFailure(result.reason, result.detail);
      return failure(req, result.reason);
    }

    // 兩項驗證都通過才走到這裡：才把暫存的 cookie 寫進回應。
    const response = json({ ok: true }, { status: 200 });
    const written = new Set<string>();
    for (const { name, value, options } of result.cookies) {
      response.cookies.set(name, value, options);
      written.add(name);
    }
    // 瀏覽器上殘留的舊 sb-* cookie（例如上一次較大的 session 留下的分塊）一併清掉，避免新舊混在一起。
    for (const name of namesToExpire(req)) {
      if (!written.has(name) && req.cookies.has(name)) response.cookies.set(name, "", EXPIRED);
    }
    return response;
  } catch (err) {
    logFailure("error", err instanceof Error ? err.name : "unknown");
    return failure(req);
  }
}

// 其他方法一律 405（Next 對沒匯出的方法也會回 405，這裡明寫是為了一併帶上 no-store 與 Allow）。
function methodNotAllowed() {
  return json({ ok: false }, { status: 405, headers: { Allow: "POST" } });
}

export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
