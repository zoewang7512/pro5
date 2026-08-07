import type { SupabaseClient } from "@supabase/supabase-js";
import type { AvailableSlot } from "@/lib/booking/types";
import { addDays } from "./week-range";
import type { AdminError, Result } from "./appointments";

// 改期表單專用的可預約時段計算。後台管理者是受信任的內部使用者，不套用顧客端
// get_available_slots RPC 的「提前 1 小時」「90 天視野」防濫用限制（feature-spec
// 「資料與 API」段落的既有決策）。也因為該 RPC 只 grant execute 給 anon（見
// supabase/migrations/0002_booking_flow.sql），authenticated 角色（設計師登入後）呼叫會
// 被拒絕，所以改期表單不能直接沿用它，改成用管理者本來就有權限讀取的 appointments／
// business_hours 資料，在前端算出同樣語意的可預約時段，再交給既有的
// lib/booking/slot-grid.ts 的 buildSlotGrid 組成畫面格點（沿用同一套 30 分鐘格點規則，
// 避免顧客端與後台產生不一致的可預約時段定義）。

const INTERNAL_ERROR: AdminError = { message: "發生未預期的錯誤，請稍後再試。" };

export type OccupiedRange = { start_at: string; end_at: string; buffer_minutes: number };

// PostgREST embedded resource：多對一關聯依 supabase-js 版本可能回傳物件或單元素陣列，
// 比照 lib/admin/appointments.ts 的 flattenService 既有攤平模式；這裡只需要 buffer_minutes
// 一個欄位，為了這個小工具函式額外 import 該檔案的 RawService／flattenService（形狀含
// name/duration_minutes 等不相關欄位）不划算，改在本檔案內寫等價的最小版本。
type RawServiceBuffer = { buffer_minutes: number } | { buffer_minutes: number }[] | null;

function flattenBufferMinutes(services: RawServiceBuffer): number {
  const service = Array.isArray(services) ? services[0] : services;
  return service?.buffer_minutes ?? 0;
}

export async function getOccupiedRangesForDate(
  supabase: SupabaseClient,
  date: string,
  excludeAppointmentId: string,
): Promise<Result<OccupiedRange[]>> {
  // 下界往前推一天：services.buffer_minutes 上限 120 分鐘（見 0003_closures_and_buffer.sql
  // 的 check constraint），前一天深夜才開始、加上緩衝後跨過午夜的既有預約，start_at 落在
  // 前一天，若只查當天會漏掉，導致這裡（TS 版）跟 get_available_slots RPC（沒有依 start_at
  // 限定範圍，一定看得到）在這個邊界情況判斷不一致——120 分鐘遠小於一天，往前推一天的
  // margin 足夠涵蓋所有可能的緩衝跨日情況。
  const { data, error } = await supabase
    .from("appointments")
    .select("start_at, end_at, services(buffer_minutes)")
    .neq("id", excludeAppointmentId)
    .in("status", ["pending", "confirmed", "completed"])
    .gte("start_at", `${addDays(date, -1)}T00:00:00+08:00`)
    .lt("start_at", `${addDays(date, 1)}T00:00:00+08:00`);

  if (error) {
    return { ok: false, error: INTERNAL_ERROR };
  }

  const ranges: OccupiedRange[] = (
    (data ?? []) as Array<{ start_at: string; end_at: string; services: RawServiceBuffer }>
  ).map((row) => ({
    start_at: row.start_at,
    end_at: row.end_at,
    buffer_minutes: flattenBufferMinutes(row.services),
  }));

  return { ok: true, data: ranges };
}

export type DayBusinessHours = { open_time: string | null; close_time: string | null; is_closed: boolean };

export async function getBusinessHoursForWeekday(
  supabase: SupabaseClient,
  weekday: number,
): Promise<Result<DayBusinessHours | null>> {
  const { data, error } = await supabase
    .from("business_hours")
    .select("open_time, close_time, is_closed")
    .eq("weekday", weekday)
    .maybeSingle();

  if (error) {
    return { ok: false, error: INTERNAL_ERROR };
  }
  return { ok: true, data: data as DayBusinessHours | null };
}

const STEP_MS = 30 * 60_000;

function withSeconds(time: string): string {
  return time.length === 5 ? `${time}:00` : time;
}

// 純函式：把「當天營業時間」與「當天已佔用時段」算成可預約時段清單。邏輯比照
// supabase/migrations/0002_booking_flow.sql 的 get_available_slots RPC（30 分鐘步進、對
// [start, start+duration) 與每個已佔用區間做重疊判斷），但不套用該 RPC 給顧客端的提前量／
// 視野上限這兩條限制；`now` 由呼叫端注入（而非內部呼叫 Date.now()），保持函式可測試。
export function computeAvailableSlots(params: {
  date: string;
  durationMinutes: number;
  businessHours: DayBusinessHours | null;
  occupiedRanges: OccupiedRange[];
  now: number;
  bufferMinutes: number;
  isClosedDate: boolean;
}): AvailableSlot[] {
  const { date, durationMinutes, businessHours, occupiedRanges, now, bufferMinutes, isClosedDate } = params;

  if (isClosedDate) return [];

  if (!businessHours || businessHours.is_closed || !businessHours.open_time || !businessHours.close_time) {
    return [];
  }

  const openMs = new Date(`${date}T${withSeconds(businessHours.open_time)}+08:00`).getTime();
  const closeMs = new Date(`${date}T${withSeconds(businessHours.close_time)}+08:00`).getTime();
  const durationMs = durationMinutes * 60_000;

  if (!Number.isFinite(openMs) || !Number.isFinite(closeMs) || openMs >= closeMs) {
    return [];
  }

  // 緩衝時間感知的重疊判斷：既有預約用自己所屬服務的 buffer_minutes 延伸佔用區間結束時間，
  // 候選時段同樣用即將預約的服務的 bufferMinutes 延伸自己的結束時間，兩個效力區間做標準
  // 區間重疊判斷。buffer_minutes/bufferMinutes 為 0 時，效力區間等於原始區間，行為自動退化
  // 成修改前的原始邏輯，不需要額外的 if bufferMinutes > 0 分支（比照 RPC 版本的既有寫法）。
  const occupied = occupiedRanges.map((range) => ({
    start: new Date(range.start_at).getTime(),
    end: new Date(range.end_at).getTime() + range.buffer_minutes * 60_000,
  }));

  const slots: AvailableSlot[] = [];
  for (let start = openMs; start + durationMs <= closeMs; start += STEP_MS) {
    if (start <= now) continue; // 新時段須為未來時間

    const end = start + durationMs;
    const effectiveEnd = end + bufferMinutes * 60_000;
    const overlaps = occupied.some((range) => start < range.end && effectiveEnd > range.start);
    if (!overlaps) {
      slots.push({ start_at: new Date(start).toISOString(), end_at: new Date(end).toISOString() });
    }
  }

  return slots;
}
