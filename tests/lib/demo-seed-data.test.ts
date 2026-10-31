import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import baseJson from "@/lib/demo/seed-base.json";
import {
  buildDemoSeed,
  DEMO_ADMIN_DISPLAY_NAME,
  DEMO_MAX_DESIGNERS,
  DEMO_MAX_PORTFOLIO_PER_DESIGNER,
  summarizeDemoSeed,
  taipeiDateOf,
  uuidV5,
} from "@/lib/demo/seed-data";
import type { DemoSeedBase, DemoSeedPayload } from "@/lib/demo/seed-types";

const base = baseJson as unknown as DemoSeedBase;

// 固定的 now（台北 2026-10-31 14:00，週六）。
const NOW = new Date("2026-10-31T06:00:00.000Z");
const NOW_PLUS_30_DAYS = new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000);
// 跨日邊界：UTC 還是 10-30，台北已是 10-31 清晨。
const NOW_TAIPEI_NEXT_DAY = new Date("2026-10-30T17:30:00.000Z");

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const UUID_V5 = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function localParts(iso: string) {
  const local = new Date(Date.parse(iso) + TAIPEI_OFFSET_MS);
  return {
    date: local.toISOString().slice(0, 10),
    minutes: local.getUTCHours() * 60 + local.getUTCMinutes(),
    weekday: local.getUTCDay(),
  };
}

function parseMinutes(time: string) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function checkInvariants(payload: DemoSeedPayload, now: Date) {
  const services = new Map(payload.services.map((s) => [s.id, s]));
  const hours = new Map(payload.business_hours.map((h) => [h.weekday, h]));
  const closed = new Set(payload.closed_dates.map((c) => c.date));
  const leaves = new Set(payload.designer_leaves.map((l) => `${l.designer_id}|${l.date}`));
  const offered = new Set(payload.designer_services.map((l) => `${l.designer_id}|${l.service_id}`));
  const customers = new Map(payload.customers.map((c) => [c.id, c]));

  expect(payload.appointments.length).toBeGreaterThan(0);
  expect(new Set(payload.appointments.map((a) => a.id)).size).toBe(payload.appointments.length);

  for (const appt of payload.appointments) {
    const service = services.get(appt.service_id);
    expect(service, "服務存在").toBeDefined();
    expect(offered.has(`${appt.designer_id}|${appt.service_id}`), "設計師有該服務").toBe(true);

    const start = localParts(appt.start_at);
    const end = localParts(appt.end_at);
    expect(end.date).toBe(start.date);
    expect(Date.parse(appt.end_at) - Date.parse(appt.start_at)).toBe(service!.duration_minutes * MINUTE_MS);

    const day = hours.get(start.weekday)!;
    expect(day.is_closed, "非公休星期").toBe(false);
    expect(start.minutes).toBeGreaterThanOrEqual(parseMinutes(day.open_time!));
    expect(end.minutes).toBeLessThanOrEqual(parseMinutes(day.close_time!));
    expect(start.minutes % 30).toBe(0);
    expect(closed.has(start.date), "非公休日").toBe(false);
    expect(leaves.has(`${appt.designer_id}|${start.date}`), "非請假日").toBe(false);

    expect(appt.customer_email).toBeNull();
    expect("access_token" in appt).toBe(false);
    const customer = customers.get(appt.customer_id)!;
    expect(appt.customer_name).toBe(customer.name);
    expect(appt.customer_phone).toBe(customer.phone);

    if (appt.status === "cancelled") continue;
    if (Date.parse(appt.end_at) <= now.getTime()) expect(appt.status).toBe("completed");
    else expect(["pending", "confirmed"]).toContain(appt.status);
  }

  // 同一設計師的有效預約不重疊，且相鄰預約之間保有服務緩衝。
  const byDesigner = new Map<string, typeof payload.appointments>();
  for (const appt of payload.appointments) {
    if (appt.status === "cancelled") continue;
    byDesigner.set(appt.designer_id, [...(byDesigner.get(appt.designer_id) ?? []), appt]);
  }
  for (const list of byDesigner.values()) {
    list.sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
    for (let i = 1; i < list.length; i += 1) {
      const buffer = services.get(list[i - 1].service_id)!.buffer_minutes;
      expect(Date.parse(list[i].start_at)).toBeGreaterThanOrEqual(Date.parse(list[i - 1].end_at) + buffer * MINUTE_MS);
    }
  }
  // 連取消的預約也不會與同一設計師的其他預約同時開始。
  const slotKeys = payload.appointments.map((a) => `${a.designer_id}|${a.start_at}`);
  expect(new Set(slotKeys).size).toBe(slotKeys.length);

  const perDesigner = new Map<string, number>();
  for (const image of payload.portfolio_images) perDesigner.set(image.designer_id, (perDesigner.get(image.designer_id) ?? 0) + 1);
  for (const count of perDesigner.values()) expect(count).toBeLessThanOrEqual(DEMO_MAX_PORTFOLIO_PER_DESIGNER);

  expect(payload.confirm).toBe("RESET_DEMO");
  expect(payload.business_hours).toHaveLength(7);
  expect(payload.designers.length).toBeLessThanOrEqual(DEMO_MAX_DESIGNERS);
  expect(payload.demo_admin_profile.display_name).toBe(DEMO_ADMIN_DISPLAY_NAME);
  for (const customer of payload.customers) expect(customer.email).toBeNull();
}

describe("buildDemoSeed", () => {
  it("對固定 now 與基底產生可重現的 payload（snapshot）", () => {
    const payload = buildDemoSeed(NOW, base);
    expect(buildDemoSeed(NOW, base)).toEqual(payload);
    expect({
      counts: summarizeDemoSeed(payload),
      closed_dates: payload.closed_dates,
      designer_leaves: payload.designer_leaves,
      first_appointments: payload.appointments.slice(0, 3),
      last_appointment: payload.appointments[payload.appointments.length - 1],
      status_counts: payload.appointments.reduce<Record<string, number>>((acc, a) => ({ ...acc, [a.status]: (acc[a.status] ?? 0) + 1 }), {}),
      customers: payload.customers.slice(0, 2),
    }).toMatchSnapshot();
  });

  it("不變量：無重疊、營業時間內、非公休與請假日、設計師有該服務、customer_email 全為 null", () => {
    checkInvariants(buildDemoSeed(NOW, base), NOW);
  });

  it("換不同的 now（加 30 天、台北跨日邊界）仍通過不變量", () => {
    checkInvariants(buildDemoSeed(NOW_PLUS_30_DAYS, base), NOW_PLUS_30_DAYS);
    checkInvariants(buildDemoSeed(NOW_TAIPEI_NEXT_DAY, base), NOW_TAIPEI_NEXT_DAY);
    expect(taipeiDateOf(NOW_TAIPEI_NEXT_DAY)).toBe("2026-10-31");
  });

  it("設計師、服務、作品集的 id 與路徑不隨 now 改變，設計師 created_at 順序與基底一致", () => {
    const a = buildDemoSeed(NOW, base);
    const b = buildDemoSeed(NOW_PLUS_30_DAYS, base);
    expect(b.designers).toEqual(a.designers);
    expect(b.services).toEqual(a.services);
    expect(b.portfolio_images).toEqual(a.portfolio_images);
    expect(b.designer_services).toEqual(a.designer_services);
    expect(a.designers.map((d) => d.id)).toEqual(base.designers.map((d) => d.id));
    expect(a.designers.map((d) => d.created_at)).toEqual(base.designers.map((d) => d.created_at));
    const order = (list: typeof a.designers) =>
      [...list].sort((x, y) => x.created_at.localeCompare(y.created_at) || x.id.localeCompare(y.id)).map((d) => d.id);
    expect(order(a.designers)).toEqual(order(base.designers));
  });

  it("預約橫跨過去與未來，狀態分布符合設定（含待服務、已完成、已取消）", () => {
    const payload = buildDemoSeed(NOW, base);
    const statuses = new Set(payload.appointments.map((a) => a.status));
    for (const status of ["pending", "confirmed", "completed", "cancelled"]) expect(statuses).toContain(status);

    const dates = payload.appointments.map((a) => localParts(a.start_at).date).sort();
    expect(dates[0] <= "2026-09-30").toBe(true);
    expect(dates[dates.length - 1] >= "2026-11-14").toBe(true);

    const cancelledRate = (payload.appointments.filter((a) => a.status === "cancelled").length / payload.appointments.length) * 100;
    expect(Math.abs(cancelledRate - base.schedule.cancelled_per_hundred)).toBeLessThan(6);
  });

  it("公休日與請假日以 now 相對計算", () => {
    const a = buildDemoSeed(NOW, base);
    const b = buildDemoSeed(NOW_PLUS_30_DAYS, base);
    expect(a.closed_dates).toEqual([{ date: "2026-11-09" }]);
    expect(b.closed_dates).toEqual([{ date: "2026-12-09" }]);
    expect(a.designer_leaves).toHaveLength(base.designer_leave_offsets.length);
  });

  it("預約與顧客 id 為 uuid v5，且是固定值", () => {
    const payload = buildDemoSeed(NOW, base);
    expect(payload.customers[0].id).toBe(uuidV5("customer:0"));
    expect(payload.customers[0].id).toMatch(UUID_V5);
    for (const appt of payload.appointments) expect(appt.id).toMatch(UUID_V5);
    // RFC 4122 附錄 B 的範例向量（DNS 命名空間、"www.example.com"）。
    expect(uuidV5("www.example.com", "6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe("2ed6657d-e927-568b-95e1-2665a8aea6a2");
  });

  it("基底資料不合法時丟出錯誤（不送出殘缺 payload）", () => {
    const clone = () => JSON.parse(JSON.stringify(base)) as DemoSeedBase;
    const noHours = clone();
    noHours.business_hours.pop();
    expect(() => buildDemoSeed(NOW, noHours)).toThrow(/business_hours/);

    const tooMany = clone();
    for (let i = 0; i < DEMO_MAX_DESIGNERS; i += 1) tooMany.designers.push({ ...tooMany.designers[0], id: `extra-${i}` });
    expect(() => buildDemoSeed(NOW, tooMany)).toThrow(/設計師數量/);

    const badPath = clone();
    badPath.portfolio_images[0].storage_path = "portfolio/someone-else/x.webp";
    expect(() => buildDemoSeed(NOW, badPath)).toThrow(/作品集路徑/);

    const dupPhone = clone();
    dupPhone.customer_pool[1].phone = dupPhone.customer_pool[0].phone;
    expect(() => buildDemoSeed(NOW, dupPhone)).toThrow(/電話/);
  });
});

describe("seed-base.json 與匯出工具的安全檢查", () => {
  it("基底資料不含 Email 與真實電話格式（顧客池與店家電話皆為虛構值）", () => {
    const raw = readFileSync(path.resolve(__dirname, "../../lib/demo/seed-base.json"), "utf8");
    expect(raw).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    expect(base.store_settings.phone === null || base.store_settings.phone === "02-0000-0000").toBe(true);
    for (const entry of base.customer_pool) expect(entry.phone).toMatch(/^0900-000-\d{3}$/);
    expect(base.demo_admin_profile.display_name).toBe(DEMO_ADMIN_DISPLAY_NAME);
  });

  it("匯出工具只用 select，且沒有碰預約、顧客、稽核、管理員表", () => {
    const script = readFileSync(path.resolve(__dirname, "../../scripts/export-demo-base.mjs"), "utf8");
    const code = script.replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
    expect(code).not.toMatch(/\.(auth|storage)\b/);
    expect(code).not.toMatch(/["'](appointments|customers|audit_log|admins)["']/);
    for (const table of [
      "services",
      "designers",
      "designer_services",
      "designer_leaves",
      "designer_portfolio_images",
      "business_hours",
      "closed_dates",
      "booking_policy",
      "store_settings",
    ]) {
      expect(code).toContain(`"${table}"`);
    }
  });
});
