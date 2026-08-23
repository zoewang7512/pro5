import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getBookingPolicy,
  updateBookingPolicy,
  validateCancelWindowHours,
  validateMinLeadTimeHours,
  type BookingPolicyInput,
} from "../lib/booking-policy";

// 比照 tests/admin/business-hours.test.ts 的 fake client 模式。

function fakeMaybeSingleClient(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { client: { from } as unknown as SupabaseClient, from, select, eq, maybeSingle };
}

function fakeUpdateClient(result: { data: unknown; error: unknown }) {
  const select = vi.fn().mockResolvedValue(result);
  const eq = vi.fn(() => ({ select }));
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ update }));
  return { client: { from } as unknown as SupabaseClient, from, update, eq, select };
}

describe("getBookingPolicy", () => {
  it("成功時回傳 booking_policy 資料", async () => {
    const row = { min_lead_time_hours: 2, cancel_window_hours: 24 };
    const { client, from } = fakeMaybeSingleClient({ data: row, error: null });

    const result = await getBookingPolicy(client);

    expect(result).toEqual({ ok: true, data: row });
    expect(from).toHaveBeenCalledWith("booking_policy");
  });

  it("查詢失敗回傳泛用 INTERNAL_ERROR，不外洩底層訊息", async () => {
    const { client } = fakeMaybeSingleClient({ data: null, error: { message: "connection refused" } });

    const result = await getBookingPolicy(client);

    expect(result).toEqual({ ok: false, error: { message: "發生未預期的錯誤，請稍後再試。" } });
  });

  it("查無資料視為錯誤，不靜默降級成預設值（單例列理論上必然存在，查無資料是異常）", async () => {
    const { client } = fakeMaybeSingleClient({ data: null, error: null });

    const result = await getBookingPolicy(client);

    expect(result).toEqual({ ok: false, error: { message: "發生未預期的錯誤，請稍後再試。" } });
  });
});

describe("validateMinLeadTimeHours", () => {
  it("空字串回傳必填錯誤", () => {
    expect(validateMinLeadTimeHours("")).toBe("請輸入最短提前預約時間");
    expect(validateMinLeadTimeHours("  ")).toBe("請輸入最短提前預約時間");
  });

  it("非整數、0、負數、超過 720 回傳範圍錯誤", () => {
    expect(validateMinLeadTimeHours("0")).toBe("請輸入 1～720 小時之間的整數");
    expect(validateMinLeadTimeHours("-1")).toBe("請輸入 1～720 小時之間的整數");
    expect(validateMinLeadTimeHours("721")).toBe("請輸入 1～720 小時之間的整數");
    expect(validateMinLeadTimeHours("1.5")).toBe("請輸入 1～720 小時之間的整數");
    expect(validateMinLeadTimeHours("abc")).toBe("請輸入 1～720 小時之間的整數");
  });

  it("1～720 之間的整數回傳 null", () => {
    expect(validateMinLeadTimeHours("1")).toBeNull();
    expect(validateMinLeadTimeHours("720")).toBeNull();
    expect(validateMinLeadTimeHours("2")).toBeNull();
  });
});

describe("validateCancelWindowHours", () => {
  it("空字串（留空）合法，回傳 null", () => {
    expect(validateCancelWindowHours("")).toBeNull();
    expect(validateCancelWindowHours("  ")).toBeNull();
  });

  it("非整數、負數、超過 720 回傳範圍錯誤", () => {
    expect(validateCancelWindowHours("-1")).toBe("請輸入 0～720 小時之間的整數，或留空代表不限制");
    expect(validateCancelWindowHours("721")).toBe("請輸入 0～720 小時之間的整數，或留空代表不限制");
    expect(validateCancelWindowHours("1.5")).toBe("請輸入 0～720 小時之間的整數，或留空代表不限制");
  });

  it("0～720 之間的整數回傳 null", () => {
    expect(validateCancelWindowHours("0")).toBeNull();
    expect(validateCancelWindowHours("24")).toBeNull();
    expect(validateCancelWindowHours("720")).toBeNull();
  });
});

describe("updateBookingPolicy", () => {
  it("成功時對 booking_policy 送出 update，留空的 cancel_window_hours 轉成 null", async () => {
    const input: BookingPolicyInput = { min_lead_time_hours: "2", cancel_window_hours: "" };
    const { client, from, update, eq, select } = fakeUpdateClient({ data: [{ id: 1 }], error: null });

    const result = await updateBookingPolicy(client, input);

    expect(result).toEqual({ ok: true, data: undefined });
    expect(from).toHaveBeenCalledWith("booking_policy");
    expect(update).toHaveBeenCalledWith({ min_lead_time_hours: 2, cancel_window_hours: null });
    expect(eq).toHaveBeenCalledWith("id", 1);
    expect(select).toHaveBeenCalledWith("id");
  });

  it("填寫的 cancel_window_hours 轉成數字送出", async () => {
    const input: BookingPolicyInput = { min_lead_time_hours: "3", cancel_window_hours: "24" };
    const { client, update } = fakeUpdateClient({ data: [{ id: 1 }], error: null });

    await updateBookingPolicy(client, input);

    expect(update).toHaveBeenCalledWith({ min_lead_time_hours: 3, cancel_window_hours: 24 });
  });

  it("寫入失敗（例如違反 check constraint）回傳泛用 INTERNAL_ERROR，不外洩底層訊息", async () => {
    const { client } = fakeUpdateClient({
      data: null,
      error: { message: "booking_policy_min_lead_time_range violated" },
    });

    const result = await updateBookingPolicy(client, { min_lead_time_hours: "2", cancel_window_hours: "" });

    expect(result).toEqual({ ok: false, error: { message: "發生未預期的錯誤，請稍後再試。" } });
  });

  it("RLS 悄悄擋下寫入（無 error 但受影響列數不是 1）視為失敗，不誤報成功", async () => {
    const { client } = fakeUpdateClient({ data: [], error: null });

    const result = await updateBookingPolicy(client, { min_lead_time_hours: "2", cancel_window_hours: "" });

    expect(result).toEqual({ ok: false, error: { message: "發生未預期的錯誤，請稍後再試。" } });
  });
});
