// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithTheme as render } from "../test-utils";
import { ReportsToolbar, type ReportsToolbarProps } from "@/app/admin/_components/ReportsToolbar";
import { getReportPeriod } from "@/lib/admin/reports";

const TODAY = "2026-10-24";

function renderToolbar(props: Partial<ReportsToolbarProps> = {}) {
  const handlers = {
    onGranularityChange: vi.fn(),
    onPrevious: vi.fn(),
    onNext: vi.fn(),
    onToday: vi.fn(),
  };
  render(<ReportsToolbar period={getReportPeriod("month", TODAY, TODAY)} {...handlers} {...props} />);
  return handlers;
}

describe("ReportsToolbar", () => {
  afterEach(() => cleanup());

  it.each([
    ["day", "日", "10/24（六）"],
    ["week", "週", "10/19（一） – 10/25（日）"],
    ["month", "月", "2026 年 10 月"],
  ] as const)("%s 粒度：只有「%s」被選取，期間標籤為 %s", (granularity, selectedLabel, periodLabel) => {
    renderToolbar({ period: getReportPeriod(granularity, TODAY, TODAY) });

    for (const label of ["日", "週", "月"]) {
      expect(screen.getByRole("button", { name: label })).toHaveAttribute("aria-pressed", String(label === selectedLabel));
    }
    expect(screen.getByText(periodLabel)).toBeInTheDocument();
  });

  it("粒度切換是一組帶名稱的單選", () => {
    renderToolbar();
    expect(screen.getByRole("group", { name: "統計單位" })).toBeInTheDocument();
  });

  it("點另一個粒度：回報新粒度；再點已選取的那一個：不回報（單選不能取消）", async () => {
    const user = userEvent.setup({ delay: null });
    const { onGranularityChange } = renderToolbar();

    await user.click(screen.getByRole("button", { name: "週" }));
    expect(onGranularityChange).toHaveBeenCalledWith("week");

    await user.click(screen.getByRole("button", { name: "月" }));
    expect(onGranularityChange).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["day", "上一天", "下一天"],
    ["week", "上一週", "下一週"],
    ["month", "上一個月", "下一個月"],
  ] as const)("%s 粒度：上一期／下一期按鈕的無障礙名稱是 %s／%s", async (granularity, previous, next) => {
    const user = userEvent.setup({ delay: null });
    const { onPrevious, onNext } = renderToolbar({ period: getReportPeriod(granularity, TODAY, TODAY) });

    await user.click(screen.getByRole("button", { name: previous }));
    await user.click(screen.getByRole("button", { name: next }));
    expect(onPrevious).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("「回到本期」：在本期時停用；不在本期時可點", async () => {
    const user = userEvent.setup({ delay: null });
    const { onToday } = renderToolbar({ period: getReportPeriod("month", TODAY, TODAY) });
    expect(screen.getByRole("button", { name: "回到本期" })).toBeDisabled();
    expect(onToday).not.toHaveBeenCalled();

    cleanup();
    const other = renderToolbar({ period: getReportPeriod("month", "2026-09-10", TODAY) });
    expect(screen.getByRole("button", { name: "回到本期" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "回到本期" }));
    expect(other.onToday).toHaveBeenCalledTimes(1);
  });

  it("鍵盤可操作：Tab 依序走過三個粒度、上一期、下一期、回到本期，Enter 觸發", async () => {
    const user = userEvent.setup({ delay: null });
    const { onPrevious } = renderToolbar({ period: getReportPeriod("month", "2026-09-10", TODAY) });

    // 三個粒度按鈕各自是 tab stop。
    await user.tab();
    expect(screen.getByRole("button", { name: "日" })).toHaveFocus();
    await user.tab();
    await user.tab();
    expect(screen.getByRole("button", { name: "月" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "上一個月" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onPrevious).toHaveBeenCalledTimes(1);
    await user.tab();
    expect(screen.getByRole("button", { name: "下一個月" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "回到本期" })).toHaveFocus();
  });

  it("actions 插槽：有傳才渲染，位在最右側", () => {
    renderToolbar({ actions: <button type="button">匯出 Excel</button> });
    expect(screen.getByRole("button", { name: "匯出 Excel" })).toBeInTheDocument();

    cleanup();
    renderToolbar();
    expect(screen.queryByRole("button", { name: "匯出 Excel" })).toBeNull();
  });

  it("期間標籤是 aria-live，切換期間後會被讀出", () => {
    renderToolbar();
    expect(screen.getByText("2026 年 10 月")).toHaveAttribute("aria-live", "polite");
  });
});
