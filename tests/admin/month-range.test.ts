import { describe, expect, it } from "vitest";
import { buildMonthDays, formatMonthLabel, getNextMonth, getPreviousMonth } from "@/lib/admin/month-range";

describe("buildMonthDays", () => {
  it("產生一般月份（8 月）1 號到月底的完整清單", () => {
    const days = buildMonthDays(2026, 8);

    expect(days).toHaveLength(31);
    expect(days[0]).toEqual({ date: "2026-08-01", day: 1, weekday: 6 }); // 2026-08-01 為週六
    expect(days[30]).toEqual({ date: "2026-08-31", day: 31, weekday: 1 }); // 2026-08-31 為週一
  });

  it("2 月平年只有 28 天", () => {
    const days = buildMonthDays(2026, 2);
    expect(days).toHaveLength(28);
    expect(days[27].date).toBe("2026-02-28");
  });

  it("2 月閏年有 29 天", () => {
    const days = buildMonthDays(2024, 2);
    expect(days).toHaveLength(29);
    expect(days[28].date).toBe("2024-02-29");
  });
});

describe("getPreviousMonth / getNextMonth", () => {
  it("一般月份往前往後各推一個月", () => {
    expect(getPreviousMonth(2026, 8)).toEqual({ year: 2026, month: 7 });
    expect(getNextMonth(2026, 8)).toEqual({ year: 2026, month: 9 });
  });

  it("1 月的上個月是去年 12 月", () => {
    expect(getPreviousMonth(2026, 1)).toEqual({ year: 2025, month: 12 });
  });

  it("12 月的下個月是明年 1 月", () => {
    expect(getNextMonth(2026, 12)).toEqual({ year: 2027, month: 1 });
  });
});

describe("formatMonthLabel", () => {
  it("格式化為「YYYY 年 M 月」", () => {
    expect(formatMonthLabel(2026, 8)).toBe("2026 年 8 月");
    expect(formatMonthLabel(2027, 1)).toBe("2027 年 1 月");
  });
});
