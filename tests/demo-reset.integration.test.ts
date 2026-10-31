// TASK-108（Demo 體驗帳戶）：對真實 Supabase 專案執行的整合測試，驗證 0024_demo_reset.sql 的
// reset_demo_data 與 demo_list_storage_objects。
//
// ★★ 這是整個 Epic 最危險的測試：reset_demo_data 真實執行會清空並覆寫正式資料。
// 本檔**只准 dry-run**：呼叫 reset_demo_data 的地方只有 callReset 這一個輔助函式，其 dryRun 參數型別是
// `true | null | "omitted"`（編譯期就不能傳 false），且 tests/lib/demo-reset-test-scan.test.ts 會掃描原始碼。
// 傳 null 與不傳會在守門（或 PostgREST 找不到函式）就失敗，不會執行任何寫入。
// 絕不對正式庫做真實還原（TASK-112 才經使用者明確同意並備份後執行一次）。
//
// 不放進預設 `npm test`，只透過 `npm run test:demo-reset` 執行（缺設定時直接噴錯，不略過）。
//
// Demo 帳戶：若正式庫已有一個 is_demo 帳戶就直接使用（不修改它）；沒有就建立一個拋棄式 is_demo 帳戶
// （app_metadata.demoreset_test = true、Email 含 demoreset，雙重條件才會被清除）並暫時登記進 admins，用完刪除。
// 另建一個登記進 admins 的非 Demo 拋棄式帳號與一個一般帳號，驗證權限。登出只用 scope: "local"。
// 不讀取、登入或修改 designer001。
//
// 資料不變的證據：每次 dry-run 與每個失敗案例前後，對 13 張相關表做 select *（含 designer001 的 admins 列與
// audit_log 其他列）並逐字比對。
//
// 回滾驗證：套用 0024_demo_reset_down.sql 後，所有案例都應該失敗（函式不存在）。
import { createHash, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import baseJson from "../lib/demo/seed-base.json";
import { buildDemoSeed } from "../lib/demo/seed-data";
import type { DemoSeedBase, DemoSeedPayload } from "../lib/demo/seed-types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceRoleKey) {
  throw new Error(
    "[demo-reset.integration.test] 缺少 NEXT_PUBLIC_SUPABASE_URL／NEXT_PUBLIC_SUPABASE_ANON_KEY／" +
      "SUPABASE_SERVICE_ROLE_KEY，請確認 .env.local 已填妥。",
  );
}

const clientOptions = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(url, serviceRoleKey, clientOptions);
const anon = createClient(url, anonKey, clientOptions);

const base = baseJson as unknown as DemoSeedBase;
const TABLES = [
  "services",
  "designers",
  "designer_services",
  "designer_leaves",
  "designer_portfolio_images",
  "business_hours",
  "closed_dates",
  "booking_policy",
  "store_settings",
  "appointments",
  "customers",
  "audit_log",
  "admins",
] as const;

const STORAGE_BUCKETS = ["store-assets", "designer-assets", "admin-assets", "demo-seed"] as const;

// ★ 唯一呼叫 reset_demo_data 的地方。dryRun 的型別不含 false。
type DryRun = true | null | "omitted";
async function callReset(payload: unknown, dryRun: DryRun = true, client: SupabaseClient = admin) {
  // 執行期護欄：掃描與型別檢查都能被 as never／字串寫法繞過，這道不能。只接受 true、null、"omitted"。
  if (dryRun !== true && dryRun !== null && dryRun !== "omitted") {
    throw new Error("callReset 只允許 dry-run（true）；絕不對正式庫做真實還原");
  }
  const params: Record<string, unknown> = { p_payload: payload };
  if (dryRun !== "omitted") params.p_dry_run = dryRun;
  return client.rpc("reset_demo_data", params);
}

// 13 張 public 表逐列 + auth.users（函式不得碰）+ 四個 bucket 的物件清單（名稱、大小、eTag）。
// 每列只保留 sha256，比對失敗時輸出的是雜湊而不是顧客個資或 access_token。
// 讀到的列數必須等於總數，否則（例如被 PostgREST 的 max_rows 截斷）直接失敗，不拿截斷的結果比對。
// 不是原子快照：請單獨執行，不要與其他對同一正式庫的測試或真人操作同時進行。
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
async function snapshotAll(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const table of TABLES) {
    const { data, error, count } = await admin.from(table).select("*", { count: "exact" }).limit(5000);
    if (error) throw new Error(`讀取 ${table} 失敗：${error.message}`);
    if ((data ?? []).length !== count) {
      throw new Error(`${table}：讀到 ${data?.length} 列但總數是 ${count}，快照不完整（可能被 max_rows 截斷）`);
    }
    out[table] = (data ?? []).map((row) => sha256(JSON.stringify(row))).sort().join("\n");
  }
  out["auth.users"] = (await listAllUsers())
    .map((u) =>
      sha256(JSON.stringify({ id: u.id, email: u.email, updated_at: u.updated_at, last_sign_in_at: u.last_sign_in_at, app_metadata: u.app_metadata })),
    )
    .sort()
    .join("\n");
  for (const bucket of STORAGE_BUCKETS) {
    const { data, error } = await admin.rpc("demo_list_storage_objects", { p_bucket: bucket });
    if (error) throw new Error(`列出 ${bucket} 失敗：${error.message}`);
    out[`storage:${bucket}`] = (data as { name: string; size: number; etag: string }[])
      .map((o) => `${o.name}|${o.size}|${o.etag}`)
      .sort()
      .join("\n");
  }
  return out;
}

async function counts(): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const table of TABLES) {
    const { count, error } = await admin.from(table).select("*", { count: "exact", head: true });
    if (error) throw new Error(`計數 ${table} 失敗：${error.message}`);
    result[table] = count ?? 0;
  }
  return result;
}

type TestUser = { id: string; email: string; password: string };

async function createTestUser(label: string, appMetadata: Record<string, unknown> = {}): Promise<TestUser> {
  const email = `delivered+demoreset-${label}-${randomUUID().slice(0, 8)}@resend.dev`;
  const password = `${randomUUID()}${randomUUID().slice(0, 8)}aA1!`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { demoreset_test: true, ...appMetadata },
    user_metadata: { name: `__TEST__demoreset-${label}` },
  });
  if (error || !data.user) throw new Error(`建立 ${label} 拋棄式帳號失敗：${error?.message ?? "沒有回傳使用者"}`);
  return { id: data.user.id, email, password };
}

async function registerAsAdmin(user: TestUser) {
  const { error } = await admin.from("admins").insert({ user_id: user.id, display_name: "__TEST__demoreset" });
  if (error) throw new Error(`登記 admins 失敗：${error.message}`);
}

async function signedInClient(user: TestUser): Promise<SupabaseClient> {
  const client = createClient(url!, anonKey!, clientOptions);
  const { error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error) throw new Error(`拋棄式帳號登入失敗：${error.message}`);
  return client;
}

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

const isTestUser = (u: { app_metadata?: Record<string, unknown>; email?: string }) =>
  u.app_metadata?.demoreset_test === true && u.email?.includes("demoreset") === true;

let realDemoExists = false;
let demoUserId: string | null = null; // 用來比對的 Demo 帳戶 id（真實的或拋棄式的）
let throwawayDemo: TestUser | null = null;
let adminUser: TestUser | null = null;
let plainUser: TestUser | null = null;
let adminClient: SupabaseClient | null = null;
let plainClient: SupabaseClient | null = null;
const extraDemoUsers: TestUser[] = [];
let payload: DemoSeedPayload;

beforeAll(async () => {
  payload = buildDemoSeed(new Date(), base);

  // 清掉上次異常中斷留下的拋棄式帳號（admins 列隨 on delete cascade 一併刪除）。
  for (const user of (await listAllUsers()).filter(isTestUser)) {
    await admin.from("admins").delete().eq("user_id", user.id);
    await admin.auth.admin.deleteUser(user.id);
  }

  const realDemos = (await listAllUsers()).filter((u) => u.app_metadata?.is_demo === true && !isTestUser(u));
  if (realDemos.length > 1) throw new Error("正式庫有多個 is_demo 帳戶，無法測試（reset_demo_data 要求剛好 1 個）。");
  realDemoExists = realDemos.length === 1;
  if (realDemoExists) demoUserId = realDemos[0].id;

  adminUser = await createTestUser("admin");
  await registerAsAdmin(adminUser);
  adminClient = await signedInClient(adminUser);
  plainUser = await createTestUser("plain");
  plainClient = await signedInClient(plainUser);
}, 120000);

afterAll(async () => {
  const failures: string[] = [];
  for (const client of [adminClient, plainClient]) {
    try {
      await client?.auth.signOut({ scope: "local" });
    } catch (e) {
      failures.push(`登出：${(e as Error).message}`);
    }
  }
  const testActorIds = [adminUser, plainUser, throwawayDemo].filter((u): u is TestUser => u !== null).map((u) => u.id);
  if (testActorIds.length > 0) {
    const swept = await admin.from("audit_log").delete().in("actor_id", testActorIds);
    if (swept.error) failures.push(`清除測試稽核列：${swept.error.message}`);
  }
  for (const user of [adminUser, plainUser, throwawayDemo, ...extraDemoUsers]) {
    if (!user) continue;
    const removed = await admin.from("admins").delete().eq("user_id", user.id);
    if (removed.error) failures.push(`移除 admins 列 ${user.id}：${removed.error.message}`);
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) failures.push(`刪除拋棄式帳號 ${user.id}：${error.message}`);
  }
  if (failures.length > 0) throw new Error(`清除失敗，請手動處理：${failures.join("；")}`);
}, 120000);

// 沒有真實 Demo 帳戶時，建立一個拋棄式 is_demo 帳戶並登記進 admins。
// reset_demo_data 要求 payload 帶 demo_user_id（必填，與函式查到的 Demo 帳戶交叉檢查），所以一併寫進共用的 payload。
async function ensureDemoAccount() {
  if (!demoUserId) {
    throwawayDemo = await createTestUser("demo", { is_demo: true });
    await registerAsAdmin(throwawayDemo);
    demoUserId = throwawayDemo.id;
  }
  payload.demo_user_id = demoUserId;
}

async function expectUnchanged(action: () => Promise<void>) {
  const before = await snapshotAll();
  await action();
  expect(await snapshotAll()).toEqual(before);
}

describe("授權", () => {
  it("anon、一般登入帳號、已登記 admins 的非 Demo 帳號呼叫 reset_demo_data 都被拒絕（42501）", async () => {
    for (const client of [anon, plainClient!, adminClient!]) {
      const { data, error } = await callReset(payload, true, client);
      expect(error?.code).toBe("42501");
      expect(data).toBeNull();
    }
  });

  it("anon、一般登入帳號、已登記 admins 的帳號呼叫 demo_list_storage_objects 都被拒絕（42501）", async () => {
    for (const client of [anon, plainClient!, adminClient!]) {
      const { data, error } = await client.rpc("demo_list_storage_objects", { p_bucket: "demo-seed" });
      expect(error?.code).toBe("42501");
      expect(data).toBeNull();
    }
  });
});

describe("Demo 帳戶數量由函式自己決定", () => {
  it("沒有 is_demo 帳戶時失敗（資料不變）", async (ctx) => {
    // 正式庫已有真實 Demo 帳戶時無法構造「0 個」：標示為 skipped（不是 passed），並在驗證報告註明。
    if (realDemoExists) return ctx.skip();
    await expectUnchanged(async () => {
      const { data, error } = await callReset(payload);
      expect(data).toBeNull();
      expect(error?.message).toContain("expected exactly 1 demo account, found 0");
    });
  });

  it("有 2 個 is_demo 帳戶時失敗（資料不變）", async () => {
    await ensureDemoAccount();
    const second = await createTestUser("demo2", { is_demo: true });
    extraDemoUsers.push(second);
    await expectUnchanged(async () => {
      const { data, error } = await callReset(payload);
      expect(data).toBeNull();
      expect(error?.message).toContain("expected exactly 1 demo account, found 2");
    });
    expect((await admin.auth.admin.deleteUser(second.id)).error).toBeNull();
    extraDemoUsers.length = 0;
  });

  it("payload 的 demo_user_id 與查到的不同時失敗（資料不變）", async () => {
    await ensureDemoAccount();
    await expectUnchanged(async () => {
      const { data, error } = await callReset({ ...payload, demo_user_id: randomUUID() });
      expect(data).toBeNull();
      expect(error?.message).toContain("demo_user_id does not match");
    });
  });

  it("payload 沒帶 demo_user_id（必填）時失敗（資料不變）", async () => {
    await ensureDemoAccount();
    await expectUnchanged(async () => {
      const withoutId = { ...payload } as Record<string, unknown>;
      delete withoutId.demo_user_id;
      for (const bad of [withoutId, { ...payload, demo_user_id: null }, { ...payload, demo_user_id: 123 }]) {
        const { data, error } = await callReset(bad);
        expect(data).toBeNull();
        expect(error?.message).toContain("demo_user_id is required");
      }
    });
  });

  it("payload 帶正確的 demo_user_id 時通過交叉檢查", async () => {
    await ensureDemoAccount();
    const { data, error } = await callReset({ ...payload, demo_user_id: demoUserId });
    expect(error).toBeNull();
    expect(data.dry_run).toBe(true);
  });

  it("Demo 帳戶沒有登記在 admins 時失敗（只在拋棄式帳戶上測，不動真實 Demo 帳戶）", async (ctx) => {
    await ensureDemoAccount();
    if (!throwawayDemo) return ctx.skip();
    const removed = await admin.from("admins").delete().eq("user_id", throwawayDemo.id);
    expect(removed.error).toBeNull();
    try {
      await expectUnchanged(async () => {
        const { data, error } = await callReset(payload);
        expect(data).toBeNull();
        expect(error?.message).toContain("not registered in admins");
      });
    } finally {
      await registerAsAdmin(throwawayDemo);
    }
  });
});

describe("dry-run", () => {
  it("回傳各表筆數：寫入筆數等於 payload 各陣列長度，刪除筆數等於現況；資料完全不變", async () => {
    await ensureDemoAccount();
    const before = await snapshotAll();
    const beforeCounts = await counts();
    const { count: demoAuditCount } = await admin
      .from("audit_log")
      .select("*", { count: "exact", head: true })
      .eq("actor_id", demoUserId!);

    const started = Date.now();
    const { data, error } = await callReset(payload);
    const elapsed = Date.now() - started;
    expect(error).toBeNull();
    console.log(`[demo-reset] dry-run 耗時 ${elapsed} ms，payload 預約 ${payload.appointments.length} 筆`);

    expect(data.dry_run).toBe(true);
    expect(data.counts).toEqual({
      services: payload.services.length,
      designers: payload.designers.length,
      designer_services: payload.designer_services.length,
      designer_leaves: payload.designer_leaves.length,
      portfolio_images: payload.portfolio_images.length,
      business_hours: 7,
      closed_dates: payload.closed_dates.length,
      booking_policy: 1,
      store_settings: 1,
      customers: payload.customers.length,
      appointments: payload.appointments.length,
      admins: 1,
    });
    expect(data.deleted).toEqual({
      designer_services: beforeCounts.designer_services,
      designer_leaves: beforeCounts.designer_leaves,
      portfolio_images: beforeCounts.designer_portfolio_images,
      appointments: beforeCounts.appointments,
      customers: beforeCounts.customers,
      designers: beforeCounts.designers,
      services: beforeCounts.services,
      closed_dates: beforeCounts.closed_dates,
      business_hours: beforeCounts.business_hours,
      audit_log: demoAuditCount ?? 0, // 只計 Demo 帳戶的列
    });
    // 前置條件：整張表比 Demo 的列多（有非 Demo 的列可供保護）；Demo 專屬刪除另有下一個案例用實際寫入的稽核列驗證。
    expect(beforeCounts.audit_log).toBeGreaterThan(demoAuditCount ?? 0);
    expect(elapsed).toBeLessThan(15000);

    expect(await snapshotAll()).toEqual(before);
    expect(await counts()).toEqual(beforeCounts);
  });

  it("audit_log 只刪 Demo 帳戶的列：另一位管理員的稽核列不被計入、也不受影響", async (ctx) => {
    await ensureDemoAccount();
    if (!throwawayDemo) return ctx.skip(); // 真實 Demo 帳戶存在時不替它寫稽核列
    const demoClient = await signedInClient(throwawayDemo);
    const auditRow = (entityId: string) => ({
      event_type: "demoreset.test",
      entity_type: "demoreset",
      entity_id: entityId,
      summary: {},
      changes: {},
    });
    try {
      expect((await demoClient.from("audit_log").insert(auditRow("__TEST__demo-row"))).error).toBeNull();
      expect((await adminClient!.from("audit_log").insert(auditRow("__TEST__other-admin-row"))).error).toBeNull();

      const before = await snapshotAll();
      const { data, error } = await callReset(payload);
      expect(error).toBeNull();
      expect(data.deleted.audit_log).toBe(1);
      expect(await snapshotAll()).toEqual(before);
      const { count } = await admin.from("audit_log").select("*", { count: "exact", head: true }).eq("actor_id", adminUser!.id);
      expect(count).toBe(1);
    } finally {
      await demoClient.auth.signOut({ scope: "local" });
      await admin.from("audit_log").delete().in("actor_id", [throwawayDemo.id, adminUser!.id]);
    }
  });

  it("連跑兩次結果相同，資料仍然不變", async () => {
    await ensureDemoAccount();
    await expectUnchanged(async () => {
      const first = await callReset(payload);
      const second = await callReset(payload);
      expect(first.error).toBeNull();
      expect(second.error).toBeNull();
      expect(second.data).toEqual(first.data);
    });
  });

  // 只證明「不死鎖、不改資料」，不證明互斥（兩個 dry-run 可能被序列化而都成功）。鎖的互斥行為未驗證，列為殘留風險。
  it("同時兩個 dry-run：不死鎖，至少一個成功，另一個成功或明確因鎖失敗，資料不變", async () => {
    await ensureDemoAccount();
    await expectUnchanged(async () => {
      const [a, b] = await Promise.all([callReset(payload), callReset(payload)]);
      const results = [a, b];
      expect(results.some((r) => r.error === null)).toBe(true);
      for (const r of results) {
        if (r.error) expect(r.error.message).toMatch(/another reset is already running|lock timeout|deadlock/i);
      }
    });
  });
});

describe("守門：失敗一律不改資料", () => {
  const clone = () => JSON.parse(JSON.stringify(payload)) as Record<string, unknown> & DemoSeedPayload;

  it("空 payload、陣列、缺或錯的 confirm", async () => {
    await ensureDemoAccount();
    await expectUnchanged(async () => {
      for (const bad of [[], "RESET_DEMO", 123]) {
        const { data, error } = await callReset(bad);
        expect(data).toBeNull();
        expect(error?.message).toContain("payload must be a json object");
      }
      for (const bad of [{}, { ...clone(), confirm: undefined }, { ...clone(), confirm: "reset_demo" }, { ...clone(), confirm: "RESET_DEMO " }]) {
        const { data, error } = await callReset(bad);
        expect(data).toBeNull();
        expect(error?.message).toContain("missing or wrong confirm");
      }
      const nullPayload = await callReset(null);
      expect(nullPayload.error?.message).toContain("payload must be a json object");
    });
  });

  it("缺任一必要鍵都失敗", async () => {
    await ensureDemoAccount();
    await expectUnchanged(async () => {
      const keys = [
        "services",
        "designers",
        "designer_services",
        "designer_leaves",
        "portfolio_images",
        "business_hours",
        "closed_dates",
        "booking_policy",
        "store_settings",
        "customers",
        "appointments",
        "demo_admin_profile",
      ];
      const objectKeys = ["booking_policy", "store_settings", "demo_admin_profile"];
      for (const key of keys) {
        const bad = clone();
        delete bad[key];
        const { data, error } = await callReset(bad);
        expect(data, `缺 ${key}`).toBeNull();
        const expected =
          key === "business_hours" ? "exactly 7 rows" : objectKeys.includes(key) ? "must be json objects" : `${key} must be a json array`;
        expect(error?.message, `缺 ${key}`).toContain(expected);
      }
      // 型別錯誤（物件／字串代替陣列）。
      for (const key of ["services", "designer_leaves", "portfolio_images", "closed_dates"]) {
        for (const wrong of [{}, "x"]) {
          const bad = clone();
          bad[key] = wrong;
          expect((await callReset(bad)).error?.message, `${key} 型別錯誤`).toContain(`${key} must be a json array`);
        }
      }
    });
  });

  it("必要陣列低於最低筆數（空陣列）失敗", async () => {
    await ensureDemoAccount();
    await expectUnchanged(async () => {
      for (const key of ["services", "designers", "designer_services", "portfolio_images", "customers", "appointments"]) {
        const bad = clone();
        bad[key] = [];
        const { data, error } = await callReset(bad);
        expect(data, `${key} 為空`).toBeNull();
        expect(error?.message, `${key} 為空`).toContain("fewer than");
      }
    });
  });

  it("business_hours 不是 7 列或 weekday 重複失敗", async () => {
    await ensureDemoAccount();
    await expectUnchanged(async () => {
      const six = clone();
      six.business_hours = six.business_hours.slice(0, 6);
      const sixResult = await callReset(six);
      expect(sixResult.error?.message).toContain("exactly 7 rows");

      const dup = clone();
      dup.business_hours = dup.business_hours.map((row, i) => (i === 1 ? { ...row, weekday: 0 } : row));
      const dupResult = await callReset(dup);
      expect(dupResult.error?.message).toContain("weekday must be distinct");
    });
  });

  it("預約帶非 null 的 customer_email、帶 access_token、顧客帶 email 都失敗（還原不寄信）", async () => {
    await ensureDemoAccount();
    await expectUnchanged(async () => {
      const withEmail = clone();
      withEmail.appointments = withEmail.appointments.map((a, i) => (i === 0 ? ({ ...a, customer_email: "someone@example.com" } as unknown as typeof a) : a));
      expect((await callReset(withEmail)).error?.message).toContain("null customer_email");

      const withToken = clone();
      withToken.appointments = withToken.appointments.map((a, i) => (i === 0 ? { ...a, access_token: "abc" } : a));
      expect((await callReset(withToken)).error?.message).toContain("no access_token");

      const customerEmail = clone();
      customerEmail.customers = customerEmail.customers.map((c, i) => (i === 0 ? ({ ...c, email: "someone@example.com" } as unknown as typeof c) : c));
      expect((await callReset(customerEmail)).error?.message).toContain("customers must have null email");
    });
  });

  it("p_dry_run 傳 null 失敗；不傳（沒有預設值）失敗", async () => {
    await ensureDemoAccount();
    await expectUnchanged(async () => {
      const nullResult = await callReset(payload, null);
      expect(nullResult.data).toBeNull();
      expect(nullResult.error?.message).toContain("p_dry_run is required");

      const omitted = await callReset(payload, "omitted");
      expect(omitted.data).toBeNull();
      expect(omitted.error?.code).toBe("PGRST202");
    });
  });
});

describe("真實錯誤不被吞掉（dry-run 也一樣往外丟，資料不變）", () => {
  const clone = () => JSON.parse(JSON.stringify(payload)) as DemoSeedPayload;

  it("同一設計師重疊的預約違反 exclusion constraint（23P01）", async () => {
    await ensureDemoAccount();
    await expectUnchanged(async () => {
      const bad = clone();
      const [first] = bad.appointments.filter((a) => a.status !== "cancelled");
      bad.appointments.push({ ...first, id: randomUUID(), status: "confirmed" });
      const { data, error } = await callReset(bad);
      expect(data).toBeNull();
      expect(error?.code).toBe("23P01");
    });
  });

  it("違反 check constraint（設計師名稱為空）與外鍵（服務不存在）", async () => {
    await ensureDemoAccount();
    await expectUnchanged(async () => {
      const badName = clone();
      badName.designers[0].name = "";
      expect((await callReset(badName)).error?.code).toBe("23514");

      const badFk = clone();
      badFk.designer_services.push({ designer_id: badFk.designers[0].id, service_id: randomUUID() });
      expect((await callReset(badFk)).error?.code).toBe("23503");
    });
  });

  it("作品集超過 12 張被資料庫觸發器擋下", async () => {
    await ensureDemoAccount();
    await expectUnchanged(async () => {
      const bad = clone();
      const designerId = bad.designers[0].id;
      for (let i = 0; i < 13; i += 1) {
        const file = `${randomUUID()}.webp`;
        bad.portfolio_images.push({
          id: randomUUID(),
          designer_id: designerId,
          image_url: `https://example.invalid/portfolio/${designerId}/${file}`,
          storage_path: `portfolio/${designerId}/${file}`,
          created_at: new Date().toISOString(),
        });
      }
      const { data, error } = await callReset(bad);
      expect(data).toBeNull();
      expect(error?.message).toContain("PORTFOLIO_LIMIT");
    });
  });
});

describe("demo_list_storage_objects", () => {
  it("非白名單 bucket 與 null 被拒絕", async () => {
    for (const bucket of ["avatars", "storage", "", "STORE-ASSETS", null]) {
      const { data, error } = await admin.rpc("demo_list_storage_objects", { p_bucket: bucket });
      expect(data).toBeNull();
      expect(error?.message).toContain("bucket not allowed");
    }
  });

  it("demo-seed：含子目錄物件，欄位齊全，涵蓋 seed 引用的全部作品集路徑", async () => {
    const { data, error } = await admin.rpc("demo_list_storage_objects", { p_bucket: "demo-seed" });
    expect(error).toBeNull();
    const rows = data as { name: string; size: number; etag: string; created_at: string; owner_id: string | null }[];
    expect(rows.length).toBeGreaterThanOrEqual(base.portfolio_images.length);
    for (const row of rows) {
      expect(typeof row.name).toBe("string");
      expect(row.size).toBeGreaterThanOrEqual(0);
      expect(row.etag).toMatch(/^"?[0-9a-f]+/);
      expect(Date.parse(row.created_at)).not.toBeNaN();
      expect(row.owner_id === null || typeof row.owner_id === "string").toBe(true);
    }
    const names = new Set(rows.map((r) => r.name));
    for (const image of base.portfolio_images) expect(names.has(`designer-assets/${image.storage_path}`)).toBe(true);
    expect(rows.some((r) => r.name.split("/").length >= 3)).toBe(true);
  });

  it("三個公開 bucket 都能列出，且與 Storage API 的結果筆數一致", async () => {
    for (const bucket of ["store-assets", "designer-assets", "admin-assets"]) {
      const { data, error } = await admin.rpc("demo_list_storage_objects", { p_bucket: bucket });
      expect(error).toBeNull();
      const apiNames: string[] = [];
      const walk = async (prefix: string) => {
        const listed = await admin.storage.from(bucket).list(prefix, { limit: 1000 });
        expect(listed.error).toBeNull();
        for (const entry of listed.data ?? []) {
          const full = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.id === null) await walk(full);
          else apiNames.push(full);
        }
      };
      await walk("");
      expect((data as { name: string }[]).map((r) => r.name).sort()).toEqual(apiNames.sort());
    }
  });
});

// 重置閘門（真實還原的第二道門）。注意：這裡**不呼叫**真實還原來驗證「閘門關閉時被拒絕」——萬一閘門邏輯有 bug，
// 那一次呼叫就會真的清空正式庫。閘門檢查存在於 reset_demo_data 本文，由 0024 尾端自我檢查（pg_get_functiondef）把關；
// 這裡只測閘門函式本身，以及 dry-run 不受閘門影響也不消耗閘門。每個案例結束都確保閘門已關閉。
describe("重置閘門", () => {
  const isOpen = async () => {
    const { data, error } = await admin.rpc("demo_reset_gate_is_open");
    expect(error).toBeNull();
    return data as boolean;
  };
  const closeGate = async () => {
    const { error } = await admin.rpc("demo_reset_close_gate");
    expect(error).toBeNull();
  };

  it("anon、一般帳號、已登記 admins 的帳號都不能呼叫三個閘門函式（42501）", async () => {
    for (const client of [anon, plainClient!, adminClient!]) {
      for (const [fn, args] of [
        ["demo_reset_open_gate", { p_minutes: 5 }],
        ["demo_reset_close_gate", {}],
        ["demo_reset_gate_is_open", {}],
      ] as const) {
        const { data, error } = await client.rpc(fn, args);
        expect(error?.code, fn).toBe("42501");
        expect(data).toBeNull();
      }
    }
    expect(await isOpen()).toBe(false);
  });

  it("閘門資料表不授權給任何 Data API 角色（含 service_role 與 anon）", async () => {
    for (const client of [admin, anon, plainClient!, adminClient!]) {
      const { data, error } = await client.from("demo_reset_gate").select("*");
      expect(error).not.toBeNull();
      expect(data ?? []).toHaveLength(0);
    }
  });

  it("預設關閉；開啟後在期限內為開，關閉後為關；期限必須是 1～30 分鐘", async () => {
    try {
      await closeGate();
      expect(await isOpen()).toBe(false);

      for (const bad of [0, 31, -1, null]) {
        const { data, error } = await admin.rpc("demo_reset_open_gate", { p_minutes: bad });
        expect(data, String(bad)).toBeNull();
        expect(error?.message, String(bad)).toContain("p_minutes must be between 1 and 30");
      }
      expect(await isOpen()).toBe(false);

      const before = Date.now();
      const { data: until, error } = await admin.rpc("demo_reset_open_gate", { p_minutes: 5 });
      expect(error).toBeNull();
      const untilMs = Date.parse(until as string);
      expect(untilMs).toBeGreaterThan(before + 4 * 60 * 1000);
      expect(untilMs).toBeLessThan(Date.now() + 6 * 60 * 1000);
      expect(await isOpen()).toBe(true);

      await closeGate();
      expect(await isOpen()).toBe(false);
    } finally {
      await closeGate();
    }
  });

  it("dry-run 不受閘門影響，也不消耗閘門（閘門開著跑 dry-run，仍然開著）", async () => {
    await ensureDemoAccount();
    try {
      expect((await admin.rpc("demo_reset_open_gate", { p_minutes: 1 })).error).toBeNull();
      await expectUnchanged(async () => {
        const { error } = await callReset(payload);
        expect(error).toBeNull();
      });
      expect(await isOpen()).toBe(true);
    } finally {
      await closeGate();
    }
    expect(await isOpen()).toBe(false);
  });
});
