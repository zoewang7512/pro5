import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminError, Result } from "./appointments";
import type { AffectedAppointment } from "./business-hours";
import { addDays } from "./week-range";

// 公休日設定的資料存取。查詢與寫入風格比照 lib/admin/business-hours.ts。

const INTERNAL_ERROR: AdminError = { message: "發生未預期的錯誤，請稍後再試。" };

// 比照 lib/admin/business-hours.ts 的 AFFECTED_APPOINTMENTS_LIMIT。
const AFFECTED_APPOINTMENTS_LIMIT = 200;

export type ClosedDate = { date: string };

export async function getAllClosedDates(supabase: SupabaseClient): Promise<Result<ClosedDate[]>> {
  const { data, error } = await supabase
    .from("closed_dates")
    .select("date")
    .order("date", { ascending: true });

  if (error) {
    return { ok: false, error: INTERNAL_ERROR };
  }

  return { ok: true, data: (data ?? []) as ClosedDate[] };
}

// 重複新增同一天是安全的 no-op，而不是報錯——呼叫端（月曆點選「已標記的日期」）在
// UI 層會走移除而非新增路徑，這裡是最後一層防呆，不是主要防重複機制。
// 用 ignoreDuplicates:false（預設 merge，即 ON CONFLICT DO UPDATE）而非 true
// （ON CONFLICT DO NOTHING）：DO NOTHING 在衝突時完全不回傳列，會讓下面「至少 1 筆」的
// 寫入驗證誤判成失敗；DO UPDATE 對單欄位主鍵的表是無害的 no-op 覆寫，但仍會回傳該列，
// 也仍然受 RLS 的 UPDATE using 檢查保護（非 admin 衝突時一樣會被擋）。
// .select("date") 比照 updateBusinessHours 的既有教訓：RLS 阻擋寫入時可能回傳成功但
// 空結果，只看 error 是否為 null 不夠，要確認至少有 1 筆實際回傳。
export async function addClosedDate(supabase: SupabaseClient, date: string): Promise<Result<void>> {
  const { data, error } = await supabase
    .from("closed_dates")
    .upsert({ date }, { onConflict: "date", ignoreDuplicates: false })
    .select("date");

  if (error || !data || data.length === 0) {
    return { ok: false, error: INTERNAL_ERROR };
  }

  return { ok: true, data: undefined };
}

// 刪除 0 筆或 1 筆都視為成功（冪等，移除一個不存在的日期不是錯誤）——但同 updateBusinessHours
// 的既有教訓，RLS 阻擋 DELETE 一樣是回傳成功但空結果，不是拋錯，不能只看 error 是否為
// null，否則非 admin 的已登入使用者刪除失敗時，畫面會顯示「已移除」但該日其實仍是公休。
// 用 isDateClosed 複查：0 筆回傳時，若該日期確實已不存在才視為成功，仍存在則視為失敗。
export async function removeClosedDate(supabase: SupabaseClient, date: string): Promise<Result<void>> {
  const { data, error } = await supabase.from("closed_dates").delete().eq("date", date).select("date");

  if (error) {
    return { ok: false, error: INTERNAL_ERROR };
  }

  if (!data || data.length === 0) {
    const stillClosed = await isDateClosed(supabase, date);
    if (!stillClosed.ok) {
      return stillClosed;
    }
    if (stillClosed.data) {
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  return { ok: true, data: undefined };
}

export async function isDateClosed(supabase: SupabaseClient, date: string): Promise<Result<boolean>> {
  const { data, error } = await supabase
    .from("closed_dates")
    .select("date")
    .eq("date", date)
    .maybeSingle();

  if (error) {
    return { ok: false, error: INTERNAL_ERROR };
  }

  return { ok: true, data: data !== null };
}

export async function getClosedDatesInRange(
  supabase: SupabaseClient,
  startDate: string,
  endDate: string,
): Promise<Result<Set<string>>> {
  const { data, error } = await supabase
    .from("closed_dates")
    .select("date")
    .gte("date", startDate)
    .lte("date", endDate);

  if (error) {
    return { ok: false, error: INTERNAL_ERROR };
  }

  return { ok: true, data: new Set(((data ?? []) as ClosedDate[]).map((row) => row.date)) };
}

// 邏輯比照 findAffectedAppointments（lib/admin/business-hours.ts）：查詢
// pending/confirmed/completed 且未來的預約，回傳最小化欄位。差異：這裡只需要比對
// 「單一日期」，該日期即將變成整天公休，落在當天範圍內的預約全部視為受影響，不需要
// 逐筆比對新舊營業時間；單一日期本來就有界（appointments_no_overlap 保證同一天不重疊
// 的未取消預約數量有限），但仍套用與範本相同的 200 筆上限，保持同一道防線（避免把含
// 姓名的資料無邊界下載到瀏覽器）。
export async function findAffectedAppointmentsForClosedDate(
  supabase: SupabaseClient,
  date: string,
): Promise<Result<AffectedAppointment[]>> {
  // date 若不是合法的 YYYY-MM-DD 字串，addDays 內部的 Date 解析會丟出 RangeError；
  // 呼叫端已驗證日期格式（見本檔案上方對「今天或未來」防呆的既有假設），這裡補一層
  // try/catch 只是確保萬一格式異常也走 Result envelope，不會變成未攔截例外往外拋。
  let dayEnd: string;
  try {
    dayEnd = addDays(date, 1);
  } catch {
    return { ok: false, error: INTERNAL_ERROR };
  }

  const { data, error } = await supabase
    .from("appointments")
    .select("id, customer_name, start_at")
    .in("status", ["pending", "confirmed", "completed"])
    .gt("start_at", new Date().toISOString())
    .gte("start_at", `${date}T00:00:00+08:00`)
    .lt("start_at", `${dayEnd}T00:00:00+08:00`)
    .limit(AFFECTED_APPOINTMENTS_LIMIT);

  if (error) {
    return { ok: false, error: INTERNAL_ERROR };
  }

  return { ok: true, data: (data ?? []) as AffectedAppointment[] };
}
