import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DesignerFilterOption } from "@/lib/admin/designers";
import { buildDesignerChips, countActiveAppointments } from "@/lib/admin/designer-filter";
import {
  buildTrend,
  fetchReportAppointments,
  filterByDesigners,
  getReportPeriod,
  shiftReportPeriod,
  summarize,
  toReportAppointmentLike,
  type ReportAppointment,
} from "@/lib/admin/reports";

// 本檔的時間案例都用明確的 UTC／+08:00 時刻，結果必須與執行環境時區無關：
// 以 `TZ=UTC`、`TZ=America/Los_Angeles`、`TZ=Asia/Taipei` 各跑一次都要通過。

const LIN = "00000000-0000-4000-8000-000000000001";
const CHEN = "00000000-0000-4000-8000-000000000002";
const SERVICE_A = "10000000-0000-4000-8000-000000000001";

let seq = 0;
function appt(overrides: Partial<ReportAppointment> = {}): ReportAppointment {
  seq += 1;
  return {
    id: `a${seq}`,
    startAt: "2026-10-21T03:00:00+00:00",
    status: "confirmed",
    price: 100,
    serviceId: SERVICE_A,
    serviceName: "剪髮",
    serviceIsActive: true,
    designerId: LIN,
    ...overrides,
  };
}

describe("getReportPeriod", () => {
  it("日：單一日期，標籤含星期", () => {
    expect(getReportPeriod("day", "2026-10-24", "2026-10-24")).toEqual({
      granularity: "day",
      from: "2026-10-24",
      to: "2026-10-24",
      label: "10/24（六）",
      isCurrent: true,
    });
  });

  it("週：週一～週日，錨點在週日也歸入同一週", () => {
    const period = getReportPeriod("week", "2026-10-25", "2026-10-01");
    expect([period.from, period.to, period.label]).toEqual(["2026-10-19", "2026-10-25", "10/19（一） – 10/25（日）"]);
    expect(period.isCurrent).toBe(false);
  });

  it("週跨月、跨年", () => {
    const crossMonth = getReportPeriod("week", "2026-10-01", "2026-10-01");
    expect([crossMonth.from, crossMonth.to]).toEqual(["2026-09-28", "2026-10-04"]);
    const crossYear = getReportPeriod("week", "2026-01-01", "2026-01-01");
    expect([crossYear.from, crossYear.to]).toEqual(["2025-12-29", "2026-01-04"]);
  });

  it("月：該曆月首尾，含閏年二月與 31 日月份", () => {
    const oct = getReportPeriod("month", "2026-10-24", "2026-10-24");
    expect([oct.from, oct.to, oct.label]).toEqual(["2026-10-01", "2026-10-31", "2026 年 10 月"]);
    expect(getReportPeriod("month", "2028-02-10", "2028-02-10").to).toBe("2028-02-29");
    expect(getReportPeriod("month", "2026-02-10", "2026-02-10").to).toBe("2026-02-28");
  });

  it("isCurrent：今天落在期間頭尾（含）才為 true", () => {
    expect(getReportPeriod("month", "2026-10-01", "2026-10-31").isCurrent).toBe(true);
    expect(getReportPeriod("month", "2026-10-01", "2026-11-01").isCurrent).toBe(false);
    expect(getReportPeriod("month", "2026-10-01", "2026-09-30").isCurrent).toBe(false);
    expect(getReportPeriod("week", "2026-10-19", "2026-10-25").isCurrent).toBe(true);
  });

  it("沒給 today 時以台北今天判斷", () => {
    vi.useFakeTimers();
    try {
      // 2026-10-24 17:00 UTC＝台北 10/25 01:00。
      vi.setSystemTime(new Date("2026-10-24T17:00:00Z"));
      expect(getReportPeriod("day", "2026-10-25").isCurrent).toBe(true);
      expect(getReportPeriod("day", "2026-10-24").isCurrent).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("shiftReportPeriod", () => {
  const TODAY = "2026-10-24";

  it("日：前後一天，跨月、跨年", () => {
    const day = getReportPeriod("day", "2026-12-31", TODAY);
    expect(shiftReportPeriod(day, 1, TODAY).from).toBe("2027-01-01");
    expect(shiftReportPeriod(getReportPeriod("day", "2026-03-01", TODAY), -1, TODAY).from).toBe("2026-02-28");
  });

  it("週：前後七天，仍為週一～週日", () => {
    const week = getReportPeriod("week", "2026-10-24", TODAY);
    const next = shiftReportPeriod(week, 1, TODAY);
    expect([next.from, next.to, next.isCurrent]).toEqual(["2026-10-26", "2026-11-01", false]);
    const prev = shiftReportPeriod(week, -1, TODAY);
    expect([prev.from, prev.to]).toEqual(["2026-10-12", "2026-10-18"]);
  });

  it("月：前後一個月，跨年與月長不同", () => {
    const dec = getReportPeriod("month", "2026-12-15", TODAY);
    const jan = shiftReportPeriod(dec, 1, TODAY);
    expect([jan.from, jan.to, jan.label]).toEqual(["2027-01-01", "2027-01-31", "2027 年 1 月"]);
    const feb = shiftReportPeriod(jan, 1, TODAY);
    expect([feb.from, feb.to]).toEqual(["2027-02-01", "2027-02-28"]);
    const backToDec = shiftReportPeriod(jan, -1, TODAY);
    expect([backToDec.from, backToDec.to]).toEqual(["2026-12-01", "2026-12-31"]);
  });

  it("往前再往後回到同一期間；isCurrent 依 today 重算", () => {
    const month = getReportPeriod("month", TODAY, TODAY);
    expect(month.isCurrent).toBe(true);
    const there = shiftReportPeriod(month, -1, TODAY);
    expect(there.isCurrent).toBe(false);
    expect(shiftReportPeriod(there, 1, TODAY)).toEqual(month);
  });
});

describe("summarize", () => {
  it("空陣列全為 0", () => {
    expect(summarize([])).toEqual({ booked: 0, completed: 0, pending: 0, cancelled: 0, revenue: 0, estimated: 0 });
  });

  it("各狀態口徑：預約量＝待處理＋已確認＋已完成；營收只算已完成；預估只算待完成", () => {
    const totals = summarize([
      appt({ status: "pending", price: 100 }),
      appt({ status: "confirmed", price: 200 }),
      appt({ status: "completed", price: 300 }),
      appt({ status: "completed", price: 400 }),
      appt({ status: "cancelled", price: 500 }),
    ]);
    expect(totals).toEqual({ booked: 4, completed: 2, pending: 2, cancelled: 1, revenue: 700, estimated: 300 });
  });

  it("全部已取消：預約量 0、已取消 N、營收與預估為 0", () => {
    const totals = summarize([appt({ status: "cancelled" }), appt({ status: "cancelled" }), appt({ status: "cancelled" })]);
    expect(totals).toMatchObject({ booked: 0, cancelled: 3, completed: 0, pending: 0, revenue: 0, estimated: 0 });
  });

  it("金額以兩位小數收斂浮點誤差", () => {
    const totals = summarize([
      appt({ status: "completed", price: 0.1 }),
      appt({ status: "completed", price: 0.2 }),
      appt({ status: "pending", price: 1.1 }),
      appt({ status: "pending", price: 2.2 }),
    ]);
    expect(totals.revenue).toBe(0.3);
    expect(totals.estimated).toBe(3.3);
  });
});

describe("buildTrend", () => {
  const OCT = getReportPeriod("month", "2026-10-15", "2026-10-15");

  it("月：每個日期一格、依序、沒資料補 0", () => {
    const trend = buildTrend(OCT, [appt({ startAt: "2026-10-02T02:00:00Z", status: "completed", price: 500 })]);
    expect(trend).toHaveLength(31);
    expect(trend[0]).toMatchObject({ key: "2026-10-01", label: "10/1（四）", booked: 0, revenue: 0 });
    expect(trend[1]).toMatchObject({ key: "2026-10-02", label: "10/2（五）", booked: 1, completed: 1, revenue: 500 });
    expect(trend[30].key).toBe("2026-10-31");
  });

  it("週：七格；趨勢加總等於期間彙總", () => {
    const week = getReportPeriod("week", "2026-10-21", "2026-10-21");
    const list = [
      appt({ startAt: "2026-10-19T02:00:00Z", status: "completed", price: 100 }),
      appt({ startAt: "2026-10-21T06:00:00Z", status: "pending", price: 200 }),
      appt({ startAt: "2026-10-25T06:00:00Z", status: "cancelled", price: 300 }),
    ];
    const trend = buildTrend(week, list);
    expect(trend.map((b) => b.key)).toEqual([
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
    ]);
    expect(trend.reduce((sum, b) => sum + b.booked, 0)).toBe(summarize(list).booked);
    expect(trend.reduce((sum, b) => sum + b.revenue, 0)).toBe(summarize(list).revenue);
  });

  it("日期歸屬依台北時間：23:30 屬當天、00:30 屬隔天", () => {
    const trend = buildTrend(OCT, [
      appt({ id: "late", startAt: "2026-10-10T23:30:00+08:00" }), // UTC 15:30，同一個 UTC 日
      appt({ id: "early", startAt: "2026-10-11T00:30:00+08:00" }), // UTC 10/10 16:30，UTC 日與台北日不同
      appt({ id: "morning", startAt: "2026-10-12T07:59:00+08:00" }), // UTC 10/11 23:59
    ]);
    const bookedOn = (date: string) => trend.find((b) => b.key === date)!.booked;
    expect(bookedOn("2026-10-10")).toBe(1);
    expect(bookedOn("2026-10-11")).toBe(1);
    expect(bookedOn("2026-10-12")).toBe(1);
  });

  it("期間以外的預約不計入", () => {
    const trend = buildTrend(OCT, [
      appt({ startAt: "2026-09-30T23:59:00+08:00" }),
      appt({ startAt: "2026-11-01T00:00:00+08:00" }),
    ]);
    expect(trend.reduce((sum, b) => sum + b.booked, 0)).toBe(0);
  });

  describe("日粒度", () => {
    const DAY = getReportPeriod("day", "2026-10-24", "2026-10-24");

    it("無預約：10:00–19:00 共 10 格，全為 0", () => {
      const trend = buildTrend(DAY, []);
      expect(trend.map((b) => b.label)).toEqual([
        "10:00",
        "11:00",
        "12:00",
        "13:00",
        "14:00",
        "15:00",
        "16:00",
        "17:00",
        "18:00",
        "19:00",
      ]);
      expect(trend.every((b) => b.booked === 0 && b.revenue === 0)).toBe(true);
    });

    it("同一小時的預約歸同一格（依台北時間）", () => {
      const trend = buildTrend(DAY, [
        appt({ startAt: "2026-10-24T10:00:00+08:00", status: "completed", price: 800 }),
        appt({ startAt: "2026-10-24T10:45:00+08:00", status: "pending", price: 600 }),
        appt({ startAt: "2026-10-24T19:59:00+08:00" }),
      ]);
      expect(trend[0]).toMatchObject({ key: "10:00", booked: 2, completed: 1, pending: 1, revenue: 800, estimated: 600 });
      expect(trend[9]).toMatchObject({ key: "19:00", booked: 1 });
    });

    it("早於 10 點或晚於 19 點的預約會擴張範圍（含已取消），不會被丟掉", () => {
      const early = buildTrend(DAY, [appt({ startAt: "2026-10-24T08:30:00+08:00" })]);
      expect([early[0].key, early[early.length - 1].key, early.length]).toEqual(["08:00", "19:00", 12]);
      expect(early[0].booked).toBe(1);

      const late = buildTrend(DAY, [appt({ startAt: "2026-10-24T21:00:00+08:00", status: "cancelled" })]);
      expect([late[0].key, late[late.length - 1].key, late.length]).toEqual(["10:00", "21:00", 12]);
      expect(late[11]).toMatchObject({ cancelled: 1, booked: 0 });
    });

    it("台北 00:30 的預約：小時為 0 而不是 24，且屬於當天", () => {
      const trend = buildTrend(DAY, [appt({ startAt: "2026-10-24T00:30:00+08:00" })]);
      expect(trend[0]).toMatchObject({ key: "00:00", booked: 1 });
      expect(trend).toHaveLength(20);
    });

    it("不是當天的預約不計入，也不擴張範圍", () => {
      const trend = buildTrend(DAY, [appt({ startAt: "2026-10-25T06:00:00+08:00" })]);
      expect(trend).toHaveLength(10);
      expect(trend.every((b) => b.booked === 0)).toBe(true);
    });
  });
});

describe("filterByDesigners", () => {
  const list = [appt({ designerId: LIN }), appt({ designerId: CHEN }), appt({ designerId: LIN })];

  it("空＝全部（回傳原陣列）", () => {
    expect(filterByDesigners(list, [])).toBe(list);
  });

  it("只留被選取的設計師，可多選", () => {
    expect(filterByDesigners(list, [CHEN])).toHaveLength(1);
    expect(filterByDesigners(list, [LIN, CHEN])).toHaveLength(3);
    expect(filterByDesigners(list, ["00000000-0000-4000-8000-0000000000ff"])).toHaveLength(0);
  });
});

describe("toReportAppointmentLike（餵給設計師 chip）", () => {
  const options: DesignerFilterOption[] = [
    { id: LIN, name: "林小美", avatar_url: null, is_active: true, sort_order: 0 },
    { id: CHEN, name: "陳阿傑", avatar_url: null, is_active: true, sort_order: 1 },
  ];

  it("chip 的數字＝期間內預約量，不含已取消", () => {
    const list = [
      appt({ designerId: LIN, status: "completed" }),
      appt({ designerId: LIN, status: "cancelled" }),
      appt({ designerId: CHEN, status: "pending" }),
    ];
    const like = list.map(toReportAppointmentLike);
    expect(buildDesignerChips(options, like).map((chip) => [chip.id, chip.count])).toEqual([
      [LIN, 1],
      [CHEN, 1],
    ]);
    expect(countActiveAppointments(like)).toBe(2);
  });
});

// ---- fetchReportAppointments ----

// count 沒給時，預設為 data 的列數（單頁測試的便利預設）；分頁與筆數驗證的測試一律明確指定。
type QueryResult = { data: unknown; error: unknown; count?: unknown };
type Call = { method: string; args: unknown[] };

// 每次 from() 開一條新的查詢鏈；range() 依起始列取回應，並附上 count（supabase-js 在 select 帶 count 時回傳）。
function fakeClient(respond: (rangeFrom: number) => QueryResult | Promise<QueryResult>) {
  const calls: Call[] = [];
  const from = vi.fn(() => {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "gte", "lt", "order"]) {
      chain[method] = (...args: unknown[]) => (calls.push({ method, args }), chain);
    }
    chain.range = (...args: unknown[]) => {
      calls.push({ method: "range", args });
      return Promise.resolve(respond(args[0] as number)).then((result) => ({
        ...result,
        count: "count" in result ? result.count : Array.isArray(result.data) ? result.data.length : null,
      }));
    };
    return chain;
  });
  return { client: { from } as unknown as SupabaseClient, calls, from };
}

function row(i: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `row-${i}`,
    start_at: "2026-10-21T03:00:00+00:00",
    status: "completed",
    price_at_booking: 100,
    service_id: SERVICE_A,
    designer_id: LIN,
    services: { name: "剪髮", is_active: true },
    ...overrides,
  };
}

function rows(count: number, offset = 0) {
  return Array.from({ length: count }, (_, i) => row(offset + i));
}

const OCT = { from: "2026-10-01", to: "2026-10-31" };
const GENERIC = "發生未預期的錯誤，請稍後再試。";

describe("fetchReportAppointments", () => {
  it("明確列欄位：不用 *、不含任何顧客欄位或 access_token", async () => {
    const { client, calls } = fakeClient(() => ({ data: [], error: null }));
    await fetchReportAppointments(client, OCT);
    const columns = String(calls.find((c) => c.method === "select")?.args[0]);
    expect(columns).toBe("id, start_at, status, price_at_booking, service_id, designer_id, services(name, is_active)");
    expect(columns).not.toContain("*");
    expect(columns).not.toMatch(/customer_|access_token/);
  });

  it("範圍為 [from 00:00+08:00, to 隔天 00:00+08:00)，穩定排序（start_at, id）", async () => {
    const { client, calls } = fakeClient(() => ({ data: [], error: null }));
    await fetchReportAppointments(client, OCT);
    expect(calls.find((c) => c.method === "gte")?.args).toEqual(["start_at", "2026-10-01T00:00:00+08:00"]);
    expect(calls.find((c) => c.method === "lt")?.args).toEqual(["start_at", "2026-11-01T00:00:00+08:00"]);
    expect(calls.filter((c) => c.method === "order").map((c) => c.args[0])).toEqual(["start_at", "id"]);
  });

  it("單日期間：結束界線是隔天 00:00+08:00", async () => {
    const { client, calls } = fakeClient(() => ({ data: [], error: null }));
    await fetchReportAppointments(client, { from: "2026-12-31", to: "2026-12-31" });
    expect(calls.find((c) => c.method === "gte")?.args[1]).toBe("2026-12-31T00:00:00+08:00");
    expect(calls.find((c) => c.method === "lt")?.args[1]).toBe("2027-01-01T00:00:00+08:00");
  });

  it("轉成 ReportAppointment：price 轉 number、embed 為物件／陣列／缺漏都能處理", async () => {
    const { client } = fakeClient(() => ({
      data: [
        row(1, { price_at_booking: "105.50" }),
        row(2, { services: [{ name: "染髮", is_active: false }] }),
        row(3, { services: null }),
      ],
      error: null,
    }));
    const result = await fetchReportAppointments(client, OCT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data[0]).toEqual({
      id: "row-1",
      startAt: "2026-10-21T03:00:00+00:00",
      status: "completed",
      price: 105.5,
      serviceId: SERVICE_A,
      serviceName: "剪髮",
      serviceIsActive: true,
      designerId: LIN,
    });
    expect(result.data[1]).toMatchObject({ serviceName: "染髮", serviceIsActive: false });
    expect(result.data[2]).toMatchObject({ serviceName: "—", serviceIsActive: true });
  });

  it("price_at_booking 為 null、空字串、非數字、無限大：回錯誤，不靜默當 0", async () => {
    for (const bad of [null, undefined, "", "abc", Number.NaN, Number.POSITIVE_INFINITY]) {
      const { client } = fakeClient(() => ({ data: [row(1), row(2, { price_at_booking: bad })], error: null }));
      const result = await fetchReportAppointments(client, OCT);
      expect(result).toEqual({ ok: false, error: { message: GENERIC } });
    }
  });

  it("未知的狀態值：回錯誤，不靜默丟掉那筆", async () => {
    const { client } = fakeClient(() => ({ data: [row(1, { status: "archived" })], error: null }));
    expect(await fetchReportAppointments(client, OCT)).toEqual({ ok: false, error: { message: GENERIC } });
  });

  it("第一頁帶 count: exact，之後的頁不再要 count", async () => {
    const { client, calls } = fakeClient((rangeFrom) => ({ data: rangeFrom === 0 ? rows(1000) : rows(1, 1000), error: null, count: 1001 }));
    await fetchReportAppointments(client, OCT);
    const selects = calls.filter((c) => c.method === "select").map((c) => c.args[1]);
    expect(selects).toEqual([{ count: "exact" }, undefined]);
  });

  it("分頁：依總筆數決定頁數（2003 筆＝3 頁），列數與總筆數一致", async () => {
    const { client, calls } = fakeClient((rangeFrom) => ({
      data: rangeFrom === 0 ? rows(1000) : rangeFrom === 1000 ? rows(1000, 1000) : rows(3, 2000),
      error: null,
      count: 2003,
    }));
    const result = await fetchReportAppointments(client, OCT);
    expect(result.ok && result.data).toHaveLength(2003);
    expect(calls.filter((c) => c.method === "range").map((c) => c.args)).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("剛好 1000 列：一頁就結束，不多送請求", async () => {
    const { client, from } = fakeClient(() => ({ data: rows(1000), error: null, count: 1000 }));
    const result = await fetchReportAppointments(client, OCT);
    expect(result.ok && result.data).toHaveLength(1000);
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("剛好 5000 列：成功（上限內），取 5 頁", async () => {
    const { client, from } = fakeClient((rangeFrom) => ({ data: rows(1000, rangeFrom), error: null, count: 5000 }));
    const result = await fetchReportAppointments(client, OCT);
    expect(result.ok && result.data).toHaveLength(5000);
    expect(from).toHaveBeenCalledTimes(5);
  });

  it("超過 5000 列：回可辨識的 too_many_rows，不回傳任何部分資料，也不再取後面的頁", async () => {
    const { client, from } = fakeClient(() => ({ data: rows(1000), error: null, count: 5001 }));
    const result = await fetchReportAppointments(client, OCT);
    expect(result).toEqual({ ok: false, error: { message: expect.any(String), code: "too_many_rows" } });
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("單頁回的列數少於總筆數（PostgREST Max rows 被調小）：回一般錯誤，不靜默少算", async () => {
    // 總共 600 筆，但伺服器每次最多只回 500 列：只會取到 500 列，必須失敗。
    const { client } = fakeClient(() => ({ data: rows(500), error: null, count: 600 }));
    const result = await fetchReportAppointments(client, OCT);
    expect(result).toEqual({ ok: false, error: { message: GENERIC } });
  });

  it("取回的列數多於總筆數（翻頁期間資料變動）：回一般錯誤", async () => {
    const { client } = fakeClient(() => ({ data: rows(1000), error: null, count: 900 }));
    expect(await fetchReportAppointments(client, OCT)).toEqual({ ok: false, error: { message: GENERIC } });
  });

  it("沒有 count 或 count 不合法：回一般錯誤", async () => {
    for (const bad of [null, undefined, -1, 1.5, "3", Number.NaN]) {
      const { client } = fakeClient(() => ({ data: rows(3), error: null, count: bad }));
      expect(await fetchReportAppointments(client, OCT)).toEqual({ ok: false, error: { message: GENERIC } });
    }
  });

  it("任一頁失敗：回泛用錯誤，不洩漏資料庫內容、不回傳前面已取得的部分資料", async () => {
    const { client } = fakeClient((rangeFrom) =>
      rangeFrom === 0
        ? { data: rows(1000), error: null, count: 2000 }
        : { data: null, error: { message: 'permission denied for column "customer_email"', code: "42501" } },
    );
    const result = await fetchReportAppointments(client, OCT);
    expect(result).toEqual({ ok: false, error: { message: GENERIC } });
    expect(JSON.stringify(result)).not.toMatch(/customer_email|42501|permission/);
  });

  it("查詢拋出例外（網路中斷）：回泛用錯誤", async () => {
    const { client } = fakeClient(() => {
      throw new Error("fetch failed: connect ECONNREFUSED 10.0.0.1");
    });
    const result = await fetchReportAppointments(client, OCT);
    expect(result).toEqual({ ok: false, error: { message: GENERIC } });
  });

  it("期間日期不合法：不送出查詢，直接回錯誤", async () => {
    for (const period of [
      { from: "2026-02-30", to: "2026-03-01" },
      { from: "2026-10-01", to: "2026-10-31T00:00:00Z" },
      { from: "x", to: "y" },
      { from: "2026-10-31", to: "2026-10-01" },
    ]) {
      const { client, from } = fakeClient(() => ({ data: [], error: null }));
      expect(await fetchReportAppointments(client, period)).toEqual({ ok: false, error: { message: GENERIC } });
      expect(from).not.toHaveBeenCalled();
    }
  });

  it("空結果：ok 且為空陣列", async () => {
    const { client } = fakeClient(() => ({ data: [], error: null }));
    expect(await fetchReportAppointments(client, OCT)).toEqual({ ok: true, data: [] });
  });
});
