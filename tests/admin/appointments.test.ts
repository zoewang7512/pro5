import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  cancelAppointment,
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
