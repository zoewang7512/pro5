// 純函式：預約狀態顯示文案／Chip 色彩、時間與週次範圍格式化。
// 與 WeekCalendar／AppointmentListView 兩個畫面共用，避免各自重複定義對照表。

import type { AppointmentStatus } from "./appointments";
import { WEEKDAY_LABELS } from "./week-range";

export const STATUS_LABEL: Record<AppointmentStatus, string> = {
  pending: "待處理",
  confirmed: "已確認",
  completed: "已完成",
  cancelled: "已取消",
};

// 對應 lib/theme 的 semantic 色彩（danger token 掛在 MUI 的 error 色槽）。
export const STATUS_COLOR: Record<AppointmentStatus, "warning" | "info" | "success" | "error"> = {
  pending: "warning",
  confirmed: "info",
  completed: "success",
  cancelled: "error",
};

// 把任意 ISO 時間戳轉成該時刻所屬的 Asia/Taipei 當地日期（YYYY-MM-DD）。
// 兩個檢視都要用這個而不是 iso.slice(0, 10)：直接切 ISO 字串取到的是 UTC 日期，
// 台北時間 08:00 前的預約會落在前一個 UTC 日，group key／顯示日期會跟其他地方對不起來。
export function toTaipeiDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}

export function formatTaipeiTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("zh-Hant-TW", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatTimeRange(startAt: string, endAt: string): string {
  return `${formatTaipeiTime(startAt)}–${formatTaipeiTime(endAt)}`;
}

export function formatWeekRangeLabel(weekStart: string, weekEnd: string): string {
  const [, startMonth, startDay] = weekStart.split("-");
  const [, endMonth, endDay] = weekEnd.split("-");
  return `${Number(startMonth)}/${Number(startDay)} – ${Number(endMonth)}/${Number(endDay)}`;
}

// 「週X M/D」格式，供列表檢視的日期欄與詳情/確認 Dialog 的描述文字共用。
export function formatAppointmentDateLabel(iso: string): string {
  const [year, month, day] = toTaipeiDate(iso).split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return `週${WEEKDAY_LABELS[weekday]} ${month}/${day}`;
}

// "YYYY-MM-DD" -> "YYYY/MM/DD"，特殊公休日清單與受影響預約警告 Modal 共用的日期格式。
export function formatDateSlash(date: string): string {
  return date.replaceAll("-", "/");
}
