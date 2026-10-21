import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { countActiveServicesByDesigner, listDesigners } from "@/lib/admin/designers";

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

type Call = { table: string; method: "select" | "order" | "eq"; args: unknown[] };

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
