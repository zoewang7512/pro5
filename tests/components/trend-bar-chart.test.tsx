// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithTheme as render, render as rtlRender, TestThemeWrapper } from "../test-utils";
import { TrendBarChart, type TrendBarBucket, type TrendBarChartProps } from "@/components/ui/TrendBarChart";

function bucket(index: number, overrides: Partial<TrendBarBucket> = {}): TrendBarBucket {
  const day = index + 1;
  return {
    key: `2026-10-${String(day).padStart(2, "0")}`,
    label: String(day),
    segments: [
      { value: 4, kind: "solid" },
      { value: 2, kind: "striped" },
    ],
    tooltip: [`10/${day}`, "預約量 6 筆", "完成 4 ・ 待完成 2"],
    ariaLabel: `10/${day}，預約 6 筆，完成 4、待完成 2`,
    ...overrides,
  };
}

function buckets(count: number, overrides: (index: number) => Partial<TrendBarBucket> = () => ({})) {
  return Array.from({ length: count }, (_, i) => bucket(i, overrides(i)));
}

function renderChart(props: Partial<TrendBarChartProps> = {}) {
  return render(<TrendBarChart buckets={buckets(7)} max={12} ariaLabel="預約量（每日）" {...props} />);
}

const columns = () => screen.getAllByRole("img");

function segmentsOf(column: HTMLElement) {
  return Array.from(column.querySelectorAll<HTMLElement>("[data-kind]")).map((el) => ({
    kind: el.dataset.kind,
    height: parseFloat(el.style.height),
  }));
}

describe("TrendBarChart", () => {
  afterEach(() => cleanup());

  describe("長條高度與堆疊", () => {
    it("高度＝value / max × 180px", () => {
      renderChart({ buckets: [bucket(0, { segments: [{ value: 6, kind: "solid" }] })], max: 12 });
      expect(segmentsOf(columns()[0])).toEqual([{ kind: "solid", height: 90 }]);
    });

    it("solid 在下、striped 在上（DOM 順序＝由下往上），不論傳入順序", () => {
      renderChart({
        buckets: [
          bucket(0, {
            segments: [
              { value: 3, kind: "striped" },
              { value: 6, kind: "solid" },
            ],
          }),
        ],
        max: 12,
      });
      expect(segmentsOf(columns()[0])).toEqual([
        { kind: "solid", height: 90 },
        { kind: "striped", height: 45 },
      ]);
      const stack = columns()[0].querySelector("[data-kind]")!.parentElement!;
      expect(stack).toHaveStyle({ flexDirection: "column-reverse" });
    });

    it("值為 0 的段不渲染，但該格仍佔位（欄位數＝buckets 數）", () => {
      renderChart({
        buckets: [
          bucket(0, { segments: [] }),
          bucket(1, { segments: [{ value: 0, kind: "solid" }, { value: 0, kind: "striped" }] }),
          bucket(2),
        ],
      });
      expect(columns()).toHaveLength(3);
      expect(segmentsOf(columns()[0])).toEqual([]);
      expect(segmentsOf(columns()[1])).toEqual([]);
      expect(segmentsOf(columns()[2])).toHaveLength(2);
    });

    it("值 > 0 但太小：至少 2px", () => {
      renderChart({ buckets: [bucket(0, { segments: [{ value: 0.01, kind: "solid" }] })], max: 1000 });
      expect(segmentsOf(columns()[0])).toEqual([{ kind: "solid", height: 2 }]);
    });

    it("超過 max：被夾在長條區頂端（總高 ≤ 180px），多出來的段不再疊上去", () => {
      renderChart({
        buckets: [
          bucket(0, { segments: [{ value: 50, kind: "solid" }] }),
          bucket(1, {
            segments: [
              { value: 9, kind: "solid" },
              { value: 9, kind: "striped" },
            ],
          }),
          bucket(2, {
            segments: [
              { value: 12, kind: "solid" },
              { value: 3, kind: "striped" },
            ],
          }),
        ],
        max: 12,
      });
      expect(segmentsOf(columns()[0])).toEqual([{ kind: "solid", height: 180 }]);
      expect(segmentsOf(columns()[1])).toEqual([
        { kind: "solid", height: 135 },
        { kind: "striped", height: 45 },
      ]);
      // 已經頂到上緣，後面的段不渲染（總高不超過 180）。
      expect(segmentsOf(columns()[2])).toEqual([{ kind: "solid", height: 180 }]);
    });

    it("max 不是正數：不畫任何長條（避免除以 0／NaN 高度）", () => {
      renderChart({ max: 0 });
      for (const column of columns()) expect(segmentsOf(column)).toEqual([]);
    });
  });

  describe("軸與圖例", () => {
    it("y 軸三個刻度：max、max/2、0，套用 formatTick", () => {
      renderChart({ max: 12000, formatTick: (n) => `${n / 1000}k` });
      expect(screen.getByText("12k")).toBeInTheDocument();
      expect(screen.getByText("6k")).toBeInTheDocument();
      expect(screen.getByText("0k")).toBeInTheDocument();
    });

    it("x 軸標籤稀疏化：showLabel=false 仍佔位但看不見", () => {
      renderChart({ buckets: buckets(5, (i) => ({ showLabel: i % 2 === 0 })) });
      const label = (text: string) => screen.getByText(text, { selector: "[aria-hidden='true']" });
      expect(label("1")).toHaveStyle({ visibility: "visible" });
      expect(label("2")).toHaveStyle({ visibility: "hidden" });
      expect(label("3")).toHaveStyle({ visibility: "visible" });
    });

    it("今天：標籤粗體、該格帶 aria-current=date，其他格沒有", () => {
      renderChart({ buckets: buckets(4, (i) => ({ today: i === 2 })) });
      const current = columns().filter((c) => c.getAttribute("aria-current") === "date");
      expect(current).toHaveLength(1);
      expect(current[0]).toBe(columns()[2]);
      expect(screen.getByText("3", { selector: "[aria-hidden='true']" })).toHaveStyle({ fontWeight: "700" });
      expect(screen.getByText("2", { selector: "[aria-hidden='true']" })).toHaveStyle({ fontWeight: "400" });
    });

    it("圖例：已完成（實心）與待完成（斜紋）兩個標記各帶文字", () => {
      const { container } = renderChart({ legend: { solid: "已完成", striped: "待完成" } });
      expect(screen.getByText("已完成")).toBeInTheDocument();
      expect(screen.getByText("待完成")).toBeInTheDocument();
      expect(container.querySelector("[data-legend='solid']")).not.toBeNull();
      expect(container.querySelector("[data-legend='striped']")).not.toBeNull();
    });

    it("沒給 legend 就不渲染圖例", () => {
      const { container } = renderChart();
      expect(container.querySelector("[data-legend]")).toBeNull();
    });
  });

  describe("tooltip", () => {
    it("預設不顯示；hover 顯示該格內容（多行，第一行粗體），移開後消失", async () => {
      const user = userEvent.setup({ delay: null });
      renderChart();
      expect(screen.queryByRole("tooltip", { hidden: true })).toBeNull();

      await user.hover(columns()[2]);
      const tip = screen.getByRole("tooltip", { hidden: true });
      expect(within(tip).getByText("10/3")).toHaveStyle({ fontWeight: "700" });
      expect(within(tip).getByText("預約量 6 筆")).toHaveStyle({ fontWeight: "400" });
      expect(within(tip).getByText("完成 4 ・ 待完成 2")).toBeInTheDocument();

      await user.unhover(columns()[2]);
      expect(screen.queryByRole("tooltip", { hidden: true })).toBeNull();
    });

    it("鍵盤聚焦顯示、失焦消失", async () => {
      const user = userEvent.setup({ delay: null });
      renderChart();
      await user.tab();
      expect(columns()[0]).toHaveFocus();
      expect(within(screen.getByRole("tooltip", { hidden: true })).getByText("10/1")).toBeInTheDocument();

      await user.tab();
      expect(screen.queryByRole("tooltip", { hidden: true })).toBeNull();
    });

    it("方向鍵移動焦點後，提示跟著換到新的一格", async () => {
      const user = userEvent.setup({ delay: null });
      renderChart();
      await user.tab();
      await user.keyboard("{ArrowRight}");
      expect(columns()[1]).toHaveFocus();
      expect(within(screen.getByRole("tooltip", { hidden: true })).getByText("10/2")).toBeInTheDocument();
    });

    it("Esc 關閉提示；再 hover 或移動焦點會重新顯示", async () => {
      const user = userEvent.setup({ delay: null });
      renderChart();
      await user.tab();
      expect(screen.getByRole("tooltip", { hidden: true })).toBeInTheDocument();

      await user.keyboard("{Escape}");
      expect(screen.queryByRole("tooltip", { hidden: true })).toBeNull();

      await user.keyboard("{ArrowRight}");
      expect(screen.getByRole("tooltip", { hidden: true })).toBeInTheDocument();

      await user.keyboard("{Escape}");
      await user.hover(columns()[4]);
      expect(within(screen.getByRole("tooltip", { hidden: true })).getByText("10/5")).toBeInTheDocument();
    });

    it("提示顯示時 Esc 不再往外傳；沒有提示時照常往外傳（外層 Dialog 仍能被 Esc 關閉）", async () => {
      const user = userEvent.setup({ delay: null });
      const onOuterKeyDown = vi.fn();
      render(
        <div onKeyDown={onOuterKeyDown}>
          <TrendBarChart buckets={buckets(3)} max={12} ariaLabel="x" />
        </div>,
      );
      await user.tab();
      await user.keyboard("{Escape}");
      expect(onOuterKeyDown).not.toHaveBeenCalled();

      await user.keyboard("{Escape}");
      expect(onOuterKeyDown).toHaveBeenCalledTimes(1);
    });

    it("點一下（觸控）該格就顯示提示", async () => {
      const user = userEvent.setup({ delay: null });
      renderChart();
      await user.click(columns()[3]);
      expect(within(screen.getByRole("tooltip", { hidden: true })).getByText("10/4")).toBeInTheDocument();
    });

    it("一律純文字：名稱含 HTML 字元也不會被解析成標籤", async () => {
      const user = userEvent.setup({ delay: null });
      const { container } = renderChart({
        buckets: [bucket(0, { tooltip: ["<img src=x onerror=alert(1)>", "<b>粗</b>"], ariaLabel: "<i>x</i>" })],
      });
      await user.hover(columns()[0]);
      expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
      expect(container.querySelector("img")).toBeNull();
      expect(container.querySelector("b")).toBeNull();
      expect(container.querySelector("i[aria-hidden]")).toBeNull();
    });
  });

  describe("鍵盤與 roving tabindex", () => {
    it("整張圖只有一個 tab stop：預設第一格 tabindex=0，其餘 -1", () => {
      renderChart({ buckets: buckets(31) });
      const stops = columns().filter((c) => c.getAttribute("tabindex") === "0");
      expect(stops).toHaveLength(1);
      expect(stops[0]).toBe(columns()[0]);
      expect(columns().filter((c) => c.getAttribute("tabindex") === "-1")).toHaveLength(30);
    });

    it("Tab 進入一次、再 Tab 就離開圖表（不會逐格走 31 次）", async () => {
      const user = userEvent.setup({ delay: null });
      render(
        <>
          <button>前</button>
          <TrendBarChart buckets={buckets(31)} max={12} ariaLabel="x" />
          <button>後</button>
        </>,
      );
      await user.tab();
      await user.tab();
      expect(columns()[0]).toHaveFocus();
      await user.tab();
      expect(screen.getByRole("button", { name: "後" })).toHaveFocus();
    });

    it("左右方向鍵移動，tab stop 跟著移動；到邊界停住不繞圈", async () => {
      const user = userEvent.setup({ delay: null });
      renderChart({ buckets: buckets(3) });
      await user.tab();
      await user.keyboard("{ArrowLeft}");
      expect(columns()[0]).toHaveFocus();

      await user.keyboard("{ArrowRight}{ArrowRight}");
      expect(columns()[2]).toHaveFocus();
      expect(columns()[2]).toHaveAttribute("tabindex", "0");
      expect(columns()[0]).toHaveAttribute("tabindex", "-1");

      await user.keyboard("{ArrowRight}");
      expect(columns()[2]).toHaveFocus();
    });

    it("Home／End 跳到首尾", async () => {
      const user = userEvent.setup({ delay: null });
      renderChart({ buckets: buckets(31) });
      await user.tab();
      await user.keyboard("{End}");
      expect(columns()[30]).toHaveFocus();
      await user.keyboard("{Home}");
      expect(columns()[0]).toHaveFocus();
    });

    it("離開後再 Tab 回來，焦點落在上次停留的那一格", async () => {
      const user = userEvent.setup({ delay: null });
      render(
        <>
          <TrendBarChart buckets={buckets(5)} max={12} ariaLabel="x" />
          <button>後</button>
        </>,
      );
      await user.tab();
      await user.keyboard("{ArrowRight}{ArrowRight}");
      await user.tab();
      expect(screen.getByRole("button", { name: "後" })).toHaveFocus();
      await user.tab({ shift: true });
      expect(columns()[2]).toHaveFocus();
    });

    it("帶修飾鍵的方向鍵不處理（留給瀏覽器／輔助技術）", async () => {
      const user = userEvent.setup({ delay: null });
      renderChart({ buckets: buckets(3) });
      await user.tab();
      await user.keyboard("{Alt>}{ArrowRight}{/Alt}");
      expect(columns()[0]).toHaveFocus();
    });

    it("buckets 變少時 tab stop 落在最後一格，仍然只有一個", async () => {
      const user = userEvent.setup({ delay: null });
      const { rerender } = rtlRender(<TrendBarChart buckets={buckets(5)} max={12} ariaLabel="x" />, {
        wrapper: TestThemeWrapper,
      });
      await user.tab();
      await user.keyboard("{End}");
      expect(columns()[4]).toHaveFocus();

      rerender(<TrendBarChart buckets={buckets(2)} max={12} ariaLabel="x" />);
      expect(columns()).toHaveLength(2);
      expect(columns().filter((c) => c.getAttribute("tabindex") === "0")).toEqual([columns()[1]]);
    });
  });

  describe("無障礙", () => {
    it("整張圖 role=group 帶名稱；每格 role=img 帶該格的 aria-label", () => {
      renderChart({ buckets: buckets(3) });
      expect(screen.getByRole("group", { name: "預約量（每日）" })).toBeInTheDocument();
      expect(columns().map((c) => c.getAttribute("aria-label"))).toEqual([
        "10/1，預約 6 筆，完成 4、待完成 2",
        "10/2，預約 6 筆，完成 4、待完成 2",
        "10/3，預約 6 筆，完成 4、待完成 2",
      ]);
    });

    it("隱藏的等價資料表：標題、每格一列，內容與 buckets 一致", () => {
      const list = buckets(4, (i) => ({ ariaLabel: `第 ${i + 1} 日，詳細數字 ${i * 10}` }));
      renderChart({ buckets: list });
      const table = screen.getByRole("table", { name: "預約量（每日）" });
      const rows = within(table).getAllByRole("row").slice(1);
      expect(rows).toHaveLength(list.length);
      rows.forEach((row, i) => {
        expect(within(row).getByRole("rowheader")).toHaveTextContent(list[i].label);
        expect(within(row).getByRole("cell")).toHaveTextContent(list[i].ariaLabel);
      });
    });

    it("資料表是視覺上隱藏（不佔版面），但仍在無障礙樹中", () => {
      renderChart();
      const table = screen.getByRole("table");
      expect(table).toHaveStyle({ position: "absolute", width: "1px", height: "1px", overflow: "hidden" });
    });

    it("斜紋與實心靠不同圖樣區分，不只靠顏色", () => {
      const { container } = renderChart({ buckets: [bucket(0)] });
      const solid = container.querySelector<HTMLElement>("[data-kind='solid']")!;
      const striped = container.querySelector<HTMLElement>("[data-kind='striped']")!;
      expect(getComputedStyle(striped).backgroundImage).toContain("repeating-linear-gradient");
      expect(getComputedStyle(solid).backgroundImage).not.toContain("repeating-linear-gradient");
    });
  });

  describe("buckets 為空", () => {
    it("顯示 emptyLabel（預設「沒有資料」），沒有任何欄位或資料表", () => {
      renderChart({ buckets: [], emptyLabel: "此期間沒有預約" });
      expect(screen.getByText("此期間沒有預約")).toBeInTheDocument();
      expect(screen.queryAllByRole("img")).toHaveLength(0);
      expect(screen.queryByRole("table")).toBeNull();
      expect(screen.getByRole("group", { name: "預約量（每日）" })).toBeInTheDocument();
    });

    it("沒給 emptyLabel 時用預設文字", () => {
      renderChart({ buckets: [] });
      expect(screen.getByText("沒有資料")).toBeInTheDocument();
    });
  });
});
