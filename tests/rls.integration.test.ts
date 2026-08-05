// 對真實 Supabase 專案執行的整合測試，驗證 TASK-003 的 RLS 邊界。
// 不放進預設 `npm test`（見 vitest.config.ts 的 include 設定），只透過
// `npm run test:rls` 執行——這個檔案不會在其他情境下被跑到，所以缺設定時
// 直接噴錯而非略過，避免「忘了填 .env.local 卻顯示測試通過」的誤導。
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
        start_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        end_at: new Date(Date.now() + 90 * 60 * 1000).toISOString(),
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

  it("anon 讀不到 appointments 表任何資料", async () => {
    const { data, error } = await anonClient.from("appointments").select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("anon 讀不到 customers 表任何資料", async () => {
    const { data, error } = await anonClient.from("customers").select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

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

    expect(error).not.toBeNull();

    const { data: shouldNotExist, error: fetchError } = await serviceRoleClient
      .from("appointments")
      .select("id")
      .eq("customer_email", `${TEST_MARKER}@example.invalid`);
    expect(fetchError).toBeNull();
    expect(shouldNotExist).toEqual([]);
  });

  it("設計師帳密登入後可讀取 appointments 與 customers 全部資料", async () => {
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

    const { error: customersError } = await designerClient.from("customers").select("id").limit(1);
    expect(customersError).toBeNull();

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
