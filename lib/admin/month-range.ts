// 純函式：月曆選取器（MonthPicker）用的月份日期清單與跨月導覽計算。
// 日期運算一律用 Date.UTC(year, month - 1, day) 的既有寫法，比照 lib/admin/week-range.ts
// 的 parseDateUTC/formatDateUTC，避開時區位移問題（Asia/Taipei 全年無 DST，但維持
// 與既有純函式一致的寫法習慣）。

export type MonthDay = { date: string; day: number; weekday: number };

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function buildMonthDays(year: number, month: number): MonthDay[] {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: daysInMonth }, (_, i) => {
    const day = i + 1;
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    return { date: `${year}-${pad2(month)}-${pad2(day)}`, day, weekday };
  });
}

export function getPreviousMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

export function getNextMonth(year: number, month: number): { year: number; month: number } {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

export function formatMonthLabel(year: number, month: number): string {
  return `${year} 年 ${month} 月`;
}
