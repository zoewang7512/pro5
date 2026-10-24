import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminError, Result } from "./appointments";
import { STATUS_LABEL } from "./format";
import { WEEKDAY_LABELS } from "./week-range";

// 稽核紀錄（簡版）：後台寫入函式成功之後呼叫 recordAdminAction 多寫一筆 audit_log。
// 這是操作日誌，不是防竄改稽核（保證邊界見 ai/artifacts/稽核紀錄/feature-spec.md 與 decisions.md）。
// 紀錄一律由「事件建構函式」組成，只放規格白名單內的欄位；來源函式不直接塞物件，
// 預約事件的輸入型別不含 customer_*，recordAdminAction 也會再依事件白名單過濾一次（縱深防禦）。

const INTERNAL_ERROR: AdminError = { message: "發生未預期的錯誤，請稍後再試。" };

// ============================================================
// 型別與事件目錄
// ============================================================

export type AuditScalar = string | number | boolean | null;
export type AuditSummary = Record<string, AuditScalar | number[]>;
// 沒有 from 代表「舊值未知／新建立」（讀不到舊值時只記新值）；from 為 null 代表「原本未設定」。
export type AuditChange = { from?: AuditScalar; to: AuditScalar };
export type AuditChanges = Record<string, AuditChange>;

export type AuditEntityType =
  | "appointment"
  | "booking_policy"
  | "business_hours"
  | "closed_date"
  | "service"
  | "designer"
  | "designer_service"
  | "designer_leave";

type EventDefinition = {
  label: string;
  summaryKeys: readonly string[];
  // 固定鍵；business_hours 的各星期欄位以 WEEKDAY_CHANGE_KEY 判斷。
  changeKeys: readonly string[];
};

const APPOINTMENT_SUMMARY = ["appointment_id", "service_name", "designer_name", "start_at", "end_at"] as const;
const SERVICE_CHANGE_KEYS = ["name", "price", "duration_minutes", "buffer_minutes"] as const;

const EVENTS = {
  "appointment.completed": { label: "完成預約", summaryKeys: APPOINTMENT_SUMMARY, changeKeys: ["status"] },
  "appointment.cancelled": { label: "取消預約", summaryKeys: APPOINTMENT_SUMMARY, changeKeys: ["status"] },
  "appointment.rescheduled": {
    label: "預約改期",
    summaryKeys: APPOINTMENT_SUMMARY,
    changeKeys: ["start_at", "end_at"],
  },
  "booking_policy.updated": {
    label: "修改預約規則",
    summaryKeys: [],
    changeKeys: ["min_lead_time_hours", "cancel_window_hours"],
  },
  "business_hours.updated": { label: "修改營業時間", summaryKeys: ["weekdays"], changeKeys: [] },
  "closed_date.added": { label: "新增公休日", summaryKeys: ["date"], changeKeys: [] },
  "closed_date.removed": { label: "移除公休日", summaryKeys: ["date"], changeKeys: [] },
  "service.created": {
    label: "新增服務",
    summaryKeys: ["service_name"],
    changeKeys: ["price", "duration_minutes", "buffer_minutes"],
  },
  "service.updated": { label: "修改服務", summaryKeys: ["service_name"], changeKeys: SERVICE_CHANGE_KEYS },
  "service.activated": { label: "上架服務", summaryKeys: ["service_name"], changeKeys: [] },
  "service.deactivated": { label: "下架服務", summaryKeys: ["service_name"], changeKeys: [] },
  "designer.created": { label: "新增設計師", summaryKeys: ["designer_name"], changeKeys: [] },
  "designer.updated": { label: "修改設計師名稱", summaryKeys: ["designer_name"], changeKeys: ["name"] },
  "designer.activated": { label: "啟用設計師", summaryKeys: ["designer_name"], changeKeys: [] },
  "designer.deactivated": { label: "停用設計師", summaryKeys: ["designer_name"], changeKeys: [] },
  "designer_service.enabled": {
    label: "開放設計師服務",
    summaryKeys: ["designer_name", "service_name"],
    changeKeys: [],
  },
  "designer_service.disabled": {
    label: "關閉設計師服務",
    summaryKeys: ["designer_name", "service_name"],
    changeKeys: [],
  },
  "designer_leave.added": { label: "新增設計師請假日", summaryKeys: ["designer_name", "date"], changeKeys: [] },
  "designer_leave.removed": { label: "移除設計師請假日", summaryKeys: ["designer_name", "date"], changeKeys: [] },
} as const satisfies Record<string, EventDefinition>;

export type AuditEventType = keyof typeof EVENTS;

export const AUDIT_EVENT_TYPES = Object.keys(EVENTS) as AuditEventType[];

export type AuditEntry = {
  eventType: AuditEventType;
  entityType: AuditEntityType;
  entityId: string;
  summary?: AuditSummary;
  changes?: AuditChanges;
};

const WEEKDAY_CHANGE_KEY = /^weekday_([0-6])_(open_time|close_time|is_closed)$/;

function isEventType(value: string): value is AuditEventType {
  return Object.prototype.hasOwnProperty.call(EVENTS, value);
}

export function isAllowedSummaryKey(eventType: AuditEventType, key: string): boolean {
  return (EVENTS[eventType].summaryKeys as readonly string[]).includes(key);
}

export function isAllowedChangeKey(eventType: AuditEventType, key: string): boolean {
  if (eventType === "business_hours.updated") return WEEKDAY_CHANGE_KEY.test(key);
  return (EVENTS[eventType].changeKeys as readonly string[]).includes(key);
}

// ============================================================
// 寫入：recordAdminAction（永不 throw）
// ============================================================

const MAX_TEXT_LENGTH = 60;
const MAX_ENTITY_ID_LENGTH = 128;
// 資料庫上限是 4096 位元組（jsonb::text 在逗號與冒號後各多一個空白，比 JSON.stringify 稍長），
// 這裡抓 3500 留出空間。
const MAX_JSON_BYTES = 3500;

function truncateText(value: string): string {
  const chars = Array.from(value);
  return chars.length > MAX_TEXT_LENGTH ? chars.slice(0, MAX_TEXT_LENGTH).join("") : value;
}

function isScalar(value: unknown): value is AuditScalar {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function cleanScalar(value: AuditScalar): AuditScalar {
  return typeof value === "string" ? truncateText(value) : value;
}

function cleanSummary(eventType: AuditEventType, summary: AuditSummary | undefined): AuditSummary {
  const result: AuditSummary = {};
  for (const [key, value] of Object.entries(summary ?? {})) {
    if (!isAllowedSummaryKey(eventType, key)) continue;
    if (Array.isArray(value)) {
      result[key] = value.filter((item) => typeof item === "number");
    } else if (isScalar(value)) {
      result[key] = cleanScalar(value);
    }
  }
  return result;
}

function cleanChanges(eventType: AuditEventType, changes: AuditChanges | undefined): AuditChanges {
  const result: AuditChanges = {};
  for (const [key, change] of Object.entries(changes ?? {})) {
    if (!isAllowedChangeKey(eventType, key)) continue;
    if (!change || typeof change !== "object" || !isScalar(change.to)) continue;
    const cleaned: AuditChange = { to: cleanScalar(change.to) };
    if ("from" in change && change.from !== undefined && isScalar(change.from)) {
      cleaned.from = cleanScalar(change.from);
    }
    result[key] = cleaned;
  }
  return result;
}

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function errorCode(error: unknown): string {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  // 只印短的代碼字串，不印訊息或內容，避免把資料庫回傳的內容帶進 console。
  return typeof code === "string" && /^[A-Za-z0-9_]{1,16}$/.test(code) ? code : "unknown";
}

function warn(error: unknown): void {
  try {
    console.warn("[audit-log] 寫入稽核紀錄失敗", errorCode(error));
  } catch {
    // console 本身壞掉也不能影響呼叫端。
  }
}

// 在原操作成功之後呼叫。任何失敗（網路、權限、資料庫、組資料時的例外）都只警告，不 throw、
// 不改變呼叫端的回傳結果。entry 為 null（事件建構函式判定「沒有實際變動」）時什麼都不做。
export async function recordAdminAction(supabase: SupabaseClient, entry: AuditEntry | null): Promise<void> {
  if (!entry) return;
  try {
    const entityId = truncateEntityId(entry.entityId);
    let summary = cleanSummary(entry.eventType, entry.summary);
    let changes = cleanChanges(entry.eventType, entry.changes);

    // 超過大小上限：依序丟棄 changes、summary，仍保留事件與對象。
    if (jsonBytes(changes) > MAX_JSON_BYTES) changes = {};
    if (jsonBytes(summary) > MAX_JSON_BYTES) summary = {};

    const { error } = await supabase.from("audit_log").insert({
      event_type: entry.eventType,
      entity_type: entry.entityType,
      entity_id: entityId,
      summary,
      changes,
    });
    if (error) warn(error);
  } catch (error) {
    warn(error);
  }
}

function truncateEntityId(entityId: string): string {
  const chars = Array.from(String(entityId ?? ""));
  const trimmed = chars.slice(0, MAX_ENTITY_ID_LENGTH).join("");
  return trimmed.length > 0 ? trimmed : "unknown";
}

// ============================================================
// 舊值／名稱讀取（接線用，永不 throw）
// ============================================================

// 寫入前讀舊值、寫入後查名稱：任何失敗（error、例外、查無）都回 null，呼叫端只記新值，不阻擋原操作。
export async function readAuditValue<T>(
  read: () => PromiseLike<{ data: T | null; error: unknown }>,
): Promise<T | null> {
  try {
    const { data, error } = await read();
    return error || data === null || data === undefined ? null : data;
  } catch {
    return null;
  }
}

// 設計師／服務的名稱查詢（只 select name，不用 `*`）。
export async function lookupName(
  supabase: SupabaseClient,
  table: "designers" | "services",
  id: string,
): Promise<string | null> {
  const row = await readAuditValue<{ name?: unknown }>(() =>
    supabase.from(table).select("name").eq("id", id).maybeSingle(),
  );
  return typeof row?.name === "string" ? row.name : null;
}

// ============================================================
// 事件建構函式（只接受白名單欄位）
// ============================================================

// 摘要只放有值的欄位：名稱或時間讀不到（null／空字串）就省略，不寫入空值。
function compactSummary(values: Record<string, AuditScalar | number[] | undefined>): AuditSummary {
  const result: AuditSummary = {};
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined || value === "") continue;
    result[key] = value;
  }
  return result;
}

// 欄位前後比對：before 為 null（讀不到舊值）時，所有欄位只記新值；否則只記有變動的欄位。
function diffFields<K extends string>(
  keys: readonly K[],
  before: Partial<Record<K, AuditScalar>> | null,
  after: Record<K, AuditScalar>,
): AuditChanges {
  const changes: AuditChanges = {};
  for (const key of keys) {
    const to = after[key];
    if (before === null) {
      changes[key] = { to };
      continue;
    }
    const from = before[key] ?? null;
    if (from !== to) changes[key] = { from, to };
  }
  return changes;
}

// 名稱與時間取自寫入前的單一查詢；讀不到就是 null（摘要省略，事件與對象編號仍會記錄）。
export type AppointmentAuditInfo = {
  appointmentId: string;
  serviceName: string | null;
  designerName: string | null;
  startAt: string | null;
  endAt: string | null;
};

function appointmentSummary(info: AppointmentAuditInfo): AuditSummary {
  return compactSummary({
    appointment_id: info.appointmentId,
    service_name: info.serviceName,
    designer_name: info.designerName,
    start_at: info.startAt,
    end_at: info.endAt,
  });
}

export function buildAppointmentStatusEvent(
  eventType: "appointment.completed" | "appointment.cancelled",
  info: AppointmentAuditInfo,
  fromStatus: string | null,
  toStatus: string,
): AuditEntry {
  const change: AuditChange = fromStatus === null ? { to: toStatus } : { from: fromStatus, to: toStatus };
  return {
    eventType,
    entityType: "appointment",
    entityId: info.appointmentId,
    summary: appointmentSummary(info),
    changes: { status: change },
  };
}

export function buildAppointmentRescheduledEvent(
  info: AppointmentAuditInfo & { startAt: string; endAt: string },
  before: { startAt: string; endAt: string } | null,
): AuditEntry {
  const changes: AuditChanges =
    before === null
      ? { start_at: { to: info.startAt }, end_at: { to: info.endAt } }
      : {
          start_at: { from: before.startAt, to: info.startAt },
          end_at: { from: before.endAt, to: info.endAt },
        };
  return {
    eventType: "appointment.rescheduled",
    entityType: "appointment",
    entityId: info.appointmentId,
    summary: appointmentSummary(info),
    changes,
  };
}

export type BookingPolicyAuditValues = {
  min_lead_time_hours: number | null;
  cancel_window_hours: number | null;
};

export function buildBookingPolicyEvent(
  before: BookingPolicyAuditValues | null,
  after: BookingPolicyAuditValues,
): AuditEntry | null {
  const changes = diffFields(["min_lead_time_hours", "cancel_window_hours"], before, after);
  if (Object.keys(changes).length === 0) return null;
  return { eventType: "booking_policy.updated", entityType: "booking_policy", entityId: "1", summary: {}, changes };
}

export type BusinessHoursAuditRow = {
  weekday: number;
  open_time: string | null;
  close_time: string | null;
  is_closed: boolean;
};

// 資料庫的 time 是 "HH:mm:ss"，表單是 "HH:mm"；公休日的起訖時間沒有意義，一律當 null 比對。
function normalizeHoursRow(row: BusinessHoursAuditRow) {
  const hhmm = (value: string | null) => (row.is_closed || !value ? null : value.slice(0, 5));
  return { open_time: hhmm(row.open_time), close_time: hhmm(row.close_time), is_closed: row.is_closed };
}

export function buildBusinessHoursEvent(
  before: readonly BusinessHoursAuditRow[] | null,
  after: readonly BusinessHoursAuditRow[],
): AuditEntry | null {
  const beforeByWeekday = before === null ? null : new Map(before.map((row) => [row.weekday, row]));
  const changes: AuditChanges = {};
  const weekdays: number[] = [];

  for (const row of [...after].sort((a, b) => a.weekday - b.weekday)) {
    if (!Number.isInteger(row.weekday) || row.weekday < 0 || row.weekday > 6) continue;
    const next = normalizeHoursRow(row);
    const previousRow = beforeByWeekday?.get(row.weekday);
    const rowChanges = diffFields(
      ["open_time", "close_time", "is_closed"],
      beforeByWeekday === null || !previousRow ? null : normalizeHoursRow(previousRow),
      next,
    );
    if (Object.keys(rowChanges).length === 0) continue;
    weekdays.push(row.weekday);
    for (const [field, change] of Object.entries(rowChanges)) {
      changes[`weekday_${row.weekday}_${field}`] = change;
    }
  }

  if (weekdays.length === 0) return null;
  return {
    eventType: "business_hours.updated",
    entityType: "business_hours",
    entityId: "weekly",
    summary: { weekdays },
    changes,
  };
}

export function buildClosedDateEvent(eventType: "closed_date.added" | "closed_date.removed", date: string): AuditEntry {
  return { eventType, entityType: "closed_date", entityId: date, summary: { date }, changes: {} };
}

export type ServiceAuditValues = {
  name: string;
  price: number;
  duration_minutes: number;
  buffer_minutes: number;
};

export function buildServiceCreatedEvent(serviceId: string, values: ServiceAuditValues): AuditEntry {
  return {
    eventType: "service.created",
    entityType: "service",
    entityId: serviceId,
    summary: compactSummary({ service_name: values.name }),
    changes: diffFields(["price", "duration_minutes", "buffer_minutes"], null, values),
  };
}

export function buildServiceUpdatedEvent(
  serviceId: string,
  before: ServiceAuditValues | null,
  after: ServiceAuditValues,
): AuditEntry | null {
  const changes = diffFields(["name", "price", "duration_minutes", "buffer_minutes"], before, after);
  if (Object.keys(changes).length === 0) return null;
  return {
    eventType: "service.updated",
    entityType: "service",
    entityId: serviceId,
    summary: compactSummary({ service_name: after.name }),
    changes,
  };
}

export function buildServiceActiveEvent(serviceId: string, serviceName: string | null, isActive: boolean): AuditEntry {
  return {
    eventType: isActive ? "service.activated" : "service.deactivated",
    entityType: "service",
    entityId: serviceId,
    summary: compactSummary({ service_name: serviceName }),
    changes: {},
  };
}

export function buildDesignerCreatedEvent(designerId: string, designerName: string | null): AuditEntry {
  return {
    eventType: "designer.created",
    entityType: "designer",
    entityId: designerId,
    summary: compactSummary({ designer_name: designerName }),
    changes: {},
  };
}

// 只有名稱有變動才記；舊名稱讀不到（beforeName 為 null）時只記新名稱。
export function buildDesignerUpdatedEvent(
  designerId: string,
  beforeName: string | null,
  afterName: string,
): AuditEntry | null {
  if (beforeName === afterName) return null;
  return {
    eventType: "designer.updated",
    entityType: "designer",
    entityId: designerId,
    summary: compactSummary({ designer_name: afterName }),
    changes: { name: beforeName === null ? { to: afterName } : { from: beforeName, to: afterName } },
  };
}

export function buildDesignerActiveEvent(designerId: string, designerName: string | null, isActive: boolean): AuditEntry {
  return {
    eventType: isActive ? "designer.activated" : "designer.deactivated",
    entityType: "designer",
    entityId: designerId,
    summary: compactSummary({ designer_name: designerName }),
    changes: {},
  };
}

export function buildDesignerServiceEvent(info: {
  designerId: string;
  serviceId: string;
  designerName: string | null;
  serviceName: string | null;
  enabled: boolean;
}): AuditEntry {
  return {
    eventType: info.enabled ? "designer_service.enabled" : "designer_service.disabled",
    entityType: "designer_service",
    entityId: `${info.designerId}:${info.serviceId}`,
    summary: compactSummary({ designer_name: info.designerName, service_name: info.serviceName }),
    changes: {},
  };
}

export function buildDesignerLeaveEvent(info: {
  designerId: string;
  designerName: string | null;
  date: string;
  added: boolean;
}): AuditEntry {
  return {
    eventType: info.added ? "designer_leave.added" : "designer_leave.removed",
    entityType: "designer_leave",
    entityId: `${info.designerId}:${info.date}`,
    summary: compactSummary({ designer_name: info.designerName, date: info.date }),
    changes: {},
  };
}

// ============================================================
// 顯示：describeAuditEntry
// ============================================================

export type AuditLogRow = {
  id: number;
  created_at: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  summary: Record<string, unknown>;
  changes: Record<string, unknown>;
};

export type AuditDescription = {
  /** 中文事件名稱，例如「取消預約」。 */
  title: string;
  /** 對象摘要，例如「剪髮・設計師 A・10/25 15:00–16:00」；沒有對象資訊時為空字串。 */
  target: string;
  /** 前後差異白話，例如「最短提前預約時間：2 小時 → 720 小時」。 */
  diffs: string[];
};

// 一律以 Asia/Taipei 顯示，不依賴執行環境時區。
function taipeiParts(iso: string): { month: number; day: number; time: string } | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Taipei",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return { month: Number(get("month")), day: Number(get("day")), time: `${get("hour")}:${get("minute")}` };
}

function formatDateTime(iso: string): string {
  const parts = taipeiParts(iso);
  return parts ? `${parts.month}/${parts.day} ${parts.time}` : iso;
}

function formatTimeRange(startAt: string, endAt: string): string {
  const start = taipeiParts(startAt);
  const end = taipeiParts(endAt);
  if (!start || !end) return `${startAt}–${endAt}`;
  return `${start.month}/${start.day} ${start.time}–${end.time}`;
}

type ValueFormat = "text" | "datetime" | "status" | "hours" | "minutes" | "price" | "time" | "boolean";

const FIELD_DEFS: Record<string, { label: string; format: ValueFormat }> = {
  status: { label: "狀態", format: "status" },
  start_at: { label: "開始時間", format: "datetime" },
  end_at: { label: "結束時間", format: "datetime" },
  min_lead_time_hours: { label: "最短提前預約時間", format: "hours" },
  cancel_window_hours: { label: "可取消／改期時限", format: "hours" },
  name: { label: "名稱", format: "text" },
  price: { label: "價格", format: "price" },
  duration_minutes: { label: "時長", format: "minutes" },
  buffer_minutes: { label: "緩衝時間", format: "minutes" },
};

const WEEKDAY_FIELD_DEFS: Record<string, { label: string; format: ValueFormat }> = {
  open_time: { label: "開店時間", format: "time" },
  close_time: { label: "打烊時間", format: "time" },
  is_closed: { label: "公休", format: "boolean" },
};

function formatValue(format: ValueFormat, value: unknown): string {
  if (value === null || value === undefined) return "未設定";
  switch (format) {
    case "boolean":
      return value === true ? "是" : value === false ? "否" : "未設定";
    case "datetime":
      return typeof value === "string" ? formatDateTime(value) : "未設定";
    case "status":
      return typeof value === "string" && value in STATUS_LABEL
        ? STATUS_LABEL[value as keyof typeof STATUS_LABEL]
        : String(value);
    case "hours":
      return `${value} 小時`;
    case "minutes":
      return `${value} 分鐘`;
    case "price":
      return `NT$${value}`;
    default:
      return String(value);
  }
}

function fieldDef(key: string): { label: string; format: ValueFormat } | null {
  const weekday = WEEKDAY_CHANGE_KEY.exec(key);
  if (weekday) {
    const def = WEEKDAY_FIELD_DEFS[weekday[2]];
    return { label: `週${WEEKDAY_LABELS[Number(weekday[1])]}${def.label}`, format: def.format };
  }
  return Object.prototype.hasOwnProperty.call(FIELD_DEFS, key) ? FIELD_DEFS[key] : null;
}

// 差異的顯示順序：一般欄位依 FIELD_DEFS 宣告順序；營業時間依「星期→開店→打烊→公休」。
// Postgres jsonb 不保留鍵的寫入順序（短鍵排前面），不能依資料庫回傳順序顯示。
const WEEKDAY_FIELD_ORDER = Object.keys(WEEKDAY_FIELD_DEFS);

function changeRank(key: string): number {
  const weekday = WEEKDAY_CHANGE_KEY.exec(key);
  if (weekday) return 1000 + Number(weekday[1]) * 10 + WEEKDAY_FIELD_ORDER.indexOf(weekday[2]);
  const index = Object.keys(FIELD_DEFS).indexOf(key);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function describeTarget(eventType: string, summary: Record<string, unknown>): string {
  const parts: string[] = [];
  const designerFirst = eventType.startsWith("designer");
  const service = text(summary.service_name);
  const designer = text(summary.designer_name);
  if (designerFirst) parts.push(designer, service);
  else parts.push(service, designer);

  const date = text(summary.date);
  if (date) parts.push(date.replaceAll("-", "/"));

  const startAt = text(summary.start_at);
  const endAt = text(summary.end_at);
  if (startAt && endAt) parts.push(formatTimeRange(startAt, endAt));

  if (Array.isArray(summary.weekdays)) {
    const labels = summary.weekdays
      .filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6)
      .map((day) => `週${WEEKDAY_LABELS[day]}`);
    if (labels.length > 0) parts.push(labels.join("、"));
  }

  return parts.filter(Boolean).join("・");
}

export function describeAuditEntry(entry: Pick<AuditLogRow, "event_type" | "summary" | "changes">): AuditDescription {
  const known = isEventType(entry.event_type);
  const title = known ? EVENTS[entry.event_type as AuditEventType].label : `其他操作（${entry.event_type}）`;
  const summary = entry.summary && typeof entry.summary === "object" ? entry.summary : {};
  const changes = entry.changes && typeof entry.changes === "object" ? entry.changes : {};

  const diffs: string[] = [];
  const orderedChanges = Object.entries(changes).sort(([a], [b]) => changeRank(a) - changeRank(b));
  for (const [key, raw] of orderedChanges) {
    // 白名單外的 key 一律忽略（資料庫內容不可信，不讓未知欄位進到畫面）。
    if (known && !isAllowedChangeKey(entry.event_type as AuditEventType, key)) continue;
    const def = fieldDef(key);
    if (!def || !raw || typeof raw !== "object") continue;
    const change = raw as { from?: unknown; to?: unknown };
    if (!("to" in change)) continue;
    const to = formatValue(def.format, change.to);
    diffs.push(
      "from" in change
        ? `${def.label}：${formatValue(def.format, change.from)} → ${to}`
        : `${def.label}：${to}`,
    );
  }

  return { title, target: describeTarget(entry.event_type, summary), diffs };
}

// ============================================================
// 讀取：listAuditLog
// ============================================================

export type AuditCategory = "all" | "appointment" | "settings";

export type ListAuditLogOptions = {
  category?: AuditCategory;
  /** 上一頁最後一筆的 id（只接受純數字字串）。 */
  cursor?: string | null;
  limit?: number;
};

export type AuditLogPage = { rows: AuditLogRow[]; nextCursor: string | null };

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

export async function listAuditLog(
  supabase: SupabaseClient,
  options: ListAuditLogOptions = {},
): Promise<Result<AuditLogPage>> {
  const { category = "all", cursor = null } = options;
  const limit = clampLimit(options.limit);

  if (cursor !== null && !/^\d+$/.test(cursor)) {
    return { ok: false, error: INTERNAL_ERROR };
  }

  let query = supabase
    .from("audit_log")
    .select("id, created_at, event_type, entity_type, entity_id, summary, changes")
    .order("id", { ascending: false })
    .limit(limit + 1);

  if (category === "appointment") query = query.like("event_type", "appointment.%");
  else if (category === "settings") query = query.not("event_type", "like", "appointment.%");
  if (cursor !== null) query = query.lt("id", cursor);

  const { data, error } = await query;
  if (error) {
    return { ok: false, error: INTERNAL_ERROR };
  }

  const fetched = (data ?? []) as AuditLogRow[];
  const hasMore = fetched.length > limit;
  const rows = hasMore ? fetched.slice(0, limit) : fetched;
  const last = rows[rows.length - 1];
  return { ok: true, data: { rows, nextCursor: hasMore && last ? String(last.id) : null } };
}
