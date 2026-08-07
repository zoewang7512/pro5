import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  removeStoreImage,
  uploadStoreImage,
  validateStoreDescription,
  validateStoreImageFile,
  validateStoreName,
  validateStorePhone,
} from "../lib/store-settings";

describe("validateStoreName", () => {
  it("非空白店名通過驗證", () => {
    expect(validateStoreName("王牌理髮廳")).toBeNull();
  });

  it("空字串回傳必填錯誤", () => {
    expect(validateStoreName("")).toBe("店名為必填");
  });

  it("只有空白字元視為未填", () => {
    expect(validateStoreName("   ")).toBe("店名為必填");
  });
});

describe("validateStorePhone", () => {
  it("空字串（選填未填）通過驗證", () => {
    expect(validateStorePhone("")).toBeNull();
  });

  it("合法格式（數字、+、-、空格）通過驗證", () => {
    expect(validateStorePhone("02-1234-5678")).toBeNull();
    expect(validateStorePhone("+886 912 345 678")).toBeNull();
  });

  it("超過長度上限回傳錯誤", () => {
    expect(validateStorePhone("1".repeat(21))).toBe("電話長度須在 20 字以內");
  });

  it("包含字母等不允許字元回傳錯誤", () => {
    expect(validateStorePhone("call-me-now")).toBe("電話僅能包含數字、+、-、空格");
  });
});

describe("validateStoreDescription", () => {
  it("空字串通過驗證", () => {
    expect(validateStoreDescription("")).toBeNull();
  });

  it("500 字以內通過驗證", () => {
    expect(validateStoreDescription("a".repeat(500))).toBeNull();
  });

  it("超過 500 字回傳錯誤", () => {
    expect(validateStoreDescription("a".repeat(501))).toBe("簡介長度須在 500 字以內");
  });
});

function makeFile(type: string, sizeBytes: number): File {
  return new File([new Uint8Array(sizeBytes)], "file", { type });
}

describe("validateStoreImageFile", () => {
  it("允許的格式（jpg/png/webp）且未超過大小上限通過驗證", () => {
    expect(validateStoreImageFile(makeFile("image/jpeg", 1024))).toBeNull();
    expect(validateStoreImageFile(makeFile("image/png", 1024))).toBeNull();
    expect(validateStoreImageFile(makeFile("image/webp", 1024))).toBeNull();
  });

  it("不允許的格式回傳錯誤", () => {
    expect(validateStoreImageFile(makeFile("image/svg+xml", 1024))).toBe("檔案格式需為 JPG／PNG／WebP");
    expect(validateStoreImageFile(makeFile("text/plain", 1024))).toBe("檔案格式需為 JPG／PNG／WebP");
  });

  it("超過 5MB 回傳錯誤", () => {
    expect(validateStoreImageFile(makeFile("image/png", 5 * 1024 * 1024 + 1))).toBe("檔案大小需小於 5MB");
  });

  it("剛好 5MB 通過驗證", () => {
    expect(validateStoreImageFile(makeFile("image/png", 5 * 1024 * 1024))).toBeNull();
  });

  it("Object.prototype 繼承屬性（如 constructor）不會被誤判為允許格式（security-reviewer TASK-031 審查發現：`in` 運算子會命中繼承屬性，改用 Object.hasOwn 修正）", () => {
    expect(validateStoreImageFile(makeFile("constructor", 1024))).toBe("檔案格式需為 JPG／PNG／WebP");
    expect(validateStoreImageFile(makeFile("toString", 1024))).toBe("檔案格式需為 JPG／PNG／WebP");
    expect(validateStoreImageFile(makeFile("__proto__", 1024))).toBe("檔案格式需為 JPG／PNG／WebP");
  });
});

// 比照 tests/admin/business-hours.test.ts 的 fake client 模式。uploadStoreImage 同時用到
// supabase.storage（upload／getPublicUrl）與 supabase.from（table update），兩條鏈各自
// 假造。
function fakeStoreImageClient(options: {
  uploadError?: { message: string } | null;
  publicUrl?: string;
  updateResult?: { data: unknown; error: unknown };
}) {
  const uploadError = options.uploadError ?? null;
  const publicUrl = options.publicUrl ?? "https://example.invalid/store-assets/logo/generated.png";
  const updateResult = options.updateResult ?? { data: [{ id: 1 }], error: null };

  const upload = vi.fn().mockResolvedValue({ error: uploadError });
  const getPublicUrl = vi.fn().mockReturnValue({ data: { publicUrl } });
  const storageFrom = vi.fn(() => ({ upload, getPublicUrl }));

  const select = vi.fn().mockResolvedValue(updateResult);
  const eq = vi.fn(() => ({ select }));
  const update = vi.fn(() => ({ eq }));
  const tableFrom = vi.fn(() => ({ update }));

  const client = {
    storage: { from: storageFrom },
    from: tableFrom,
  } as unknown as SupabaseClient;

  return { client, upload, getPublicUrl, storageFrom, update, eq, select, tableFrom };
}

function pngFile(name = "logo.png") {
  return new File(["fake-bytes"], name, { type: "image/png" });
}

describe("uploadStoreImage", () => {
  it("格式不符時直接回傳錯誤，不呼叫 storage.upload", async () => {
    const { client, upload } = fakeStoreImageClient({});
    const badFile = new File(["x"], "note.txt", { type: "text/plain" });

    const result = await uploadStoreImage(client, "logo", badFile);

    expect(result.ok).toBe(false);
    expect(upload).not.toHaveBeenCalled();
  });

  it("成功上傳後，路徑固定為 logo/<uuid>.png，與原始檔名無關（核心不變量：使用者可控的檔名不會進入儲存路徑）", async () => {
    const { client, upload, tableFrom } = fakeStoreImageClient({});
    // 檔名刻意放進路徑穿越字元，驗證完全不會被用來組路徑。
    const maliciousNamedFile = new File(["x"], "../../evil.php.png", { type: "image/png" });

    const result = await uploadStoreImage(client, "logo", maliciousNamedFile);

    expect(result.ok).toBe(true);
    const [uploadedPath, , uploadOptions] = upload.mock.calls[0];
    expect(uploadedPath).toMatch(/^logo\/[0-9a-f-]{36}\.png$/);
    expect(uploadOptions).toEqual({ contentType: "image/png" });
    expect(tableFrom).toHaveBeenCalledWith("store_settings");
  });

  it("依 kind 更新正確的欄位（logo_url／cover_image_url）", async () => {
    const { client, update } = fakeStoreImageClient({});
    await uploadStoreImage(client, "cover", pngFile());
    expect(update).toHaveBeenCalledWith({ cover_image_url: expect.any(String) });
  });

  it("storage.upload 失敗時回傳泛用錯誤，不寫入 store_settings", async () => {
    const { client, tableFrom } = fakeStoreImageClient({ uploadError: { message: "network error" } });

    const result = await uploadStoreImage(client, "logo", pngFile());

    expect(result).toEqual({ ok: false, error: { message: "發生未預期的錯誤，請稍後再試。" } });
    expect(tableFrom).not.toHaveBeenCalled();
  });

  it("store_settings 更新受影響列數為 0（RLS 靜默擋下）時回傳泛用錯誤，不誤報成功", async () => {
    const { client } = fakeStoreImageClient({ updateResult: { data: [], error: null } });

    const result = await uploadStoreImage(client, "logo", pngFile());

    expect(result).toEqual({ ok: false, error: { message: "發生未預期的錯誤，請稍後再試。" } });
  });
});

describe("removeStoreImage", () => {
  function fakeRemoveClient(updateResult: { data: unknown; error: unknown }) {
    const select = vi.fn().mockResolvedValue(updateResult);
    const eq = vi.fn(() => ({ select }));
    const update = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ update }));
    return { client: { from } as unknown as SupabaseClient, from, update, eq };
  }

  it("成功時把對應欄位清空為 null", async () => {
    const { client, update } = fakeRemoveClient({ data: [{ id: 1 }], error: null });

    const result = await removeStoreImage(client, "cover");

    expect(result).toEqual({ ok: true, data: undefined });
    expect(update).toHaveBeenCalledWith({ cover_image_url: null });
  });

  it("受影響列數為 0 時回傳泛用錯誤，不誤報成功", async () => {
    const { client } = fakeRemoveClient({ data: [], error: null });

    const result = await removeStoreImage(client, "logo");

    expect(result).toEqual({ ok: false, error: { message: "發生未預期的錯誤，請稍後再試。" } });
  });
});
