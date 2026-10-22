import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DESIGNER_PORTFOLIO_MAX_IMAGES,
  DESIGNER_PUBLIC_COLUMNS,
  instagramProfileUrl,
  isDesignerId,
  resolveDesignerAssetUrl,
  resolvePortfolioImageUrl,
} from "@/lib/designers";
import type {
  AppointmentConfirmation,
  AvailableSlot,
  BookingError,
  BusinessHours,
  CreateAppointmentInput,
  PublicDesigner,
  PublicPortfolioImage,
  Result,
  Service,
} from "./types";

// 薄封裝：型別 + 呼叫函式，不含 UI 邏輯。統一把 Supabase 的兩種錯誤形狀
// （PostgrestError／RPC 自訂的 {ok:false, error_code, message} jsonb）轉成 Result<T>。

const SERVICE_COLUMNS = "id, name, description, price, duration_minutes, is_active, sort_order";

const INTERNAL_ERROR: BookingError ={ code: "INTERNAL_ERROR", message: "發生未預期的錯誤，請稍後再試。" };

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

// 只列出「至少有一位啟用中設計師提供」的上架服務（0017：沒有設計師提供的服務不能預約）。兩層 `!inner` 加巢狀
// `eq` 是明確過濾：匿名訪客的 RLS 本來就只放行啟用中設計師，但管理員登入狀態下瀏覽前台時 policy 會放行停用中的
// 設計師，只靠 RLS 會讓「唯一設計師已停用」的服務還顯示在列表。內嵌欄位只用來過濾，回傳前剝掉。
export async function getServices(supabase: SupabaseClient): Promise<Result<Service[]>> {
  try {
    const { data, error } = await supabase
      .from("services")
      .select(`${SERVICE_COLUMNS}, designer_services!inner(designers!inner(is_active))`)
      .eq("is_active", true)
      .eq("designer_services.designers.is_active", true)
      .order("sort_order", { ascending: true });

    if (error || !data) {
      return { ok: false, error: INTERNAL_ERROR };
    }
    const services = (data as unknown as Service[]).map((service) => ({
      id: service.id,
      name: service.name,
      description: service.description,
      price: service.price,
      duration_minutes: service.duration_minutes,
      is_active: service.is_active,
      sort_order: service.sort_order,
    }));
    return { ok: true, data: services };
  } catch {
    return { ok: false, error: INTERNAL_ERROR };
  }
}

// 某個服務可以選的設計師（含全部作品，最多 12 張；預覽卡只畫前 4 張，TASK-074 的個人頁直接用同一份）。
// anon 只有欄位層級的 select 授權，所以欄位一律明確列出（不得用 `*`），也沒有 designers.created_at 可排序。
// 同樣要自己過濾 is_active（設計師與服務兩邊）：管理員登入狀態下 RLS 會放行停用中的設計師與下架中的服務。
// 回傳前逐欄位組出 PublicDesigner：頭像與作品網址過 designer-assets 白名單，不合格的作品直接丟掉。
const PORTFOLIO_REFERENCED_TABLE = "designer_portfolio_images";

export async function getDesignersForService(
  supabase: SupabaseClient,
  serviceId: string,
): Promise<Result<PublicDesigner[]>> {
  // serviceId 來自服務列表（資料庫回傳），這裡借用設計師 id 的 uuid 格式檢查，格式錯誤就不送請求。
  if (!isDesignerId(serviceId)) {
    return { ok: false, error: INTERNAL_ERROR };
  }

  try {
    const { data, error } = await supabase
      .from("designers")
      .select(
        `${DESIGNER_PUBLIC_COLUMNS}, designer_services!inner(service_id, services!inner(is_active)), ` +
          `${PORTFOLIO_REFERENCED_TABLE}(id, image_url, created_at)`,
      )
      .eq("is_active", true)
      .eq("designer_services.service_id", serviceId)
      .eq("designer_services.services.is_active", true)
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true })
      .order("created_at", { ascending: false, referencedTable: PORTFOLIO_REFERENCED_TABLE })
      .order("id", { ascending: false, referencedTable: PORTFOLIO_REFERENCED_TABLE })
      .limit(DESIGNER_PORTFOLIO_MAX_IMAGES, { referencedTable: PORTFOLIO_REFERENCED_TABLE });

    if (error || !Array.isArray(data)) {
      return { ok: false, error: INTERNAL_ERROR };
    }
    const designers = (data as unknown as Array<Record<string, unknown>>)
      .map(toPublicDesigner)
      .filter((designer): designer is PublicDesigner => designer !== null);
    return { ok: true, data: designers };
  } catch {
    return { ok: false, error: INTERNAL_ERROR };
  }
}

// 簡介的方向控制字元（資料庫沒擋，見 lib/designers.ts validateDesignerBio）在公開頁會偽造文字顯示方向，顯示前去掉。
const BIDI_CONTROL_CHARS = /[‪-‮⁦-⁩]/g;

function toPublicDesigner(row: Record<string, unknown>): PublicDesigner | null {
  const { id, name } = row;
  if (typeof id !== "string" || typeof name !== "string" || !isDesignerId(id)) return null;

  const instagramHandle = typeof row.instagram_handle === "string" ? row.instagram_handle : null;
  const portfolioRows = Array.isArray(row[PORTFOLIO_REFERENCED_TABLE]) ? (row[PORTFOLIO_REFERENCED_TABLE] as unknown[]) : [];

  const portfolio: PublicPortfolioImage[] = [];
  for (const item of portfolioRows) {
    if (typeof item !== "object" || item === null) continue;
    const image = item as Record<string, unknown>;
    if (typeof image.id !== "string" || typeof image.created_at !== "string") continue;
    const imageUrl = resolvePortfolioImageUrl(typeof image.image_url === "string" ? image.image_url : null, id);
    if (imageUrl) portfolio.push({ id: image.id, image_url: imageUrl, created_at: image.created_at });
  }

  return {
    id,
    name,
    bio: typeof row.bio === "string" ? row.bio.replace(BIDI_CONTROL_CHARS, "") : null,
    specialties: Array.isArray(row.specialties)
      ? row.specialties.filter((tag): tag is string => typeof tag === "string")
      : [],
    instagram_handle: instagramProfileUrl(instagramHandle) ? instagramHandle : null,
    avatar_url: resolveDesignerAssetUrl(typeof row.avatar_url === "string" ? row.avatar_url : null),
    sort_order: typeof row.sort_order === "number" ? row.sort_order : 0,
    portfolio: portfolio.slice(0, DESIGNER_PORTFOLIO_MAX_IMAGES),
  };
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
