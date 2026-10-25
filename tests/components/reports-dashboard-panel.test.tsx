// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithTheme as render } from "../test-utils";
import {
  ReportsDashboardPanel,
  buildChartBuckets,
  formatMoneyTick,
  niceMax,
} from "@/app/admin/_components/ReportsDashboardPanel";
import { getReportPeriod } from "@/lib/admin/reports";
import { REPORT_TODAY, readyProps, reportAppointment, sampleAppointments } from "../helpers/reports-fixture";

const RANKING = <div data-testid="ranking-slot">排行內容</div>;

function renderReady(granularity: "day" | "week" | "month" = "month", appointments = sampleAppointments()) {
  return render(<ReportsDashboardPanel {...readyProps(granularity, appointments, RANKING)} />);
}

const countChart = () => screen.getByRole("group", { name: /^預約量/ });
const moneyChart = () => screen.getByRole("group", { name: /^營收（/ });
const columnsOf = (chart: HTMLElement) => within(chart).getAllByRole("img");

describe("ReportsDashboardPanel 預設（月）", () => {
  afterEach(() => cleanup());

  it("營收是主角：36px 主數字（NT$ 千分位）＋「營收（已完成 N 筆）」", () => {
    renderReady();
    expect(screen.getByText("營收（已完成 5 筆）")).toBeInTheDocument();
    const main = screen.getByTestId("revenue-main");
    expect(main).toHaveTextContent("NT$10,100");
    expect(main).toHaveStyle({ fontSize: "36px", fontWeight: "700" });
  });

  it("次要數字與副標：預約量／預估營收／已取消", () => {
    renderReady();
    expect(screen.getByText("預約量")).toBeInTheDocument();
    expect(screen.getByText("8 筆")).toBeInTheDocument();
    expect(screen.getByText("完成 5 ・ 待完成 3")).toBeInTheDocument();
    expect(screen.getByText("預估營收")).toBeInTheDocument();
    expect(screen.getByText("NT$4,400")).toBeInTheDocument();
    expect(screen.getByText("待完成，未計入營收")).toBeInTheDocument();
    expect(screen.getByText("已取消")).toBeInTheDocument();
    expect(screen.getByText("1 筆")).toBeInTheDocument();
    expect(screen.getByText("不計入預約量")).toBeInTheDocument();
  });

  it("層次：營收主數字 ＞ 次要數字 ＞ 副標（字級由大到小）", () => {
    renderReady();
    const sizeOf = (el: HTMLElement) => parseFloat(getComputedStyle(el).fontSize);
    expect(sizeOf(screen.getByTestId("revenue-main"))).toBeGreaterThan(sizeOf(screen.getByText("8 筆")));
    expect(sizeOf(screen.getByText("8 筆"))).toBeGreaterThan(sizeOf(screen.getByText("完成 5 ・ 待完成 3")));
  });

  it("兩張圖：預約量（每日）與營收（每日），月視圖各 31 格，並排容器可換行（窄視窗上下堆疊）", () => {
    renderReady();
    expect(countChart()).toHaveAccessibleName("預約量（每日），2026 年 10 月");
    expect(moneyChart()).toHaveAccessibleName("營收（每日），2026 年 10 月");
    expect(columnsOf(countChart())).toHaveLength(31);
    expect(columnsOf(moneyChart())).toHaveLength(31);

    const row = screen.getByTestId("chart-row");
    expect(row).toHaveStyle({ display: "flex", flexWrap: "wrap" });
    // 每張圖至少 320px 寬，不夠並排就換行。
    expect(row.children).toHaveLength(2);
    for (const panel of Array.from(row.children)) expect(panel).toHaveStyle({ flex: "1 1 320px" });
  });

  it("圖例：預約量圖＝已完成／待完成；營收圖＝營收（已完成）／預估（待完成）", () => {
    renderReady();
    expect(within(countChart()).getByText("已完成")).toBeInTheDocument();
    expect(within(countChart()).getByText("待完成")).toBeInTheDocument();
    expect(within(moneyChart()).getByText("營收（已完成）")).toBeInTheDocument();
    expect(within(moneyChart()).getByText("預估（待完成）")).toBeInTheDocument();
  });

  it("每格的無障礙名稱＝日期、預約量（完成／待完成）、營收、預估營收；兩張圖一致", () => {
    renderReady();
    const expected = "10/24（六），預約量 2 筆（完成 1 ・ 待完成 1），營收 NT$1,500，預估營收 NT$2,000";
    expect(columnsOf(countChart())[23]).toHaveAccessibleName(expected);
    expect(columnsOf(moneyChart())[23]).toHaveAccessibleName(expected);
    // 沒有預約的日子也完整（補零，不省略）。
    expect(columnsOf(countChart())[1]).toHaveAccessibleName("10/2（五），預約量 0 筆（完成 0 ・ 待完成 0），營收 NT$0，預估營收 NT$0");
  });

  it("hover 長條顯示 tooltip：日期、預約量、營收、預估營收", async () => {
    const user = userEvent.setup({ delay: null });
    renderReady();
    await user.hover(columnsOf(countChart())[23]);
    const tip = within(countChart()).getByRole("tooltip", { hidden: true });
    expect(within(tip).getByText("10/24（六）")).toBeInTheDocument();
    expect(within(tip).getByText("預約量 2 筆（完成 1 ・ 待完成 1）")).toBeInTheDocument();
    expect(within(tip).getByText("營收 NT$1,500")).toBeInTheDocument();
    expect(within(tip).getByText("預估營收 NT$2,000")).toBeInTheDocument();
  });

  it("長條高度：已完成實心、待完成斜紋；預約量圖與營收圖用各自的數值", () => {
    renderReady();
    // 10/24：完成 1、待完成 1（預約量圖 max 4）；營收 1500、預估 2000（營收圖 max 4000）。
    const segments = (chart: HTMLElement) =>
      Array.from(columnsOf(chart)[23].querySelectorAll<HTMLElement>("[data-kind]")).map((el) => [el.dataset.kind, parseFloat(el.style.height)]);
    expect(segments(countChart())).toEqual([
      ["solid", 45],
      ["striped", 45],
    ]);
    expect(segments(moneyChart())).toEqual([
      ["solid", 67.5],
      ["striped", 90],
    ]);
  });

  it("y 軸刻度：預約量圖 4／2／0；營收圖 4k／2k／0", () => {
    renderReady();
    for (const tick of ["4", "2", "0"]) expect(within(countChart()).getAllByText(tick).length).toBeGreaterThan(0);
    for (const tick of ["4k", "2k", "0"]) expect(within(moneyChart()).getAllByText(tick).length).toBeGreaterThan(0);
  });

  it("月視圖 x 軸：只標 1 與每 5 日；今天（24）一定標示，緊鄰今天的 23、25 不標", () => {
    renderReady();
    const labels = columnsOf(countChart()).map((column) => {
      const label = column.lastElementChild as HTMLElement;
      return { text: label.textContent, visible: getComputedStyle(label).visibility === "visible" };
    });
    const visible = labels.filter((l) => l.visible).map((l) => l.text);
    expect(visible).toEqual(["1", "5", "10", "15", "20", "24", "30"]);
    expect(labels.find((l) => l.text === "25")?.visible).toBe(false);
  });

  it("今天的格：標籤粗體、aria-current=date", () => {
    renderReady();
    const today = columnsOf(countChart())[23];
    expect(today).toHaveAttribute("aria-current", "date");
    expect(today.lastElementChild).toHaveStyle({ fontWeight: "700" });
    expect(columnsOf(countChart()).filter((c) => c.hasAttribute("aria-current"))).toHaveLength(1);
  });

  it("排行：標題「熱門服務排行」，內容來自 ranking 插槽", () => {
    renderReady();
    expect(screen.getByRole("heading", { name: "熱門服務排行" })).toBeInTheDocument();
    expect(screen.getByTestId("ranking-slot")).toBeInTheDocument();
  });

  it("圖表資料只有彙總數字：畫面上沒有任何顧客欄位", () => {
    const { container } = renderReady();
    expect(container.textContent).not.toMatch(/customer|電話|email|access_token/i);
  });
});

describe("ReportsDashboardPanel 其他粒度", () => {
  afterEach(() => cleanup());

  it("週：標題（每日）、7 格，x 軸標籤「一 10/19」格式、今天（六）標示", () => {
    renderReady("week");
    expect(countChart()).toHaveAccessibleName("預約量（每日），10/19（一） – 10/25（日）");
    const columns = columnsOf(countChart());
    expect(columns).toHaveLength(7);
    expect(columns.map((c) => c.lastElementChild?.textContent)).toEqual([
      "一 10/19",
      "二 10/20",
      "三 10/21",
      "四 10/22",
      "五 10/23",
      "六 10/24",
      "日 10/25",
    ]);
    expect(columns.every((c) => getComputedStyle(c.lastElementChild as HTMLElement).visibility === "visible")).toBe(true);
    expect(columns[5]).toHaveAttribute("aria-current", "date");
  });

  it("日：標題（每小時）、10:00–19:00 共 10 格、沒有「今天」標示", () => {
    renderReady("day");
    expect(countChart()).toHaveAccessibleName("預約量（每小時），10/24（六）");
    const columns = columnsOf(countChart());
    expect(columns).toHaveLength(10);
    expect(columns[0].lastElementChild).toHaveTextContent("10:00");
    expect(columns[9].lastElementChild).toHaveTextContent("19:00");
    expect(columns.some((c) => c.hasAttribute("aria-current"))).toBe(false);
    // 11:00 的預約（完成 1）落在 11:00 格。
    expect(columns[1]).toHaveAccessibleName("11:00，預約量 1 筆（完成 1 ・ 待完成 0），營收 NT$1,500，預估營收 NT$0");
  });

  it("日：預約晚於 19 點時圖表範圍擴張", () => {
    renderReady("day", [reportAppointment("2026-10-24T21:00:00+08:00", "pending", 800)]);
    expect(columnsOf(countChart())).toHaveLength(12);
  });
});

describe("ReportsDashboardPanel 狀態", () => {
  afterEach(() => cleanup());

  it("載入中：骨架（aria-busy、有名稱），不顯示任何數字或圖表", () => {
    render(<ReportsDashboardPanel status="loading" />);
    expect(screen.getByRole("status", { name: "載入中" })).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText(/NT\$/)).toBeNull();
    expect(screen.queryAllByRole("group")).toHaveLength(0);
  });

  it("空（全部設計師）：「此期間沒有預約」", () => {
    render(<ReportsDashboardPanel status="empty" filtered={false} />);
    expect(screen.getByText("此期間沒有預約")).toBeInTheDocument();
    expect(screen.getByText("換一個期間看看。")).toBeInTheDocument();
    expect(screen.queryByText(/NT\$/)).toBeNull();
  });

  it("空（所選設計師）：不同文案", () => {
    render(<ReportsDashboardPanel status="empty" filtered />);
    expect(screen.getByText("所選設計師在此期間沒有預約")).toBeInTheDocument();
    expect(screen.getByText("換一個期間，或清除設計師篩選看看。")).toBeInTheDocument();
  });

  it("錯誤：泛用文案＋重試，不顯示部分數字", async () => {
    const user = userEvent.setup({ delay: null });
    const onRetry = vi.fn();
    render(<ReportsDashboardPanel status="error" onRetry={onRetry} />);
    expect(screen.getByText("無法載入報表，請稍後再試。")).toBeInTheDocument();
    expect(screen.queryByText(/NT\$/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "重試" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("全部已取消：視為有資料（摘要與圖表都在），預約量 0、已取消 N，排行區顯示「此期間沒有被預約的服務」", () => {
    const cancelled = [
      reportAppointment("2026-10-03T10:00:00+08:00", "cancelled", 1000),
      reportAppointment("2026-10-04T10:00:00+08:00", "cancelled", 1000),
      reportAppointment("2026-10-05T10:00:00+08:00", "cancelled", 1000),
    ];
    render(<ReportsDashboardPanel {...readyProps("month", cancelled, RANKING)} />);

    expect(screen.queryByText("此期間沒有預約")).toBeNull();
    expect(screen.getByTestId("revenue-main")).toHaveTextContent("NT$0");
    expect(screen.getByText("3 筆")).toBeInTheDocument(); // 已取消
    expect(screen.getByText("0 筆")).toBeInTheDocument(); // 預約量
    expect(columnsOf(countChart())).toHaveLength(31);
    expect(screen.getByText("此期間沒有被預約的服務")).toBeInTheDocument();
    expect(screen.queryByTestId("ranking-slot")).toBeNull();
  });
});

describe("圖表資料轉換", () => {
  const period = getReportPeriod("month", REPORT_TODAY, REPORT_TODAY);

  it("niceMax：取不小於最大值的好看數字，且頂／中／底刻度都是整數", () => {
    expect(niceMax(7, 4)).toBe(8);
    expect(niceMax(8, 4)).toBe(8);
    expect(niceMax(9, 4)).toBe(10);
    expect(niceMax(11, 4)).toBe(12);
    expect(niceMax(13, 4)).toBe(16);
    expect(niceMax(0, 4)).toBe(4);
    expect(niceMax(3500, 1000)).toBe(4000);
    expect(niceMax(105300, 1000)).toBe(120000);
    expect(niceMax(0, 1000)).toBe(1000);
    for (const peak of [1, 3, 7, 21, 99, 1234, 56789]) {
      const max = niceMax(peak, 4);
      expect(max).toBeGreaterThanOrEqual(peak);
      expect(Number.isInteger(max / 2)).toBe(true);
    }
  });

  it("formatMoneyTick：千以上用 k，其餘原樣", () => {
    expect(formatMoneyTick(12000)).toBe("12k");
    expect(formatMoneyTick(1500)).toBe("1.5k");
    expect(formatMoneyTick(500)).toBe("500");
    expect(formatMoneyTick(0)).toBe("0");
  });

  it("buildChartBuckets：key 與趨勢一致，預約量圖用完成／待完成筆數、營收圖用營收／預估", () => {
    const { trend } = readyProps("month");
    const counts = buildChartBuckets(period, trend, REPORT_TODAY, "count");
    const money = buildChartBuckets(period, trend, REPORT_TODAY, "money");
    expect(counts.map((b) => b.key)).toEqual(trend.map((b) => b.key));
    expect(counts[23].segments).toEqual([
      { value: 1, kind: "solid" },
      { value: 1, kind: "striped" },
    ]);
    expect(money[23].segments).toEqual([
      { value: 1500, kind: "solid" },
      { value: 2000, kind: "striped" },
    ]);
    expect(counts[23].today).toBe(true);
    expect(counts.filter((b) => b.today)).toHaveLength(1);
  });

  it("今天不在這段趨勢內（看其他月份）：沒有任何格被標成今天，標籤照每 5 日規則、緊鄰規則不套用", () => {
    const { trend } = readyProps("month");
    const withoutToday = trend.filter((b) => b.key !== REPORT_TODAY);
    const buckets = buildChartBuckets(period, withoutToday, REPORT_TODAY, "count");
    expect(buckets.some((b) => b.today)).toBe(false);
    expect(buckets.filter((b) => b.showLabel).map((b) => b.label)).toEqual(["1", "5", "10", "15", "20", "25", "30"]);
  });
});
