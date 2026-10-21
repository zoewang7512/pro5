import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAppointment, getAvailableSlots, getBusinessHours, getServices } from "@/lib/booking/api";

// 用最小的假 client 驗證 lib/booking/api.ts 把 Supabase 的兩種錯誤形狀
// （PostgrestError／RPC 自訂 {ok:false, error_code, message}）正確轉成 Result<T>，
// 不外洩底層錯誤細節，且對未知的 error_code 一律歸類 INTERNAL_ERROR。

function fakeTableClient(result: { data: unknown; error: unknown }): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => Promise.resolve(result),
          maybeSingle: () => Promise.resolve(result),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
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
