// TASK-111（Demo 體驗帳戶）：對真實 Supabase 專案執行的整合測試，驗證 scripts/disable-demo.mjs
// （npm run demo:disable／demo:enable）對「拋棄式 Demo 帳號」的實際效果。
//
// 不放進預設 `npm test`，只透過 `npm run test:demo-disable` 執行（缺設定時直接噴錯，不略過）。
//
// 做法：建立拋棄式 is_demo 帳號與拋棄式一般管理員（對照組），把真正的指令當子行程跑起來
// （DEMO_EMAIL 指到拋棄式帳號），再用另一條獨立路徑（匿名登入、is_admin()、refresh、admins 表）核對結果。
// 不讀取、登入或修改 designer001 與真實 Demo 帳戶；不做全域 signOut（只用 scope: "local"）。
//
// ★ 前提：正式庫目前沒有任何其他 is_demo 帳戶。指令要求「is_demo 帳戶剛好 1 個」（與 demo_revoke_sessions() 相同），
//   所以真實 Demo 帳戶建立之後（TASK-112）本測試無法再執行——此時它會直接丟錯並中止，不會去動真實帳戶。
//   之後的回歸由 tests/lib/demo-disable-script.test.ts（假 client）擔任。
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceRoleKey) {
  throw new Error(
    "[demo-disable.integration.test] 缺少 NEXT_PUBLIC_SUPABASE_URL／NEXT_PUBLIC_SUPABASE_ANON_KEY／" +
      "SUPABASE_SERVICE_ROLE_KEY，請確認 .env.local 已填妥。",
  );
}

const SCRIPT = path.resolve(__dirname, "..", "scripts", "disable-demo.mjs");
const clientOptions = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(url, serviceRoleKey, clientOptions);
const newAnonClient = () => createClient(url, anonKey, clientOptions);
const randomPassword = () => `${randomUUID()}${randomUUID().slice(0, 8)}aA1!`;
const isMine = (u: { app_metadata?: Record<string, unknown>; email?: string }) =>
  u.app_metadata?.demoswitch_test === true && Boolean(u.email?.includes("demoswitch"));

type TestUser = { id: string; email: string; password: string };

async function listAllUsers() {
  const found = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`列出使用者失敗：${error.message}`);
    found.push(...data.users);
    if (data.users.length < 200) break;
  }
  return found;
}

async function createUser(kind: "demo" | "demo2" | "control"): Promise<TestUser> {
  const email = `delivered+demoswitch-${kind}-${randomUUID().slice(0, 8)}@resend.dev`;
  const password = randomPassword();
  const isDemo = kind !== "control";
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: isDemo ? { demoswitch_test: true, is_demo: true } : { demoswitch_test: true },
  });
  if (error || !data.user) throw new Error(`建立 ${kind} 拋棄式帳號失敗：${error?.message ?? "沒有回傳使用者"}`);
  return { id: data.user.id, email, password };
}

async function deleteAllTestUsers() {
  const failures: string[] = [];
  for (const user of (await listAllUsers()).filter(isMine)) {
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) failures.push(`${user.id}：${error.message}`);
  }
  if (failures.length > 0) throw new Error(`清除拋棄式帳號失敗：${failures.join("；")}`);
  const remaining = (await listAllUsers()).filter(isMine);
  if (remaining.length > 0) throw new Error(`清除後仍殘留 ${remaining.length} 個拋棄式帳號`);
}

// 指令是 ESM 腳本，當成獨立子行程執行，與使用者實際在終端機下的 npm run 走同一份程式碼。
function runScript(args: string[], demoEmail: string) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    env: { ...process.env, DEMO_EMAIL: demoEmail },
    encoding: "utf8",
    timeout: 60_000,
  });
  return { status: result.status, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

async function adminsRow(userId: string) {
  const { data, error } = await admin.from("admins").select("user_id, display_name").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`查詢 admins 失敗：${error.message}`);
  return data;
}

async function bannedUntil(userId: string) {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data.user) throw new Error(`讀取帳戶失敗：${error?.message}`);
  return data.user.banned_until ?? null;
}

describe("demo:disable／demo:enable 對拋棄式 Demo 帳號實測", () => {
  let demo: TestUser;
  let control: TestUser;
  let session: { access_token: string; refresh_token: string };
  let adminsCountBefore = 0;

  beforeAll(async () => {
    const all = await listAllUsers();
    const foreignDemo = all.filter((u) => u.app_metadata?.is_demo === true && !isMine(u));
    if (foreignDemo.length > 0) {
      throw new Error(
        "正式庫已有真實 Demo 帳戶（is_demo）。本測試要求 is_demo 帳戶剛好 1 個（拋棄式帳號），已中止，沒有動任何帳戶。",
      );
    }
    await deleteAllTestUsers();
    adminsCountBefore = (await admin.from("admins").select("user_id", { count: "exact", head: true })).count ?? 0;

    demo = await createUser("demo");
    control = await createUser("control");
    for (const [user, name] of [
      [demo, "__TEST__demoswitch-demo"],
      [control, "__TEST__demoswitch-control"],
    ] as const) {
      const { error } = await admin.from("admins").insert({ user_id: user.id, display_name: name });
      if (error) throw new Error(`登記 admins 失敗：${error.message}`);
    }

    const anon = newAnonClient();
    const signedIn = await anon.auth.signInWithPassword({ email: demo.email, password: demo.password });
    if (signedIn.error || !signedIn.data.session) throw new Error(`拋棄式 Demo 登入失敗：${signedIn.error?.message}`);
    session = {
      access_token: signedIn.data.session.access_token,
      refresh_token: signedIn.data.session.refresh_token,
    };
  });

  afterAll(async () => {
    await deleteAllTestUsers();
    const after = (await admin.from("admins").select("user_id", { count: "exact", head: true })).count ?? 0;
    expect(after).toBe(adminsCountBefore);
  });

  const isAdminWith = async (accessToken: string) => {
    const client = createClient(url, anonKey, {
      ...clientOptions,
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    const { data, error } = await client.rpc("is_admin");
    if (error) throw new Error(`is_admin 呼叫失敗：${error.message}`);
    return data === true;
  };

  it("前置：拋棄式 Demo 的 session 目前是管理員", async () => {
    expect(await isAdminWith(session.access_token)).toBe(true);
  });

  it("沒有 --yes：只預覽，什麼都不會變", async () => {
    const result = runScript(["--disable"], demo.email);
    expect(result.status).toBe(0);
    expect(result.out).toContain("預覽");
    expect(await adminsRow(demo.id)).not.toBeNull();
    expect(await bannedUntil(demo.id)).toBeNull();
    expect(await isAdminWith(session.access_token)).toBe(true);
  });

  it("DEMO_EMAIL 與找到的帳戶不同 → 中止，沒有任何變更", async () => {
    const result = runScript(["--disable", "--yes"], "somebody-else@example.invalid");
    expect(result.status).toBe(1);
    expect(await adminsRow(demo.id)).not.toBeNull();
    expect(await bannedUntil(demo.id)).toBeNull();
  });

  it("出現第二個 Demo 帳戶 → 中止，不猜要動哪個，兩個都沒有變更", async () => {
    const second = await createUser("demo2");
    try {
      const result = runScript(["--disable", "--yes"], demo.email);
      expect(result.status).toBe(1);
      expect(result.out).toContain("2 個");
      expect(await adminsRow(demo.id)).not.toBeNull();
      expect(await bannedUntil(demo.id)).toBeNull();
      expect(await bannedUntil(second.id)).toBeNull();
    } finally {
      await admin.auth.admin.deleteUser(second.id);
    }
  });

  it("--disable --yes：admins 被刪、立即失去管理權限、refresh 失效、無法再登入；對照組不受影響", async () => {
    const result = runScript(["--disable", "--yes"], demo.email);
    expect(result.out).toContain("完成");
    expect(result.status).toBe(0);
    expect(result.out).not.toContain(demo.password);

    expect(await adminsRow(demo.id)).toBeNull();
    expect(await bannedUntil(demo.id)).not.toBeNull();

    // 舊的 access token 還沒過期，但 is_admin() 每次重新判斷 → 立即失去管理權限。
    expect(await isAdminWith(session.access_token)).toBe(false);

    // session 已被撤銷：refresh 失敗。
    const refreshed = await newAnonClient().auth.refreshSession({ refresh_token: session.refresh_token });
    expect(refreshed.error).not.toBeNull();
    expect(refreshed.data.session).toBeNull();

    // 被封鎖：密碼對也登入不了。
    const retry = await newAnonClient().auth.signInWithPassword({ email: demo.email, password: demo.password });
    expect(retry.error).not.toBeNull();
    expect(retry.data.session).toBeNull();

    // 對照組（非 Demo 的一般管理員）完全沒被動到。
    expect(await adminsRow(control.id)).toMatchObject({ display_name: "__TEST__demoswitch-control" });
    expect(await bannedUntil(control.id)).toBeNull();
  });

  it("可重複執行：已關閉狀態再關一次仍成功", async () => {
    const result = runScript(["--disable", "--yes"], demo.email);
    expect(result.status).toBe(0);
    expect(await adminsRow(demo.id)).toBeNull();
  });

  it("--enable 沒有 --yes：只預覽，仍是關閉狀態", async () => {
    const result = runScript(["--enable"], demo.email);
    expect(result.status).toBe(0);
    expect(result.out).toContain("預覽");
    expect(await adminsRow(demo.id)).toBeNull();
    expect(await bannedUntil(demo.id)).not.toBeNull();
  });

  it("--enable --yes：解除封鎖、重新登記 admins、可再登入且是管理員", async () => {
    const result = runScript(["--enable", "--yes"], demo.email);
    expect(result.status).toBe(0);
    expect(result.out).not.toContain(demo.password);

    expect(await adminsRow(demo.id)).toMatchObject({ display_name: "Demo帳號" });
    expect(await bannedUntil(demo.id)).toBeNull();

    const anon = newAnonClient();
    const signedIn = await anon.auth.signInWithPassword({ email: demo.email, password: demo.password });
    expect(signedIn.error).toBeNull();
    expect(await isAdminWith(signedIn.data.session!.access_token)).toBe(true);
    await anon.auth.signOut({ scope: "local" });

    // 舊 session 在關閉時已被撤銷，恢復不會讓它復活。
    const old = await newAnonClient().auth.refreshSession({ refresh_token: session.refresh_token });
    expect(old.error).not.toBeNull();
  });
});
