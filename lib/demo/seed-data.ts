// Demo 還原資料的產生器（TASK-106）：純函式，不讀系統時間、不打網路、不碰資料庫。
//
// `buildDemoSeed(now, base)` 回傳 `reset_demo_data` 所需的完整 payload：
//   - 設計師、服務、作品集的 id 與 storage_path 一律沿用 seed-base.json（作品集路徑格式檢查綁了
//     designer_id，id 變了路徑就對不上；圖片也靠固定路徑對得上 demo-seed bucket）。
//   - 預約與顧客以 uuid v5 產生（同一天、同一設計師、同一順位永遠得到同一個 id）。
//   - 預約日期以 `now` 的台北日期為基準相對計算；隨機性來自「日期＋設計師」雜湊出的種子，
//     所以同一個 `now` 永遠得到同一份結果，隔天重跑也只是整體往後平移。
//   - customer_email 一律 null、不帶 access_token（讓資料庫預設值產生）。
//
// 刻意不加 `server-only`：沒有任何密鑰，且測試可直接匯入。只用 `node:crypto`，所以不要在前端元件匯入。

import { createHash } from "node:crypto";

import type {
  DemoSeedBase,
  DemoSeedCounts,
  DemoSeedPayload,
  SeedAppointment,
  SeedAppointmentStatus,
  SeedCustomer,
  SeedDesignerLeave,
  SeedService,
} from "./seed-types";

// 固定的 uuid v5 命名空間（隨機產生一次後寫死，不要更動，否則所有預約與顧客 id 都會改變）。
export const DEMO_SEED_NAMESPACE = "6b1c3a52-2f0d-4a8e-9a54-0d1f6b7b2c11";

// 使用者指定的 Demo 帳號顯示名稱。
export const DEMO_ADMIN_DISPLAY_NAME = "Demo帳號";

// 設計師最多 5 位（使用者指定，TASK-116 的上限同步）；每位作品最多 12 張（資料庫觸發器上限）。
export const DEMO_MAX_DESIGNERS = 5;
export const DEMO_MAX_PORTFOLIO_PER_DESIGNER = 12;

const TAIPEI_OFFSET_MINUTES = 8 * 60;
const SLOT_MINUTES = 30;
const MS_PER_MINUTE = 60 * 1000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;

// 預約建立時間設為開始前 2 天，但不得晚於「現在的前 1 小時」。
const CREATED_BEFORE_START_MINUTES = 2 * 24 * 60;
const CREATED_BEFORE_NOW_MINUTES = 60;

const PORTFOLIO_PATH_PATTERN = /^portfolio\/([0-9a-f-]{36})\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

export function uuidV5(name: string, namespace: string = DEMO_SEED_NAMESPACE): string {
  const hash = createHash("sha1")
    .update(Buffer.from(namespace.replace(/-/g, ""), "hex"))
    .update(name, "utf8")
    .digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

// 台北沒有日光節約時間，固定 UTC+8。
export function taipeiDateOf(instant: Date): string {
  return new Date(instant.getTime() + TAIPEI_OFFSET_MINUTES * MS_PER_MINUTE).toISOString().slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

function weekdayOf(isoDate: string): number {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay();
}

function parseMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

// 台北當地「日期＋當日第幾分鐘」換成 UTC 時間點。
function localToInstant(isoDate: string, minutesOfDay: number): Date {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + (minutesOfDay - TAIPEI_OFFSET_MINUTES) * MS_PER_MINUTE);
}

// FNV-1a 雜湊 → mulberry32 亂數產生器：確定性、無相依。
function hashSeed(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRng(seedText: string): () => number {
  let state = hashSeed(seedText);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function assertValidBase(base: DemoSeedBase): void {
  const fail = (message: string): never => {
    throw new Error(`seed-base 不合法：${message}`);
  };

  const weekdays = new Set(base.business_hours.map((row) => row.weekday));
  if (base.business_hours.length !== 7 || weekdays.size !== 7) fail("business_hours 必須剛好 7 列且 weekday 不重複");
  for (const row of base.business_hours) {
    if (!row.is_closed && (!row.open_time || !row.close_time || parseMinutes(row.close_time) <= parseMinutes(row.open_time))) {
      fail(`weekday ${row.weekday} 營業時間不合法`);
    }
  }

  if (base.designers.length === 0 || base.designers.length > DEMO_MAX_DESIGNERS) {
    fail(`設計師數量必須介於 1 到 ${DEMO_MAX_DESIGNERS}`);
  }
  if (base.services.length === 0) fail("至少要有一項服務");
  if (base.customer_pool.length === 0) fail("customer_pool 不可為空");
  if (new Set(base.customer_pool.map((entry) => entry.phone)).size !== base.customer_pool.length) {
    fail("customer_pool 的電話不可重複（customers.phone 有唯一索引）");
  }

  const schedule = base.schedule;
  if (
    schedule.history_days < 0 ||
    schedule.future_days < 0 ||
    schedule.min_per_designer_per_day < 0 ||
    schedule.max_per_designer_per_day < schedule.min_per_designer_per_day
  ) {
    fail("schedule 的天數或每日預約數範圍不合法");
  }
  for (const rate of [schedule.cancelled_per_hundred, schedule.pending_per_hundred_of_future]) {
    if (rate < 0 || rate > 100) fail("schedule 的比例必須介於 0 到 100");
  }

  const designerIds = new Set(base.designers.map((designer) => designer.id));
  const serviceIds = new Set(base.services.map((service) => service.id));
  for (const link of base.designer_services) {
    if (!designerIds.has(link.designer_id) || !serviceIds.has(link.service_id)) fail("designer_services 指向不存在的設計師或服務");
  }
  for (const leave of base.designer_leave_offsets) {
    if (!designerIds.has(leave.designer_id)) fail("designer_leave_offsets 指向不存在的設計師");
  }

  const portfolioCount = new Map<string, number>();
  for (const image of base.portfolio_images) {
    const match = PORTFOLIO_PATH_PATTERN.exec(image.storage_path);
    if (!match || match[1] !== image.designer_id || !designerIds.has(image.designer_id)) {
      fail(`作品集路徑格式不合法或與設計師不符：${image.storage_path}`);
    }
    if (!image.image_url.endsWith(image.storage_path)) fail(`image_url 必須以 storage_path 結尾：${image.storage_path}`);
    portfolioCount.set(image.designer_id, (portfolioCount.get(image.designer_id) ?? 0) + 1);
  }
  for (const count of portfolioCount.values()) {
    if (count > DEMO_MAX_PORTFOLIO_PER_DESIGNER) fail(`每位設計師作品最多 ${DEMO_MAX_PORTFOLIO_PER_DESIGNER} 張`);
  }
}

export function buildDemoSeed(now: Date, base: DemoSeedBase): DemoSeedPayload {
  assertValidBase(base);

  const today = taipeiDateOf(now);
  const schedule = base.schedule;

  const closedDates = [...new Set(base.closed_date_offsets)].sort((a, b) => a - b).map((offset) => addDays(today, offset));
  const closedDateSet = new Set(closedDates);

  const designerLeaves: SeedDesignerLeave[] = [];
  const leaveKeys = new Set<string>();
  for (const leave of base.designer_leave_offsets) {
    const date = addDays(today, leave.day_offset);
    const key = `${leave.designer_id}|${date}`;
    if (leaveKeys.has(key)) continue;
    leaveKeys.add(key);
    designerLeaves.push({ designer_id: leave.designer_id, date });
  }

  const customers: SeedCustomer[] = base.customer_pool.map((entry, index) => ({
    id: uuidV5(`customer:${index}`),
    name: entry.name,
    phone: entry.phone,
    email: null,
    notes: null,
  }));

  const hoursByWeekday = new Map(base.business_hours.map((row) => [row.weekday, row]));
  const activeServices = base.services.filter((service) => service.is_active).sort((a, b) => a.sort_order - b.sort_order);

  const appointments: SeedAppointment[] = [];

  for (let dayIndex = -schedule.history_days; dayIndex <= schedule.future_days; dayIndex += 1) {
    const date = addDays(today, dayIndex);
    const hours = hoursByWeekday.get(weekdayOf(date));
    if (!hours || hours.is_closed || !hours.open_time || !hours.close_time || closedDateSet.has(date)) continue;
    const openMinutes = parseMinutes(hours.open_time);
    const closeMinutes = parseMinutes(hours.close_time);

    for (const designer of base.designers) {
      if (!designer.is_active || leaveKeys.has(`${designer.id}|${date}`)) continue;

      const offeredIds = new Set(base.designer_services.filter((link) => link.designer_id === designer.id).map((link) => link.service_id));
      const offered: SeedService[] = activeServices.filter((service) => offeredIds.has(service.id));
      if (offered.length === 0) continue;

      const rng = createRng(`${date}|${designer.id}`);
      const target = randomInt(rng, schedule.min_per_designer_per_day, schedule.max_per_designer_per_day);
      let cursor = openMinutes + randomInt(rng, 0, 3) * SLOT_MINUTES;

      for (let order = 0; order < target; order += 1) {
        const service = offered[Math.floor(rng() * offered.length)];
        const gapSlots = randomInt(rng, 0, 2);
        const customerIndex = Math.floor(rng() * customers.length);
        const cancelRoll = rng() * 100;
        const pendingRoll = rng() * 100;

        if (cursor + service.duration_minutes > closeMinutes) break;

        const startAt = localToInstant(date, cursor);
        const endAt = new Date(startAt.getTime() + service.duration_minutes * MS_PER_MINUTE);
        const customer = customers[customerIndex];

        let status: SeedAppointmentStatus;
        if (cancelRoll < schedule.cancelled_per_hundred) status = "cancelled";
        else if (endAt.getTime() <= now.getTime()) status = "completed";
        else status = pendingRoll < schedule.pending_per_hundred_of_future ? "pending" : "confirmed";

        const createdAt = new Date(
          Math.min(
            startAt.getTime() - CREATED_BEFORE_START_MINUTES * MS_PER_MINUTE,
            now.getTime() - CREATED_BEFORE_NOW_MINUTES * MS_PER_MINUTE,
          ),
        );

        appointments.push({
          id: uuidV5(`appointment:${date}:${designer.id}:${order}`),
          service_id: service.id,
          designer_id: designer.id,
          customer_id: customer.id,
          customer_name: customer.name,
          customer_phone: customer.phone,
          customer_email: null,
          start_at: startAt.toISOString(),
          end_at: endAt.toISOString(),
          status,
          created_at: createdAt.toISOString(),
        });

        // 下一筆最早從「結束＋緩衝＋隨機空檔」之後的下一個 30 分鐘格線開始。
        const earliestNext = cursor + service.duration_minutes + service.buffer_minutes + gapSlots * SLOT_MINUTES;
        cursor = Math.ceil(earliestNext / SLOT_MINUTES) * SLOT_MINUTES;
      }
    }
  }

  return {
    confirm: "RESET_DEMO",
    services: base.services.map((service) => ({ ...service })),
    designers: base.designers.map((designer) => ({ ...designer, specialties: [...designer.specialties] })),
    designer_services: base.designer_services.map((link) => ({ ...link })),
    designer_leaves: designerLeaves,
    portfolio_images: base.portfolio_images.map((image) => ({ ...image })),
    business_hours: base.business_hours.map((row) => ({ ...row })),
    closed_dates: closedDates.map((date) => ({ date })),
    booking_policy: { id: 1, ...base.booking_policy },
    store_settings: { id: 1, ...base.store_settings },
    customers,
    appointments,
    demo_admin_profile: { ...base.demo_admin_profile, display_name: DEMO_ADMIN_DISPLAY_NAME },
  };
}

// 各表會寫入的筆數，供測試、TASK-116 的上限建議表與還原前後核對使用。
export function summarizeDemoSeed(payload: DemoSeedPayload): DemoSeedCounts {
  return {
    services: payload.services.length,
    designers: payload.designers.length,
    designer_services: payload.designer_services.length,
    designer_leaves: payload.designer_leaves.length,
    portfolio_images: payload.portfolio_images.length,
    business_hours: payload.business_hours.length,
    closed_dates: payload.closed_dates.length,
    customers: payload.customers.length,
    appointments: payload.appointments.length,
  };
}
