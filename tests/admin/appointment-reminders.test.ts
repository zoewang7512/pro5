import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { claimAppointmentsForReminder, computeReminderWindow, releaseReminderClaim } from "@/lib/admin/appointment-reminders";

describe("computeReminderWindow", () => {
  it("回傳現在時間加 0 小時到加 26 小時的區間（ISO 字串）", () => {
    const now = new Date("2026-08-24T00:00:00.000Z");
    const window = computeReminderWindow(now);

    expect(window.from).toBe("2026-08-24T00:00:00.000Z");
    expect(window.to).toBe("2026-08-25T02:00:00.000Z");
  });

  it("時間窗寬度為 26 小時，大於每日執行一次的間隔（含 Vercel 文件記載的最多 1 小時飄移），確保連續執行之間有重疊", () => {
    const now = new Date("2026-08-24T00:00:00.000Z");
    const window = computeReminderWindow(now);
    const widthHours = (new Date(window.to).getTime() - new Date(window.from).getTime()) / (60 * 60 * 1000);

    expect(widthHours).toBe(26);
    expect(widthHours).toBeGreaterThan(25);
  });

  it("下界為 0：不會排除「執行後才建立、提前量落在下界附近」的預約（TASK-054 審查發現的修正——下界原本是 20 小時時，會讓這類預約永久漏寄）", () => {
    const now = new Date("2026-08-24T00:00:00.000Z");
    const window = computeReminderWindow(now);

    expect(window.from).toBe(now.toISOString());
  });

  it("不同的現在時間會平移出對應的區間（純函式，不依賴實際系統時間）", () => {
    const now = new Date("2026-01-01T12:30:00.000Z");
    const window = computeReminderWindow(now);

    expect(window.from).toBe("2026-01-01T12:30:00.000Z");
    expect(window.to).toBe("2026-01-02T14:30:00.000Z");
  });
});

// 比照 tests/admin/appointments.test.ts 的 fakeUpdateClient 模式，額外支援
// .order()／.limit()（claim 查詢新增的排序與上限）。
function fakeUpdateClient(result: { data: unknown; error: unknown }) {
  const select = vi.fn().mockResolvedValue(result);
  const chainable: {
    gte: ReturnType<typeof vi.fn>;
    lt: ReturnType<typeof vi.fn>;
    in: ReturnType<typeof vi.fn>;
    is: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    select: typeof select;
  } = { gte: vi.fn(), lt: vi.fn(), in: vi.fn(), is: vi.fn(), order: vi.fn(), limit: vi.fn(), eq: vi.fn(), select };
  chainable.gte.mockImplementation(() => chainable);
  chainable.lt.mockImplementation(() => chainable);
  chainable.in.mockImplementation(() => chainable);
  chainable.is.mockImplementation(() => chainable);
  chainable.order.mockImplementation(() => chainable);
  chainable.limit.mockImplementation(() => chainable);
  chainable.eq.mockImplementation(async () => result);
  const update = vi.fn(() => chainable);
  const from = vi.fn(() => ({ update }));
  return { client: { from } as unknown as SupabaseClient, update, chainable };
}

const WINDOW = { from: "2026-08-24T00:00:00.000Z", to: "2026-08-25T02:00:00.000Z" };

describe("claimAppointmentsForReminder", () => {
  it("查詢失敗時回傳 INTERNAL_ERROR，不外洩底層訊息", async () => {
    const { client } = fakeUpdateClient({ data: null, error: { message: "constraint xyz violated" } });
    const result = await claimAppointmentsForReminder(client, WINDOW);

    expect(result).toEqual({ ok: false, error: { message: "發生未預期的錯誤，請稍後再試。" } });
  });

  it("查無符合條件的預約時回傳空陣列（不是錯誤）", async () => {
    const { client } = fakeUpdateClient({ data: [], error: null });
    const result = await claimAppointmentsForReminder(client, WINDOW);

    expect(result).toEqual({ ok: true, data: [] });
  });

  it("成功時把內嵌的 services(name) 攤平成 service_name，含 customer_email 為 null 的列（claim 一併涵蓋）", async () => {
    const rows = [
      {
        id: "apt-1",
        customer_name: "王小明",
        customer_email: "a@example.invalid",
        start_at: "2026-08-25T09:00:00+08:00",
        services: { name: "剪髮" },
      },
      {
        id: "apt-2",
        customer_name: "李小華",
        customer_email: null,
        start_at: "2026-08-25T10:00:00+08:00",
        services: [{ name: "染髮" }],
      },
      {
        id: "apt-3",
        customer_name: "陳小美",
        customer_email: "c@example.invalid",
        start_at: "2026-08-25T11:00:00+08:00",
        services: null,
      },
    ];
    const { client, update, chainable } = fakeUpdateClient({ data: rows, error: null });
    const result = await claimAppointmentsForReminder(client, WINDOW);

    expect(result).toEqual({
      ok: true,
      data: [
        { id: "apt-1", customer_name: "王小明", customer_email: "a@example.invalid", start_at: "2026-08-25T09:00:00+08:00", service_name: "剪髮" },
        { id: "apt-2", customer_name: "李小華", customer_email: null, start_at: "2026-08-25T10:00:00+08:00", service_name: "染髮" },
        { id: "apt-3", customer_name: "陳小美", customer_email: "c@example.invalid", start_at: "2026-08-25T11:00:00+08:00", service_name: "服務" },
      ],
    });
    // 確認查詢條件正確組裝：status in pending/confirmed、reminder_sent_at is null、
    // start_at 落在時間窗內、依 start_at 排序、有上限。
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ reminder_sent_at: expect.any(String) }));
    expect(chainable.gte).toHaveBeenCalledWith("start_at", WINDOW.from);
    expect(chainable.lt).toHaveBeenCalledWith("start_at", WINDOW.to);
    expect(chainable.in).toHaveBeenCalledWith("status", ["pending", "confirmed"]);
    expect(chainable.is).toHaveBeenCalledWith("reminder_sent_at", null);
    expect(chainable.order).toHaveBeenCalledWith("start_at", { ascending: true });
    expect(chainable.limit).toHaveBeenCalledWith(100);
  });
});

describe("releaseReminderClaim", () => {
  it("成功時把 reminder_sent_at 更新回 null", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ update }));
    const client = { from } as unknown as SupabaseClient;

    await releaseReminderClaim(client, "apt-1");

    expect(update).toHaveBeenCalledWith({ reminder_sent_at: null });
    expect(eq).toHaveBeenCalledWith("id", "apt-1");
  });

  it("釋放失敗時記錄 log，不拋出例外（呼叫端不需要額外處理）", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const eq = vi.fn().mockResolvedValue({ error: { message: "db error" } });
    const update = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ update }));
    const client = { from } as unknown as SupabaseClient;

    await expect(releaseReminderClaim(client, "apt-1")).resolves.toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});
