// 對真實 Supabase 專案執行的整合測試，驗證顧客預約流程整條路徑
// （get_available_slots／create_appointment 兩個 RPC＋RLS 邊界）。
// 不放進預設 `npm test`，只透過 `npm run test:booking` 執行——這個檔案不會在
// 其他情境下被跑到，所以缺設定時直接噴錯而非略過，避免「忘了填 .env.local
// 卻顯示測試通過」的誤導。測試資料（services／customers／appointments）於
// afterAll 清除。
// TASK-048 起，本檔案也讀寫 booking_policy（TASK-046 建立的單例表，見
// tests/booking-policy.integration.test.ts 對其 RLS 邊界的獨立測試）：
// get_available_slots／create_appointment 改讀 booking_policy.min_lead_time_hours
// 取代原本寫死的 1 小時，本檔案既有的「提前量／視野上限」案例因此第一次隱性耦合到這個
// 設定值——beforeAll 明確把它設回 1（不能假設環境當下剛好是預設值），afterAll 還原成
// 套用測試前的原始快照（test-engineer 於 TASK-048 審查提出：這個回歸安全網原本只是巧合
// 通過，必須明確控制數值才能真正驗證「未調整設定值時行為與修改前完全一致」）。
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceRoleKey) {
  throw new Error(
    "[booking.integration.test] 缺少 Supabase 專案設定，請確認 .env.local 已填妥。",
  );
}

const TEST_MARKER = `__TEST__booking-${Date.now()}`;
const TZ_OFFSET = "+08:00";
const SERVICE_DURATION_MINUTES = 30;

type RpcEnvelope<T> = { ok: true; data: T } | { ok: false; error_code: string; message: string };
type AvailableSlot = { start_at: string; end_at: string };
type AppointmentConfirmation = {
  service_name: string;
  start_at: string;
  end_at: string;
  customer_name: string;
  customer_phone: string;
};

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

// TEST_MARKER 本身含有 `_`（LIKE 的單一字元萬用字元），afterAll 清除時若不跳脫，
// `like` 比對範圍會比預期寬（`_` 會比對到任何字元），需要跳脫成字面值才精確。
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

// 依 seed 的 business_hours：週一至週六營業，週日公休。產生 N 個「保證彼此不同」的
// 營業日日期——不能用「今天 + 固定 offset」各自獨立算再跳過週日，因為跳過週日可能讓
// 兩個不同的 offset 撞到同一個實際日期（例如 offset=11 剛好是週日而被推到週一，
// 又與 offset=12 算出的週一撞在一起），造成測試資料互相衝突。
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

function nextClosedWeekday(startOffsetDays: number): string {
  let date = addDays(taipeiToday(), startOffsetDays);
  while (weekdayOf(date) !== 0) {
    date = addDays(date, 1);
  }
  return date;
}

// 用執行時間戳當前綴，避免與前次失敗未清乾淨的測試資料撞號。
const phoneRunSeed = String(Date.now() % 100_000).padStart(5, "0");
let phoneSeq = 0;
function testPhone(): string {
  phoneSeq += 1;
  return `09${phoneRunSeed}${String(phoneSeq).padStart(3, "0")}`;
}

async function callGetAvailableSlots(
  client: SupabaseClient,
  serviceId: string,
  date: string,
): Promise<RpcEnvelope<AvailableSlot[]>> {
  const { data, error } = await client.rpc("get_available_slots", { p_service_id: serviceId, p_date: date });
  if (error) throw error;
  return data as RpcEnvelope<AvailableSlot[]>;
}

async function callCreateAppointment(
  client: SupabaseClient,
  input: {
    serviceId: string;
    startAt: string;
    customerName: string;
    customerPhone: string;
    customerEmail?: string | null;
  },
): Promise<RpcEnvelope<AppointmentConfirmation>> {
  const { data, error } = await client.rpc("create_appointment", {
    p_service_id: input.serviceId,
    p_start_at: input.startAt,
    p_customer_name: input.customerName,
    p_customer_phone: input.customerPhone,
    p_customer_email: input.customerEmail ?? null,
  });
  if (error) throw error;
  return data as RpcEnvelope<AppointmentConfirmation>;
}

// 保證彼此不同的營業日日期池，依序分配給下面各個測試群組使用，避免不同群組
// 意外落在同一天同一個時段互相干擾（見 generateOpenWeekdays 註解）。
// 刻意從「今天 + 70 天」開始（可預約視野上限為 90 天）：appointments_no_overlap
// 是不分服務、全域的 exclusion constraint，這裡建立的測試預約會暫時佔用真實
// 時段；選接近視野上限的日期，真實顧客提前這麼久預約的機率低很多，降低與
// 正式資料衝突或互相干擾的風險（仍非絕對隔離，不要對正式環境重複高頻率跑本
// 測試套件）。
const OPEN_DATES = generateOpenWeekdays(10, 70);
const [
  OCCUPIED_DATE,
  FREE_DATE,
  DEDUPE_DATE,
  CONCURRENCY_DATE_1,
  CONCURRENCY_DATE_2,
  CONCURRENCY_DATE_3,
  EXCLUSION_DATE,
  BOOKING_LIMIT_DATE,
  RLS_FIXTURE_DATE,
  BUFFER_LEAD_TIME_DATE,
] = OPEN_DATES;

// booking_policy 的提前量測試需要「近期」的營業日（min_lead_time_hours 上限 720 小時＝
// 30 天，遠小於上面 OPEN_DATES 刻意選用的 +70 天起點，用遠期日期測不出任何提前量過濾
// 效果）。用明天起最近一個營業日，時間窗夠短，正式顧客提前這麼短時間預約的機率相對高，
// 這是唯一必須承受一點與正式資料互相干擾風險的測試群組（見下方 describe 的檔頭說明）。
const NEAR_TERM_OPEN_DATE = generateOpenWeekdays(1, 1)[0];

describe("顧客預約流程整合測試（真實 Supabase 專案）", () => {
  let serviceRoleClient: SupabaseClient;
  let anonClient: SupabaseClient;
  let testServiceId: string;
  let originalMinLeadTimeHours: number;
  let originalCancelWindowHours: number | null;

  beforeAll(async () => {
    serviceRoleClient = createClient(url!, serviceRoleKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    anonClient = createClient(url!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: service, error } = await serviceRoleClient
      .from("services")
      .insert({
        name: `${TEST_MARKER} service`,
        price: 100,
        duration_minutes: SERVICE_DURATION_MINUTES,
        is_active: true,
      })
      .select("id")
      .single();
    if (error) throw error;
    testServiceId = service.id;

    // 記錄 booking_policy 目前的快照（不能假設是預設值 1，可能已被後台設定頁調整過），
    // 再明確設回 1——本檔案下面「提前量／視野上限」既有 describe 的斷言（假設提前量
    // 恰為 1 小時）原本只是巧合通過，改成明確控制數值才是真正驗證「未調整設定值時行為
    // 與修改前完全一致」（test-engineer 於 TASK-048 審查提出）。
    const { data: policySnapshot, error: policySnapshotError } = await serviceRoleClient
      .from("booking_policy")
      .select("min_lead_time_hours, cancel_window_hours")
      .eq("id", 1)
      .single();
    if (policySnapshotError) throw policySnapshotError;
    originalMinLeadTimeHours = policySnapshot.min_lead_time_hours;
    originalCancelWindowHours = policySnapshot.cancel_window_hours;

    // 印到終端機/CI log 供程序被強制中斷時人工還原（比照 tests/booking-policy.integration.test.ts／
    // tests/business-hours.integration.test.ts 的既有慣例）：本檔案下面的 booking_policy
    // describe 區塊會把正式環境的 min_lead_time_hours 暫時改到 720，若行程在該 it 與
    // afterEach 之間被強制中斷，顧客前台 14 天視窗內會全數清空且不顯示任何錯誤訊息
    // （security-reviewer 於 TASK-050 總覽性審查認定 MUST FIX），只有這行 log 能讓人工
    // 知道原始值該還原成什麼。
    console.log(`[booking.integration.test] 原始 booking_policy 快照（供中斷後人工還原用）：${JSON.stringify(policySnapshot)}`);

    const { error: setDefaultLeadError } = await serviceRoleClient
      .from("booking_policy")
      .update({ min_lead_time_hours: 1 })
      .eq("id", 1);
    if (setDefaultLeadError) throw setDefaultLeadError;
  });

  afterAll(async () => {
    // appointments 先刪（FK 依賴 customers／services），customers 依 TEST_MARKER
    // 名稱前綴清除，services 最後刪。任何一步失敗都要丟出，不能吞掉——吞掉的話
    // 清除失敗會完全無聲，殘留的測試資料（含合成 PII）不會被任何人發現。
    const { error: deleteAppointmentsError } = await serviceRoleClient
      .from("appointments")
      .delete()
      .eq("service_id", testServiceId);
    if (deleteAppointmentsError) throw deleteAppointmentsError;

    const { error: deleteCustomersError } = await serviceRoleClient
      .from("customers")
      .delete()
      .like("name", `${escapeLikePattern(TEST_MARKER)}%`);
    if (deleteCustomersError) throw deleteCustomersError;

    const { error: deleteServiceError } = await serviceRoleClient
      .from("services")
      .delete()
      .eq("id", testServiceId);
    if (deleteServiceError) throw deleteServiceError;

    const { error: restorePolicyError } = await serviceRoleClient
      .from("booking_policy")
      .update({ min_lead_time_hours: originalMinLeadTimeHours, cancel_window_hours: originalCancelWindowHours })
      .eq("id", 1);
    if (restorePolicyError) throw restorePolicyError;
  });

  describe("get_available_slots", () => {
    it("已佔用的時段不會出現在可預約清單，其他時段仍正常回傳", async () => {
      const occupiedStart = isoAt(OCCUPIED_DATE, 10, 0);
      const occupiedEnd = isoAt(OCCUPIED_DATE, 10, 30);

      const { error: insertError } = await serviceRoleClient.from("appointments").insert({
        service_id: testServiceId,
        customer_name: `${TEST_MARKER} occupied-fixture`,
        start_at: occupiedStart,
        end_at: occupiedEnd,
        status: "pending",
      });
      if (insertError) throw insertError;

      const envelope = await callGetAvailableSlots(anonClient, testServiceId, OCCUPIED_DATE);
      expect(envelope.ok).toBe(true);
      if (!envelope.ok) return;

      const startEpochs = envelope.data.map((slot) => epoch(slot.start_at));
      expect(startEpochs).not.toContain(epoch(occupiedStart));
      expect(startEpochs).toContain(epoch(isoAt(OCCUPIED_DATE, 10, 30)));
    });

    it("非營業時間（公休日）回傳空陣列，不報錯", async () => {
      const date = nextClosedWeekday(5);
      const envelope = await callGetAvailableSlots(anonClient, testServiceId, date);
      expect(envelope).toEqual({ ok: true, data: [] });
    });

    it("空閒的營業日回傳完整格點（10:00-19:00、30 分鐘服務 = 18 個時段）", async () => {
      const envelope = await callGetAvailableSlots(anonClient, testServiceId, FREE_DATE);
      expect(envelope.ok).toBe(true);
      if (!envelope.ok) return;
      expect(envelope.data).toHaveLength(18);
      expect(epoch(envelope.data[0].start_at)).toBe(epoch(isoAt(FREE_DATE, 10, 0)));
      expect(epoch(envelope.data[envelope.data.length - 1].start_at)).toBe(epoch(isoAt(FREE_DATE, 18, 30)));
    });

    it("超出 90 天視野回傳空陣列，不報錯", async () => {
      const date = addDays(taipeiToday(), 91);
      const envelope = await callGetAvailableSlots(anonClient, testServiceId, date);
      expect(envelope).toEqual({ ok: true, data: [] });
    });
  });

  describe("create_appointment：成功建立與顧客去重", () => {
    it("成功建立預約，回傳值回顯本次送出的姓名／電話", async () => {
      const phone = testPhone();
      const envelope = await callCreateAppointment(anonClient, {
        serviceId: testServiceId,
        startAt: isoAt(DEDUPE_DATE, 11, 0),
        customerName: `${TEST_MARKER} basic-success`,
        customerPhone: phone,
      });

      expect(envelope.ok).toBe(true);
      if (!envelope.ok) return;
      expect(envelope.data.service_name).toBe(`${TEST_MARKER} service`);
      expect(envelope.data.customer_name).toBe(`${TEST_MARKER} basic-success`);
      expect(envelope.data.customer_phone).toBe(phone);
    });

    it("同一電話兩次不衝突的預約，關聯同一個 customer_id，不產生重複顧客", async () => {
      const phone = testPhone();

      const first = await callCreateAppointment(anonClient, {
        serviceId: testServiceId,
        startAt: isoAt(DEDUPE_DATE, 11, 30),
        customerName: `${TEST_MARKER} same-phone-1`,
        customerPhone: phone,
      });
      const second = await callCreateAppointment(anonClient, {
        serviceId: testServiceId,
        startAt: isoAt(DEDUPE_DATE, 12, 0),
        customerName: `${TEST_MARKER} same-phone-2`,
        customerPhone: phone,
      });

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);

      const { data: customers, error: customersError } = await serviceRoleClient
        .from("customers")
        .select("id")
        .eq("phone", phone);
      if (customersError) throw customersError;
      expect(customers).toHaveLength(1);

      const { data: appointments, error: appointmentsError } = await serviceRoleClient
        .from("appointments")
        .select("customer_id")
        .eq("customer_phone", phone);
      if (appointmentsError) throw appointmentsError;
      expect(appointments).toHaveLength(2);
      expect(appointments![0].customer_id).toBe(customers![0].id);
      expect(appointments![1].customer_id).toBe(customers![0].id);
    });

    it("phone 命中既有顧客 A、email 另外命中不同顧客 B 時，以 A 為準且不覆寫 A 的既有欄位", async () => {
      const phoneA = testPhone();
      const emailA = `${TEST_MARKER}-a@example.invalid`;
      const phoneB = testPhone();
      const emailB = `${TEST_MARKER}-b@example.invalid`;

      const { data: customerA, error: insertAError } = await serviceRoleClient
        .from("customers")
        .insert({ name: `${TEST_MARKER} dedupe-A`, phone: phoneA, email: emailA })
        .select("id, name, phone, email")
        .single();
      if (insertAError) throw insertAError;

      const { data: customerB, error: insertBError } = await serviceRoleClient
        .from("customers")
        .insert({ name: `${TEST_MARKER} dedupe-B`, phone: phoneB, email: emailB })
        .select("id, name, phone, email")
        .single();
      if (insertBError) throw insertBError;

      const envelope = await callCreateAppointment(anonClient, {
        serviceId: testServiceId,
        startAt: isoAt(DEDUPE_DATE, 12, 30),
        customerName: `${TEST_MARKER} dedupe-request`,
        customerPhone: phoneA,
        customerEmail: emailB,
      });
      expect(envelope.ok).toBe(true);
      if (!envelope.ok) return;
      // 防列舉檢查：RPC 回傳的 customer_name 必須是本次請求送出的值，不是
      // 資料庫裡命中的既有顧客 A 的姓名——否則任何人只要猜電話號碼就能反查出
      // 對應顧客的真實姓名（見 feature-spec「安全性與隱私」）。
      expect(envelope.data.customer_name).toBe(`${TEST_MARKER} dedupe-request`);
      expect(envelope.data.customer_name).not.toBe(customerA.name);

      const { data: createdAppointment, error: findError } = await serviceRoleClient
        .from("appointments")
        .select("customer_id")
        .eq("customer_name", `${TEST_MARKER} dedupe-request`)
        .single();
      if (findError) throw findError;
      expect(createdAppointment.customer_id).toBe(customerA.id);

      const { data: customerBAfter, error: refetchError } = await serviceRoleClient
        .from("customers")
        .select("id, name, phone, email")
        .eq("id", customerB.id)
        .single();
      if (refetchError) throw refetchError;
      expect(customerBAfter).toEqual(customerB);

      const { data: customerAAfter, error: refetchAError } = await serviceRoleClient
        .from("customers")
        .select("id, name, phone, email")
        .eq("id", customerA.id)
        .single();
      if (refetchAError) throw refetchAError;
      expect(customerAAfter).toEqual(customerA);
    });
  });

  describe("併發衝突防護：多輪重複驗證恰好一筆成功", () => {
    const rounds: [number, string][] = [
      [1, CONCURRENCY_DATE_1],
      [2, CONCURRENCY_DATE_2],
      [3, CONCURRENCY_DATE_3],
    ];

    it.each(rounds)("第 %i 輪：4 個並發請求搶同一時段，恰好一筆成功", async (round, date) => {
      const startAt = isoAt(date, 10, 0);

      const results = await Promise.all(
        Array.from({ length: 4 }, (_, i) =>
          callCreateAppointment(anonClient, {
            serviceId: testServiceId,
            startAt,
            customerName: `${TEST_MARKER} c${round}-${i}`,
            customerPhone: testPhone(),
          }),
        ),
      );

      const successes = results.filter((r) => r.ok);
      const conflicts = results.filter((r) => !r.ok);

      expect(successes).toHaveLength(1);
      expect(conflicts).toHaveLength(3);
      for (const conflict of conflicts) {
        if (conflict.ok) continue;
        expect(conflict.error_code).toBe("SLOT_CONFLICT");
      }
    });
  });

  describe("Exclusion constraint 邊界：相鄰時段 vs 重疊時段", () => {
    it("恰好相鄰的兩個時段（10:00-10:30 與 10:30-11:00）皆應成功", async () => {
      const first = await callCreateAppointment(anonClient, {
        serviceId: testServiceId,
        startAt: isoAt(EXCLUSION_DATE, 13, 0),
        customerName: `${TEST_MARKER} adjacent-1`,
        customerPhone: testPhone(),
      });
      const second = await callCreateAppointment(anonClient, {
        serviceId: testServiceId,
        startAt: isoAt(EXCLUSION_DATE, 13, 30),
        customerName: `${TEST_MARKER} adjacent-2`,
        customerPhone: testPhone(),
      });

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
    });

    it("重疊 1 分鐘的時段應被拒絕", async () => {
      const first = await callCreateAppointment(anonClient, {
        serviceId: testServiceId,
        startAt: isoAt(EXCLUSION_DATE, 15, 0),
        customerName: `${TEST_MARKER} overlap-1`,
        customerPhone: testPhone(),
      });
      expect(first.ok).toBe(true);

      // 15:00-15:30 已佔用；15:29 起的 30 分鐘服務會與前者重疊 1 分鐘。
      const overlapStart = new Date(isoAt(EXCLUSION_DATE, 15, 0));
      overlapStart.setUTCMinutes(overlapStart.getUTCMinutes() + 29);

      const second = await callCreateAppointment(anonClient, {
        serviceId: testServiceId,
        startAt: overlapStart.toISOString(),
        customerName: `${TEST_MARKER} overlap-2`,
        customerPhone: testPhone(),
      });

      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.error_code).toBe("SLOT_CONFLICT");
    });
  });

  describe("提前量／視野上限", () => {
    it("時段早於「現在＋1 小時」應回傳 VALIDATION_ERROR", async () => {
      const startAt = new Date(Date.now() + 30 * 60_000).toISOString();
      const envelope = await callCreateAppointment(anonClient, {
        serviceId: testServiceId,
        startAt,
        customerName: `${TEST_MARKER} too-soon`,
        customerPhone: testPhone(),
      });
      expect(envelope.ok).toBe(false);
      if (envelope.ok) return;
      expect(envelope.error_code).toBe("VALIDATION_ERROR");
    });

    it("時段晚於「現在＋90 天」應回傳 VALIDATION_ERROR", async () => {
      const startAt = new Date(Date.now() + 91 * 86_400_000).toISOString();
      const envelope = await callCreateAppointment(anonClient, {
        serviceId: testServiceId,
        startAt,
        customerName: `${TEST_MARKER} too-far`,
        customerPhone: testPhone(),
      });
      expect(envelope.ok).toBe(false);
      if (envelope.ok) return;
      expect(envelope.error_code).toBe("VALIDATION_ERROR");
    });
  });

  describe("同號碼預約數上限", () => {
    it("同一電話第 4 筆 pending 預約應回傳 BOOKING_LIMIT_EXCEEDED", async () => {
      const phone = testPhone();
      // 4 個不重疊、對齊 30 分鐘格點且落在營業時間內的時段，確保失敗是因為
      // BOOKING_LIMIT_EXCEEDED，不是巧合踩到 create_appointment 目前不會檢查的
      // 營業時間／格點對齊規則（那屬於 get_available_slots 才做的過濾，見
      // 0002_booking_flow.sql）。
      const firstThreeSlots: [number, number][] = [
        [10, 0],
        [10, 30],
        [11, 0],
      ];
      for (let i = 0; i < firstThreeSlots.length; i += 1) {
        const [hh, mm] = firstThreeSlots[i];
        const envelope = await callCreateAppointment(anonClient, {
          serviceId: testServiceId,
          startAt: isoAt(BOOKING_LIMIT_DATE, hh, mm),
          customerName: `${TEST_MARKER} booking-limit-${i}`,
          customerPhone: phone,
        });
        expect(envelope.ok).toBe(true);
      }

      const fourth = await callCreateAppointment(anonClient, {
        serviceId: testServiceId,
        startAt: isoAt(BOOKING_LIMIT_DATE, 11, 30),
        customerName: `${TEST_MARKER} booking-limit-3`,
        customerPhone: phone,
      });
      expect(fourth.ok).toBe(false);
      if (fourth.ok) return;
      expect(fourth.error_code).toBe("BOOKING_LIMIT_EXCEEDED");
    });
  });

  describe("RLS 邊界：anon 對 appointments／customers 的直接存取皆被拒", () => {
    it("anon 無法直接 select appointments／customers（先確認底下確實有資料，避免驗證恆真）", async () => {
      // 前面幾個 describe 已經透過 create_appointment 建立不少 fixture，這裡先用
      // service role 確認底下確實有資料可讀，anon 讀到空陣列才有意義——不然就算
      // RLS 設錯讓 anon 也讀到空表，這個斷言一樣會通過，變成恆真的假陽性防護。
      const { count: appointmentCount, error: countError } = await serviceRoleClient
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("service_id", testServiceId);
      if (countError) throw countError;
      expect(appointmentCount ?? 0).toBeGreaterThan(0);

      const { count: customerCount, error: customerCountError } = await serviceRoleClient
        .from("customers")
        .select("id", { count: "exact", head: true })
        .like("name", `${escapeLikePattern(TEST_MARKER)}%`);
      if (customerCountError) throw customerCountError;
      expect(customerCount ?? 0).toBeGreaterThan(0);

      const { data: appointments, error: appointmentsError } = await anonClient
        .from("appointments")
        .select("id");
      expect(appointmentsError).toBeNull();
      expect(appointments).toEqual([]);

      const { data: customers, error: customersError } = await anonClient.from("customers").select("id");
      expect(customersError).toBeNull();
      expect(customers).toEqual([]);
    });

    it("anon 無法直接 insert appointments／customers（精確比對權限錯誤代碼，並確認沒有資料真的寫入）", async () => {
      const insertMarkerName = `${TEST_MARKER} direct-insert-should-fail`;
      const { error: appointmentInsertError } = await anonClient.from("appointments").insert({
        service_id: testServiceId,
        customer_name: insertMarkerName,
        start_at: isoAt(RLS_FIXTURE_DATE, 9, 0),
        end_at: isoAt(RLS_FIXTURE_DATE, 9, 30),
      });
      // 42501 = insufficient_privilege：TASK-010 撤銷了 anon 對 appointments 的
      // INSERT 權限（不只是 policy 擋，是欄位/資料表層級的 revoke），只比對
      // "有 error" 太鬆，換成 customer_phone 這種欄位驗證錯誤也會誤判通過。
      expect(appointmentInsertError?.code).toBe("42501");

      const { data: shouldNotExist, error: fetchError } = await serviceRoleClient
        .from("appointments")
        .select("id")
        .eq("customer_name", insertMarkerName);
      if (fetchError) throw fetchError;
      expect(shouldNotExist).toEqual([]);

      const customerPhone = testPhone();
      const { error: customerInsertError } = await anonClient
        .from("customers")
        .insert({ name: insertMarkerName, phone: customerPhone });
      expect(customerInsertError?.code).toBe("42501");

      const { data: customerShouldNotExist, error: customerFetchError } = await serviceRoleClient
        .from("customers")
        .select("id")
        .eq("phone", customerPhone);
      if (customerFetchError) throw customerFetchError;
      expect(customerShouldNotExist).toEqual([]);
    });

    it("anon 直接 delete appointments／customers 不會實際刪除資料", async () => {
      const { data: fixtureAppointment, error: fixtureError } = await serviceRoleClient
        .from("appointments")
        .insert({
          service_id: testServiceId,
          customer_name: `${TEST_MARKER} delete-fixture`,
          start_at: isoAt(RLS_FIXTURE_DATE, 12, 0),
          end_at: isoAt(RLS_FIXTURE_DATE, 12, 30),
        })
        .select("id")
        .single();
      if (fixtureError) throw fixtureError;

      await anonClient.from("appointments").delete().eq("id", fixtureAppointment.id);

      const { data: appointmentStillThere, error: refetchError } = await serviceRoleClient
        .from("appointments")
        .select("id")
        .eq("id", fixtureAppointment.id)
        .maybeSingle();
      if (refetchError) throw refetchError;
      expect(appointmentStillThere).not.toBeNull();

      const { data: fixtureCustomer, error: customerFixtureError } = await serviceRoleClient
        .from("customers")
        .insert({ name: `${TEST_MARKER} delete-fixture-customer`, phone: testPhone() })
        .select("id")
        .single();
      if (customerFixtureError) throw customerFixtureError;

      await anonClient.from("customers").delete().eq("id", fixtureCustomer.id);

      const { data: customerStillThere, error: customerRefetchError } = await serviceRoleClient
        .from("customers")
        .select("id")
        .eq("id", fixtureCustomer.id)
        .maybeSingle();
      if (customerRefetchError) throw customerRefetchError;
      expect(customerStillThere).not.toBeNull();
    });

    it("anon 直接 update appointments／customers 不會實際更動資料（RLS 阻擋回傳空結果而非拋錯）", async () => {
      const { data: fixtureAppointment, error: fixtureError } = await serviceRoleClient
        .from("appointments")
        .insert({
          service_id: testServiceId,
          customer_name: `${TEST_MARKER} update-fixture`,
          start_at: isoAt(RLS_FIXTURE_DATE, 10, 0),
          end_at: isoAt(RLS_FIXTURE_DATE, 10, 30),
        })
        .select("id, status")
        .single();
      if (fixtureError) throw fixtureError;

      await anonClient.from("appointments").update({ status: "confirmed" }).eq("id", fixtureAppointment.id);

      const { data: appointmentAfter, error: refetchError } = await serviceRoleClient
        .from("appointments")
        .select("status")
        .eq("id", fixtureAppointment.id)
        .single();
      if (refetchError) throw refetchError;
      expect(appointmentAfter.status).toBe(fixtureAppointment.status);

      const { data: fixtureCustomer, error: customerFixtureError } = await serviceRoleClient
        .from("customers")
        .insert({ name: `${TEST_MARKER} update-fixture-customer`, phone: testPhone() })
        .select("id, name")
        .single();
      if (customerFixtureError) throw customerFixtureError;

      await anonClient.from("customers").update({ name: "hijacked" }).eq("id", fixtureCustomer.id);

      const { data: customerAfter, error: customerRefetchError } = await serviceRoleClient
        .from("customers")
        .select("name")
        .eq("id", fixtureCustomer.id)
        .single();
      if (customerRefetchError) throw customerRefetchError;
      expect(customerAfter.name).toBe(fixtureCustomer.name);
    });
  });

  // TASK-048：get_available_slots／create_appointment 改讀 booking_policy.min_lead_time_hours。
  // 這個 describe 內每個案例都會暫時把 booking_policy 改成非預設值，各自在該 it 內把值
  // 改回 1（外層 beforeAll 已設定的基準值），確保不影響同檔案內宣告順序在後、依賴預設值
  // 的其他測試——vitest 預設依宣告順序循序執行 describe/it，本區塊刻意放在檔案最後，
  // 不會有任何後續案例受影響。
  // NEAR_TERM_OPEN_DATE 是唯一使用「近期」（明天起最近一個營業日）而非 +70 天的日期
  // （見上方常數宣告的說明）：min_lead_time_hours 的上限是 720 小時＝30 天
  // （0008_booking_policy.sql 的 check constraint），遠小於 +70 天，用遠期日期測不出任何
  // 提前量過濾效果；也因此這是本檔案中相對可能與正式顧客資料互相干擾的測試群組。
  describe("booking_policy 讀取：提前量設定值影響 get_available_slots／create_appointment（TASK-048）", () => {
    afterEach(async () => {
      const { error } = await serviceRoleClient.from("booking_policy").update({ min_lead_time_hours: 1 }).eq("id", 1);
      if (error) throw error;
    });

    // 這個案例同時是 booking_policy 不得啟用 force row level security 這條隱性約束的
    // 功能性迴歸偵測器（見 0009_booking_policy_lead_time.sql 檔頭說明）：若有人不小心
    // 對 booking_policy 執行 alter table ... force row level security，兩支 RPC 的
    // select 會讀到 0 列、coalesce 靜默退回 1 小時，時段就不會消失，這裡會失敗。不要
    // 因為看似與下面「3 小時邊界」案例重複而刪掉或簡化本案例。
    it("min_lead_time_hours 設為上限 720 小時時，近期營業日的可預約時段全部消失（證明確實讀取設定值，而非仍寫死 1 小時）", async () => {
      // 先在預設值（1 小時，外層 beforeAll 已設定）下確認這個日期本來就有時段，
      // 避免後面的「消失」斷言只是巧合成立（該日期其實從來就沒有任何時段）。
      const baseline = await callGetAvailableSlots(anonClient, testServiceId, NEAR_TERM_OPEN_DATE);
      expect(baseline.ok).toBe(true);
      if (!baseline.ok) return;
      expect(baseline.data.length).toBeGreaterThan(0);

      const { error: setLeadError } = await serviceRoleClient
        .from("booking_policy")
        .update({ min_lead_time_hours: 720 })
        .eq("id", 1);
      if (setLeadError) throw setLeadError;

      const envelope = await callGetAvailableSlots(anonClient, testServiceId, NEAR_TERM_OPEN_DATE);
      expect(envelope).toEqual({ ok: true, data: [] });
    });

    it("min_lead_time_hours 設為非預設值（3 小時）時，create_appointment 以新門檻判斷提前量：差 10 分鐘未達門檻應拒絕，超過門檻應成功", async () => {
      const { error: setLeadError } = await serviceRoleClient
        .from("booking_policy")
        .update({ min_lead_time_hours: 3 })
        .eq("id", 1);
      if (setLeadError) throw setLeadError;

      // 姓名長度必須留在 create_appointment 的 50 字元上限內（見 0002_booking_flow.sql
      // 第 183-186 行），加上 TEST_MARKER 前綴後預算有限——這裡刻意用短字尾，避免像
      // 「lead-policy-too-soon」這樣的字尾把總長度推過 50 字元，讓回傳的其實是姓名驗證
      // 的 VALIDATION_ERROR，跟我們真正要測的提前量 VALIDATION_ERROR 混在一起、巧合通過
      // 卻沒測到真正的行為（test-engineer 於 TASK-048 審查後的實測發現）。
      const tooSoon = await callCreateAppointment(anonClient, {
        serviceId: testServiceId,
        startAt: new Date(Date.now() + (2 * 60 + 50) * 60_000).toISOString(),
        customerName: `${TEST_MARKER} too-soon`,
        customerPhone: testPhone(),
      });
      expect(tooSoon.ok).toBe(false);
      if (tooSoon.ok) return;
      expect(tooSoon.error_code).toBe("VALIDATION_ERROR");
      expect(tooSoon.message).toBe("start_at out of allowed range");

      const farEnough = await callCreateAppointment(anonClient, {
        serviceId: testServiceId,
        startAt: new Date(Date.now() + (3 * 60 + 10) * 60_000).toISOString(),
        customerName: `${TEST_MARKER} far-enough`,
        customerPhone: testPhone(),
      });
      expect(farEnough.ok).toBe(true);
    });

    it("組合案例：公休日（週日，business_hours.is_closed）的早退判斷不受提前量設定值影響（新增的 booking_policy 讀取插在公休判斷之前，不應短路或跳過該判斷）", async () => {
      const { error: setLeadError } = await serviceRoleClient
        .from("booking_policy")
        .update({ min_lead_time_hours: 2 })
        .eq("id", 1);
      if (setLeadError) throw setLeadError;

      const date = nextClosedWeekday(1);
      const envelope = await callGetAvailableSlots(anonClient, testServiceId, date);
      expect(envelope).toEqual({ ok: true, data: [] });
    });

    it("組合案例：緩衝時間排除與提前量放行同時正確生效，互不遮蔽（AND 關係）", async () => {
      // 用遠期日期（EXCLUSION_DATE 等既有池同款的 +70 天日期）讓提前量檢查對這個時段
      // 必然放行（720 小時上限＝30 天，遠小於 70 天），只單獨驗證緩衝時間排除邏輯在
      // 本卡修改後仍然正確生效，不受新插入的 booking_policy 讀取影響。
      const { data: originalService, error: originalServiceError } = await serviceRoleClient
        .from("services")
        .select("buffer_minutes")
        .eq("id", testServiceId)
        .single();
      if (originalServiceError) throw originalServiceError;

      const { error: setLeadError } = await serviceRoleClient
        .from("booking_policy")
        .update({ min_lead_time_hours: 5 })
        .eq("id", 1);
      if (setLeadError) throw setLeadError;

      const { error: setBufferError } = await serviceRoleClient
        .from("services")
        .update({ buffer_minutes: 15 })
        .eq("id", testServiceId);
      if (setBufferError) throw setBufferError;

      try {
        const fixtureStart = isoAt(BUFFER_LEAD_TIME_DATE, 14, 0);
        const fixtureEnd = isoAt(BUFFER_LEAD_TIME_DATE, 14, 30);
        const { error: insertError } = await serviceRoleClient.from("appointments").insert({
          service_id: testServiceId,
          customer_name: `${TEST_MARKER} buffer-lead-fixture`,
          start_at: fixtureStart,
          end_at: fixtureEnd,
          status: "pending",
        });
        if (insertError) throw insertError;

        const envelope = await callGetAvailableSlots(anonClient, testServiceId, BUFFER_LEAD_TIME_DATE);
        expect(envelope.ok).toBe(true);
        if (!envelope.ok) return;

        const startEpochs = envelope.data.map((slot) => epoch(slot.start_at));
        // 候選時段一律對齊 30 分鐘格點（10:00 起算），13:30-14:00 加上自身 15 分鐘緩衝後
        // 延伸到 14:15，與既有 14:00-14:30 預約重疊；14:30-15:00 落在既有預約結束後的
        // 15 分鐘緩衝內（14:30 + 15 分鐘 = 14:45，與此候選時段仍重疊）——兩者皆應被緩衝
        // 時間排除，即使提前量檢查（5 小時門檻對 70 天後的日期必然放行）沒有把它們擋下。
        expect(startEpochs).not.toContain(epoch(isoAt(BUFFER_LEAD_TIME_DATE, 13, 30)));
        expect(startEpochs).not.toContain(epoch(isoAt(BUFFER_LEAD_TIME_DATE, 14, 30)));
        // 16:00 遠離緩衝範圍且提前量必然放行，應正常出現。
        expect(startEpochs).toContain(epoch(isoAt(BUFFER_LEAD_TIME_DATE, 16, 0)));
      } finally {
        const { error: restoreBufferError } = await serviceRoleClient
          .from("services")
          .update({ buffer_minutes: originalService.buffer_minutes })
          .eq("id", testServiceId);
        if (restoreBufferError) throw restoreBufferError;
      }
    });
  });
});
