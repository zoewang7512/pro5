import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  cancelAppointment,
  getAppointmentDetail,
  getAppointmentsForWeek,
  getAvailableActions,
  markAppointmentCompleted,
  rescheduleAppointment,
} from "@/lib/admin/appointments";

// 比照 tests/booking/api.test.ts 的 fakeTableClient 模式：驗證 markAppointmentCompleted／
// cancelAppointment 對「RLS 阻擋 UPDATE 回傳成功但空結果」與「狀態條件不符（預約已經是
// completed／cancelled）」這兩種都收斂成空結果的情況，正確判定為失敗，不能只看 error 是否
// 為 null；且對外一律回傳不含底層細節的泛用錯誤訊息。
function fakeUpdateClient(result: { data: unknown; error: unknown }) {
  // eq／in／select 都掛在同一個可鏈式呼叫的物件上，同時支援
  // markAppointmentCompleted／cancelAppointment 的單一 .eq() 鏈，與
  // rescheduleAppointment 多一個 .eq("start_at", ...) 樂觀鎖條件的鏈。
  const select = vi.fn().mockResolvedValue(result);
  const chainable: { eq: ReturnType<typeof vi.fn>; in: ReturnType<typeof vi.fn>; select: typeof select } = {
    eq: vi.fn(),
    in: vi.fn(),
    select,
  };
  chainable.eq.mockImplementation(() => chainable);
  chainable.in.mockImplementation(() => chainable);
  const update = vi.fn(() => chainable);
  const from = vi.fn(() => ({ update }));
  return { client: { from } as unknown as SupabaseClient, update, eq: chainable.eq, inFilter: chainable.in, select };
}

describe("getAvailableActions", () => {
  it("pending／confirmed 可標記完成／改期／取消", () => {
    expect(getAvailableActions("pending")).toEqual({
      canComplete: true,
      canReschedule: true,
      canCancel: true,
    });
    expect(getAvailableActions("confirmed")).toEqual({
      canComplete: true,
      canReschedule: true,
      canCancel: true,
    });
  });

  it("completed／cancelled 不提供任何操作", () => {
    expect(getAvailableActions("completed")).toEqual({
      canComplete: false,
      canReschedule: false,
      canCancel: false,
    });
    expect(getAvailableActions("cancelled")).toEqual({
      canComplete: false,
      canReschedule: false,
      canCancel: false,
    });
  });
});

describe("markAppointmentCompleted／cancelAppointment", () => {
  it("PostgrestError 轉成 INTERNAL_ERROR，不外洩底層訊息", async () => {
    const { client } = fakeUpdateClient({ data: null, error: { message: "constraint xyz violated" } });
    const result = await markAppointmentCompleted(client, "appt-1");
    expect(result).toEqual({
      ok: false,
      error: { message: "發生未預期的錯誤，請稍後再試。" },
    });
  });

  it("空結果（RLS 阻擋或狀態已不是 pending／confirmed）視為失敗，不是成功", async () => {
    const { client } = fakeUpdateClient({ data: [], error: null });
    const result = await cancelAppointment(client, "appt-1");
    expect(result).toEqual({
      ok: false,
      error: { message: "發生未預期的錯誤，請稍後再試。" },
    });
  });

  it("實際有更新到列時視為成功", async () => {
    const { client } = fakeUpdateClient({ data: [{ id: "appt-1" }], error: null });
    const result = await markAppointmentCompleted(client, "appt-1");
    expect(result).toEqual({ ok: true, data: undefined });
  });

  it("markAppointmentCompleted 帶正確的目標狀態與狀態條件過濾", async () => {
    const { client, update, eq, inFilter } = fakeUpdateClient({ data: [{ id: "appt-1" }], error: null });
    await markAppointmentCompleted(client, "appt-1");
    expect(update).toHaveBeenCalledWith({ status: "completed" });
    expect(eq).toHaveBeenCalledWith("id", "appt-1");
    expect(inFilter).toHaveBeenCalledWith("status", ["pending", "confirmed"]);
  });

  it("cancelAppointment 帶正確的目標狀態", async () => {
    const { client, update } = fakeUpdateClient({ data: [{ id: "appt-1" }], error: null });
    await cancelAppointment(client, "appt-1");
    expect(update).toHaveBeenCalledWith({ status: "cancelled" });
  });
});

describe("rescheduleAppointment", () => {
  const currentStartAt = "2026-08-12T02:00:00.000Z";
  const newStartAt = "2026-08-12T03:00:00.000Z";
  const newEndAt = "2026-08-12T03:45:00.000Z";

  it("Postgres exclusion_violation（23P01）轉成 SLOT_CONFLICT，不外洩 constraint 名稱", async () => {
    const { client } = fakeUpdateClient({
      data: null,
      error: { code: "23P01", message: 'conflicting key value violates exclusion constraint "appointments_no_overlap"' },
    });
    const result = await rescheduleAppointment(client, "appt-1", currentStartAt, newStartAt, newEndAt);
    expect(result).toEqual({
      ok: false,
      error: { code: "SLOT_CONFLICT", message: "這個時段已被其他預約占用，請選擇其他時段。" },
    });
  });

  it("其他 PostgrestError 轉成 INTERNAL_ERROR", async () => {
    const { client } = fakeUpdateClient({ data: null, error: { code: "42501", message: "permission denied" } });
    const result = await rescheduleAppointment(client, "appt-1", currentStartAt, newStartAt, newEndAt);
    expect(result).toEqual({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "發生未預期的錯誤，請稍後再試。" },
    });
  });

  it("空結果（RLS 阻擋、狀態已不是 pending／confirmed，或樂觀鎖條件不符）視為失敗", async () => {
    const { client } = fakeUpdateClient({ data: [], error: null });
    const result = await rescheduleAppointment(client, "appt-1", currentStartAt, newStartAt, newEndAt);
    expect(result).toEqual({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "發生未預期的錯誤，請稍後再試。" },
    });
  });

  it("實際有更新到列時視為成功，且帶正確的 start_at／end_at、id 與樂觀鎖／狀態條件過濾", async () => {
    const { client, update, eq, inFilter } = fakeUpdateClient({ data: [{ id: "appt-1" }], error: null });
    const result = await rescheduleAppointment(client, "appt-1", currentStartAt, newStartAt, newEndAt);
    expect(result).toEqual({ ok: true, data: undefined });
    expect(update).toHaveBeenCalledWith({ start_at: newStartAt, end_at: newEndAt, reminder_sent_at: null });
    expect(eq).toHaveBeenNthCalledWith(1, "id", "appt-1");
    // 樂觀鎖：帶上呼叫端看到的原 start_at，防止用陳舊資料覆寫別處已改動的時段（lost update）。
    expect(eq).toHaveBeenNthCalledWith(2, "start_at", currentStartAt);
    expect(inFilter).toHaveBeenCalledWith("status", ["pending", "confirmed"]);
  });

  it("改期時一併把 reminder_sent_at 重設回 null（TASK-054 修正：避免已提醒過的預約改期後新時段永久收不到提醒信）", async () => {
    const { client, update } = fakeUpdateClient({ data: [{ id: "appt-1" }], error: null });
    await rescheduleAppointment(client, "appt-1", currentStartAt, newStartAt, newEndAt);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ reminder_sent_at: null }));
  });
});

// ---- TASK-075：整週與詳情查詢帶出設計師 ----

type QueryResult = { data: unknown; error: unknown };
type SelectCall = { method: string; args: unknown[] };

function fakeSelectClient(result: QueryResult) {
  const calls: SelectCall[] = [];
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "gte", "lt", "order", "eq", "maybeSingle"]) {
    chain[method] = (...args: unknown[]) => (calls.push({ method, args }), chain);
  }
  chain.then = (resolve: (value: QueryResult) => unknown) => resolve(result);
  const from = vi.fn(() => chain);
  return { client: { from } as unknown as SupabaseClient, calls };
}

const DESIGNER_ID = "11111111-1111-4111-8111-111111111111";
const WEEK_ROW = {
  id: "a1",
  customer_name: "王小姐",
  start_at: "2026-10-21T03:00:00+00:00",
  end_at: "2026-10-21T04:00:00+00:00",
  status: "confirmed",
  designer_id: DESIGNER_ID,
  designers: { id: DESIGNER_ID, name: "林小美", avatar_url: null },
  services: { name: "韓系剪髮", duration_minutes: 60, buffer_minutes: 15 },
};

describe("getAppointmentsForWeek 設計師欄位", () => {
  it("select 帶 designer_id 與 designers(id, name, avatar_url)，不用 *、不用 !inner，也不帶電話、email", async () => {
    const { client, calls } = fakeSelectClient({ data: [], error: null });
    await getAppointmentsForWeek(client, "2026-10-19", "2026-10-25");
    const columns = String(calls.find((c) => c.method === "select")?.args[0]);
    expect(columns).toContain("designer_id");
    expect(columns).toContain("designers(id, name, avatar_url)");
    expect(columns).not.toContain("*");
    expect(columns).not.toContain("!inner");
    expect(columns).not.toMatch(/customer_phone|customer_email|access_token/);
  });

  it("把 designer_id 與 embed 的設計師攤平到每筆預約", async () => {
    const { client } = fakeSelectClient({ data: [WEEK_ROW], error: null });
    const result = await getAppointmentsForWeek(client, "2026-10-19", "2026-10-25");
    expect(result.ok && result.data[0]).toMatchObject({
      designer_id: DESIGNER_ID,
      designer: { id: DESIGNER_ID, name: "林小美", avatar_url: null },
      service_name: "韓系剪髮",
      buffer_minutes: 15,
    });
  });

  it("designers embed 為陣列時取第一個；為 null（被擋或缺漏）時 designer 為 null，預約仍保留", async () => {
    const { client } = fakeSelectClient({
      data: [
        { ...WEEK_ROW, id: "a2", designers: [WEEK_ROW.designers] },
        { ...WEEK_ROW, id: "a3", designers: null },
      ],
      error: null,
    });
    const result = await getAppointmentsForWeek(client, "2026-10-19", "2026-10-25");
    expect(result.ok && result.data.map((a) => [a.id, a.designer?.name ?? null, a.designer_id])).toEqual([
      ["a2", "林小美", DESIGNER_ID],
      ["a3", null, DESIGNER_ID],
    ]);
  });
});

describe("getAppointmentDetail 設計師欄位", () => {
  it("詳情查詢同樣帶設計師（與整週查詢共用欄位），並保留電話", async () => {
    const { client, calls } = fakeSelectClient({ data: { ...WEEK_ROW, customer_phone: "0912345678" }, error: null });
    const result = await getAppointmentDetail(client, "a1");

    const columns = String(calls.find((c) => c.method === "select")?.args[0]);
    expect(columns).toContain("customer_phone");
    expect(columns).toContain("designer_id, designers(id, name, avatar_url)");
    expect(result.ok && result.data).toMatchObject({
      customer_phone: "0912345678",
      designer_id: DESIGNER_ID,
      designer: { name: "林小美" },
    });
  });
});
