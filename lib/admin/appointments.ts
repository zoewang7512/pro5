import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays } from "./week-range";

// 薄封裝：型別 + 查詢函式，統一把 Supabase 查詢錯誤轉成 Result<T>，
// 寫法比照 lib/booking/api.ts（這裡是直接 table 查詢，不需要處理 RPC 的 {ok,...} 信封）。

export type AdminError = { message: string };
export type Result<T> = { ok: true; data: T } | { ok: false; error: AdminError };

export type AppointmentStatus = "pending" | "confirmed" | "completed" | "cancelled";

export type WeekAppointment = {
  id: string;
  customer_name: string;
  start_at: string;
  end_at: string;
  status: AppointmentStatus;
  service_name: string;
  duration_minutes: number;
  buffer_minutes: number;
};

const INTERNAL_ERROR: AdminError = { message: "發生未預期的錯誤，請稍後再試。" };

type RawService = { name: string; duration_minutes: number; buffer_minutes: number };
type RawAppointmentRow = {
  id: string;
  customer_name: string;
  start_at: string;
  end_at: string;
  status: AppointmentStatus;
  services: RawService | RawService[] | null;
};

// PostgREST embedded resource：多對一關聯依 supabase-js 版本可能回傳物件或單元素陣列，
// 兩種形狀都攤平成同一個型別，元件端不需要處理巢狀結構。
function flattenService(services: RawAppointmentRow["services"]): RawService {
  const service = Array.isArray(services) ? services[0] : services;
  return service ?? { name: "", duration_minutes: 0, buffer_minutes: 0 };
}

export async function getAppointmentsForWeek(
  supabase: SupabaseClient,
  weekStart: string,
  weekEnd: string,
): Promise<Result<WeekAppointment[]>> {
  const { data, error } = await supabase
    .from("appointments")
    .select("id, customer_name, start_at, end_at, status, services(name, duration_minutes, buffer_minutes)")
    .gte("start_at", `${weekStart}T00:00:00+08:00`)
    .lt("start_at", `${addDays(weekEnd, 1)}T00:00:00+08:00`)
    .order("start_at", { ascending: true });

  if (error) {
    return { ok: false, error: INTERNAL_ERROR };
  }

  const appointments: WeekAppointment[] = ((data ?? []) as RawAppointmentRow[]).map((row) => {
    const service = flattenService(row.services);
    return {
      id: row.id,
      customer_name: row.customer_name,
      start_at: row.start_at,
      end_at: row.end_at,
      status: row.status,
      service_name: service.name,
      duration_minutes: service.duration_minutes,
      buffer_minutes: service.buffer_minutes,
    };
  });

  return { ok: true, data: appointments };
}

// customer_phone 只在真正開啟詳情 Modal 時才依 id 單筆取回，不放進
// getAppointmentsForWeek 的整週查詢裡——資料最小化，多數事件卡片永遠不會被點開，
// 沒必要整週把每筆預約的電話都下載到瀏覽器。
export type AppointmentDetail = WeekAppointment & { customer_phone: string | null };

type RawAppointmentDetailRow = RawAppointmentRow & { customer_phone: string | null };

export async function getAppointmentDetail(
  supabase: SupabaseClient,
  appointmentId: string,
): Promise<Result<AppointmentDetail>> {
  const { data, error } = await supabase
    .from("appointments")
    .select("id, customer_name, customer_phone, start_at, end_at, status, services(name, duration_minutes, buffer_minutes)")
    .eq("id", appointmentId)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: INTERNAL_ERROR };
  }

  const row = data as RawAppointmentDetailRow;
  const service = flattenService(row.services);
  return {
    ok: true,
    data: {
      id: row.id,
      customer_name: row.customer_name,
      customer_phone: row.customer_phone,
      start_at: row.start_at,
      end_at: row.end_at,
      status: row.status,
      service_name: service.name,
      duration_minutes: service.duration_minutes,
      buffer_minutes: service.buffer_minutes,
    },
  };
}

async function updateAppointmentStatus(
  supabase: SupabaseClient,
  appointmentId: string,
  status: Extract<AppointmentStatus, "completed" | "cancelled">,
): Promise<Result<void>> {
  // .in("status", [...]) 是狀態轉換的伺服器端條件，不能只靠 UI 用 getAvailableActions()
  // 隱藏按鈕：如果同一筆預約在另一個分頁／另一次 session 已經被改成 completed／cancelled，
  // 本次呼叫就會因為找不到符合條件的列而自然落入下面「RLS 阻擋／找不到列」的分支失敗，
  // 不會把已結束的預約悄悄改回 pending 的狀態機（例如已取消卻被重新標記完成，
  // 導致重新落入 appointments_no_overlap 排除集合佔用時段）。
  const { data, error } = await supabase
    .from("appointments")
    .update({ status })
    .eq("id", appointmentId)
    .in("status", ["pending", "confirmed"])
    .select("id");

  if (error) {
    return { ok: false, error: INTERNAL_ERROR };
  }

  // PostgREST／Supabase 對 RLS 阻擋 UPDATE 的已知行為：回傳成功但空結果，不是拋錯，
  // 一定要看有沒有實際受影響的列，不能只看 error 是否為 null（比照 TASK-010 完成證據記錄的
  // 「RLS 阻擋 UPDATE 回傳成功但空結果」注意事項）。這裡的空結果也可能來自上面的狀態條件
  // 不符（預約已經是 completed／cancelled），兩種原因統一回傳同一個泛用錯誤，不細分——
  // 避免對外洩漏「這筆預約目前是什麼狀態」這種可被拿來列舉資料的細節。
  if (!data || data.length === 0) {
    return { ok: false, error: INTERNAL_ERROR };
  }

  return { ok: true, data: undefined };
}

export function markAppointmentCompleted(supabase: SupabaseClient, appointmentId: string): Promise<Result<void>> {
  return updateAppointmentStatus(supabase, appointmentId, "completed");
}

export function cancelAppointment(supabase: SupabaseClient, appointmentId: string): Promise<Result<void>> {
  return updateAppointmentStatus(supabase, appointmentId, "cancelled");
}

// 改期的錯誤形狀刻意跟 lib/booking/types.ts 的 BookingError 對齊（{code, message}），
// 即使這裡走的是直接 table update 而不是 RPC 的 jsonb 信封——前端才能沿用同一套「依
// error code 決定要不要留在表單內顯示衝突訊息」的處理方式，不用另外發明一套判斷邏輯。
export type RescheduleErrorCode = "SLOT_CONFLICT" | "INTERNAL_ERROR";
export type RescheduleError = { code: RescheduleErrorCode; message: string };
export type RescheduleResult = { ok: true; data: void } | { ok: false; error: RescheduleError };

const RESCHEDULE_ERROR_MESSAGES: Record<RescheduleErrorCode, string> = {
  SLOT_CONFLICT: "這個時段已被其他預約占用，請選擇其他時段。",
  INTERNAL_ERROR: "發生未預期的錯誤，請稍後再試。",
};

export async function rescheduleAppointment(
  supabase: SupabaseClient,
  appointmentId: string,
  currentStartAt: string,
  newStartAt: string,
  newEndAt: string,
): Promise<RescheduleResult> {
  // .eq("start_at", currentStartAt) 是樂觀鎖：currentStartAt 是呼叫端（詳情 Modal）開啟
  // 當下看到的原時段。沒有這個條件，.in("status",...) 只保護了狀態機，start_at／end_at
  // 這兩個真正要改的欄位完全沒有保護——若同一筆預約在表單開著的期間已被另一個分頁／另一次
  // session 改期，本次送出仍會用陳舊資料成功覆寫，畫面顯示「已更新」但時段其實是錯的
  // （lost update）。不符合時自然落入下面的空結果分支，回傳失敗，使用者需要重新開啟
  // Modal 看最新狀態再試一次。
  const { data, error } = await supabase
    .from("appointments")
    // reminder_sent_at 一併重設回 null（TASK-054 審查發現的修正）：若這筆預約
    // 在改期前已經被排程端點 claim／寄過提醒信，改期後若不重設，
    // reminder_sent_at 仍是非 null，之後永遠不會再被排程撈到，等於新時段
    // 永久收不到提醒信。重設不會誤觸發 0012 migration 的 UPDATE webhook
    // trigger——那個 trigger 的 WHEN 條件本來就是看 start_at／end_at 是否
    // 變動，這次 UPDATE 已經在改 start_at／end_at，一併多帶一個欄位不會
    // 額外觸發或改變分類結果。
    .update({ start_at: newStartAt, end_at: newEndAt, reminder_sent_at: null })
    .eq("id", appointmentId)
    .eq("start_at", currentStartAt)
    .in("status", ["pending", "confirmed"])
    .select("id");

  if (error) {
    // Postgres exclusion_violation（23P01，見 appointments_no_overlap constraint）＝時段
    // 衝突；其餘一律歸類為未預期錯誤，不把 constraint 名稱等原始 Postgres 錯誤內容顯示
    // 給使用者（比照顧客端 create_appointment RPC 的錯誤處理風格）。
    const code: RescheduleErrorCode = (error as { code?: string }).code === "23P01" ? "SLOT_CONFLICT" : "INTERNAL_ERROR";
    return { ok: false, error: { code, message: RESCHEDULE_ERROR_MESSAGES[code] } };
  }

  // 同 updateAppointmentStatus：RLS 阻擋、狀態條件不符（預約已經是 completed／cancelled），
  // 或上面的樂觀鎖條件不符（原時段已被別處改動），都會讓 UPDATE 回傳成功但空結果，一定要
  // 檢查有沒有實際受影響的列，不能只看 error 是否為 null；三種原因統一回傳同一個泛用
  // 錯誤，不細分，避免對外洩漏這筆預約目前實際處於什麼狀態。
  if (!data || data.length === 0) {
    return { ok: false, error: { code: "INTERNAL_ERROR", message: RESCHEDULE_ERROR_MESSAGES.INTERNAL_ERROR } };
  }

  return { ok: true, data: undefined };
}

// 決定詳情 Modal 該顯示哪些操作按鈕的純函式：只有 pending／confirmed（尚未結束的預約）
// 能標記完成／改期／取消；completed／cancelled 一律唯讀，不提供任何操作入口
// （畫面上直接不顯示按鈕，不是顯示後才在送出時擋，比照 screen-spec 的「停用」狀態列）。
export type AvailableActions = { canComplete: boolean; canReschedule: boolean; canCancel: boolean };

export function getAvailableActions(status: AppointmentStatus): AvailableActions {
  const active = status === "pending" || status === "confirmed";
  return { canComplete: active, canReschedule: active, canCancel: active };
}
