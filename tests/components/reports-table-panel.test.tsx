// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithTheme as render } from "../test-utils";
import { ReportsTablePanel } from "@/app/admin/_components/ReportsTablePanel";
import { readyProps, reportAppointment, sampleAppointments } from "../helpers/reports-fixture";

const RANKING = <div data-testid="ranking-slot">排行內容</div>;

function renderReady(granularity: "day" | "week" | "month" = "month", appointments = sampleAppointments()) {
  return render(<ReportsTablePanel {...readyProps(granularity, appointments, RANKING)} />);
}

const detailTable = (name = "逐日明細") => screen.getByRole("table", { name });
// 直接用 DOM 選取列：對 31 列逐列做 role 查詢很慢，在全套並行負載下會逼近逾時。
const bodyRows = (table: HTMLElement) => Array.from(table.querySelectorAll<HTMLElement>("tbody tr"));
const footerRowOf = (table: HTMLElement) => table.querySelector<HTMLElement>("tfoot tr")!;
// 第一欄是 <th scope="row">（rowheader），其餘是 cell；一律用 children 取整列。
const cellTexts = (row: HTMLElement) => Array.from(row.children).map((c) => c.textContent);

describe("ReportsTablePanel 預設（月）", () => {
  afterEach(() => cleanup());

  it("彙總列：六個數字，標籤點明範圍（營收＝已完成、預估＝待完成）", () => {
    renderReady();
    const summary = screen.getByTestId("summary-row");
    const pairs = [
      ["預約量", "8 筆"],
      ["已完成", "5 筆"],
      ["待完成", "3 筆"],
      ["已取消", "1 筆"],
      ["營收（已完成）", "NT$10,100"],
      ["預估營收（待完成）", "NT$4,400"],
    ];
    for (const [label, value] of pairs) {
      const labelEl = within(summary).getByText(label);
      expect(labelEl.nextElementSibling).toHaveTextContent(value);
    }
    // 窄視窗自動換行：欄數隨寬度變，不需要橫向捲動。
    expect(summary).toHaveStyle({ display: "grid" });
  });

  it("層次：彙總數字比標籤大、比標籤重", () => {
    renderReady();
    const label = screen.getByText("營收（已完成）");
    const value = label.nextElementSibling as HTMLElement;
    expect(parseFloat(getComputedStyle(value).fontSize)).toBeGreaterThan(parseFloat(getComputedStyle(label).fontSize));
    expect(getComputedStyle(value).fontWeight).toBe("700");
  });

  it("排行區：標題、占比說明、ranking 插槽", () => {
    renderReady();
    expect(screen.getByRole("heading", { name: "熱門服務排行" })).toBeInTheDocument();
    expect(screen.getByText("占比＝該服務預約量 ÷ 全部預約量")).toBeInTheDocument();
    expect(screen.getByTestId("ranking-slot")).toBeInTheDocument();
  });

  it("逐日明細：標題、七個欄位、每日一列（31 列）並補零", () => {
    renderReady();
    expect(screen.getByRole("heading", { name: "逐日明細" })).toBeInTheDocument();
    const table = detailTable();
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "日期",
      "預約量",
      "已完成",
      "待完成",
      "已取消",
      "營收",
      "預估營收",
    ]);
    expect(bodyRows(table)).toHaveLength(31);
  });

  it("數字格式：有值顯示筆數／NT$，零值顯示「—」", () => {
    renderReady();
    const rows = bodyRows(detailTable());
    // 10/1：完成 1、營收 3000。
    expect(cellTexts(rows[0])).toEqual(["10/1（四）", "1", "1", "—", "—", "NT$3,000", "—"]);
    // 10/2：什麼都沒有。
    expect(cellTexts(rows[1])).toEqual(["10/2（五）", "—", "—", "—", "—", "—", "—"]);
    // 10/12：只有取消 1（預約量 0 → 「—」）。
    expect(cellTexts(rows[11])).toEqual(["10/12（一）", "—", "—", "—", "1", "—", "—"]);
  });

  it("今天列：底色標示＋「今天」標籤，且只有一列", () => {
    renderReady();
    const rows = bodyRows(detailTable());
    const todayRows = rows.filter((row) => row.getAttribute("data-today") === "true");
    expect(todayRows).toHaveLength(1);
    expect(todayRows[0]).toBe(rows[23]);
    expect(within(todayRows[0]).getByText("今天")).toBeInTheDocument();
    expect(screen.getAllByText("今天")).toHaveLength(1);
    expect(cellTexts(todayRows[0])).toEqual(["10/24（六）今天", "2", "1", "1", "—", "NT$1,500", "NT$2,000"]);
    // 底色來自主色淡化（不是寫死 hex）。
    expect(getComputedStyle(within(todayRows[0]).getAllByRole("cell")[1]).backgroundColor).toContain("color-mix");
  });

  it("合計列：直接顯示彙總結果（與上方彙總列同一份數字），固定在表格底部", () => {
    renderReady();
    const table = detailTable();
    const footerRow = footerRowOf(table);
    expect(within(footerRow).getByRole("rowheader")).toHaveTextContent("合計");
    expect(cellTexts(footerRow)).toEqual(["合計", "8", "5", "3", "1", "NT$10,100", "NT$4,400"]);
    for (const cell of [within(footerRow).getByRole("rowheader"), ...within(footerRow).getAllByRole("cell")]) {
      // 字重／字級的優先權覆寫 jsdom 的 getComputedStyle 算不準（不處理 specificity），改在瀏覽器截圖驗證。
      expect(cell).toHaveStyle({ position: "sticky", bottom: "0px" });
    }
  });

  it("表頭固定、內容區可捲動（最高 440px）", () => {
    renderReady();
    const table = detailTable();
    expect(table.closest(".MuiTableContainer-root")).toHaveStyle({ maxHeight: "440px" });
    for (const header of within(table).getAllByRole("columnheader")) {
      expect(header).toHaveClass("MuiTableCell-stickyHeader");
    }
  });

  it("數字欄靠右、等寬數字（tabular-nums）", () => {
    renderReady();
    const row = bodyRows(detailTable())[0];
    const numeric = within(row).getAllByRole("cell")[5];
    expect(numeric).toHaveStyle({ textAlign: "right", fontVariantNumeric: "tabular-nums" });
  });
});

describe("ReportsTablePanel 其他粒度", () => {
  afterEach(() => cleanup());

  it("週：七列，今天（週六）標示", () => {
    renderReady("week");
    const rows = bodyRows(detailTable());
    expect(rows).toHaveLength(7);
    expect(within(rows[5]).getByText("今天")).toBeInTheDocument();
    expect(cellTexts(rows[0])[0]).toBe("10/19（一）");
  });

  it("日：標題改為逐小時明細、第一欄「時段」、10:00–19:00 共 10 列，沒有「今天」標籤", () => {
    renderReady("day");
    expect(screen.getByRole("heading", { name: "逐小時明細" })).toBeInTheDocument();
    const table = detailTable("逐小時明細");
    expect(within(table).getAllByRole("columnheader")[0]).toHaveTextContent("時段");
    const rows = bodyRows(table);
    expect(rows).toHaveLength(10);
    expect(cellTexts(rows[0])[0]).toBe("10:00");
    expect(screen.queryByText("今天")).toBeNull();
    // 11:00 完成 1、營收 1500；合計是當日彙總。
    expect(cellTexts(rows[1])).toEqual(["11:00", "1", "1", "—", "—", "NT$1,500", "—"]);
    const footerRow = footerRowOf(table);
    expect(cellTexts(footerRow)).toEqual(["合計", "2", "1", "1", "—", "NT$1,500", "NT$2,000"]);
  });

  it("日：預約早於 10 點或晚於 19 點時多出對應的列", () => {
    renderReady("day", [reportAppointment("2026-10-24T08:30:00+08:00", "completed", 900)]);
    const rows = bodyRows(detailTable("逐小時明細"));
    expect(rows).toHaveLength(12);
    expect(cellTexts(rows[0])[0]).toBe("08:00");
  });
});

describe("ReportsTablePanel 狀態", () => {
  afterEach(() => cleanup());

  it("載入中：骨架（aria-busy、有名稱），沒有表格與數字", () => {
    render(<ReportsTablePanel status="loading" />);
    expect(screen.getByRole("status", { name: "載入中" })).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText(/NT\$/)).toBeNull();
  });

  it("空：兩種文案", () => {
    render(<ReportsTablePanel status="empty" filtered={false} />);
    expect(screen.getByText("此期間沒有預約")).toBeInTheDocument();
    cleanup();
    render(<ReportsTablePanel status="empty" filtered />);
    expect(screen.getByText("所選設計師在此期間沒有預約")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("錯誤：泛用文案＋重試，不顯示部分數字", async () => {
    const user = userEvent.setup({ delay: null });
    const onRetry = vi.fn();
    render(<ReportsTablePanel status="error" onRetry={onRetry} />);
    expect(screen.getByText("無法載入報表，請稍後再試。")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    await user.click(screen.getByRole("button", { name: "重試" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("全部已取消：視為有資料，彙總列與明細表都在，排行區顯示「此期間沒有被預約的服務」", () => {
    const cancelled = [
      reportAppointment("2026-10-03T10:00:00+08:00", "cancelled", 1000),
      reportAppointment("2026-10-04T10:00:00+08:00", "cancelled", 1000),
    ];
    render(<ReportsTablePanel {...readyProps("month", cancelled, RANKING)} />);

    expect(screen.queryByText("此期間沒有預約")).toBeNull();
    const summary = screen.getByTestId("summary-row");
    expect(within(summary).getByText("預約量").nextElementSibling).toHaveTextContent("0 筆");
    expect(within(summary).getByText("已取消").nextElementSibling).toHaveTextContent("2 筆");
    expect(bodyRows(detailTable())).toHaveLength(31);
    const footerRow = footerRowOf(detailTable());
    expect(cellTexts(footerRow)).toEqual(["合計", "—", "—", "—", "2", "—", "—"]);
    expect(screen.getByText("此期間沒有被預約的服務")).toBeInTheDocument();
    expect(screen.queryByTestId("ranking-slot")).toBeNull();
  });

  it("一律純文字：怪異字元不會被當成標籤（畫面只有彙總數字，沒有使用者可控字串進表格）", () => {
    const { container } = renderReady();
    expect(container.querySelector("script, img")).toBeNull();
  });
});
