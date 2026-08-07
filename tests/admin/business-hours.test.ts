import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  findAffectedAppointments,
  getAllBusinessHours,
  isAppointmentOutsideHours,
  updateBusinessHours,
  validateBusinessHoursRow,
  type BusinessHoursInput,
} from "@/lib/admin/business-hours";

// 比照 tests/admin/appointments.test.ts 的 fake client 模式：select／order 掛在同一個
// 可鏈式呼叫的物件上，最終 resolve 成 { data, error }。
function fakeSelectClient(result: { data: unknown; error: unknown }) {
  const order = vi.fn().mockResolvedValue(result);
  const select = vi.fn(() => ({ order }));
  const from = vi.fn(() => ({ select }));
  return { client: { from } as unknown as SupabaseClient, from, select, order };
}

function fakeUpsertClient(result: { data: unknown; error: unknown }) {
  const select = vi.fn().mockResolvedValue(result);
  const upsert = vi.fn(() => ({ select }));
  const from = vi.fn(() => ({ upsert }));
  return { client: { from } as unknown as SupabaseClient, from, upsert, select };
}

function fakeAppointmentsQueryClient(result: { data: unknown; error: unknown }) {
  const limit = vi.fn().mockResolvedValue(result);
  const lt = vi.fn(() => ({ limit }));
  const gt = vi.fn(() => ({ lt }));
  const inFilter = vi.fn(() => ({ gt }));
  const select = vi.fn(() => ({ in: inFilter }));
  const from = vi.fn(() => ({ select }));
  return { client: { from } as unknown as SupabaseClient, from, select, inFilter, gt, lt, limit };
}

describe("getAllBusinessHours", () => {
  it("成功時回傳 business_hours 的 7 列資料", async () => {
    const rows = [
      { weekday: 0, open_time: null, close_time: null, is_closed: true },
      { weekday: 1, open_time: "10:00", close_time: "19:00", is_closed: false },
    ];
    const { client, from } = fakeSelectClient({ data: rows, error: null });

    const result = await getAllBusinessHours(client);

    expect(result).toEqual({ ok: true, data: rows });
    expect(from).toHaveBeenCalledWith("business_hours");
  });

  it("查詢失敗回傳泛用 INTERNAL_ERROR，不外洩底層訊息", async () => {
    const { client } = fakeSelectClient({ data: null, error: { message: "connection refused" } });

    const result = await getAllBusinessHours(client);

    expect(result).toEqual({
      ok: false,
      error: { message: "發生未預期的錯誤，請稍後再試。" },
    });
  });

  it("data 為 null 時回傳空陣列而非拋錯", async () => {
    const { client } = fakeSelectClient({ data: null, error: null });

    const result = await getAllBusinessHours(client);

    expect(result).toEqual({ ok: true, data: [] });
  });
});

describe("validateBusinessHoursRow", () => {
  it("公休（is_closed=true）一律合法，不檢查時間欄位", () => {
    expect(validateBusinessHoursRow({ weekday: 0, open_time: "", close_time: "", is_closed: true })).toBeNull();
  });

  it("營業日缺開店或打烊時間回傳錯誤訊息", () => {
    expect(
      validateBusinessHoursRow({ weekday: 1, open_time: "", close_time: "19:00", is_closed: false }),
    ).toBe("請填寫開店與打烊時間");
    expect(
      validateBusinessHoursRow({ weekday: 1, open_time: "10:00", close_time: "", is_closed: false }),
    ).toBe("請填寫開店與打烊時間");
  });

  it("打烊時間未晚於開店時間回傳錯誤訊息", () => {
    expect(
      validateBusinessHoursRow({ weekday: 1, open_time: "10:00", close_time: "10:00", is_closed: false }),
    ).toBe("打烊時間須晚於開店時間");
    expect(
      validateBusinessHoursRow({ weekday: 1, open_time: "19:00", close_time: "10:00", is_closed: false }),
    ).toBe("打烊時間須晚於開店時間");
  });

  it("合法的營業時間回傳 null", () => {
    expect(
      validateBusinessHoursRow({ weekday: 1, open_time: "10:00", close_time: "19:00", is_closed: false }),
    ).toBeNull();
  });
});

describe("updateBusinessHours", () => {
  it("成功時對 business_hours 送出 upsert，公休列的時間欄位轉成 null", async () => {
    const rows: BusinessHoursInput[] = [
      { weekday: 0, open_time: "", close_time: "", is_closed: true },
      { weekday: 1, open_time: "10:00", close_time: "19:00", is_closed: false },
    ];
    const { client, from, upsert, select } = fakeUpsertClient({
      data: [{ weekday: 0 }, { weekday: 1 }],
      error: null,
    });

    const result = await updateBusinessHours(client, rows);

    expect(result).toEqual({ ok: true, data: undefined });
    expect(from).toHaveBeenCalledWith("business_hours");
    expect(upsert).toHaveBeenCalledWith(
      [
        { weekday: 0, open_time: null, close_time: null, is_closed: true },
        { weekday: 1, open_time: "10:00", close_time: "19:00", is_closed: false },
      ],
      { onConflict: "weekday" },
    );
    expect(select).toHaveBeenCalledWith("weekday");
  });

  it("寫入失敗（例如違反 business_hours_valid_range）回傳泛用 INTERNAL_ERROR，不外洩底層訊息", async () => {
    const { client } = fakeUpsertClient({
      data: null,
      error: { message: "business_hours_valid_range violated" },
    });

    const result = await updateBusinessHours(client, [
      { weekday: 1, open_time: "10:00", close_time: "19:00", is_closed: false },
    ]);

    expect(result).toEqual({ ok: false, error: { message: "發生未預期的錯誤，請稍後再試。" } });
  });

  it("RLS 悄悄擋下寫入（無 error 但受影響列數與送出列數不符）視為失敗，不誤報成功", async () => {
    const rows: BusinessHoursInput[] = [
      { weekday: 0, open_time: "", close_time: "", is_closed: true },
      { weekday: 1, open_time: "10:00", close_time: "19:00", is_closed: false },
    ];
    // 只有 1 筆實際受影響，但送出了 2 筆——比照 TASK-010 記錄的「RLS 阻擋 UPDATE
    // 回傳成功但空結果」既知行為，不能只看 error 是否為 null。
    const { client } = fakeUpsertClient({ data: [{ weekday: 0 }], error: null });

    const result = await updateBusinessHours(client, rows);

    expect(result).toEqual({ ok: false, error: { message: "發生未預期的錯誤，請稍後再試。" } });
  });
});

describe("isAppointmentOutsideHours", () => {
  const HOURS: BusinessHoursInput = { weekday: 1, open_time: "10:00", close_time: "19:00", is_closed: false };

  it("hours 不存在時視為落在營業時間外", () => {
    expect(isAppointmentOutsideHours("2026-08-10T10:00:00+08:00", "2026-08-10T10:30:00+08:00", undefined)).toBe(
      true,
    );
  });

  it("該天公休時視為落在營業時間外", () => {
    const closed: BusinessHoursInput = { weekday: 1, open_time: "", close_time: "", is_closed: true };
    expect(isAppointmentOutsideHours("2026-08-10T10:00:00+08:00", "2026-08-10T10:30:00+08:00", closed)).toBe(true);
  });

  it("開始時間早於開店時間視為落在營業時間外", () => {
    expect(isAppointmentOutsideHours("2026-08-10T09:30:00+08:00", "2026-08-10T10:00:00+08:00", HOURS)).toBe(true);
  });

  it("結束時間晚於打烊時間視為落在營業時間外", () => {
    expect(isAppointmentOutsideHours("2026-08-10T18:45:00+08:00", "2026-08-10T19:15:00+08:00", HOURS)).toBe(true);
  });

  it("完整落在營業時間內回傳 false", () => {
    expect(isAppointmentOutsideHours("2026-08-10T10:00:00+08:00", "2026-08-10T10:45:00+08:00", HOURS)).toBe(false);
  });

  it("恰好貼齊開店/打烊邊界（[open, close)）回傳 false", () => {
    expect(isAppointmentOutsideHours("2026-08-10T10:00:00+08:00", "2026-08-10T19:00:00+08:00", HOURS)).toBe(false);
  });
});

describe("findAffectedAppointments", () => {
  // 2026-08-10 為週一（比照 tests/admin/reschedule-slots.test.ts 的既有慣例）。
  const NEW_ROWS: BusinessHoursInput[] = [
    { weekday: 1, open_time: "12:00", close_time: "19:00", is_closed: false }, // 原本 10:00 開店，改成 12:00
  ];

  it("回傳落在新營業時間外的預約，過濾掉仍在範圍內的預約", async () => {
    const appointments = [
      { id: "a1", customer_name: "王小美", start_at: "2026-08-10T10:00:00+08:00", end_at: "2026-08-10T10:45:00+08:00" },
      { id: "a2", customer_name: "李大明", start_at: "2026-08-10T13:00:00+08:00", end_at: "2026-08-10T13:45:00+08:00" },
    ];
    const { client, inFilter, gt } = fakeAppointmentsQueryClient({ data: appointments, error: null });

    const result = await findAffectedAppointments(client, NEW_ROWS);

    expect(result).toEqual({
      ok: true,
      data: [{ id: "a1", customer_name: "王小美", start_at: "2026-08-10T10:00:00+08:00" }],
    });
    expect(inFilter).toHaveBeenCalledWith("status", ["pending", "confirmed", "completed"]);
    expect(gt).toHaveBeenCalledWith("start_at", expect.any(String));
  });

  it("查詢失敗回傳泛用 INTERNAL_ERROR", async () => {
    const { client } = fakeAppointmentsQueryClient({ data: null, error: { message: "connection refused" } });

    const result = await findAffectedAppointments(client, NEW_ROWS);

    expect(result).toEqual({ ok: false, error: { message: "發生未預期的錯誤，請稍後再試。" } });
  });

  it("沒有任何預約落在新設定外時回傳空陣列", async () => {
    const appointments = [
      { id: "a1", customer_name: "王小美", start_at: "2026-08-10T13:00:00+08:00", end_at: "2026-08-10T13:45:00+08:00" },
    ];
    const { client } = fakeAppointmentsQueryClient({ data: appointments, error: null });

    const result = await findAffectedAppointments(client, NEW_ROWS);

    expect(result).toEqual({ ok: true, data: [] });
  });
});
