import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AppointmentConfirmation,
  AvailableSlot,
  BookingError,
  BusinessHours,
  CreateAppointmentInput,
  Result,
  Service,
} from "./types";

// 薄封裝：型別 + 呼叫函式，不含 UI 邏輯。統一把 Supabase 的兩種錯誤形狀
// （PostgrestError／RPC 自訂的 {ok:false, error_code, message} jsonb）轉成 Result<T>。

const INTERNAL_ERROR: BookingError = { code: "INTERNAL_ERROR", message: "發生未預期的錯誤，請稍後再試。" };

type RpcEnvelope<T> = { ok: true; data: T } | { ok: false; error_code: string; message: string };

function isBookingErrorCode(code: string): code is BookingError["code"] {
  return (
    code === "SLOT_CONFLICT" ||
    code === "SERVICE_INACTIVE" ||
    code === "VALIDATION_ERROR" ||
    code === "BOOKING_LIMIT_EXCEEDED" ||
    code === "INTERNAL_ERROR"
  );
}

function fromRpcEnvelope<T>(envelope: RpcEnvelope<T> | null): Result<T> {
  if (!envelope) {
    return { ok: false, error: INTERNAL_ERROR };
  }
  if (envelope.ok) {
    return { ok: true, data: envelope.data };
  }
  return {
    ok: false,
    error: {
      code: isBookingErrorCode(envelope.error_code) ? envelope.error_code : "INTERNAL_ERROR",
      message: envelope.message || INTERNAL_ERROR.message,
    },
  };
}

export async function getServices(supabase: SupabaseClient): Promise<Result<Service[]>> {
  const { data, error } = await supabase
    .from("services")
    .select("id, name, description, price, duration_minutes, is_active, sort_order")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (error) {
    return { ok: false, error: INTERNAL_ERROR };
  }
  return { ok: true, data: data as Service[] };
}

export async function getBusinessHours(
  supabase: SupabaseClient,
  weekday: number,
): Promise<Result<BusinessHours | null>> {
  const { data, error } = await supabase
    .from("business_hours")
    .select("weekday, open_time, close_time, is_closed")
    .eq("weekday", weekday)
    .maybeSingle();

  if (error) {
    return { ok: false, error: INTERNAL_ERROR };
  }
  return { ok: true, data: data as BusinessHours | null };
}

// designerId 省略或 null＝「不指定設計師」：回傳至少一位合格設計師有空的時段聯集；指定時只回傳該設計師的
// 空檔。兩種模式的回應都只有時間，不含任何設計師識別資訊（0018_designer_aware_booking.sql）。
export async function getAvailableSlots(
  supabase: SupabaseClient,
  serviceId: string,
  date: string,
  designerId?: string | null,
): Promise<Result<AvailableSlot[]>> {
  const { data, error } = await supabase.rpc("get_available_slots", {
    p_service_id: serviceId,
    p_date: date,
    p_designer_id: designerId ?? null,
  });

  if (error) {
    return { ok: false, error: INTERNAL_ERROR };
  }
  return fromRpcEnvelope<AvailableSlot[]>(data as RpcEnvelope<AvailableSlot[]> | null);
}

export async function createAppointment(
  supabase: SupabaseClient,
  input: CreateAppointmentInput,
): Promise<Result<AppointmentConfirmation>> {
  const { data, error } = await supabase.rpc("create_appointment", {
    p_service_id: input.serviceId,
    p_start_at: input.startAt,
    p_customer_name: input.customerName,
    p_customer_phone: input.customerPhone,
    p_customer_email: input.customerEmail || null,
    // 省略或 null＝「不指定設計師」，由資料庫在送出時自動指派；成功時回傳實際指派的設計師。
    p_designer_id: input.designerId ?? null,
  });

  if (error) {
    return { ok: false, error: INTERNAL_ERROR };
  }
  return fromRpcEnvelope<AppointmentConfirmation>(data as RpcEnvelope<AppointmentConfirmation> | null);
}
