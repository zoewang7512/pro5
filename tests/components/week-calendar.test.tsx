// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import { renderWithTheme as render } from "../test-utils";
import { WeekCalendar } from "@/app/admin/_components/WeekCalendar";
import { buildWeekDays } from "@/lib/admin/week-range";
import type { WeekAppointment } from "@/lib/admin/appointments";

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

const LIN_ID = "00000000-0000-4000-8000-000000000001";

function makeAppointment(overrides: Partial<WeekAppointment> = {}): WeekAppointment {
  return {
    id: "a1",
    customer_name: "王小姐",
    start_at: "2026-08-12T03:00:00+00:00", // 週三 11:00（台北）
    end_at: "2026-08-12T04:00:00+00:00",
    status: "confirmed",
    service_name: "韓系剪髮",
    duration_minutes: 60,
    buffer_minutes: 0,
    designer_id: LIN_ID,
    designer: { id: LIN_ID, name: "林小美", avatar_url: null },
    ...overrides,
  };
}

describe("WeekCalendar 設計師標示與篩選", () => {
  afterEach(() => cleanup());

  function renderWith(props: Partial<React.ComponentProps<typeof WeekCalendar>>) {
    const { container } = render(
      <WeekCalendar
        weekDays={weekDays}
        todayDate="2026-08-10"
        status="loaded"
        appointments={[makeAppointment()]}
        closedWeekdays={new Set()}
        closedDates={new Set()}
        {...props}
      />,
    );
    return Array.from(container.querySelectorAll(".MuiCard-root")).filter((card) =>
      card.parentElement?.classList.contains("MuiBox-root"),
    ) as HTMLElement[];
  }

  it("showDesignerRow 為 true：事件卡顯示設計師名稱", () => {
    renderWith({ showDesignerRow: true });
    expect(screen.getByText("林小美")).toBeInTheDocument();
  });

  it("showDesignerRow 為 false（只勾一位）或省略：事件卡不顯示設計師列", () => {
    const { unmount } = render(
      <WeekCalendar
        weekDays={weekDays}
        todayDate="2026-08-10"
        status="loaded"
        appointments={[makeAppointment()]}
        closedWeekdays={new Set()}
        closedDates={new Set()}
        showDesignerRow={false}
      />,
    );
    expect(screen.queryByText("林小美")).not.toBeInTheDocument();
    unmount();
  });

  it("embed 缺漏（designer 為 null）時不顯示設計師列也不報錯", () => {
    renderWith({ showDesignerRow: true, appointments: [makeAppointment({ designer: null })] });
    expect(screen.getByText("王小姐")).toBeInTheDocument();
  });

  it("請假日標示：該日期格顯示「○○請假」，其他日期格沒有", () => {
    const cards = renderWith({ appointments: [], leaveLabels: new Map([["2026-08-13", ["林小美"]]]) });
    expect(within(cards[THU]).getByText("請假").parentElement).toHaveTextContent("林小美請假");
    expect(within(cards[WED]).queryByText(/請假/)).not.toBeInTheDocument();
  });

  it("同一天多位設計師請假：每位各一個標示", () => {
    const cards = renderWith({ appointments: [], leaveLabels: new Map([["2026-08-13", ["林小美", "陳阿傑"]]]) });
    expect(within(cards[THU]).getAllByText("請假")).toHaveLength(2);
  });

  it("沒有預約但有請假標示的日期格，不再顯示「—」佔位", () => {
    const cards = renderWith({ appointments: [], leaveLabels: new Map([["2026-08-13", ["林小美"]]]) });
    expect(within(cards[THU]).queryByText("—")).not.toBeInTheDocument();
    expect(within(cards[WED]).getByText("—")).toBeInTheDocument();
  });

  it("篩選後沒有預約：顯示「○○本週沒有預約」與提示", () => {
    renderWith({ appointments: [], filteredEmptyTitle: "王大明本週沒有預約" });
    expect(screen.getByText("王大明本週沒有預約")).toBeInTheDocument();
    expect(screen.getByText(/切換到「全部」或其他週次看看/)).toBeInTheDocument();
    expect(screen.queryByText("本週沒有預約")).not.toBeInTheDocument();
  });

  it("整週本來就沒有預約：沿用「本週沒有預約」", () => {
    renderWith({ appointments: [] });
    expect(screen.getByText("本週沒有預約")).toBeInTheDocument();
  });

  it("顧客名稱用 <bdi> 隔離方向", () => {
    renderWith({});
    expect(screen.getByText("王小姐").tagName).toBe("BDI");
  });
});
