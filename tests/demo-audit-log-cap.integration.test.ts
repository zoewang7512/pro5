// TASK-122（Demo 體驗帳戶）：對真實 Supabase 專案執行的整合測試，驗證 0028_demo_audit_log_cap.sql：
//   Demo 體驗帳號（JWT app_metadata.is_demo）對 audit_log 的新增，在「該帳戶自己」的列數達 500 後被拒絕
//   （P0001／DEMO_ROW_CAP）；計數是每帳戶而非整張表（另一個帳戶的大量紀錄不佔 Demo 的額度）；
//   一般管理員不受影響；並行與多列單一 insert 也擋得住（硬上限）；另外驗證單筆大小（event_type 64 位元組）
//   與單一請求最多 20 列（審查後新增，限制單筆大小與「寫入後再中止」造成的膨脹）。
//
// 不放進預設 `npm test`，只透過 `npm run test:demo-audit-cap` 執行（缺設定時直接噴錯，不略過）。
//
// 只建立與刪除自己的拋棄式資料：
//   * 帳號：一位一般管理員、一位 Demo（app_metadata.is_demo = true），皆標記 app_metadata.auditcap_test = true、
//     Email 含 auditcap（雙重條件才會被清除），暫時登記進 admins。不碰 designer001 與真實 Demo 帳戶。
//   * 資料列：event_type 固定為 test.demo_audit_cap（真實程式不會寫這個事件），開頭與結尾都以 event_type 清除，
//     並比對前後 audit_log 總筆數相同（證明沒有留下或動到任何真實紀錄）。
//   * 登出：不呼叫 signOut（拋棄式帳號直接刪除）。
//   * audit_log 對 service_role 只有 select、delete（沒有 insert），所以資料列一律由拋棄式帳號自己用 REST 寫入。
//
// 若測試被中途中斷：再跑一次即可（beforeAll 會清掉殘留的拋棄式帳號與它們寫的列）；中斷期間系統內會殘留 is_demo 帳戶，
// 此時 Demo 還原函式／upload-demo-images／demo:disable 會拒絕執行，請儘快重跑或到 Authentication 手動刪除（Email 含 auditcap）。
// 注意：測試期間系統內會暫時多一個 is_demo 帳戶，此時 Demo 還原函式（0024）／demo_revoke_sessions／upload-demo-images 會因
// 「不是剛好 1 個 Demo 帳戶」而拒絕執行；開啟排程還原後，請避開台北 03:00–04:00 跑 test:*。
// 測試期間 /admin/audit-log 會短暫看到事件 test.demo_audit_cap 的紀錄（最多約 1000 筆），結束後即刪除。
//
// 兩種模式（驗收標準：套用 _down.sql 後行為恢復）：
//   預設（上限生效中）：npm run test:demo-audit-cap
//   套用 0028 之前，或套用 _down.sql 之後：
//     PowerShell  $env:DEMO_AUDIT_CAP_EXPECT="off"; npm run test:demo-audit-cap
//     Bash        DEMO_AUDIT_CAP_EXPECT=off npm run test:demo-audit-cap
//   off 模式下：Demo 超過 500 筆也能寫入（沒有上限）。鑑別力：每個「生效中被擋」的斷言在 off 模式都有對應的「沒被擋」斷言。
//
// 限流提醒：每輪 2 次密碼登入，Supabase 預設每 IP 每 5 分鐘 30 次。
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceRoleKey) {
  throw new Error(
    "[demo-audit-log-cap.integration.test] 缺少 NEXT_PUBLIC_SUPABASE_URL／NEXT_PUBLIC_SUPABASE_ANON_KEY／" +
      "SUPABASE_SERVICE_ROLE_KEY，請確認 .env.local 已填妥。",
  );
}

const capActive = process.env.DEMO_AUDIT_CAP_EXPECT !== "off";
const CAP = 500;
const MAX_ROWS_PER_REQUEST = 20;
const EVENT_TYPE = "test.demo_audit_cap";
const CAP_MESSAGE = `DEMO_ROW_CAP: audit_log (cap ${CAP})`;
const clientOptions = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(url, serviceRoleKey, clientOptions);

type TestUser = { id: string; email: string; client: SupabaseClient };

const row = () => ({ event_type: EVENT_TYPE, entity_type: "test", entity_id: "x", summary: { m: "auditcap" }, changes: {} });
const rows = (n: number) => Array.from({ length: n }, row);

async function countBy(actorId: string): Promise<number> {
  const { count, error } = await admin.from("audit_log").select("id", { count: "exact", head: true }).eq("actor_id", actorId);
  if (error || count === null) throw new Error(`計數失敗：${error?.message ?? "沒有回傳筆數"}`);
  return count;
}

async function countAll(): Promise<number> {
  const { count, error } = await admin.from("audit_log").select("id", { count: "exact", head: true });
  if (error || count === null) throw new Error(`計數 audit_log 失敗：${error?.message ?? "沒有回傳筆數"}`);
  return count;
}

async function deleteTestRows() {
  const { error } = await admin.from("audit_log").delete().eq("event_type", EVENT_TYPE);
  if (error) throw new Error(`清除 audit_log 測試列失敗：${error.message}`);
}

async function listTestUsers() {
  const found = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`列出使用者失敗：${error.message}`);
    found.push(...data.users);
    if (data.users.length < 200) break;
  }
  return found.filter((u) => u.app_metadata?.auditcap_test === true && u.email?.includes("auditcap"));
}

async function cleanup() {
  const users = await listTestUsers();
  const failures: string[] = [];
  // 依 actor_id 清除拋棄式帳號寫入的所有列（不論 event_type：長 event_type 等案例的列不符合固定事件名稱），再依事件名稱清掃殘留。
  for (const user of users) {
    const { error: rowsError } = await admin.from("audit_log").delete().eq("actor_id", user.id);
    if (rowsError) failures.push(`audit_log ${user.id}：${rowsError.message}`);
  }
  await deleteTestRows();
  for (const user of users) {
    const { error: adminsError } = await admin.from("admins").delete().eq("user_id", user.id);
    if (adminsError) failures.push(`admins ${user.id}：${adminsError.message}`);
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) failures.push(`${user.id}：${error.message}`);
  }
  if (failures.length > 0) throw new Error(`清除拋棄式帳號失敗：${failures.join("；")}`);
  const leftover = await listTestUsers();
  if (leftover.length > 0) throw new Error(`清除後仍殘留 ${leftover.length} 個拋棄式帳號`);
}

// forged：只在 user_metadata（使用者自己可寫）放 is_demo:true，app_metadata 沒有——真實 JWT 的偽造情境，必須被當成一般管理員。
async function createAdminUser(kind: "admin" | "demo" | "forged"): Promise<TestUser> {
  const email = `delivered+auditcap-${kind}-${randomUUID().slice(0, 8)}@resend.dev`;
  const password = `${randomUUID()}${randomUUID().slice(0, 8)}aA1!`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: kind === "demo" ? { auditcap_test: true, is_demo: true } : { auditcap_test: true },
    user_metadata: kind === "forged" ? { name: "__TEST__auditcap-forged", is_demo: true } : { name: `__TEST__auditcap-${kind}` },
  });
  if (error || !data.user) throw new Error(`建立 ${kind} 拋棄式帳號失敗：${error?.message ?? "沒有回傳使用者"}`);
  const { error: regError } = await admin.from("admins").insert({ user_id: data.user.id });
  if (regError) throw new Error(`登記 ${kind} 進 admins 失敗：${regError.message}`);
  const client = createClient(url!, anonKey!, clientOptions);
  const { data: signIn, error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError || !signIn.session) throw new Error(`登入 ${kind} 失敗：${signInError?.message ?? "沒有 session"}`);
  return { id: data.user.id, email, client };
}

// 讓某帳戶「恰好有 n 筆」：先刪光（service role），再由該帳戶自己分批補（每批 100 筆，補的過程不得超過上限）。
async function setRows(user: TestUser, n: number) {
  const { error: delError } = await admin.from("audit_log").delete().eq("actor_id", user.id);
  if (delError) throw new Error(`清除 ${user.id} 的測試列失敗：${delError.message}`);
  // Demo 單一請求最多 20 列（0028），所以每個請求 20 列、同時送出 5 個請求（鎖會讓它們排隊，總數仍是精確的）。
  const batches: number[] = [];
  for (let left = n; left > 0; left -= MAX_ROWS_PER_REQUEST) batches.push(Math.min(MAX_ROWS_PER_REQUEST, left));
  for (let i = 0; i < batches.length; i += 5) {
    const results = await Promise.all(batches.slice(i, i + 5).map((size) => user.client.from("audit_log").insert(rows(size))));
    for (const { error } of results) if (error) throw new Error(`補測試列失敗（${user.id}）：${error.message}`);
  }
  expect(await countBy(user.id)).toBe(n);
}

describe("Demo 的 audit_log 每帳戶筆數上限（0028）", () => {
  let demo: TestUser;
  let admin1: TestUser;
  let forged: TestUser;
  let baseline = 0;

  beforeAll(async () => {
    await cleanup(); // 前次中斷留下的殘留
    baseline = await countAll();
    console.info(`[demo-audit-log-cap] audit_log 真實筆數 ${baseline}（Demo 的額度與它無關：每帳戶計數）`);
    demo = await createAdminUser("demo");
    admin1 = await createAdminUser("admin");
    forged = await createAdminUser("forged");
  }, 120000);

  afterAll(async () => {
    await cleanup();
    // 若失敗：先確認測試期間沒有人在後台做真實操作（會讓筆數多 1）；否則代表測試留下了資料，請依 actor_id／event_type 查出並手動刪除。
    expect(await countAll(), "結尾筆數必須與開頭相同（不留下測試資料）").toBe(baseline);
    expect((await listTestUsers()).length).toBe(0);
  }, 120000);

  it("每帳戶計數：另一個帳戶已有大量紀錄，不佔 Demo 的額度；Demo 恰好寫到 500 筆", async () => {
    await setRows(admin1, 300); // 一般管理員的 300 筆（相當於 designer001 的紀錄長期累積）
    await setRows(demo, CAP); // Demo 仍能寫滿自己的 500 筆（整張表此時 ≥ 800 筆）
    expect(await countAll()).toBeGreaterThanOrEqual(baseline + 300 + CAP);
  });

  it("滿額時：Demo 新增被拒絕（P0001／DEMO_ROW_CAP），內容不變；一般管理員照常新增", async () => {
    await setRows(demo, CAP);
    const before = await countBy(demo.id);

    const { error } = await demo.client.from("audit_log").insert(row());
    if (capActive) {
      expect(error?.code).toBe("P0001");
      expect(error?.message).toBe(CAP_MESSAGE);
      expect(error?.hint ?? "").toContain("每日凌晨會自動還原");
      expect(await countBy(demo.id)).toBe(before);
    } else {
      expect(error, "off 模式（無上限）：Demo 在滿額後也能新增").toBeNull();
      expect(await countBy(demo.id)).toBe(before + 1);
    }

    const asAdmin = await admin1.client.from("audit_log").insert(row());
    expect(asAdmin.error, "一般管理員（不論 Demo 是否滿額）").toBeNull();
  });

  it("只算自己的列：Demo 的額度與整張表總列數無關（整張表 ≫ 500 時，Demo 空額度仍可新增）", async () => {
    await setRows(admin1, 300);
    await setRows(demo, 0);
    expect(await countAll()).toBeGreaterThanOrEqual(baseline + 300);
    const { error } = await demo.client.from("audit_log").insert(row());
    expect(error, "Demo 自己是 0 筆，不得被他人的紀錄擋住").toBeNull();
    expect(await countBy(demo.id)).toBe(1);
  });

  it("並行：剩 3 個額度時，同時送出多筆 Demo 新增，恰好 3 筆成功（硬上限）", async () => {
    await setRows(demo, CAP - 3);
    // 30 個同時請求搶 3 個額度：沒有鎖時，只要有 4 個以上在前 3 筆提交前完成計數就會超出。
    // 這是機率性的證明（鎖的決定性證明在 TASK-122-verify.sql 的 pg_locks 檢查）。
    const attempts = 30;
    const results = await Promise.all(Array.from({ length: attempts }, () => demo.client.from("audit_log").insert(row())));
    const succeeded = results.filter((r) => !r.error).length;
    const rejected = results.filter((r) => r.error?.code === "P0001").length;
    const total = await countBy(demo.id);
    if (capActive) {
      expect(succeeded).toBe(3);
      expect(rejected).toBe(attempts - 3);
      expect(total).toBe(CAP);
    } else {
      expect(succeeded, "off 模式（無上限）：全部成功").toBe(attempts);
      expect(rejected).toBe(0);
      expect(total).toBe(CAP - 3 + attempts);
    }
  });

  it("多列單一 insert：額度不足時整句被拒絕，沒有留下部分資料", async () => {
    await setRows(demo, CAP - 2);
    const before = await countBy(demo.id);
    const { error } = await demo.client.from("audit_log").insert(rows(5));
    if (capActive) {
      expect(error?.code).toBe("P0001");
      expect(error?.message).toBe(CAP_MESSAGE);
      expect(await countBy(demo.id)).toBe(before);
    } else {
      expect(error).toBeNull();
      expect(await countBy(demo.id)).toBe(before + 5);
    }
  });

  it("還有額度時：Demo 可以新增，剛好補滿到上限（沒有誤擋）", async () => {
    await setRows(demo, CAP - 1);
    const { error } = await demo.client.from("audit_log").insert(row());
    expect(error).toBeNull();
    expect(await countBy(demo.id)).toBe(CAP);
  });

  it("一般管理員自己超過 500 筆仍可寫入（每帳戶計數只限制 Demo；designer001 的紀錄會無限成長）", async () => {
    await setRows(admin1, CAP + 10);
    const { error } = await admin1.client.from("audit_log").insert(row());
    expect(error, "一般管理員已有 510 筆").toBeNull();
    expect(await countBy(admin1.id)).toBe(CAP + 11);
  });

  it("只在 user_metadata 偽造 is_demo 的真實帳號被當成一般管理員，不受上限", async () => {
    await setRows(forged, CAP + 10);
    const { error } = await forged.client.from("audit_log").insert(row());
    expect(error, "user_metadata.is_demo 不算 Demo").toBeNull();
    expect(await countBy(forged.id)).toBe(CAP + 11);
  });

  it("多列單一 insert 的邊界：剩 2 個額度、剛好 insert 2 列 → 成功，總數恰好 500；再 1 列被拒", async () => {
    await setRows(demo, CAP - 2);
    const { error } = await demo.client.from("audit_log").insert(rows(2));
    expect(error, "剛好用完額度").toBeNull();
    expect(await countBy(demo.id)).toBe(CAP);
    const over = await demo.client.from("audit_log").insert(row());
    if (capActive) expect(over.error?.code).toBe("P0001");
    else expect(over.error).toBeNull();
  });

  it("Demo 無法指定 actor_id 來規避計數（欄位層級 grant，兩種模式都成立）", async () => {
    await setRows(demo, 0);
    const adminBefore = await countBy(admin1.id);
    const { error } = await demo.client.from("audit_log").insert({ ...row(), actor_id: admin1.id });
    expect(error, "authenticated 沒有 actor_id 的 insert 權限").not.toBeNull();
    expect(error?.code).toBe("42501");
    expect(await countBy(admin1.id), "被拒絕的寫入不得出現在別人的名下").toBe(adminBefore);
    expect(await countBy(demo.id)).toBe(0);
  });

  it("單一請求超過 20 列：整句被拒絕，沒有部分寫入；20 列可以；一般管理員一次寫 50 列不受限", async () => {
    await setRows(demo, 0);
    const over = await demo.client.from("audit_log").insert(rows(MAX_ROWS_PER_REQUEST + 1));
    if (capActive) {
      expect(over.error?.code).toBe("P0001");
      expect(over.error?.message).toBe(`DEMO_ROW_CAP: audit_log (max ${MAX_ROWS_PER_REQUEST} rows per request)`);
      expect(await countBy(demo.id)).toBe(0);
    } else {
      expect(over.error, "off 模式（無上限）").toBeNull();
      expect(await countBy(demo.id)).toBe(MAX_ROWS_PER_REQUEST + 1);
      await setRows(demo, 0);
    }
    const exact = await demo.client.from("audit_log").insert(rows(MAX_ROWS_PER_REQUEST));
    expect(exact.error, "剛好 20 列").toBeNull();

    await setRows(admin1, 0);
    const asAdmin = await admin1.client.from("audit_log").insert(rows(50));
    expect(asAdmin.error, "一般管理員一次寫 50 列").toBeNull();
    expect(await countBy(admin1.id)).toBe(50);
  });

  it("單筆大小：Demo 的 event_type 超過 64 位元組被拒絕，64 位元組可以；一般管理員不受限", async () => {
    await setRows(demo, 0);
    const longEvent = (bytes: number) => ({ ...row(), event_type: `test.${"a".repeat(bytes - 5)}` });

    const ok64 = await demo.client.from("audit_log").insert(longEvent(64));
    expect(ok64.error, "剛好 64 位元組").toBeNull();

    const over = await demo.client.from("audit_log").insert(longEvent(65));
    if (capActive) {
      expect(over.error?.code).toBe("P0001");
      expect(over.error?.message).toBe("DEMO_ROW_CAP: audit_log (row too large)");
      expect(await countBy(demo.id)).toBe(1);
    } else {
      expect(over.error, "off 模式（無上限）").toBeNull();
    }

    const asAdmin = await admin1.client.from("audit_log").insert(longEvent(300));
    expect(asAdmin.error, "一般管理員的長 event_type").toBeNull();
  });

  it("每日還原等同「刪光 Demo 的列」：額度恢復，Demo 可再寫入", async () => {
    await setRows(demo, CAP);
    const { error: delError } = await admin.from("audit_log").delete().eq("actor_id", demo.id);
    expect(delError).toBeNull();
    const { error } = await demo.client.from("audit_log").insert(rows(10));
    expect(error).toBeNull();
    expect(await countBy(demo.id)).toBe(10);
  });
});
