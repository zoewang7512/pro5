import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createService,
  setServiceActive,
  updateService,
  validateServiceDuration,
  validateServiceName,
  validateServicePrice,
} from "@/lib/admin/services";

describe("validateServiceName", () => {
  it("非空白名稱通過", () => {
    expect(validateServiceName("經典剪髮")).toBeNull();
  });
  it("空字串回傳錯誤", () => {
    expect(validateServiceName("")).toBe("名稱為必填");
  });
  it("純空白字串回傳錯誤", () => {
    expect(validateServiceName("   ")).toBe("名稱為必填");
  });
});

describe("validateServicePrice", () => {
  it("0 或正數通過", () => {
    expect(validateServicePrice(0)).toBeNull();
    expect(validateServicePrice(600)).toBeNull();
  });
  it("負數回傳錯誤", () => {
    expect(validateServicePrice(-1)).toBe("價格需大於等於 0");
  });
  it("NaN 回傳錯誤", () => {
    expect(validateServicePrice(Number.NaN)).toBe("請輸入價格");
  });
});

describe("validateServiceDuration", () => {
  it("正整數通過", () => {
    expect(validateServiceDuration(45)).toBeNull();
  });
  it("0 回傳錯誤", () => {
    expect(validateServiceDuration(0)).toBe("時長需大於 0");
  });
  it("非整數回傳錯誤", () => {
    expect(validateServiceDuration(45.5)).toBe("請輸入時長");
  });
  it("NaN 回傳錯誤", () => {
    expect(validateServiceDuration(Number.NaN)).toBe("請輸入時長");
  });
});

// 比照 tests/admin/business-hours.test.ts 的 fake client 模式：insert／update 皆掛在
// 同一個可鏈式呼叫的物件上，最終 resolve 成 { data, error }。
function fakeInsertClient(result: { data: unknown; error: unknown }) {
  const select = vi.fn().mockResolvedValue(result);
  const insert = vi.fn(() => ({ select }));
  const from = vi.fn(() => ({ insert }));
  return { client: { from } as unknown as SupabaseClient, from, insert, select };
}

function fakeUpdateClient(result: { data: unknown; error: unknown }) {
  const select = vi.fn().mockResolvedValue(result);
  const eq = vi.fn(() => ({ select }));
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ update }));
  return { client: { from } as unknown as SupabaseClient, from, update, eq, select };
}

const VALID_INPUT = { name: "經典剪髮", price: 600, durationMinutes: 45, description: "" };

describe("createService", () => {
  it("成功時回傳 ok:true", async () => {
    const fake = fakeInsertClient({ data: [{ id: "1" }], error: null });
    const result = await createService(fake.client, VALID_INPUT);
    expect(result.ok).toBe(true);
  });

  it("RLS 擋下（0 筆受影響）時回傳 ok:false，不誤報成功", async () => {
    const fake = fakeInsertClient({ data: [], error: null });
    const result = await createService(fake.client, VALID_INPUT);
    expect(result.ok).toBe(false);
  });

  it("資料庫錯誤時回傳 ok:false", async () => {
    const fake = fakeInsertClient({ data: null, error: { message: "boom" } });
    const result = await createService(fake.client, VALID_INPUT);
    expect(result.ok).toBe(false);
  });
});

describe("updateService", () => {
  it("成功時回傳 ok:true", async () => {
    const fake = fakeUpdateClient({ data: [{ id: "1" }], error: null });
    const result = await updateService(fake.client, "1", VALID_INPUT);
    expect(result.ok).toBe(true);
  });

  it("RLS 擋下（0 筆受影響）時回傳 ok:false，不誤報成功", async () => {
    const fake = fakeUpdateClient({ data: [], error: null });
    const result = await updateService(fake.client, "1", VALID_INPUT);
    expect(result.ok).toBe(false);
  });
});

describe("setServiceActive", () => {
  it("成功下架（is_active:false）時回傳 ok:true 並只更新 is_active 欄位", async () => {
    const fake = fakeUpdateClient({ data: [{ id: "1" }], error: null });
    const result = await setServiceActive(fake.client, "1", false);
    expect(result.ok).toBe(true);
    expect(fake.update).toHaveBeenCalledWith({ is_active: false });
  });

  it("成功重新上架（is_active:true）時回傳 ok:true", async () => {
    const fake = fakeUpdateClient({ data: [{ id: "1" }], error: null });
    const result = await setServiceActive(fake.client, "1", true);
    expect(result.ok).toBe(true);
    expect(fake.update).toHaveBeenCalledWith({ is_active: true });
  });

  it("RLS 擋下（0 筆受影響）時回傳 ok:false，不誤報成功", async () => {
    const fake = fakeUpdateClient({ data: [], error: null });
    const result = await setServiceActive(fake.client, "1", false);
    expect(result.ok).toBe(false);
  });
});
