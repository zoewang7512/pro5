// Demo 還原資料（TASK-106）的型別：基底資料 `seed-base.json` 與送給 `reset_demo_data` 的 payload。
// 純型別檔，前後端都能匯入；不放任何邏輯。

export type SeedService = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  duration_minutes: number;
  buffer_minutes: number;
  is_active: boolean;
  sort_order: number;
};

export type SeedDesigner = {
  id: string;
  name: string;
  bio: string | null;
  specialties: string[];
  instagram_handle: string | null;
  avatar_url: string | null;
  is_active: boolean;
  sort_order: number;
  // 明確帶入：「預設設計師」以 `order by created_at, id` 辨識，還原不得改變順序。
  created_at: string;
};

export type SeedDesignerService = {
  designer_id: string;
  service_id: string;
};

export type SeedDesignerLeave = {
  designer_id: string;
  date: string;
};

export type SeedPortfolioImage = {
  id: string;
  designer_id: string;
  image_url: string;
  storage_path: string;
  created_at: string;
};

export type SeedBusinessHour = {
  weekday: number;
  open_time: string | null;
  close_time: string | null;
  is_closed: boolean;
};

export type SeedClosedDate = {
  date: string;
};

export type SeedBookingPolicy = {
  id: 1;
  min_lead_time_hours: number;
  cancel_window_hours: number | null;
};

export type SeedStoreSettings = {
  id: 1;
  name: string;
  address: string | null;
  phone: string | null;
  description: string | null;
  logo_url: string | null;
  cover_image_url: string | null;
};

export type SeedCustomer = {
  id: string;
  name: string;
  phone: string;
  email: null;
  notes: null;
};

export type SeedAppointmentStatus = "pending" | "confirmed" | "completed" | "cancelled";

export type SeedAppointment = {
  id: string;
  service_id: string;
  designer_id: string;
  customer_id: string;
  customer_name: string;
  customer_phone: string;
  // 一律 null：非 null 會觸發寄信，`reset_demo_data` 也會拒絕。
  customer_email: null;
  start_at: string;
  end_at: string;
  status: SeedAppointmentStatus;
  created_at: string;
};

export type SeedDemoAdminProfile = {
  display_name: string;
  avatar_url: string | null;
};

export type SeedCustomerPoolEntry = {
  name: string;
  phone: string;
};

// 預約產生設定（人工維護，寫在 seed-base.json）。
export type SeedSchedule = {
  // 今天（台北時間）往前、往後各產生幾天的預約。
  history_days: number;
  future_days: number;
  // 每位設計師每個營業日的預約數範圍（含）。
  min_per_designer_per_day: number;
  max_per_designer_per_day: number;
  // 每 100 筆預約中取消的筆數；尚未開始的預約中待確認（pending）佔幾成（其餘 confirmed）。
  cancelled_per_hundred: number;
  pending_per_hundred_of_future: number;
};

export type DemoSeedBase = {
  store_settings: Omit<SeedStoreSettings, "id">;
  booking_policy: Omit<SeedBookingPolicy, "id">;
  business_hours: SeedBusinessHour[];
  services: SeedService[];
  designers: SeedDesigner[];
  designer_services: SeedDesignerService[];
  portfolio_images: SeedPortfolioImage[];
  // 距離「今天（台北時間）」的天數，還原時才換算成日期。
  closed_date_offsets: number[];
  designer_leave_offsets: { designer_id: string; day_offset: number }[];
  demo_admin_profile: SeedDemoAdminProfile;
  schedule: SeedSchedule;
  customer_pool: SeedCustomerPoolEntry[];
};

export type DemoSeedPayload = {
  confirm: "RESET_DEMO";
  // `buildDemoSeed` 不產生；呼叫 `reset_demo_data` 前由還原編排（TASK-109）補上，函式要求必填，
  // 只作交叉檢查（函式自己決定 Demo 使用者）。
  demo_user_id?: string;
  services: SeedService[];
  designers: SeedDesigner[];
  designer_services: SeedDesignerService[];
  designer_leaves: SeedDesignerLeave[];
  portfolio_images: SeedPortfolioImage[];
  business_hours: SeedBusinessHour[];
  closed_dates: SeedClosedDate[];
  booking_policy: SeedBookingPolicy;
  store_settings: SeedStoreSettings;
  customers: SeedCustomer[];
  appointments: SeedAppointment[];
  demo_admin_profile: SeedDemoAdminProfile;
};

export type DemoSeedCounts = Record<
  | "services"
  | "designers"
  | "designer_services"
  | "designer_leaves"
  | "portfolio_images"
  | "business_hours"
  | "closed_dates"
  | "customers"
  | "appointments",
  number
>;
