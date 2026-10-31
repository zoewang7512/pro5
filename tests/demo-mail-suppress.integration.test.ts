// TASK-114（Demo 體驗帳戶）：對真實 Supabase 專案執行的整合測試，驗證 0026_demo_suppress_update_mail.sql：
// Demo 體驗帳號（JWT app_metadata.is_demo = true）改期、取消預約時，資料庫觸發器不送 webhook（不寄信）；
// 非 Demo 管理員照常寄。
//
// **這支測試會寄出一封真實信件**：非 Demo 的對照組（正向對照）改期會讓正式環境真的寄通知信到
// DEMO_MAIL_TEST_EMAIL（請填你自己的信箱）。其餘情境套用 0026 後不會寄信。
//   * 套用 0026 之後：信箱應只收到 **1 封**（主旨「預約已改期」，內文顧客名稱含 `mailsuppress-normal`）。
//   * 套用 0026 之前（基準線，證明鑑別力）：會收到 **3 封**（多出 `mailsuppress-demo` 的改期與取消通知）。
// 測試本身只能驗證「預約資料照常改期／取消成功」；webhook 有沒有送出，要看信箱（或用
// ai/artifacts/Demo 體驗帳戶/verification/TASK-114-verify.sql 在資料庫內直接數 pg_net 佇列，那份不會寄信）。
//
// 正向對照後會等待約 25 秒，讓非同步的 webhook 在預約被清理前處理完。
// 不放進預設 `npm test`，只透過 `npm run test:demo-mail-suppress` 執行（缺設定時直接噴錯，不略過）。
// 所有資料都是拋棄式：服務、設計師、預約都用 `__TEST__` 前綴，帳號用 app_metadata.mailsuppress_test 標記，
// 結尾（與開頭）依標記清除；登出只用 scope: "local"，不碰 designer001 與任何真實資料。
//
// 注意：測試期間系統內會暫時多一個 is_demo 帳戶，此時 Demo 還原函式（0024）等會因「不是剛好 1 個 Demo 帳戶」
// 而拒絕執行；請避開台北 03:00–04:00，以及不要在已有真實 Demo 帳戶且排程還原開啟時跑。
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupTestDesigners, createTestDesigner } from "./helpers/designer-fixture";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const mailTo = process.env.DEMO_MAIL_TEST_EMAIL;

if (!url || !anonKey || !serviceRoleKey || !mailTo) {
  throw new Error(
    "[demo-mail-suppress.integration.test] 缺少 NEXT_PUBLIC_SUPABASE_URL／NEXT_PUBLIC_SUPABASE_ANON_KEY／" +
      "SUPABASE_SERVICE_ROLE_KEY，或沒有設定 DEMO_MAIL_TEST_EMAIL（你自己的信箱；測試會寄 1 封真實信件到這裡）。",
  );
}

const clientOptions = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(url, serviceRoleKey, clientOptions);
const TEST_MARKER = `__TEST__mailsuppress-${Date.now()}`;

type TestUser = { id: string; client: SupabaseClient };

async function listTestUsers() {
  const found = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`列出使用者失敗：${error.message}`);
    found.push(...data.users);
    if (data.users.length < 200) break;
  }
  return found.filter((u) => u.app_metadata?.mailsuppress_test === true && u.email?.includes("mailsuppress"));
}

async function createAdminUser(kind: "demo" | "normal"): Promise<TestUser> {
  const email = `delivered+mailsuppress-${kind}-${randomUUID().slice(0, 8)}@resend.dev`;
  const password = `${randomUUID()}${randomUUID().slice(0, 8)}aA1!`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: kind === "demo" ? { mailsuppress_test: true, is_demo: true } : { mailsuppress_test: true },
    user_metadata: { name: `__TEST__mailsuppress-${kind}` },
  });
  if (error || !data.user) throw new Error(`建立 ${kind} 拋棄式帳號失敗：${error?.message ?? "沒有回傳使用者"}`);
  const { error: regError } = await admin.from("admins").insert({ user_id: data.user.id });
  if (regError) throw new Error(`登記 ${kind} 進 admins 失敗：${regError.message}`);
  const client = createClient(url!, anonKey!, clientOptions);
  const { data: signIn, error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError || !signIn.session) throw new Error(`登入 ${kind} 失敗：${signInError?.message ?? "沒有 session"}`);
  // JWT 內必須帶著（或不帶）is_demo，否則整個測試沒有意義。
  const claims = JSON.parse(Buffer.from(signIn.session.access_token.split(".")[1], "base64url").toString("utf8"));
  expect(claims.app_metadata?.is_demo === true, `${kind} 的 JWT is_demo 不符預期`).toBe(kind === "demo");
  return { id: data.user.id, client };
}

async function cleanupUsers() {
  const failures: string[] = [];
  for (const user of await listTestUsers()) {
    const { error: adminsError } = await admin.from("admins").delete().eq("user_id", user.id);
    if (adminsError) failures.push(`admins ${user.id}：${adminsError.message}`);
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) failures.push(`${user.id}：${error.message}`);
  }
  if (failures.length > 0) throw new Error(`清除拋棄式帳號失敗：${failures.join("；")}`);
  const leftover = await listTestUsers();
  if (leftover.length > 0) throw new Error(`清除後仍殘留 ${leftover.length} 個拋棄式帳號`);
}

describe("Demo 發動的改期／取消不寄信（0026，真實 Supabase 專案）", () => {
  let serviceId: string;
  let designerId: string;
  let demo: TestUser;
  let normal: TestUser;

  // 離現在 60 天以上的深夜整點，彼此錯開，避免撞到 appointments_no_overlap 或真實預約。
  const slot = (dayOffset: number, hour: number) => {
    const d = new Date(Date.now() + dayOffset * 24 * 3600 * 1000);
    d.setUTCHours(hour, 0, 0, 0);
    return d;
  };
  const iso = (d: Date) => d.toISOString();
  const plusHour = (d: Date, h: number) => new Date(d.getTime() + h * 3600 * 1000);

  // 一律先 customer_email: null 建立，再用「只改 email」的獨立 UPDATE 補上（不滿足任何觸發條件），
  // 避免 INSERT 觸發確認信（見 feedback：整合測試小心真實 DB trigger）。
  async function insertAppointment(label: string, start: Date): Promise<string> {
    const { data, error } = await admin
      .from("appointments")
      .insert({
        service_id: serviceId,
        designer_id: designerId,
        customer_name: `${TEST_MARKER} ${label}`,
        customer_phone: `09${String(Date.now() % 100_000).padStart(5, "0")}${String(Math.floor(Math.random() * 1000)).padStart(3, "0")}`,
        customer_email: null,
        start_at: iso(start),
        end_at: iso(plusHour(start, 1)),
        status: "confirmed",
      })
      .select("id")
      .single();
    if (error) throw error;
    const { error: emailError } = await admin.from("appointments").update({ customer_email: mailTo }).eq("id", data.id);
    if (emailError) throw emailError;
    return data.id;
  }

  async function fetchRow(id: string) {
    const { data, error } = await admin.from("appointments").select("status, start_at, end_at").eq("id", id).single();
    if (error) throw error;
    return data;
  }

  beforeAll(async () => {
    await cleanupUsers(); // 清掉先前中斷留下的殘留
    const { data: service, error } = await admin
      .from("services")
      .insert({ name: `${TEST_MARKER} service`, price: 100, duration_minutes: 60, is_active: false })
      .select("id")
      .single();
    if (error) throw error;
    serviceId = service.id;
    designerId = (await createTestDesigner(admin, { tag: "mailsp", serviceIds: [serviceId] })).id;
    demo = await createAdminUser("demo");
    normal = await createAdminUser("normal");
  }, 120000);

  afterAll(async () => {
    const errors: unknown[] = [];
    for (const user of [demo, normal]) await user?.client.auth.signOut({ scope: "local" });
    try {
      await cleanupUsers();
    } catch (e) {
      errors.push(e);
    }
    if (serviceId) {
      const { error } = await admin.from("appointments").delete().eq("service_id", serviceId);
      if (error) errors.push(error);
      try {
        if (designerId) await cleanupTestDesigners(admin, [designerId]);
      } catch (e) {
        errors.push(e);
      }
      const { error: serviceError } = await admin.from("services").delete().eq("id", serviceId);
      if (serviceError) errors.push(serviceError);
    }
    if (errors.length > 0) throw new Error(`afterAll 清除失敗，殘留測試資料：${JSON.stringify(errors)}`);
  }, 120000);

  it("Demo 改期：預約資料照常更新（套用 0026 後不寄信）", async () => {
    const start = slot(61, 20);
    const id = await insertAppointment("mailsuppress-demo reschedule", start);
    const newStart = plusHour(start, 2);

    const { data, error } = await demo.client
      .from("appointments")
      .update({ start_at: iso(newStart), end_at: iso(plusHour(newStart, 1)) })
      .eq("id", id)
      .select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(new Date((await fetchRow(id)).start_at).getTime()).toBe(newStart.getTime());
  });

  it("Demo 取消：預約資料照常更新為 cancelled（套用 0026 後不寄信）", async () => {
    const id = await insertAppointment("mailsuppress-demo cancel", slot(62, 20));

    const { data, error } = await demo.client.from("appointments").update({ status: "cancelled" }).eq("id", id).select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect((await fetchRow(id)).status).toBe("cancelled");
  });

  it("非 Demo 管理員改期（正向對照）：預約資料更新，並會寄出 1 封真實通知信到 DEMO_MAIL_TEST_EMAIL", async () => {
    const start = slot(63, 20);
    const id = await insertAppointment("mailsuppress-normal reschedule", start);
    const newStart = plusHour(start, 2);

    const { data, error } = await normal.client
      .from("appointments")
      .update({ start_at: iso(newStart), end_at: iso(plusHour(newStart, 1)) })
      .eq("id", id)
      .select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(new Date((await fetchRow(id)).start_at).getTime()).toBe(newStart.getTime());

    // pg_net 非同步送出 webhook，正式環境收到後會依 id 讀回這筆預約再寄信。若立刻進 afterAll 把預約刪掉，
    // webhook 會因找不到預約而回 200 卻不寄信（第一次執行就是這樣：Vercel 收到請求、信箱沒收到）。
    // 所以等 webhook 處理完再清理；等待時間只影響這支手動執行的整合測試。
    await new Promise((resolve) => setTimeout(resolve, 25_000));
  }, 90_000);
});
