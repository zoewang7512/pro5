// 型別 + RPC 回傳形狀，對應 supabase/migrations/0002_booking_flow.sql 的
// get_available_slots／create_appointment 與既有 services／business_hours 表結構。

export type Service = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  duration_minutes: number;
  is_active: boolean;
  sort_order: number;
};

// 後台才需要的欄位：緩衝時間由 get_available_slots 在資料庫端套用，前台不顯示，
// 所以 getServices 不讀它，前台維持使用 Service。
export type AdminService = Service & {
  buffer_minutes: number;
};

export type BusinessHours = {
  weekday: number;
  open_time: string | null;
  close_time: string | null;
  is_closed: boolean;
};

export type AvailableSlot = {
  start_at: string;
  end_at: string;
};

export type CreateAppointmentInput = {
  serviceId: string;
  startAt: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  // 省略或 null＝不指定設計師（送出時由資料庫自動指派）。
  designerId?: string | null;
};

// create_appointment 成功時回傳的欄位一律回顯本次請求送出的值，不是資料庫既有顧客
// 記錄的值（見 0002_booking_flow.sql 註解），前端可直接顯示，不必自己再組一次。
export type AppointmentConfirmation = {
  service_name: string;
  start_at: string;
  end_at: string;
  customer_name: string;
  customer_phone: string;
  // 實際被指派的設計師（指定時就是顧客選的那位；不指定時是系統指派的那位）。0018 起回傳。
  designer_id: string;
  designer_name: string;
};

export type BookingErrorCode =
  | "SLOT_CONFLICT"
  | "SERVICE_INACTIVE"
  | "VALIDATION_ERROR"
  | "BOOKING_LIMIT_EXCEEDED"
  | "INTERNAL_ERROR";

export type BookingError = {
  code: BookingErrorCode;
  message: string;
};

export type Result<T> = { ok: true; data: T } | { ok: false; error: BookingError };
