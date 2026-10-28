// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import { renderWithTheme as render } from "../test-utils";
import { ServiceRankingTable } from "@/app/admin/_components/ServiceRankingTable";
import type { RankingRow } from "@/lib/admin/reports-ranking";

// 總預約量 110：占比 36／25／21／9／5／5（與 mockup 變體 C 相同）。
const ROWS: RankingRow[] = [
  { serviceId: "s1", name: "剪髮", isActive: true, count: 40, revenue: 20400 },
  { serviceId: "s2", name: "洗剪吹", isActive: true, count: 27, revenue: 17600 },
  { serviceId: "s3", name: "韓系剪髮", isActive: true, count: 23, revenue: 17100 },
  { serviceId: "s4", name: "漸層染髮", isActive: true, count: 10, revenue: 30200 },
  { serviceId: "s5", name: "燙髮", isActive: true, count: 5, revenue: 14000 },
  { serviceId: "s6", name: "護髮", isActive: false, count: 5, revenue: 6000 },
];

const table = () => screen.getByRole("table", { name: "熱門服務排行" });
const bodyRows = () => Array.from(table().querySelectorAll<HTMLElement>("tbody tr"));
const cellTexts = (row: HTMLElement) => Array.from(row.children).map((c) => c.textContent);

describe("ServiceRankingTable", () => {
  afterEach(() => cleanup());

  it("五個欄位：名次、服務、預約量、占比（表頭說明條長為相對最高）、營收", () => {
    render(<ServiceRankingTable rows={ROWS} />);
    expect(within(table()).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "名次",
      "服務",
      "預約量",
      "占比（條長為相對最高）",
      "營收",
    ]);
  });

  it("依傳入順序渲染，數字與占比正確", () => {
    render(<ServiceRankingTable rows={ROWS} />);
    expect(bodyRows().map(cellTexts)).toEqual([
      ["1", "剪髮", "40 筆", "36%", "NT$20,400"],
      ["2", "洗剪吹", "27 筆", "25%", "NT$17,600"],
      ["3", "韓系剪髮", "23 筆", "21%", "NT$17,100"],
      ["4", "漸層染髮", "10 筆", "9%", "NT$30,200"],
      ["5", "燙髮", "5 筆", "5%", "NT$14,000"],
      ["6", "護髮已下架", "5 筆", "5%", "NT$6,000"],
    ]);
  });

  it("占比顯示四捨五入：三等分各 33%（不要求加總為 100%）", () => {
    const rows: RankingRow[] = ["a", "b", "c"].map((id) => ({ serviceId: id, name: id, isActive: true, count: 1, revenue: 0 }));
    render(<ServiceRankingTable rows={rows} />);
    expect(bodyRows().map((r) => cellTexts(r)[3])).toEqual(["33%", "33%", "33%"]);
  });

  it("已下架標籤只出現在已下架的服務", () => {
    render(<ServiceRankingTable rows={ROWS} />);
    expect(screen.getAllByText("已下架")).toHaveLength(1);
    expect(within(bodyRows()[5]).getByText("已下架")).toBeInTheDocument();
  });

  it("占比條長度＝預約量 ÷ 最大預約量", () => {
    render(<ServiceRankingTable rows={ROWS} />);
    const fills = screen.getAllByTestId("ranking-bar-fill");
    expect(fills[0]).toHaveStyle({ width: "100%" });
    expect(fills[1]).toHaveStyle({ width: "67.5%" });
    expect(fills[4]).toHaveStyle({ width: "12.5%" });
  });

  it("服務名稱是列標頭（th scope=row）", () => {
    render(<ServiceRankingTable rows={ROWS} />);
    expect(within(table()).getByRole("rowheader", { name: "剪髮" })).toBeInTheDocument();
  });

  it("窄視窗內部橫向捲動：表格有最小寬度、容器可捲動", () => {
    render(<ServiceRankingTable rows={ROWS} />);
    expect(table()).toHaveStyle({ minWidth: "480px" });
    expect(table().parentElement).toHaveStyle({ overflowX: "auto" });
  });

  it("空資料：顯示「此期間沒有被預約的服務」，不渲染表格", () => {
    render(<ServiceRankingTable rows={[]} />);
    expect(screen.getByText("此期間沒有被預約的服務")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("純文字：名稱含 <script> 與 =SUM(1) 原樣顯示，不產生元素", () => {
    const { container } = render(
      <ServiceRankingTable
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
