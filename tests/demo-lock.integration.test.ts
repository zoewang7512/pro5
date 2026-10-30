// TASK-100（Demo 體驗帳戶）：對真實 Supabase 專案執行的整合測試，驗證 0021_demo_account_lock.sql 的
// auth.users／auth.mfa_factors 觸發器與 demo_revoke_sessions()。
//
// 不放進預設 `npm test`，只透過 `npm run test:demo-lock` 執行（缺設定時直接噴錯，不略過）。
//
// 只建立與刪除自己的拋棄式帳號（app_metadata.demolock_test = true，Email 含 demolock，雙重條件才會被清除）；
// 不讀取、登入或修改 designer001 與真實 Demo 帳戶；不做全域 signOut（只用 scope: "local"）。
// Auth 信件（Email 變更確認、密碼重設）會真的寄出，收件人用 Resend 官方測試位址 delivered+...@resend.dev
// （Supabase 自訂 SMTP 是 Resend），不會寄到任何真人信箱。
//
// 「觸發器是 SECURITY INVOKER」的證明：若寫成 SECURITY DEFINER，函式內 current_user 變成擁有者，守門判斷
// 永遠放行，下面「被擋」的測試全部會失敗。（migration 尾端另有 pg_proc 自我檢查。）
//
// 限流提醒：鎖定模式每輪約 25 次密碼登入，Supabase 預設每 IP 每 5 分鐘 30 次，請勿 5 分鐘內連跑第二次，
// 也避免同時用同一 IP 操作 App 或其他 test:*；撞到限流時 signIn 會明確丟錯（不會誤判為通過）。
//
// 兩種模式（驗收標準：套用 _down.sql 後行為恢復）：
//   預設（鎖定中）：npm run test:demo-lock
//   套用 _down.sql 之後：PowerShell  $env:DEMO_LOCK_EXPECT="off"; npm run test:demo-lock
//                       Bash         DEMO_LOCK_EXPECT=off npm run test:demo-lock
//   off 模式下 Demo 帳號的各項操作預期都成功，並略過 demo_revoke_sessions 測試（函式已移除）。
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceRoleKey) {
  throw new Error(
    "[demo-lock.integration.test] 缺少 NEXT_PUBLIC_SUPABASE_URL／NEXT_PUBLIC_SUPABASE_ANON_KEY／" +
      "SUPABASE_SERVICE_ROLE_KEY，請確認 .env.local 已填妥。",
  );
}

const lockActive = process.env.DEMO_LOCK_EXPECT !== "off";
const RATE_LIMIT_CODES = new Set(["over_email_send_rate_limit", "over_request_rate_limit"]);
const clientOptions = { auth: { autoRefreshToken: false, persistSession: false } };

const admin = createClient(url, serviceRoleKey, clientOptions);
const newAnonClient = () => createClient(url, anonKey, clientOptions);

type TestUser = { id: string; email: string; password: string };
type AuthLikeError = { code?: string; status?: number; message?: string } | null;

const randomPassword = () => `${randomUUID()}${randomUUID().slice(0, 8)}aA1!`;

async function createTestUser(kind: "demo" | "control"): Promise<TestUser> {
  const email = `delivered+demolock-${kind}-${randomUUID().slice(0, 8)}@resend.dev`;
  const password = randomPassword();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: kind === "demo" ? { demolock_test: true, is_demo: true } : { demolock_test: true },
    user_metadata: { name: `__TEST__demolock-${kind}` },
  });
  if (error || !data.user) throw new Error(`建立 ${kind} 拋棄式帳號失敗：${error?.message ?? "沒有回傳使用者"}`);
  return { id: data.user.id, email, password };
}

async function listTestUsers() {
  const found = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`列出使用者失敗：${error.message}`);
    found.push(...data.users);
    if (data.users.length < 200) break;
  }
  return found;
}

// 雙重條件：app_metadata 標記 + Email 含 demolock，不可能命中真實帳號。
async function deleteAllTestUsers() {
  const mine = (await listTestUsers()).filter(
    (u) => u.app_metadata?.demolock_test === true && u.email?.includes("demolock"),
  );
  // 全部都嘗試刪除後再統一回報，避免第一個失敗就留下其餘帳號。
  const failures: string[] = [];
  for (const user of mine) {
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) failures.push(`${user.id}：${error.message}`);
  }
  if (failures.length > 0) throw new Error(`清除拋棄式帳號失敗：${failures.join("；")}`);
  const remaining = (await listTestUsers()).filter(
    (u) => u.app_metadata?.demolock_test === true && u.email?.includes("demolock"),
  );
  if (remaining.length > 0) throw new Error(`清除後仍殘留 ${remaining.length} 個拋棄式帳號`);
}

// 寄信或請求被限流時無法判定「是被鎖擋下」還是「被限流」，直接中止讓人稍後重跑，不誤判為通過。
function assertOutcome(label: string, error: AuthLikeError, shouldFail: boolean) {
  if (error?.code && RATE_LIMIT_CODES.has(error.code)) {
    throw new Error(`${label}：被限流（${error.code}），無法判定，請稍後重跑`);
  }
  if (shouldFail) {
    expect(error, `${label} 應被擋下`).not.toBeNull();
    // 觸發器的例外在 Auth API 是 HTTP 500（TASK-098 實測）；排除 4xx 驗證錯誤與沒有 status 的網路錯誤，
    // 避免把「別的原因造成的失敗」誤判為被鎖擋下。
    expect(error?.status, `${label} 應為 HTTP 500`).toBe(500);
  } else {
    expect(error, `${label} 應成功：${error?.message}`).toBeNull();
  }
}

async function signIn(user: TestUser) {
  const client = newAnonClient();
  const { data, error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error || !data.session) throw new Error(`登入 ${user.email} 失敗：${error?.message ?? "沒有 session"}`);
  return { client, accessToken: data.session.access_token };
}

// 只有明確的 invalid_credentials 才算「不可登入」；限流、網路錯誤等其他失敗直接丟錯，不當成密碼錯誤。
async function loginWorks(email: string, password: string) {
  const { error } = await newAnonClient().auth.signInWithPassword({ email, password });
  if (error === null) return true;
  if (error.code === "invalid_credentials") return false;
  throw new Error(`登入檢查遇到非預期錯誤（${error.code ?? error.status}）：${error.message}`);
}

async function countPreexistingDemoAccounts() {
  return (await listTestUsers()).filter(
    (u) => u.app_metadata?.is_demo === true && u.app_metadata?.demolock_test !== true,
  ).length;
}

describe(`Demo 帳戶鎖定（${lockActive ? "鎖定中" : "off：已套用 _down.sql"}）`, () => {
  let demo: TestUser;
  let control: TestUser;

  beforeAll(async () => {
    await deleteAllTestUsers(); // 清掉先前中斷留下的殘留
    // 建立 is_demo 帳戶本身也在觸發器啟用後進行：證明建立流程（GoTrue 連續 UPDATE 兩次）不被擋。
    demo = await createTestUser("demo");
    control = await createTestUser("control");
  }, 60000);

  afterAll(async () => {
    await deleteAllTestUsers();
  }, 60000);

  describe("Demo 帳號：不受影響的操作", () => {
    it("登入成功", async () => {
      const { error } = await newAnonClient().auth.signInWithPassword({ email: demo.email, password: demo.password });
      expect(error).toBeNull();
    });

    it("token refresh 成功", async () => {
      const { client } = await signIn(demo);
      const { error } = await client.auth.refreshSession();
      expect(error).toBeNull();
    });

    it("登出（scope: local）成功", async () => {
      const { client } = await signIn(demo);
      const { error } = await client.auth.signOut({ scope: "local" });
      expect(error).toBeNull();
    });

    it("更新 user_metadata 成功（不在鎖定欄位內）", async () => {
      const { client } = await signIn(demo);
      const { error } = await client.auth.updateUser({ data: { note: "metadata only" } });
      expect(error).toBeNull();
    });

    it("admin 設定與解除 ban_duration 成功（緊急關閉 demo:disable 依賴 banned_until 可寫）", async () => {
      const banned = await admin.auth.admin.updateUserById(demo.id, { ban_duration: "1h" });
      expect(banned.error).toBeNull();
      const lifted = await admin.auth.admin.updateUserById(demo.id, { ban_duration: "none" });
      expect(lifted.error).toBeNull();
    });
  });

  describe(lockActive ? "Demo 帳號：憑證變更被資料庫擋下" : "Demo 帳號：off 模式下憑證變更恢復成功", () => {
    it("updateUser({ password })", async () => {
      const { client } = await signIn(demo);
      const attempted = randomPassword();
      const { error } = await client.auth.updateUser({ password: attempted });
      assertOutcome("demo updateUser({ password })", error, lockActive);

      if (lockActive) {
        expect(await loginWorks(demo.email, demo.password), "原密碼仍可登入").toBe(true);
        expect(await loginWorks(demo.email, attempted), "嘗試設定的新密碼不可登入").toBe(false);
      } else {
        demo.password = attempted;
        expect(await loginWorks(demo.email, demo.password), "新密碼可登入").toBe(true);
      }
    });

    it("updateUser({ email })", async () => {
      const { client } = await signIn(demo);
      const newEmail = `delivered+demolock-demo-new-${randomUUID().slice(0, 8)}@resend.dev`;
      const { error } = await client.auth.updateUser({ email: newEmail });
      assertOutcome("demo updateUser({ email })", error, lockActive);

      const { data } = await admin.auth.admin.getUserById(demo.id);
      expect(data.user?.email).toBe(demo.email);
      if (lockActive) expect(data.user?.new_email ?? "", "被擋後沒有待確認的新 Email").toBe("");
    });

    it("resetPasswordForEmail", async () => {
      const { error } = await newAnonClient().auth.resetPasswordForEmail(demo.email);
      assertOutcome("demo resetPasswordForEmail", error, lockActive);

      if (lockActive) {
        const { data } = await admin.auth.admin.getUserById(demo.id);
        expect(data.user?.recovery_sent_at ?? null, "被擋後沒有重設密碼紀錄").toBeNull();
      }
    });

    it("mfa.enroll", async () => {
      const { client } = await signIn(demo);
      const { error } = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: "demolock-test" });
      assertOutcome("demo mfa.enroll", error, lockActive);

      const { data } = await admin.auth.admin.mfa.listFactors({ userId: demo.id });
      expect(data?.factors.length ?? 0, lockActive ? "被擋後沒有任何 factor" : "off 模式下 factor 已建立").toBe(
        lockActive ? 0 : 1,
      );
    });

    it("admin.updateUserById({ password })（service_role 也經過 GoTrue，同樣被擋）", async () => {
      const attempted = randomPassword();
      const { error } = await admin.auth.admin.updateUserById(demo.id, { password: attempted });
      assertOutcome("demo admin updateUserById({ password })", error, lockActive);
      if (!lockActive) demo.password = attempted;
      expect(await loginWorks(demo.email, demo.password)).toBe(true);
    });

    it("admin.updateUserById({ email })", async () => {
      const newEmail = `delivered+demolock-demo-admin-${randomUUID().slice(0, 8)}@resend.dev`;
      const { error } = await admin.auth.admin.updateUserById(demo.id, { email: newEmail, email_confirm: true });
      assertOutcome("demo admin updateUserById({ email })", error, lockActive);

      const { data } = await admin.auth.admin.getUserById(demo.id);
      if (lockActive) {
        expect(data.user?.email).toBe(demo.email);
      } else {
        expect(data.user?.email).toBe(newEmail);
        demo.email = newEmail;
      }
    });

    it.skipIf(!lockActive)("is_demo 標記不可被清除（否則可分兩步繞過所有鎖）", async () => {
      const { error } = await admin.auth.admin.updateUserById(demo.id, { app_metadata: { is_demo: null } });
      assertOutcome("demo admin 清除 is_demo 標記", error, true);
      const flipped = await admin.auth.admin.updateUserById(demo.id, { app_metadata: { is_demo: false } });
      assertOutcome("demo admin 改 is_demo 為 false", flipped.error, true);

      const { data } = await admin.auth.admin.getUserById(demo.id);
      expect(data.user?.app_metadata?.is_demo, "標記仍為 true").toBe(true);
    });

    it.skipIf(!lockActive)("reauthenticate() 被擋下（不寄 OTP 信到 Demo 信箱）", async () => {
      const { client } = await signIn(demo);
      const { error } = await client.auth.reauthenticate();
      assertOutcome("demo reauthenticate", error, true);
    });

    it.skipIf(!lockActive)("錯誤訊息有固定前綴、且不洩漏欄位名稱與資料庫細節", async () => {
      // supabase-js 會把這個錯誤呈現成 message = {}（TASK-098 實測），所以直接打 Auth API 看原始回應。
      const { accessToken } = await signIn(demo);
      const userHeaders = { apikey: anonKey, Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
      const attempts = [
        { label: "改密碼", path: "/auth/v1/user", method: "PUT", headers: userHeaders, body: { password: randomPassword() } },
        {
          label: "改 Email",
          path: "/auth/v1/user",
          method: "PUT",
          headers: userHeaders,
          body: { email: `delivered+demolock-demo-raw-${randomUUID().slice(0, 8)}@resend.dev` },
        },
        {
          label: "重設密碼",
          path: "/auth/v1/recover",
          method: "POST",
          headers: { apikey: anonKey, "Content-Type": "application/json" },
          body: { email: demo.email },
        },
      ];
      for (const attempt of attempts) {
        const response = await fetch(`${url}${attempt.path}`, {
          method: attempt.method,
          headers: attempt.headers,
          body: JSON.stringify(attempt.body),
        });
        const body = await response.text();
        expect(response.status, `${attempt.label} 應為 HTTP 500：${body}`).toBe(500);
        expect(body, `${attempt.label} 應帶固定前綴`).toContain("DEMO_LOCKED");
        expect(body, `${attempt.label} 不應洩漏欄位名稱`).not.toMatch(
          /encrypted_password|email_change|recovery_token|phone|locked \(/,
        );
      }
    });
  });

  describe("對照組（非 Demo 拋棄式帳號）：所有操作與套用前一致", () => {
    it("登入、refresh、登出", async () => {
      const { client } = await signIn(control);
      expect((await client.auth.refreshSession()).error).toBeNull();
      expect((await client.auth.signOut({ scope: "local" })).error).toBeNull();
    });

    it("updateUser({ password })", async () => {
      const { client } = await signIn(control);
      const next = randomPassword();
      const { error } = await client.auth.updateUser({ password: next });
      assertOutcome("control updateUser({ password })", error, false);
      control.password = next;
      expect(await loginWorks(control.email, control.password)).toBe(true);
    });

    it("updateUser({ email })", async () => {
      const { client } = await signIn(control);
      const { error } = await client.auth.updateUser({
        email: `delivered+demolock-control-new-${randomUUID().slice(0, 8)}@resend.dev`,
      });
      assertOutcome("control updateUser({ email })", error, false);
    });

    it("resetPasswordForEmail", async () => {
      const { error } = await newAnonClient().auth.resetPasswordForEmail(control.email);
      assertOutcome("control resetPasswordForEmail", error, false);
    });

    it("mfa.enroll（啟用 MFA 路徑不受 auth.mfa_factors 觸發器影響）", async () => {
      const { client } = await signIn(control);
      const { error } = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: "demolock-control" });
      assertOutcome("control mfa.enroll", error, false);
      const { data } = await admin.auth.admin.mfa.listFactors({ userId: control.id });
      expect(data?.factors.length).toBe(1);
    });

    it("admin.updateUserById({ password })", async () => {
      const next = randomPassword();
      const { error } = await admin.auth.admin.updateUserById(control.id, { password: next });
      assertOutcome("control admin updateUserById({ password })", error, false);
      control.password = next;
      expect(await loginWorks(control.email, control.password)).toBe(true);
    });
  });
});

// demo_revoke_sessions 依賴「恰好 1 個 is_demo 帳戶」，所以每個案例自己建立帳號、結束就清除，
// 且在前一個 describe 的 afterAll 清除之後才開始（vitest 依檔案順序執行 describe）。
// 若專案裡已有真實 Demo 帳戶（TASK-099 之後），「0 個」「剛好 1 個」兩案例會略過，不碰真實帳戶。
describe.skipIf(!lockActive)("demo_revoke_sessions()", () => {
  let preexistingDemo = 0;

  beforeAll(async () => {
    await deleteAllTestUsers();
    preexistingDemo = await countPreexistingDemoAccounts();
  }, 60000);

  afterEach(async () => {
    await deleteAllTestUsers();
  }, 60000);

  afterAll(async () => {
    await deleteAllTestUsers();
  }, 60000);

  it("anon 與 authenticated 不可執行", async () => {
    const control = await createTestUser("control");
    const anonResult = await newAnonClient().rpc("demo_revoke_sessions");
    expect(anonResult.error?.code, "anon").toBe("42501");

    const { client } = await signIn(control);
    const authResult = await client.rpc("demo_revoke_sessions");
    expect(authResult.error?.code, "authenticated").toBe("42501");
    await client.auth.signOut({ scope: "local" });
  });

  it("0 個 is_demo 帳戶：必定失敗", async (ctx) => {
    if (preexistingDemo > 0) ctx.skip();
    const control = await createTestUser("control");
    const { client } = await signIn(control);

    const { error } = await admin.rpc("demo_revoke_sessions");
    expect(error?.message).toContain("expected exactly 1 demo account, found 0");
    expect((await client.auth.refreshSession()).error, "非 Demo 帳號的 session 不受影響").toBeNull();
  });

  it("剛好 1 個 is_demo 帳戶：刪除其全部 session，其他帳號不受影響", async (ctx) => {
    if (preexistingDemo > 0) ctx.skip();
    const demo = await createTestUser("demo");
    const control = await createTestUser("control");
    const demoSessionA = await signIn(demo);
    const demoSessionB = await signIn(demo);
    const controlSession = await signIn(control);

    const { data, error } = await admin.rpc("demo_revoke_sessions");
    expect(error).toBeNull();
    expect(data, "刪除的 session 數").toBe(2);

    expect((await demoSessionA.client.auth.refreshSession()).error, "Demo session A 已失效").not.toBeNull();
    expect((await demoSessionB.client.auth.refreshSession()).error, "Demo session B 已失效").not.toBeNull();
    expect((await controlSession.client.auth.refreshSession()).error, "對照組 session 不受影響").toBeNull();
    expect(await loginWorks(demo.email, demo.password), "Demo 帳號本身仍可重新登入").toBe(true);
  });

  it("2 個以上 is_demo 帳戶：必定失敗且不刪任何 session", async () => {
    const demoOne = await createTestUser("demo");
    const demoTwo = await createTestUser("demo");
    const sessionOne = await signIn(demoOne);
    const sessionTwo = await signIn(demoTwo);

    const { error } = await admin.rpc("demo_revoke_sessions");
    expect(error?.message).toContain(`expected exactly 1 demo account, found ${preexistingDemo + 2}`);

    expect((await sessionOne.client.auth.refreshSession()).error, "Demo 1 的 session 仍有效").toBeNull();
    expect((await sessionTwo.client.auth.refreshSession()).error, "Demo 2 的 session 仍有效").toBeNull();
  });
});
