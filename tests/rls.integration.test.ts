// 對真實 Supabase 專案執行的整合測試，驗證 TASK-003 的 RLS 邊界。
// 不放進預設 `npm test`（見 vitest.config.ts 的 include 設定），只透過
// `npm run test:rls` 執行——這個檔案不會在其他情境下被跑到，所以缺設定時
// 直接噴錯而非略過，避免「忘了填 .env.local 卻顯示測試通過」的誤導。
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
    "[rls.integration.test] 缺少 Supabase 專案設定或 DESIGNER_EMAIL/DESIGNER_PASSWORD，" +
      "請確認 .env.local 已填妥並已執行 npm run seed:designer。",
  );
}

const TEST_MARKER = `__TEST__rls-${Date.now()}`;

describe("RLS 邊界（真實 Supabase 專案）", () => {
  let serviceRoleClient: SupabaseClient;
  let anonClient: SupabaseClient;
  let activeServiceId: string;
  let inactiveServiceId: string;
  const appointmentIdsToCleanup: string[] = [];
  const serviceIdsToCleanup: string[] = [];

  beforeAll(async () => {
    serviceRoleClient = createClient(url!, serviceRoleKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    anonClient = createClient(url!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: activeService, error: activeError } = await serviceRoleClient
      .from("services")
      .insert({
        name: `${TEST_MARKER} active`,
        price: 100,
        duration_minutes: 30,
        is_active: true,
      })
      .select("id")
      .single();
    if (activeError) throw activeError;
    activeServiceId = activeService.id;
    serviceIdsToCleanup.push(activeServiceId);

    const { data: inactiveService, error: inactiveError } = await serviceRoleClient
      .from("services")
      .insert({
        name: `${TEST_MARKER} inactive`,
        price: 100,
        duration_minutes: 30,
        is_active: false,
      })
      .select("id")
      .single();
    if (inactiveError) throw inactiveError;
    inactiveServiceId = inactiveService.id;
    serviceIdsToCleanup.push(inactiveServiceId);

    // 用 service role 直接建立一筆預約（繞過 RLS），供下面「設計師可讀取」測試使用。
    // 顧客端建立預約的路徑（create_appointment RPC）由 npm run test:booking 驗證。
    const { data: appointment, error: appointmentError } = await serviceRoleClient
      .from("appointments")
      .insert({
        service_id: activeServiceId,
        customer_name: `${TEST_MARKER} fixture`,
        // 排在約 3 年後（再錯開下方 TASK-066 describe 的 fixture 2 小時），避開正式環境
        // 真實預約：appointments_no_overlap 不分服務，原本「1 小時後」會撞到當天已有的預約。
        start_at: new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000).toISOString(),
        end_at: new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000 + 150 * 60 * 1000).toISOString(),
      })
      .select("id")
      .single();
    if (appointmentError) throw appointmentError;
    appointmentIdsToCleanup.push(appointment.id);
  });

  afterAll(async () => {
    if (appointmentIdsToCleanup.length > 0) {
      await serviceRoleClient.from("appointments").delete().in("id", appointmentIdsToCleanup);
    }
    if (serviceIdsToCleanup.length > 0) {
      await serviceRoleClient.from("services").delete().in("id", serviceIdsToCleanup);
    }
  });

  it("anon 可讀取啟用中的 service，讀不到未啟用的", async () => {
    const { data, error } = await anonClient
      .from("services")
      .select("id, is_active")
      .in("id", [activeServiceId, inactiveServiceId]);

    expect(error).toBeNull();
    const ids = (data ?? []).map((row) => row.id);
    expect(ids).toContain(activeServiceId);
    expect(ids).not.toContain(inactiveServiceId);
  });

  // TASK-066（0015_explicit_table_grants.sql）起，anon 對 appointments／customers／
  // closed_dates／admins 在權限層就沒有任何授權，不再是「RLS 回空陣列」，而是直接回
  // 42501 = insufficient_privilege。精確比對錯誤代碼，避免其他錯誤（例如欄位名稱打錯）
  // 被誤判成「有擋住」。
  it.each(["appointments", "customers", "closed_dates", "admins"])(
    "anon 對 %s 在權限層就被拒（42501）",
    async (table) => {
      const { data, error } = await anonClient.from(table).select("*").limit(1);
      expect(error?.code).toBe("42501");
      expect(data).toBeNull();
    },
  );

  // TASK-010（顧客預約流程）撤銷了 TASK-003 原本開放的 anon 直接 INSERT
  // policy，appointments 的唯一寫入路徑改為 create_appointment RPC（見
  // ai/context/decisions.md 2026-08-05 的決策）。此處驗證舊路徑已確實關閉；
  // RPC 本身的正確性（時段衝突、去重、驗證規則）由 npm run test:booking 涵蓋。
  it("anon 無法直接 insert appointments（唯一寫入路徑是 create_appointment RPC）", async () => {
    const startAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const endAt = new Date(Date.now() + 90 * 60 * 1000).toISOString();

    const { error } = await anonClient.from("appointments").insert({
      service_id: activeServiceId,
      customer_name: `${TEST_MARKER} direct-insert-should-fail`,
      customer_email: `${TEST_MARKER}@example.invalid`,
      start_at: startAt,
      end_at: endAt,
    });

    // 42501 = insufficient_privilege：anon 對 appointments 沒有 insert 授權（TASK-010 起，
    // TASK-066 的 0015 再確認一次）。只比對「有 error」太鬆，欄位驗證錯誤也會誤判通過。
    expect(error?.code).toBe("42501");

    const { data: shouldNotExist, error: fetchError } = await serviceRoleClient
      .from("appointments")
      .select("id")
      .eq("customer_email", `${TEST_MARKER}@example.invalid`);
    expect(fetchError).toBeNull();
    expect(shouldNotExist).toEqual([]);
  });

  it("設計師帳密登入後可讀取 appointments，但對 customers／admins 在權限層就被拒", async () => {
    const designerClient = createClient(url!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: signInData, error: signInError } = await designerClient.auth.signInWithPassword(
      { email: designerEmail!, password: designerPassword! },
    );
    expect(signInError).toBeNull();
    expect(signInData.session).not.toBeNull();

    const { data: appointments, error: appointmentsError } = await designerClient
      .from("appointments")
      .select("id")
      .in("id", appointmentIdsToCleanup);
    expect(appointmentsError).toBeNull();
    expect(appointments?.length).toBe(appointmentIdsToCleanup.length);

    // TASK-066：後台目前沒有任何地方直接查 customers（顧客資料從 appointments 讀），
    // 依最小權限不給 authenticated 任何授權，未來「顧客資料管理」Epic 需要時再由該卡開放。
    // admins 只透過 SECURITY DEFINER 的 is_admin()／get_admin_profile() 存取。
    const { error: customersError } = await designerClient.from("customers").select("id").limit(1);
    expect(customersError?.code).toBe("42501");

    const { error: adminsError } = await designerClient.from("admins").select("user_id").limit(1);
    expect(adminsError?.code).toBe("42501");

    // 確認收緊權限沒有誤傷 is_admin() 這條唯一的存取路徑。
    const { data: isAdmin, error: isAdminError } = await designerClient.rpc("is_admin");
    expect(isAdminError).toBeNull();
    expect(isAdmin).toBe(true);

    await designerClient.auth.signOut();
  });

  it("錯誤密碼登入會失敗、不取得 session", async () => {
    const designerClient = createClient(url!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data, error } = await designerClient.auth.signInWithPassword({
      email: designerEmail!,
      password: `wrong-${designerPassword}`,
    });

    expect(error).not.toBeNull();
    expect(data.session).toBeNull();
  });
});

// TASK-066（0015_explicit_table_grants.sql）：驗證授權層確實收緊。
// - 設計師帳號能通過 RLS（is_admin() 為真），所以它被拒一定是授權層的作用。之後若有人
//   誤把權限加回來，這裡會抓到。delete／update 一律對不存在的 id 操作：權限檢查發生在
//   執行之前，id 存不存在都會回 42501；萬一權限真的被放寬，也不會誤刪真實資料。
// - 非管理員 authenticated 帳號（任何人都能註冊）對 appointments 有 select／update 授權，
//   唯一的防線是 RLS 的 is_admin()，這裡確認它讀不到、改不動顧客個資。
describe("TASK-066 授權層邊界（真實 Supabase 專案）", () => {
  const MARKER = `__TEST__rls-grants-${Date.now()}`;
  let serviceRoleClient: SupabaseClient;
  let designerClient: SupabaseClient;
  let nonAdminClient: SupabaseClient;
  let nonAdminUserId: string | undefined;
  let serviceId: string | undefined;
  let appointmentId: string;

  beforeAll(async () => {
    serviceRoleClient = createClient(url!, serviceRoleKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: service, error: serviceError } = await serviceRoleClient
      .from("services")
      .insert({ name: `${MARKER} service`, price: 100, duration_minutes: 30, is_active: true })
      .select("id")
      .single();
    if (serviceError) throw serviceError;
    serviceId = service.id;

    const { data: appointment, error: appointmentError } = await serviceRoleClient
      .from("appointments")
      .insert({
        service_id: serviceId,
        customer_name: `${MARKER} fixture`,
        // 排在約 3 年後，避開正式環境真實預約（appointments_no_overlap 不分服務）。
        start_at: new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000).toISOString(),
        end_at: new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000).toISOString(),
      })
      .select("id")
      .single();
    if (appointmentError) throw appointmentError;
    appointmentId = appointment.id;

    designerClient = createClient(url!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: designerSignInError } = await designerClient.auth.signInWithPassword({
      email: designerEmail!,
      password: designerPassword!,
    });
    if (designerSignInError) throw designerSignInError;

    const nonAdminEmail = `${MARKER}-nonadmin@example.invalid`;
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
    await designerClient?.auth.signOut();
    await nonAdminClient?.auth.signOut();
    if (nonAdminUserId) {
      const { error } = await serviceRoleClient.auth.admin.deleteUser(nonAdminUserId);
      if (error) cleanupErrors.push(error);
    }
    if (serviceId) {
      const { error: appointmentsError } = await serviceRoleClient
        .from("appointments")
        .delete()
        .eq("service_id", serviceId);
      if (appointmentsError) cleanupErrors.push(appointmentsError);
      const { error: serviceError } = await serviceRoleClient.from("services").delete().eq("id", serviceId);
      if (serviceError) cleanupErrors.push(serviceError);
    }
    if (cleanupErrors.length > 0) throw cleanupErrors[0];
  });

  it.each([
    ["services", "id", randomUUID()],
    ["business_hours", "weekday", 99],
    ["store_settings", "id", 99],
    ["booking_policy", "id", 99],
    ["appointments", "id", randomUUID()],
  ] as const)("設計師對 %s 沒有 delete 授權（42501）", async (table, column, value) => {
    const { error } = await designerClient.from(table).delete().eq(column, value);
    expect(error?.code).toBe("42501");
  });

  it("設計師對 store_settings／booking_policy／appointments 沒有 insert 授權（42501）", async () => {
    const { error: storeSettingsError } = await designerClient
      .from("store_settings")
      .insert({ id: 2, name: `${MARKER} should-fail` });
    expect(storeSettingsError?.code).toBe("42501");

    const { error: bookingPolicyError } = await designerClient
      .from("booking_policy")
      .insert({ id: 2, min_lead_time_hours: 1 });
    expect(bookingPolicyError?.code).toBe("42501");

    const { error: appointmentsError } = await designerClient.from("appointments").insert({
      service_id: serviceId,
      customer_name: `${MARKER} designer-insert-should-fail`,
      start_at: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
      end_at: new Date(Date.now() + 210 * 60 * 1000).toISOString(),
    });
    expect(appointmentsError?.code).toBe("42501");
  });

  it("設計師讀不到 appointments.access_token、改不了授權欄位以外的欄位（欄位層級授權）", async () => {
    const { error: readTokenError } = await designerClient
      .from("appointments")
      .select("id, access_token")
      .eq("id", appointmentId);
    expect(readTokenError?.code).toBe("42501");

    const { error: updateCustomerIdError } = await designerClient
      .from("appointments")
      .update({ customer_id: null })
      .eq("id", randomUUID());
    expect(updateCustomerIdError?.code).toBe("42501");

    // 後台實際用到的欄位仍可讀（嵌入 services 需要 service_id 的 select 授權）。
    const { data: readable, error: readableError } = await designerClient
      .from("appointments")
      .select("id, customer_name, customer_phone, start_at, end_at, status, services(name)")
      .eq("id", appointmentId)
      .single();
    expect(readableError).toBeNull();
    expect(readable?.id).toBe(appointmentId);
  });

  it("非管理員 authenticated 讀不到 appointments（RLS 回空陣列）", async () => {
    const { data, error } = await nonAdminClient.from("appointments").select("id").eq("id", appointmentId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("非管理員 authenticated 改不動 appointments（RLS 回空陣列，資料不變）", async () => {
    const { data, error } = await nonAdminClient
      .from("appointments")
      .update({ status: "cancelled" })
      .eq("id", appointmentId)
      .select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { data: after, error: refetchError } = await serviceRoleClient
      .from("appointments")
      .select("status")
      .eq("id", appointmentId)
      .single();
    if (refetchError) throw refetchError;
    expect(after.status).not.toBe("cancelled");
  });

  it("非管理員 authenticated 對 appointments 的 insert／delete、對 customers／admins 的 select 在權限層就被拒（42501）", async () => {
    const { error: insertError } = await nonAdminClient.from("appointments").insert({
      service_id: serviceId,
      customer_name: `${MARKER} nonadmin-insert-should-fail`,
      start_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
      end_at: new Date(Date.now() + 270 * 60 * 1000).toISOString(),
    });
    expect(insertError?.code).toBe("42501");

    const { error: deleteError } = await nonAdminClient.from("appointments").delete().eq("id", appointmentId);
    expect(deleteError?.code).toBe("42501");

    const { error: customersError } = await nonAdminClient.from("customers").select("id").limit(1);
    expect(customersError?.code).toBe("42501");

    const { error: adminsError } = await nonAdminClient.from("admins").select("user_id").limit(1);
    expect(adminsError?.code).toBe("42501");
  });
});
