import { describe, expect, it } from "vitest";
import { buildWeekDays, getNextWeek, getPreviousWeek, getWeekRange } from "@/lib/admin/week-range";

describe("getWeekRange", () => {
  it("週三算出正確的週一與週日", () => {
    // 2026-08-05 為週三
    expect(getWeekRange("2026-08-05")).toEqual({ weekStart: "2026-08-03", weekEnd: "2026-08-09" });
  });

  it("週一本身就是週次起點", () => {
    expect(getWeekRange("2026-08-10")).toEqual({ weekStart: "2026-08-10", weekEnd: "2026-08-16" });
  });

  it("週日算出所屬那週（往回算，不是下一週）", () => {
    expect(getWeekRange("2026-08-16")).toEqual({ weekStart: "2026-08-10", weekEnd: "2026-08-16" });
  });

  it("跨月份時正確進位", () => {
    expect(getWeekRange("2026-08-31")).toEqual({ weekStart: "2026-08-31", weekEnd: "2026-09-06" });
  });
});

describe("getPreviousWeek / getNextWeek", () => {
  it("往前往後各推算一週", () => {
    expect(getPreviousWeek("2026-08-10")).toEqual({ weekStart: "2026-08-03", weekEnd: "2026-08-09" });
    expect(getNextWeek("2026-08-10")).toEqual({ weekStart: "2026-08-17", weekEnd: "2026-08-23" });
  });
});

describe("buildWeekDays", () => {
  it("產生週一到週日 7 天，星期正確遞增", () => {
    const days = buildWeekDays("2026-08-10");

    expect(days).toHaveLength(7);
    expect(days.map((d) => d.date)).toEqual([
      "2026-08-10",
      "2026-08-11",
      "2026-08-12",
      "2026-08-13",
      "2026-08-14",
      "2026-08-15",
      "2026-08-16",
    ]);
    expect(days[0]).toMatchObject({ weekday: 1, weekdayLabel: "一", month: 8, day: 10 });
    expect(days[6]).toMatchObject({ weekday: 0, weekdayLabel: "日", month: 8, day: 16 });
  });
});
