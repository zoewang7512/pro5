// 對真實 Supabase 專案執行的整合測試，驗證 TASK-084（0019_audit_log）的權限矩陣。
// 不放進預設 `npm test`，只透過 `npm run test:audit-log` 執行；缺設定時直接噴錯而非略過，
// 避免「忘了填 .env.local 卻顯示測試通過」的誤導。
// 測試資料的 summary 一律帶 `__TEST__`，由 afterAll 以 service_role 刪除；
// 漏網之魚可用 `npm run sweep:audit-test-rows` 清掃。
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listAuditLog, recordAdminAction } from "../lib/admin/audit-log";

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
