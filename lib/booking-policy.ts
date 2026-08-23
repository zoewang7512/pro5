import type { SupabaseClient } from "@supabase/supabase-js";

// 預約規則設定的資料存取。booking_policy 是雙邊共享的網域資料——RLS 允許 anon 讀取
// （顧客前台 TASK-049 直接消費，用於政策說明文字與可預約時段計算），寫入僅限
// is_admin()（後台 TASK-047）——放在 lib/ 頂層而非 lib/admin/，比照既有
// lib/store-settings.ts 的既有分層方向：app/admin/* 允許 import lib/booking/*，但顧客前台
// 從不 import lib/admin/*，本模組若放進 lib/admin/ 會讓顧客前台形成反向依賴（architect 於
// TASK-046 審查提出的必修意見，理由與 TASK-029 的 store_settings 完全同類）。
//
// booking_policy 是固定單例（僅 1 列，id 恆為 1，見 0008_booking_policy.sql 的 migration
// seed），正常情況下查詢永遠回傳恰好一筆資料。與 store_settings 刻意用「查無資料 →
// 回傳空白降級值」不同，這裡查無資料一律視為錯誤（architect／security-reviewer 於
// TASK-046 審查提出）：booking_policy 顯示的是會直接呈現給顧客的政策文字（例如「請於
// 預約時段前 N 小時完成預約」），若 RLS 設定漂移或表尚未套用 migration 導致查無資料，
// 靜默降級成預設值會讓畫面自信地顯示與後端實際強制規則不一致的政策文字，且沒有任何
// 錯誤跡象——比 store_settings 查無資料只是「品牌顯示回退成純文字標題」危險得多。

export type BookingPolicyError = { message: string };
export type Result<T> = { ok: true; data: T } | { ok: false; error: BookingPolicyError };

const INTERNAL_ERROR: BookingPolicyError = { message: "發生未預期的錯誤，請稍後再試。" };

export type BookingPolicy = {
  min_lead_time_hours: number;
  cancel_window_hours: number | null;
};

export async function getBookingPolicy(supabase: SupabaseClient): Promise<Result<BookingPolicy>> {
  const { data, error } = await supabase
    .from("booking_policy")
    .select("min_lead_time_hours, cancel_window_hours")
    .eq("id", 1)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: INTERNAL_ERROR };
  }

  return { ok: true, data: data as BookingPolicy };
}

// 表單編輯用的形狀：兩個欄位都是文字輸入（TextField），比照
// lib/admin/business-hours.ts 的 BusinessHoursInput 全程維持字串形狀的既有寫法。
// cancel_window_hours 留空字串代表未設定（對應資料庫的 null）。
export type BookingPolicyInput = {
  min_lead_time_hours: string;
  cancel_window_hours: string;
};

const MIN_LEAD_TIME_MAX = 720;
const CANCEL_WINDOW_MAX = 720;

// 對齊 0008_booking_policy.sql 的 check constraint（booking_policy_min_lead_time_range／
// booking_policy_cancel_window_range）：這裡是前端驗證，資料庫層的 constraint 才是唯一的
// 伺服器端防線（寫入路徑是直接 table update，沒有 RPC 可以集中做應用層驗證）。
export function validateMinLeadTimeHours(value: string): string | null {
  if (value.trim().length === 0) return "請輸入最短提前預約時間";
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0 || n > MIN_LEAD_TIME_MAX) {
    return `請輸入 1～${MIN_LEAD_TIME_MAX} 小時之間的整數`;
  }
  return null;
}

export function validateCancelWindowHours(value: string): string | null {
  if (value.trim().length === 0) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > CANCEL_WINDOW_MAX) {
    return `請輸入 0～${CANCEL_WINDOW_MAX} 小時之間的整數，或留空代表不限制`;
  }
  return null;
}

export async function updateBookingPolicy(
  supabase: SupabaseClient,
  input: BookingPolicyInput,
): Promise<Result<void>> {
  // 目前唯一呼叫端（BookingPolicyForm.tsx）已先驗證過，資料庫 check constraint 才是
  // 權威防線；這裡重跑一次驗證是防禦性寫法（security-reviewer 於 TASK-050 Epic
  // 總覽性審查提出），避免未來新增第二個呼叫端時繞過驗證、把錯誤直接推給資料庫變成
  // 籠統的 INTERNAL_ERROR，讓呼叫端拿不到可用於行內錯誤提示的訊息。
  if (validateMinLeadTimeHours(input.min_lead_time_hours) || validateCancelWindowHours(input.cancel_window_hours)) {
    return { ok: false, error: INTERNAL_ERROR };
  }

  // .select("id") 讓我們拿到實際受影響的列數：RLS 擋掉 UPDATE 時 PostgREST 回傳成功但
  // 0 筆受影響，不是拋錯，必須檢查實際受影響列數，不能只看 error 是否為 null（既有教訓，
  // 見 lib/admin/business-hours.ts updateBusinessHours 的既有寫法）。
  const { data, error } = await supabase
    .from("booking_policy")
    .update({
      min_lead_time_hours: Number(input.min_lead_time_hours),
      cancel_window_hours: input.cancel_window_hours.trim().length === 0 ? null : Number(input.cancel_window_hours),
    })
    .eq("id", 1)
    .select("id");

  if (error || !data || data.length !== 1) {
    return { ok: false, error: INTERNAL_ERROR };
  }
  return { ok: true, data: undefined };
}
