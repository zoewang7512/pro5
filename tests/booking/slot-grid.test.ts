import { describe, expect, it } from "vitest";
import { buildSlotGrid } from "@/lib/booking/slot-grid";

const OPEN_HOURS = { open_time: "10:00:00", close_time: "12:00:00", is_closed: false };

describe("buildSlotGrid", () => {
  it("公休日回傳空陣列", () => {
    const cells = buildSlotGrid({
      date: "2026-08-09",
      durationMinutes: 45,
      businessHours: { open_time: null, close_time: null, is_closed: true },
      availableSlots: [],
    });
    expect(cells).toEqual([]);
  });

  it("找不到 business_hours（null）視同無法產生時段", () => {
    const cells = buildSlotGrid({
      date: "2026-08-05",
      durationMinutes: 45,
      businessHours: null,
      availableSlots: [],
    });
    expect(cells).toEqual([]);
  });

  it("依營業時間與服務時長產生 30 分鐘格點，且對齊起訖", () => {
    const cells = buildSlotGrid({
      date: "2026-08-05",
      durationMinutes: 45,
      businessHours: OPEN_HOURS,
      availableSlots: [],
    });
    // 10:00-12:00，45 分鐘服務：10:00,10:30,11:00 可產生（11:00+45=11:45<=12:00）；
    // 11:30+45=12:15 超過 12:00，不產生。
    expect(cells.map((c) => c.timeLabel)).toEqual(["10:00", "10:30", "11:00"]);
  });

  it("已被 create_appointment 佔用的時段標記為 disabled，其餘維持可點擊", () => {
    const cells = buildSlotGrid({
      date: "2026-08-05",
      durationMinutes: 45,
      businessHours: OPEN_HOURS,
      availableSlots: [
        { start_at: "2026-08-05T02:00:00+00:00", end_at: "2026-08-05T02:45:00+00:00" }, // 10:00 台北時間
        { start_at: "2026-08-05T03:00:00+00:00", end_at: "2026-08-05T03:45:00+00:00" }, // 11:00 台北時間
      ],
    });

    expect(cells).toEqual([
      { startAt: "2026-08-05T02:00:00.000Z", timeLabel: "10:00", disabled: false },
      { startAt: "2026-08-05T02:30:00.000Z", timeLabel: "10:30", disabled: true },
      { startAt: "2026-08-05T03:00:00.000Z", timeLabel: "11:00", disabled: false },
    ]);
  });

  it("完全沒有可預約時段時，每一格皆 disabled（空狀態由呼叫端據此判斷）", () => {
    const cells = buildSlotGrid({
      date: "2026-08-05",
      durationMinutes: 45,
      businessHours: OPEN_HOURS,
      availableSlots: [],
    });
    expect(cells.every((c) => c.disabled)).toBe(true);
  });
});
