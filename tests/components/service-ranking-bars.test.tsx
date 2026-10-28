// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import { renderWithTheme as render } from "../test-utils";
import { ServiceRankingBars } from "@/app/admin/_components/ServiceRankingBars";
import type { RankingRow } from "@/lib/admin/reports-ranking";

const ROWS: RankingRow[] = [
  { serviceId: "s1", name: "剪髮", isActive: true, count: 40, revenue: 20400 },
  { serviceId: "s2", name: "洗剪吹", isActive: true, count: 20, revenue: 17600 },
  { serviceId: "s3", name: "護髮", isActive: false, count: 5, revenue: 6000 },
];

const items = () => within(screen.getByRole("list", { name: "熱門服務排行" })).getAllByRole("listitem");

describe("ServiceRankingBars", () => {
  afterEach(() => cleanup());

  it("依傳入順序渲染名次、服務、預約量、營收", () => {
    render(<ServiceRankingBars rows={ROWS} />);
    const [first, second, third] = items();
    expect(first).toHaveTextContent("1剪髮40 筆NT$20,400");
    expect(second).toHaveTextContent("2洗剪吹20 筆NT$17,600");
    expect(third).toHaveTextContent("3護髮已下架5 筆NT$6,000");
  });

  it("已下架標籤只出現在已下架的服務", () => {
    render(<ServiceRankingBars rows={ROWS} />);
    expect(screen.getAllByText("已下架")).toHaveLength(1);
    expect(within(items()[2]).getByText("已下架")).toBeInTheDocument();
    expect(within(items()[0]).queryByText("已下架")).not.toBeInTheDocument();
  });

  it("橫條長度＝預約量 ÷ 最大預約量", () => {
    render(<ServiceRankingBars rows={ROWS} />);
    const fills = screen.getAllByTestId("ranking-bar-fill");
    expect(fills[0]).toHaveStyle({ width: "100%" });
    expect(fills[1]).toHaveStyle({ width: "50%" });
    expect(fills[2]).toHaveStyle({ width: "12.5%" });
  });

  it("預約量極小仍有最小可見寬度", () => {
    render(
      <ServiceRankingBars
        rows={[
          { serviceId: "a", name: "A", isActive: true, count: 1000, revenue: 0 },
          { serviceId: "b", name: "B", isActive: true, count: 1, revenue: 0 },
        ]}
      />,
    );
    expect(screen.getAllByTestId("ranking-bar-fill")[1]).toHaveStyle({ width: "2%" });
  });

  it("橫條純裝飾：不進無障礙樹", () => {
    render(<ServiceRankingBars rows={ROWS} />);
    for (const fill of screen.getAllByTestId("ranking-bar-fill")) {
      expect(fill.parentElement).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("窄寬度不破版：服務欄可換行、數字不換行", () => {
    render(<ServiceRankingBars rows={ROWS} />);
    expect(screen.getByText("剪髮").closest("span")).toHaveStyle({ overflowWrap: "anywhere" });
    expect(screen.getByText("40 筆")).toHaveStyle({ whiteSpace: "nowrap" });
    expect(screen.getByText("NT$20,400")).toHaveStyle({ whiteSpace: "nowrap" });
  });

  it("空資料：顯示「此期間沒有被預約的服務」，不渲染清單", () => {
    render(<ServiceRankingBars rows={[]} />);
    expect(screen.getByText("此期間沒有被預約的服務")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("純文字：名稱含 <script> 與 =SUM(1) 原樣顯示，不產生元素", () => {
    const { container } = render(
      <ServiceRankingBars
        rows={[
          { serviceId: "x", name: "<script>alert(1)</script>", isActive: true, count: 2, revenue: 0 },
          { serviceId: "y", name: "=SUM(1)", isActive: true, count: 1, revenue: 0 },
        ]}
      />,
    );
    expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument();
    expect(screen.getByText("=SUM(1)")).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
  });
});
