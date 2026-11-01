// TASK-116（Demo 體驗帳戶）：對真實 Supabase 專案執行的整合測試，驗證 0027_demo_row_caps.sql：
//   Demo 體驗帳號（JWT app_metadata.is_demo）對 services／designers／closed_dates 的新增，在該表總列數達上限後被拒絕
//   （P0001／DEMO_ROW_CAP）；一般管理員與 service role 不受影響；並行與多列單一 insert 也擋得住（硬上限）。
//   另外五張表（designer_services／designer_leaves／designer_portfolio_images／customers／appointments）
//   的觸發器掛接與上限數字由 tests/lib/demo-row-caps-migration.test.ts（檔案內容）與
//   verification/TASK-116-verify.sql（SQL Editor，交易回滾）涵蓋；這裡不去填滿 640 筆預約之類的真實表。
//
// 不放進預設 `npm test`，只透過 `npm run test:demo-row-caps` 執行（缺設定時直接噴錯，不略過）。
//
// 只建立與刪除自己的拋棄式資料：
//   * 帳號：一位一般管理員 A、一位 Demo（app_metadata.is_demo = true），皆標記 app_metadata.rowcaps_test = true、
//     Email 含 rowcaps（雙重條件才會被清除），暫時登記進 admins。不碰 designer001 與真實 Demo 帳戶。
//   * 資料列：closed_dates 只用 2099 年的日期；services／designers 的名稱以 `__TEST__rowcaps-` 開頭且 is_active = false
//     （不會出現在前台）。開頭與結尾都依這些標記清除，並比對前後筆數相同（證明沒有留下或動到任何真實資料）。
//   * 登出：不呼叫 signOut（拋棄式帳號直接刪除）。
//
// 注意：測試期間系統內會暫時多一個 is_demo 帳戶，此時 Demo 還原函式（0024）／demo_revoke_sessions／upload-demo-images 會因
// 「不是剛好 1 個 Demo 帳戶」而拒絕執行；開啟排程還原後，請避開台北 03:00–04:00 跑 test:*。
//
// 兩種模式（驗收標準：套用 _down.sql 後行為恢復）：
//   預設（上限生效中）：npm run test:demo-row-caps
//   套用 0027 之前，或套用 _down.sql 之後：
//     PowerShell  $env:DEMO_ROW_CAPS_EXPECT="off"; npm run test:demo-row-caps
//     Bash        DEMO_ROW_CAPS_EXPECT=off npm run test:demo-row-caps
//   off 模式下：Demo 在表已滿時也能新增（沒有上限）。鑑別力：每個「生效中被擋」的斷言在 off 模式都有對應的「沒被擋」斷言。
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
    "[demo-row-caps.integration.test] 缺少 NEXT_PUBLIC_SUPABASE_URL／NEXT_PUBLIC_SUPABASE_ANON_KEY／" +
      "SUPABASE_SERVICE_ROLE_KEY，請確認 .env.local 已填妥。",
  );
}

const capsActive = process.env.DEMO_ROW_CAPS_EXPECT !== "off";
const clientOptions = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(url, serviceRoleKey, clientOptions);

const MARKER = "__TEST__rowcaps-";
// LIKE 的底線是萬用字元，跳脫後才不會多刪名稱剛好吻合的真實資料；另加 is_active = false 條件。
const MARKER_LIKE = "\\_\\_TEST\\_\\_rowcaps-%";

type Row = Record<string, unknown>;
type TableSpec = {
  table: "closed_dates" | "services" | "designers";
  cap: number;
  // 第 i 列拋棄式資料（i 從 0 起，不同 i 必須不衝突）
  row: (i: number) => Row;
  // 刪除所有拋棄式資料列
  deleteTestRows: () => Promise<void>;
};

async function mustDelete(promise: PromiseLike<{ error: { message: string } | null }>, what: string) {
  const { error } = await promise;
  if (error) throw new Error(`清除 ${what} 失敗：${error.message}`);
}

const TABLES: TableSpec[] = [
  {
    table: "closed_dates",
    cap: 20,
    row: (i) => ({ date: new Date(Date.UTC(2099, 0, 1 + i)).toISOString().slice(0, 10) }),
    deleteTestRows: () =>
      mustDelete(admin.from("closed_dates").delete().gte("date", "2099-01-01").lt("date", "2100-01-01"), "closed_dates"),
  },
  {
    table: "services",
    cap: 10,
    row: (i) => ({ name: `${MARKER}svc-${i}`, price: 100, duration_minutes: 30, is_active: false }),
    deleteTestRows: () => mustDelete(admin.from("services").delete().like("name", MARKER_LIKE).eq("is_active", false), "services"),
  },
  {
    table: "designers",
    cap: 5,
    row: (i) => ({ name: `${MARKER}dz-${i}`, is_active: false }),
    deleteTestRows: () => mustDelete(admin.from("designers").delete().like("name", MARKER_LIKE).eq("is_active", false), "designers"),
  },
];

type TestUser = { id: string; email: string; client: SupabaseClient };

async function countAll(table: string): Promise<number> {
  const { count, error } = await admin.from(table).select("*", { count: "exact", head: true });
  if (error || count === null) throw new Error(`計數 ${table} 失敗：${error?.message ?? "沒有回傳筆數"}`);
  return count;
}

async function listTestUsers() {
  const found = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`列出使用者失敗：${error.message}`);
    found.push(...data.users);
    if (data.users.length < 200) break;
  }
  return found.filter((u) => u.app_metadata?.rowcaps_test === true && u.email?.includes("rowcaps"));
}

async function cleanup() {
  for (const spec of TABLES) await spec.deleteTestRows();
  const users = await listTestUsers();
  const failures: string[] = [];
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

async function createAdminUser(kind: "admin" | "demo"): Promise<TestUser> {
  const email = `delivered+rowcaps-${kind}-${randomUUID().slice(0, 8)}@resend.dev`;
  const password = `${randomUUID()}${randomUUID().slice(0, 8)}aA1!`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: kind === "demo" ? { rowcaps_test: true, is_demo: true } : { rowcaps_test: true },
    user_metadata: { name: `__TEST__rowcaps-${kind}` },
  });
  if (error || !data.user) throw new Error(`建立 ${kind} 拋棄式帳號失敗：${error?.message ?? "沒有回傳使用者"}`);
  const { error: regError } = await admin.from("admins").insert({ user_id: data.user.id });
  if (regError) throw new Error(`登記 ${kind} 進 admins 失敗：${regError.message}`);
  const client = createClient(url!, anonKey!, clientOptions);
  const { data: signIn, error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError || !signIn.session) throw new Error(`登入 ${kind} 失敗：${signInError?.message ?? "沒有 session"}`);
  return { id: data.user.id, email, client };
}

// 讓「測試資料列」恰好有 n 筆（先全刪再以 service role 補）。
async function setTestRows(spec: TableSpec, n: number) {
  await spec.deleteTestRows();
  if (n === 0) return;
  const rows = Array.from({ length: n }, (_, i) => spec.row(i));
  const { error } = await admin.from(spec.table).insert(rows);
  if (error) throw new Error(`補 ${spec.table} 測試資料失敗：${error.message}`);
}

const CAP_MESSAGE = (spec: TableSpec) => `DEMO_ROW_CAP: ${spec.table} (cap ${spec.cap})`;

describe("Demo 專屬資料筆數上限（0027）", () => {
  let demo: TestUser;
  let admin1: TestUser;
  // 每張表的「真實資料筆數」（測試資料列清除後的總筆數）；結尾比對相同。
  const baseline = new Map<string, number>();

  beforeAll(async () => {
    await cleanup(); // 前次中斷留下的殘留
    for (const spec of TABLES) baseline.set(spec.table, await countAll(spec.table));
    // 記錄每表的真實筆數／上限／額度：額度為 0 的表，並行與多列案例會退化成「全被拒」，要看得出來。
    console.info(
      "[demo-row-caps] " +
        TABLES.map((s) => `${s.table} 真實 ${baseline.get(s.table)} / 上限 ${s.cap} / 額度 ${Math.max(0, s.cap - baseline.get(s.table)!)}`).join("；"),
    );
    demo = await createAdminUser("demo");
    admin1 = await createAdminUser("admin");
  }, 120000);

  afterAll(async () => {
    await cleanup();
    for (const spec of TABLES) {
      expect(await countAll(spec.table), `${spec.table} 結尾筆數必須與開頭相同（不留下測試資料）`).toBe(baseline.get(spec.table));
    }
    expect((await listTestUsers()).length).toBe(0);
  }, 120000);

  for (const spec of TABLES) {
    describe(`${spec.table}（上限 ${spec.cap}）`, () => {
      const real = () => baseline.get(spec.table)!;
      // 距離上限還剩幾個位置（真實資料已達上限時為 0）
      const headroom = () => Math.max(0, spec.cap - real());

      it("表已滿時：Demo 新增被拒絕（P0001／DEMO_ROW_CAP），內容不變", async () => {
        await setTestRows(spec, headroom());
        const before = await countAll(spec.table);
        expect(before).toBeGreaterThanOrEqual(spec.cap);

        const { error } = await demo.client.from(spec.table).insert(spec.row(spec.cap + 50));
        if (capsActive) {
          expect(error?.code).toBe("P0001");
          expect(error?.message).toBe(CAP_MESSAGE(spec));
          expect(error?.hint ?? "").toContain("每日凌晨會自動還原");
          expect(await countAll(spec.table)).toBe(before);
        } else {
          expect(error, "off 模式（無上限）：Demo 在表已滿時也能新增").toBeNull();
          expect(await countAll(spec.table)).toBe(before + 1);
        }
      });

      it("表已滿時：一般管理員與 service role 照常新增（不受上限約束）", async () => {
        await setTestRows(spec, headroom());
        const before = await countAll(spec.table);

        const asAdmin = await admin1.client.from(spec.table).insert(spec.row(spec.cap + 51));
        expect(asAdmin.error, "一般管理員").toBeNull();
        const asService = await admin.from(spec.table).insert(spec.row(spec.cap + 52));
        expect(asService.error, "service role").toBeNull();
        expect(await countAll(spec.table)).toBe(before + 2);
      });

      it("並行：剩 S 個額度時，同時送出多筆 Demo 新增，恰好 S 筆成功（硬上限）", async () => {
        const slots = Math.min(3, headroom());
        await setTestRows(spec, headroom() - slots);
        const attempts = slots + 5;
        const results = await Promise.all(
          Array.from({ length: attempts }, (_, i) => demo.client.from(spec.table).insert(spec.row(100 + i))),
        );
        const succeeded = results.filter((r) => !r.error).length;
        const rejected = results.filter((r) => r.error?.code === "P0001").length;
        const total = await countAll(spec.table);
        if (capsActive) {
          expect(succeeded).toBe(slots);
          expect(rejected).toBe(attempts - slots);
          expect(total).toBe(Math.max(spec.cap, real()));
        } else {
          expect(succeeded, "off 模式（無上限）：全部成功").toBe(attempts);
          expect(rejected).toBe(0);
        }
      });

      it("多列單一 insert：額度不足時整句被拒絕，沒有留下部分資料", async () => {
        const slots = Math.min(2, headroom());
        await setTestRows(spec, headroom() - slots);
        const before = await countAll(spec.table);
        const rows = Array.from({ length: slots + 3 }, (_, i) => spec.row(200 + i));
        const { error } = await demo.client.from(spec.table).insert(rows);
        if (capsActive) {
          expect(error?.code).toBe("P0001");
          expect(error?.message).toBe(CAP_MESSAGE(spec));
          expect(await countAll(spec.table)).toBe(before);
        } else {
          expect(error).toBeNull();
          expect(await countAll(spec.table)).toBe(before + rows.length);
        }
      });

      it("還有額度時：Demo 可以新增（沒有誤擋）", async (ctx) => {
        if (headroom() < 1) ctx.skip(); // 真實資料已達上限：沒有額度可測（明確標示為略過，不算通過）
        await setTestRows(spec, 0);
        const before = await countAll(spec.table);
        const { error } = await demo.client.from(spec.table).insert(spec.row(300));
        expect(error).toBeNull();
        expect(await countAll(spec.table)).toBe(before + 1);
      });
    });
  }

  it("closed_dates 已知行為：表已滿時，Demo 對「已存在日期」的 upsert 也被拒絕（BEFORE INSERT 先於 on conflict）", async () => {
    const spec = TABLES.find((t) => t.table === "closed_dates")!;
    // 至少 1 筆測試列，才有「已存在的日期」可 upsert（真實資料已達上限時也一樣）。
    await setTestRows(spec, Math.max(1, spec.cap - baseline.get("closed_dates")!));
    const existing = spec.row(0);
    const { error } = await demo.client
      .from("closed_dates")
      .upsert(existing, { onConflict: "date", ignoreDuplicates: false });
    if (capsActive) {
      expect(error?.code).toBe("P0001");
      expect(error?.message).toBe(CAP_MESSAGE(spec));
    } else {
      expect(error).toBeNull();
    }
  });
});
