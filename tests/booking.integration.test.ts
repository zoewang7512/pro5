// 對真實 Supabase 專案執行的整合測試，驗證顧客預約流程整條路徑
// （get_available_slots／create_appointment 兩個 RPC＋RLS 邊界）。
// 不放進預設 `npm test`，只透過 `npm run test:booking` 執行——這個檔案不會在
// 其他情境下被跑到，所以缺設定時直接噴錯而非略過，避免「忘了填 .env.local
// 卻顯示測試通過」的誤導。測試資料（services／customers／appointments）於
// afterAll 清除。
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
const OPEN_DATES = generateOpenWeekdays(9, 70);
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
] = OPEN_DATES;

describe("顧客預約流程整合測試（真實 Supabase 專案）", () => {
  let serviceRoleClient: SupabaseClient;
  let anonClient: SupabaseClient;
  let testServiceId: string;

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
});
