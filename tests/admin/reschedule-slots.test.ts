import { describe, expect, it } from "vitest";
import { computeAvailableSlots } from "@/lib/admin/reschedule-slots";

// 2026-08-10 為週一，營業時間 10:00–19:00（比照 scripts/seed-booking-data.mjs 的種子資料）。
const BUSINESS_HOURS = { open_time: "10:00", close_time: "19:00", is_closed: false };
const FAR_FUTURE_NOW = new Date("2026-08-01T00:00:00+08:00").getTime();

describe("computeAvailableSlots", () => {
  it("公休日回傳空陣列", () => {
    const slots = computeAvailableSlots({
      date: "2026-08-10",
      durationMinutes: 45,
      businessHours: { open_time: null, close_time: null, is_closed: true },
      occupiedRanges: [],
      now: FAR_FUTURE_NOW,
      bufferMinutes: 0,
      isClosedDate: false,
    });
    expect(slots).toEqual([]);
  });

  it("business_hours 查無資料（null）視同不可預約", () => {
    const slots = computeAvailableSlots({
      date: "2026-08-10",
      durationMinutes: 45,
      businessHours: null,
      occupiedRanges: [],
      now: FAR_FUTURE_NOW,
      bufferMinutes: 0,
      isClosedDate: false,
    });
    expect(slots).toEqual([]);
  });

  it("isClosedDate: true 時回傳空陣列，即使當天 business_hours 本來正常營業", () => {
    const slots = computeAvailableSlots({
      date: "2026-08-10",
      durationMinutes: 45,
      businessHours: BUSINESS_HOURS,
      occupiedRanges: [],
      now: FAR_FUTURE_NOW,
      bufferMinutes: 0,
      isClosedDate: true,
    });
    expect(slots).toEqual([]);
  });

  it("無已佔用時段時，10:00–19:00／45 分鐘服務產生 30 分鐘步進的格點", () => {
    const slots = computeAvailableSlots({
      date: "2026-08-10",
      durationMinutes: 45,
      businessHours: BUSINESS_HOURS,
      occupiedRanges: [],
      now: FAR_FUTURE_NOW,
      bufferMinutes: 0,
      isClosedDate: false,
    });
    // 起點固定 10:00，每 30 分鐘一格（10:00, 10:30, 11:00, ...）；
    // 最後一格開始時間 + 45 分鐘須 <= 19:00 → 最後一格是 18:00（18:30+45=19:15 已超過）。
    expect(slots[0].start_at).toBe(new Date("2026-08-10T10:00:00+08:00").toISOString());
    expect(slots.at(-1)!.start_at).toBe(new Date("2026-08-10T18:00:00+08:00").toISOString());
  });

  it("與既有預約重疊的時段被排除，不重疊的下一格仍保留（bufferMinutes: 0 時行為與修改前一致，回歸安全網）", () => {
    const slots = computeAvailableSlots({
      date: "2026-08-10",
      durationMinutes: 45,
      businessHours: BUSINESS_HOURS,
      occupiedRanges: [
        { start_at: "2026-08-10T02:00:00.000Z", end_at: "2026-08-10T02:45:00.000Z", buffer_minutes: 0 },
      ], // 10:00–10:45 台北時間
      now: FAR_FUTURE_NOW,
      bufferMinutes: 0,
      isClosedDate: false,
    });
    const startTimes = slots.map((s) => s.start_at);
    // 10:00 起的格子 [10:00,10:45) 與佔用區間完全重疊；10:30 起的格子 [10:30,11:15) 也與
    // 佔用區間 [10:00,10:45) 重疊（10:30 < 10:45）；11:00 起的格子 [11:00,11:45) 才不重疊。
    expect(startTimes).not.toContain(new Date("2026-08-10T10:00:00+08:00").toISOString());
    expect(startTimes).not.toContain(new Date("2026-08-10T10:30:00+08:00").toISOString());
    expect(startTimes).toContain(new Date("2026-08-10T11:00:00+08:00").toISOString());
  });

  it("已經過去的時段不計入可預約清單（新時段須為未來時間）", () => {
    const now = new Date("2026-08-10T12:00:00+08:00").getTime(); // 台北時間中午 12:00
    const slots = computeAvailableSlots({
      date: "2026-08-10",
      durationMinutes: 45,
      businessHours: BUSINESS_HOURS,
      occupiedRanges: [],
      now,
      bufferMinutes: 0,
      isClosedDate: false,
    });
    const startTimes = slots.map((s) => s.start_at);
    expect(startTimes).not.toContain(new Date("2026-08-10T10:00:00+08:00").toISOString());
    expect(startTimes).not.toContain(new Date("2026-08-10T12:00:00+08:00").toISOString());
    expect(startTimes).toContain(new Date("2026-08-10T12:30:00+08:00").toISOString());
  });

  it("既有預約的 buffer_minutes 會延伸其佔用區間，排除間隔不足的候選時段", () => {
    // 既有預約 10:00–10:45（buffer_minutes: 30）→ 有效佔用區間延伸到 11:15。
    const slots = computeAvailableSlots({
      date: "2026-08-10",
      durationMinutes: 45,
      businessHours: BUSINESS_HOURS,
      occupiedRanges: [
        { start_at: "2026-08-10T02:00:00.000Z", end_at: "2026-08-10T02:45:00.000Z", buffer_minutes: 30 },
      ],
      now: FAR_FUTURE_NOW,
      bufferMinutes: 0,
      isClosedDate: false,
    });
    const startTimes = slots.map((s) => s.start_at);
    // 11:00 起的格子 [11:00,11:45) 與延伸後的佔用區間 [10:00,11:15) 仍重疊（11:00 < 11:15），
    // 11:30 起的格子 [11:30,12:15) 才不重疊。
    expect(startTimes).not.toContain(new Date("2026-08-10T11:00:00+08:00").toISOString());
    expect(startTimes).toContain(new Date("2026-08-10T11:30:00+08:00").toISOString());
  });

  it("候選時段自己的 bufferMinutes 也會延伸自己的效力區間，不能緊貼在既有預約之前", () => {
    // 既有預約 11:30–12:15（buffer_minutes: 0）；候選服務 bufferMinutes: 30。時段格點固定
    // 30 分鐘步進（10:00, 10:30, 11:00, ...），候選 10:30 起的格子 [10:30,11:15) 本身不與
    // 既有預約重疊，但加上候選自己的 30 分鐘緩衝後效力區間到 11:45，與 [11:30,12:15) 重疊，
    // 須排除；候選 10:00 起的格子 [10:00,10:45)＋緩衝到 11:15，仍在既有預約開始之前，保留。
    const slots = computeAvailableSlots({
      date: "2026-08-10",
      durationMinutes: 45,
      businessHours: BUSINESS_HOURS,
      occupiedRanges: [
        { start_at: "2026-08-10T03:30:00.000Z", end_at: "2026-08-10T04:15:00.000Z", buffer_minutes: 0 },
      ], // 11:30–12:15 台北時間
      now: FAR_FUTURE_NOW,
      bufferMinutes: 30,
      isClosedDate: false,
    });
    const startTimes = slots.map((s) => s.start_at);
    expect(startTimes).not.toContain(new Date("2026-08-10T10:30:00+08:00").toISOString());
    expect(startTimes).toContain(new Date("2026-08-10T10:00:00+08:00").toISOString());
  });

  it("恰好卡在緩衝後的邊界上（effectiveEnd === range.start）不算重疊，格點剛好可以緊接在後", () => {
    // 既有預約 10:00–11:00（60 分鐘，buffer_minutes: 30）→ 有效佔用區間 [10:00,11:30)，
    // 11:30 剛好落在 30 分鐘格點上。候選 bufferMinutes: 0：11:00 起的格子 [11:00,11:45)
    // 仍與 [10:00,11:30) 重疊（11:00 < 11:30）；11:30 起的格子恰好緊接在緩衝結束後
    // （start === range.end），依半開區間 [) 的既有語意（比照 tstzrange 與
    // appointments_no_overlap 的既有邊界規則）不算重疊，須保留，驗證嚴格不等式邊界正確，
    // 不會有人不小心把 `<` 改成 `<=` 卻沒被任何測試抓到。
    const slots = computeAvailableSlots({
      date: "2026-08-10",
      durationMinutes: 45,
      businessHours: BUSINESS_HOURS,
      occupiedRanges: [
        { start_at: "2026-08-10T02:00:00.000Z", end_at: "2026-08-10T03:00:00.000Z", buffer_minutes: 30 },
      ], // 10:00–11:00 台北時間
      now: FAR_FUTURE_NOW,
      bufferMinutes: 0,
      isClosedDate: false,
    });
    const startTimes = slots.map((s) => s.start_at);
    expect(startTimes).not.toContain(new Date("2026-08-10T11:00:00+08:00").toISOString());
    expect(startTimes).toContain(new Date("2026-08-10T11:30:00+08:00").toISOString());
  });

  it("既有預約與候選時段的緩衝時間不對稱（雙方皆非 0 且數值不同）時仍正確判斷", () => {
    // 既有預約 10:00–10:30（buffer_minutes: 30）→ 有效佔用區間 [10:00,11:00)。
    // 候選服務 bufferMinutes: 15：10:30 起的格子 [10:30,11:00)＋緩衝到 11:15，與
    // [10:00,11:00) 重疊（10:30 < 11:00），須排除；11:00 起的格子恰好緊接在既有預約緩衝
    // 結束後（start === range.end），不算重疊，須保留。
    const slots = computeAvailableSlots({
      date: "2026-08-10",
      durationMinutes: 30,
      businessHours: BUSINESS_HOURS,
      occupiedRanges: [
        { start_at: "2026-08-10T02:00:00.000Z", end_at: "2026-08-10T02:30:00.000Z", buffer_minutes: 30 },
      ], // 10:00–10:30 台北時間
      now: FAR_FUTURE_NOW,
      bufferMinutes: 15,
      isClosedDate: false,
    });
    const startTimes = slots.map((s) => s.start_at);
    expect(startTimes).not.toContain(new Date("2026-08-10T10:30:00+08:00").toISOString());
    expect(startTimes).toContain(new Date("2026-08-10T11:00:00+08:00").toISOString());
  });

  it("多筆既有預約各自帶不同的 buffer_minutes 時，逐筆比對皆正確套用（不只取到陣列第一筆）", () => {
    // 兩筆既有預約：A 10:00–10:30（buffer 0，有效區間 [10:00,10:30)）、
    // B 14:00–14:30（buffer 60，有效區間 [14:00,15:30)）。候選 bufferMinutes: 0。
    const slots = computeAvailableSlots({
      date: "2026-08-10",
      durationMinutes: 30,
      businessHours: BUSINESS_HOURS,
      occupiedRanges: [
        { start_at: "2026-08-10T02:00:00.000Z", end_at: "2026-08-10T02:30:00.000Z", buffer_minutes: 0 }, // 10:00–10:30
        { start_at: "2026-08-10T06:00:00.000Z", end_at: "2026-08-10T06:30:00.000Z", buffer_minutes: 60 }, // 14:00–14:30
      ],
      now: FAR_FUTURE_NOW,
      bufferMinutes: 0,
      isClosedDate: false,
    });
    const startTimes = slots.map((s) => s.start_at);
    // A 的緩衝為 0，10:30 起的格子恰好緊接在後，不受 A 影響，保留。
    expect(startTimes).toContain(new Date("2026-08-10T10:30:00+08:00").toISOString());
    // 不受任一筆既有預約影響的中段時段維持保留（確認多筆佔用不會互相汙染不相關的格子）。
    expect(startTimes).toContain(new Date("2026-08-10T12:00:00+08:00").toISOString());
    // B 的 60 分鐘緩衝延伸到 15:30，14:30 起的格子與其重疊，須排除。
    expect(startTimes).not.toContain(new Date("2026-08-10T14:30:00+08:00").toISOString());
    // 15:30 起的格子恰好緊接在 B 的緩衝結束後，不算重疊，保留。
    expect(startTimes).toContain(new Date("2026-08-10T15:30:00+08:00").toISOString());
  });
});
