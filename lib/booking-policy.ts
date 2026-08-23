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
