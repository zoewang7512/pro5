// 對真實 Supabase 專案執行的整合測試，驗證「儀表板與報表」Epic 的資料層。
// TASK-087：0020_appointment_price_snapshot（appointments.price_at_booking）——快照寫入、權限矩陣、
// 顧客端 RPC 不外露此欄位。TASK-088：追加彙總案例（fetchReportAppointments + summarize + buildTrend 對手算結果）。
// 不放進預設 `npm test`，只透過 `npm run test:reports` 執行；缺設定時直接噴錯而非略過，
// 避免「忘了填 .env.local 卻顯示測試通過」的誤導。
//
// 安全規則（既有教訓，違反會寄出真實信件或踢掉使用者的瀏覽器登入）：
//   - 測試預約一律 customer_email = null：0011／0012 的 Database Webhook 只在 email 非 null 時才寄信。
//   - 姓名、服務、設計師皆 `__TEST__` 前綴，只對 `__TEST__` 服務開啟測試設計師（designer-fixture 強制）。
//   - 店長帳號結尾只做 scope: "local" 的登出，不可呼叫預設的全域 signOut()（會踢掉瀏覽器上的登入）。
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildTrend,
  fetchReportAppointments,
  filterByDesigners,
  getReportPeriod,
  summarize,
} from "@/lib/admin/reports";
import { cleanupTestDesigners, createTestDesigner } from "./helpers/designer-fixture";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const designerEmail = process.env.DESIGNER_EMAIL;
const designerPassword = process.env.DESIGNER_PASSWORD;

if (!url || !anonKey || !serviceRoleKey || !designerEmail || !designerPassword) {
  throw new Error(
    "[reports.integration.test] 缺少 Supabase 專案設定或 DESIGNER_EMAIL/DESIGNER_PASSWORD，" +
      "請確認 .env.local 已填妥並已執行 npm run seed:designer。",
  );
}

const MARKER = `__TEST__reports-${Date.now()}`;
const TZ_OFFSET = "+08:00";
const PERMISSION_DENIED = "42501";
const FOREIGN_KEY_VIOLATION = "23503";

type RpcEnvelope<T> = { ok: true; data: T } | { ok: false; error_code: string; message: string };
type AvailableSlot = { start_at: string; end_at: string };

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function taipeiToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
}

function weekdayOf(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}

function isoAt(dateStr: string, hh: number, mm = 0): string {
  return new Date(`${dateStr}T${pad(hh)}:${pad(mm)}:00${TZ_OFFSET}`).toISOString();
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

const phoneRunSeed = String(Date.now() % 100_000).padStart(5, "0");
let phoneSeq = 0;
function testPhone(): string {
  phoneSeq += 1;
  return `09${phoneRunSeed}${String(phoneSeq).padStart(3, "0")}`;
}

function newClient(key: string): SupabaseClient {
  return createClient(url!, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

describe("預約價格快照 price_at_booking（真實 Supabase 專案）", () => {
  let serviceRoleClient: SupabaseClient;
  let anonClient: SupabaseClient;
  let adminClient: SupabaseClient;
  let nonAdminClient: SupabaseClient;
  let nonAdminUserId: string | undefined;
  let testServiceId: string;
  let testDesignerId: string;

  // 離今天很遠的日期：只給 service_role 直接 insert 的 fixture 用；排除 Sunday 與否不影響（沒有營業時間檢查）。
  const FIXTURE_DATE = addDays(taipeiToday(), 200);

  beforeAll(async () => {
    serviceRoleClient = newClient(serviceRoleKey!);
    anonClient = newClient(anonKey!);

    adminClient = newClient(anonKey!);
    const { error: adminSignInError } = await adminClient.auth.signInWithPassword({
      email: designerEmail!,
      password: designerPassword!,
    });
    if (adminSignInError) throw adminSignInError;

    const nonAdminEmail = `${MARKER}-nonadmin@example.invalid`;
    const nonAdminPassword = `${randomUUID()}Aa1!`;
    const { data: created, error: createError } = await serviceRoleClient.auth.admin.createUser({
      email: nonAdminEmail,
      password: nonAdminPassword,
      email_confirm: true,
    });
    if (createError) throw createError;
    nonAdminUserId = created.user.id;
    nonAdminClient = newClient(anonKey!);
    const { error: nonAdminSignInError } = await nonAdminClient.auth.signInWithPassword({
      email: nonAdminEmail,
      password: nonAdminPassword,
    });
    if (nonAdminSignInError) throw nonAdminSignInError;

    const { data: service, error: serviceError } = await serviceRoleClient
      .from("services")
      .insert({ name: `${MARKER} service`, price: 100, duration_minutes: 30, is_active: true })
      .select("id")
      .single();
    if (serviceError) throw serviceError;
    testServiceId = service.id;
    testDesignerId = (await createTestDesigner(serviceRoleClient, { tag: "price", serviceIds: [testServiceId] })).id;
  }, 60000);

  afterAll(async () => {
    // 每個清除步驟都各自嘗試，最後一次性丟出錯誤，避免前面失敗讓後面步驟完全不執行而殘留測試資料。
    const errors: unknown[] = [];
    await adminClient?.auth.signOut({ scope: "local" });
    await nonAdminClient?.auth.signOut({ scope: "local" });

    if (testServiceId) {
      const { error } = await serviceRoleClient.from("appointments").delete().eq("service_id", testServiceId);
      if (error) errors.push(error);
    }
    if (testDesignerId) {
      try {
        await cleanupTestDesigners(serviceRoleClient, [testDesignerId]);
      } catch (error) {
        errors.push(error);
      }
    }
    if (serviceRoleClient) {
      const { error } = await serviceRoleClient
        .from("customers")
        .delete()
        .like("name", `${escapeLikePattern(MARKER)}%`);
      if (error) errors.push(error);
    }
    if (testServiceId) {
      const { error } = await serviceRoleClient.from("services").delete().eq("id", testServiceId);
      if (error) errors.push(error);
    }
    if (nonAdminUserId) {
      const { error } = await serviceRoleClient.auth.admin.deleteUser(nonAdminUserId);
      if (error) errors.push(error);
    }
    if (errors.length > 0) {
      throw new Error(`[reports.integration.test] afterAll 清除失敗，殘留測試資料未被清乾淨：${JSON.stringify(errors)}`);
    }
  });

  let hourSeq = 0;
  // 每筆 fixture 用不同的小時，避開「同一位設計師不重疊」的 exclusion constraint。
  async function insertFixture(extra: Record<string, unknown> = {}) {
    hourSeq += 1;
    const startAt = isoAt(FIXTURE_DATE, 8 + hourSeq);
    const endAt = isoAt(FIXTURE_DATE, 8 + hourSeq, 30);
    return serviceRoleClient
      .from("appointments")
      .insert({
        service_id: testServiceId,
        designer_id: testDesignerId,
        customer_name: `${MARKER} fixture-${hourSeq}`,
        customer_phone: testPhone(),
        // customer_email 一律不填（null）：Database Webhook 在 email 非 null 時才會寄信，絕不能對測試資料觸發。
        start_at: startAt,
        end_at: endAt,
        status: "pending",
        ...extra,
      })
      .select("id, price_at_booking")
      .single();
  }

  async function readSnapshot(id: string): Promise<number> {
    const { data, error } = await serviceRoleClient.from("appointments").select("price_at_booking").eq("id", id).single();
    if (error) throw error;
    return Number(data.price_at_booking);
  }

  const ids: { first?: string; second?: string; overridden?: string } = {};

  describe("快照寫入（trigger）", () => {
    it("新增預約時自動帶入服務當下價格", async () => {
      const { data, error } = await insertFixture();
      expect(error).toBeNull();
      ids.first = data!.id;
      expect(Number(data!.price_at_booking)).toBe(100);
    });

    it("服務之後改價：既有預約快照不變，新預約帶新價格", async () => {
      const { error: priceError } = await serviceRoleClient.from("services").update({ price: 150 }).eq("id", testServiceId);
      expect(priceError).toBeNull();

      expect(await readSnapshot(ids.first!)).toBe(100);

      const { data, error } = await insertFixture();
      expect(error).toBeNull();
      ids.second = data!.id;
      expect(Number(data!.price_at_booking)).toBe(150);
    });

    it("呼叫端帶入的 price_at_booking 會被覆寫成服務價格", async () => {
      const { data, error } = await insertFixture({ price_at_booking: 999 });
      expect(error).toBeNull();
      ids.overridden = data!.id;
      expect(Number(data!.price_at_booking)).toBe(150);
    });

    it("service_id 不存在時仍得到外鍵錯誤（保留原本的錯誤語意）", async () => {
      const { error } = await insertFixture({ service_id: randomUUID() });
      expect(error).not.toBeNull();
      expect(error!.code).toBe(FOREIGN_KEY_VIOLATION);
    });

    it("service_role 可以直接改快照（供之後的彙總測試造資料）", async () => {
      const { error } = await serviceRoleClient.from("appointments").update({ price_at_booking: 777 }).eq("id", ids.first!);
      expect(error).toBeNull();
      expect(await readSnapshot(ids.first!)).toBe(777);
      // 還原成真實快照，避免影響後面的案例。
      await serviceRoleClient.from("appointments").update({ price_at_booking: 100 }).eq("id", ids.first!);
    });
  });

  describe("權限矩陣", () => {
    it("店長（authenticated）讀得到 price_at_booking，且與資料庫一致", async () => {
      const { data, error } = await adminClient
        .from("appointments")
        .select("id, price_at_booking")
        .eq("service_id", testServiceId);
      expect(error).toBeNull();
      const byId = new Map((data ?? []).map((row) => [row.id as string, Number(row.price_at_booking)]));
      expect(byId.get(ids.first!)).toBe(100);
      expect(byId.get(ids.second!)).toBe(150);
    });

    it("店長不能更新 price_at_booking（欄位層級授權），資料不變", async () => {
      const { error } = await adminClient.from("appointments").update({ price_at_booking: 1 }).eq("id", ids.first!);
      expect(error).not.toBeNull();
      expect(error!.code).toBe(PERMISSION_DENIED);
      expect(await readSnapshot(ids.first!)).toBe(100);
    });

    it("店長仍可更新 status（回歸：新增欄位沒有破壞既有授權）", async () => {
      const { data, error } = await adminClient
        .from("appointments")
        .update({ status: "confirmed" })
        .eq("id", ids.second!)
        .select("id, status");
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data![0].status).toBe("confirmed");
      // 改狀態不重算快照。
      expect(await readSnapshot(ids.second!)).toBe(150);
    });

    it("anon 讀 price_at_booking 被拒（42501）", async () => {
      const { error } = await anonClient.from("appointments").select("price_at_booking").limit(1);
      expect(error).not.toBeNull();
      expect(error!.code).toBe(PERMISSION_DENIED);
    });

    it("非店長登入者讀得到空結果（先確認底下確實有資料）", async () => {
      const { data: actual, error: actualError } = await serviceRoleClient
        .from("appointments")
        .select("id")
        .eq("service_id", testServiceId);
      expect(actualError).toBeNull();
      expect((actual ?? []).length).toBeGreaterThanOrEqual(3);

      const { data, error } = await nonAdminClient
        .from("appointments")
        .select("id, price_at_booking")
        .eq("service_id", testServiceId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  });

  describe("顧客端 RPC", () => {
    it("get_available_slots／create_appointment 的回傳不含 price_at_booking，且建立的預約快照正確", async () => {
      // 找一個有可預約時段的營業日（距離今天 55 天起，避開正式資料；可預約視野上限為 90 天）。
      let date = addDays(taipeiToday(), 55);
      let slots: AvailableSlot[] = [];
      let slotsEnvelope: RpcEnvelope<AvailableSlot[]> | undefined;
      for (let attempt = 0; attempt < 12 && slots.length === 0; attempt++) {
        if (weekdayOf(date) !== 0) {
          const { data, error } = await anonClient.rpc("get_available_slots", { p_service_id: testServiceId, p_date: date });
          if (error) throw error;
          slotsEnvelope = data as RpcEnvelope<AvailableSlot[]>;
          if (slotsEnvelope.ok) slots = slotsEnvelope.data;
        }
        if (slots.length === 0) date = addDays(date, 1);
      }
      expect(slots.length).toBeGreaterThan(0);
      expect(JSON.stringify(slotsEnvelope)).not.toContain("price_at_booking");

      const customerName = `${MARKER} rpc-customer`;
      const { data, error } = await anonClient.rpc("create_appointment", {
        p_service_id: testServiceId,
        p_start_at: slots[0].start_at,
        p_customer_name: customerName,
        p_customer_phone: testPhone(),
        p_customer_email: null,
      });
      if (error) throw error;
      const envelope = data as RpcEnvelope<unknown>;
      expect(envelope.ok).toBe(true);
      expect(JSON.stringify(envelope)).not.toContain("price_at_booking");

      const { data: created, error: createdError } = await serviceRoleClient
        .from("appointments")
        .select("price_at_booking")
        .eq("customer_name", customerName)
        .single();
      if (createdError) throw createdError;
      // 此時服務價格為 150（上面改過價），RPC 建立的預約快照要等於當下價格。
      expect(Number(created.price_at_booking)).toBe(150);
    });
  });
});

// ---- TASK-088：彙總（fetchReportAppointments + summarize + buildTrend） ----

describe("報表彙總（真實 Supabase 專案）", () => {
  let serviceRoleClient: SupabaseClient;
  let anonClient: SupabaseClient;
  let adminClient: SupabaseClient;
  let nonAdminClient: SupabaseClient;
  let nonAdminUserId: string | undefined;
  const serviceIds: string[] = [];
  const designerIds: string[] = [];
  let designerA: string;
  let designerB: string;

  // 離今天很遠的某個星期三：該週（週一～週日）不會有真實預約。
  const WEDNESDAY = (() => {
    const base = addDays(taipeiToday(), 300);
    return addDays(base, (3 - weekdayOf(base) + 7) % 7);
  })();
  const MONDAY = addDays(WEDNESDAY, -2);
  const SUNDAY = addDays(WEDNESDAY, 4);
  const NEXT_MONDAY = addDays(WEDNESDAY, 5);

  beforeAll(async () => {
    serviceRoleClient = newClient(serviceRoleKey!);
    anonClient = newClient(anonKey!);

    adminClient = newClient(anonKey!);
    const { error: adminSignInError } = await adminClient.auth.signInWithPassword({
      email: designerEmail!,
      password: designerPassword!,
    });
    if (adminSignInError) throw adminSignInError;

    const nonAdminEmail = `${MARKER}-agg-nonadmin@example.invalid`;
    const nonAdminPassword = `${randomUUID()}Aa1!`;
    const { data: created, error: createError } = await serviceRoleClient.auth.admin.createUser({
      email: nonAdminEmail,
      password: nonAdminPassword,
      email_confirm: true,
    });
    if (createError) throw createError;
    nonAdminUserId = created.user.id;
    nonAdminClient = newClient(anonKey!);
    const { error: nonAdminSignInError } = await nonAdminClient.auth.signInWithPassword({
      email: nonAdminEmail,
      password: nonAdminPassword,
    });
    if (nonAdminSignInError) throw nonAdminSignInError;

    for (const [label, price] of [
      ["one", 100],
      ["two", 200],
    ] as const) {
      const { data, error } = await serviceRoleClient
        .from("services")
        .insert({ name: `${MARKER}-agg ${label}`, price, duration_minutes: 30, is_active: true })
        .select("id")
        .single();
      if (error) throw error;
      serviceIds.push(data.id);
    }
    const [serviceOne, serviceTwo] = serviceIds;

    designerA = (await createTestDesigner(serviceRoleClient, { tag: "agga", serviceIds })).id;
    designerIds.push(designerA);
    designerB = (await createTestDesigner(serviceRoleClient, { tag: "aggb", serviceIds })).id;
    designerIds.push(designerB);

    // 手算用的固定資料。快照用 service_role 直接 update 成指定值（trigger 只在 INSERT 覆寫），模擬「事後改價」。
    // 週一 00:00 是期間第一個瞬間（含）；下週一 00:00 是結束界線（不含）；前一週日 23:59 在期間外。
    const day = (date: string, hh: number, mm = 0) => {
      const start = isoAt(date, hh, mm);
      return { start, end: new Date(Date.parse(start) + 30 * 60_000).toISOString() };
    };
    const fixtures = [
      { key: "beforeWeek", designer: designerA, service: serviceOne, ...{ start: isoAt(addDays(MONDAY, -1), 23, 59), end: isoAt(MONDAY, 0, 0) }, status: "completed", snapshot: 999 },
      { key: "monFirstInstant", designer: designerA, service: serviceOne, ...day(MONDAY, 0), status: "pending", snapshot: 100 },
      { key: "wedCompletedA", designer: designerA, service: serviceOne, ...day(WEDNESDAY, 10), status: "completed", snapshot: 150.5 },
      { key: "wedCompletedB", designer: designerB, service: serviceTwo, ...day(WEDNESDAY, 10, 30), status: "completed", snapshot: 200 },
      { key: "wedConfirmedB", designer: designerB, service: serviceTwo, ...day(WEDNESDAY, 14), status: "confirmed", snapshot: 250 },
      { key: "wedCancelledA", designer: designerA, service: serviceOne, ...day(WEDNESDAY, 21), status: "cancelled", snapshot: 100 },
      { key: "sunLate", designer: designerA, service: serviceOne, ...{ start: isoAt(SUNDAY, 23, 30), end: isoAt(NEXT_MONDAY, 0, 0) }, status: "completed", snapshot: 100 },
      { key: "nextWeekFirstInstant", designer: designerA, service: serviceOne, ...day(NEXT_MONDAY, 0), status: "completed", snapshot: 888 },
    ];
    for (const f of fixtures) {
      const { data, error } = await serviceRoleClient
        .from("appointments")
        .insert({
          service_id: f.service,
          designer_id: f.designer,
          customer_name: `${MARKER}-agg ${f.key}`,
          customer_phone: testPhone(),
          // customer_email 一律不填（null）：Database Webhook 在 email 非 null 時才會寄信。
          start_at: f.start,
          end_at: f.end,
          status: f.status,
        })
        .select("id")
        .single();
      if (error) throw error;
      const { error: snapshotError } = await serviceRoleClient
        .from("appointments")
        .update({ price_at_booking: f.snapshot })
        .eq("id", data.id);
      if (snapshotError) throw snapshotError;
    }
  }, 120000);

  afterAll(async () => {
    const errors: unknown[] = [];
    await adminClient?.auth.signOut({ scope: "local" });
    await nonAdminClient?.auth.signOut({ scope: "local" });

    if (serviceIds.length > 0) {
      const { error } = await serviceRoleClient.from("appointments").delete().in("service_id", serviceIds);
      if (error) errors.push(error);
    }
    if (designerIds.length > 0) {
      try {
        await cleanupTestDesigners(serviceRoleClient, designerIds);
      } catch (error) {
        errors.push(error);
      }
    }
    if (serviceRoleClient) {
      const { error } = await serviceRoleClient
        .from("customers")
        .delete()
        .like("name", `${escapeLikePattern(MARKER)}%`);
      if (error) errors.push(error);
    }
    if (serviceIds.length > 0) {
      const { error } = await serviceRoleClient.from("services").delete().in("id", serviceIds);
      if (error) errors.push(error);
    }
    if (nonAdminUserId) {
      const { error } = await serviceRoleClient.auth.admin.deleteUser(nonAdminUserId);
      if (error) errors.push(error);
    }
    if (errors.length > 0) {
      throw new Error(`[reports.integration.test] afterAll 清除失敗，殘留測試資料未被清乾淨：${JSON.stringify(errors)}`);
    }
  });

  const week = () => getReportPeriod("week", WEDNESDAY, WEDNESDAY);

  // 期間內若有別人（真實資料）的預約也不影響：只看本套件的服務。
  async function fetchMine(client: SupabaseClient, period = week()) {
    const result = await fetchReportAppointments(client, period);
    if (!result.ok) throw new Error(`fetchReportAppointments failed: ${JSON.stringify(result.error)}`);
    return result.data.filter((a) => serviceIds.includes(a.serviceId));
  }

  it("店長取回週期間：含第一個瞬間、不含結束界線與前一週日 23:59", async () => {
    const mine = await fetchMine(adminClient);
    expect(mine).toHaveLength(6);
    expect(mine.map((a) => a.price).sort((x, y) => x - y)).toEqual([100, 100, 100, 150.5, 200, 250]);
  });

  it("summarize：預約量、各狀態筆數、營收（快照價）、預估營收與手算一致", async () => {
    expect(summarize(await fetchMine(adminClient))).toEqual({
      booked: 5,
      completed: 3,
      pending: 2,
      cancelled: 1,
      revenue: 450.5, // 150.5 + 200 + 100（改價後的快照，不是服務目前價格）
      estimated: 350, // 100 + 250
    });
  });

  it("buildTrend（週）：七格、補零、日期歸屬依台北時間（週日 23:30 屬週日）", async () => {
    const trend = buildTrend(week(), await fetchMine(adminClient));
    expect(trend.map((b) => b.key)).toEqual(Array.from({ length: 7 }, (_, i) => addDays(MONDAY, i)));
    expect(trend.map((b) => b.booked)).toEqual([1, 0, 3, 0, 0, 0, 1]);
    expect(trend[0]).toMatchObject({ pending: 1, estimated: 100 });
    expect(trend[2]).toMatchObject({ completed: 2, pending: 1, cancelled: 1, revenue: 350.5, estimated: 250 });
    expect(trend[6]).toMatchObject({ completed: 1, revenue: 100 });
  });

  it("buildTrend（日）：預約晚於 19 點時範圍擴張到 21:00，已取消不丟", async () => {
    const day = getReportPeriod("day", WEDNESDAY, WEDNESDAY);
    const trend = buildTrend(day, await fetchMine(adminClient, day));
    expect(trend.map((b) => b.key)).toEqual(
      Array.from({ length: 12 }, (_, i) => `${String(10 + i).padStart(2, "0")}:00`),
    );
    expect(trend[0]).toMatchObject({ booked: 2, completed: 2, revenue: 350.5 });
    expect(trend[4]).toMatchObject({ key: "14:00", booked: 1, pending: 1, estimated: 250 });
    expect(trend[11]).toMatchObject({ key: "21:00", booked: 0, cancelled: 1 });
  });

  it("設計師篩選後的彙總與手算一致", async () => {
    const mine = await fetchMine(adminClient);
    expect(summarize(filterByDesigners(mine, [designerA]))).toEqual({
      booked: 3,
      completed: 2,
      pending: 1,
      cancelled: 1,
      revenue: 250.5,
      estimated: 100,
    });
    expect(summarize(filterByDesigners(mine, [designerB]))).toEqual({
      booked: 2,
      completed: 1,
      pending: 1,
      cancelled: 0,
      revenue: 200,
      estimated: 250,
    });
  });

  it("前一日 23:59 與次日 00:00 的預約只出現在各自的日期", async () => {
    const sundayBefore = getReportPeriod("day", addDays(MONDAY, -1), WEDNESDAY);
    expect((await fetchMine(adminClient, sundayBefore)).map((a) => a.price)).toEqual([999]);

    const nextMonday = getReportPeriod("day", NEXT_MONDAY, WEDNESDAY);
    expect((await fetchMine(adminClient, nextMonday)).map((a) => a.price)).toEqual([888]);
  });

  it("非店長登入者取不到資料（空結果，不是錯誤）", async () => {
    expect(await fetchReportAppointments(nonAdminClient, week())).toEqual({ ok: true, data: [] });
  });

  it("anon 取不到資料（回泛用錯誤，不洩漏內容）", async () => {
    expect(await fetchReportAppointments(anonClient, week())).toEqual({
      ok: false,
      error: { message: "發生未預期的錯誤，請稍後再試。" },
    });
  });
});
