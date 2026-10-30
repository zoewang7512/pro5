// TASK-099（Demo 體驗帳戶）：對真實 Supabase 專案執行的整合測試，驗證 scripts/seed-demo-account.mjs
// 的建立、冪等、拒絕轉換非 Demo 帳戶、與 DESIGNER_EMAIL 衝突檢查、MFA factor 清除、輸出不含密碼。
//
// 不放進預設 `npm test`，只透過 `npm run test:seed-demo-account` 執行（缺設定時直接噴錯，不略過）。
//
// 只建立與刪除自己的拋棄式帳號（Email 以 __test__seeddemo- 開頭，且在 resend.dev 網域，不可能命中真實帳號）；
// 不用也不修改真正的 Demo 帳戶；對 designer001 只做唯讀快照比對（測試前後 updated_at、admins 列一致）。
// 腳本以子程序執行，DEMO_EMAIL／DEMO_PASSWORD 只經由子程序的環境變數傳入，不會出現在 shell 歷史。
import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const designerEmail = process.env.DESIGNER_EMAIL;

if (!url || !anonKey || !serviceRoleKey || !designerEmail) {
  throw new Error(
    "[seed-demo-account.integration.test] 缺少 NEXT_PUBLIC_SUPABASE_URL／NEXT_PUBLIC_SUPABASE_ANON_KEY／" +
      "SUPABASE_SERVICE_ROLE_KEY／DESIGNER_EMAIL，請確認 .env.local 已填妥。",
  );
}

const DISPLAY_NAME = "Demo帳號";
const TEST_EMAIL_PATTERN = /^__test__seeddemo-/i;
const clientOptions = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(url, serviceRoleKey, clientOptions);
const newAnonClient = () => createClient(url, anonKey, clientOptions);

const randomPassword = () => randomBytes(24).toString("hex"); // 48 字元
const newTestEmail = () => `__test__seeddemo-${randomUUID().slice(0, 8)}@resend.dev`;

type ScriptResult = { status: number | null; output: string };

function runSeedScript(env: Record<string, string | undefined>): ScriptResult {
  const childEnv = { ...process.env, ...env };
  // 沒指定的 DEMO_* 一律移除，避免吃到外層環境（例如 .env.local）的值。
  for (const key of ["DEMO_EMAIL", "DEMO_PASSWORD"]) {
    if (!(key in env)) delete childEnv[key];
  }
  const result = spawnSync(process.execPath, ["scripts/seed-demo-account.mjs"], {
    env: childEnv,
    encoding: "utf8",
    timeout: 60000,
  });
  return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

async function listUsers() {
  const found = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`列出使用者失敗：${error.message}`);
    found.push(...data.users);
    if (data.users.length < 200) break;
  }
  return found;
}

async function findUser(email: string) {
  return (await listUsers()).find((u) => u.email?.toLowerCase() === email.toLowerCase());
}

async function adminRows(userId: string) {
  const { data, error } = await admin.from("admins").select("user_id, display_name, avatar_url").eq("user_id", userId);
  if (error) throw new Error(`查詢 admins 失敗：${error.message}`);
  return data ?? [];
}

async function adminCount() {
  const { count, error } = await admin.from("admins").select("user_id", { count: "exact", head: true });
  if (error) throw new Error(`計算 admins 失敗：${error.message}`);
  return count ?? 0;
}

// 只清除 Email 符合拋棄式樣式的帳號（先刪 admins 列，再刪使用者），全部嘗試後統一回報。
async function deleteAllTestUsers() {
  const mine = (await listUsers()).filter((u) => u.email && TEST_EMAIL_PATTERN.test(u.email));
  const failures: string[] = [];
  for (const user of mine) {
    const { error: adminError } = await admin.from("admins").delete().eq("user_id", user.id);
    if (adminError) failures.push(`admins ${user.id}：${adminError.message}`);
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) failures.push(`${user.id}：${error.message}`);
  }
  if (failures.length > 0) throw new Error(`清除拋棄式帳號失敗：${failures.join("；")}`);
  const remaining = (await listUsers()).filter((u) => u.email && TEST_EMAIL_PATTERN.test(u.email));
  if (remaining.length > 0) throw new Error(`清除後仍殘留 ${remaining.length} 個拋棄式帳號`);
}

async function designerSnapshot() {
  const user = await findUser(designerEmail as string);
  if (!user) throw new Error("找不到 DESIGNER_EMAIL 對應的帳號");
  return {
    id: user.id,
    updated_at: user.updated_at,
    last_sign_in_at: user.last_sign_in_at,
    app_metadata: user.app_metadata,
    adminRows: await adminRows(user.id),
  };
}

async function loginWorks(email: string, password: string) {
  const { error } = await newAnonClient().auth.signInWithPassword({ email, password });
  if (error === null) return true;
  if (error.code === "invalid_credentials") return false;
  throw new Error(`登入檢查遇到非預期錯誤（${error.code ?? error.status}）：${error.message}`);
}

describe("seed:demo-account 腳本", () => {
  let designerBefore: Awaited<ReturnType<typeof designerSnapshot>>;

  beforeAll(async () => {
    await deleteAllTestUsers(); // 清掉先前中斷留下的殘留
    designerBefore = await designerSnapshot();
  }, 60000);

  afterAll(async () => {
    await deleteAllTestUsers();
  }, 60000);

  describe("建立與冪等", () => {
    const email = newTestEmail();
    const password = randomPassword();
    let userId: string;

    it("第一次執行：建立帳戶、標記 is_demo、登記 admins、顯示名稱", async () => {
      const result = runSeedScript({ DEMO_EMAIL: email, DEMO_PASSWORD: password });
      expect(result.status, result.output).toBe(0);

      const user = await findUser(email);
      expect(user, "帳戶已建立").toBeDefined();
      userId = (user as { id: string }).id;
      expect(user?.app_metadata?.is_demo).toBe(true);
      expect(user?.email_confirmed_at, "Email 已確認").toBeTruthy();

      const rows = await adminRows(userId);
      expect(rows).toHaveLength(1);
      expect(rows[0].display_name).toBe(DISPLAY_NAME);

      expect(await loginWorks(email, password), "可用 DEMO_PASSWORD 登入").toBe(true);
    });

    it("輸出與 stderr 不含密碼、service role key", () => {
      const result = runSeedScript({ DEMO_EMAIL: email, DEMO_PASSWORD: password });
      expect(result.status, result.output).toBe(0);
      expect(result.output).not.toContain(password);
      expect(result.output).not.toContain(serviceRoleKey as string);
      expect(result.output).toContain("公開");
    });

    it("連跑第二次：不報錯、不重複、帳戶未被修改", async () => {
      // 登入會更新 updated_at，所以在第二次執行前才取基準。
      const before = await findUser(email);
      const result = runSeedScript({ DEMO_EMAIL: email, DEMO_PASSWORD: randomPassword() }); // 換密碼也不應生效
      expect(result.status, result.output).toBe(0);

      const matches = (await listUsers()).filter((u) => u.email?.toLowerCase() === email.toLowerCase());
      expect(matches).toHaveLength(1);
      expect(matches[0].updated_at).toBe(before?.updated_at);
      expect(await adminRows(userId)).toHaveLength(1);
      expect(await loginWorks(email, password), "既有帳戶的密碼不被改").toBe(true);
    });

    it("顯示名稱被改掉時，重跑會校正，且只動這一列", async () => {
      const before = await adminCount();
      const { error } = await admin.from("admins").update({ display_name: "別的名字" }).eq("user_id", userId);
      expect(error).toBeNull();

      const result = runSeedScript({ DEMO_EMAIL: email, DEMO_PASSWORD: password });
      expect(result.status, result.output).toBe(0);
      expect((await adminRows(userId))[0].display_name).toBe(DISPLAY_NAME);
      expect(await adminCount()).toBe(before);
    });

    it("admins 登記被移除時，重跑會補登記", async () => {
      const { error } = await admin.from("admins").delete().eq("user_id", userId);
      expect(error).toBeNull();

      const result = runSeedScript({ DEMO_EMAIL: email, DEMO_PASSWORD: password });
      expect(result.status, result.output).toBe(0);
      const rows = await adminRows(userId);
      expect(rows).toHaveLength(1);
      expect(rows[0].display_name).toBe(DISPLAY_NAME);
    });
  });

  describe("拒絕：已存在但不是 Demo 的帳戶", () => {
    it("中止，帳戶、密碼與 admins 都未被修改", async () => {
      const email = newTestEmail();
      const password = randomPassword();
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      expect(error).toBeNull();
      const userId = data.user?.id as string;
      const before = await findUser(email);
      const adminsBefore = await adminCount();

      const result = runSeedScript({ DEMO_EMAIL: email, DEMO_PASSWORD: randomPassword() });
      expect(result.status).toBe(1);
      expect(result.output).toContain("不是 Demo 帳戶");

      const after = await findUser(email);
      expect(after?.app_metadata?.is_demo, "沒有被轉成 Demo").toBeUndefined();
      expect(after?.updated_at).toBe(before?.updated_at);
      expect(await adminRows(userId)).toHaveLength(0);
      expect(await adminCount()).toBe(adminsBefore);
      expect(await loginWorks(email, password), "原密碼仍可登入").toBe(true);
    });
  });

  describe("拒絕：輸入檢查（資料庫沒有任何變更）", () => {
    it("DEMO_EMAIL 等於 DESIGNER_EMAIL（大小寫不同）時中止，未建立帳戶、admins 筆數不變", async () => {
      const email = newTestEmail();
      const adminsBefore = await adminCount();
      const usersBefore = (await listUsers()).length;

      const result = runSeedScript({
        DEMO_EMAIL: email.toUpperCase(),
        DEMO_PASSWORD: randomPassword(),
        DESIGNER_EMAIL: email,
      });
      expect(result.status).toBe(1);
      expect(result.output).toContain("DESIGNER_EMAIL");

      expect(await findUser(email)).toBeUndefined();
      expect((await listUsers()).length).toBe(usersBefore);
      expect(await adminCount()).toBe(adminsBefore);
    });

    it("DEMO_EMAIL 設成真正的 DESIGNER_EMAIL 時中止，designer001 不受影響", async () => {
      const result = runSeedScript({
        DEMO_EMAIL: (designerEmail as string).toUpperCase(),
        DEMO_PASSWORD: randomPassword(),
      });
      expect(result.status).toBe(1);
      expect(result.output).toContain("DESIGNER_EMAIL");

      const after = await designerSnapshot();
      expect(after).toEqual(designerBefore);
    });

    it("密碼少於 32 字元時中止，未建立帳戶", async () => {
      const email = newTestEmail();
      const result = runSeedScript({ DEMO_EMAIL: email, DEMO_PASSWORD: randomPassword().slice(0, 31) });
      expect(result.status).toBe(1);
      expect(result.output).toContain("32");
      expect(await findUser(email)).toBeUndefined();
    });

    it.each([
      ["缺 DEMO_EMAIL", { DEMO_PASSWORD: "x".repeat(40) }],
      ["缺 DEMO_PASSWORD", { DEMO_EMAIL: "__test__seeddemo-missing@resend.dev" }],
      ["缺 SUPABASE_SERVICE_ROLE_KEY", { DEMO_EMAIL: "__test__seeddemo-missing@resend.dev", DEMO_PASSWORD: "x".repeat(40), SUPABASE_SERVICE_ROLE_KEY: "" }],
    ])("%s 時中止", async (_label, env) => {
      const result = runSeedScript(env);
      expect(result.status).toBe(1);
      expect(await findUser("__test__seeddemo-missing@resend.dev")).toBeUndefined();
    });
  });

  describe("MFA factor", () => {
    it("既有 Demo 帳戶帶有 MFA factor 時，腳本刪除並提示", async () => {
      // Demo 帳戶被鎖定後無法註冊 MFA（TASK-100 觸發器），所以先以非 Demo 身分註冊，再用 admin API 標記為 Demo
      //（觸發器只對「舊列已是 Demo」生效，非 Demo → Demo 的標記動作不受影響）。
      const email = newTestEmail();
      const password = randomPassword();
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      expect(error).toBeNull();
      const userId = data.user?.id as string;

      const client = newAnonClient();
      const { error: signInError } = await client.auth.signInWithPassword({ email, password });
      expect(signInError).toBeNull();
      const { error: enrollError } = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: "seeddemo" });
      expect(enrollError).toBeNull();
      await client.auth.signOut({ scope: "local" });

      const marked = await admin.auth.admin.updateUserById(userId, { app_metadata: { is_demo: true } });
      expect(marked.error).toBeNull();
      const factorsBefore = await admin.auth.admin.mfa.listFactors({ userId });
      expect(factorsBefore.data?.factors).toHaveLength(1);

      const result = runSeedScript({ DEMO_EMAIL: email, DEMO_PASSWORD: randomPassword() });
      expect(result.status, result.output).toBe(0);
      expect(result.output).toContain("MFA factor，已全部刪除");

      const factorsAfter = await admin.auth.admin.mfa.listFactors({ userId });
      expect(factorsAfter.data?.factors).toHaveLength(0);
    });
  });

  it("designer001 的 auth.users 列與 admins 列在整個測試前後一致", async () => {
    expect(await designerSnapshot()).toEqual(designerBefore);
  });
});
