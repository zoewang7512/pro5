import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminError, AppointmentStatus, Result, WeekAppointment } from "./appointments";
import { isRealDate } from "./designers";
import { toTaipeiDate } from "./format";
import { buildMonthDays, formatMonthLabel } from "./month-range";
import { addDays, getTaipeiToday, getWeekRange, getWeekday, WEEKDAY_LABELS } from "./week-range";

// 「儀表板與報表」的資料層：期間運算、單期間預約查詢、彙總、趨勢、設計師篩選。全部是純函式（查詢除外）。
// 口徑只在 summarize 一處定義（預約量／營收／預估營收），趨勢、排行、匯出一律消費它的結果，不得自行重算。
// 日期歸屬一律以 Asia/Taipei 換算（Intl／+08:00），不依賴執行環境時區。

export type ReportGranularity = "day" | "week" | "month";

export type ReportPeriod = {
  granularity: ReportGranularity;
  // Taipei 日期 YYYY-MM-DD，含頭尾。
  from: string;
  to: string;
  label: string;
  // 今天（Taipei）落在期間內。
  isCurrent: boolean;
};

export type ReportAppointment = {
  id: string;
  startAt: string;
  status: AppointmentStatus;
  // 下單當下的價格快照（appointments.price_at_booking），不是服務目前的價格。
  price: number;
  serviceId: string;
  serviceName: string;
  serviceIsActive: boolean;
  designerId: string;
};

export type ReportTotals = {
  // pending＋confirmed＋completed；cancelled 不計入。
  booked: number;
  completed: number;
  // pending＋confirmed。
  pending: number;
  cancelled: number;
  // completed 的價格加總。
  revenue: number;
  // pending＋confirmed 的價格加總。
  estimated: number;
};

export type TrendBucket = ReportTotals & {
  // 月／週：Taipei 日期 YYYY-MM-DD；日：小時 "HH:00"。
  key: string;
  label: string;
};

const INTERNAL_ERROR: AdminError = { message: "發生未預期的錯誤，請稍後再試。" };

// ---- 期間 ----

function formatMonthDay(date: string): string {
  const [, month, day] = date.split("-").map(Number);
  return `${month}/${day}`;
}

function formatDateWithWeekday(date: string): string {
  return `${formatMonthDay(date)}（${WEEKDAY_LABELS[getWeekday(date)]}）`;
}

// 含該日的日／週（週一～週日）／曆月範圍。today 由呼叫端傳入（測試可固定），預設為台北今天。
export function getReportPeriod(
  granularity: ReportGranularity,
  anchorDate: string,
  today: string = getTaipeiToday(),
): ReportPeriod {
  let from: string;
  let to: string;
  let label: string;

  if (granularity === "day") {
    from = anchorDate;
    to = anchorDate;
    label = formatDateWithWeekday(anchorDate);
  } else if (granularity === "week") {
    const { weekStart, weekEnd } = getWeekRange(anchorDate);
    from = weekStart;
    to = weekEnd;
    label = `${formatDateWithWeekday(weekStart)} – ${formatDateWithWeekday(weekEnd)}`;
  } else {
    const [year, month] = anchorDate.split("-").map(Number);
    const days = buildMonthDays(year, month);
    from = days[0].date;
    to = days[days.length - 1].date;
    label = formatMonthLabel(year, month);
  }

  return { granularity, from, to, label, isCurrent: today >= from && today <= to };
}

// 前一期／後一期（delta = -1／1）。月份以相鄰日期當錨點，不必自己處理跨年與月長。
export function shiftReportPeriod(period: ReportPeriod, delta: 1 | -1, today: string = getTaipeiToday()): ReportPeriod {
  let anchor: string;
  if (period.granularity === "month") {
    anchor = delta > 0 ? addDays(period.to, 1) : addDays(period.from, -1);
  } else {
    anchor = addDays(period.from, (period.granularity === "week" ? 7 : 1) * delta);
  }
  return getReportPeriod(period.granularity, anchor, today);
}

// ---- 查詢 ----

// 明確列欄位，不用 `*`；不含任何 customer_*／access_token（appointments 本來就是欄位層級授權）。
const REPORT_COLUMNS = "id, start_at, status, price_at_booking, service_id, designer_id, services(name, is_active)";

// PostgREST 單次回傳上限 1000 列；最多取 5 頁（5000 列），超過就回錯誤，寧可失敗也不顯示被截斷的數字。
const PAGE_SIZE = 1000;
const MAX_PAGES = 5;

const STATUSES: ReadonlySet<string> = new Set<AppointmentStatus>(["pending", "confirmed", "completed", "cancelled"]);

type RawService = { name: string; is_active: boolean };
type RawReportRow = {
  id: string;
  start_at: string;
  status: string;
  price_at_booking: number | string | null;
  service_id: string;
  designer_id: string;
  services: RawService | RawService[] | null;
};

// numeric(10,2) 經 PostgREST 可能是 number 或字串。null／空字串不能被 Number() 靜默當成 0。
function parsePrice(value: RawReportRow["price_at_booking"]): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

// 多對一 embed 依 supabase-js 版本可能是物件或單元素陣列（比照 lib/admin/appointments.ts）。
function toReportAppointment(row: RawReportRow): ReportAppointment | null {
  const price = parsePrice(row.price_at_booking);
  if (price === null || !STATUSES.has(row.status)) return null;

  const service = Array.isArray(row.services) ? row.services[0] : row.services;
  return {
    id: row.id,
    startAt: row.start_at,
    status: row.status as AppointmentStatus,
    price,
    serviceId: row.service_id,
    serviceName: service?.name ?? "—",
    serviceIsActive: service?.is_active ?? true,
    designerId: row.designer_id,
  };
}

// 範圍 [from 00:00+08:00, to+1 00:00+08:00)，所有設計師；設計師篩選由呼叫端對結果套用 filterByDesigners。
export async function fetchReportAppointments(
  supabase: SupabaseClient,
  period: Pick<ReportPeriod, "from" | "to">,
): Promise<Result<ReportAppointment[]>> {
  if (!isRealDate(period.from) || !isRealDate(period.to) || period.from > period.to) {
    return { ok: false, error: INTERNAL_ERROR };
  }

  const rangeStart = `${period.from}T00:00:00+08:00`;
  const rangeEnd = `${addDays(period.to, 1)}T00:00:00+08:00`;
  const rows: RawReportRow[] = [];

  try {
    // 多查一頁（page === MAX_PAGES）只為了分辨「剛好 5000 列」與「超過 5000 列」。
    for (let page = 0; page <= MAX_PAGES; page++) {
      const { data, error } = await supabase
        .from("appointments")
        .select(REPORT_COLUMNS)
        .gte("start_at", rangeStart)
        .lt("start_at", rangeEnd)
        .order("start_at", { ascending: true })
        .order("id", { ascending: true })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      if (error || !data) return { ok: false, error: INTERNAL_ERROR };
      if (page === MAX_PAGES) {
        if (data.length > 0) return { ok: false, error: INTERNAL_ERROR };
        break;
      }
      rows.push(...(data as unknown as RawReportRow[]));
      if (data.length < PAGE_SIZE) break;
    }
  } catch {
    return { ok: false, error: INTERNAL_ERROR };
  }

  const appointments: ReportAppointment[] = [];
  for (const row of rows) {
    const appointment = toReportAppointment(row);
    if (!appointment) return { ok: false, error: INTERNAL_ERROR };
    appointments.push(appointment);
  }
  return { ok: true, data: appointments };
}

// ---- 彙總 ----

function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}

export function summarize(appointments: Pick<ReportAppointment, "status" | "price">[]): ReportTotals {
  let completed = 0;
  let pending = 0;
  let cancelled = 0;
  let revenue = 0;
  let estimated = 0;

  for (const appointment of appointments) {
    if (appointment.status === "completed") {
      completed += 1;
      revenue += appointment.price;
    } else if (appointment.status === "pending" || appointment.status === "confirmed") {
      pending += 1;
      estimated += appointment.price;
    } else if (appointment.status === "cancelled") {
      cancelled += 1;
    }
  }

  return {
    booked: completed + pending,
    completed,
    pending,
    cancelled,
    revenue: roundMoney(revenue),
    estimated: roundMoney(estimated),
  };
}

// ---- 趨勢 ----

// h23：午夜是 0 而不是 24（hour12: false 在部分環境會回 "24"）。
const TAIPEI_HOUR = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", hour: "numeric", hourCycle: "h23" });

function toTaipeiHour(iso: string): number {
  const part = TAIPEI_HOUR.formatToParts(new Date(iso)).find((p) => p.type === "hour");
  return Number(part?.value);
}

function listDates(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
  return dates;
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

const DEFAULT_FIRST_HOUR = 10;
const DEFAULT_LAST_HOUR = 19;

// 月／週：期間內每個 Taipei 日期一格，沒資料補 0、不省略。
// 日：每小時一格，範圍＝min(10, 最早預約小時)～max(19, 最晚預約小時)，保證沒有預約（含已取消）被丟掉。
// 期間以外的預約不屬於此趨勢，直接忽略。
export function buildTrend(period: ReportPeriod, appointments: ReportAppointment[]): TrendBucket[] {
  const inPeriod = appointments.filter((appointment) => {
    const date = toTaipeiDate(appointment.startAt);
    return date >= period.from && date <= period.to;
  });

  if (period.granularity === "day") {
    const byHour = groupBy(inPeriod, (appointment) => String(toTaipeiHour(appointment.startAt)));
    const hours = [...byHour.keys()].map(Number);
    const first = Math.min(DEFAULT_FIRST_HOUR, ...hours);
    const last = Math.max(DEFAULT_LAST_HOUR, ...hours);

    return Array.from({ length: last - first + 1 }, (_, i) => {
      const hour = first + i;
      const label = `${String(hour).padStart(2, "0")}:00`;
      return { key: label, label, ...summarize(byHour.get(String(hour)) ?? []) };
    });
  }

  const byDate = groupBy(inPeriod, (appointment) => toTaipeiDate(appointment.startAt));
  return listDates(period.from, period.to).map((date) => ({
    key: date,
    label: formatDateWithWeekday(date),
    ...summarize(byDate.get(date) ?? []),
  }));
}

// ---- 設計師篩選 ----

// 空＝全部。呼叫端傳入的是 resolveEffectiveSelection 之後的「有效選取」（與預約週曆同一套規則）。
export function filterByDesigners(appointments: ReportAppointment[], effective: string[]): ReportAppointment[] {
  if (effective.length === 0) return appointments;
  const picked = new Set(effective);
  return appointments.filter((appointment) => picked.has(appointment.designerId));
}

// 餵給 buildDesignerChips／countActiveAppointments 的轉接：它們只看設計師與狀態。
export function toReportAppointmentLike(
  appointment: Pick<ReportAppointment, "designerId" | "status">,
): Pick<WeekAppointment, "designer_id" | "status"> {
  return { designer_id: appointment.designerId, status: appointment.status };
}
