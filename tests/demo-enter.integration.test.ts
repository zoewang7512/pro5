// TASK-103（Demo 體驗帳戶）：對真實 Supabase 專案執行的整合測試，驗證一鍵進入端點 POST /api/demo/enter。
// 直接匯入 Route Handler（不啟動 Next 伺服器）；E2E（真實瀏覽器經登入頁進入）由 TASK-112 負責。
//
// 不放進預設 `npm test`，只透過 `npm run test:demo-enter` 執行（缺設定時直接噴錯，不略過）。
//
// 只建立與刪除自己的拋棄式帳號（app_metadata.demoenter_test = true，Email 含 demoenter，雙重條件才會被清除）；
// 不登入或修改 designer001 與真實 Demo 帳戶（清除時需列出全部使用者，但只刪除同時符合兩個條件的拋棄式帳號）。DEMO_* 環境變數只在本程序內被覆寫成拋棄式帳號，不影響 .env.local。
// 限流模組被換成「一律放行」：限流本身已有 test:demo-rate-limit，這裡不消耗正式的 `global` 額度。
// 不做全域 signOut；端點失敗路徑用的是 scope: "local"（只撤銷剛建立的那一個 session）。
// Auth 信件不會寄出（不觸發任何信件流程）。
//
// 登入限流提醒：Supabase 預設每 IP 每 5 分鐘 30 次登入，本檔約 9 次，請勿與其他 test:* 同時跑。
//
// 若測試被中斷而留下拋棄式帳號（Email 含 demoenter、app_metadata.demoenter_test = true；其中兩個是 admins、一個標了 is_demo）：
// 直接重跑本檔，beforeAll 會先清除；或在 Supabase Dashboard → Authentication → Users 搜尋 demoenter 後刪除（admins 列會連帶刪除）。
//
// 另含 `is_admin()` 寫入面實測（對應 verification/TASK-103-admin-surface.md）：以端點發出的 Demo session
// 直接對 REST／RPC／Storage／Auth Admin API 嘗試越權操作，全部都必須被擋下；被擋的操作不會留下任何資料。
import { createHmac, randomUUID } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { isAalSatisfied } from "@/lib/auth/aal";
import { updateSession } from "@/lib/supabase/middleware";

// 轉手記錄 Supabase client 寫出的 cookie（含之後被清除的），用來取出「失敗路徑建立過的 session」驗證它真的被撤銷。
const recorded = vi.hoisted(() => ({ cookies: [] as { name: string; value: string }[] }));
vi.mock("@supabase/ssr", async (importOriginal) => {
  const original = await importOriginal<typeof import("@supabase/ssr")>();
  return {
    ...original,
    createServerClient: ((supabaseUrl: string, key: string, options: { cookies: { setAll?: (c: { name: string; value: string }[], h: Record<string, string>) => unknown } }) => {
      const setAll = options.cookies.setAll;
      return (original.createServerClient as (...args: unknown[]) => unknown)(supabaseUrl, key, {
        ...options,
        cookies: {
          ...options.cookies,
          setAll: (cookies: { name: string; value: string }[], headers: Record<string, string>) => {
            recorded.cookies.push(...cookies.map(({ name, value }) => ({ name, value })));
            return setAll?.(cookies, headers);
          },
        },
      });
    }) as typeof original.createServerClient,
  };
});

// server-only 在一般 Node 解析下會 throw，比照既有整合測試以空模組取代。
vi.mock("server-only", () => ({}));

vi.mock("@/lib/demo/rate-limit", () => ({
  checkDemoEntryLimit: async () => ({ allowed: true }),
  getClientIp: () => null,
}));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceRoleKey) {
  throw new Error(
    "[demo-enter.integration.test] 缺少 NEXT_PUBLIC_SUPABASE_URL／NEXT_PUBLIC_SUPABASE_ANON_KEY／" +
      "SUPABASE_SERVICE_ROLE_KEY，請確認 .env.local 已填妥。",
  );
}

const SITE = "http://localhost:3000";
const clientOptions = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(url, serviceRoleKey, clientOptions);
const randomPassword = () => `${randomUUID()}${randomUUID().slice(0, 8)}aA1!`;

type TestUser = { id: string; email: string; password: string };
type RouteResponse = Awaited<ReturnType<typeof callEnter>>;

// 在 beforeAll 才匯入 Route Handler：先把 DEMO_* 設好再匯入，也避免模組載入順序問題。
let POST: (req: NextRequest) => Promise<Response & { cookies: { getAll(): { name: string; value: string; maxAge?: number }[] } }>;

// 端點記在 console.warn 的失敗類別（每次 callEnter 重置）。整合測試用它證明「是被預期的那道防線擋下」，
// 而不是因登入限流、網路錯誤、帳密問題等別的原因失敗而湊巧通過。
let warnings: string[] = [];
const lastCategory = () => warnings.at(-1)?.replace("[demo-enter] 失敗 ", "");

async function callEnter(init: { origin?: string | null; cookie?: string } = {}) {
  recorded.cookies = [];
  warnings = [];
  const headers: Record<string, string> = {};
  if (init.origin !== null) headers.origin = init.origin ?? SITE;
  if (init.cookie) headers.cookie = init.cookie;
  return POST(new NextRequest(`${SITE}/api/demo/enter`, { method: "POST", headers }));
}

const liveCookies = (res: RouteResponse) => res.cookies.getAll().filter((c) => c.name.startsWith("sb-") && c.value !== "");

function useDemoEnv(user: TestUser) {
  process.env.DEMO_ENABLED = "true";
  process.env.DEMO_EMAIL = user.email;
  process.env.DEMO_PASSWORD = user.password;
}

async function createTestUser(label: string, appMetadata: Record<string, unknown>): Promise<TestUser> {
  const email = `delivered+demoenter-${label}-${randomUUID().slice(0, 8)}@resend.dev`;
  const password = randomPassword();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { demoenter_test: true, ...appMetadata },
    user_metadata: { name: `__TEST__demoenter-${label}` },
  });
  if (error || !data.user) throw new Error(`建立 ${label} 拋棄式帳號失敗：${error?.message ?? "沒有回傳使用者"}`);
  return { id: data.user.id, email, password };
}

async function registerAsAdmin(user: TestUser) {
  const { error } = await admin.from("admins").insert({ user_id: user.id, display_name: "__TEST__demoenter" });
  if (error) throw new Error(`登記 admins 失敗：${error.message}`);
}

async function listTestUsers() {
  const found = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`列出使用者失敗：${error.message}`);
    found.push(...data.users);
    if (data.users.length < 200) break;
  }
  return found.filter((u) => u.app_metadata?.demoenter_test === true && u.email?.includes("demoenter"));
}

// 雙重條件：app_metadata 標記 + Email 含 demoenter，不可能命中真實帳號。admins 列隨 on delete cascade 一併刪除。
async function deleteAllTestUsers() {
  const failures: string[] = [];
  for (const user of await listTestUsers()) {
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) failures.push(`${user.id}：${error.message}`);
  }
  if (failures.length > 0) throw new Error(`清除拋棄式帳號失敗：${failures.join("；")}`);
  const remaining = await listTestUsers();
  if (remaining.length > 0) throw new Error(`清除後仍殘留 ${remaining.length} 個拋棄式帳號`);
}

// 用端點回應的 cookie 建一個 SSR client（與 middleware、app/admin/layout.tsx 讀 session 的方式相同）。
function clientFromCookies(res: RouteResponse): SupabaseClient {
  const jar = liveCookies(res).map(({ name, value }) => ({ name, value }));
  return createServerClient(url!, anonKey!, { cookies: { getAll: () => jar, setAll: () => {} } });
}

// --- TOTP（RFC 6238，與 tests/mfa-rls.integration.test.ts 相同寫法，不新增依賴）---
function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of input.replace(/=+$/, "").toUpperCase()) {
    const idx = alphabet.indexOf(char);
    if (idx !== -1) bits += idx.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function totp(secretBase32: string, counter: number): string {
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", base32Decode(secretBase32)).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return (code % 1_000_000).toString().padStart(6, "0");
}

async function enrollVerifiedTotp(user: TestUser) {
  const client = createClient(url!, anonKey!, clientOptions);
  const signIn = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  if (signIn.error) throw new Error(`MFA 帳號登入失敗：${signIn.error.message}`);
  const enroll = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: "__TEST__demoenter" });
  if (enroll.error || !enroll.data) throw new Error(`mfa.enroll 失敗：${enroll.error?.message}`);
  const base = Math.floor(Date.now() / 1000 / 30);
  let lastError: unknown;
  for (const offset of [0, 1, -1]) {
    const challenge = await client.auth.mfa.challenge({ factorId: enroll.data.id });
    if (challenge.error || !challenge.data) throw new Error(`mfa.challenge 失敗：${challenge.error?.message}`);
    const verify = await client.auth.mfa.verify({
      factorId: enroll.data.id,
      challengeId: challenge.data.id,
      code: totp(enroll.data.totp.secret, base + offset),
    });
    if (!verify.error) {
      await client.auth.signOut({ scope: "local" });
      return;
    }
    lastError = verify.error;
  }
  throw new Error(`TOTP 驗證失敗：${(lastError as Error)?.message}`);
}

let demoUser: TestUser;
let plainAdmin: TestUser;
let mfaUser: TestUser;
let originalEnv: Record<string, string | undefined>;

beforeAll(async () => {
  originalEnv = {
    DEMO_ENABLED: process.env.DEMO_ENABLED,
    DEMO_EMAIL: process.env.DEMO_EMAIL,
    DEMO_PASSWORD: process.env.DEMO_PASSWORD,
  };
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  });
  await deleteAllTestUsers();

  demoUser = await createTestUser("demo", { is_demo: true });
  await registerAsAdmin(demoUser);
  // 「非 Demo 的真實管理員」：在 admins 表、沒有 is_demo。端點即使被誤設指向它也必須拒絕。
  plainAdmin = await createTestUser("plainadmin", {});
  await registerAsAdmin(plainAdmin);
  // 啟用了 MFA 的帳號：先以非 Demo 身分註冊並驗證 TOTP（Demo 帳號的 factor 註冊會被 0021 觸發器擋下），
  // 之後才標成 is_demo（觸發器只管「原本就是 Demo」的列）。
  mfaUser = await createTestUser("mfa", {});
  await registerAsAdmin(mfaUser);
  await enrollVerifiedTotp(mfaUser);
  const flag = await admin.auth.admin.updateUserById(mfaUser.id, { app_metadata: { demoenter_test: true, is_demo: true } });
  if (flag.error) throw new Error(`標記 MFA 帳號為 Demo 失敗：${flag.error.message}`);

  ({ POST } = (await import("@/app/api/demo/enter/route")) as unknown as { POST: typeof POST });
}, 90000);

afterAll(async () => {
  for (const [key, value] of Object.entries(originalEnv ?? {})) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await deleteAllTestUsers();
}, 60000);

// 取出端點失敗前建立過的 session（Supabase client 曾寫出的、最先出現的非空 cookie 值）。
function recordedSession(): { access_token: string; refresh_token: string } | null {
  const first = new Map<string, string>();
  for (const { name, value } of recorded.cookies) if (value !== "" && !first.has(name)) first.set(name, value);
  const names = [...first.keys()].filter((n) => /-auth-token(\.\d+)?$/.test(n)).sort();
  if (names.length === 0) return null;
  let raw = names.map((n) => first.get(n)).join("");
  if (raw.startsWith("base64-")) raw = Buffer.from(raw.slice("base64-".length), "base64url").toString("utf8");
  return JSON.parse(raw);
}

// 回應的「可觀察形狀」：狀態、本文、標頭、Set-Cookie 名稱集合（含過期指令）。所有失敗必須完全相同。
function shapeOf(res: RouteResponse, text: string) {
  return JSON.stringify({
    status: res.status,
    body: text,
    cacheControl: res.headers.get("Cache-Control"),
    contentType: res.headers.get("Content-Type"),
    // 照回應原始順序比對 Set-Cookie（名稱＋屬性，值是空的過期指令），順序不同也算可分辨。
    setCookie: res.headers.getSetCookie(),
  });
}

describe("成功路徑與 /admin 存取", () => {
  let res: RouteResponse;

  beforeAll(async () => {
    useDemoEnv(demoUser);
    res = await callEnter();
    expect(warnings).toEqual([]); // 成功路徑不記任何失敗
  });

  it("200 { ok: true }、no-store、帶 Supabase session cookie", async () => {
    expect(res.status).toBe(200);
    expect(await res.clone().json()).toEqual({ ok: true });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(liveCookies(res).length).toBeGreaterThan(0);
  });

  it("用回應的 cookie 存取後台守門條件：getUser() 成功、是 Demo、aal 已滿足、is_admin() 為 true", async () => {
    const supabase = clientFromCookies(res);
    const { data, error } = await supabase.auth.getUser();
    expect(error).toBeNull();
    expect(data.user?.id).toBe(demoUser.id);
    expect(data.user?.app_metadata?.is_demo).toBe(true);
    expect(await isAalSatisfied(supabase, data.user!)).toBe(true);
    const { data: isAdmin, error: rpcError } = await supabase.rpc("is_admin");
    expect(rpcError).toBeNull();
    expect(isAdmin).toBe(true);
  });

  it("Set-Cookie 原樣往返：把回應的 Set-Cookie 當成 Cookie 標頭送 /admin，真實 middleware（updateSession）不重導 /login", async () => {
    const setCookies = res.headers.getSetCookie();
    expect(setCookies.length).toBeGreaterThan(0);
    for (const line of setCookies) {
      expect(line).toMatch(/Path=\//i);
      expect(line).toMatch(/SameSite=lax/i);
      expect(line).toMatch(/Max-Age=\d+/i);
    }
    const cookieHeader = setCookies.map((line) => line.split(";")[0]).join("; ");
    const adminRequest = new NextRequest(`${SITE}/admin`, { headers: { cookie: cookieHeader } });
    const middlewareResponse = await updateSession(adminRequest);
    expect(middlewareResponse.headers.get("location")).toBeNull();
    expect(middlewareResponse.status).toBe(200);

    // 對照：沒有 cookie 就會被導向 /login（證明上面的通過不是因為 middleware 什麼都不擋）。
    const anonymous = await updateSession(new NextRequest(`${SITE}/admin`));
    expect(anonymous.headers.get("location")).toContain("/login");
  });

  it("回應中找不到 Email 與密碼", async () => {
    const everything = `${await res.clone().text()}\n${JSON.stringify([...res.headers])}`;
    expect(everything).not.toContain(demoUser.password);
    expect(everything).not.toContain(demoUser.email);
  });
});

describe("非 Demo 帳戶保證（真實 Supabase）", () => {
  it("DEMO_EMAIL 指向非 Demo 的管理員帳號：被 not_demo 擋下、回應沒有任何 session cookie、剛建立的 session 已被撤銷", async () => {
    useDemoEnv(plainAdmin);
    const res = await callEnter();
    expect(lastCategory()).toBe("not_demo"); // 不是 sign_in_failed：帳密有效，是 is_demo 驗證擋下
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(liveCookies(res)).toEqual([]);
    expect(res.headers.get("set-cookie") ?? "").not.toMatch(/sb-[^=]*-auth-token=[^;]+/);

    // signOut 的實際效果：端點內部真的登入成功過（有暫存 session），之後該 session 在伺服器端已失效。
    const session = recordedSession();
    expect(session, "應該記錄到失敗前建立的 session").not.toBeNull();
    const { error: getUserError } = await admin.auth.getUser(session!.access_token);
    expect(getUserError, "access token 對應的 session 應已被撤銷").not.toBeNull();
    const refreshed = await createClient(url!, anonKey!, clientOptions).auth.refreshSession({
      refresh_token: session!.refresh_token,
    });
    expect(refreshed.error, "refresh token 應已失效").not.toBeNull();
    expect(refreshed.data.session).toBeNull();
  });

  it("帳號有已驗證的 TOTP（需要 aal2）：被 aal2 擋下、不帶 session cookie、session 已被撤銷", async () => {
    useDemoEnv(mfaUser);
    const res = await callEnter();
    expect(lastCategory()).toBe("aal2");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false });
    expect(liveCookies(res)).toEqual([]);
    const session = recordedSession();
    expect(session).not.toBeNull();
    expect((await admin.auth.getUser(session!.access_token)).error).not.toBeNull();
  });

  it("Demo 帳號但密碼錯誤（sign_in_failed）與非 Demo（not_demo）：回應的狀態、本文、標頭、Set-Cookie 完全相同", async () => {
    useDemoEnv({ ...demoUser, password: randomPassword() });
    const wrongPassword = await callEnter();
    expect(lastCategory()).toBe("sign_in_failed");
    const wrongShape = shapeOf(wrongPassword, await wrongPassword.text());

    useDemoEnv(plainAdmin);
    const notDemo = await callEnter();
    expect(lastCategory()).toBe("not_demo");
    const notDemoShape = shapeOf(notDemo, await notDemo.text());

    useDemoEnv(mfaUser);
    const aal2 = await callEnter();
    expect(lastCategory()).toBe("aal2");
    const aal2Shape = shapeOf(aal2, await aal2.text());

    expect(notDemoShape).toBe(wrongShape);
    expect(aal2Shape).toBe(wrongShape);
    expect(liveCookies(wrongPassword)).toEqual([]);
  });

  it("帳號不存在（Email 查無）：sign_in_failed，回應同上", async () => {
    useDemoEnv({ ...demoUser, email: `delivered+demoenter-nobody-${randomUUID().slice(0, 8)}@resend.dev` });
    const res = await callEnter();
    expect(lastCategory()).toBe("sign_in_failed");
    expect(res.status).toBe(403);
    expect(liveCookies(res)).toEqual([]);
  });

  it("跨站與缺 Origin：失敗，不會登入", async () => {
    useDemoEnv(demoUser);
    for (const origin of ["https://evil.example.test", null]) {
      const res = await callEnter({ origin });
      expect(lastCategory()).toBe("cross_origin");
      expect(res.headers.getSetCookie()).toEqual([]);
      expect(res.status).toBe(403);
      expect(liveCookies(res)).toEqual([]);
    }
  });

  it("DEMO_ENABLED 關閉：失敗", async () => {
    useDemoEnv(demoUser);
    process.env.DEMO_ENABLED = "false";
    const res = await callEnter();
    expect(lastCategory()).toBe("config_missing");
    expect(res.status).toBe(403);
    expect(liveCookies(res)).toEqual([]);
  });
});

// ---- is_admin() 寫入面實測：以端點發出的 Demo session 嘗試越權 ----
describe("is_admin() 寫入面：Demo 管理員無法提權、無法新增 admins、無法讀 auth 資料", () => {
  let demoClient: SupabaseClient;
  let accessToken: string;
  let denied: (r: { data: unknown; error: { code?: string; message?: string } | null }) => void;

  beforeAll(async () => {
    useDemoEnv(demoUser);
    const res = await callEnter();
    expect(res.status).toBe(200);
    demoClient = clientFromCookies(res);
    const { data } = await demoClient.auth.getSession();
    accessToken = data.session!.access_token;
    // 「被擋下」＝有錯誤，且沒有回傳任何資料列。
    denied = ({ data, error }) => {
      expect(error, "應被擋下").not.toBeNull();
      expect(data == null || (Array.isArray(data) && data.length === 0)).toBe(true);
    };
  });

  const PERMISSION = "42501";

  it("admins：不能新增、讀取、修改、刪除（無法讓任何帳號成為管理員）", async () => {
    const who = randomUUID();
    for (const result of [
      await demoClient.from("admins").insert({ user_id: plainAdmin.id }).select(),
      await demoClient.from("admins").insert({ user_id: who, display_name: "x" }).select(),
      await demoClient.from("admins").select("*"),
      await demoClient.from("admins").update({ display_name: "hacked" }).eq("user_id", demoUser.id).select(),
      await demoClient.from("admins").delete().eq("user_id", demoUser.id).select(),
    ]) {
      denied(result);
      expect(result.error?.code).toBe(PERMISSION);
    }
  });

  it("is_admin() 本身只回自己的布林；get/update_admin_profile 只作用於自己那列", async () => {
    expect((await demoClient.rpc("is_admin")).data).toBe(true);
    const profile = await demoClient.rpc("get_admin_profile");
    expect(profile.error).toBeNull();
    expect(Array.isArray(profile.data) ? profile.data.length : 1).toBeLessThanOrEqual(1);
  });

  it("customers：不能讀、不能寫", async () => {
    for (const result of [
      await demoClient.from("customers").select("*"),
      await demoClient.from("customers").insert({ name: "x" }).select(),
      await demoClient.from("customers").update({ name: "x" }).eq("id", randomUUID()).select(),
      await demoClient.from("customers").delete().eq("id", randomUUID()).select(),
    ]) {
      denied(result);
      expect(result.error?.code).toBe(PERMISSION);
    }
  });

  it("appointments：不能新增／刪除；只能改 status、start_at、end_at、reminder_sent_at；讀不到 access_token、customer_id 之外的憑證", async () => {
    const id = randomUUID();
    for (const result of [
      await demoClient.from("appointments").insert({ customer_name: "x" }).select(),
      await demoClient.from("appointments").delete().eq("id", id).select(),
      await demoClient.from("appointments").update({ customer_name: "x" }).eq("id", id).select(),
      await demoClient.from("appointments").update({ customer_email: "x@example.test" }).eq("id", id).select(),
      await demoClient.from("appointments").update({ access_token: "x" }).eq("id", id).select(),
      await demoClient.from("appointments").update({ designer_id: randomUUID() }).eq("id", id).select(),
      await demoClient.from("appointments").select("access_token"),
    ]) {
      denied(result);
      expect(result.error?.code).toBe(PERMISSION);
    }
  });

  it("services／designers／audit_log：不能刪除；designers 不能改 id／created_at；audit_log 不能改", async () => {
    const id = randomUUID();
    for (const result of [
      await demoClient.from("services").delete().eq("id", id).select(),
      await demoClient.from("designers").delete().eq("id", id).select(),
      await demoClient.from("designers").update({ created_at: "2000-01-01T00:00:00Z" }).eq("id", id).select(),
      await demoClient.from("designers").insert({ id, name: "x" }).select(),
      await demoClient.from("audit_log").update({ summary: {} }).eq("id", 1).select(),
      await demoClient.from("audit_log").delete().eq("id", 1).select(),
      await demoClient.from("audit_log").insert({ actor_id: randomUUID(), event_type: "a.b", entity_type: "x", entity_id: "1" }).select(),
    ]) {
      denied(result);
      expect(result.error?.code).toBe(PERMISSION);
    }
  });

  it("單例表（store_settings、booking_policy）：不能新增列、不能刪除", async () => {
    for (const result of [
      await demoClient.from("store_settings").insert({ id: 2 }).select(),
      await demoClient.from("store_settings").delete().eq("id", 1).select(),
      await demoClient.from("booking_policy").insert({ id: 2 }).select(),
      await demoClient.from("booking_policy").delete().eq("id", 1).select(),
    ]) {
      denied(result);
      expect(result.error?.code).toBe(PERMISSION);
    }
  });

  it("限流與還原用的函式：Demo 不能呼叫（只有 service_role）", async () => {
    for (const fn of ["demo_entry_check", "demo_revoke_sessions"]) {
      const result = await demoClient.rpc(fn, fn === "demo_entry_check" ? { p_bucket: "__TEST__x", p_limit: 1, p_window_seconds: 60 } : {});
      denied(result);
      expect(result.error?.code).toBe(PERMISSION);
    }
    denied(await demoClient.from("demo_entry_attempts").select("*"));
  });

  it("auth、storage 等 schema 沒有透過 REST 暴露：讀不到 auth.users、auth.mfa_factors、storage.objects", async () => {
    for (const [schema, table] of [
      ["auth", "users"],
      ["auth", "mfa_factors"],
      ["auth", "sessions"],
      ["storage", "objects"],
      ["storage", "buckets"],
    ]) {
      denied(await (demoClient as unknown as { schema(name: string): Pick<SupabaseClient, "from"> }).schema(schema).from(table).select("*"));
    }
  });

  it("Auth Admin API（需要 service_role）：用 Demo 的 JWT 呼叫一律被拒", async () => {
    const headers = { apikey: anonKey!, Authorization: `Bearer ${accessToken}`, "content-type": "application/json" };
    const list = await fetch(`${url}/auth/v1/admin/users`, { headers });
    expect([401, 403]).toContain(list.status);
    const create = await fetch(`${url}/auth/v1/admin/users`, {
      method: "POST",
      headers,
      body: JSON.stringify({ email: `delivered+demoenter-evil-${randomUUID().slice(0, 8)}@resend.dev`, password: randomPassword() }),
    });
    expect([401, 403]).toContain(create.status);
    const patch = await fetch(`${url}/auth/v1/admin/users/${plainAdmin.id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ app_metadata: { is_demo: false } }),
    });
    expect([401, 403]).toContain(patch.status);
  });

  it("Storage：不能建立 bucket；不能寫入既有 bucket 的非白名單路徑／檔名", async () => {
    const created = await demoClient.storage.createBucket(`__test__demoenter-${randomUUID().slice(0, 8)}`);
    expect(created.error).not.toBeNull();

    const png = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
    const attempts = [
      ["store-assets", `evil/${randomUUID()}.png`],
      ["admin-assets", `evil/${randomUUID()}.png`],
      ["designer-assets", `evil/${randomUUID()}.png`],
      ["designer-assets", `avatar/not-a-uuid/${randomUUID()}.png`],
      ["designer-assets", `avatar/${randomUUID()}/${randomUUID()}.html`],
      ["no-such-bucket", `${randomUUID()}.png`],
    ] as const;
    const written: [string, string][] = [];
    for (const [bucket, path] of attempts) {
      const result = await demoClient.storage.from(bucket).upload(path, png, { contentType: "image/png" });
      if (!result.error) written.push([bucket, path]);
      expect(result.error, `${bucket}/${path} 應被擋下`).not.toBeNull();
    }
    // 萬一有任何一筆寫進去了，立刻清掉（測試本身會因上面的 expect 失敗）。
    for (const [bucket, path] of written) await admin.storage.from(bucket).remove([path]);
  });

  // TASK-113（0025）之後：admin-assets 的 update／delete 限物件擁有者（RESTRICTIVE policy），Demo 仍可「列出」（select 不受限），
  // 但不能刪除別人或擁有者為 null（service role 上傳）的物件。見盤點報告 §3-H。原本這裡是記錄已知寬鬆面的特徵化案例，已反轉。
  // 這裡只動自己用 service role 上傳的測試物件，不碰任何真實檔案。
  it("Storage（TASK-113 後）：Demo 能列出 admin-assets 內既有物件，但不能刪除不是自己上傳的", async () => {
    const png = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
    const name = `__TEST__demoenter-${randomUUID().slice(0, 8)}.png`;
    const path = `avatar/${name}`;
    const uploaded = await admin.storage.from("admin-assets").upload(path, png, { contentType: "image/png" });
    if (uploaded.error) throw new Error(`service role 上傳測試物件失敗：${uploaded.error.message}`);
    try {
      const listed = await demoClient.storage.from("admin-assets").list("avatar", { search: name });
      expect(listed.error).toBeNull();
      expect((listed.data ?? []).map((o) => o.name)).toContain(name);

      // RLS 擋下 remove 時 Storage 不回錯誤，只回空陣列；以「物件是否還在」為準。
      const removed = await demoClient.storage.from("admin-assets").remove([path]);
      expect(removed.data ?? []).toHaveLength(0);
      const after = await admin.storage.from("admin-assets").list("avatar", { search: name });
      expect((after.data ?? []).map((o) => o.name), "Demo 不應能刪除別人上傳的 admin-assets 物件").toContain(name);
    } finally {
      await admin.storage.from("admin-assets").remove([path]);
    }
  });

  it("MFA／密碼：Demo 不能替自己啟用 MFA 或改密碼（0021 資料庫鎖定）", async () => {
    const enroll = await demoClient.auth.mfa.enroll({ factorType: "totp", friendlyName: "__TEST__demoenter" });
    expect(enroll.error).not.toBeNull();
    const update = await demoClient.auth.updateUser({ password: randomPassword() });
    expect(update.error).not.toBeNull();
  });
});
