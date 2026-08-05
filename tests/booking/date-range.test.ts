import { describe, expect, it } from "vitest";
import { buildDateRange } from "@/lib/booking/date-range";

describe("buildDateRange", () => {
  it("產生連續 N 天，日期與星期正確遞增", () => {
    const options = buildDateRange("2026-08-05", 3);

    expect(options).toHaveLength(3);
    expect(options.map((o) => o.date)).toEqual(["2026-08-05", "2026-08-06", "2026-08-07"]);
    // 2026-08-05 為週三
    expect(options[0]).toMatchObject({ weekday: 3, weekdayLabel: "三", day: 5 });
    expect(options[1]).toMatchObject({ weekday: 4, weekdayLabel: "四", day: 6 });
  });

  it("跨月份時日期正確進位", () => {
    const options = buildDateRange("2026-08-30", 3);
    expect(options.map((o) => o.date)).toEqual(["2026-08-30", "2026-08-31", "2026-09-01"]);
  });
});
