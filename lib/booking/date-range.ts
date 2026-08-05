// 純函式：產生日期 chip 列的候選日期範圍。Asia/Taipei 全年無 DST，
// 用「解析 YYYY-MM-DD 當作 UTC 午夜」的方式做日期加法可安全避開時區位移問題。

export type DateOption = {
  date: string; // YYYY-MM-DD
  weekday: number; // 0=日...6=六，對齊 extract(dow)
  weekdayLabel: string;
  day: number;
};

const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

export function getTaipeiToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}

export function buildDateRange(startDate: string, days: number): DateOption[] {
  const [year, month, day] = startDate.split("-").map(Number);
  const baseMs = Date.UTC(year, month - 1, day);

  return Array.from({ length: days }, (_, i) => {
    const current = new Date(baseMs + i * 86_400_000);
    const weekday = current.getUTCDay();
    return {
      date: current.toISOString().slice(0, 10),
      weekday,
      weekdayLabel: WEEKDAY_LABELS[weekday],
      day: current.getUTCDate(),
    };
  });
}
