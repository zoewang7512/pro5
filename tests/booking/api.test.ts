import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createAppointment,
  getAvailableSlots,
  getBusinessHours,
  getDesignersForService,
  getServices,
} from "@/lib/booking/api";

// 用最小的假 client 驗證 lib/booking/api.ts 把 Supabase 的兩種錯誤形狀
// （PostgrestError／RPC 自訂 {ok:false, error_code, message}）正確轉成 Result<T>，
// 不外洩底層錯誤細節，且對未知的 error_code 一律歸類 INTERNAL_ERROR。

type Call = [method: string, args: unknown[]];

// 可無限串接的假 query builder：每個方法都記錄呼叫並回傳自己，await 時回傳 result。
function recordingTableClient(result: { data: unknown; error: unknown }) {
  const calls: Call[] = [];
  const builder: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") return (resolve: (value: unknown) => void) => resolve(result);
        return (...args: unknown[]) => {
          calls.push([String(prop), args]);
          return builder;
        };
      },
    },
  );
  const client = {
    from: (table: string) => {
      calls.push(["from", [table]]);
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

function fakeTableClient(result: { data: unknown; error: unknown }): SupabaseClient {
  return recordingTableClient(result).client;
}

function fakeRpcClient(result: { data: unknown; error: unknown }): SupabaseClient {
  return { rpc: () => Promise.resolve(result) } as unknown as SupabaseClient;
}

describe("lib/booking/api", () => {
  it("getServices：PostgrestError 轉成 INTERNAL_ERROR，不外洩底層訊息", async () => {
    const client = fakeTableClient({ data: null, error: { message: "relation does not exist" } });
    const result = await getServices(client);
    expect(result).toEqual({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "發生未預期的錯誤，請稍後再試。" },
    });
  });

  it("getBusinessHours：查無該 weekday 時回傳 data:null，不是錯誤", async () => {
    const client = fakeTableClient({ data: null, error: null });
    const result = await getBusinessHours(client, 0);
    expect(result).toEqual({ ok: true, data: null });
  });

  it("getAvailableSlots：RPC 回傳 ok:true 時原樣透傳 data", async () => {
    const slots = [{ start_at: "2026-08-05T02:00:00+00:00", end_at: "2026-08-05T02:45:00+00:00" }];
    const client = fakeRpcClient({ data: { ok: true, data: slots }, error: null });
    const result = await getAvailableSlots(client, "service-1", "2026-08-05");
    expect(result).toEqual({ ok: true, data: slots });
  });

  it("getAvailableSlots：RPC 回傳已知 error_code 時正確轉換", async () => {
    const client = fakeRpcClient({
      data: { ok: false, error_code: "SERVICE_INACTIVE", message: "service not available" },
      error: null,
    });
    const result = await getAvailableSlots(client, "service-1", "2026-08-05");
    expect(result).toEqual({
      ok: false,
      error: { code: "SERVICE_INACTIVE", message: "service not available" },
    });
  });

  it("getAvailableSlots：未知 error_code 一律歸類 INTERNAL_ERROR，不透出原始值", async () => {
    const client = fakeRpcClient({
      data: { ok: false, error_code: "SOME_NEW_DB_ERROR", message: "constraint xyz violated" },
      error: null,
    });
    const result = await getAvailableSlots(client, "service-1", "2026-08-05");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INTERNAL_ERROR");
    }
  });

  it("getAvailableSlots：頂層 RPC 呼叫失敗（如網路錯誤）轉成 INTERNAL_ERROR", async () => {
    const client = fakeRpcClient({ data: null, error: { message: "network error" } });
    const result = await getAvailableSlots(client, "service-1", "2026-08-05");
    expect(result).toEqual({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "發生未預期的錯誤，請稍後再試。" },
    });
  });

  it("createAppointment：成功時透傳 RPC 回顯的 data", async () => {
    const confirmation = {
      service_name: "剪髮造型",
      start_at: "2026-08-12T03:00:00+00:00",
      end_at: "2026-08-12T03:45:00+00:00",
      customer_name: "王小美",
      customer_phone: "0912345678",
      designer_id: "designer-1",
      designer_name: "林小美",
    };
    const client = fakeRpcClient({ data: { ok: true, data: confirmation }, error: null });
    const result = await createAppointment(client, {
      serviceId: "service-1",
      startAt: "2026-08-12T03:00:00+00:00",
      customerName: "王小美",
      customerPhone: "0912345678",
    });
    expect(result).toEqual({ ok: true, data: confirmation });
  });

  it("createAppointment：SLOT_CONFLICT 正確轉換，不外洩 constraint 名稱等細節", async () => {
    const client = fakeRpcClient({
      data: { ok: false, error_code: "SLOT_CONFLICT", message: "slot already booked" },
      error: null,
    });
    const result = await createAppointment(client, {
      serviceId: "service-1",
      startAt: "2026-08-12T03:00:00+00:00",
      customerName: "王小美",
      customerPhone: "0912345678",
    });
    expect(result).toEqual({
      ok: false,
      error: { code: "SLOT_CONFLICT", message: "slot already booked" },
    });
  });

  it("createAppointment：email 未填時傳給 RPC 的 p_customer_email 為 null", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true, data: {} }, error: null });
    const client = { rpc } as unknown as SupabaseClient;

    await createAppointment(client, {
      serviceId: "service-1",
      startAt: "2026-08-12T03:00:00+00:00",
      customerName: "王小美",
      customerPhone: "0912345678",
    });

    expect(rpc).toHaveBeenCalledWith("create_appointment", expect.objectContaining({ p_customer_email: null }));
  });

  it("createAppointment：未指定設計師時 p_designer_id 傳 null（省略與明確傳 null 結果相同）", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true, data: {} }, error: null });
    const client = { rpc } as unknown as SupabaseClient;
    const base = {
      serviceId: "service-1",
      startAt: "2026-08-12T03:00:00+00:00",
      customerName: "王小美",
      customerPhone: "0912345678",
    };

    await createAppointment(client, base);
    await createAppointment(client, { ...base, designerId: null });

    expect(rpc).toHaveBeenNthCalledWith(1, "create_appointment", expect.objectContaining({ p_designer_id: null }));
    expect(rpc).toHaveBeenNthCalledWith(2, "create_appointment", expect.objectContaining({ p_designer_id: null }));
  });

  it("createAppointment：指定設計師時把 designerId 傳給 p_designer_id，並完整保留 RPC 回傳的指派結果", async () => {
    const data = {
      service_name: "剪髮造型",
      start_at: "2026-08-12T03:00:00+00:00",
      end_at: "2026-08-12T03:45:00+00:00",
      customer_name: "王小美",
      customer_phone: "0912345678",
      designer_id: "designer-9",
      designer_name: "陳阿傑",
    };
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true, data }, error: null });
    const client = { rpc } as unknown as SupabaseClient;

    const result = await createAppointment(client, {
      serviceId: "service-1",
      startAt: "2026-08-12T03:00:00+00:00",
      customerName: "王小美",
      customerPhone: "0912345678",
      designerId: "designer-9",
    });

    expect(rpc).toHaveBeenCalledWith(
      "create_appointment",
      expect.objectContaining({ p_service_id: "service-1", p_designer_id: "designer-9" }),
    );
    expect(result).toEqual({ ok: true, data });
    if (result.ok) {
      expect(result.data.designer_name).toBe("陳阿傑");
      expect(result.data.designer_id).toBe("designer-9");
    }
  });

  it("getAvailableSlots：省略或 null 時 p_designer_id 傳 null，指定時傳設計師 id", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true, data: [] }, error: null });
    const client = { rpc } as unknown as SupabaseClient;

    await getAvailableSlots(client, "service-1", "2026-08-05");
    await getAvailableSlots(client, "service-1", "2026-08-05", null);
    await getAvailableSlots(client, "service-1", "2026-08-05", "designer-9");

    expect(rpc).toHaveBeenNthCalledWith(1, "get_available_slots", {
      p_service_id: "service-1",
      p_date: "2026-08-05",
      p_designer_id: null,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "get_available_slots", {
      p_service_id: "service-1",
      p_date: "2026-08-05",
      p_designer_id: null,
    });
    expect(rpc).toHaveBeenNthCalledWith(3, "get_available_slots", {
      p_service_id: "service-1",
      p_date: "2026-08-05",
      p_designer_id: "designer-9",
    });
  });
});

describe("getServices（只列有啟用中設計師提供的上架服務）", () => {
  const serviceRow = {
    id: "s1",
    name: "剪髮",
    description: null,
    price: 800,
    duration_minutes: 60,
    is_active: true,
    sort_order: 1,
  };

  it("內嵌兩層 !inner 並明確過濾服務與設計師的 is_active，再依 sort_order 排序", async () => {
    const { client, calls } = recordingTableClient({ data: [], error: null });
    await getServices(client);

    expect(calls[0]).toEqual(["from", ["services"]]);
    const select = calls.find(([method]) => method === "select")![1][0] as string;
    expect(select).toBe(
      "id, name, description, price, duration_minutes, is_active, sort_order, designer_services!inner(designers!inner(is_active))",
    );
    expect(calls).toContainEqual(["eq", ["is_active", true]]);
    expect(calls).toContainEqual(["eq", ["designer_services.designers.is_active", true]]);
    expect(calls).toContainEqual(["order", ["sort_order", { ascending: true }]]);
  });

  it("回傳前剝掉內嵌欄位，只留 Service 的欄位", async () => {
    const client = fakeTableClient({
      data: [{ ...serviceRow, designer_services: [{ designers: { is_active: true } }] }],
      error: null,
    });
    const result = await getServices(client);
    expect(result).toEqual({ ok: true, data: [serviceRow] });
  });

  it("查詢拋出例外時回通用錯誤，不外洩訊息", async () => {
    const client = {
      from: () => {
        throw new Error("secret detail");
      },
    } as unknown as SupabaseClient;
    expect(await getServices(client)).toEqual({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "發生未預期的錯誤，請稍後再試。" },
    });
  });
});

describe("getDesignersForService", () => {
  const base = "https://project-ref.supabase.co";
  const serviceId = "11111111-1111-4111-8111-111111111111";
  const designerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const otherDesignerId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const imageId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const goodImageUrl = `${base}/storage/v1/object/public/designer-assets/portfolio/${designerId}/${imageId}.webp`;
  const INTERNAL = { code: "INTERNAL_ERROR", message: "發生未預期的錯誤，請稍後再試。" };

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", base);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function row(overrides: Record<string, unknown> = {}) {
    return {
      id: designerId,
      name: "林小美",
      bio: "入行 8 年",
      specialties: ["漸層染"],
      instagram_handle: "mei.hair",
      avatar_url: `${base}/storage/v1/object/public/designer-assets/avatar/${designerId}/a.webp`,
      sort_order: 1,
      is_active: true,
      designer_services: [{ service_id: serviceId, services: { is_active: true } }],
      designer_portfolio_images: [{ id: imageId, image_url: goodImageUrl, created_at: "2026-10-01T00:00:00Z" }],
      ...overrides,
    };
  }

  it("明確列欄位、過濾設計師與服務的 is_active、指定服務，並排序（設計師 sort_order＋id，作品 created_at desc＋id desc）", async () => {
    const { client, calls } = recordingTableClient({ data: [], error: null });
    await getDesignersForService(client, serviceId);

    expect(calls[0]).toEqual(["from", ["designers"]]);
    const select = calls.find(([method]) => method === "select")![1][0] as string;
    expect(select).toBe(
      "id, name, bio, specialties, instagram_handle, avatar_url, sort_order, is_active, " +
        "designer_services!inner(service_id, services!inner(is_active)), designer_portfolio_images(id, image_url, created_at)",
    );
    expect(select).not.toContain("*");
    expect(calls).toContainEqual(["eq", ["is_active", true]]);
    expect(calls).toContainEqual(["eq", ["designer_services.service_id", serviceId]]);
    expect(calls).toContainEqual(["eq", ["designer_services.services.is_active", true]]);
    expect(calls).toContainEqual(["order", ["sort_order", { ascending: true }]]);
    expect(calls).toContainEqual(["order", ["id", { ascending: true }]]);
    expect(calls).toContainEqual([
      "order",
      ["created_at", { ascending: false, referencedTable: "designer_portfolio_images" }],
    ]);
    expect(calls).toContainEqual(["order", ["id", { ascending: false, referencedTable: "designer_portfolio_images" }]]);
    expect(calls).toContainEqual(["limit", [12, { referencedTable: "designer_portfolio_images" }]]);
  });

  it("serviceId 不是 uuid 時不送請求，直接回通用錯誤", async () => {
    for (const bad of ["not-a-uuid", "' or 1=1", "a,b)", ""]) {
      const { client, calls } = recordingTableClient({ data: [], error: null });
      expect(await getDesignersForService(client, bad)).toEqual({ ok: false, error: INTERNAL });
      expect(calls).toEqual([]);
    }
  });

  it("只回傳 PublicDesigner 白名單欄位：內嵌的 designer_services 與 is_active 都不外流", async () => {
    const result = await getDesignersForService(fakeTableClient({ data: [row()], error: null }), serviceId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.data[0]).sort()).toEqual(
      ["avatar_url", "bio", "id", "instagram_handle", "name", "portfolio", "sort_order", "specialties"].sort(),
    );
    expect(result.data[0].portfolio).toEqual([
      { id: imageId, image_url: goodImageUrl, created_at: "2026-10-01T00:00:00Z" },
    ]);
  });

  it("頭像不在 designer-assets 白名單就當成沒有頭像", async () => {
    const result = await getDesignersForService(
      fakeTableClient({ data: [row({ avatar_url: "https://evil.example/a.png" })], error: null }),
      serviceId,
    );
    expect(result.ok && result.data[0].avatar_url).toBeNull();
  });

  it("不合格的作品網址直接丟掉：外部網域、query、別位設計師的路徑", async () => {
    const images = [
      { id: "i1", image_url: goodImageUrl, created_at: "t1" },
      { id: "i2", image_url: "https://evil.example/x.webp", created_at: "t2" },
      { id: "i3", image_url: `${goodImageUrl}?portfolio/${otherDesignerId}/y.webp`, created_at: "t3" },
      {
        id: "i4",
        image_url: `${base}/storage/v1/object/public/designer-assets/portfolio/${otherDesignerId}/${imageId}.webp`,
        created_at: "t4",
      },
      { id: "i5", image_url: null, created_at: "t5" },
    ];
    const result = await getDesignersForService(
      fakeTableClient({ data: [row({ designer_portfolio_images: images })], error: null }),
      serviceId,
    );
    expect(result.ok && result.data[0].portfolio.map((image) => image.id)).toEqual(["i1"]);
  });

  it("作品最多保留 12 張", async () => {
    const images = Array.from({ length: 15 }, (_, i) => ({
      id: `i${i}`,
      image_url: goodImageUrl,
      created_at: `2026-10-${String(i + 1).padStart(2, "0")}`,
    }));
    const result = await getDesignersForService(
      fakeTableClient({ data: [row({ designer_portfolio_images: images })], error: null }),
      serviceId,
    );
    expect(result.ok && result.data[0].portfolio).toHaveLength(12);
  });

  it("簡介去掉方向控制字元但保留換行；格式錯誤的 IG 帳號、非字串的專長元素被清掉", async () => {
    const result = await getDesignersForService(
      fakeTableClient({
        data: [
          row({
            bio: "第一行‮反轉⁦\n第二行",
            instagram_handle: "javascript:alert(1)",
            specialties: ["染髮", 5, null, "燙髮"],
          }),
        ],
        error: null,
      }),
      serviceId,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data[0].bio).toBe("第一行反轉\n第二行");
    expect(result.data[0].instagram_handle).toBeNull();
    expect(result.data[0].specialties).toEqual(["染髮", "燙髮"]);
  });

  it("name 不是字串或 id 不是 uuid 的列整列丟掉", async () => {
    const result = await getDesignersForService(
      fakeTableClient({ data: [row({ name: null }), row({ id: "not-a-uuid" }), row()], error: null }),
      serviceId,
    );
    expect(result.ok && result.data.map((designer) => designer.id)).toEqual([designerId]);
  });

  it("資料庫錯誤與例外都回通用錯誤，不外洩訊息", async () => {
    const failed = await getDesignersForService(
      fakeTableClient({ data: null, error: { code: "42501", message: "permission denied for column created_at" } }),
      serviceId,
    );
    expect(failed).toEqual({ ok: false, error: INTERNAL });

    const thrown = await getDesignersForService(
      {
        from: () => {
          throw new Error("secret detail");
        },
      } as unknown as SupabaseClient,
      serviceId,
    );
    expect(thrown).toEqual({ ok: false, error: INTERNAL });
  });

  it("沒有設計師時回空陣列（不是錯誤）", async () => {
    expect(await getDesignersForService(fakeTableClient({ data: [], error: null }), serviceId)).toEqual({
      ok: true,
      data: [],
    });
  });
});
