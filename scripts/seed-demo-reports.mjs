// 為「儀表板與報表」放一批示範預約，方便在資料很少時檢視圖表與排行。
// 執行：node --env-file=.env.local scripts/seed-demo-reports.mjs            （dry-run，只列出會新增的內容）
//       node --env-file=.env.local scripts/seed-demo-reports.mjs --apply     （真的寫入）
//       node --env-file=.env.local scripts/seed-demo-reports.mjs --remove    （dry-run：列出會刪的筆數）
//       node --env-file=.env.local scripts/seed-demo-reports.mjs --remove --apply   （真的刪除）
//
// 安全規則（既有教訓）：
//   - 顧客姓名一律以「【示範】」開頭，清除時只認這個前綴；customer_email 一律 null（Database Webhook 只在
//     email 非 null 時才寄信），customer_phone 也不填，不產生 customers 紀錄。
//   - 只新增、只刪「【示範】」前綴的 appointments；不碰服務、設計師、營業時間與其他預約。
//   - 時段避開營業時間以外與公休日，並避開同一位設計師既有預約（含已取消）的時段，不違反 exclusion constraint。
//   - 用 service_role 直接寫入（trigger 會帶入當下服務價格當快照）；為了呈現「改價不影響過去營收」，
//     寫入後把較早的部分染髮／剪髮預約的快照改成舊價格（只改本腳本新增的列）。

import { createClient } from "@supabase/supabase-js";

const MARKER = "【示範】";
const TZ = "+08:00";
const SLOT_MINUTES = 30;
const RANGE_PAST_DAYS = 75;
const RANGE_FUTURE_DAYS = 14;
const INSERT_CHUNK = 50;

const NAMES = [
  "王小明", "林佳穎", "陳怡君", "張育誠", "李雅婷", "黃柏翰", "吳欣怡", "劉冠宇", "蔡宜庭", "楊承恩",
  "許雅雯", "鄭宇軒", "謝佩珊", "郭俊宏", "洪詩涵", "曾建豪", "賴冠霖", "周怡萱", "葉家豪", "蘇郁婷",
];
// 服務選取權重（依服務名稱；沒列到的服務權重 1）。
const SERVICE_WEIGHT = { 剪髮造型: 45, 頭皮護理: 20, 染髮設計: 25, 京喚羽: 10 };

function fail(message) {
  console.error(`[seed-demo-reports] ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const remove = args.includes("--remove");
const unknown = args.filter((arg) => !["--apply", "--remove"].includes(arg));
if (unknown.length > 0) fail(`不認得的參數：${unknown.join(" ")}（可用：--apply、--remove）`);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) fail("缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY，請確認 .env.local 已填寫。");
const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

// 固定種子：每次產生同一批資料，方便重現與討論。
function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261025);
const pick = (items) => items[Math.floor(rand() * items.length)];
function weightedPick(items, weightOf) {
  const total = items.reduce((sum, item) => sum + weightOf(item), 0);
  let roll = rand() * total;
  for (const item of items) {
    roll -= weightOf(item);
    if (roll < 0) return item;
  }
  return items[items.length - 1];
}

const pad = (n) => String(n).padStart(2, "0");
const taipeiToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
function addDays(date, days) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
}
const weekdayOf = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();
const toMs = (date, minutes) => new Date(`${date}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:00${TZ}`).getTime();
const minutesOf = (time) => {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
};

async function must(query, label) {
  const { data, error } = await query;
  if (error) fail(`${label}失敗：${error.message}`);
  return data;
}

async function removeDemo() {
  const rows = await must(
    supabase.from("appointments").select("id").like("customer_name", `${MARKER}%`),
    "讀取示範預約",
  );
  console.log(`找到 ${rows.length} 筆「${MARKER}」預約。`);
  if (!apply) return console.log("dry-run：加上 --apply 才會刪除。");
  for (let i = 0; i < rows.length; i += 100) {
    const ids = rows.slice(i, i + 100).map((row) => row.id);
    await must(supabase.from("appointments").delete().in("id", ids), "刪除示範預約");
  }
  const left = await must(supabase.from("appointments").select("id").like("customer_name", `${MARKER}%`), "確認刪除");
  console.log(left.length === 0 ? `已刪除 ${rows.length} 筆。` : `仍有 ${left.length} 筆未刪除，請重跑。`);
}

async function seedDemo() {
  const existingDemo = await must(
    supabase.from("appointments").select("id").like("customer_name", `${MARKER}%`),
    "檢查既有示範預約",
  );
  if (existingDemo.length > 0) fail(`已有 ${existingDemo.length} 筆示範預約，請先執行 --remove --apply 清除再重新產生。`);

  const services = (await must(supabase.from("services").select("id, name, price, duration_minutes, is_active"), "讀取服務")).filter(
    (service) => service.is_active,
  );
  const designers = (await must(supabase.from("designers").select("id, name, is_active"), "讀取設計師")).filter(
    (designer) => designer.is_active,
  );
  const links = await must(supabase.from("designer_services").select("designer_id, service_id"), "讀取設計師服務");
  const hours = new Map(
    (await must(supabase.from("business_hours").select("weekday, open_time, close_time, is_closed"), "讀取營業時間")).map((row) => [
      row.weekday,
      row,
    ]),
  );
  if (services.length === 0 || designers.length === 0) fail("沒有上架服務或啟用中設計師，無法產生示範資料。");

  const eligible = new Map(
    services.map((service) => [
      service.id,
      designers.filter((designer) => links.some((l) => l.designer_id === designer.id && l.service_id === service.id)),
    ]),
  );
  const usable = services.filter((service) => eligible.get(service.id).length > 0);

  const today = taipeiToday();
  const from = addDays(today, -RANGE_PAST_DAYS);
  const to = addDays(today, RANGE_FUTURE_DAYS);
  const nowMs = Date.now();

  // 同一位設計師已有的預約（含已取消）視為佔用，避免 exclusion constraint 衝突。
  const occupied = new Map(designers.map((designer) => [designer.id, []]));
  const existing = await must(
    supabase
      .from("appointments")
      .select("designer_id, start_at, end_at")
      .gte("start_at", `${from}T00:00:00${TZ}`)
      .lt("start_at", `${addDays(to, 1)}T00:00:00${TZ}`),
    "讀取既有預約",
  );
  for (const row of existing) occupied.get(row.designer_id)?.push([Date.parse(row.start_at), Date.parse(row.end_at)]);

  const planned = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const day = hours.get(weekdayOf(date));
    if (!day || day.is_closed || !day.open_time || !day.close_time) continue;
    const open = minutesOf(day.open_time);
    const close = minutesOf(day.close_time);
    const weekday = weekdayOf(date);
    // 週五、週六較忙；偶爾整天沒有預約。
    const base = weekday === 5 || weekday === 6 ? 3 : 1.2;
    const count = rand() < 0.1 ? 0 : Math.max(0, Math.round(base + (rand() - 0.5) * 2));

    for (let n = 0; n < count; n++) {
      const service = weightedPick(usable, (s) => SERVICE_WEIGHT[s.name] ?? 1);
      const designer = pick(eligible.get(service.id));
      for (let attempt = 0; attempt < 25; attempt++) {
        const slots = Math.floor((close - open - service.duration_minutes) / SLOT_MINUTES);
        if (slots < 0) break;
        const startMin = open + Math.floor(rand() * (slots + 1)) * SLOT_MINUTES;
        const startMs = toMs(date, startMin);
        const endMs = startMs + service.duration_minutes * 60_000;
        const taken = occupied.get(designer.id);
        if (taken.some(([s, e]) => startMs < e && endMs > s)) continue;
        taken.push([startMs, endMs]);

        const past = startMs < nowMs;
        const roll = rand();
        const status = past
          ? roll < 0.82 ? "completed" : "cancelled"
          : roll < 0.55 ? "pending" : roll < 0.9 ? "confirmed" : "cancelled";
        planned.push({
          service_id: service.id,
          designer_id: designer.id,
          customer_name: `${MARKER}${pick(NAMES)}`,
          customer_phone: null,
          customer_email: null,
          start_at: new Date(startMs).toISOString(),
          end_at: new Date(endMs).toISOString(),
          status,
          _date: date,
          _serviceName: service.name,
        });
        break;
      }
    }
  }

  const byMonth = new Map();
  for (const row of planned) {
    const key = `${row._date.slice(0, 7)} ${row.status}`;
    byMonth.set(key, (byMonth.get(key) ?? 0) + 1);
  }
  console.log(`範圍 ${from} ～ ${to}（今天 ${today}），預計新增 ${planned.length} 筆：`);
  for (const [key, count] of [...byMonth].sort()) console.log(`  ${key}：${count}`);
  if (!apply) return console.log("dry-run：加上 --apply 才會寫入。");

  const insertedIds = [];
  for (let i = 0; i < planned.length; i += INSERT_CHUNK) {
    const chunk = planned
      .slice(i, i + INSERT_CHUNK)
      .map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith("_"))));
    const data = await must(supabase.from("appointments").insert(chunk).select("id, service_id, start_at"), "寫入預約");
    insertedIds.push(...data);
  }
  console.log(`已寫入 ${insertedIds.length} 筆。`);

  // 呈現「改價不影響過去營收」：較早的染髮／剪髮預約以舊價格計。只改本腳本新增的列。
  const nameOf = new Map(services.map((service) => [service.id, service.name]));
  const oldPrice = [
    { name: "染髮設計", before: `${addDays(today, -25)}`, price: 2200 },
    { name: "剪髮造型", before: `${addDays(today, -55)}`, price: 700 },
  ];
  for (const rule of oldPrice) {
    const ids = insertedIds
      .filter((row) => nameOf.get(row.service_id) === rule.name && row.start_at < `${rule.before}T00:00:00${TZ}`)
      .map((row) => row.id);
    if (ids.length === 0) continue;
    await must(supabase.from("appointments").update({ price_at_booking: rule.price }).in("id", ids), "調整歷史快照價格");
    console.log(`${rule.name}：${ids.length} 筆（${rule.before} 以前）快照改為 NT$${rule.price}。`);
  }
  console.log(`完成。清除：node --env-file=.env.local scripts/seed-demo-reports.mjs --remove --apply`);
}

await (remove ? removeDemo() : seedDemo());
