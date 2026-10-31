import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// server-only 在 Vitest 一律拿到會 throw 的版本，比照既有 tests/api/ 的寫法 mock 成空模組。
vi.mock("server-only", () => ({}));

// 假的 Supabase client：用傳進來的 cookie adapter 模擬真實行為（登入成功時寫出 session cookie），
// 這樣才能驗證「暫存、驗證通過才寫入回應」，而不是只驗證呼叫次數。
type FakeUser = { app_metadata?: Record<string, unknown>; factors?: { factor_type: string; status: string }[] };

const state = vi.hoisted(() => ({
  adapterSeenAtStart: null as unknown,
  signIn: vi.fn(),
  signOut: vi.fn(),
  getAal: vi.fn(),
  checkLimit: vi.fn(),
  createClientThrows: false,
  // fake 的 signOut 預設會清空暫存區（與真實 auth-js 一致）；設 true 模擬「清不掉」（例如網路中斷時仍殘留）。
  signOutKeepsStage: false,
  // 登入成功時 fake 寫出的 cookie 名稱（預設單一名稱；測試可模擬分塊）。
  sessionCookieNames: ["sb-abcdefgh-auth-token"],
  getAllAtAal: null as unknown,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    options: { cookies: { getAll: () => { name: string; value: string }[]; setAll: (c: unknown[]) => void } },
  ) => {
    if (state.createClientThrows) throw new Error("createServerClient 失敗");
    const { getAll, setAll } = options.cookies;
    state.adapterSeenAtStart = getAll();
    return {
      auth: {
        signInWithPassword: async (credentials: { email: string; password: string }) => {
          const result = await state.signIn(credentials);
          if (!result.error) {
            setAll(
              state.sessionCookieNames.map((name) => ({
                name,
                value: "SESSION-TOKEN-VALUE",
                options: { path: "/", maxAge: 400 },
              })),
            );
          }
          return result;
        },
        signOut: async (opts: unknown) => {
          const result = await state.signOut(opts);
          if (!state.signOutKeepsStage) {
            setAll(state.sessionCookieNames.map((name) => ({ name, value: "", options: { path: "/", maxAge: 0 } })));
          }
          return result;
        },
        mfa: {
          getAuthenticatorAssuranceLevel: () => {
            state.getAllAtAal = getAll();
            return state.getAal();
          },
        },
      },
    };
  },
}));

vi.mock("@/lib/demo/rate-limit", () => ({
  checkDemoEntryLimit: (ip: string | null) => state.checkLimit(ip),
  getClientIp: () => "203.0.113.5",
}));

import { DELETE, GET, PATCH, POST, PUT } from "@/app/api/demo/enter/route";

const DEMO_EMAIL = "hair_demo@example.test";
const DEMO_PASSWORD = "demo-password-that-must-never-leak-0123456789";
const SITE = "https://salon.example.test";

const demoUser: FakeUser = { app_metadata: { is_demo: true }, factors: [] };

function signInResult(user: FakeUser | null, error: unknown = null) {
  return { data: { user, session: user ? { access_token: "x" } : null }, error };
}

function request(init: { origin?: string | null; cookie?: string; method?: string; body?: unknown; url?: string } = {}) {
  const headers: Record<string, string> = {};
  if (init.origin !== null) headers.origin = init.origin ?? SITE;
  if (init.cookie) headers.cookie = init.cookie;
  const hasBody = init.body !== undefined;
  if (hasBody) headers["content-type"] = "application/json";
  return new NextRequest(init.url ?? `${SITE}/api/demo/enter`, {
    method: init.method ?? "POST",
    headers,
    body: hasBody ? JSON.stringify(init.body) : undefined,
  });
}

type Res = Awaited<ReturnType<typeof POST>>;
const liveSessionCookies = (res: Res) => res.cookies.getAll().filter((c) => c.name.startsWith("sb-") && c.value !== "");
const expiredNames = (res: Res) =>
  res.cookies
    .getAll()
    .filter((c) => c.value === "" && c.maxAge === 0)
    .map((c) => c.name);

let logSpies: ReturnType<typeof vi.spyOn>[] = [];

beforeEach(() => {
  vi.stubEnv("DEMO_ENABLED", "true");
  vi.stubEnv("DEMO_EMAIL", DEMO_EMAIL);
  vi.stubEnv("DEMO_PASSWORD", DEMO_PASSWORD);
  vi.stubEnv("DESIGNER_EMAIL", "owner@example.test");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", SITE);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefgh.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");

  state.createClientThrows = false;
  state.signOutKeepsStage = false;
  state.sessionCookieNames = ["sb-abcdefgh-auth-token"];
  state.getAllAtAal = null;
  state.adapterSeenAtStart = null;
  state.signIn.mockReset().mockResolvedValue(signInResult(demoUser));
  state.signOut.mockReset().mockResolvedValue({ error: null });
  state.getAal.mockReset().mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal1" }, error: null });
  state.checkLimit.mockReset().mockResolvedValue({ allowed: true });

  logSpies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function loggedText() {
  return logSpies.flatMap((spy) => spy.mock.calls.map((args) => args.map(String).join(" "))).join("\n");
}

async function bodyOf(res: Res) {
  return res.text();
}

describe("成功路徑", () => {
  it("200 { ok: true }、帶 session cookie、no-store", async () => {
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(liveSessionCookies(res)).toEqual([expect.objectContaining({ name: "sb-abcdefgh-auth-token", value: "SESSION-TOKEN-VALUE" })]);
  });

  it("以伺服器設定的帳密登入，並把限流用的 IP 傳給限流器", async () => {
    await POST(request());
    expect(state.signIn).toHaveBeenCalledWith({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
    expect(state.checkLimit).toHaveBeenCalledWith("203.0.113.5");
  });

  it("成功時把瀏覽器上殘留、但這次沒有重寫的舊 sb-* 分塊 cookie 清掉", async () => {
    const res = await POST(request({ cookie: "sb-abcdefgh-auth-token.0=old0; sb-abcdefgh-auth-token.1=old1; theme=dark" }));
    expect(expiredNames(res)).toEqual(expect.arrayContaining(["sb-abcdefgh-auth-token.0", "sb-abcdefgh-auth-token.1"]));
    expect(expiredNames(res)).not.toContain("theme");
    expect(liveSessionCookies(res).map((c) => c.name)).toEqual(["sb-abcdefgh-auth-token"]);
  });

  it("請求帶同名舊 session（已登入又再按一次進入）：成功後該名稱是新值，不是過期", async () => {
    const res = await POST(request({ cookie: "sb-abcdefgh-auth-token=old-session" }));
    expect(res.status).toBe(200);
    const same = res.cookies.getAll().filter((c) => c.name === "sb-abcdefgh-auth-token");
    expect(same).toEqual([expect.objectContaining({ value: "SESSION-TOKEN-VALUE", maxAge: 400 })]);
  });

  it("新 session 分成多塊：全部寫出；舊的多餘分塊被清掉", async () => {
    state.sessionCookieNames = ["sb-abcdefgh-auth-token.0", "sb-abcdefgh-auth-token.1", "sb-abcdefgh-auth-token.2"];
    const res = await POST(request({ cookie: "sb-abcdefgh-auth-token.3=stale; sb-abcdefgh-auth-token=legacy-unchunked" }));
    expect(res.status).toBe(200);
    expect(liveSessionCookies(res).map((c) => c.name).sort()).toEqual(state.sessionCookieNames);
    expect(expiredNames(res)).toEqual(expect.arrayContaining(["sb-abcdefgh-auth-token.3", "sb-abcdefgh-auth-token"]));
  });

  it("Supabase client 的 cookie 儲存一開始是空的（不會讀進請求帶來的 session）", async () => {
    await POST(request({ cookie: "sb-abcdefgh-auth-token=someone-elses-session" }));
    expect(state.adapterSeenAtStart).toEqual([]);
    // 登入後判斷 aal 時，儲存區只含這次登入寫出的 session，沒有請求帶來的那份。
    expect(state.getAllAtAal).toEqual([{ name: "sb-abcdefgh-auth-token", value: "SESSION-TOKEN-VALUE" }]);
  });

  it("origin 與請求 host 同源（SITE_URL 沒設定）也通過", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    const res = await POST(request({ origin: "http://localhost:3000", url: "http://localhost:3000/api/demo/enter" }));
    expect(res.status).toBe(200);
  });

  it("origin 等於 NEXT_PUBLIC_SITE_URL（請求 host 不同，例如反向代理後）也通過", async () => {
    const res = await POST(request({ url: "http://internal-host:3000/api/demo/enter" }));
    expect(res.status).toBe(200);
  });
});

describe("每一道防線", () => {
  async function expectBlocked(res: Res, opts: { signInCalled?: boolean } = {}) {
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(liveSessionCookies(res)).toEqual([]);
    expect(state.signIn).toHaveBeenCalledTimes(opts.signInCalled ? 1 : 0);
  }

  it.each([
    ["DEMO_ENABLED 未設定", () => vi.stubEnv("DEMO_ENABLED", "")],
    ["DEMO_ENABLED 不是 true", () => vi.stubEnv("DEMO_ENABLED", "1")],
    ["缺 DEMO_EMAIL", () => vi.stubEnv("DEMO_EMAIL", "")],
    ["缺 DEMO_PASSWORD", () => vi.stubEnv("DEMO_PASSWORD", "")],
    ["DEMO_EMAIL 等於設計師帳號", () => vi.stubEnv("DESIGNER_EMAIL", DEMO_EMAIL.toUpperCase())],
  ])("未啟用／缺設定：%s", async (_label, arrange) => {
    arrange();
    await expectBlocked(await POST(request()));
    expect(state.checkLimit).not.toHaveBeenCalled();
  });

  it.each([
    ["缺 Origin", null],
    ["Origin 是 null 字串", "null"],
    ["跨站", "https://evil.example.test"],
    ["同 host 不同協定", "http://salon.example.test"],
    ["同 host 不同 port", "https://salon.example.test:8443"],
    ["子網域", "https://sub.salon.example.test"],
    ["無法解析", "not a url"],
  ])("同源檢查：%s", async (_label, origin) => {
    await expectBlocked(await POST(request({ origin })));
    expect(state.checkLimit).not.toHaveBeenCalled();
  });

  it("被限流 → 失敗，且不登入", async () => {
    state.checkLimit.mockResolvedValue({ allowed: false, reason: "ip_limit" });
    await expectBlocked(await POST(request()));
  });

  it("跨站失敗不寫任何 cookie（防登出式 CSRF）：即使請求帶 sb-* 也沒有 Set-Cookie，本文與狀態碼仍與其他失敗相同", async () => {
    const cross = await POST(request({ origin: "https://evil.example.test", cookie: "sb-abcdefgh-auth-token=real-session" }));
    expect(cross.status).toBe(403);
    expect(await cross.text()).toBe('{"ok":false}');
    expect(cross.headers.get("Cache-Control")).toBe("no-store");
    expect(cross.headers.getSetCookie()).toEqual([]);
    expect(loggedText()).toContain("cross_origin");

    // 缺 Origin 同樣不寫 cookie。
    const noOrigin = await POST(request({ origin: null, cookie: "sb-abcdefgh-auth-token=real-session" }));
    expect(noOrigin.headers.getSetCookie()).toEqual([]);

    // 對照：同源的失敗仍照規格讓 sb-* 過期。
    state.signIn.mockResolvedValue(signInResult(null, { message: "bad" }));
    const sameOrigin = await POST(request({ cookie: "sb-abcdefgh-auth-token=real-session" }));
    expect(expiredNames(sameOrigin)).toContain("sb-abcdefgh-auth-token");
  });

  it("Demo 未啟用時，跨站請求仍歸類為 cross_origin、不寫 cookie；同源請求才是 config_missing 並過期 cookie", async () => {
    vi.stubEnv("DEMO_ENABLED", "");
    const cross = await POST(request({ origin: "https://evil.example.test", cookie: "sb-abcdefgh-auth-token=x" }));
    expect(cross.headers.getSetCookie()).toEqual([]);
    expect(loggedText()).toContain("cross_origin");
    const same = await POST(request({ cookie: "sb-abcdefgh-auth-token=x" }));
    expect(expiredNames(same)).toContain("sb-abcdefgh-auth-token");
    expect(loggedText()).toContain("config_missing");
  });

  it("log 記下限流原因（固定字串），分得出整站上限與單一 IP", async () => {
    state.checkLimit.mockResolvedValue({ allowed: false, reason: "global_limit" });
    await POST(request());
    expect(loggedText()).toContain("rate_limited global_limit");
    expect(loggedText()).not.toContain("203.0.113.5");
  });

  it("限流器回報出錯 → 失敗（出錯不放行）", async () => {
    state.checkLimit.mockResolvedValue({ allowed: false, reason: "error" });
    await expectBlocked(await POST(request()));
  });

  it("限流器丟例外 → 失敗（出錯不放行）", async () => {
    state.checkLimit.mockRejectedValue(new Error("rpc 掛了"));
    await expectBlocked(await POST(request()));
  });

  it("登入失敗（密碼錯誤、被 Auth 限流、帳號被鎖都一樣）→ 失敗", async () => {
    state.signIn.mockResolvedValue(signInResult(null, { message: "Invalid login credentials", status: 400 }));
    await expectBlocked(await POST(request()), { signInCalled: true });
  });

  it("登入丟例外 → 失敗", async () => {
    state.signIn.mockRejectedValue(new Error("network down"));
    await expectBlocked(await POST(request()), { signInCalled: true });
  });

  it("建立 client 丟例外 → 失敗", async () => {
    state.createClientThrows = true;
    await expectBlocked(await POST(request()));
  });

  it.each([
    ["沒有 app_metadata", { factors: [] }],
    ["is_demo 缺欄位", { app_metadata: {}, factors: [] }],
    ["is_demo 是 false", { app_metadata: { is_demo: false }, factors: [] }],
    ["is_demo 是字串 'true'", { app_metadata: { is_demo: "true" }, factors: [] }],
    ["is_demo 是 1", { app_metadata: { is_demo: 1 }, factors: [] }],
    ["is_demo 在 user_metadata（使用者自己可寫）", { app_metadata: {}, user_metadata: { is_demo: true } }],
  ] as [string, FakeUser][])("非 Demo 帳戶：%s → 失敗、不帶 session cookie、撤銷剛建立的 session", async (_label, user) => {
    state.signIn.mockResolvedValue(signInResult(user));
    const res = await POST(request());
    await expectBlocked(res, { signInCalled: true });
    expect(state.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(expiredNames(res)).toContain("sb-abcdefgh-auth-token");
    expect(state.getAal).not.toHaveBeenCalled();
  });

  it("需要 aal2（nextLevel）→ 失敗", async () => {
    state.getAal.mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal2" }, error: null });
    const res = await POST(request());
    await expectBlocked(res, { signInCalled: true });
    expect(state.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("帳號有已驗證的 TOTP（即使 nextLevel 回報異常）→ 失敗", async () => {
    state.signIn.mockResolvedValue(
      signInResult({ app_metadata: { is_demo: true }, factors: [{ factor_type: "totp", status: "verified" }] }),
    );
    await expectBlocked(await POST(request()), { signInCalled: true });
  });

  it("未驗證的 TOTP factor 不算啟用 MFA", async () => {
    state.signIn.mockResolvedValue(
      signInResult({ app_metadata: { is_demo: true }, factors: [{ factor_type: "totp", status: "unverified" }] }),
    );
    const res = await POST(request());
    expect(res.status).toBe(200);
  });

  it("讀不到 aal（錯誤或空資料）→ 失敗", async () => {
    state.getAal.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expectBlocked(await POST(request()), { signInCalled: true });
  });

  it.each([["PUT", PUT], ["PATCH", PATCH], ["DELETE", DELETE], ["GET", GET]] as const)(
    "%s → 405，帶 Allow 與 no-store，不做任何事",
    async (_method, handler) => {
      const res = await handler();
      expect(res.status).toBe(405);
      expect(res.headers.get("Allow")).toBe("POST");
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(state.checkLimit).not.toHaveBeenCalled();
      expect(state.signIn).not.toHaveBeenCalled();
    },
  );
});

describe("非 Demo 帳戶保證", () => {
  it("DEMO_EMAIL 指向非 Demo 帳號：端點失敗，且回應中沒有任何 session cookie（任何 sb-* 都只有過期指令）", async () => {
    vi.stubEnv("DEMO_EMAIL", "real-admin@example.test");
    state.signIn.mockResolvedValue(signInResult({ app_metadata: {}, factors: [] }));
    const res = await POST(request({ cookie: "sb-abcdefgh-auth-token=old" }));
    expect(res.status).toBe(403);
    expect(liveSessionCookies(res)).toEqual([]);
    expect(res.headers.get("set-cookie") ?? "").not.toContain("SESSION-TOKEN-VALUE");
    expect(expiredNames(res)).toContain("sb-abcdefgh-auth-token");
  });

  it("signOut 丟例外（模擬網路錯誤）：回應仍不帶 session cookie，且 sb-* 被標記過期", async () => {
    state.signIn.mockResolvedValue(signInResult({ app_metadata: {}, factors: [] }));
    state.signOut.mockRejectedValue(new Error("fetch failed"));
    const res = await POST(request({ cookie: "sb-abcdefgh-auth-token=old; sb-abcdefgh-auth-token.0=a" }));
    expect(state.signOut).toHaveBeenCalled();
    expect(res.status).toBe(403);
    expect(liveSessionCookies(res)).toEqual([]);
    expect(res.headers.get("set-cookie") ?? "").not.toContain("SESSION-TOKEN-VALUE");
    expect(expiredNames(res)).toEqual(expect.arrayContaining(["sb-abcdefgh-auth-token", "sb-abcdefgh-auth-token.0"]));
  });

  it("signOut 回傳錯誤：同上", async () => {
    state.signIn.mockResolvedValue(signInResult({ app_metadata: {} }));
    state.signOut.mockResolvedValue({ error: { message: "nope" } });
    const res = await POST(request());
    expect(liveSessionCookies(res)).toEqual([]);
  });

  // 以下案例讓 fake 的 signOut「清不掉」暫存區：此時只有 route 不寫出暫存區才擋得住 session cookie，
  // 斷言才有鑑別力（signOut 會清空暫存區時，「回應沒有 live cookie」會恆真）。
  it.each([
    ["非 Demo", () => state.signIn.mockResolvedValue(signInResult({ app_metadata: {} }))],
    ["aal2", () => state.getAal.mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal2" }, error: null })],
    ["讀不到 aal（回傳錯誤）", () => state.getAal.mockResolvedValue({ data: null, error: { message: "boom" } })],
    ["讀 aal 丟例外", () => state.getAal.mockRejectedValue(new Error("aal 查詢失敗"))],
  ])("%s 且 signOut 丟例外／清不掉：暫存區仍有 session，但回應不帶 live cookie", async (_label, arrange) => {
    arrange();
    state.signOutKeepsStage = true;
    state.signOut.mockRejectedValue(new Error("fetch failed"));
    const res = await POST(request());
    expect(state.signOut).toHaveBeenCalled();
    expect(res.status).toBe(403);
    expect(liveSessionCookies(res)).toEqual([]);
    expect(res.headers.get("set-cookie") ?? "").not.toContain("SESSION-TOKEN-VALUE");
  });

  it("失敗回應的 Set-Cookie 與「session 分成幾塊」無關：不論登入走到哪一步，完全相同（含順序）", async () => {
    // 先取得登入前就失敗的基準回應。
    state.signIn.mockResolvedValue(signInResult(null, { message: "bad" }));
    const baseline = (await POST(request({ cookie: "sb-abcdefgh-auth-token.0=a" }))).headers.getSetCookie();

    // 帳密正確但非 Demo、session 被分成 3 塊、signOut 也清不掉：Set-Cookie 仍必須與基準一致。
    state.sessionCookieNames = ["sb-abcdefgh-auth-token.0", "sb-abcdefgh-auth-token.1", "sb-abcdefgh-auth-token.2"];
    state.signOutKeepsStage = true;
    state.signIn.mockResolvedValue(signInResult({ app_metadata: {} }));
    state.signOut.mockRejectedValue(new Error("fetch failed"));
    const res = await POST(request({ cookie: "sb-abcdefgh-auth-token.0=a" }));
    expect(res.headers.getSetCookie()).toEqual(baseline);
    expect(liveSessionCookies(res)).toEqual([]);
  });

  it("讀不到 session（currentLevel 為 null）→ 失敗，不回 { ok: true }", async () => {
    state.getAal.mockResolvedValue({ data: { currentLevel: null, nextLevel: null }, error: null });
    const res = await POST(request());
    expect(res.status).toBe(403);
    expect(loggedText()).toContain("aal_error");
  });

  it("登入成功卻沒有寫出任何 session cookie → 失敗，不回 { ok: true }", async () => {
    state.sessionCookieNames = [];
    const res = await POST(request());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false });
  });

  it("例外只記類別名稱，不記訊息", async () => {
    state.signIn.mockRejectedValue(new TypeError("boom " + DEMO_PASSWORD));
    await POST(request());
    expect(loggedText()).toContain("TypeError");
    expect(loggedText()).not.toContain(DEMO_PASSWORD);
  });

  it("每個失敗回應都明確讓預設名稱的 sb-* cookie 過期（含分塊與 code-verifier）", async () => {
    state.signIn.mockResolvedValue(signInResult(null, { message: "bad" }));
    const res = await POST(request());
    expect(expiredNames(res)).toEqual(
      expect.arrayContaining([
        "sb-abcdefgh-auth-token",
        "sb-abcdefgh-auth-token.0",
        "sb-abcdefgh-auth-token.1",
        "sb-abcdefgh-auth-token-code-verifier",
      ]),
    );
  });
});

describe("不洩漏", () => {
  it("所有失敗的狀態碼、本文、標頭（除 cookie 名稱外）完全相同，無法分辨原因", async () => {
    const scenarios: [string, () => Promise<Res>][] = [
      ["未啟用", async () => { vi.stubEnv("DEMO_ENABLED", ""); return POST(request()); }],
      ["限流", async () => { state.checkLimit.mockResolvedValue({ allowed: false, reason: "ip_limit" }); return POST(request()); }],
      ["登入失敗", async () => { state.signIn.mockResolvedValue(signInResult(null, { message: "x" })); return POST(request()); }],
      ["非 Demo", async () => { state.signIn.mockResolvedValue(signInResult({ app_metadata: {} })); return POST(request()); }],
      ["aal2", async () => { state.getAal.mockResolvedValue({ data: { nextLevel: "aal2" }, error: null }); return POST(request()); }],
      ["例外", async () => { state.createClientThrows = true; return POST(request()); }],
    ];
    const seen = new Set<string>();
    for (const [, run] of scenarios) {
      beforeEachReset();
      const res = await run();
      seen.add(
        JSON.stringify({
          status: res.status,
          body: await bodyOf(res),
          cacheControl: res.headers.get("Cache-Control"),
          contentType: res.headers.get("Content-Type"),
          setCookie: res.headers.get("set-cookie"),
        }),
      );
    }
    expect(seen.size).toBe(1);
    expect(JSON.parse([...seen][0]).body).toBe('{"ok":false}');
  });

  it("log 只記失敗類別；回應、log 都找不到 Email 與密碼（即使底層錯誤訊息含密碼）", async () => {
    state.signIn.mockResolvedValue(
      signInResult(null, { message: `Invalid login for ${DEMO_EMAIL} with ${DEMO_PASSWORD}`, status: 400 }),
    );
    const res = await POST(request());
    const text = await bodyOf(res);
    const everything = `${text}\n${JSON.stringify([...res.headers])}\n${loggedText()}`;
    expect(everything).not.toContain(DEMO_PASSWORD);
    expect(everything).not.toContain(DEMO_EMAIL);
    expect(everything).not.toContain("203.0.113.5");
    expect(loggedText()).toContain("sign_in_failed");
  });

  it("底層丟的例外（訊息含密碼）也不會進 log 或回應", async () => {
    state.signIn.mockRejectedValue(new Error(`boom ${DEMO_PASSWORD} ${DEMO_EMAIL}`));
    const res = await POST(request());
    const everything = `${await bodyOf(res)}\n${loggedText()}`;
    expect(everything).not.toContain(DEMO_PASSWORD);
    expect(everything).not.toContain(DEMO_EMAIL);
  });

  it("成功時 log 也沒有帳密或 token", async () => {
    const res = await POST(request());
    const everything = `${await bodyOf(res)}\n${loggedText()}`;
    expect(everything).not.toContain(DEMO_PASSWORD);
    expect(everything).not.toContain(DEMO_EMAIL);
    expect(everything).not.toContain("SESSION-TOKEN-VALUE");
  });
});

describe("使用者輸入不影響被登入的帳號", () => {
  it.each([
    ["body 帶 email／password", { body: { email: "victim@example.test", password: "x", is_demo: true } }],
    ["query 帶 email", { url: `${SITE}/api/demo/enter?email=victim@example.test&password=x&user=admin` }],
    ["body 與 query 都帶", { body: { email: "a@b.c" }, url: `${SITE}/api/demo/enter?email=a@b.c` }],
    ["什麼都不帶", {}],
  ])("%s → 一律以 DEMO_EMAIL／DEMO_PASSWORD 登入", async (_label, init) => {
    const res = await POST(request(init));
    expect(res.status).toBe(200);
    expect(state.signIn).toHaveBeenCalledTimes(1);
    expect(state.signIn).toHaveBeenCalledWith({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
  });

  it("Authorization 標頭與 Cookie 也不影響登入的帳號", async () => {
    const req = new NextRequest(`${SITE}/api/demo/enter`, {
      method: "POST",
      headers: { origin: SITE, authorization: "Bearer attacker", cookie: "sb-abcdefgh-auth-token=real-admin-session" },
    });
    await POST(req);
    expect(state.signIn).toHaveBeenCalledWith({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
    expect(state.adapterSeenAtStart).toEqual([]);
  });
});

// 讓「情境表」逐筆跑時，上一筆留下的 mock／環境不會汙染下一筆。
function beforeEachReset() {
  vi.stubEnv("DEMO_ENABLED", "true");
  state.createClientThrows = false;
  state.signIn.mockReset().mockResolvedValue(signInResult(demoUser));
  state.signOut.mockReset().mockResolvedValue({ error: null });
  state.getAal.mockReset().mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal1" }, error: null });
  state.checkLimit.mockReset().mockResolvedValue({ allowed: true });
}
