import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AUDIT_EVENT_TYPES, isAllowedChangeKey, isAllowedSummaryKey, type AuditEventType } from "@/lib/admin/audit-log";
import { cancelAppointment, markAppointmentCompleted, rescheduleAppointment } from "@/lib/admin/appointments";
import { updateBookingPolicy } from "@/lib/booking-policy";
import { updateBusinessHours } from "@/lib/admin/business-hours";
import { addClosedDate, removeClosedDate } from "@/lib/admin/closed-dates";
import { createService, setServiceActive, updateService } from "@/lib/admin/services";
import {
  addDesignerLeave,
  createDesigner,
  removeDesignerLeave,
  setDesignerActive,
  setDesignerService,
  updateDesignerBasicInfo,
} from "@/lib/admin/designers";

// TASK-085：16 個來源函式接上 recordAdminAction 的逐函式測試。
// 每個函式：成功→恰好一筆 audit_log insert（事件與摘要／差異正確）；失敗→不寫；
// 紀錄失敗→函式仍回 ok:true；沒有實際變動→不寫；寫入前讀不到舊值→仍成功並只記新值。

afterEach(() => {
  vi.restoreAllMocks();
});

type Step = { data?: unknown; error?: unknown };
type TableScript = { select?: Step | Step[]; write?: Step | Step[] };
type Script = Record<string, TableScript>;
type AuditMode = "ok" | "error" | "reject" | "throw";
type AuditRow = {
  event_type: string;
  entity_type: string;
  entity_id: string;
  summary: Record<string, unknown>;
  changes: Record<string, { from?: unknown; to: unknown }>;
};

const WRITE_METHODS = ["insert", "update", "delete", "upsert"];

// 依「有沒有 insert／update／delete／upsert」決定這次查詢走 write 還是 select 的腳本步驟；
// 每個表的步驟依序消耗，最後一步重複使用。audit_log 的 insert 另外收集。
function makeClient(script: Script, auditMode: AuditMode = "ok") {
  const audit: AuditRow[] = [];
  const selectArgs: { table: string; args: unknown[] }[] = [];
  const queues: Record<string, { select: Step[]; write: Step[] }> = {};
  for (const [table, entry] of Object.entries(script)) {
    queues[table] = {
      select: entry.select === undefined ? [] : Array.isArray(entry.select) ? [...entry.select] : [entry.select],
      write: entry.write === undefined ? [] : Array.isArray(entry.write) ? [...entry.write] : [entry.write],
    };
  }
  const take = (table: string, kind: "select" | "write"): Step => {
    const queue = queues[table]?.[kind];
    if (!queue || queue.length === 0) return { data: null, error: { code: "NO_SCRIPT", message: `${table}.${kind}` } };
    return queue.length > 1 ? queue.shift()! : queue[0];
  };

  const client = {
    from(table: string) {
      if (table === "audit_log") {
        return {
          insert: (row: AuditRow) => {
            if (auditMode === "throw") throw new Error("from exploded");
            audit.push(row);
            if (auditMode === "reject") return Promise.reject(new Error("network down"));
            return Promise.resolve({ error: auditMode === "error" ? { code: "42501", message: "denied" } : null });
          },
        };
      }
      let op: "select" | "write" = "select";
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "insert", "update", "delete", "upsert", "eq", "in", "is", "order", "limit", "maybeSingle"]) {
        chain[method] = (...args: unknown[]) => {
          if (WRITE_METHODS.includes(method)) op = "write";
          if (method === "select") selectArgs.push({ table, args });
          if (method === "maybeSingle") return Promise.resolve(take(table, "select"));
          return chain;
        };
      }
      chain.then = (resolve: (value: Step) => unknown) => resolve({ data: null, error: null, ...take(table, op) });
      return chain;
    },
  } as unknown as SupabaseClient;

  return { client, audit, selectArgs };
}

const OK_ROWS = (...rows: unknown[]): Step => ({ data: rows, error: null });
const ROW = (data: unknown): Step => ({ data, error: null });

const GENERIC = { message: "發生未預期的錯誤，請稍後再試。" };
const APPT_ID = "11111111-1111-4111-8111-111111111111";
const DES_ID = "22222222-2222-4222-8222-222222222222";
const SVC_ID = "33333333-3333-4333-8333-333333333333";

// 預約寫入前讀到的資料（刻意混入顧客欄位，驗證不會被帶進紀錄）。
const APPT_BEFORE = {
  id: APPT_ID,
  start_at: "2026-10-25T07:00:00.000Z",
  end_at: "2026-10-25T08:00:00.000Z",
  status: "confirmed",
  designers: { name: "設計師 A" },
  services: { name: "剪髮" },
  customer_name: "王小明",
  customer_phone: "0912345678",
  customer_email: "a@example.com",
  access_token: "tok-secret",
};
const NO_PII = /王小明|0912345678|example\.com|tok-secret|customer|access_token/;

function expectWhitelisted(rows: AuditRow[]) {
  for (const row of rows) {
    const eventType = row.event_type as AuditEventType;
    expect(AUDIT_EVENT_TYPES).toContain(eventType);
    for (const key of Object.keys(row.summary)) expect(isAllowedSummaryKey(eventType, key), `${eventType}.${key}`).toBe(true);
    for (const key of Object.keys(row.changes)) expect(isAllowedChangeKey(eventType, key), `${eventType}.${key}`).toBe(true);
  }
}

// ============================================================
// 預約
// ============================================================

describe.each([
  ["markAppointmentCompleted", markAppointmentCompleted, "appointment.completed", "completed"],
  ["cancelAppointment", cancelAppointment, "appointment.cancelled", "cancelled"],
] as const)("%s", (_name, fn, eventType, toStatus) => {
  const script = (write: Step): Script => ({ appointments: { select: ROW(APPT_BEFORE), write } });

  it("成功：留一筆事件，摘要含編號／服務／設計師／起訖時間，差異只有狀態，不含顧客欄位", async () => {
    const { client, audit, selectArgs } = makeClient(script(OK_ROWS({ id: APPT_ID })));
    expect(await fn(client, APPT_ID)).toEqual({ ok: true, data: undefined });

    expect(audit).toHaveLength(1);
    expect(audit[0]).toEqual({
      event_type: eventType,
      entity_type: "appointment",
      entity_id: APPT_ID,
      summary: {
        appointment_id: APPT_ID,
        service_name: "剪髮",
        designer_name: "設計師 A",
        start_at: APPT_BEFORE.start_at,
        end_at: APPT_BEFORE.end_at,
      },
      changes: { status: { from: "confirmed", to: toStatus } },
    });
    expect(JSON.stringify(audit[0])).not.toMatch(NO_PII);
    expectWhitelisted(audit);
    // 寫入前的讀取只列明確欄位，不用 *，不含 customer_*／access_token。
    const read = selectArgs.find((c) => c.table === "appointments" && String(c.args[0]).includes("designers"));
    expect(read?.args[0]).toBe("id, start_at, end_at, status, designers(name), services(name)");
  });

  it("失敗（資料庫錯誤／0 列＝狀態不符或被 RLS 擋）：不留紀錄，回傳泛用錯誤", async () => {
    for (const write of [{ error: { code: "42501" } }, OK_ROWS(), { data: null }]) {
      const { client, audit } = makeClient(script(write));
      expect(await fn(client, APPT_ID)).toEqual({ ok: false, error: GENERIC });
      expect(audit).toHaveLength(0);
    }
  });

  it("紀錄失敗（error／reject／from 拋例外）：仍回 ok:true", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const mode of ["error", "reject", "throw"] as const) {
      const { client } = makeClient(script(OK_ROWS({ id: APPT_ID })), mode);
      expect(await fn(client, APPT_ID)).toEqual({ ok: true, data: undefined });
    }
  });

  it("寫入前讀不到舊值：操作照常成功，仍留事件與對象編號（沒有 from、沒有名稱）", async () => {
    const { client, audit } = makeClient({
      appointments: { select: { error: { code: "XX000" } }, write: OK_ROWS({ id: APPT_ID }) },
    });
    expect((await fn(client, APPT_ID)).ok).toBe(true);
    expect(audit).toHaveLength(1);
    expect(audit[0].entity_id).toBe(APPT_ID);
    expect(audit[0].summary).toEqual({ appointment_id: APPT_ID });
    expect(audit[0].changes).toEqual({ status: { to: toStatus } });
  });

  it("embed 以陣列形狀回傳也能取到名稱", async () => {
    const { client, audit } = makeClient({
      appointments: {
        select: ROW({ ...APPT_BEFORE, designers: [{ name: "設計師 B" }], services: [{ name: "染髮" }] }),
        write: OK_ROWS({ id: APPT_ID }),
      },
    });
    await fn(client, APPT_ID);
    expect(audit[0].summary).toMatchObject({ service_name: "染髮", designer_name: "設計師 B" });
  });
});

describe("rescheduleAppointment", () => {
  const NEW_START = "2026-10-26T07:00:00.000Z";
  const NEW_END = "2026-10-26T08:00:00.000Z";
  const script = (write: Step): Script => ({ appointments: { select: ROW(APPT_BEFORE), write } });
  const call = (client: SupabaseClient) => rescheduleAppointment(client, APPT_ID, APPT_BEFORE.start_at, NEW_START, NEW_END);

  it("成功：差異為起訖時間（前→後），摘要為新時段與名稱，不含顧客欄位", async () => {
    const { client, audit } = makeClient(script(OK_ROWS({ id: APPT_ID })));
    expect(await call(client)).toEqual({ ok: true, data: undefined });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toEqual({
      event_type: "appointment.rescheduled",
      entity_type: "appointment",
      entity_id: APPT_ID,
      summary: {
        appointment_id: APPT_ID,
        service_name: "剪髮",
        designer_name: "設計師 A",
        start_at: NEW_START,
        end_at: NEW_END,
      },
      changes: {
        start_at: { from: APPT_BEFORE.start_at, to: NEW_START },
        end_at: { from: APPT_BEFORE.end_at, to: NEW_END },
      },
    });
    expect(JSON.stringify(audit[0])).not.toMatch(NO_PII);
    expectWhitelisted(audit);
  });

  it("失敗（時段衝突 23P01、其他錯誤、0 列）：不留紀錄，錯誤碼分類不變", async () => {
    const conflict = makeClient(script({ error: { code: "23P01" } }));
    expect(await call(conflict.client)).toMatchObject({ ok: false, error: { code: "SLOT_CONFLICT" } });
    expect(conflict.audit).toHaveLength(0);

    for (const write of [{ error: { code: "42501" } }, OK_ROWS()]) {
      const { client, audit } = makeClient(script(write));
      expect(await call(client)).toMatchObject({ ok: false, error: { code: "INTERNAL_ERROR" } });
      expect(audit).toHaveLength(0);
    }
  });

  it("改期到原時段（沒有實際變動，含 Z 與 +00:00 格式差異）：操作成功但不記錄", async () => {
    const same = makeClient(script(OK_ROWS({ id: APPT_ID })));
    // 資料庫回 +00:00、前端送 Z：同一時刻。
    const dbStyle = { ...APPT_BEFORE, start_at: "2026-10-25T07:00:00+00:00", end_at: "2026-10-25T08:00:00+00:00" };
    const withDbFormat = makeClient({ appointments: { select: ROW(dbStyle), write: OK_ROWS({ id: APPT_ID }) } });
    expect(await rescheduleAppointment(same.client, APPT_ID, APPT_BEFORE.start_at, APPT_BEFORE.start_at, APPT_BEFORE.end_at)).toEqual({ ok: true, data: undefined });
    expect(await rescheduleAppointment(withDbFormat.client, APPT_ID, "2026-10-25T07:00:00+00:00", "2026-10-25T07:00:00.000Z", "2026-10-25T08:00:00.000Z")).toEqual({ ok: true, data: undefined });
    expect(same.audit).toHaveLength(0);
    expect(withDbFormat.audit).toHaveLength(0);
  });

  it("只改開始或只改結束時間仍會記錄", async () => {
    const { client, audit } = makeClient(script(OK_ROWS({ id: APPT_ID })));
    await rescheduleAppointment(client, APPT_ID, APPT_BEFORE.start_at, APPT_BEFORE.start_at, NEW_END);
    expect(audit).toHaveLength(1);
  });

  it("紀錄失敗：仍回 ok:true", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const mode of ["error", "reject", "throw"] as const) {
      const { client } = makeClient(script(OK_ROWS({ id: APPT_ID })), mode);
      expect(await call(client)).toEqual({ ok: true, data: undefined });
    }
  });

  it("讀不到舊值：只記新時段（沒有 from）", async () => {
    const { client, audit } = makeClient({
      appointments: { select: { error: { code: "XX000" } }, write: OK_ROWS({ id: APPT_ID }) },
    });
    expect((await call(client)).ok).toBe(true);
    expect(audit[0].changes).toEqual({ start_at: { to: NEW_START }, end_at: { to: NEW_END } });
  });
});

// ============================================================
// 預約規則、營業時間、公休日
// ============================================================

describe("updateBookingPolicy", () => {
  const script = (write: Step, before: Step = ROW({ min_lead_time_hours: 2, cancel_window_hours: null })): Script => ({
    booking_policy: { select: before, write },
  });
  const input = { min_lead_time_hours: "720", cancel_window_hours: "24" };

  it("成功：記有變動的兩個欄位（前→後）", async () => {
    const { client, audit } = makeClient(script(OK_ROWS({ id: 1 })));
    expect(await updateBookingPolicy(client, input)).toEqual({ ok: true, data: undefined });
    expect(audit).toEqual([
      {
        event_type: "booking_policy.updated",
        entity_type: "booking_policy",
        entity_id: "1",
        summary: {},
        changes: {
          min_lead_time_hours: { from: 2, to: 720 },
          cancel_window_hours: { from: null, to: 24 },
        },
      },
    ]);
    expectWhitelisted(audit);
  });

  it("只改一個欄位時只列那一個", async () => {
    const { client, audit } = makeClient(script(OK_ROWS({ id: 1 }), ROW({ min_lead_time_hours: 2, cancel_window_hours: 24 })));
    await updateBookingPolicy(client, input);
    expect(audit[0].changes).toEqual({ min_lead_time_hours: { from: 2, to: 720 } });
  });

  it("沒有實際變動：不記錄，但仍回 ok:true", async () => {
    const { client, audit } = makeClient(script(OK_ROWS({ id: 1 }), ROW({ min_lead_time_hours: 720, cancel_window_hours: 24 })));
    expect(await updateBookingPolicy(client, input)).toEqual({ ok: true, data: undefined });
    expect(audit).toHaveLength(0);
  });

  it("失敗（錯誤、0 列、驗證不過）：不留紀錄", async () => {
    for (const write of [{ error: { code: "23514" } }, OK_ROWS()]) {
      const { client, audit } = makeClient(script(write));
      expect((await updateBookingPolicy(client, input)).ok).toBe(false);
      expect(audit).toHaveLength(0);
    }
    const invalid = makeClient(script(OK_ROWS({ id: 1 })));
    expect((await updateBookingPolicy(invalid.client, { min_lead_time_hours: "0", cancel_window_hours: "" })).ok).toBe(false);
    expect(invalid.audit).toHaveLength(0);
  });

  it("紀錄失敗：仍回 ok:true", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const mode of ["error", "reject", "throw"] as const) {
      const { client } = makeClient(script(OK_ROWS({ id: 1 })), mode);
      expect(await updateBookingPolicy(client, input)).toEqual({ ok: true, data: undefined });
    }
  });

  it("讀不到舊值：只記新值", async () => {
    const { client, audit } = makeClient(script(OK_ROWS({ id: 1 }), { error: { code: "XX000" } }));
    expect((await updateBookingPolicy(client, input)).ok).toBe(true);
    expect(audit[0].changes).toEqual({ min_lead_time_hours: { to: 720 }, cancel_window_hours: { to: 24 } });
  });
});

describe("updateBusinessHours", () => {
  const before = [
    { weekday: 1, open_time: "10:00:00", close_time: "19:00:00", is_closed: false },
    { weekday: 2, open_time: "10:00:00", close_time: "19:00:00", is_closed: false },
    { weekday: 3, open_time: "10:00:00", close_time: "19:00:00", is_closed: false },
  ];
  const rowsAfter = [
    { weekday: 1, open_time: "11:00", close_time: "19:00", is_closed: false },
    { weekday: 2, open_time: "10:00", close_time: "19:00", is_closed: false },
    { weekday: 3, open_time: "", close_time: "", is_closed: true },
  ];
  const script = (write: Step, read: Step = ROW(before)): Script => ({ business_hours: { select: read, write } });
  const written = OK_ROWS({ weekday: 1 }, { weekday: 2 }, { weekday: 3 });

  it("成功：一次儲存只記一筆，只列有變動的星期", async () => {
    const { client, audit } = makeClient(script(written));
    expect(await updateBusinessHours(client, rowsAfter)).toEqual({ ok: true, data: undefined });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toEqual({
      event_type: "business_hours.updated",
      entity_type: "business_hours",
      entity_id: "weekly",
      summary: { weekdays: [1, 3] },
      changes: {
        weekday_1_open_time: { from: "10:00", to: "11:00" },
        weekday_3_open_time: { from: "10:00", to: null },
        weekday_3_close_time: { from: "19:00", to: null },
        weekday_3_is_closed: { from: false, to: true },
      },
    });
    expectWhitelisted(audit);
  });

  it("沒有任何星期變動：不記錄，但仍回 ok:true", async () => {
    const same = rowsAfter.slice(0, 2).map((r) => ({ ...r }));
    const { client, audit } = makeClient(script(OK_ROWS({ weekday: 1 }, { weekday: 2 }), ROW(before.slice(0, 2))));
    expect(await updateBusinessHours(client, [{ ...same[0], open_time: "10:00" }, same[1]])).toEqual({ ok: true, data: undefined });
    expect(audit).toHaveLength(0);
  });

  it("失敗（錯誤、受影響列數不符）：不留紀錄", async () => {
    for (const write of [{ error: { code: "23514" } }, OK_ROWS({ weekday: 1 })]) {
      const { client, audit } = makeClient(script(write));
      expect((await updateBusinessHours(client, rowsAfter)).ok).toBe(false);
      expect(audit).toHaveLength(0);
    }
  });

  it("紀錄失敗：仍回 ok:true", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const mode of ["error", "reject", "throw"] as const) {
      const { client } = makeClient(script(written), mode);
      expect(await updateBusinessHours(client, rowsAfter)).toEqual({ ok: true, data: undefined });
    }
  });

  it("讀不到舊值：只記新值（所有星期）", async () => {
    const { client, audit } = makeClient(script(written, { error: { code: "XX000" } }));
    expect((await updateBusinessHours(client, rowsAfter)).ok).toBe(true);
    expect(audit[0].summary).toEqual({ weekdays: [1, 2, 3] });
    expect(audit[0].changes.weekday_1_open_time).toEqual({ to: "11:00" });
  });
});

describe("addClosedDate／removeClosedDate", () => {
  it("addClosedDate 成功（原本不是公休日）：記 closed_date.added，摘要只有日期", async () => {
    const { client, audit } = makeClient({ closed_dates: { select: ROW(null), write: OK_ROWS({ date: "2026-12-25" }) } });
    expect(await addClosedDate(client, "2026-12-25")).toEqual({ ok: true, data: undefined });
    expect(audit).toEqual([
      {
        event_type: "closed_date.added",
        entity_type: "closed_date",
        entity_id: "2026-12-25",
        summary: { date: "2026-12-25" },
        changes: {},
      },
    ]);
  });

  it("addClosedDate 重複加入同一天（upsert no-op）：不記錄，仍回 ok:true", async () => {
    const { client, audit } = makeClient({
      closed_dates: { select: ROW({ date: "2026-12-25" }), write: OK_ROWS({ date: "2026-12-25" }) },
    });
    expect(await addClosedDate(client, "2026-12-25")).toEqual({ ok: true, data: undefined });
    expect(audit).toHaveLength(0);
  });

  it("addClosedDate 查是否已存在失敗：仍成功並記錄（不阻擋原操作）", async () => {
    const { client, audit } = makeClient({
      closed_dates: { select: { error: { code: "XX000" } }, write: OK_ROWS({ date: "2026-12-25" }) },
    });
    expect((await addClosedDate(client, "2026-12-25")).ok).toBe(true);
    expect(audit).toHaveLength(1);
  });

  it("addClosedDate 失敗（錯誤、0 列）：不留紀錄", async () => {
    for (const write of [{ error: { code: "42501" } }, OK_ROWS()]) {
      const { client, audit } = makeClient({ closed_dates: { select: ROW(null), write } });
      expect((await addClosedDate(client, "2026-12-25")).ok).toBe(false);
      expect(audit).toHaveLength(0);
    }
  });

  it("removeClosedDate 成功（刪到 1 列）：記 closed_date.removed", async () => {
    const { client, audit } = makeClient({ closed_dates: { write: OK_ROWS({ date: "2026-12-25" }) } });
    expect(await removeClosedDate(client, "2026-12-25")).toEqual({ ok: true, data: undefined });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ event_type: "closed_date.removed", entity_id: "2026-12-25", summary: { date: "2026-12-25" } });
  });

  it("removeClosedDate 本來就不存在（0 列且複查確認已不存在）：成功但不記錄", async () => {
    const { client, audit } = makeClient({ closed_dates: { select: ROW(null), write: OK_ROWS() } });
    expect(await removeClosedDate(client, "2026-12-25")).toEqual({ ok: true, data: undefined });
    expect(audit).toHaveLength(0);
  });

  it("removeClosedDate 失敗（錯誤、0 列但仍存在＝被 RLS 擋）：不留紀錄", async () => {
    const failed = makeClient({ closed_dates: { write: { error: { code: "42501" } } } });
    expect((await removeClosedDate(failed.client, "2026-12-25")).ok).toBe(false);
    const blocked = makeClient({ closed_dates: { select: ROW({ date: "2026-12-25" }), write: OK_ROWS() } });
    expect((await removeClosedDate(blocked.client, "2026-12-25")).ok).toBe(false);
    expect(failed.audit).toHaveLength(0);
    expect(blocked.audit).toHaveLength(0);
  });

  it("紀錄失敗：兩個函式仍回 ok:true", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const mode of ["error", "reject", "throw"] as const) {
      const add = makeClient({ closed_dates: { select: ROW(null), write: OK_ROWS({ date: "2026-12-25" }) } }, mode);
      expect((await addClosedDate(add.client, "2026-12-25")).ok).toBe(true);
      const remove = makeClient({ closed_dates: { write: OK_ROWS({ date: "2026-12-25" }) } }, mode);
      expect((await removeClosedDate(remove.client, "2026-12-25")).ok).toBe(true);
    }
  });
});

// ============================================================
// 服務
// ============================================================

describe("createService／updateService／setServiceActive", () => {
  const input = { name: " 經典剪髮 ", price: 600, durationMinutes: 45, bufferMinutes: 15, description: "不該被記錄的描述" };
  const beforeService = { name: "經典剪髮", price: 600, duration_minutes: 45, buffer_minutes: 15 };

  it("createService 成功：記 service.created（名稱 trim、價格／時長／緩衝），不含描述", async () => {
    const { client, audit } = makeClient({ services: { write: OK_ROWS({ id: SVC_ID }) } });
    expect(await createService(client, input)).toEqual({ ok: true, data: undefined });
    expect(audit).toEqual([
      {
        event_type: "service.created",
        entity_type: "service",
        entity_id: SVC_ID,
        summary: { service_name: "經典剪髮" },
        changes: { price: { to: 600 }, duration_minutes: { to: 45 }, buffer_minutes: { to: 15 } },
      },
    ]);
    expect(JSON.stringify(audit[0])).not.toContain("描述");
    expectWhitelisted(audit);
  });

  it("createService 失敗（錯誤、不是剛好 1 列）：不留紀錄", async () => {
    for (const write of [{ error: { code: "23514" } }, OK_ROWS()]) {
      const { client, audit } = makeClient({ services: { write } });
      expect((await createService(client, input)).ok).toBe(false);
      expect(audit).toHaveLength(0);
    }
  });

  it("updateService 成功且有變動：記 service.updated，只列有變動的欄位", async () => {
    const { client, audit } = makeClient({ services: { select: ROW(beforeService), write: OK_ROWS({ id: SVC_ID }) } });
    expect(await updateService(client, SVC_ID, { ...input, price: 700 })).toEqual({ ok: true, data: undefined });
    expect(audit).toEqual([
      {
        event_type: "service.updated",
        entity_type: "service",
        entity_id: SVC_ID,
        summary: { service_name: "經典剪髮" },
        changes: { price: { from: 600, to: 700 } },
      },
    ]);
  });

  it("updateService 只改描述（追蹤欄位都沒變）：不記錄", async () => {
    const { client, audit } = makeClient({ services: { select: ROW(beforeService), write: OK_ROWS({ id: SVC_ID }) } });
    expect((await updateService(client, SVC_ID, input)).ok).toBe(true);
    expect(audit).toHaveLength(0);
  });

  it("updateService 讀不到舊值：仍成功並只記新值；失敗時不記", async () => {
    const unknown = makeClient({ services: { select: { error: { code: "XX000" } }, write: OK_ROWS({ id: SVC_ID }) } });
    expect((await updateService(unknown.client, SVC_ID, input)).ok).toBe(true);
    expect(unknown.audit[0].changes.price).toEqual({ to: 600 });

    const failed = makeClient({ services: { select: ROW(beforeService), write: OK_ROWS() } });
    expect((await updateService(failed.client, SVC_ID, input)).ok).toBe(false);
    expect(failed.audit).toHaveLength(0);
  });

  it("setServiceActive：下架記 service.deactivated、上架記 service.activated", async () => {
    const down = makeClient({ services: { select: ROW({ name: "經典剪髮", is_active: true }), write: OK_ROWS({ id: SVC_ID }) } });
    expect(await setServiceActive(down.client, SVC_ID, false)).toEqual({ ok: true, data: undefined });
    expect(down.audit).toEqual([
      {
        event_type: "service.deactivated",
        entity_type: "service",
        entity_id: SVC_ID,
        summary: { service_name: "經典剪髮" },
        changes: {},
      },
    ]);
    const up = makeClient({ services: { select: ROW({ name: "經典剪髮", is_active: false }), write: OK_ROWS({ id: SVC_ID }) } });
    await setServiceActive(up.client, SVC_ID, true);
    expect(up.audit[0].event_type).toBe("service.activated");
  });

  it("setServiceActive 狀態本來就相同（沒有實際變動）：不記錄；失敗：不記錄", async () => {
    const same = makeClient({ services: { select: ROW({ name: "經典剪髮", is_active: true }), write: OK_ROWS({ id: SVC_ID }) } });
    expect((await setServiceActive(same.client, SVC_ID, true)).ok).toBe(true);
    expect(same.audit).toHaveLength(0);

    const failed = makeClient({ services: { select: ROW({ name: "x", is_active: true }), write: OK_ROWS() } });
    expect((await setServiceActive(failed.client, SVC_ID, false)).ok).toBe(false);
    expect(failed.audit).toHaveLength(0);
  });

  it("紀錄失敗：三個函式仍回 ok:true", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const mode of ["error", "reject", "throw"] as const) {
      const create = makeClient({ services: { write: OK_ROWS({ id: SVC_ID }) } }, mode);
      expect((await createService(create.client, input)).ok).toBe(true);
      const update = makeClient({ services: { select: ROW(beforeService), write: OK_ROWS({ id: SVC_ID }) } }, mode);
      expect((await updateService(update.client, SVC_ID, { ...input, price: 1 })).ok).toBe(true);
      const active = makeClient({ services: { select: ROW({ name: "x", is_active: true }), write: OK_ROWS({ id: SVC_ID }) } }, mode);
      expect((await setServiceActive(active.client, SVC_ID, false)).ok).toBe(true);
    }
  });
});

// ============================================================
// 設計師
// ============================================================

describe("createDesigner／updateDesignerBasicInfo／setDesignerActive", () => {
  const blank = { name: " 新人 ", instagram: "@secret_ig", specialties: ["燙髮"], bio: "不該被記錄的簡介" };

  it("createDesigner 成功：記 designer.created，只有名稱（不含簡介、IG、專長）", async () => {
    const { client, audit } = makeClient({
      designers: { select: OK_ROWS({ sort_order: 1 }), write: OK_ROWS({ id: DES_ID }) },
    });
    expect(await createDesigner(client, blank)).toEqual({ ok: true, data: { id: DES_ID } });
    expect(audit).toEqual([
      {
        event_type: "designer.created",
        entity_type: "designer",
        entity_id: DES_ID,
        summary: { designer_name: "新人" },
        changes: {},
      },
    ]);
    expect(JSON.stringify(audit[0])).not.toMatch(/secret_ig|簡介|燙髮/);
  });

  it("createDesigner 失敗：不留紀錄", async () => {
    for (const write of [{ error: { code: "23514" } }, OK_ROWS()]) {
      const { client, audit } = makeClient({ designers: { select: OK_ROWS({ sort_order: 1 }), write } });
      expect((await createDesigner(client, blank)).ok).toBe(false);
      expect(audit).toHaveLength(0);
    }
  });

  it("updateDesignerBasicInfo：名稱有變動才記 designer.updated（前→後）", async () => {
    const { client, audit } = makeClient({ designers: { select: ROW({ name: "舊名" }), write: OK_ROWS({ id: DES_ID }) } });
    expect(await updateDesignerBasicInfo(client, DES_ID, blank)).toEqual({ ok: true, data: undefined });
    expect(audit).toEqual([
      {
        event_type: "designer.updated",
        entity_type: "designer",
        entity_id: DES_ID,
        summary: { designer_name: "新人" },
        changes: { name: { from: "舊名", to: "新人" } },
      },
    ]);
    expect(JSON.stringify(audit[0])).not.toMatch(/secret_ig|簡介|燙髮/);
  });

  it("updateDesignerBasicInfo 名稱沒變（只改簡介／IG／專長）：不記錄；讀不到舊名稱：只記新名稱；失敗：不記錄", async () => {
    const same = makeClient({ designers: { select: ROW({ name: "新人" }), write: OK_ROWS({ id: DES_ID }) } });
    expect((await updateDesignerBasicInfo(same.client, DES_ID, blank)).ok).toBe(true);
    expect(same.audit).toHaveLength(0);

    const unknown = makeClient({ designers: { select: { error: { code: "XX000" } }, write: OK_ROWS({ id: DES_ID }) } });
    expect((await updateDesignerBasicInfo(unknown.client, DES_ID, blank)).ok).toBe(true);
    expect(unknown.audit[0].changes).toEqual({ name: { to: "新人" } });

    const failed = makeClient({ designers: { select: ROW({ name: "舊名" }), write: OK_ROWS() } });
    expect((await updateDesignerBasicInfo(failed.client, DES_ID, blank)).ok).toBe(false);
    expect(failed.audit).toHaveLength(0);
  });

  it("setDesignerActive：停用記 designer.deactivated、啟用記 designer.activated；狀態相同或失敗不記", async () => {
    const down = makeClient({ designers: { select: ROW({ name: "設計師 A", is_active: true }), write: OK_ROWS({ id: DES_ID }) } });
    expect(await setDesignerActive(down.client, DES_ID, false)).toEqual({ ok: true, data: undefined });
    expect(down.audit).toEqual([
      {
        event_type: "designer.deactivated",
        entity_type: "designer",
        entity_id: DES_ID,
        summary: { designer_name: "設計師 A" },
        changes: {},
      },
    ]);
    const up = makeClient({ designers: { select: ROW({ name: "設計師 A", is_active: false }), write: OK_ROWS({ id: DES_ID }) } });
    await setDesignerActive(up.client, DES_ID, true);
    expect(up.audit[0].event_type).toBe("designer.activated");

    const same = makeClient({ designers: { select: ROW({ name: "設計師 A", is_active: true }), write: OK_ROWS({ id: DES_ID }) } });
    expect((await setDesignerActive(same.client, DES_ID, true)).ok).toBe(true);
    expect(same.audit).toHaveLength(0);

    const failed = makeClient({ designers: { select: ROW({ name: "x", is_active: true }), write: OK_ROWS() } });
    expect((await setDesignerActive(failed.client, DES_ID, false)).ok).toBe(false);
    expect(failed.audit).toHaveLength(0);
  });

  it("紀錄失敗：三個函式仍回 ok:true", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const mode of ["error", "reject", "throw"] as const) {
      const create = makeClient({ designers: { select: OK_ROWS({ sort_order: 1 }), write: OK_ROWS({ id: DES_ID }) } }, mode);
      expect((await createDesigner(create.client, blank)).ok).toBe(true);
      const update = makeClient({ designers: { select: ROW({ name: "舊名" }), write: OK_ROWS({ id: DES_ID }) } }, mode);
      expect((await updateDesignerBasicInfo(update.client, DES_ID, blank)).ok).toBe(true);
      const active = makeClient({ designers: { select: ROW({ name: "x", is_active: true }), write: OK_ROWS({ id: DES_ID }) } }, mode);
      expect((await setDesignerActive(active.client, DES_ID, false)).ok).toBe(true);
    }
  });
});

describe("setDesignerService", () => {
  const names: Script = {
    designers: { select: ROW({ name: "設計師 A" }) },
    services: { select: ROW({ name: "剪髮" }) },
  };

  it("開啟成功：記 designer_service.enabled，摘要為設計師與服務名稱，對象為複合鍵", async () => {
    const { client, audit } = makeClient({ ...names, designer_services: { write: { data: null, error: null } } });
    expect(await setDesignerService(client, DES_ID, SVC_ID, true)).toEqual({ ok: true, data: undefined });
    expect(audit).toEqual([
      {
        event_type: "designer_service.enabled",
        entity_type: "designer_service",
        entity_id: `${DES_ID}:${SVC_ID}`,
        summary: { designer_name: "設計師 A", service_name: "剪髮" },
        changes: {},
      },
    ]);
    expectWhitelisted(audit);
  });

  it("關閉成功（刪到 1 列）：記 designer_service.disabled", async () => {
    const { client, audit } = makeClient({ ...names, designer_services: { write: OK_ROWS({ service_id: SVC_ID }) } });
    expect(await setDesignerService(client, DES_ID, SVC_ID, false)).toEqual({ ok: true, data: undefined });
    expect(audit).toHaveLength(1);
    expect(audit[0].event_type).toBe("designer_service.disabled");
  });

  it("開啟時 23505（本來就已開啟）視為成功但不記錄", async () => {
    const { client, audit } = makeClient({ ...names, designer_services: { write: { error: { code: "23505" } } } });
    expect(await setDesignerService(client, DES_ID, SVC_ID, true)).toEqual({ ok: true, data: undefined });
    expect(audit).toHaveLength(0);
  });

  it("失敗（其他錯誤、關閉時刪到 0 列）：不留紀錄；id 格式錯誤：不留紀錄", async () => {
    for (const [enabled, write] of [
      [true, { error: { code: "23503" } }],
      [false, OK_ROWS()],
      [false, { error: { code: "42501" } }],
    ] as const) {
      const { client, audit } = makeClient({ ...names, designer_services: { write } });
      expect((await setDesignerService(client, DES_ID, SVC_ID, enabled)).ok).toBe(false);
      expect(audit).toHaveLength(0);
    }
    const bad = makeClient({ ...names, designer_services: { write: { data: null, error: null } } });
    expect((await setDesignerService(bad.client, "x", SVC_ID, true)).ok).toBe(false);
    expect(bad.audit).toHaveLength(0);
  });

  it("名稱查不到：仍成功，只記編號（摘要為空）", async () => {
    const { client, audit } = makeClient({
      designers: { select: { error: { code: "XX000" } } },
      services: { select: { error: { code: "XX000" } } },
      designer_services: { write: { data: null, error: null } },
    });
    expect((await setDesignerService(client, DES_ID, SVC_ID, true)).ok).toBe(true);
    expect(audit[0].summary).toEqual({});
    expect(audit[0].entity_id).toBe(`${DES_ID}:${SVC_ID}`);
  });

  it("紀錄失敗：仍回 ok:true", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const mode of ["error", "reject", "throw"] as const) {
      const { client } = makeClient({ ...names, designer_services: { write: { data: null, error: null } } }, mode);
      expect(await setDesignerService(client, DES_ID, SVC_ID, true)).toEqual({ ok: true, data: undefined });
    }
  });
});

describe("addDesignerLeave／removeDesignerLeave", () => {
  const FUTURE = "2099-01-15";
  const designers: Script = { designers: { select: ROW({ name: "設計師 A" }) } };

  it("addDesignerLeave 成功：記 designer_leave.added，摘要為設計師名稱與日期", async () => {
    const { client, audit } = makeClient({ ...designers, designer_leaves: { write: { data: null, error: null } } });
    expect(await addDesignerLeave(client, DES_ID, FUTURE)).toEqual({ ok: true, data: undefined });
    expect(audit).toEqual([
      {
        event_type: "designer_leave.added",
        entity_type: "designer_leave",
        entity_id: `${DES_ID}:${FUTURE}`,
        summary: { designer_name: "設計師 A", date: FUTURE },
        changes: {},
      },
    ]);
    expectWhitelisted(audit);
  });

  it("addDesignerLeave 23505（本來就已請假）成功但不記；其他錯誤與日期不合法：失敗且不記", async () => {
    const dup = makeClient({ ...designers, designer_leaves: { write: { error: { code: "23505" } } } });
    expect(await addDesignerLeave(dup.client, DES_ID, FUTURE)).toEqual({ ok: true, data: undefined });
    expect(dup.audit).toHaveLength(0);

    const failed = makeClient({ ...designers, designer_leaves: { write: { error: { code: "23503" } } } });
    expect((await addDesignerLeave(failed.client, DES_ID, FUTURE)).ok).toBe(false);
    const past = makeClient({ ...designers, designer_leaves: { write: { data: null, error: null } } });
    expect((await addDesignerLeave(past.client, DES_ID, "2000-01-01")).ok).toBe(false);
    expect(failed.audit).toHaveLength(0);
    expect(past.audit).toHaveLength(0);
  });

  it("removeDesignerLeave 成功（刪到 1 列）：記 designer_leave.removed", async () => {
    const { client, audit } = makeClient({ ...designers, designer_leaves: { write: OK_ROWS({ date: FUTURE }) } });
    expect(await removeDesignerLeave(client, DES_ID, FUTURE)).toEqual({ ok: true, data: undefined });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      event_type: "designer_leave.removed",
      entity_id: `${DES_ID}:${FUTURE}`,
      summary: { designer_name: "設計師 A", date: FUTURE },
    });
  });

  it("removeDesignerLeave 失敗（0 列、錯誤）：不留紀錄", async () => {
    for (const write of [OK_ROWS(), { error: { code: "42501" } }]) {
      const { client, audit } = makeClient({ ...designers, designer_leaves: { write } });
      expect((await removeDesignerLeave(client, DES_ID, FUTURE)).ok).toBe(false);
      expect(audit).toHaveLength(0);
    }
  });

  it("名稱查不到：仍成功，摘要只有日期；紀錄失敗：兩個函式仍回 ok:true", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const noName = makeClient({
      designers: { select: { error: { code: "XX000" } } },
      designer_leaves: { write: { data: null, error: null } },
    });
    expect((await addDesignerLeave(noName.client, DES_ID, FUTURE)).ok).toBe(true);
    expect(noName.audit[0].summary).toEqual({ date: FUTURE });

    for (const mode of ["error", "reject", "throw"] as const) {
      const add = makeClient({ ...designers, designer_leaves: { write: { data: null, error: null } } }, mode);
      expect((await addDesignerLeave(add.client, DES_ID, FUTURE)).ok).toBe(true);
      const remove = makeClient({ ...designers, designer_leaves: { write: OK_ROWS({ date: FUTURE }) } }, mode);
      expect((await removeDesignerLeave(remove.client, DES_ID, FUTURE)).ok).toBe(true);
    }
  });
});

describe("事件覆蓋", () => {
  it("16 個來源函式合計涵蓋規格書全部 19 個事件代碼", () => {
    // 逐函式測試已各自斷言事件代碼；這裡確認清單沒有漏掉任何代碼。
    const covered = new Set<string>([
      "appointment.completed",
      "appointment.cancelled",
      "appointment.rescheduled",
      "booking_policy.updated",
      "business_hours.updated",
      "closed_date.added",
      "closed_date.removed",
      "service.created",
      "service.updated",
      "service.activated",
      "service.deactivated",
      "designer.created",
      "designer.updated",
      "designer.activated",
      "designer.deactivated",
      "designer_service.enabled",
      "designer_service.disabled",
      "designer_leave.added",
      "designer_leave.removed",
    ]);
    expect([...covered].sort()).toEqual([...AUDIT_EVENT_TYPES].sort());
  });
});
