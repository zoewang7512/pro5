import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  countActiveServicesByDesigner,
  findAffectedAppointmentsForDesignerLeave,
  getDesignerFilterOptions,
  getDesignerLeavesInRange,
  isShopClosedDate,
  listDesignerLeaves,
  listDesigners,
} from "@/lib/admin/designers";
import type { BusinessHoursRow } from "@/lib/admin/business-hours";

describe("countActiveServicesByDesigner", () => {
  it("只計入上架中服務，下架中服務的列不算", () => {
    const counts = countActiveServicesByDesigner(
      [
        { designer_id: "d1", service_id: "s1" },
        { designer_id: "d1", service_id: "s2" },
        { designer_id: "d1", service_id: "s-off" },
        { designer_id: "d2", service_id: "s1" },
      ],
      new Set(["s1", "s2"]),
    );
    expect(counts.get("d1")).toBe(2);
    expect(counts.get("d2")).toBe(1);
  });

  it("沒有任何列的設計師不在 map 裡", () => {
    expect(countActiveServicesByDesigner([], new Set(["s1"])).get("d1")).toBeUndefined();
  });
});

type QueryResult = { data: unknown; error: unknown };

type Call = { table: string; method: "select" | "order" | "eq" | "in" | "gte" | "lte" | "lt" | "limit"; args: unknown[] };

// 每個 from(table) 回傳一條可 await 的鏈（select／order／eq 都回傳自己），依表名給對應結果，並
// 記錄每次呼叫的參數，讓測試能斷言排序與過濾條件，而不是只驗證「回傳什麼」。
function fakeClient(results: Record<string, QueryResult>) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const chain = {
        select: (...args: unknown[]) => (calls.push({ table, method: "select", args }), chain),
        order: (...args: unknown[]) => (calls.push({ table, method: "order", args }), chain),
        eq: (...args: unknown[]) => (calls.push({ table, method: "eq", args }), chain),
        in: (...args: unknown[]) => (calls.push({ table, method: "in", args }), chain),
        gte: (...args: unknown[]) => (calls.push({ table, method: "gte", args }), chain),
        lt: (...args: unknown[]) => (calls.push({ table, method: "lt", args }), chain),
        lte: (...args: unknown[]) => (calls.push({ table, method: "lte", args }), chain),
        limit: (...args: unknown[]) => (calls.push({ table, method: "limit", args }), chain),
        then: (resolve: (value: QueryResult) => unknown) => resolve(results[table]),
      };
      return chain;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const DESIGNER_ROW = {
  id: "d1",
  name: "預設設計師",
  bio: null,
  specialties: [],
  instagram_handle: null,
  avatar_url: null,
  is_active: true,
  sort_order: 0,
};

const EMPTY: Record<string, QueryResult> = {
  designers: { data: [], error: null },
  designer_services: { data: [], error: null },
  services: { data: [], error: null },
};

describe("listDesigners", () => {
  it("合併設計師、服務開關與上架中服務總數", async () => {
    const { client } = fakeClient({
      designers: {
        data: [DESIGNER_ROW, { ...DESIGNER_ROW, id: "d2", name: "B", is_active: false, sort_order: 1 }],
        error: null,
      },
      designer_services: {
        data: [
          { designer_id: "d1", service_id: "s1" },
          { designer_id: "d1", service_id: "s2" },
          { designer_id: "d1", service_id: "s-off" },
        ],
        error: null,
      },
      services: { data: [{ id: "s1" }, { id: "s2" }, { id: "s3" }], error: null },
    });
    const result = await listDesigners(client);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.totalServices).toBe(3);
    expect(result.data.designers.map((d) => [d.id, d.service_count, d.is_active])).toEqual([
      ["d1", 2, true],
      ["d2", 0, false],
    ]);
  });

  it("設計師依 sort_order 再依 created_at 由小到大排序；服務只查上架中的", async () => {
    const { client, calls } = fakeClient(EMPTY);
    await listDesigners(client);

    const designerOrders = calls.filter((c) => c.table === "designers" && c.method === "order");
    expect(designerOrders.map((c) => c.args)).toEqual([
      ["sort_order", { ascending: true }],
      ["created_at", { ascending: true }],
    ]);
    expect(calls.filter((c) => c.table === "services" && c.method === "eq").map((c) => c.args)).toEqual([
      ["is_active", true],
    ]);
    // 後台列表不過濾設計師的 is_active：停用中的設計師也要看得到。
    expect(calls.some((c) => c.table === "designers" && c.method === "eq")).toBe(false);
  });

  it("designers 查詢列出明確欄位，不用 *", async () => {
    const { client, calls } = fakeClient(EMPTY);
    await listDesigners(client);

    const select = calls.find((c) => c.table === "designers" && c.method === "select");
    expect(select?.args[0]).toBe("id, name, bio, specialties, instagram_handle, avatar_url, is_active, sort_order");
  });

  it.each(["designers", "designer_services", "services"])(
    "%s 查詢失敗時回傳通用錯誤，不外洩原始錯誤訊息",
    async (failingTable) => {
      const { client } = fakeClient({
        ...EMPTY,
        [failingTable]: { data: null, error: { message: `relation "public.${failingTable}" does not exist` } },
      });
      const result = await listDesigners(client);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toBe("發生未預期的錯誤，請稍後再試。");
      expect(result.error.message).not.toContain(failingTable);
    },
  );

  it("沒有任何設計師時回傳空陣列", async () => {
    const { client } = fakeClient(EMPTY);
    expect(await listDesigners(client)).toEqual({ ok: true, data: { designers: [], totalServices: 0 } });
  });
});

const GENERIC = { ok: false, error: { message: "發生未預期的錯誤，請稍後再試。" } };
const DESIGNER_ID = "3f2b8c1e-9d4a-4e6f-8a7b-1c2d3e4f5a6b";

describe("listDesignerLeaves", () => {
  it("只查這位設計師，日期由小到大，回傳日期字串（含過去）", async () => {
    const { client, calls } = fakeClient({
      designer_leaves: { data: [{ date: "2026-01-02" }, { date: "2026-12-31" }], error: null },
    });
    expect(await listDesignerLeaves(client, DESIGNER_ID)).toEqual({ ok: true, data: ["2026-01-02", "2026-12-31"] });
    expect(calls.find((c) => c.method === "select")?.args[0]).toBe("date");
    expect(calls.find((c) => c.method === "eq")?.args).toEqual(["designer_id", DESIGNER_ID]);
    expect(calls.find((c) => c.method === "order")?.args).toEqual(["date", { ascending: true }]);
  });

  it("id 格式錯誤時不送請求", async () => {
    const { client, calls } = fakeClient({});
    expect(await listDesignerLeaves(client, "new")).toEqual(GENERIC);
    expect(calls).toHaveLength(0);
  });

  it("查詢失敗回傳通用錯誤，不外洩原始錯誤訊息", async () => {
    const { client } = fakeClient({ designer_leaves: { data: null, error: { message: "relation boom" } } });
    expect(await listDesignerLeaves(client, DESIGNER_ID)).toEqual(GENERIC);
  });
});

describe("findAffectedAppointmentsForDesignerLeave", () => {
  const ROW = { id: "a1", customer_name: "王小姐", start_at: "2026-10-30T03:00:00+00:00", services: { name: "韓系剪髮" } };

  it("過濾條件：該設計師、pending／confirmed、台北時間整天 [00:00, 次日 00:00)、依時間排序、有筆數上限", async () => {
    const { client, calls } = fakeClient({ appointments: { data: [ROW], error: null } });
    await findAffectedAppointmentsForDesignerLeave(client, DESIGNER_ID, "2026-10-30");

    expect(calls.find((c) => c.method === "eq")?.args).toEqual(["designer_id", DESIGNER_ID]);
    expect(calls.find((c) => c.method === "in")?.args).toEqual(["status", ["pending", "confirmed"]]);
    expect(calls.find((c) => c.method === "gte")?.args).toEqual(["start_at", "2026-10-30T00:00:00+08:00"]);
    expect(calls.find((c) => c.method === "lt")?.args).toEqual(["start_at", "2026-10-31T00:00:00+08:00"]);
    expect(calls.find((c) => c.method === "order")?.args).toEqual(["start_at", { ascending: true }]);
    expect(calls.find((c) => c.method === "limit")?.args).toEqual([200]);
  });

  it("次日換月、換年也正確", async () => {
    const { client, calls } = fakeClient({ appointments: { data: [], error: null } });
    await findAffectedAppointmentsForDesignerLeave(client, DESIGNER_ID, "2026-12-31");
    expect(calls.find((c) => c.method === "lt")?.args).toEqual(["start_at", "2027-01-01T00:00:00+08:00"]);
  });

  it("select 只列最小欄位：不用 *，不含電話、email、access_token", async () => {
    const { client, calls } = fakeClient({ appointments: { data: [], error: null } });
    await findAffectedAppointmentsForDesignerLeave(client, DESIGNER_ID, "2026-10-30");
    const columns = calls.find((c) => c.method === "select")?.args[0];
    expect(columns).toBe("id, customer_name, start_at, services(name)");
  });

  it("攤平服務名稱：embed 為物件、單元素陣列、null 三種形狀", async () => {
    const { client } = fakeClient({
      appointments: {
        data: [ROW, { ...ROW, id: "a2", services: [{ name: "洗剪吹" }] }, { ...ROW, id: "a3", services: null }],
        error: null,
      },
    });
    const result = await findAffectedAppointmentsForDesignerLeave(client, DESIGNER_ID, "2026-10-30");
    expect(result).toEqual({
      ok: true,
      data: [
        { id: "a1", customer_name: "王小姐", start_at: ROW.start_at, service_name: "韓系剪髮" },
        { id: "a2", customer_name: "王小姐", start_at: ROW.start_at, service_name: "洗剪吹" },
        { id: "a3", customer_name: "王小姐", start_at: ROW.start_at, service_name: "" },
      ],
    });
  });

  it.each(["new", ""])("designerId %j 不送請求", async (id) => {
    const { client, calls } = fakeClient({});
    expect(await findAffectedAppointmentsForDesignerLeave(client, id, "2026-10-30")).toEqual(GENERIC);
    expect(calls).toHaveLength(0);
  });

  it.each(["2099-02-30", "today", "infinity", "2099-2-1", "2026-10-30T00:00", ""])(
    "日期 %j 在送出請求前就被擋下",
    async (date) => {
      const { client, calls } = fakeClient({});
      expect(await findAffectedAppointmentsForDesignerLeave(client, DESIGNER_ID, date)).toEqual(GENERIC);
      expect(calls).toHaveLength(0);
    },
  );

  it("查詢失敗回傳通用錯誤，不外洩原始錯誤訊息", async () => {
    const { client } = fakeClient({ appointments: { data: null, error: { message: "permission denied for table appointments" } } });
    expect(await findAffectedAppointmentsForDesignerLeave(client, DESIGNER_ID, "2026-10-30")).toEqual(GENERIC);
  });
});

describe("isShopClosedDate", () => {
  const open = (weekday: number): BusinessHoursRow => ({ weekday, open_time: "10:00:00", close_time: "19:00:00", is_closed: false });
  // 2026-10-26 是週一（weekday 1）、2026-10-25 是週日（0）。
  const hours = [{ weekday: 0, open_time: null, close_time: null, is_closed: true }, ...[1, 2, 3, 4, 5, 6].map(open)];

  it("每週固定公休的日子", () => {
    expect(isShopClosedDate("2026-10-25", hours, new Set())).toBe(true);
    expect(isShopClosedDate("2026-10-26", hours, new Set())).toBe(false);
  });

  it("is_closed 單獨成立：即使有開關店時間，標記公休就是公休", () => {
    const flagged = [{ ...open(1), is_closed: true }, ...hours.filter((row) => row.weekday !== 1)];
    expect(isShopClosedDate("2026-10-26", flagged, new Set())).toBe(true);
  });

  it("closed_dates 內的日期（疊加，不互相覆蓋）", () => {
    expect(isShopClosedDate("2026-10-26", hours, new Set(["2026-10-26"]))).toBe(true);
  });

  it("查不到該週幾的營業時間列，或缺開／關店時間，都算公休（對齊 RPC）", () => {
    expect(isShopClosedDate("2026-10-26", hours.filter((row) => row.weekday !== 1), new Set())).toBe(true);
    expect(isShopClosedDate("2026-10-26", [{ ...open(1), open_time: null }, ...hours.filter((r) => r.weekday !== 1)], new Set())).toBe(true);
    expect(isShopClosedDate("2026-10-26", [{ ...open(1), close_time: null }, ...hours.filter((r) => r.weekday !== 1)], new Set())).toBe(true);
  });
});

describe("getDesignerFilterOptions", () => {
  const ROWS = [
    { id: "d1", name: "林小美", avatar_url: null, is_active: true, sort_order: 0 },
    { id: "d2", name: "陳阿傑", avatar_url: "https://x/y.webp", is_active: false, sort_order: 1 },
  ];

  it("不過濾 is_active（停用中的也要能被篩選），只選最小欄位，依 sort_order、created_at 排序", async () => {
    const { client, calls } = fakeClient({ designers: { data: ROWS, error: null } });
    expect(await getDesignerFilterOptions(client)).toEqual({ ok: true, data: ROWS });

    expect(calls.find((c) => c.method === "select")?.args[0]).toBe("id, name, avatar_url, is_active, sort_order");
    expect(calls.some((c) => c.method === "eq")).toBe(false);
    expect(calls.filter((c) => c.method === "order").map((c) => c.args[0])).toEqual(["sort_order", "created_at"]);
  });

  it("查詢失敗回傳通用錯誤，不外洩原始錯誤訊息", async () => {
    const { client } = fakeClient({ designers: { data: null, error: { message: "relation boom" } } });
    expect(await getDesignerFilterOptions(client)).toEqual(GENERIC);
  });
});

describe("getDesignerLeavesInRange", () => {
  it("依日期範圍讀全部設計師的請假日（兩端含），只選 designer_id、date，日期由小到大", async () => {
    const rows = [{ designer_id: "d1", date: "2026-10-23" }];
    const { client, calls } = fakeClient({ designer_leaves: { data: rows, error: null } });
    expect(await getDesignerLeavesInRange(client, "2026-10-19", "2026-10-25")).toEqual({ ok: true, data: rows });

    expect(calls.find((c) => c.method === "select")?.args[0]).toBe("designer_id, date");
    expect(calls.find((c) => c.method === "gte")?.args).toEqual(["date", "2026-10-19"]);
    expect(calls.find((c) => c.method === "lte")?.args).toEqual(["date", "2026-10-25"]);
    expect(calls.find((c) => c.method === "order")?.args).toEqual(["date", { ascending: true }]);
    expect(calls.some((c) => c.method === "in")).toBe(false);
  });

  it.each([
    ["today", "2026-10-25"],
    ["2026-10-19", "infinity"],
    ["2099-02-30", "2099-03-01"],
  ])("日期 %s／%s 不合法時不送請求", async (start, end) => {
    const { client, calls } = fakeClient({});
    expect(await getDesignerLeavesInRange(client, start, end)).toEqual(GENERIC);
    expect(calls).toHaveLength(0);
  });

  it("查詢失敗回傳通用錯誤", async () => {
    const { client } = fakeClient({ designer_leaves: { data: null, error: { message: "boom" } } });
    expect(await getDesignerLeavesInRange(client, "2026-10-19", "2026-10-25")).toEqual(GENERIC);
  });
});
