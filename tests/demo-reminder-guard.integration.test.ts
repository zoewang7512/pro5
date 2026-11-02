// TASK-121（Demo 體驗帳戶）：對真實 Supabase 專案執行的整合測試，驗證 0031_demo_reminder_guard.sql：
// Demo 體驗帳號（JWT app_metadata.is_demo = true）動過的預約，reminder_sent_at 不會被清成 null，所以每日提醒排程撈不到它；
// 一般管理員、service role（cron 的 claim／release）、以及只在 user_metadata 偽裝 is_demo 的帳號行為不變。
//
// **不會寄出任何信件，也不會動到真實預約：**
//   * 提醒排程的「挑選條件」在這裡以自己的 UPDATE 重現（同 lib/admin/appointment-reminders.ts claimAppointmentsForReminder 的謂詞），
//     並加上 id 限定只作用在本測試的拋棄式預約；**不呼叫排程端點，也不呼叫 claimAppointmentsForReminder**（它沒有 id 限定，會佔走真實預約的提醒額度）。
//     謂詞與正式程式碼的對應由 tests/lib/demo-reminder-guard-migration.test.ts 的「缺口來源形狀」檢查把關。
//   * 預約一律先以 customer_email: null 建立，再用「只改 email／reminder_sent_at」的獨立 UPDATE 補上（不滿足 0012 的 WHEN，不送 webhook）。
//   * 有 Email 的預約只用於 Demo 的情境（0026 之後 Demo 的改期不送 webhook），Email 是 Resend 的測試信箱 delivered+…@resend.dev；
//     非 Demo 的改期情境一律不帶 Email（否則會經由 0012 寄出通知信）。
//
// 不放進預設 `npm test`，只透過 `npm run test:demo-reminder-guard` 執行（缺設定時直接噴錯，不略過）。
// 所有資料都是拋棄式：服務、設計師、預約都用 `__TEST__` 前綴，帳號用 app_metadata.reminderguard_test 標記，
// 結尾（與開頭）依標記清除並確認沒有本測試的預約殘留；登出只用 scope: "local"（拋棄式帳號直接刪除），不碰 designer001 與任何真實資料。
//
// **前置依賴 0026**：Demo 有 Email 的改期／取消會經過 0012 的 UPDATE webhook，靠 0026 抑制；若 0026 未套用，信會寄到
// Resend 測試信箱 delivered+…@resend.dev（不會到真人）。
// 若測試被強制中止（Ctrl-C），拋棄式 is_demo 帳號會殘留到下次執行（開頭會清）；殘留期間每日還原會因「不是剛好 1 個 Demo」而拒絕，請盡快重跑一次。
//
// 注意：測試期間系統內會暫時多一個 is_demo 帳戶，此時 Demo 還原函式／demo_revoke_sessions／upload-demo-images 會因
// 「不是剛好 1 個 Demo 帳戶」而拒絕執行；開啟排程還原後，請避開台北 03:00–04:00 跑 test:*。
//
// 兩種模式（驗收標準：套用 _down.sql 後行為恢復）：
//   預設（守門生效中，套用 0031 之後）：npm run test:demo-reminder-guard
//   套用 0031 之前，或套用 _down.sql 之後：
//     PowerShell  $env:DEMO_REMINDER_GUARD_EXPECT="off"; npm run test:demo-reminder-guard
//     Bash        DEMO_REMINDER_GUARD_EXPECT=off npm run test:demo-reminder-guard
//   off 模式下：Demo 改期會把 reminder_sent_at 清成 null，排程撈得到（這就是缺口）。
//   鑑別力：每個「生效中被擋」的斷言在 off 模式都有對應的「沒被擋」斷言。
//
// 限流提醒：每輪 3 次密碼登入，Supabase 預設每 IP 每 5 分鐘 30 次。
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupTestDesigners, createTestDesigner } from "./helpers/designer-fixture";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceRoleKey) {
  throw new Error(
    "[demo-reminder-guard.integration.test] 缺少 NEXT_PUBLIC_SUPABASE_URL／NEXT_PUBLIC_SUPABASE_ANON_KEY／" +
      "SUPABASE_SERVICE_ROLE_KEY，請確認 .env.local 已填妥。",
  );
}

const guardActive = process.env.DEMO_REMINDER_GUARD_EXPECT !== "off";
const clientOptions = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(url, serviceRoleKey, clientOptions);
const TEST_MARKER = `__TEST__reminderguard-${Date.now()}`;
// 起始的「已提醒」時間：固定的過去時間，方便判斷是否被改動。
const REMINDED_AT = "2026-01-01T00:00:00.000Z";

type Kind = "demo" | "normal" | "spoof";
type TestUser = { id: string; client: SupabaseClient };

async function listTestUsers() {
  const found = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`列出使用者失敗：${error.message}`);
    found.push(...data.users);
    if (data.users.length < 200) break;
  }
  return found.filter((u) => u.app_metadata?.reminderguard_test === true && u.email?.includes("reminderguard"));
}

async function createAdminUser(kind: Kind): Promise<TestUser> {
  const email = `delivered+reminderguard-${kind}-${randomUUID().slice(0, 8)}@resend.dev`;
  const password = `${randomUUID()}${randomUUID().slice(0, 8)}aA1!`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    // spoof：只在使用者可自行改寫的 user_metadata 放 is_demo，app_metadata 沒有——必須不被當成 Demo。
    app_metadata: kind === "demo" ? { reminderguard_test: true, is_demo: true } : { reminderguard_test: true },
    user_metadata: kind === "spoof" ? { name: "__TEST__reminderguard-spoof", is_demo: true } : { name: `__TEST__reminderguard-${kind}` },
  });
  if (error || !data.user) throw new Error(`建立 ${kind} 拋棄式帳號失敗：${error?.message ?? "沒有回傳使用者"}`);
  const { error: regError } = await admin.from("admins").insert({ user_id: data.user.id });
  if (regError) throw new Error(`登記 ${kind} 進 admins 失敗：${regError.message}`);
  const client = createClient(url!, anonKey!, clientOptions);
  const { data: signIn, error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError || !signIn.session) throw new Error(`登入 ${kind} 失敗：${signInError?.message ?? "沒有 session"}`);
  // JWT 內必須帶著（或不帶）is_demo，否則整個測試沒有意義。
  const claims = JSON.parse(Buffer.from(signIn.session.access_token.split(".")[1], "base64url").toString("utf8"));
  expect(claims.app_metadata?.is_demo === true, `${kind} 的 JWT app_metadata.is_demo 不符預期`).toBe(kind === "demo");
  if (kind === "spoof") expect(claims.user_metadata?.is_demo, "spoof 的 JWT 應只在 user_metadata 帶 is_demo").toBe(true);
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

async function countAppointments(): Promise<number> {
  const { count, error } = await admin.from("appointments").select("*", { count: "exact", head: true });
  if (error || count === null) throw new Error(`計數 appointments 失敗：${error?.message ?? "沒有回傳筆數"}`);
  return count;
}

// LIKE 的底線是萬用字元，跳脫後才不會多算名稱剛好吻合的真實資料。
const MARKER_LIKE = "\\_\\_TEST\\_\\_reminderguard-%";

async function countMarkedAppointments(): Promise<number> {
  const { count, error } = await admin.from("appointments").select("*", { count: "exact", head: true }).like("customer_name", MARKER_LIKE);
  if (error || count === null) throw new Error(`計數本測試預約失敗：${error?.message ?? "沒有回傳筆數"}`);
  return count;
}

describe("Demo 動過的預約視為已提醒（0031，真實 Supabase 專案）", () => {
  let serviceId: string;
  let designerId: string;
  let demo: TestUser;
  let normal: TestUser;
  let spoof: TestUser;
  let baselineAppointments = 0;
  const createdIds: string[] = [];

  // 離現在 60 天以上的深夜整點，各情境用不同日期，避免撞到 appointments_no_overlap 或真實預約。
  const slot = (dayOffset: number, hour: number) => {
    const d = new Date(Date.now() + dayOffset * 24 * 3600 * 1000);
    d.setUTCHours(hour, 0, 0, 0);
    return d;
  };
  const iso = (d: Date) => d.toISOString();
  const plusHour = (d: Date, h: number) => new Date(d.getTime() + h * 3600 * 1000);

  // 一律先 customer_email: null 建立，再用只改 email／reminder_sent_at 的獨立 UPDATE 補上。
  async function insertAppointment(
    label: string,
    start: Date,
    opts: { email: string | null; remindedAt: string | null },
  ): Promise<string> {
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
    createdIds.push(data.id);
    const patch: Record<string, unknown> = {};
    if (opts.email) patch.customer_email = opts.email;
    if (opts.remindedAt) patch.reminder_sent_at = opts.remindedAt;
    if (Object.keys(patch).length > 0) {
      const { error: patchError } = await admin.from("appointments").update(patch).eq("id", data.id);
      if (patchError) throw patchError;
    }
    return data.id;
  }

  const sinkEmail = () => `delivered+reminderguard-victim-${randomUUID().slice(0, 8)}@resend.dev`;

  async function fetchRow(id: string) {
    const { data, error } = await admin.from("appointments").select("status, start_at, end_at, reminder_sent_at").eq("id", id).single();
    if (error) throw error;
    return data;
  }

  // 與 lib/admin/appointment-reminders.ts claimAppointmentsForReminder 相同的挑選條件（窗口、狀態、reminder_sent_at 為 null），
  // 加上 id 限定。回傳「被排程挑中」的筆數。
  async function claimLikeCron(id: string, windowFrom: Date, windowTo: Date): Promise<number> {
    const { data, error } = await admin
      .from("appointments")
      .update({ reminder_sent_at: new Date().toISOString() })
      .eq("id", id)
      .gte("start_at", iso(windowFrom))
      .lt("start_at", iso(windowTo))
      .in("status", ["pending", "confirmed"])
      .is("reminder_sent_at", null)
      .select("id");
    if (error) throw error;
    return data?.length ?? 0;
  }

  // 與 rescheduleAppointment 相同的 payload：改時間並把 reminder_sent_at 設回 null。
  function rescheduleAs(user: TestUser, id: string, newStart: Date) {
    return user.client
      .from("appointments")
      .update({ start_at: iso(newStart), end_at: iso(plusHour(newStart, 1)), reminder_sent_at: null })
      .eq("id", id)
      .select("id");
  }

  beforeAll(async () => {
    await cleanupUsers(); // 清掉先前中斷（Ctrl-C）留下的殘留帳號
    // 先前中斷留下的本測試預約（名稱以 __TEST__reminderguard- 開頭）一併清掉；服務與設計師的殘留不在此處理（沒有辨識外鍵安全的做法）。
    const { error: sweepError } = await admin.from("appointments").delete().like("customer_name", MARKER_LIKE);
    if (sweepError) throw new Error(`清除先前殘留的測試預約失敗：${sweepError.message}`);
    baselineAppointments = await countAppointments();
    const { data: service, error } = await admin
      .from("services")
      .insert({ name: `${TEST_MARKER} service`, price: 100, duration_minutes: 60, is_active: false })
      .select("id")
      .single();
    if (error) throw error;
    serviceId = service.id;
    designerId = (await createTestDesigner(admin, { tag: "remguard", serviceIds: [serviceId] })).id;
    demo = await createAdminUser("demo");
    normal = await createAdminUser("normal");
    spoof = await createAdminUser("spoof");
    console.info(`[demo-reminder-guard] 模式：${guardActive ? "守門生效中（預設）" : "off（無守門，基準線）"}；開始時預約 ${baselineAppointments} 筆`);
  }, 120000);

  afterAll(async () => {
    const errors: unknown[] = [];
    for (const user of [demo, normal, spoof]) await user?.client.auth.signOut({ scope: "local" });
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
    try {
      // 不比對總數：測試期間若有真實顧客預約或排程還原，總數會變動而誤報。改為確認沒有任何本測試的資料殘留，總數只印出供對照。
      expect(await countMarkedAppointments(), "結尾不得殘留本測試的預約").toBe(0);
      console.info(`[demo-reminder-guard] 預約總數：開始 ${baselineAppointments} 筆、結束 ${await countAppointments()} 筆`);
    } catch (e) {
      errors.push(e);
    }
    if (errors.length > 0) throw new Error(`afterAll 清除失敗，殘留測試資料：${JSON.stringify(errors, Object.getOwnPropertyNames)}`);
  }, 120000);

  it("Demo 改期一筆已提醒過、有 Email 的預約：改期成功，reminder_sent_at 不被清成 null", async () => {
    const start = slot(61, 20);
    const id = await insertAppointment("demo reschedule reminded", start, { email: sinkEmail(), remindedAt: REMINDED_AT });
    const newStart = plusHour(start, 2);

    const { data, error } = await rescheduleAs(demo, id, newStart);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);

    const row = await fetchRow(id);
    expect(new Date(row.start_at).getTime(), "改期本身照常成功").toBe(newStart.getTime());
    if (guardActive) {
      expect(row.reminder_sent_at).not.toBeNull();
      expect(new Date(row.reminder_sent_at!).toISOString()).toBe(REMINDED_AT);
    } else {
      expect(row.reminder_sent_at, "off 模式（無守門）：被清成 null").toBeNull();
    }
  });

  it("Demo 改期一筆從未提醒過、有 Email 的預約：被標成已提醒，提醒排程的挑選條件撈不到它", async () => {
    const start = slot(62, 20);
    const id = await insertAppointment("demo reschedule never reminded", start, { email: sinkEmail(), remindedAt: null });
    const newStart = plusHour(start, 2);

    const { data, error } = await rescheduleAs(demo, id, newStart);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);

    const row = await fetchRow(id);
    const claimed = await claimLikeCron(id, plusHour(start, -1), plusHour(start, 5));
    if (guardActive) {
      expect(row.reminder_sent_at, "被標成已提醒（非 null）").not.toBeNull();
      expect(claimed, "排程撈不到").toBe(0);
    } else {
      expect(row.reminder_sent_at).toBeNull();
      expect(claimed, "off 模式（無守門）：排程撈得到，隔天會對這個 Email 寄提醒信（缺口）").toBe(1);
    }
  });

  it("Demo 直接把 reminder_sent_at 設成 null：無效（維持原值）", async () => {
    const id = await insertAppointment("demo direct clear", slot(63, 20), { email: sinkEmail(), remindedAt: REMINDED_AT });

    const { data, error } = await demo.client.from("appointments").update({ reminder_sent_at: null }).eq("id", id).select("id");
    expect(error).toBeNull();
    expect(data, "更新確實作用在這一列（不是被 RLS 靜默擋掉而空轉）").toHaveLength(1);

    const row = await fetchRow(id);
    if (guardActive) {
      expect(row.reminder_sent_at, "不得被清成 null").not.toBeNull();
      expect(new Date(row.reminder_sent_at!).toISOString()).toBe(REMINDED_AT);
    } else {
      expect(row.reminder_sent_at).toBeNull();
    }
  });

  it("Demo 只改狀態（取消）：預約照常取消，並被標成已提醒（已接受的副作用）", async () => {
    const id = await insertAppointment("demo cancel", slot(64, 20), { email: sinkEmail(), remindedAt: null });

    const { data, error } = await demo.client.from("appointments").update({ status: "cancelled" }).eq("id", id).select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);

    const row = await fetchRow(id);
    expect(row.status).toBe("cancelled");
    if (guardActive) expect(row.reminder_sent_at).not.toBeNull();
    else expect(row.reminder_sent_at).toBeNull();
  });

  it("一般管理員改期：reminder_sent_at 照常清成 null，排程撈得到（提醒功能不受影響，與模式無關）", async () => {
    const start = slot(65, 20);
    const id = await insertAppointment("normal reschedule", start, { email: null, remindedAt: REMINDED_AT });

    const { data, error } = await rescheduleAs(normal, id, plusHour(start, 2));
    expect(error).toBeNull();
    expect(data).toHaveLength(1);

    expect((await fetchRow(id)).reminder_sent_at).toBeNull();
    expect(await claimLikeCron(id, plusHour(start, -1), plusHour(start, 5))).toBe(1);
  });

  it("只在 user_metadata 偽裝 is_demo 的管理員：不被當成 Demo，改期照常清成 null（與模式無關）", async () => {
    const start = slot(66, 20);
    const id = await insertAppointment("spoof reschedule", start, { email: null, remindedAt: REMINDED_AT });

    const { data, error } = await rescheduleAs(spoof, id, plusHour(start, 2));
    expect(error).toBeNull();
    expect(data).toHaveLength(1);

    expect((await fetchRow(id)).reminder_sent_at).toBeNull();
  });

  it("觸發器賴以完整的權限前提（與模式無關）：Demo 不能新增預約、不能改收件人 Email／姓名（42501）", async () => {
    const id = await insertAppointment("demo grants", slot(68, 20), { email: sinkEmail(), remindedAt: REMINDED_AT });

    // 只掛 BEFORE UPDATE 的觸發器管不到 INSERT／upsert；收件人若可被改，守門也失去意義。權限若被放寬，這裡會失敗。
    const attacker = sinkEmail();
    const changeEmail = await demo.client.from("appointments").update({ customer_email: attacker }).eq("id", id).select("id");
    expect(changeEmail.error?.code, "改 customer_email").toBe("42501");
    const changeName = await demo.client.from("appointments").update({ customer_name: `${TEST_MARKER} renamed` }).eq("id", id).select("id");
    expect(changeName.error?.code, "改 customer_name").toBe("42501");
    const insert = await demo.client
      .from("appointments")
      .insert({
        service_id: serviceId,
        designer_id: designerId,
        customer_name: `${TEST_MARKER} direct insert`,
        customer_phone: "0912345678",
        customer_email: attacker,
        start_at: iso(slot(69, 20)),
        end_at: iso(plusHour(slot(69, 20), 1)),
        status: "confirmed",
      })
      .select("id");
    expect(insert.error?.code, "直接 INSERT／upsert").toBe("42501");
    expect(insert.data ?? []).toHaveLength(0);
    expect((await fetchRow(id)).reminder_sent_at, "原值未動").not.toBeNull();
  });

  it("service role（cron 的 claim／release）：行為不變——claim 設為非 null，release 清回 null（與模式無關）", async () => {
    const start = slot(67, 20);
    const id = await insertAppointment("cron claim release", start, { email: null, remindedAt: null });

    expect(await claimLikeCron(id, plusHour(start, -1), plusHour(start, 5))).toBe(1);
    expect((await fetchRow(id)).reminder_sent_at).not.toBeNull();

    const { error } = await admin.from("appointments").update({ reminder_sent_at: null }).eq("id", id);
    expect(error).toBeNull();
    expect((await fetchRow(id)).reminder_sent_at).toBeNull();
  });
});
