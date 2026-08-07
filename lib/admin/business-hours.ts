import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminError, Result } from "./appointments";
import { getWeekday } from "./week-range";
import { toTaipeiDate } from "./format";

// 營業時間設定頁的資料存取。查詢風格比照 lib/admin/reschedule-slots.ts 的
// getBusinessHoursForWeekday()——同一張 business_hours 表，這裡是一次查全部 7 列的批次版本。

const INTERNAL_ERROR: AdminError = { message: "發生未預期的錯誤，請稍後再試。" };

export type BusinessHoursRow = {
  weekday: number; // 0=週日...6=週六，對齊 extract(dow from date)
  open_time: string | null;
  close_time: string | null;
  is_closed: boolean;
};

export async function getAllBusinessHours(supabase: SupabaseClient): Promise<Result<BusinessHoursRow[]>> {
  const { data, error } = await supabase
    .from("business_hours")
    .select("weekday, open_time, close_time, is_closed")
    .order("weekday", { ascending: true });

  if (error) {
    return { ok: false, error: INTERNAL_ERROR };
  }

  return { ok: true, data: (data ?? []) as BusinessHoursRow[] };
}

// 表單編輯用的形狀：時間一律是「HH:mm」（不含秒數）——比照 BusinessHoursForm.tsx 的
// formatTimeInput() 從 getAllBusinessHours 的原始 "HH:mm:ss" 截斷而來；Postgres 的 time
// 欄位接受 "HH:mm" 格式輸入（會自動補上 :00），寫回時不需要再轉換。
export type BusinessHoursInput = {
  weekday: number;
  open_time: string;
  close_time: string;
  is_closed: boolean;
};

export function validateBusinessHoursRow(row: BusinessHoursInput): string | null {
  if (row.is_closed) return null;
  if (!row.open_time || !row.close_time) return "請填寫開店與打烊時間";
  if (row.close_time <= row.open_time) return "打烊時間須晚於開店時間";
  return null;
}

export async function updateBusinessHours(
  supabase: SupabaseClient,
  rows: BusinessHoursInput[],
): Promise<Result<void>> {
  const payload = rows.map((row) => ({
    weekday: row.weekday,
    open_time: row.is_closed ? null : row.open_time,
    close_time: row.is_closed ? null : row.close_time,
    is_closed: row.is_closed,
  }));

  // .select("weekday") 讓我們拿到實際受影響的列數：business_hours 的 7 列都已存在
  // （由 seed script 建立），這裡的 upsert 對每個 weekday 實際上都是 UPDATE 語意；
  // 比照 TASK-010 記錄的既知行為——RLS 阻擋 UPDATE 會回傳成功但空結果，不是拋錯，
  // 一定要檢查實際受影響的列數，不能只看 error 是否為 null，否則 anon 或非 is_admin()
  // 角色若因設定錯誤矇混過關，會在畫面上看到「已更新」但資料其實完全沒被寫入。
  const { data, error } = await supabase
    .from("business_hours")
    .upsert(payload, { onConflict: "weekday" })
    .select("weekday");

  if (error || !data || data.length !== payload.length) {
    // business_hours_valid_range 這類 constraint 違反不外洩給使用者，一律轉成泛用錯誤
    // （比照 rescheduleAppointment 的錯誤處理風格）；前端已經用 validateBusinessHoursRow
    // 擋過一次，理論上不會走到這裡，這是最後防線。
    return { ok: false, error: INTERNAL_ERROR };
  }
  return { ok: true, data: undefined };
}

export type AffectedAppointment = { id: string; customer_name: string; start_at: string };

// 「HH:mm」格式的當地時刻字串可以直接用字典序比較（zero-padded 24 小時制），
// 不需要轉成數字或 Date 物件。用 hourCycle:"h23" 明確要求 0-23 小時制，避免
// hour12:false 在部分 ICU 實作上把午夜算成 "24:00" 而非 "00:00" 的既知怪癖。
function toTaipeiTimeOfDay(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

export function isAppointmentOutsideHours(
  startAt: string,
  endAt: string,
  hours: BusinessHoursInput | undefined,
): boolean {
  if (!hours || hours.is_closed || !hours.open_time || !hours.close_time) return true;
  const startTod = toTaipeiTimeOfDay(startAt);
  const endTod = toTaipeiTimeOfDay(endAt);
  return startTod < hours.open_time || endTod > hours.close_time;
}

// 顧客端 create_appointment RPC 本身就有 90 天視野上限（見
// supabase/migrations/0002_booking_flow.sql），設計師改期表單也只開放 21 天視窗，
// 實務上不會有預約落在更遠的未來——這裡加同樣的上限＋筆數上限，避免這個查詢在理論上
// 沒有邊界地把所有未來預約（含姓名）整批下載到瀏覽器。
const AFFECTED_APPOINTMENTS_HORIZON_MS = 90 * 24 * 60 * 60 * 1000;
const AFFECTED_APPOINTMENTS_LIMIT = 200;

export async function findAffectedAppointments(
  supabase: SupabaseClient,
  newRows: BusinessHoursInput[],
): Promise<Result<AffectedAppointment[]>> {
  const { data, error } = await supabase
    .from("appointments")
    .select("id, customer_name, start_at, end_at")
    .in("status", ["pending", "confirmed", "completed"])
    .gt("start_at", new Date().toISOString())
    .lt("start_at", new Date(Date.now() + AFFECTED_APPOINTMENTS_HORIZON_MS).toISOString())
    .limit(AFFECTED_APPOINTMENTS_LIMIT);

  if (error) {
    return { ok: false, error: INTERNAL_ERROR };
  }

  const hoursByWeekday = new Map(newRows.map((row) => [row.weekday, row]));
  const affected = ((data ?? []) as Array<{ id: string; customer_name: string; start_at: string; end_at: string }>)
    .filter((appointment) => {
      const weekday = getWeekday(toTaipeiDate(appointment.start_at));
      return isAppointmentOutsideHours(appointment.start_at, appointment.end_at, hoursByWeekday.get(weekday));
    })
    .map((appointment) => ({
      id: appointment.id,
      customer_name: appointment.customer_name,
      start_at: appointment.start_at,
    }));

  return { ok: true, data: affected };
}
