// 唯讀匯出工具：把目前正式資料的「店家設定類」資料匯出成 lib/demo/seed-base.json 草稿，
// 供 Demo 還原的基底資料（TASK-106）。產生後必須由使用者逐項審閱、刪改，再核准。
// 執行方式：npm run demo:export-base（會用 --env-file=.env.local 載入環境變數）。
//   --yes   目標檔案已存在時不再詢問，直接覆寫（非互動環境必須帶）。
//
// 只做 select，對資料庫零寫入。**白名單**只匯出：services、designers 與 designer_services／
// designer_leaves／designer_portfolio_images、business_hours、closed_dates、booking_policy、store_settings。
// 絕不匯出 appointments、customers、audit_log、admins（內含顧客個資、Email 與帳號資訊）。
//
// 日期處理：公休日與設計師請假日匯出成「距離今天（台北時間）的天數」，還原時才依當下日期換算成日期；
// 只保留今天起 90 天內的未來日期。
// 店家電話改成佔位值：基底資料不得含真實電話；要用其他號碼請審閱時自行修改。
// 已存在的 seed-base.json 若有 schedule、demo_admin_profile、customer_pool，會原樣保留（那些是人工維護的設定）。

import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";

const OUTPUT_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "lib", "demo", "seed-base.json");
const PLACEHOLDER_PHONE = "02-0000-0000";
const MAX_FUTURE_OFFSET_DAYS = 90;
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

function fail(message) {
  console.error(`[export-demo-base] ${message}`);
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  fail("缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY，請確認 .env.local 已填寫。");
}

const autoYes = process.argv.includes("--yes");

const supabase = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// 預設的人工維護設定（檔案不存在時才使用）。
const DEFAULT_SCHEDULE = {
  history_days: 42,
  future_days: 21,
  min_per_designer_per_day: 1,
  max_per_designer_per_day: 3,
  cancelled_per_hundred: 10,
  pending_per_hundred_of_future: 30,
};
const DEFAULT_DEMO_ADMIN_PROFILE = { display_name: "Demo帳號", avatar_url: null };
const DEFAULT_CUSTOMER_POOL = [
  { name: "陳小美", phone: "0900-000-001" },
  { name: "林大偉", phone: "0900-000-002" },
  { name: "張雅婷", phone: "0900-000-003" },
  { name: "王建宏", phone: "0900-000-004" },
  { name: "李佳穎", phone: "0900-000-005" },
  { name: "黃志明", phone: "0900-000-006" },
  { name: "吳欣怡", phone: "0900-000-007" },
  { name: "劉冠廷", phone: "0900-000-008" },
  { name: "蔡宜庭", phone: "0900-000-009" },
  { name: "鄭博文", phone: "0900-000-010" },
  { name: "許芷寧", phone: "0900-000-011" },
  { name: "楊承翰", phone: "0900-000-012" },
];

async function selectAll(table, columns, orderBy) {
  let query = supabase.from(table).select(columns);
  for (const column of orderBy) query = query.order(column, { ascending: true });
  const { data, error } = await query.limit(1000);
  if (error) throw new Error(`讀取 ${table} 失敗：${error.message}`);
  return data ?? [];
}

async function selectSingle(table, columns) {
  const { data, error } = await supabase.from(table).select(columns).eq("id", 1).maybeSingle();
  if (error) throw new Error(`讀取 ${table} 失敗：${error.message}`);
  if (!data) throw new Error(`${table} 沒有資料列（id = 1）。`);
  return data;
}

function taipeiToday(now) {
  return new Date(now.getTime() + TAIPEI_OFFSET_MS).toISOString().slice(0, 10);
}

function dayOffset(todayIso, dateIso) {
  return Math.round((Date.parse(`${dateIso}T00:00:00Z`) - Date.parse(`${todayIso}T00:00:00Z`)) / 86400000);
}

function readExisting() {
  if (!existsSync(OUTPUT_PATH)) return null;
  try {
    return JSON.parse(readFileSync(OUTPUT_PATH, "utf8"));
  } catch {
    return null;
  }
}

async function confirmOverwrite() {
  if (!existsSync(OUTPUT_PATH) || autoYes) return;
  if (!process.stdin.isTTY) {
    fail(`${OUTPUT_PATH} 已存在，將被覆寫。非互動環境請加 --yes 明確同意。`);
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`[export-demo-base] ${OUTPUT_PATH} 已存在，將被覆寫（人工維護的設定會保留）。繼續？(y/N) `);
  rl.close();
  if (answer.trim().toLowerCase() !== "y") fail("已取消，沒有寫入任何檔案。");
}

async function main() {
  await confirmOverwrite();

  const today = taipeiToday(new Date());

  const [services, designers, designerServices, leaves, portfolio, businessHours, closedDates, bookingPolicy, storeSettings] =
    await Promise.all([
      selectAll("services", "id,name,description,price,duration_minutes,buffer_minutes,is_active,sort_order", ["sort_order", "id"]),
      selectAll("designers", "id,name,bio,specialties,instagram_handle,avatar_url,is_active,sort_order,created_at", ["created_at", "id"]),
      selectAll("designer_services", "designer_id,service_id", ["designer_id", "service_id"]),
      selectAll("designer_leaves", "designer_id,date", ["designer_id", "date"]),
      selectAll("designer_portfolio_images", "id,designer_id,image_url,storage_path,created_at", ["designer_id", "created_at", "id"]),
      selectAll("business_hours", "weekday,open_time,close_time,is_closed", ["weekday"]),
      selectAll("closed_dates", "date", ["date"]),
      selectSingle("booking_policy", "min_lead_time_hours,cancel_window_hours"),
      selectSingle("store_settings", "name,address,phone,description,logo_url,cover_image_url"),
    ]);

  const withinWindow = (offset) => offset >= 0 && offset <= MAX_FUTURE_OFFSET_DAYS;
  const closedDateOffsets = closedDates.map((row) => dayOffset(today, row.date)).filter(withinWindow);
  const designerLeaveOffsets = leaves
    .map((row) => ({ designer_id: row.designer_id, day_offset: dayOffset(today, row.date) }))
    .filter((row) => withinWindow(row.day_offset));

  const existing = readExisting();
  const base = {
    store_settings: { ...storeSettings, phone: storeSettings.phone ? PLACEHOLDER_PHONE : null },
    booking_policy: bookingPolicy,
    business_hours: businessHours.map((row) => ({
      weekday: row.weekday,
      open_time: row.open_time ? row.open_time.slice(0, 5) : null,
      close_time: row.close_time ? row.close_time.slice(0, 5) : null,
      is_closed: row.is_closed,
    })),
    services,
    designers,
    designer_services: designerServices,
    portfolio_images: portfolio,
    closed_date_offsets: closedDateOffsets,
    designer_leave_offsets: designerLeaveOffsets,
    demo_admin_profile: existing?.demo_admin_profile ?? DEFAULT_DEMO_ADMIN_PROFILE,
    schedule: existing?.schedule ?? DEFAULT_SCHEDULE,
    customer_pool: existing?.customer_pool ?? DEFAULT_CUSTOMER_POOL,
  };

  writeFileSync(OUTPUT_PATH, `${JSON.stringify(base, null, 2)}\n`, "utf8");

  console.log(`[export-demo-base] 已寫入 ${OUTPUT_PATH}（草稿，請逐項審閱後再核准）。`);
  console.log("[export-demo-base] 筆數：");
  console.log(`  services ${services.length}、designers ${designers.length}、designer_services ${designerServices.length}`);
  console.log(`  portfolio_images ${portfolio.length}、business_hours ${businessHours.length}`);
  console.log(`  closed_date_offsets ${closedDateOffsets.length}、designer_leave_offsets ${designerLeaveOffsets.length}`);
  console.log(`[export-demo-base] 店家電話已改為佔位值 ${PLACEHOLDER_PHONE}；未匯出 appointments、customers、audit_log、admins。`);
}

main().then(
  () => {
    process.exitCode = 0;
  },
  (error) => {
    console.error(`[export-demo-base] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  },
);
