// 純函式：計算週次範圍（週一至週日）與相鄰週次、週曆 7 欄的日期清單。
// Asia/Taipei 全年無 DST，用「解析 YYYY-MM-DD 當作 UTC 午夜」的方式做日期加法可安全
// 避開時區位移問題，寫法比照 lib/booking/date-range.ts。

export type WeekRange = {
  weekStart: string; // YYYY-MM-DD，週一
  weekEnd: string; // YYYY-MM-DD，週日
};

export type WeekDay = {
  date: string; // YYYY-MM-DD
  weekday: number; // 0=日...6=六，對齊 extract(dow)
  weekdayLabel: string;
  month: number;
  day: number;
};

const DAY_MS = 86_400_000;
export const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

export function getTaipeiToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}

function parseDateUTC(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function formatDateUTC(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return formatDateUTC(parseDateUTC(date) + days * DAY_MS);
}

export function getWeekday(date: string): number {
  return new Date(parseDateUTC(date)).getUTCDay();
}

export function getWeekRange(date: string): WeekRange {
  const weekday = new Date(parseDateUTC(date)).getUTCDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday; // 週一為一週起點
  const weekStart = addDays(date, mondayOffset);
  return { weekStart, weekEnd: addDays(weekStart, 6) };
}

export function getPreviousWeek(weekStart: string): WeekRange {
  return getWeekRange(addDays(weekStart, -7));
}

export function getNextWeek(weekStart: string): WeekRange {
  return getWeekRange(addDays(weekStart, 7));
}

export function buildWeekDays(weekStart: string): WeekDay[] {
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i);
    const d = new Date(parseDateUTC(date));
    const weekday = d.getUTCDay();
    return {
      date,
      weekday,
      weekdayLabel: WEEKDAY_LABELS[weekday],
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
    };
  });
}
