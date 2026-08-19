import type { SupabaseClient } from "@supabase/supabase-js";
import type { Service } from "@/lib/booking/types";
import type { Result } from "./appointments";

// 服務項目管理頁的資料存取。與顧客端 lib/booking/api.ts 的 getServices() 不同之處：
// 這裡不過濾 is_active，後台需要同時看到上架與下架中的項目。

const INTERNAL_ERROR = { message: "發生未預期的錯誤，請稍後再試。" };

export async function listServices(supabase: SupabaseClient): Promise<Result<Service[]>> {
  const { data, error } = await supabase
    .from("services")
    .select("id, name, description, price, duration_minutes, is_active, sort_order")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    return { ok: false, error: INTERNAL_ERROR };
  }

  return { ok: true, data: (data ?? []) as Service[] };
}

// 新增/編輯共用的表單驗證：名稱 trim 後不可為空白（資料庫僅 not null，允許純空白字串，
// 比照 lib/store-settings.ts validateStoreName 的既有教訓，應用層需額外擋下純空白）；
// 價格與時長對齊 0001_core_schema.sql 的 check constraint（price >= 0／duration_minutes > 0），
// 這裡的驗證是體驗優化，資料庫仍是最終防線。
export function validateServiceName(name: string): string | null {
  return name.trim().length > 0 ? null : "名稱為必填";
}

export function validateServicePrice(price: number): string | null {
  if (!Number.isFinite(price)) return "請輸入價格";
  return price >= 0 ? null : "價格需大於等於 0";
}

export function validateServiceDuration(durationMinutes: number): string | null {
  if (!Number.isInteger(durationMinutes)) return "請輸入時長";
  return durationMinutes > 0 ? null : "時長需大於 0";
}

export type ServiceInput = {
  name: string;
  price: number;
  durationMinutes: number;
  description: string;
};

// 新增服務項目：is_active／sort_order 皆不指定，交給資料庫既有預設值
// （is_active 預設 true、sort_order 預設 0，見 0001_core_schema.sql）。
export async function createService(supabase: SupabaseClient, input: ServiceInput): Promise<Result<void>> {
  const { data, error } = await supabase
    .from("services")
    .insert({
      name: input.name.trim(),
      price: input.price,
      duration_minutes: input.durationMinutes,
      description: input.description.trim() || null,
    })
    .select("id");

  if (error || !data || data.length !== 1) {
    return { ok: false, error: INTERNAL_ERROR };
  }
  return { ok: true, data: undefined };
}

// 編輯只更新名稱/價格/時長/描述，不觸碰 is_active（TASK-036 負責）與 sort_order
// （本批次不提供排序介面，見 feature-spec 非目標）。RLS 擋下 UPDATE 時 PostgREST
// 回傳成功但 0 筆受影響，用 .select("id") 檢查實際受影響列數，比照
// lib/store-settings.ts updateStoreSettingsBasicInfo 的既有教訓。
export async function updateService(
  supabase: SupabaseClient,
  id: string,
  input: ServiceInput,
): Promise<Result<void>> {
  const { data, error } = await supabase
    .from("services")
    .update({
      name: input.name.trim(),
      price: input.price,
      duration_minutes: input.durationMinutes,
      description: input.description.trim() || null,
    })
    .eq("id", id)
    .select("id");

  if (error || !data || data.length !== 1) {
    return { ok: false, error: INTERNAL_ERROR };
  }
  return { ok: true, data: undefined };
}

// 下架／重新上架：只切換 is_active，不觸碰 name／price／duration_minutes／description／
// sort_order 等其他欄位；不影響 appointments 既有資料（沒有任何串聯寫入）。同樣用
// .select("id") 檢查實際受影響列數。
export async function setServiceActive(
  supabase: SupabaseClient,
  id: string,
  isActive: boolean,
): Promise<Result<void>> {
  const { data, error } = await supabase.from("services").update({ is_active: isActive }).eq("id", id).select("id");

  if (error || !data || data.length !== 1) {
    return { ok: false, error: INTERNAL_ERROR };
  }
  return { ok: true, data: undefined };
}
