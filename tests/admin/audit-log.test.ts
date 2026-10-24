import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AUDIT_EVENT_TYPES,
  buildAppointmentRescheduledEvent,
  buildAppointmentStatusEvent,
  buildBookingPolicyEvent,
  buildBusinessHoursEvent,
  buildClosedDateEvent,
  buildDesignerActiveEvent,
  buildDesignerCreatedEvent,
  buildDesignerLeaveEvent,
  buildDesignerServiceEvent,
  buildDesignerUpdatedEvent,
  buildServiceActiveEvent,
  buildServiceCreatedEvent,
  buildServiceUpdatedEvent,
  describeAuditEntry,
  isAllowedChangeKey,
  isAllowedSummaryKey,
  listAuditLog,
  recordAdminAction,
  type AuditEntry,
  type AuditEventType,
} from "@/lib/admin/audit-log";

afterEach(() => {
  vi.restoreAllMocks();
});

const SAMPLE_ENTRY: AuditEntry = {
  eventType: "service.activated",
  entityType: "service",
  entityId: "svc-1",
  summary: { service_name: "經典剪髮" },
  changes: {},
};

function fakeInsertClient(result: { error: unknown } | "reject" | "throw") {
  const insert = vi.fn(() => {
    if (result === "reject") return Promise.reject(new Error("network down"));
    return Promise.resolve(result as { error: unknown });
  });
  const from = vi.fn(() => {
    if (result === "throw") throw new Error("from exploded");
    return { insert };
  });
  return { client: { from } as unknown as SupabaseClient, from, insert };
}

describe("recordAdminAction：永不 throw", () => {
  it("成功時寫入 audit_log，且只送出五個白名單欄位（不含 actor_id、created_at）", async () => {
    const fake = fakeInsertClient({ error: null });
    await recordAdminAction(fake.client, SAMPLE_ENTRY);
    expect(fake.from).toHaveBeenCalledWith("audit_log");
    expect(fake.insert).toHaveBeenCalledWith({
      event_type: "service.activated",
      entity_type: "service",
      entity_id: "svc-1",
      summary: { service_name: "經典剪髮" },
      changes: {},
    });
  });

  it("insert 回傳 error 時不 throw，只警告 error code（不印訊息內容）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fake = fakeInsertClient({ error: { code: "42501", message: "secret-detail 王小明 0912345678" } });
    await expect(recordAdminAction(fake.client, SAMPLE_ENTRY)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    const printed = JSON.stringify(warn.mock.calls[0]);
    expect(printed).toContain("42501");
    expect(printed).not.toContain("secret-detail");
    expect(printed).not.toContain("0912345678");
  });

  it("insert reject 時不 throw", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fake = fakeInsertClient("reject");
    await expect(recordAdminAction(fake.client, SAMPLE_ENTRY)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("整個 from 拋例外時不 throw", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fake = fakeInsertClient("throw");
    await expect(recordAdminAction(fake.client, SAMPLE_ENTRY)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("error 不是物件、或 code 不是短代碼字串時，警告輸出 unknown", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await recordAdminAction(fakeInsertClient({ error: { code: "含中文的長長長長長長長長代碼" } }).client, SAMPLE_ENTRY);
    await recordAdminAction(fakeInsertClient({ error: "boom" }).client, SAMPLE_ENTRY);
    expect(JSON.stringify(warn.mock.calls[0])).toContain("unknown");
    expect(JSON.stringify(warn.mock.calls[1])).toContain("unknown");
  });

  it("console.warn 本身拋例外也不影響呼叫端", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {
      throw new Error("console broken");
    });
    const fake = fakeInsertClient({ error: { code: "XX000" } });
    await expect(recordAdminAction(fake.client, SAMPLE_ENTRY)).resolves.toBeUndefined();
  });

  it("entry 為 null（沒有實際變動）時不查詢資料庫", async () => {
    const fake = fakeInsertClient({ error: null });
    await recordAdminAction(fake.client, null);
    expect(fake.from).not.toHaveBeenCalled();
  });
});

describe("recordAdminAction：截斷與大小上限", () => {
  it("文字值超過 60 字時截斷（以字元計，不切壞代理對）", async () => {
    const fake = fakeInsertClient({ error: null });
    const longName = "長".repeat(100);
    const emojiName = "😀".repeat(70);
    await recordAdminAction(fake.client, {
      ...SAMPLE_ENTRY,
      eventType: "service.updated",
      summary: { service_name: longName },
      changes: { name: { from: emojiName, to: longName } },
    });
    const row = fake.insert.mock.calls[0] as unknown as [{ summary: { service_name: string }; changes: { name: { from: string; to: string } } }];
    expect(Array.from(row[0].summary.service_name)).toHaveLength(60);
    expect(Array.from(row[0].changes.name.from)).toHaveLength(60);
    expect(Array.from(row[0].changes.name.to)).toHaveLength(60);
  });

  it("entityId 超過 128 字時截斷、空字串時改為 unknown", async () => {
    const fake = fakeInsertClient({ error: null });
    await recordAdminAction(fake.client, { ...SAMPLE_ENTRY, entityId: "x".repeat(300) });
    await recordAdminAction(fake.client, { ...SAMPLE_ENTRY, entityId: "" });
    const calls = fake.insert.mock.calls as unknown as [{ entity_id: string }][];
    expect(calls[0][0].entity_id).toHaveLength(128);
    expect(calls[1][0].entity_id).toBe("unknown");
  });

  it("changes 超過大小上限時丟棄 changes、保留 summary", async () => {
    const fake = fakeInsertClient({ error: null });
    // 營業時間 7 天 × 3 欄正常用量遠低於上限；這裡以大量重複鍵撐破上限的情境用 weekdays 之外的巨大 changes 模擬。
    const changes: Record<string, { from: string; to: string }> = {};
    for (let weekday = 0; weekday < 7; weekday += 1) {
      for (const field of ["open_time", "close_time", "is_closed"]) {
        changes[`weekday_${weekday}_${field}`] = { from: "é".repeat(60), to: "é".repeat(60) };
      }
    }
    // 21 個欄位 × 約 250 位元組 ≈ 5.2KB，超過 3500。
    await recordAdminAction(fake.client, {
      eventType: "business_hours.updated",
      entityType: "business_hours",
      entityId: "weekly",
      summary: { weekdays: [0, 1, 2, 3, 4, 5, 6] },
      changes,
    });
    const row = (fake.insert.mock.calls[0] as unknown as [{ summary: unknown; changes: unknown }])[0];
    expect(row.changes).toEqual({});
    expect(row.summary).toEqual({ weekdays: [0, 1, 2, 3, 4, 5, 6] });
  });

  it("summary 也超過上限時只保留事件與對象", async () => {
    const fake = fakeInsertClient({ error: null });
    const changes: Record<string, { from: string; to: string }> = {};
    for (let weekday = 0; weekday < 7; weekday += 1) {
      for (const field of ["open_time", "close_time", "is_closed"]) {
        changes[`weekday_${weekday}_${field}`] = { from: "é".repeat(60), to: "é".repeat(60) };
      }
    }
    // weekdays 塞入大量數字撐破 summary 上限。
    await recordAdminAction(fake.client, {
      eventType: "business_hours.updated",
      entityType: "business_hours",
      entityId: "weekly",
      summary: { weekdays: Array.from({ length: 2000 }, () => 3) },
      changes,
    });
    expect(fake.insert).toHaveBeenCalledWith({
      event_type: "business_hours.updated",
      entity_type: "business_hours",
      entity_id: "weekly",
      summary: {},
      changes: {},
    });
  });

  it("依事件白名單過濾：白名單外的 summary／changes 鍵（含顧客欄位）不會送出", async () => {
    const fake = fakeInsertClient({ error: null });
    await recordAdminAction(fake.client, {
      eventType: "appointment.cancelled",
      entityType: "appointment",
      entityId: "apt-1",
      summary: {
        service_name: "剪髮",
        customer_name: "王小明",
        customer_phone: "0912345678",
        customer_email: "a@example.com",
        access_token: "tok",
      },
      changes: { status: { from: "confirmed", to: "cancelled" }, customer_name: { from: "A", to: "B" } },
    } as unknown as AuditEntry);
    const row = (fake.insert.mock.calls[0] as unknown as [{ summary: object; changes: object }])[0];
    expect(row.summary).toEqual({ service_name: "剪髮" });
    expect(row.changes).toEqual({ status: { from: "confirmed", to: "cancelled" } });
    expect(JSON.stringify(row)).not.toMatch(/王小明|0912345678|example\.com|tok/);
  });
});

// ============================================================
// 事件建構函式
// ============================================================

const APPT = {
  appointmentId: "apt-1",
  serviceName: "剪髮",
  designerName: "設計師 A",
  startAt: "2026-10-25T07:00:00.000Z",
  endAt: "2026-10-25T08:00:00.000Z",
};

const BUILT: AuditEntry[] = [
  buildAppointmentStatusEvent("appointment.completed", APPT, "confirmed", "completed"),
  buildAppointmentStatusEvent("appointment.cancelled", APPT, "pending", "cancelled"),
  buildAppointmentRescheduledEvent(APPT, { startAt: "2026-10-24T07:00:00.000Z", endAt: "2026-10-24T08:00:00.000Z" }),
  buildBookingPolicyEvent({ min_lead_time_hours: 2, cancel_window_hours: null }, { min_lead_time_hours: 720, cancel_window_hours: 24 })!,
  buildBusinessHoursEvent(
    [{ weekday: 1, open_time: "10:00:00", close_time: "19:00:00", is_closed: false }],
    [{ weekday: 1, open_time: "11:00", close_time: "19:00", is_closed: false }],
  )!,
  buildClosedDateEvent("closed_date.added", "2026-12-25"),
  buildClosedDateEvent("closed_date.removed", "2026-12-25"),
  buildServiceCreatedEvent("svc-1", { name: "剪髮", price: 600, duration_minutes: 45, buffer_minutes: 15 }),
  buildServiceUpdatedEvent(
    "svc-1",
    { name: "剪髮", price: 600, duration_minutes: 45, buffer_minutes: 15 },
    { name: "剪髮 2", price: 700, duration_minutes: 60, buffer_minutes: 10 },
  )!,
  buildServiceActiveEvent("svc-1", "剪髮", true),
  buildServiceActiveEvent("svc-1", "剪髮", false),
  buildDesignerCreatedEvent("des-1", "設計師 A"),
  buildDesignerUpdatedEvent("des-1", "設計師 A", "設計師 B")!,
  buildDesignerActiveEvent("des-1", "設計師 A", true),
  buildDesignerActiveEvent("des-1", "設計師 A", false),
  buildDesignerServiceEvent({ designerId: "des-1", serviceId: "svc-1", designerName: "設計師 A", serviceName: "剪髮", enabled: true }),
  buildDesignerServiceEvent({ designerId: "des-1", serviceId: "svc-1", designerName: "設計師 A", serviceName: "剪髮", enabled: false }),
  buildDesignerLeaveEvent({ designerId: "des-1", designerName: "設計師 A", date: "2026-11-01", added: true }),
  buildDesignerLeaveEvent({ designerId: "des-1", designerName: "設計師 A", date: "2026-11-01", added: false }),
];

describe("事件建構函式：白名單與顧客欄位", () => {
  it("涵蓋規格書事件表的全部 19 個事件代碼", () => {
    expect(AUDIT_EVENT_TYPES).toHaveLength(19);
    const built = new Set(BUILT.map((entry) => entry.eventType));
    expect([...built].sort()).toEqual([...AUDIT_EVENT_TYPES].sort());
  });

  it("每個建構結果的 summary／changes 鍵集合都嚴格屬於該事件白名單", () => {
    for (const entry of BUILT) {
      for (const key of Object.keys(entry.summary ?? {})) {
        expect(isAllowedSummaryKey(entry.eventType, key), `${entry.eventType} summary.${key}`).toBe(true);
      }
      for (const key of Object.keys(entry.changes ?? {})) {
        expect(isAllowedChangeKey(entry.eventType, key), `${entry.eventType} changes.${key}`).toBe(true);
      }
    }
  });

  it("任何事件的白名單都不含顧客欄位、token、頭像網址、簡介", () => {
    const forbidden = /customer|phone|email|access_token|avatar|bio|instagram|specialt/;
    for (const eventType of AUDIT_EVENT_TYPES as AuditEventType[]) {
      for (const probe of ["customer_name", "customer_phone", "customer_email", "access_token", "avatar_url", "bio"]) {
        expect(isAllowedSummaryKey(eventType, probe)).toBe(false);
        expect(isAllowedChangeKey(eventType, probe)).toBe(false);
      }
    }
    for (const entry of BUILT) {
      expect(JSON.stringify([entry.summary, entry.changes])).not.toMatch(forbidden);
    }
  });

  it("預約事件即使被傳入含顧客欄位的物件，輸出也不會帶出", () => {
    const polluted = {
      ...APPT,
      customer_name: "王小明",
      customer_phone: "0912345678",
      customer_email: "a@example.com",
    };
    const entries = [
      buildAppointmentStatusEvent("appointment.cancelled", polluted, "confirmed", "cancelled"),
      buildAppointmentRescheduledEvent(polluted, null),
    ];
    for (const entry of entries) {
      expect(JSON.stringify(entry)).not.toMatch(/王小明|0912345678|example\.com|customer/);
    }
  });

  it("預約事件：summary 含編號、服務、設計師、起訖時間；changes 只有狀態或起訖時間", () => {
    const cancelled = buildAppointmentStatusEvent("appointment.cancelled", APPT, "confirmed", "cancelled");
    expect(cancelled.entityId).toBe("apt-1");
    expect(Object.keys(cancelled.summary!).sort()).toEqual(["appointment_id", "designer_name", "end_at", "service_name", "start_at"]);
    expect(cancelled.changes).toEqual({ status: { from: "confirmed", to: "cancelled" } });

    const rescheduled = buildAppointmentRescheduledEvent(APPT, { startAt: "A", endAt: "B" });
    expect(rescheduled.changes).toEqual({
      start_at: { from: "A", to: APPT.startAt },
      end_at: { from: "B", to: APPT.endAt },
    });
  });

  it("舊值讀不到時只記新值（沒有 from）", () => {
    expect(buildAppointmentStatusEvent("appointment.cancelled", APPT, null, "cancelled").changes).toEqual({
      status: { to: "cancelled" },
    });
    expect(buildAppointmentRescheduledEvent(APPT, null).changes).toEqual({
      start_at: { to: APPT.startAt },
      end_at: { to: APPT.endAt },
    });
    expect(buildBookingPolicyEvent(null, { min_lead_time_hours: 2, cancel_window_hours: null })!.changes).toEqual({
      min_lead_time_hours: { to: 2 },
      cancel_window_hours: { to: null },
    });
    expect(buildDesignerUpdatedEvent("d", null, "新名")!.changes).toEqual({ name: { to: "新名" } });
  });
});

describe("事件建構函式：沒有實際變動回傳 null", () => {
  it("預約規則兩個值都沒變", () => {
    const same = { min_lead_time_hours: 2, cancel_window_hours: null };
    expect(buildBookingPolicyEvent(same, { ...same })).toBeNull();
  });

  it("預約規則只記有變動的欄位", () => {
    const entry = buildBookingPolicyEvent(
      { min_lead_time_hours: 2, cancel_window_hours: 24 },
      { min_lead_time_hours: 720, cancel_window_hours: 24 },
    )!;
    expect(entry.changes).toEqual({ min_lead_time_hours: { from: 2, to: 720 } });
  });

  it("營業時間完全沒變（含 HH:mm:ss 與 HH:mm 的格式差異）", () => {
    const before = [{ weekday: 1, open_time: "10:00:00", close_time: "19:00:00", is_closed: false }];
    const after = [{ weekday: 1, open_time: "10:00", close_time: "19:00", is_closed: false }];
    expect(buildBusinessHoursEvent(before, after)).toBeNull();
  });

  it("營業時間：公休日的起訖時間不算變動", () => {
    const before = [{ weekday: 0, open_time: "10:00:00", close_time: "19:00:00", is_closed: true }];
    const after = [{ weekday: 0, open_time: "", close_time: "", is_closed: true }];
    expect(buildBusinessHoursEvent(before, after)).toBeNull();
  });

  it("營業時間：只列有變動的星期與欄位", () => {
    const before = [
      { weekday: 1, open_time: "10:00:00", close_time: "19:00:00", is_closed: false },
      { weekday: 2, open_time: "10:00:00", close_time: "19:00:00", is_closed: false },
      { weekday: 3, open_time: "10:00:00", close_time: "19:00:00", is_closed: false },
    ];
    const after = [
      { weekday: 3, open_time: "10:00", close_time: "19:00", is_closed: true },
      { weekday: 2, open_time: "10:00", close_time: "19:00", is_closed: false },
      { weekday: 1, open_time: "11:00", close_time: "19:00", is_closed: false },
    ];
    const entry = buildBusinessHoursEvent(before, after)!;
    expect(entry.summary).toEqual({ weekdays: [1, 3] });
    expect(entry.changes).toEqual({
      weekday_1_open_time: { from: "10:00", to: "11:00" },
      weekday_3_open_time: { from: "10:00", to: null },
      weekday_3_close_time: { from: "19:00", to: null },
      weekday_3_is_closed: { from: false, to: true },
    });
  });

  it("營業時間：讀不到舊值時，所有星期都只記新值", () => {
    const entry = buildBusinessHoursEvent(null, [
      { weekday: 1, open_time: "10:00", close_time: "19:00", is_closed: false },
    ])!;
    expect(entry.changes).toEqual({
      weekday_1_open_time: { to: "10:00" },
      weekday_1_close_time: { to: "19:00" },
      weekday_1_is_closed: { to: false },
    });
  });

  it("服務更新：完全沒變回傳 null；有變只記有變的欄位（描述不在白名單）", () => {
    const values = { name: "剪髮", price: 600, duration_minutes: 45, buffer_minutes: 15 };
    expect(buildServiceUpdatedEvent("s", values, { ...values })).toBeNull();
    const entry = buildServiceUpdatedEvent("s", values, { ...values, price: 700 })!;
    expect(entry.changes).toEqual({ price: { from: 600, to: 700 } });
    expect(entry.summary).toEqual({ service_name: "剪髮" });
  });

  it("服務建立：記價格、時長、緩衝時間的新值（不含描述）", () => {
    const entry = buildServiceCreatedEvent("s", { name: "剪髮", price: 600, duration_minutes: 45, buffer_minutes: 15 });
    expect(entry.changes).toEqual({
      price: { to: 600 },
      duration_minutes: { to: 45 },
      buffer_minutes: { to: 15 },
    });
  });

  it("設計師名稱沒變回傳 null", () => {
    expect(buildDesignerUpdatedEvent("d", "A", "A")).toBeNull();
  });
});

// ============================================================
// describeAuditEntry
// ============================================================

describe("describeAuditEntry", () => {
  it("取消預約：中文事件名、對象（服務・設計師・Asia/Taipei 時間）、狀態差異", () => {
    const entry = buildAppointmentStatusEvent("appointment.cancelled", APPT, "confirmed", "cancelled");
    const description = describeAuditEntry({ event_type: entry.eventType, summary: entry.summary!, changes: entry.changes! });
    expect(description.title).toBe("取消預約");
    // 2026-10-25T07:00Z = 台北 15:00
    expect(description.target).toBe("剪髮・設計師 A・10/25 15:00–16:00");
    expect(description.diffs).toEqual(["狀態：已確認 → 已取消"]);
  });

  it("改期：前後時間以 Asia/Taipei 顯示", () => {
    const entry = buildAppointmentRescheduledEvent(APPT, { startAt: "2026-10-24T07:00:00.000Z", endAt: "2026-10-24T08:00:00.000Z" });
    const description = describeAuditEntry({ event_type: entry.eventType, summary: entry.summary!, changes: entry.changes! });
    expect(description.title).toBe("預約改期");
    expect(description.diffs).toEqual([
      "開始時間：10/24 15:00 → 10/25 15:00",
      "結束時間：10/24 16:00 → 10/25 16:00",
    ]);
  });

  // Postgres jsonb 不保留鍵的寫入順序（短鍵排前面）：從資料庫讀回來的 changes 可能是 end_at 在 start_at 前。
  // 顯示順序必須固定為「開始→結束」「價格→時長→緩衝」，不依資料庫回傳順序。
  it("差異依固定順序顯示，不受 jsonb 鍵順序影響", () => {
    const rescheduled = describeAuditEntry({
      event_type: "appointment.rescheduled",
      summary: {},
      changes: {
        end_at: { from: "2026-10-24T08:00:00.000Z", to: "2026-10-25T08:00:00.000Z" },
        start_at: { from: "2026-10-24T07:00:00.000Z", to: "2026-10-25T07:00:00.000Z" },
      },
    });
    expect(rescheduled.diffs).toEqual(["開始時間：10/24 15:00 → 10/25 15:00", "結束時間：10/24 16:00 → 10/25 16:00"]);

    const created = describeAuditEntry({
      event_type: "service.created",
      summary: { service_name: "剪髮" },
      changes: { price: { to: 600 }, buffer_minutes: { to: 0 }, duration_minutes: { to: 30 } },
    });
    expect(created.diffs).toEqual(["價格：NT$600", "時長：30 分鐘", "緩衝時間：0 分鐘"]);

    const hours = describeAuditEntry({
      event_type: "business_hours.updated",
      summary: { weekdays: [1, 3] },
      changes: {
        weekday_3_is_closed: { from: false, to: true },
        weekday_1_is_closed: { from: false, to: true },
        weekday_3_open_time: { from: "10:00", to: null },
        weekday_1_close_time: { from: "19:00", to: null },
        weekday_1_open_time: { from: "10:00", to: null },
      },
    });
    expect(hours.diffs).toEqual([
      "週一開店時間：10:00 → 未設定",
      "週一打烊時間：19:00 → 未設定",
      "週一公休：否 → 是",
      "週三開店時間：10:00 → 未設定",
      "週三公休：否 → 是",
    ]);
  });

  it("跨日換算：UTC 前一天 20:00 是台北隔天 04:00", () => {
    const description = describeAuditEntry({
      event_type: "appointment.rescheduled",
      summary: {},
      changes: { start_at: { from: "2026-10-24T20:00:00.000Z", to: "2026-12-31T16:30:00.000Z" } },
    });
    expect(description.diffs).toEqual(["開始時間：10/25 04:00 → 1/1 00:30"]);
  });

  it("預約規則：單位與 null 顯示「未設定」", () => {
    const entry = buildBookingPolicyEvent({ min_lead_time_hours: 2, cancel_window_hours: null }, { min_lead_time_hours: 720, cancel_window_hours: 24 })!;
    const description = describeAuditEntry({ event_type: entry.eventType, summary: entry.summary!, changes: entry.changes! });
    expect(description.title).toBe("修改預約規則");
    expect(description.target).toBe("");
    expect(description.diffs).toEqual([
      "最短提前預約時間：2 小時 → 720 小時",
      "可取消／改期時限：未設定 → 24 小時",
    ]);
  });

  it("營業時間：布林顯示「是／否」、星期中文、對象列出星期", () => {
    const entry = buildBusinessHoursEvent(
      [{ weekday: 3, open_time: "10:00:00", close_time: "19:00:00", is_closed: false }],
      [{ weekday: 3, open_time: "10:00", close_time: "19:00", is_closed: true }],
    )!;
    const description = describeAuditEntry({ event_type: entry.eventType, summary: entry.summary!, changes: entry.changes! });
    expect(description.target).toBe("週三");
    expect(description.diffs).toEqual([
      "週三開店時間：10:00 → 未設定",
      "週三打烊時間：19:00 → 未設定",
      "週三公休：否 → 是",
    ]);
  });

  it("服務：價格、時長、緩衝時間格式化；新建立（沒有 from）只顯示新值", () => {
    const created = buildServiceCreatedEvent("s", { name: "剪髮", price: 600, duration_minutes: 45, buffer_minutes: 15 });
    const description = describeAuditEntry({ event_type: created.eventType, summary: created.summary!, changes: created.changes! });
    expect(description.title).toBe("新增服務");
    expect(description.target).toBe("剪髮");
    expect(description.diffs).toEqual(["價格：NT$600", "時長：45 分鐘", "緩衝時間：15 分鐘"]);
  });

  it("設計師服務與請假日：設計師名稱在前", () => {
    const service = buildDesignerServiceEvent({ designerId: "d", serviceId: "s", designerName: "設計師 A", serviceName: "剪髮", enabled: true });
    expect(describeAuditEntry({ event_type: service.eventType, summary: service.summary!, changes: {} })).toEqual({
      title: "開放設計師服務",
      target: "設計師 A・剪髮",
      diffs: [],
    });
    const leave = buildDesignerLeaveEvent({ designerId: "d", designerName: "設計師 A", date: "2026-11-01", added: true });
    expect(describeAuditEntry({ event_type: leave.eventType, summary: leave.summary!, changes: {} }).target).toBe("設計師 A・2026/11/01");
  });

  it("公休日：對象顯示 YYYY/MM/DD", () => {
    const entry = buildClosedDateEvent("closed_date.removed", "2026-12-25");
    const description = describeAuditEntry({ event_type: entry.eventType, summary: entry.summary!, changes: {} });
    expect(description).toEqual({ title: "移除公休日", target: "2026/12/25", diffs: [] });
  });

  it("差異含白名單外的 key 時忽略", () => {
    const description = describeAuditEntry({
      event_type: "booking_policy.updated",
      summary: {},
      changes: {
        min_lead_time_hours: { from: 2, to: 3 },
        customer_name: { from: "王小明", to: "李小華" },
        weekday_9_is_closed: { from: false, to: true },
        __proto__x: { from: 1, to: 2 },
      },
    });
    expect(description.diffs).toEqual(["最短提前預約時間：2 小時 → 3 小時"]);
  });

  it("摘要中白名單外的鍵不會出現在對象文字（顧客姓名不會被顯示）", () => {
    const description = describeAuditEntry({
      event_type: "appointment.cancelled",
      summary: { service_name: "剪髮", customer_name: "王小明" },
      changes: {},
    });
    expect(description.target).toBe("剪髮");
  });

  it("未知事件代碼與壞掉的 JSON 不 throw", () => {
    expect(describeAuditEntry({ event_type: "weird.event", summary: {}, changes: {} }).title).toBe("其他操作（weird.event）");
    expect(() =>
      describeAuditEntry({
        event_type: "service.updated",
        summary: null as unknown as Record<string, unknown>,
        changes: { price: "oops", name: null, duration_minutes: { to: 5 } } as Record<string, unknown>,
      }),
    ).not.toThrow();
  });

  it("時區測試：改變行程時區後結果不變", () => {
    const original = process.env.TZ;
    try {
      for (const tz of ["UTC", "America/Los_Angeles", "Asia/Tokyo", "Pacific/Kiritimati"]) {
        process.env.TZ = tz;
        const description = describeAuditEntry({
          event_type: "appointment.rescheduled",
          summary: { start_at: APPT.startAt, end_at: APPT.endAt },
          changes: { start_at: { from: "2026-10-24T20:00:00.000Z", to: APPT.startAt } },
        });
        expect(description.target, tz).toBe("10/25 15:00–16:00");
        expect(description.diffs, tz).toEqual(["開始時間：10/25 04:00 → 10/25 15:00"]);
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});

// ============================================================
// listAuditLog
// ============================================================

function fakeListClient(result: { data: unknown; error: unknown }) {
  const calls: { method: string; args: unknown[] }[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "order", "limit", "like", "not", "lt"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  builder.then = (resolve: (value: unknown) => unknown) => resolve(result);
  const from = vi.fn(() => builder);
  return { client: { from } as unknown as SupabaseClient, from, calls };
}

const rowFor = (id: number) => ({
  id,
  created_at: "2026-10-24T00:00:00.000Z",
  event_type: "service.activated",
  entity_type: "service",
  entity_id: "s",
  summary: {},
  changes: {},
});

describe("listAuditLog", () => {
  it("預設：全部類別、id 倒序、limit 預設 50 並多取一筆", async () => {
    const fake = fakeListClient({ data: [], error: null });
    const result = await listAuditLog(fake.client);
    expect(result).toEqual({ ok: true, data: { rows: [], nextCursor: null } });
    expect(fake.from).toHaveBeenCalledWith("audit_log");
    expect(fake.calls).toEqual([
      { method: "select", args: ["id, created_at, event_type, entity_type, entity_id, summary, changes"] },
      { method: "order", args: ["id", { ascending: false }] },
      { method: "limit", args: [51] },
    ]);
  });

  it("預約類別在資料庫端以 like 篩選", async () => {
    const fake = fakeListClient({ data: [], error: null });
    await listAuditLog(fake.client, { category: "appointment" });
    expect(fake.calls).toContainEqual({ method: "like", args: ["event_type", "appointment.%"] });
  });

  it("設定類別用 not like 排除預約事件", async () => {
    const fake = fakeListClient({ data: [], error: null });
    await listAuditLog(fake.client, { category: "settings" });
    expect(fake.calls).toContainEqual({ method: "not", args: ["event_type", "like", "appointment.%"] });
  });

  it("游標：純數字字串才接受，用 lt(id) 取下一頁", async () => {
    const fake = fakeListClient({ data: [], error: null });
    await listAuditLog(fake.client, { cursor: "120" });
    expect(fake.calls).toContainEqual({ method: "lt", args: ["id", "120"] });
  });

  it.each(["abc", "12a", "-5", "1.5", "", " 12", "12; drop table audit_log", "1e3"])("非法游標 %j 回傳泛用錯誤且不查詢", async (cursor) => {
    const fake = fakeListClient({ data: [], error: null });
    const result = await listAuditLog(fake.client, { cursor });
    expect(result.ok).toBe(false);
    expect(fake.from).not.toHaveBeenCalled();
  });

  it.each([
    [undefined, 51],
    [0, 2],
    [-10, 2],
    [1, 2],
    [100, 101],
    [101, 101],
    [9999, 101],
    [Number.NaN, 51],
    [25.9, 26],
  ])("limit %s → 實際查詢 limit(%s)", async (limit, expected) => {
    const fake = fakeListClient({ data: [], error: null });
    await listAuditLog(fake.client, { limit });
    expect(fake.calls).toContainEqual({ method: "limit", args: [expected] });
  });

  it("多取到一筆代表有下一頁：丟掉多的那筆、nextCursor 為最後一筆 id", async () => {
    const fake = fakeListClient({ data: [rowFor(30), rowFor(29), rowFor(28)], error: null });
    const result = await listAuditLog(fake.client, { limit: 2 });
    expect(result).toEqual({ ok: true, data: { rows: [rowFor(30), rowFor(29)], nextCursor: "29" } });
  });

  it("剛好滿一頁沒有多餘一筆時 nextCursor 為 null", async () => {
    const fake = fakeListClient({ data: [rowFor(30), rowFor(29)], error: null });
    const result = await listAuditLog(fake.client, { limit: 2 });
    expect(result).toEqual({ ok: true, data: { rows: [rowFor(30), rowFor(29)], nextCursor: null } });
  });

  it("查詢錯誤：泛用訊息，不洩漏資料庫內容", async () => {
    const fake = fakeListClient({ data: null, error: { code: "42501", message: "permission denied for table audit_log" } });
    const result = await listAuditLog(fake.client);
    expect(result).toEqual({ ok: false, error: { message: "發生未預期的錯誤，請稍後再試。" } });
  });
});
