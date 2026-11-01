import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createService,
  setServiceActive,
  updateService,
  SERVICE_DESCRIPTION_MAX_LENGTH,
  SERVICE_NAME_MAX_LENGTH,
  validateServiceBuffer,
  validateServiceDescription,
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

  // TASK-123：對齊 0029 的 services_name_length（60，char_length 計碼點、儲存的是 trim 後的值）。
  it("上限 60：剛好 60 字通過、61 字回傳長度錯誤", () => {
    expect(SERVICE_NAME_MAX_LENGTH).toBe(60);
    expect(validateServiceName("剪".repeat(60))).toBeNull();
    expect(validateServiceName("剪".repeat(61))).toBe("名稱長度須在 60 字以內");
  });
  it("以 trim 後長度計算：前後空白不算", () => {
    expect(validateServiceName(`  ${"a".repeat(60)}  `)).toBeNull();
    expect(validateServiceName(`  ${"a".repeat(61)}  `)).toBe("名稱長度須在 60 字以內");
  });
  it("以碼點計算：表情符號算 1 個（與資料庫 char_length 一致）", () => {
    expect("😀".repeat(60).length).toBe(120); // UTF-16 單位是 120，若用 .length 會被誤擋
    expect(validateServiceName("😀".repeat(60))).toBeNull();
    expect(validateServiceName("😀".repeat(61))).toBe("名稱長度須在 60 字以內");
  });
});

describe("validateServiceDescription", () => {
  it("空字串與一般描述通過", () => {
    expect(validateServiceDescription("")).toBeNull();
    expect(validateServiceDescription("含洗髮與造型")).toBeNull();
  });
  it("上限 500：剛好 500 字通過、501 字回傳長度錯誤", () => {
    expect(SERVICE_DESCRIPTION_MAX_LENGTH).toBe(500);
    expect(validateServiceDescription("字".repeat(500))).toBeNull();
    expect(validateServiceDescription("字".repeat(501))).toBe("描述長度須在 500 字以內");
  });
  it("以 trim 後長度計算（寫入前會 trim）", () => {
    expect(validateServiceDescription(`  ${"a".repeat(500)}  `)).toBeNull();
  });
  it("以碼點計算：表情符號算 1 個", () => {
    expect(validateServiceDescription("😀".repeat(500))).toBeNull();
    expect(validateServiceDescription("😀".repeat(501))).toBe("描述長度須在 500 字以內");
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

describe("validateServiceBuffer", () => {
  const MESSAGE = "緩衝時間需為 0～120 的整數分鐘";
  it("0 與 120（邊界）通過", () => {
    expect(validateServiceBuffer("0")).toBeNull();
    expect(validateServiceBuffer("15")).toBeNull();
    expect(validateServiceBuffer("120")).toBeNull();
  });
  it("負數回傳錯誤", () => {
    expect(validateServiceBuffer("-1")).toBe(MESSAGE);
  });
  it("超過 120 回傳錯誤", () => {
    expect(validateServiceBuffer("121")).toBe(MESSAGE);
  });
  it("小數回傳錯誤", () => {
    expect(validateServiceBuffer("1.5")).toBe(MESSAGE);
  });
  it("空字串與純空白不會被當成 0", () => {
    expect(validateServiceBuffer("")).toBe(MESSAGE);
    expect(validateServiceBuffer("  ")).toBe(MESSAGE);
  });
  it("非數字回傳錯誤", () => {
    expect(validateServiceBuffer("abc")).toBe(MESSAGE);
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

const VALID_INPUT = { name: "經典剪髮", price: 600, durationMinutes: 45, bufferMinutes: 15, description: "" };

describe("createService", () => {
  it("成功時回傳 ok:true，並把 bufferMinutes 寫入 buffer_minutes", async () => {
    const fake = fakeInsertClient({ data: [{ id: "1" }], error: null });
    const result = await createService(fake.client, VALID_INPUT);
    expect(result.ok).toBe(true);
    expect(fake.insert).toHaveBeenCalledWith(expect.objectContaining({ buffer_minutes: 15 }));
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
  it("成功時回傳 ok:true，並把 bufferMinutes 寫入 buffer_minutes", async () => {
    const fake = fakeUpdateClient({ data: [{ id: "1" }], error: null });
    const result = await updateService(fake.client, "1", VALID_INPUT);
    expect(result.ok).toBe(true);
    expect(fake.update).toHaveBeenCalledWith(expect.objectContaining({ buffer_minutes: 15 }));
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
