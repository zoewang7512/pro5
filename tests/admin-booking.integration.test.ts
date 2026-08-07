// 對真實 Supabase 專案執行的整合測試，驗證「預約管理後台」整條路徑
// （查看週曆/列表→標記完成/取消/改期）符合 feature-spec 的驗收標準，特別是
// 改期時 exclusion constraint 透過 authenticated 直接 update 路徑仍正確運作。
// 不放進預設 `npm test`，只透過 `npm run test:admin-booking` 執行——這個檔案
// 不會在其他情境下被跑到，所以缺設定時直接噴錯而非略過，避免「忘了填
// .env.local 卻顯示測試通過」的誤導。測試資料於 afterAll 清除。
//
// 沿用 tests/booking.integration.test.ts／tests/rls.integration.test.ts 已驗證過的
// 撰寫細節：LIKE pattern 跳脫萬用字元、afterAll 清除失敗要 throw、RLS 拒絕的斷言精確
// 比對錯誤代碼或先確認底下確實有資料（避免恆真斷言）、時間比較一律轉 epoch 再比較。
//
// 注意：appointments_no_overlap（supabase/migrations/0002_booking_flow.sql）是不分服務、
// 全域的 exclusion constraint，本檔案建立的 fixture 會暫時佔用真實時段（已選離今天 40 天
// 以上、業務時段內的日期降低風險，見下方 generateOpenWeekdays 呼叫）。切勿對正式環境高
// 頻率重複執行；若執行過程被強制中斷（例如程序被殺掉），afterAll 不會執行，需要人工用
// service role 依 TEST_MARKER 前綴清除殘留資料。
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cancelAppointment,
  getAppointmentDetail,
  getAppointmentsForWeek,
  markAppointmentCompleted,
  rescheduleAppointment,
} from "../lib/admin/appointments";
import { getWeekRange } from "../lib/admin/week-range";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const designerEmail = process.env.DESIGNER_EMAIL;
const designerPassword = process.env.DESIGNER_PASSWORD;

if (!url || !anonKey || !serviceRoleKey || !designerEmail || !designerPassword) {
  throw new Error(
    "[admin-booking.integration.test] 缺少 Supabase 專案設定或 DESIGNER_EMAIL/DESIGNER_PASSWORD，" +
      "請確認 .env.local 已填妥並已執行 npm run seed:designer。",
  );
}

const TEST_MARKER = `__TEST__admin-booking-${Date.now()}`;
const TZ_OFFSET = "+08:00";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function taipeiToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  return t.toISOString().slice(0, 10);
}

function weekdayOf(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}

function isoAt(dateStr: string, hh: number, mm: number): string {
  return new Date(`${dateStr}T${pad(hh)}:${pad(mm)}:00${TZ_OFFSET}`).toISOString();
}

// Postgres jsonb 把 timestamptz 序列化成 `+00:00` 而不是 `Z`，字串比較會誤判不相等，
// 一律轉成 epoch 再比較才是真正比對「同一個時間點」。
function epoch(iso: string): number {
  return new Date(iso).getTime();
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

// 比照 tests/booking.integration.test.ts 的作法：從遠一點的 offset 開始找不同的營業日，
// 保證各群組彼此不撞期。本卡不受「90 天視野」限制（後台不套用顧客端限制），仍選離今天
// 有一段距離的日期，降低與正式資料互相干擾的風險。
function generateOpenWeekdays(count: number, startOffsetDays: number): string[] {
  const dates: string[] = [];
  let date = addDays(taipeiToday(), startOffsetDays);
  while (dates.length < count) {
    if (weekdayOf(date) !== 0) {
      dates.push(date);
    }
    date = addDays(date, 1);
  }
  return dates;
}

// 比照 tests/booking.integration.test.ts 的 testPhone()：用執行時間戳當前綴＋遞增序號，
// 每筆合成電話都不同，避免與前次失敗未清乾淨的測試資料撞號。
const phoneRunSeed = String(Date.now() % 100_000).padStart(5, "0");
let phoneSeq = 0;
function testPhone(): string {
  phoneSeq += 1;
  return `09${phoneRunSeed}${String(phoneSeq).padStart(3, "0")}`;
}

describe("預約管理後台整合測試（真實 Supabase 專案）", () => {
  let serviceRoleClient: SupabaseClient;
  let anonClient: SupabaseClient;
  let designerClient: SupabaseClient;
  let testServiceId: string;

  const OPEN_DATES = generateOpenWeekdays(4, 40);
  const [READ_DATE, STATUS_DATE, RESCHEDULE_DATE, RLS_WRITE_DATE] = OPEN_DATES;

  beforeAll(async () => {
    serviceRoleClient = createClient(url!, serviceRoleKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    anonClient = createClient(url!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    designerClient = createClient(url!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error: signInError } = await designerClient.auth.signInWithPassword({
      email: designerEmail!,
      password: designerPassword!,
    });
    if (signInError) throw signInError;

    const { data: service, error: serviceError } = await serviceRoleClient
      .from("services")
      .insert({
        name: `${TEST_MARKER} service`,
        price: 100,
        duration_minutes: 30,
        is_active: true,
      })
      .select("id")
      .single();
    if (serviceError) throw serviceError;
    testServiceId = service.id;
  });

  afterAll(async () => {
    await designerClient.auth.signOut();

    // 兩個刪除步驟都要各自嘗試（不能第一步失敗就中止），否則前面步驟的失敗會讓後面
    // 步驟完全不執行，殘留含電話等 PII 的測試資料卻不會被任何人發現。收集所有錯誤，
    // 最後一次性丟出（若有）；testServiceId 可能因 beforeAll 提早失敗而是 undefined，
    // 這種情況下略過依賴它的清除步驟，避免送出 `service_id=eq.undefined` 這種看似成功、
    // 實則什麼都沒刪到的查詢掩蓋掉真正的失敗原因。appointments 只依 service_id 刪除即可
    // 涵蓋本檔案建立的所有 fixture，不需要額外維護一份 id 清單。
    const cleanupErrors: unknown[] = [];

    if (testServiceId) {
      const { error: deleteRemainingError } = await serviceRoleClient
        .from("appointments")
        .delete()
        .eq("service_id", testServiceId);
      if (deleteRemainingError) cleanupErrors.push(deleteRemainingError);

      const { error: deleteServiceError } = await serviceRoleClient.from("services").delete().eq("id", testServiceId);
      if (deleteServiceError) cleanupErrors.push(deleteServiceError);
    }

    if (cleanupErrors.length > 0) {
      throw new Error(
        `[admin-booking.integration.test] afterAll 清除失敗，殘留測試資料未被清乾淨：${JSON.stringify(cleanupErrors)}`,
      );
    }
  });

  async function insertFixture(params: {
    name: string;
    startAt: string;
    endAt: string;
    status?: "pending" | "confirmed" | "completed" | "cancelled";
  }): Promise<string> {
    const { data, error } = await serviceRoleClient
      .from("appointments")
      .insert({
        service_id: testServiceId,
        customer_name: `${TEST_MARKER} ${params.name}`,
        customer_phone: testPhone(),
        start_at: params.startAt,
        end_at: params.endAt,
        ...(params.status ? { status: params.status } : {}),
      })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  }

  async function fetchStatus(appointmentId: string): Promise<string> {
    const { data, error } = await serviceRoleClient
      .from("appointments")
      .select("status")
      .eq("id", appointmentId)
      .single();
    if (error) throw error;
    return data.status as string;
  }

  async function fetchTiming(appointmentId: string): Promise<{ start_at: string; end_at: string }> {
    const { data, error } = await serviceRoleClient
      .from("appointments")
      .select("start_at, end_at")
      .eq("id", appointmentId)
      .single();
    if (error) throw error;
    return data as { start_at: string; end_at: string };
  }

  describe("讀取權限邊界：designer 可查週次資料，anon 被拒", () => {
    it("designer（authenticated + is_admin()）查詢某週的 appointments 含 embedded services，資料正確", async () => {
      const startAt = isoAt(READ_DATE, 10, 0);
      const endAt = isoAt(READ_DATE, 10, 30);
      const appointmentId = await insertFixture({ name: "read-fixture", startAt, endAt });

      const { weekStart, weekEnd } = getWeekRange(READ_DATE);
      const result = await getAppointmentsForWeek(designerClient, weekStart, weekEnd);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const found = result.data.find((row) => row.id === appointmentId);
      expect(found).toBeDefined();
      expect(found!.customer_name).toBe(`${TEST_MARKER} read-fixture`);
      expect(found!.service_name).toBe(`${TEST_MARKER} service`);
      expect(found!.duration_minutes).toBe(30);
      expect(epoch(found!.start_at)).toBe(epoch(startAt));
      expect(epoch(found!.end_at)).toBe(epoch(endAt));
    });

    it("anon 查詢同樣範圍的 appointments 被 RLS 拒絕，回傳空陣列（重新確認邊界未被意外放寬）", async () => {
      // 先用 service role 確認底下確實有資料，anon 讀到空陣列才有意義，避免恆真斷言。
      const { count, error: countError } = await serviceRoleClient
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("service_id", testServiceId);
      if (countError) throw countError;
      expect(count ?? 0).toBeGreaterThan(0);

      const { weekStart, weekEnd } = getWeekRange(READ_DATE);
      const result = await getAppointmentsForWeek(anonClient, weekStart, weekEnd);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.filter((row) => row.customer_name.startsWith(TEST_MARKER))).toEqual([]);
    });
  });

  describe("markAppointmentCompleted／cancelAppointment：資料庫層確實反映狀態變更", () => {
    it("designer 標記完成成功，資料庫狀態變為 completed", async () => {
      const appointmentId = await insertFixture({
        name: "complete-success",
        startAt: isoAt(STATUS_DATE, 11, 0),
        endAt: isoAt(STATUS_DATE, 11, 30),
      });

      const result = await markAppointmentCompleted(designerClient, appointmentId);
      expect(result.ok).toBe(true);
      expect(await fetchStatus(appointmentId)).toBe("completed");
    });

    it("designer 取消成功，資料庫狀態變為 cancelled", async () => {
      const appointmentId = await insertFixture({
        name: "cancel-success",
        startAt: isoAt(STATUS_DATE, 11, 30),
        endAt: isoAt(STATUS_DATE, 12, 0),
      });

      const result = await cancelAppointment(designerClient, appointmentId);
      expect(result.ok).toBe(true);
      expect(await fetchStatus(appointmentId)).toBe("cancelled");
    });

    it("對已經是 cancelled 的預約再次標記完成，被資料庫層狀態條件擋下，狀態不變", async () => {
      const appointmentId = await insertFixture({
        name: "already-cancelled",
        startAt: isoAt(STATUS_DATE, 12, 0),
        endAt: isoAt(STATUS_DATE, 12, 30),
        status: "cancelled",
      });

      const result = await markAppointmentCompleted(designerClient, appointmentId);
      expect(result.ok).toBe(false);
      expect(await fetchStatus(appointmentId)).toBe("cancelled");
    });

    it("對已經是 completed 的預約再次取消，被資料庫層狀態條件擋下，狀態不變", async () => {
      const appointmentId = await insertFixture({
        name: "already-completed",
        startAt: isoAt(STATUS_DATE, 12, 30),
        endAt: isoAt(STATUS_DATE, 13, 0),
        status: "completed",
      });

      const result = await cancelAppointment(designerClient, appointmentId);
      expect(result.ok).toBe(false);
      expect(await fetchStatus(appointmentId)).toBe("completed");
    });
  });

  describe("rescheduleAppointment：exclusion constraint 透過 authenticated 直接 update 路徑仍正確運作", () => {
    it("改期到相鄰但不重疊的時段應該成功，原時段不再佔用", async () => {
      const originalStart = isoAt(RESCHEDULE_DATE, 13, 0);
      const originalEnd = isoAt(RESCHEDULE_DATE, 13, 30);
      const appointmentId = await insertFixture({
        name: "reschedule-adjacent",
        startAt: originalStart,
        endAt: originalEnd,
      });

      // 先佔用 13:30-14:00（緊鄰改期目標），驗證改期到 14:00-14:30 不會被誤判為重疊。
      await insertFixture({
        name: "reschedule-adjacent-neighbor",
        startAt: isoAt(RESCHEDULE_DATE, 13, 30),
        endAt: isoAt(RESCHEDULE_DATE, 14, 0),
      });

      const newStart = isoAt(RESCHEDULE_DATE, 14, 0);
      const newEnd = isoAt(RESCHEDULE_DATE, 14, 30);
      const result = await rescheduleAppointment(designerClient, appointmentId, originalStart, newStart, newEnd);

      expect(result.ok).toBe(true);
      const timing = await fetchTiming(appointmentId);
      expect(epoch(timing.start_at)).toBe(epoch(newStart));
      expect(epoch(timing.end_at)).toBe(epoch(newEnd));
    });

    it("改期到與既有預約重疊的時段被 appointments_no_overlap exclusion constraint 擋下（23P01→SLOT_CONFLICT），原預約時段不受影響", async () => {
      const occupiedStart = isoAt(RESCHEDULE_DATE, 15, 0);
      const occupiedEnd = isoAt(RESCHEDULE_DATE, 15, 30);
      await insertFixture({ name: "reschedule-conflict-occupant", startAt: occupiedStart, endAt: occupiedEnd });

      const originalStart = isoAt(RESCHEDULE_DATE, 16, 0);
      const originalEnd = isoAt(RESCHEDULE_DATE, 16, 30);
      const appointmentId = await insertFixture({
        name: "reschedule-conflict-victim",
        startAt: originalStart,
        endAt: originalEnd,
      });

      // 15:15 起 30 分鐘會與 15:00-15:30 的既有預約重疊 15 分鐘。
      const conflictStart = isoAt(RESCHEDULE_DATE, 15, 15);
      const conflictEnd = new Date(new Date(conflictStart).getTime() + 30 * 60_000).toISOString();

      const result = await rescheduleAppointment(
        designerClient,
        appointmentId,
        originalStart,
        conflictStart,
        conflictEnd,
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("SLOT_CONFLICT");

      // 原預約時段不受影響：資料庫層擋下了這次 update，原資料本來就沒被改動。
      const timing = await fetchTiming(appointmentId);
      expect(epoch(timing.start_at)).toBe(epoch(originalStart));
      expect(epoch(timing.end_at)).toBe(epoch(originalEnd));
    });
  });

  describe("RLS 邊界：anon 對 appointments 的直接寫入（含 update／delete）皆被拒", () => {
    it("anon 無法直接 insert appointments（精確比對權限錯誤代碼，並確認沒有資料真的寫入）", async () => {
      const insertMarkerName = `${TEST_MARKER} direct-insert-should-fail`;
      const { error: insertError } = await anonClient.from("appointments").insert({
        service_id: testServiceId,
        customer_name: insertMarkerName,
        start_at: isoAt(RLS_WRITE_DATE, 13, 0),
        end_at: isoAt(RLS_WRITE_DATE, 13, 30),
      });
      // 42501 = insufficient_privilege（比照 tests/booking.integration.test.ts 的既有斷言）。
      expect(insertError?.code).toBe("42501");

      const { data: shouldNotExist, error: fetchError } = await serviceRoleClient
        .from("appointments")
        .select("id")
        .eq("customer_name", insertMarkerName);
      if (fetchError) throw fetchError;
      expect(shouldNotExist).toEqual([]);
    });

    it("anon 直接 update appointments（標記完成／改期路徑）不會實際更動資料", async () => {
      const appointmentId = await insertFixture({
        name: "anon-update-fixture",
        startAt: isoAt(RLS_WRITE_DATE, 10, 0),
        endAt: isoAt(RLS_WRITE_DATE, 10, 30),
      });

      const statusResult = await markAppointmentCompleted(anonClient, appointmentId);
      expect(statusResult.ok).toBe(false);
      expect(await fetchStatus(appointmentId)).toBe("pending");

      const rescheduleResult = await rescheduleAppointment(
        anonClient,
        appointmentId,
        isoAt(RLS_WRITE_DATE, 10, 0),
        isoAt(RLS_WRITE_DATE, 11, 0),
        isoAt(RLS_WRITE_DATE, 11, 30),
      );
      expect(rescheduleResult.ok).toBe(false);

      // 標記完成與改期兩次嘗試都應該完全沒有效果：狀態與時段皆維持原樣。
      expect(await fetchStatus(appointmentId)).toBe("pending");
      const timing = await fetchTiming(appointmentId);
      expect(epoch(timing.start_at)).toBe(epoch(isoAt(RLS_WRITE_DATE, 10, 0)));
      expect(epoch(timing.end_at)).toBe(epoch(isoAt(RLS_WRITE_DATE, 10, 30)));
    });

    it("anon 直接 delete appointments 不會實際刪除資料", async () => {
      const appointmentId = await insertFixture({
        name: "anon-delete-fixture",
        startAt: isoAt(RLS_WRITE_DATE, 11, 0),
        endAt: isoAt(RLS_WRITE_DATE, 11, 30),
      });

      // RLS 阻擋 DELETE 的既有已知行為：回傳成功（error 為 null）但實際沒有列被刪除，
      // 不是拋錯，所以這裡驗證 error 為 null 的同時，仍要用下面的 refetch 確認資料還在。
      const { error: anonDeleteError } = await anonClient.from("appointments").delete().eq("id", appointmentId);
      expect(anonDeleteError).toBeNull();

      const { data: stillThere, error: refetchError } = await serviceRoleClient
        .from("appointments")
        .select("id")
        .eq("id", appointmentId)
        .maybeSingle();
      if (refetchError) throw refetchError;
      expect(stillThere).not.toBeNull();
    });

    it("anon 讀不到本測試建立的任何 appointments（重新確認整個 Epic 沒有意外開放更寬的存取）", async () => {
      // 先用 service role 確認底下確實有資料，anon 讀到空陣列才有意義，避免恆真斷言
      // （前面幾個 describe 已經建立不少 fixture，這裡只是重新確認邊界沒有被本 Epic
      // 的新程式碼意外放寬）。
      const { count, error: countError } = await serviceRoleClient
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .like("customer_name", `${escapeLikePattern(TEST_MARKER)}%`);
      if (countError) throw countError;
      expect(count ?? 0).toBeGreaterThan(0);

      const { data, error } = await anonClient
        .from("appointments")
        .select("customer_name")
        .like("customer_name", `${escapeLikePattern(TEST_MARKER)}%`);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  });

  describe("getAppointmentDetail：customer_phone 的 anon PII 邊界", () => {
    it("designer 可讀取單筆詳情含 customer_phone，anon 讀取同一筆被 RLS 拒絕（回傳找不到，不洩漏資料存在與否）", async () => {
      const phone = testPhone();
      const appointmentId = await insertFixture({
        name: "detail-pii-fixture",
        startAt: isoAt(READ_DATE, 13, 0),
        endAt: isoAt(READ_DATE, 13, 30),
      });
      // insertFixture 內部已隨機產生電話，這裡改用 service role 覆寫成本測試已知的值，
      // 方便下面直接比對回傳的 customer_phone 是否正確。
      const { error: updatePhoneError } = await serviceRoleClient
        .from("appointments")
        .update({ customer_phone: phone })
        .eq("id", appointmentId);
      if (updatePhoneError) throw updatePhoneError;

      const designerResult = await getAppointmentDetail(designerClient, appointmentId);
      expect(designerResult.ok).toBe(true);
      if (!designerResult.ok) return;
      expect(designerResult.data.customer_phone).toBe(phone);

      const anonResult = await getAppointmentDetail(anonClient, appointmentId);
      // getAppointmentDetail 用 .maybeSingle()，RLS 阻擋時回傳空結果（非拋錯），
      // 目前實作對「查無此列」與「其他內部錯誤」回傳同一個泛用 INTERNAL_ERROR，
      // 不細分——這正是刻意設計：不讓 anon 能用「錯誤訊息是否不同」反推出這筆
      // 預約是否存在（防列舉）。
      expect(anonResult.ok).toBe(false);
    });
  });
});
