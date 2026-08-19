// 對真實 Supabase 專案執行的整合測試，驗證服務項目管理 Epic（TASK-034～036）的
// services 表 RLS 邊界（designer 可新增/編輯/切換上下架，anon／非管理員 authenticated
// 皆被拒），以及下架後 get_available_slots／create_appointment 兩支既有 RPC 的實際行為
// （TASK-048／TASK-053 之外，這裡驗證的是既有 is_active 過濾邏輯，非本 Epic 新增）。
// 不放進預設 `npm test`，只透過 `npm run test:services` 執行——這個檔案不會在其他情境下
// 被跑到，所以缺設定時直接噴錯而非略過，避免「忘了填 .env.local 卻顯示測試通過」的誤導。
// 沿用既有整合測試檔案的既有寫法：afterAll 清除失敗要 throw、非管理員帳號用獨立隨機密碼、
// 寫入結果核對受影響列數而非只看 error 是否為 null、測試建立的服務項目一律加 TEST_MARKER
// 前綴並於 afterAll 刪除（本檔案未建立任何 appointments，刪除 services 不會撞到既有
// TASK-033「只做下架不支援真刪除」的產品範圍決策——那是後台使用者介面層級的範圍限制，
// 這裡是測試自己清理測試資料，兩者性質不同）。
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const designerEmail = process.env.DESIGNER_EMAIL;
const designerPassword = process.env.DESIGNER_PASSWORD;

if (!url || !anonKey || !serviceRoleKey || !designerEmail || !designerPassword) {
  throw new Error(
    "[services.integration.test] 缺少 Supabase 專案設定或 DESIGNER_EMAIL/DESIGNER_PASSWORD，" +
      "請確認 .env.local 已填妥並已執行 npm run seed:designer。",
  );
}

const TEST_MARKER = `__TEST__services-${Date.now()}`;

type RpcEnvelope<T> = { ok: true; data: T } | { ok: false; error_code: string; message: string };
type AvailableSlot = { start_at: string; end_at: string };

function taipeiToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  return t.toISOString().slice(0, 10);
}

function weekdayOf(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}

// 依 seed 的 business_hours：週一至週六營業，週日公休（見 tests/booking.integration.test.ts
// 既有註解）。本檔案只需要一個保證營業中的日期，不需要完整的 generateOpenWeekdays 迴圈邏輯。
// 選 84 天起：晚於 test:business-hours（55／58／65）與 test:booking（70 起 9 個營業日，
// 實際涵蓋約 70～81 天）已使用的範圍，且仍在 90 天可預約視野上限內，見
// ai/context/project-map.md 的既有 offset 表。
function nextOpenWeekday(startOffsetDays: number): string {
  let date = addDays(taipeiToday(), startOffsetDays);
  while (weekdayOf(date) === 0) {
    date = addDays(date, 1);
  }
  return date;
}

const SLOTS_TEST_DATE = nextOpenWeekday(84);

async function callGetAvailableSlots(
  client: SupabaseClient,
  serviceId: string,
  date: string,
): Promise<RpcEnvelope<AvailableSlot[]>> {
  const { data, error } = await client.rpc("get_available_slots", { p_service_id: serviceId, p_date: date });
  if (error) throw error;
  return data as RpcEnvelope<AvailableSlot[]>;
}

async function callCreateAppointment(
  client: SupabaseClient,
  input: { serviceId: string; startAt: string; customerName: string; customerPhone: string },
) {
  const { data, error } = await client.rpc("create_appointment", {
    p_service_id: input.serviceId,
    p_start_at: input.startAt,
    p_customer_name: input.customerName,
    p_customer_phone: input.customerPhone,
    p_customer_email: null,
  });
  if (error) throw error;
  return data as RpcEnvelope<{ service_name: string }>;
}

describe("服務項目管理：services 權限邊界與下架對既有 RPC 的影響（真實 Supabase 專案）", () => {
  let serviceRoleClient: SupabaseClient;
  let anonClient: SupabaseClient;
  let designerClient: SupabaseClient;
  let nonAdminClient: SupabaseClient;
  let nonAdminUserId: string | undefined;
  const createdServiceIds: string[] = [];

  beforeAll(async () => {
    serviceRoleClient = createClient(url!, serviceRoleKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    anonClient = createClient(url!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    designerClient = createClient(url!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error: signInError } = await designerClient.auth.signInWithPassword({
      email: designerEmail!,
      password: designerPassword!,
    });
    if (signInError) throw signInError;

    const nonAdminEmail = `${TEST_MARKER}-nonadmin@example.invalid`;
    const nonAdminPassword = `${randomUUID()}Aa1!`;
    const { data: createdNonAdmin, error: createNonAdminError } = await serviceRoleClient.auth.admin.createUser({
      email: nonAdminEmail,
      password: nonAdminPassword,
      email_confirm: true,
    });
    if (createNonAdminError) throw createNonAdminError;
    nonAdminUserId = createdNonAdmin.user.id;

    nonAdminClient = createClient(url!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: nonAdminSignInError } = await nonAdminClient.auth.signInWithPassword({
      email: nonAdminEmail,
      password: nonAdminPassword,
    });
    if (nonAdminSignInError) throw nonAdminSignInError;
  });

  afterAll(async () => {
    const cleanupErrors: unknown[] = [];

    try {
      await designerClient.auth.signOut();
      await nonAdminClient.auth.signOut();
    } catch (signOutError) {
      cleanupErrors.push(signOutError);
    }

    if (nonAdminUserId) {
      const { error: deleteNonAdminError } = await serviceRoleClient.auth.admin.deleteUser(nonAdminUserId);
      if (deleteNonAdminError) cleanupErrors.push(deleteNonAdminError);
    }

    if (createdServiceIds.length > 0) {
      const { error: deleteServicesError } = await serviceRoleClient
        .from("services")
        .delete()
        .in("id", createdServiceIds);
      if (deleteServicesError) cleanupErrors.push(deleteServicesError);
    }

    if (cleanupErrors.length > 0) {
      const messages = cleanupErrors.map((e) => (e instanceof Error ? e.message : JSON.stringify(e)));
      throw new Error(
        `[services.integration.test] afterAll 清除失敗，測試資料可能未被清乾淨：${JSON.stringify(messages)}`,
      );
    }
  });

  describe("services 寫入權限邊界：designer 可新增/編輯/切換上下架，anon／非管理員 authenticated 皆被拒", () => {
    let rlsFixtureId: string;

    it("designer 可以新增服務項目（新增後 is_active 預設為 true）", async () => {
      const { data, error } = await designerClient
        .from("services")
        .insert({ name: `${TEST_MARKER} rls-fixture`, price: 500, duration_minutes: 30 })
        .select("id, is_active")
        .single();
      expect(error).toBeNull();
      expect(data?.is_active).toBe(true);
      rlsFixtureId = data!.id;
      createdServiceIds.push(rlsFixtureId);
    });

    it("anon 無法新增服務項目", async () => {
      const { data } = await anonClient
        .from("services")
        .insert({ name: `${TEST_MARKER} anon-should-fail`, price: 100, duration_minutes: 10 })
        .select("id");
      expect(data ?? []).toEqual([]);
    });

    it("已登入但非 is_admin() 的 authenticated 使用者無法新增服務項目", async () => {
      const { data } = await nonAdminClient
        .from("services")
        .insert({ name: `${TEST_MARKER} nonadmin-should-fail`, price: 100, duration_minutes: 10 })
        .select("id");
      expect(data ?? []).toEqual([]);
    });

    it("designer 可以編輯服務項目的名稱/價格/時長", async () => {
      const { data, error } = await designerClient
        .from("services")
        .update({ name: `${TEST_MARKER} rls-fixture-updated`, price: 600, duration_minutes: 45 })
        .eq("id", rlsFixtureId)
        .select("id, name, price, duration_minutes");
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data?.[0]?.name).toBe(`${TEST_MARKER} rls-fixture-updated`);
    });

    it("anon 無法編輯服務項目", async () => {
      const { data } = await anonClient
        .from("services")
        .update({ price: 1 })
        .eq("id", rlsFixtureId)
        .select("id");
      expect(data ?? []).toEqual([]);

      const { data: unchanged } = await serviceRoleClient.from("services").select("price").eq("id", rlsFixtureId).single();
      expect(unchanged?.price).not.toBe(1);
    });

    it("已登入但非 is_admin() 的 authenticated 使用者無法編輯服務項目", async () => {
      const { data } = await nonAdminClient
        .from("services")
        .update({ price: 1 })
        .eq("id", rlsFixtureId)
        .select("id");
      expect(data ?? []).toEqual([]);
    });

    it("designer 可以切換服務項目上下架狀態", async () => {
      const { data: deactivated, error: deactivateError } = await designerClient
        .from("services")
        .update({ is_active: false })
        .eq("id", rlsFixtureId)
        .select("id, is_active");
      expect(deactivateError).toBeNull();
      expect(deactivated?.[0]?.is_active).toBe(false);

      const { data: reactivated, error: reactivateError } = await designerClient
        .from("services")
        .update({ is_active: true })
        .eq("id", rlsFixtureId)
        .select("id, is_active");
      expect(reactivateError).toBeNull();
      expect(reactivated?.[0]?.is_active).toBe(true);
    });

    it("anon 無法切換服務項目上下架狀態", async () => {
      const { data } = await anonClient
        .from("services")
        .update({ is_active: false })
        .eq("id", rlsFixtureId)
        .select("id");
      expect(data ?? []).toEqual([]);

      const { data: unchanged } = await serviceRoleClient
        .from("services")
        .select("is_active")
        .eq("id", rlsFixtureId)
        .single();
      expect(unchanged?.is_active).toBe(true);
    });

    it("anon 可讀取上架中的服務項目（供顧客前台使用），但讀不到已下架的項目", async () => {
      const { data: activeRead } = await anonClient.from("services").select("id").eq("id", rlsFixtureId).maybeSingle();
      expect(activeRead?.id).toBe(rlsFixtureId);

      await serviceRoleClient.from("services").update({ is_active: false }).eq("id", rlsFixtureId);
      const { data: inactiveRead } = await anonClient.from("services").select("id").eq("id", rlsFixtureId).maybeSingle();
      expect(inactiveRead).toBeNull();

      // 還原成上架，避免影響後面的 describe 區塊或其他人工檢查。
      await serviceRoleClient.from("services").update({ is_active: true }).eq("id", rlsFixtureId);
    });
  });

  describe("下架後對 get_available_slots／create_appointment 的實際影響", () => {
    let toggleServiceId: string;

    beforeAll(async () => {
      const { data, error } = await serviceRoleClient
        .from("services")
        .insert({ name: `${TEST_MARKER} toggle-fixture`, price: 500, duration_minutes: 30, is_active: true })
        .select("id")
        .single();
      if (error) throw error;
      toggleServiceId = data.id;
      createdServiceIds.push(toggleServiceId);
    });

    it("上架中時，get_available_slots 回傳非空的可預約時段", async () => {
      const result = await callGetAvailableSlots(anonClient, toggleServiceId, SLOTS_TEST_DATE);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.length).toBeGreaterThan(0);
      }
    });

    it("下架後，get_available_slots 回傳空陣列（不報錯，比照既有設計：不細分「沒有時段」的原因）", async () => {
      const { error } = await serviceRoleClient.from("services").update({ is_active: false }).eq("id", toggleServiceId);
      expect(error).toBeNull();

      const result = await callGetAvailableSlots(anonClient, toggleServiceId, SLOTS_TEST_DATE);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toEqual([]);
      }
    });

    it("下架後，create_appointment 對該服務的新預約請求回傳 SERVICE_INACTIVE，不寫入任何資料", async () => {
      const result = await callCreateAppointment(anonClient, {
        serviceId: toggleServiceId,
        startAt: `${SLOTS_TEST_DATE}T10:00:00+08:00`,
        customerName: `${TEST_MARKER} customer`,
        customerPhone: "0912345678",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error_code).toBe("SERVICE_INACTIVE");
      }

      const { data: appointments } = await serviceRoleClient
        .from("appointments")
        .select("id")
        .eq("service_id", toggleServiceId);
      expect(appointments ?? []).toEqual([]);
    });

    it("重新上架後，get_available_slots 恢復回傳非空的可預約時段", async () => {
      const { error } = await serviceRoleClient.from("services").update({ is_active: true }).eq("id", toggleServiceId);
      expect(error).toBeNull();

      const result = await callGetAvailableSlots(anonClient, toggleServiceId, SLOTS_TEST_DATE);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.length).toBeGreaterThan(0);
      }
    });
  });
});
