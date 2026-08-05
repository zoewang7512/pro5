import type { AvailableSlot, BusinessHours } from "./types";

// 純函式：把 business_hours 的營業時段與 get_available_slots 回傳的可預約時段，
// 合併成前端要畫的完整時段格陣列（30 分鐘一格），已佔用／非營業時間的格子標記為
// disabled，不需要等使用者點了才提示。

export type SlotCell = {
  startAt: string; // ISO timestamp
  timeLabel: string; // "10:00"
  disabled: boolean;
};

const TAIPEI_OFFSET = "+08:00";
const STEP_MS = 30 * 60_000;

export function buildSlotGrid(params: {
  date: string; // YYYY-MM-DD
  durationMinutes: number;
  businessHours: Pick<BusinessHours, "open_time" | "close_time" | "is_closed"> | null;
  availableSlots: AvailableSlot[];
}): SlotCell[] {
  const { date, durationMinutes, businessHours, availableSlots } = params;

  if (!businessHours || businessHours.is_closed || !businessHours.open_time || !businessHours.close_time) {
    return [];
  }

  const openMs = new Date(`${date}T${withSeconds(businessHours.open_time)}${TAIPEI_OFFSET}`).getTime();
  const closeMs = new Date(`${date}T${withSeconds(businessHours.close_time)}${TAIPEI_OFFSET}`).getTime();
  const durationMs = durationMinutes * 60_000;

  if (!Number.isFinite(openMs) || !Number.isFinite(closeMs) || openMs >= closeMs) {
    return [];
  }

  const availableStarts = new Set(availableSlots.map((slot) => new Date(slot.start_at).getTime()));

  const cells: SlotCell[] = [];
  for (let start = openMs; start + durationMs <= closeMs; start += STEP_MS) {
    const startDate = new Date(start);
    cells.push({
      startAt: startDate.toISOString(),
      timeLabel: formatTaipeiTime(startDate),
      disabled: !availableStarts.has(start),
    });
  }

  return cells;
}

function withSeconds(time: string): string {
  return time.length === 5 ? `${time}:00` : time;
}

function formatTaipeiTime(date: Date): string {
  return date.toLocaleTimeString("zh-Hant-TW", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Taipei",
  });
}
