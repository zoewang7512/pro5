import { describe, expect, it } from "vitest";
import type { ReportAppointment } from "@/lib/admin/reports";
import { buildServiceRanking, rankingBarPercent, rankingShare, type RankingRow } from "@/lib/admin/reports-ranking";

let seq = 0;
function appt(
  serviceId: string,
  status: ReportAppointment["status"],
  price: number,
  overrides: Partial<ReportAppointment> = {},
): ReportAppointment {
  seq += 1;
  return {
    id: `a${seq}`,
    startAt: "2026-10-10T10:00:00+08:00",
    status,
    price,
    serviceId,
    serviceName: `服務-${serviceId}`,
    serviceIsActive: true,
    designerId: "des-1",
    ...overrides,
  };
}

describe("buildServiceRanking", () => {
  it("取消的預約不計入預約量與營收", () => {
    const rows = buildServiceRanking([
      appt("s1", "completed", 500),
      appt("s1", "cancelled", 500),
      appt("s1", "cancelled", 500),
    ]);
    expect(rows).toEqual([{ serviceId: "s1", name: "服務-s1", isActive: true, count: 1, revenue: 500 }]);
  });

  it("全部取消或沒有預約：回空陣列（預約量 0 不列）", () => {
    expect(buildServiceRanking([])).toEqual([]);
    expect(buildServiceRanking([appt("s1", "cancelled", 500), appt("s2", "cancelled", 800)])).toEqual([]);
  });

  it("只有被取消的服務不列，其餘服務照常排名", () => {
    const rows = buildServiceRanking([appt("s1", "cancelled", 500), appt("s2", "pending", 800)]);
    expect(rows.map((r) => r.serviceId)).toEqual(["s2"]);
  });

  it("預約量降序", () => {
    const rows = buildServiceRanking([
      appt("a", "completed", 100),
      appt("b", "completed", 100),
      appt("b", "completed", 100),
      appt("c", "pending", 100),
      appt("c", "confirmed", 100),
      appt("c", "completed", 100),
    ]);
    expect(rows.map((r) => [r.serviceId, r.count])).toEqual([
      ["c", 3],
      ["b", 2],
      ["a", 1],
    ]);
  });

  it("營收只計已完成；待處理／已確認有預約量但無營收", () => {
    const [row] = buildServiceRanking([
      appt("s1", "completed", 1000),
      appt("s1", "pending", 700),
      appt("s1", "confirmed", 700),
    ]);
    expect(row.count).toBe(3);
    expect(row.revenue).toBe(1000);
  });

  it("同預約量：營收高者在前", () => {
    const rows = buildServiceRanking([appt("low", "completed", 100), appt("high", "completed", 900)]);
    expect(rows.map((r) => r.serviceId)).toEqual(["high", "low"]);
  });

  it("同預約量同營收：依名稱（zh-Hant）排序", () => {
    const rows = buildServiceRanking([
      appt("z", "completed", 100, { serviceName: "燙髮" }),
      appt("y", "completed", 100, { serviceName: "剪髮" }),
      appt("x", "completed", 100, { serviceName: "染髮" }),
    ]);
    const expected = ["燙髮", "剪髮", "染髮"].sort((a, b) => a.localeCompare(b, "zh-Hant"));
    expect(rows.map((r) => r.name)).toEqual(expected);
  });

  it("同量同營收同名稱：依 serviceId 保底，與輸入順序無關", () => {
    const make = (id: string) => appt(id, "completed", 100, { serviceName: "剪髮" });
    const forward = buildServiceRanking([make("b"), make("a"), make("c")]).map((r) => r.serviceId);
    const backward = buildServiceRanking([make("c"), make("a"), make("b")]).map((r) => r.serviceId);
    expect(forward).toEqual(["a", "b", "c"]);
    expect(backward).toEqual(["a", "b", "c"]);
  });

  it("已下架：serviceIsActive false → isActive false", () => {
    const rows = buildServiceRanking([
      appt("on", "completed", 100),
      appt("off", "completed", 100, { serviceIsActive: false }),
    ]);
    expect(rows.find((r) => r.serviceId === "off")?.isActive).toBe(false);
    expect(rows.find((r) => r.serviceId === "on")?.isActive).toBe(true);
  });

  it("價格取快照：同服務不同快照價（改價）各自計入", () => {
    const [row] = buildServiceRanking([
      appt("dye", "completed", 3000),
      appt("dye", "completed", 3000),
      appt("dye", "completed", 3200),
    ]);
    expect(row.revenue).toBe(9200);
  });

  it("單項服務", () => {
    expect(buildServiceRanking([appt("only", "completed", 250)])).toEqual([
      { serviceId: "only", name: "服務-only", isActive: true, count: 1, revenue: 250 },
    ]);
  });

  it("不設上限：25 個服務全部列出", () => {
    const appts = Array.from({ length: 25 }, (_, i) => appt(`s${i}`, "completed", 100));
    expect(buildServiceRanking(appts)).toHaveLength(25);
  });

  it("浮點加總收斂：0.1 ×3 → 0.3", () => {
    const [row] = buildServiceRanking([
      appt("s1", "completed", 0.1),
      appt("s1", "completed", 0.1),
      appt("s1", "completed", 0.1),
    ]);
    expect(row.revenue).toBe(0.3);
  });

  it("不修改輸入陣列", () => {
    const input = [appt("b", "completed", 100), appt("a", "completed", 100), appt("a", "completed", 100)];
    const snapshot = input.map((a) => a.id);
    buildServiceRanking(input);
    expect(input.map((a) => a.id)).toEqual(snapshot);
  });
});

const rows = (counts: number[]): RankingRow[] =>
  counts.map((count, i) => ({ serviceId: `s${i}`, name: `S${i}`, isActive: true, count, revenue: 0 }));

describe("rankingShare", () => {
  it("占比＝預約量 ÷ 排行內預約量總和，四捨五入", () => {
    const r = rows([40, 27, 23, 10, 5, 5]); // 110
    expect(r.map((row) => rankingShare(row.count, r))).toEqual([36, 25, 21, 9, 5, 5]);
  });

  it("三等分：各 33%（不要求加總為 100%）", () => {
    const r = rows([1, 1, 1]);
    expect(r.map((row) => rankingShare(row.count, r))).toEqual([33, 33, 33]);
  });

  it("單項服務 100%；空排行 0", () => {
    expect(rankingShare(7, rows([7]))).toBe(100);
    expect(rankingShare(0, [])).toBe(0);
  });
});

describe("rankingBarPercent", () => {
  it("最大者 100%，其餘依比例", () => {
    const r = rows([40, 20, 10]);
    expect(r.map((row) => rankingBarPercent(row.count, r))).toEqual([100, 50, 25]);
  });

  it("極小比例仍有最小可見寬度", () => {
    const r = rows([1000, 1]);
    expect(rankingBarPercent(1, r)).toBe(2);
  });

  it("空排行或 0 → 0", () => {
    expect(rankingBarPercent(5, [])).toBe(0);
    expect(rankingBarPercent(0, rows([5]))).toBe(0);
  });
});
