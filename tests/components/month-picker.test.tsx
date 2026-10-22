// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithTheme as render } from "../test-utils";
import { MonthPicker } from "@/components/ui/MonthPicker";

// 2026 年 10 月；今天固定 21 日，22 日以後可點。
const TODAY = "2026-10-21";

function renderPicker(props: Partial<React.ComponentProps<typeof MonthPicker>> = {}) {
  const onDayClick = vi.fn();
  const onMonthChange = vi.fn();
  render(
    <MonthPicker
      year={2026}
      month={10}
      todayDate={TODAY}
      markedDates={new Set()}
      onDayClick={onDayClick}
      onMonthChange={onMonthChange}
      {...props}
    />,
  );
  return { onDayClick, onMonthChange };
}

describe("MonthPicker", () => {
  afterEach(() => cleanup());

  it("未來日期可點、過去日期不能點", async () => {
    const user = userEvent.setup({ delay: null });
    const { onDayClick } = renderPicker();

    await user.click(screen.getByRole("button", { name: "22" }));
    expect(onDayClick).toHaveBeenCalledWith("2026-10-22");

    await user.click(screen.getByRole("button", { name: "20" }));
    expect(onDayClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "20" })).toHaveAttribute("aria-disabled", "true");
  });

  it("今天本身可點（只有早於今天才停用）", async () => {
    const user = userEvent.setup({ delay: null });
    const { onDayClick } = renderPicker();
    expect(screen.getByRole("button", { name: "21" })).toHaveAttribute("aria-disabled", "false");
    await user.click(screen.getByRole("button", { name: "21" }));
    expect(onDayClick).toHaveBeenCalledWith(TODAY);
  });

  it("唯讀日期（readOnlyDates）：不可點、鍵盤也不能觸發，無障礙名稱含日期與說明", async () => {
    const user = userEvent.setup({ delay: null });
    const { onDayClick } = renderPicker({ readOnlyDates: new Set(["2026-10-27"]), readOnlyLabel: "全店公休" });

    const cell = screen.getByRole("button", { name: "27 日，全店公休" });
    expect(cell).toHaveAttribute("aria-disabled", "true");
    expect(cell).toHaveAttribute("tabindex", "-1");
    expect(cell).toHaveStyle({ textDecoration: "line-through" });

    await user.click(cell);
    cell.focus();
    await user.keyboard("{Enter}");
    expect(onDayClick).not.toHaveBeenCalled();

    // 沒列入唯讀的日期照常可點，名稱仍是純數字。
    await user.click(screen.getByRole("button", { name: "28" }));
    expect(onDayClick).toHaveBeenCalledWith("2026-10-28");
  });

  it("唯讀日期優先於已標記樣式（不顯示已標記狀態），其他已標記日期不受影響", () => {
    renderPicker({
      markedDates: new Set(["2026-10-27", "2026-10-29"]),
      readOnlyDates: new Set(["2026-10-27"]),
    });
    expect(screen.getByRole("button", { name: "27 日，不可選" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "29" })).toHaveAttribute("aria-pressed", "true");
  });

  it("省略 readOnlyDates 時行為不變：已標記日期可點、名稱不帶說明", async () => {
    const user = userEvent.setup({ delay: null });
    const { onDayClick } = renderPicker({ markedDates: new Set(["2026-10-27"]) });

    const cell = screen.getByRole("button", { name: "27" });
    expect(cell).toHaveAttribute("aria-pressed", "true");
    expect(cell).not.toHaveAttribute("aria-label");
    await user.click(cell);
    expect(onDayClick).toHaveBeenCalledWith("2026-10-27");
  });

  it("跨月導覽回報新的年月（含跨年）", async () => {
    const user = userEvent.setup({ delay: null });
    const { onMonthChange } = renderPicker({ year: 2026, month: 12 });
    await user.click(screen.getByRole("button", { name: "下個月" }));
    expect(onMonthChange).toHaveBeenCalledWith(2027, 1);
  });
});
