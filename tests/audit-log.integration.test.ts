// 對真實 Supabase 專案執行的整合測試，驗證 TASK-084（0019_audit_log）的權限矩陣。
// 不放進預設 `npm test`，只透過 `npm run test:audit-log` 執行；缺設定時直接噴錯而非略過，
// 避免「忘了填 .env.local 卻顯示測試通過」的誤導。
// 測試資料的 summary 一律帶 `__TEST__`，由 afterAll 以 service_role 刪除；
// 漏網之魚可用 `npm run sweep:audit-test-rows` 清掃。
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listAuditLog, recordAdminAction } from "../lib/admin/audit-log";
import { cancelAppointment, markAppointmentCompleted, rescheduleAppointment } from "../lib/admin/appointments";
import { addClosedDate, removeClosedDate } from "../lib/admin/closed-dates";
import {
  addDesignerLeave,
  removeDesignerLeave,
  setDesignerActive,
  setDesignerService,
  updateDesignerBasicInfo,
} from "../lib/admin/designers";
import { createService, setServiceActive, updateService } from "../lib/admin/services";
import { cleanupTestDesigners, createTestDesigner } from "./helpers/designer-fixture";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const designerEmail = process.env.DESIGNER_EMAIL;
const designerPassword = process.env.DESIGNER_PASSWORD;

if (!url || !anonKey || !serviceRoleKey || !designerEmail || !designerPassword) {
  throw new Error(
    "[audit-log.integration.test] 缺少 Supabase 專案設定或 DESIGNER_EMAIL/DESIGNER_PASSWORD，" +
      "請確認 .env.local 已填妥並已執行 npm run seed:designer。",
  );
}

const MARKER = `__TEST__audit-${Date.now()}`;
const PERMISSION_DENIED = "42501";

function newClient(key: string): SupabaseClient {
  return createClient(url!, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

// 一筆最小的合法紀錄（service.activated 的 summary 只有 service_name）。
function sampleRow(label: string) {
  return {
    event_type: "service.activated",
    entity_type: "service",
    entity_id: `${MARKER}-${label}`,
    summary: { service_name: `${MARKER} ${label}` },
    changes: {},
  };
}

describe("audit_log 權限矩陣（真實 Supabase 專案）", () => {
  let serviceRoleClient: SupabaseClient;
  let anonClient: SupabaseClient;
  let adminClient: SupabaseClient;
  let nonAdminClient: SupabaseClient;
  let adminUserId: string;
  let nonAdminUserId: string | undefined;
  // 店長建立、供各案例共用的一筆基準紀錄。
  let baselineId: number;

  beforeAll(async () => {
    serviceRoleClient = newClient(serviceRoleKey!);
    anonClient = newClient(anonKey!);

    adminClient = newClient(anonKey!);
    const { data: adminSignIn, error: adminSignInError } = await adminClient.auth.signInWithPassword({
      email: designerEmail!,
      password: designerPassword!,
    });
    if (adminSignInError) throw adminSignInError;
    adminUserId = adminSignIn.user!.id;

    const nonAdminEmail = `${MARKER}-nonadmin@example.invalid`;
    const nonAdminPassword = `${randomUUID()}Aa1!`;
    const { data: created, error: createError } = await serviceRoleClient.auth.admin.createUser({
      email: nonAdminEmail,
      password: nonAdminPassword,
      email_confirm: true,
    });
    if (createError) throw createError;
    nonAdminUserId = created.user.id;

    nonAdminClient = newClient(anonKey!);
    const { error: nonAdminSignInError } = await nonAdminClient.auth.signInWithPassword({
      email: nonAdminEmail,
      password: nonAdminPassword,
    });
    if (nonAdminSignInError) throw nonAdminSignInError;

    const { data: baseline, error: baselineError } = await adminClient
      .from("audit_log")
      .insert(sampleRow("baseline"))
      .select("id")
      .single();
    if (baselineError) throw baselineError;
    baselineId = baseline.id;
  }, 60000);

  afterAll(async () => {
    const errors: unknown[] = [];
    await adminClient?.auth.signOut();
    await nonAdminClient?.auth.signOut();
    if (serviceRoleClient) {
      const { data: rows, error: selectError } = await serviceRoleClient
        .from("audit_log")
        .select("id, summary");
      if (selectError) errors.push(selectError);
      // 以內容比對 MARKER（PostgREST 無法對 jsonb 轉型後 like），只刪本次測試產生的列。
      const ids = (rows ?? []).filter((row) => JSON.stringify(row.summary).includes(MARKER)).map((row) => row.id);
      if (ids.length > 0) {
        const { error } = await serviceRoleClient.from("audit_log").delete().in("id", ids);
        if (error) errors.push(error);
      }
      if (nonAdminUserId) {
        const { error } = await serviceRoleClient.auth.admin.deleteUser(nonAdminUserId);
        if (error) errors.push(error);
      }
    }
    if (errors.length > 0) throw errors[0];
  }, 60000);

  describe("anon：沒有任何權限", () => {
    it("select 被拒（42501）", async () => {
      const { error } = await anonClient.from("audit_log").select("id").limit(1);
      expect(error?.code).toBe(PERMISSION_DENIED);
    });

    it("insert 被拒（42501）", async () => {
      const { error } = await anonClient.from("audit_log").insert(sampleRow("anon-insert"));
      expect(error?.code).toBe(PERMISSION_DENIED);
    });

    it("update 被拒（42501）", async () => {
      const { error } = await anonClient.from("audit_log").update({ summary: {} }).eq("id", baselineId);
      expect(error?.code).toBe(PERMISSION_DENIED);
    });

    it("delete 被拒（42501）", async () => {
      const { error } = await anonClient.from("audit_log").delete().eq("id", baselineId);
      expect(error?.code).toBe(PERMISSION_DENIED);
    });
  });

  describe("非店長登入者：RLS 讓他讀不到、寫不進", () => {
    it("底下確實有列（service_role 看得到基準紀錄）", async () => {
      const { data, error } = await serviceRoleClient.from("audit_log").select("id").eq("id", baselineId);
      expect(error).toBeNull();
      expect(data).toEqual([{ id: baselineId }]);
    });

    it("select 回空陣列（不是錯誤）", async () => {
      const { data, error } = await nonAdminClient.from("audit_log").select("id").eq("id", baselineId);
      expect(error).toBeNull();
      expect(data).toEqual([]);

      const { data: all, error: allError } = await nonAdminClient.from("audit_log").select("id").limit(5);
      expect(allError).toBeNull();
      expect(all).toEqual([]);
    });

    it("insert 被拒（RLS，42501）", async () => {
      const { error } = await nonAdminClient.from("audit_log").insert(sampleRow("nonadmin-insert"));
      expect(error?.code).toBe(PERMISSION_DENIED);
    });

    it("update／delete 被拒（沒有授權，42501），基準紀錄不受影響", async () => {
      const { error: updateError } = await nonAdminClient.from("audit_log").update({ summary: {} }).eq("id", baselineId);
      expect(updateError?.code).toBe(PERMISSION_DENIED);
      const { error: deleteError } = await nonAdminClient.from("audit_log").delete().eq("id", baselineId);
      expect(deleteError?.code).toBe(PERMISSION_DENIED);

      const { data } = await serviceRoleClient.from("audit_log").select("summary").eq("id", baselineId).single();
      expect(data?.summary).toEqual({ service_name: `${MARKER} baseline` });
    });
  });

  describe("店長：可新增與讀取，不能改刪，不能指定操作者與時間", () => {
    it("insert 成功，操作者由資料庫決定（等於登入者 id），發生時間由資料庫決定", async () => {
      const before = Date.now();
      const { data, error } = await adminClient
        .from("audit_log")
        .insert(sampleRow("admin-insert"))
        .select("id, actor_id, created_at, event_type, summary, changes")
        .single();
      expect(error).toBeNull();
      expect(data?.actor_id).toBe(adminUserId);
      expect(Math.abs(new Date(data!.created_at).getTime() - before)).toBeLessThan(60_000);
      expect(data?.changes).toEqual({});
    });

    it("select 讀得到基準紀錄", async () => {
      const { data, error } = await adminClient.from("audit_log").select("id, actor_id").eq("id", baselineId);
      expect(error).toBeNull();
      expect(data).toEqual([{ id: baselineId, actor_id: adminUserId }]);
    });

    it("insert 帶 actor_id 被欄位層級授權拒絕（42501）", async () => {
      const { error } = await adminClient
        .from("audit_log")
        .insert({ ...sampleRow("admin-actor"), actor_id: randomUUID() });
      expect(error?.code).toBe(PERMISSION_DENIED);
    });

    it("insert 帶 created_at 被欄位層級授權拒絕（42501）", async () => {
      const { error } = await adminClient
        .from("audit_log")
        .insert({ ...sampleRow("admin-created"), created_at: "2000-01-01T00:00:00Z" });
      expect(error?.code).toBe(PERMISSION_DENIED);
    });

    it("insert 帶 id 被拒（generated always identity 欄位；實測回 428C9，且 id 也不在授權清單）", async () => {
      const row = sampleRow("admin-id");
      const { error } = await adminClient.from("audit_log").insert({ ...row, id: 999999999 });
      expect(["428C9", PERMISSION_DENIED]).toContain(error?.code);
      const { data } = await serviceRoleClient.from("audit_log").select("id").eq("entity_id", row.entity_id);
      expect(data).toEqual([]);
    });

    it("update 被拒（42501）", async () => {
      const { error } = await adminClient.from("audit_log").update({ summary: {} }).eq("id", baselineId);
      expect(error?.code).toBe(PERMISSION_DENIED);
    });

    it("delete 被拒（42501）", async () => {
      const { error } = await adminClient.from("audit_log").delete().eq("id", baselineId);
      expect(error?.code).toBe(PERMISSION_DENIED);
    });

    it("constraint 把關：事件代碼格式錯誤、summary 不是物件、summary 超過 4096 位元組都被資料庫拒絕", async () => {
      const bad: Record<string, unknown>[] = [
        { ...sampleRow("bad-event"), event_type: "Not-Valid" },
        { ...sampleRow("bad-entity"), entity_type: "Has Space" },
        { ...sampleRow("bad-id"), entity_id: "" },
        { ...sampleRow("bad-summary"), summary: [1, 2] },
        { ...sampleRow("big-summary"), summary: { service_name: `${MARKER} ${"x".repeat(5000)}` } },
      ];
      for (const row of bad) {
        const { error } = await adminClient.from("audit_log").insert(row);
        expect(error, JSON.stringify(row).slice(0, 80)).not.toBeNull();
        expect(error?.code).not.toBe(PERMISSION_DENIED);
      }
    });
  });

  describe("service_role：只能 select 與 delete", () => {
    it("select 成功", async () => {
      const { data, error } = await serviceRoleClient.from("audit_log").select("id").eq("id", baselineId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it("insert 被拒（42501）", async () => {
      const { error } = await serviceRoleClient.from("audit_log").insert(sampleRow("service-insert"));
      expect(error?.code).toBe(PERMISSION_DENIED);
    });

    it("update 被拒（42501）", async () => {
      const { error } = await serviceRoleClient.from("audit_log").update({ summary: {} }).eq("id", baselineId);
      expect(error?.code).toBe(PERMISSION_DENIED);
    });

    it("delete 成功（清掃用）", async () => {
      const { data: row, error: insertError } = await adminClient
        .from("audit_log")
        .insert(sampleRow("service-delete"))
        .select("id")
        .single();
      expect(insertError).toBeNull();
      const { error } = await serviceRoleClient.from("audit_log").delete().eq("id", row!.id);
      expect(error).toBeNull();
      const { data } = await serviceRoleClient.from("audit_log").select("id").eq("id", row!.id);
      expect(data).toEqual([]);
    });
  });

  describe("recordAdminAction／listAuditLog 對真實資料庫", () => {
    it("店長 client 寫入後，列表依類別篩選讀得到；非店長 client 讀到空結果", async () => {
      const appointmentEntityId = `${MARKER}-appt`;
      const settingEntityId = `${MARKER}-setting`;
      await recordAdminAction(adminClient, {
        eventType: "appointment.cancelled",
        entityType: "appointment",
        entityId: appointmentEntityId,
        summary: { service_name: `${MARKER} 剪髮`, designer_name: `${MARKER} A`, customer_name: "不該被寫入" } as never,
        changes: { status: { from: "confirmed", to: "cancelled" } },
      });
      await recordAdminAction(adminClient, {
        eventType: "service.deactivated",
        entityType: "service",
        entityId: settingEntityId,
        summary: { service_name: `${MARKER} 下架` },
      });

      const all = await listAuditLog(adminClient, { limit: 100 });
      expect(all.ok).toBe(true);
      if (!all.ok) return;
      const mine = (id: string) => all.data.rows.find((row) => row.entity_id === id);
      const appointmentRow = mine(appointmentEntityId);
      expect(appointmentRow?.event_type).toBe("appointment.cancelled");
      // 白名單過濾：顧客欄位沒有被寫進資料庫。
      expect(appointmentRow?.summary).toEqual({ service_name: `${MARKER} 剪髮`, designer_name: `${MARKER} A` });
      expect(appointmentRow?.changes).toEqual({ status: { from: "confirmed", to: "cancelled" } });
      expect(mine(settingEntityId)?.event_type).toBe("service.deactivated");

      const appointmentOnly = await listAuditLog(adminClient, { category: "appointment", limit: 100 });
      const settingsOnly = await listAuditLog(adminClient, { category: "settings", limit: 100 });
      expect(appointmentOnly.ok && settingsOnly.ok).toBe(true);
      if (!appointmentOnly.ok || !settingsOnly.ok) return;
      expect(appointmentOnly.data.rows.every((row) => row.event_type.startsWith("appointment."))).toBe(true);
      expect(appointmentOnly.data.rows.some((row) => row.entity_id === appointmentEntityId)).toBe(true);
      expect(appointmentOnly.data.rows.some((row) => row.entity_id === settingEntityId)).toBe(false);
      expect(settingsOnly.data.rows.every((row) => !row.event_type.startsWith("appointment."))).toBe(true);
      expect(settingsOnly.data.rows.some((row) => row.entity_id === settingEntityId)).toBe(true);

      const asNonAdmin = await listAuditLog(nonAdminClient, { limit: 100 });
      expect(asNonAdmin).toEqual({ ok: true, data: { rows: [], nextCursor: null } });
    });

    it("游標分頁：第二頁的 id 都小於第一頁最後一筆，且不重複", async () => {
      for (const label of ["page-1", "page-2", "page-3"]) {
        await recordAdminAction(adminClient, {
          eventType: "service.activated",
          entityType: "service",
          entityId: `${MARKER}-${label}`,
          summary: { service_name: `${MARKER} ${label}` },
        });
      }
      const first = await listAuditLog(adminClient, { limit: 2 });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(first.data.rows).toHaveLength(2);
      expect(first.data.nextCursor).toBe(String(first.data.rows[1].id));

      const second = await listAuditLog(adminClient, { limit: 2, cursor: first.data.nextCursor });
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      const firstIds = new Set(first.data.rows.map((row) => row.id));
      expect(second.data.rows.length).toBeGreaterThan(0);
      for (const row of second.data.rows) {
        expect(row.id).toBeLessThan(first.data.rows[1].id);
        expect(firstIds.has(row.id)).toBe(false);
      }
    });

    it("非店長 client 呼叫 recordAdminAction 不 throw，也寫不進資料表", async () => {
      const entityId = `${MARKER}-nonadmin-record`;
      await expect(
        recordAdminAction(nonAdminClient, {
          eventType: "service.activated",
          entityType: "service",
          entityId,
          summary: { service_name: `${MARKER} nonadmin` },
        }),
      ).resolves.toBeUndefined();
      const { data } = await serviceRoleClient.from("audit_log").select("id").eq("entity_id", entityId);
      expect(data).toEqual([]);
    });
  });
});

// TASK-085：店長以測試資料實際呼叫後台函式後，audit_log 讀得到對應事件。
// 預約規則與營業時間不在這裡呼叫（會暫時改動正式環境的設定，且 test:booking-policy／test:business-hours 已涵蓋
// 寫入函式本身）；那兩個函式的接線由 tests/admin/audit-log-wiring.test.ts 驗證。
// 清掃：本套件自己追蹤產生的 entity_id（含不帶 __TEST__ 名稱的公休日紀錄）並在 afterAll 以 service_role 刪除。
describe("後台函式留下稽核紀錄（真實 Supabase 專案）", () => {
  const TAG = `${MARKER}-wire`;
  // 3 年後，避開正式環境的真實預約；公休日用 2099 年，避開真實公休日。
  const FAR = 3 * 365 * 24 * 60 * 60 * 1000;
  const CLOSED_DATE = "2099-06-15";
  const LEAVE_DATE = "2099-06-20";

  let serviceRoleClient: SupabaseClient;
  let adminClient: SupabaseClient;
  let serviceId: string;
  let designerId: string;
  let designerName: string;
  const appointmentIds: string[] = [];
  const trackedEntityIds: string[] = [];

  async function eventsFor(entityId: string) {
    const { data, error } = await serviceRoleClient
      .from("audit_log")
      .select("event_type, entity_type, entity_id, summary, changes, actor_id")
      .eq("entity_id", entityId)
      .order("id", { ascending: true });
    expect(error).toBeNull();
    return data ?? [];
  }

  async function makeAppointment(offsetMinutes: number): Promise<{ id: string; startAt: string; endAt: string }> {
    const startAt = new Date(Date.now() + FAR + offsetMinutes * 60_000).toISOString();
    const endAt = new Date(Date.now() + FAR + (offsetMinutes + 30) * 60_000).toISOString();
    // customer_email 一律不填（null）：0012 的 Database Webhook 在 email 非 null 時才會寄信。
    const { data, error } = await serviceRoleClient
      .from("appointments")
      .insert({
        service_id: serviceId,
        designer_id: designerId,
        customer_name: `${TAG} fixture`,
        start_at: startAt,
        end_at: endAt,
      })
      .select("id")
      .single();
    if (error) throw error;
    appointmentIds.push(data.id);
    trackedEntityIds.push(data.id);
    return { id: data.id, startAt, endAt };
  }

  beforeAll(async () => {
    serviceRoleClient = newClient(serviceRoleKey!);
    adminClient = newClient(anonKey!);
    const { error } = await adminClient.auth.signInWithPassword({ email: designerEmail!, password: designerPassword! });
    if (error) throw error;

    // 服務透過 createService 建立（本身就是被測對象），再用 service_role 以名稱取回 id。
    const created = await createService(adminClient, {
      name: `${TAG} svc`,
      price: 600,
      durationMinutes: 30,
      bufferMinutes: 0,
      description: "",
    });
    expect(created.ok).toBe(true);
    const { data: svc, error: svcError } = await serviceRoleClient
      .from("services")
      .select("id")
      .eq("name", `${TAG} svc`)
      .single();
    if (svcError) throw svcError;
    serviceId = svc.id;
    trackedEntityIds.push(serviceId);

    const designer = await createTestDesigner(serviceRoleClient, { tag: "wire", serviceIds: [serviceId] });
    designerId = designer.id;
    designerName = designer.name;
    trackedEntityIds.push(designerId, `${designerId}:${serviceId}`, `${designerId}:${LEAVE_DATE}`, CLOSED_DATE);
  });

  afterAll(async () => {
    const errors: unknown[] = [];
    await adminClient?.auth.signOut();
    // 公休日若測試中途失敗可能殘留，先確實移除再清其他資料。
    await serviceRoleClient?.from("closed_dates").delete().eq("date", CLOSED_DATE);
    if (serviceRoleClient && appointmentIds.length > 0) {
      const { error } = await serviceRoleClient.from("appointments").delete().in("id", appointmentIds);
      if (error) errors.push(error);
    }
    if (serviceRoleClient && designerId) {
      try {
        await cleanupTestDesigners(serviceRoleClient, [designerId]);
      } catch (error) {
        errors.push(error);
      }
    }
    if (serviceRoleClient && serviceId) {
      const { error } = await serviceRoleClient.from("services").delete().eq("id", serviceId);
      if (error) errors.push(error);
    }
    if (serviceRoleClient) {
      const { error } = await serviceRoleClient.from("audit_log").delete().in("entity_id", trackedEntityIds);
      if (error) errors.push(error);
    }
    if (errors.length > 0) throw errors[0];
  });

  const serviceInput = (price: number, description: string) => ({
    name: `${TAG} svc`,
    price,
    durationMinutes: 30,
    bufferMinutes: 0,
    description,
  });

  it("createService／updateService／setServiceActive：留下 created／updated／deactivated 事件", async () => {
    const created = await eventsFor(serviceId);
    expect(created.map((e) => e.event_type)).toEqual(["service.created"]);
    expect(created[0].summary).toEqual({ service_name: `${TAG} svc` });
    expect(created[0].changes).toEqual({ price: { to: 600 }, duration_minutes: { to: 30 }, buffer_minutes: { to: 0 } });

    expect((await updateService(adminClient, serviceId, serviceInput(700, "x"))).ok).toBe(true);
    // 只改描述：追蹤欄位沒變，不記錄。
    expect((await updateService(adminClient, serviceId, serviceInput(700, "y"))).ok).toBe(true);
    expect((await setServiceActive(adminClient, serviceId, false)).ok).toBe(true);

    const events = await eventsFor(serviceId);
    expect(events.map((e) => e.event_type)).toEqual(["service.created", "service.updated", "service.deactivated"]);
    expect(events[1].changes).toEqual({ price: { from: 600, to: 700 } });
    expect(events[2].summary).toEqual({ service_name: `${TAG} svc` });
  });

  it("setDesignerService／addDesignerLeave／removeDesignerLeave：留下事件，重複操作不重複記錄", async () => {
    // fixture 已先對服務開啟（直接寫入，不經被測函式）：先關閉再開啟，才是兩次真實變動。
    expect((await setDesignerService(adminClient, designerId, serviceId, false)).ok).toBe(true);
    expect((await setDesignerService(adminClient, designerId, serviceId, true)).ok).toBe(true);
    // 23505：已經開啟，不記錄。
    expect((await setDesignerService(adminClient, designerId, serviceId, true)).ok).toBe(true);

    expect((await addDesignerLeave(adminClient, designerId, LEAVE_DATE)).ok).toBe(true);
    expect((await addDesignerLeave(adminClient, designerId, LEAVE_DATE)).ok).toBe(true);
    expect((await removeDesignerLeave(adminClient, designerId, LEAVE_DATE)).ok).toBe(true);

    const service = await eventsFor(`${designerId}:${serviceId}`);
    expect(service.map((e) => e.event_type)).toEqual(["designer_service.disabled", "designer_service.enabled"]);
    expect(service[0].summary).toEqual({ designer_name: designerName, service_name: `${TAG} svc` });

    const leave = await eventsFor(`${designerId}:${LEAVE_DATE}`);
    expect(leave.map((e) => e.event_type)).toEqual(["designer_leave.added", "designer_leave.removed"]);
    expect(leave[0].summary).toEqual({ designer_name: designerName, date: LEAVE_DATE });
  });

  it("預約：完成／取消／改期留下事件，摘要不含顧客個資；失敗的操作不留紀錄", async () => {
    const toComplete = await makeAppointment(0);
    const toCancel = await makeAppointment(60);
    const toMove = await makeAppointment(120);

    expect((await markAppointmentCompleted(adminClient, toComplete.id)).ok).toBe(true);
    expect((await cancelAppointment(adminClient, toCancel.id)).ok).toBe(true);
    // 已取消的預約再取消：失敗，不再記錄。
    expect((await cancelAppointment(adminClient, toCancel.id)).ok).toBe(false);
    const newStart = new Date(new Date(toMove.startAt).getTime() + 180 * 60_000).toISOString();
    const newEnd = new Date(new Date(toMove.endAt).getTime() + 180 * 60_000).toISOString();
    expect((await rescheduleAppointment(adminClient, toMove.id, toMove.startAt, newStart, newEnd)).ok).toBe(true);

    const completed = await eventsFor(toComplete.id);
    expect(completed.map((e) => e.event_type)).toEqual(["appointment.completed"]);
    expect(completed[0].changes).toEqual({ status: { from: "pending", to: "completed" } });

    const cancelled = await eventsFor(toCancel.id);
    expect(cancelled.map((e) => e.event_type)).toEqual(["appointment.cancelled"]);
    expect(cancelled[0].summary).toMatchObject({
      appointment_id: toCancel.id,
      service_name: `${TAG} svc`,
      designer_name: designerName,
    });

    const moved = await eventsFor(toMove.id);
    expect(moved.map((e) => e.event_type)).toEqual(["appointment.rescheduled"]);
    expect(Date.parse(moved[0].changes.start_at.from)).toBe(Date.parse(toMove.startAt));
    expect(Date.parse(moved[0].changes.start_at.to)).toBe(Date.parse(newStart));

    expect(JSON.stringify([completed, cancelled, moved])).not.toMatch(/customer|access_token|fixture/);
    // 操作者由資料庫帶入，不是前端指定。
    expect(cancelled[0].actor_id).not.toBeNull();
  });

  it("setDesignerActive／updateDesignerBasicInfo：停用與改名留下事件；沒改名稱不記錄", async () => {
    expect((await setDesignerActive(adminClient, designerId, false)).ok).toBe(true);
    // 狀態沒變：不記錄。
    expect((await setDesignerActive(adminClient, designerId, false)).ok).toBe(true);
    const renamed = `${designerName}b`;
    expect(
      (await updateDesignerBasicInfo(adminClient, designerId, { name: renamed, instagram: "", specialties: [], bio: "" })).ok,
    ).toBe(true);
    // 只改簡介，名稱沒變：不記錄。
    expect(
      (await updateDesignerBasicInfo(adminClient, designerId, { name: renamed, instagram: "", specialties: [], bio: "測試簡介" })).ok,
    ).toBe(true);

    const events = await eventsFor(designerId);
    expect(events.map((e) => e.event_type)).toEqual(["designer.deactivated", "designer.updated"]);
    expect(events[0].summary).toEqual({ designer_name: designerName });
    expect(events[1].changes).toEqual({ name: { from: designerName, to: renamed } });
    expect(JSON.stringify(events)).not.toContain("測試簡介");
  });

  it("addClosedDate／removeClosedDate：留下事件，重複加入同一天不重複記錄", async () => {
    expect((await addClosedDate(adminClient, CLOSED_DATE)).ok).toBe(true);
    expect((await addClosedDate(adminClient, CLOSED_DATE)).ok).toBe(true);
    expect((await removeClosedDate(adminClient, CLOSED_DATE)).ok).toBe(true);
    // 已不存在：冪等成功，不記錄。
    expect((await removeClosedDate(adminClient, CLOSED_DATE)).ok).toBe(true);

    const events = await eventsFor(CLOSED_DATE);
    expect(events.map((e) => e.event_type)).toEqual(["closed_date.added", "closed_date.removed"]);
    expect(events[0].summary).toEqual({ date: CLOSED_DATE });
  });
});
