// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { within } from "@testing-library/react";
import { renderWithTheme as render } from "../test-utils";
import { WeekCalendar } from "@/app/admin/_components/WeekCalendar";
import { buildWeekDays } from "@/lib/admin/week-range";

// 固定用 2026-08-10（週一）當週：週一 08/10 ~ 週日 08/16，涵蓋 closedWeekdays（週日）與
// closedDates（特定日期）兩種公休來源各自獨立命中的情況，驗證 WeekCalendar 的
// isClosed = closedWeekdays.has(day.weekday) || closedDates.has(day.date) 合併邏輯。
// buildWeekDays 回傳順序固定為週一→週日，用陣列 index 對應日期比用文字內容比對穩定
// （Typography 內的 {a} {b}/{c} 會被拆成多個獨立 text node，不適合用 getByText 整段比對）。
const weekDays = buildWeekDays("2026-08-10");
const MON = 0;
const WED = 2;
const THU = 3;
const SUN = 6;

function renderCalendar(closedWeekdays: Set<number>, closedDates: Set<string>) {
  const { container } = render(
    <WeekCalendar
      weekDays={weekDays}
      todayDate="2026-08-10"
      status="loaded"
      appointments={[]}
      closedWeekdays={closedWeekdays}
      closedDates={closedDates}
    />,
  );
  const cards = container.querySelectorAll(".MuiCard-root");
  expect(cards).toHaveLength(7);
  return Array.from(cards) as HTMLElement[];
}

describe("WeekCalendar", () => {
  it("只命中 closedWeekdays（每週固定公休）的日期顯示公休", () => {
    const cards = renderCalendar(new Set([0]), new Set());
    expect(within(cards[SUN]).getByText(/公休/)).toBeInTheDocument();
    expect(within(cards[WED]).queryByText(/公休/)).not.toBeInTheDocument();
  });

  it("只命中 closedDates（特定日期公休）的日期顯示公休", () => {
    const cards = renderCalendar(new Set(), new Set(["2026-08-13"]));
    expect(within(cards[THU]).getByText(/公休/)).toBeInTheDocument();
    expect(within(cards[WED]).queryByText(/公休/)).not.toBeInTheDocument();
  });

  it("同一天同時命中兩種來源仍正確顯示公休（不重複顯示、不出錯）", () => {
    const cards = renderCalendar(new Set([0]), new Set(["2026-08-16"]));
    expect(within(cards[SUN]).getAllByText(/公休/)).toHaveLength(1);
  });

  it("兩種來源都沒命中時不顯示公休", () => {
    const cards = renderCalendar(new Set(), new Set());
    for (const card of cards) {
      expect(within(card).queryByText(/公休/)).not.toBeInTheDocument();
    }
  });

  it("多筆狀態卡片渲染時，事件卡不受公休合併判斷影響（沿用既有渲染邏輯）", () => {
    const cards = renderCalendar(new Set(), new Set(["2026-08-11"]));
    // 08-11（週二）被標記公休：外層卡片仍正常渲染，且沒有既有的「—」無預約提示
    // （isClosed === true 時不顯示，比照既有邏輯，見 WeekCalendar.tsx）。
    expect(within(cards[MON]).getByText("—")).toBeInTheDocument();
    expect(within(cards[1]).queryByText("—")).not.toBeInTheDocument();
  });
});
