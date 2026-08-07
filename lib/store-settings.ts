import type { SupabaseClient } from "@supabase/supabase-js";

// 商店基本資料的資料存取。store_settings 是雙邊共享的網域資料——RLS 允許 anon 讀取
// （顧客前台 TASK-032 直接消費），寫入僅限 is_admin()（後台 TASK-030／TASK-031）——
// 放在 lib/ 頂層而非 lib/admin/，比照既有 lib/booking/ 與 lib/admin/ 的既有分層方向：
// app/admin/* 允許 import lib/booking/*，但顧客前台從不 import lib/admin/*，本模組若放進
// lib/admin/ 会讓顧客前台形成反向依賴（architect 於 TASK-029 審查提出的必修意見）。
//
// store_settings 是固定單例（僅 1 列，id 恆為 1，見 0006_store_settings.sql 的 migration
// seed），正常情況下查詢永遠回傳恰好一筆資料；用 .maybeSingle() 而非 .single()，讓「查無
// 資料」在 feature-spec 明訂的降級路徑（後台顯示空白表單、前台回退預設標題）上是可以由型別
// 直接表達的正常分支，不必無條件依賴這個單例不變量恆成立（architect 建議）。
//
// 未來 TASK-030 新增寫入函式時，比照 lib/admin/business-hours.ts 的既有教訓：RLS 擋掉
// UPDATE 時 PostgREST 預設回傳成功但 0 筆受影響，必須用 .select() 檢查實際受影響列數，
// 不能只看 error 是否為 null（否則會對「其實被 RLS 悄悄擋下」的寫入誤報成功）。

export type StoreSettingsError = { message: string };
export type Result<T> = { ok: true; data: T } | { ok: false; error: StoreSettingsError };

const INTERNAL_ERROR: StoreSettingsError = { message: "發生未預期的錯誤，請稍後再試。" };

export type StoreSettings = {
  name: string;
  address: string | null;
  phone: string | null;
  description: string | null;
  logo_url: string | null;
  cover_image_url: string | null;
};

export async function getStoreSettings(supabase: SupabaseClient): Promise<Result<StoreSettings>> {
  const { data, error } = await supabase
    .from("store_settings")
    .select("name, address, phone, description, logo_url, cover_image_url")
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    return { ok: false, error: INTERNAL_ERROR };
  }
  if (!data) {
    return { ok: true, data: { name: "", address: null, phone: null, description: null, logo_url: null, cover_image_url: null } };
  }

  return { ok: true, data: data as StoreSettings };
}

// 「基本資訊」四欄位的前端驗證。店名必填、其餘選填。長度上限與
// 0006_store_settings.sql 已加上的 store_settings_description_length／
// store_settings_phone_length check constraint 對齊（見該 migration 的說明：
// name 因為 seed 列本身就是空字串，資料庫層無法同時允許這一列存在又擋非空白，
// 「店名必填」只能靠這裡的應用層驗證，寫入路徑是直接 table update、沒有 RPC
// 可以集中做伺服器端驗證）。
const PHONE_MAX_LENGTH = 20;
const DESCRIPTION_MAX_LENGTH = 500;
const PHONE_PATTERN = /^[0-9+\-\s]*$/;

export function validateStoreName(name: string): string | null {
  return name.trim().length > 0 ? null : "店名為必填";
}

export function validateStorePhone(phone: string): string | null {
  if (phone.length === 0) return null;
  if (phone.length > PHONE_MAX_LENGTH) return `電話長度須在 ${PHONE_MAX_LENGTH} 字以內`;
  if (!PHONE_PATTERN.test(phone)) return "電話僅能包含數字、+、-、空格";
  return null;
}

export function validateStoreDescription(description: string): string | null {
  return description.length <= DESCRIPTION_MAX_LENGTH ? null : `簡介長度須在 ${DESCRIPTION_MAX_LENGTH} 字以內`;
}

export type StoreSettingsBasicInfo = {
  name: string;
  address: string;
  phone: string;
  description: string;
};

export async function updateStoreSettingsBasicInfo(
  supabase: SupabaseClient,
  input: StoreSettingsBasicInfo,
): Promise<Result<void>> {
  // RLS 擋掉 UPDATE 時 PostgREST 回傳成功但 0 筆受影響，這裡用 .select("id") 檢查實際
  // 受影響列數，不能只看 error 是否為 null（見檔頭既有教訓，比照 lib/admin/business-hours.ts
  // 既有寫法）。
  const { data, error } = await supabase
    .from("store_settings")
    .update({
      name: input.name.trim(),
      address: input.address.trim() || null,
      phone: input.phone.trim() || null,
      description: input.description.trim() || null,
    })
    .eq("id", 1)
    .select("id");

  if (error || !data || data.length !== 1) {
    return { ok: false, error: INTERNAL_ERROR };
  }

  return { ok: true, data: undefined };
}

// 品牌圖片（Logo／封面圖）上傳。格式與大小限制與 0006_store_settings.sql 的
// storage.buckets file_size_limit／allowed_mime_types 一致（bucket 層是伺服器端強制的
// 最終防線，這裡的前端驗證只是體驗優化，讓使用者不必等一趟網路來回就知道檔案不符）。
// 上傳路徑固定為 `<kind>/<uuid>.<ext>`，不接受使用者輸入的檔名——避免路徑穿越，也對齊
// bucket 的路徑前綴限制 policy（只允許 logo/、cover/ 兩個前綴）。
const ALLOWED_MIME_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

export type StoreImageKind = "logo" | "cover";

export function validateStoreImageFile(file: File): string | null {
  // 用 Object.hasOwn 而非 `in`：`in` 會命中 Object.prototype 繼承屬性（例如
  // file.type === "constructor" 會被 `in` 判定為存在），讓白名單名不符實
  // （security-reviewer TASK-031 審查發現）。
  if (!Object.hasOwn(ALLOWED_MIME_TYPES, file.type)) return "檔案格式需為 JPG／PNG／WebP";
  if (file.size > MAX_FILE_SIZE_BYTES) return "檔案大小需小於 5MB";
  return null;
}

export async function uploadStoreImage(
  supabase: SupabaseClient,
  kind: StoreImageKind,
  file: File,
): Promise<Result<string>> {
  const validationError = validateStoreImageFile(file);
  if (validationError) {
    return { ok: false, error: { message: validationError } };
  }

  const extension = ALLOWED_MIME_TYPES[file.type];
  const path = `${kind}/${crypto.randomUUID()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from("store-assets")
    .upload(path, file, { contentType: file.type });
  if (uploadError) {
    return { ok: false, error: INTERNAL_ERROR };
  }

  const { data: publicUrlData } = supabase.storage.from("store-assets").getPublicUrl(path);
  const column = kind === "logo" ? "logo_url" : "cover_image_url";

  const { data, error } = await supabase
    .from("store_settings")
    .update({ [column]: publicUrlData.publicUrl })
    .eq("id", 1)
    .select("id");
  if (error || !data || data.length !== 1) {
    return { ok: false, error: INTERNAL_ERROR };
  }

  return { ok: true, data: publicUrlData.publicUrl };
}

// 「移除」只清空 store_settings 對應 URL 欄位，不刪除 Storage 裡的舊檔案物件——已知的
// 孤兒檔案殘留風險，見 TASK-031 任務卡的假設與殘留風險記錄，非本函式遺漏。
export async function removeStoreImage(supabase: SupabaseClient, kind: StoreImageKind): Promise<Result<void>> {
  const column = kind === "logo" ? "logo_url" : "cover_image_url";

  const { data, error } = await supabase
    .from("store_settings")
    .update({ [column]: null })
    .eq("id", 1)
    .select("id");
  if (error || !data || data.length !== 1) {
    return { ok: false, error: INTERNAL_ERROR };
  }

  return { ok: true, data: undefined };
}
