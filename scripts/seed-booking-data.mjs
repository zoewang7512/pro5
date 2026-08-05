// 一次性腳本：seed 最小可行的 business_hours 與 services 資料，供「顧客預約流程」
// Epic 開發與展示使用。正式的服務項目／營業時間管理 UI 留給後續 Epic。
// 執行方式：npm run seed:booking（會用 --env-file=.env.local 載入環境變數）。
// 冪等：business_hours 以 weekday 為 key 用 upsert；services 依 name 查詢，
// 不存在才新增，重跑不會產生重複資料，也不會覆寫已被後台修改過的既有資料。

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function fail(message) {
  console.error(`[seed-booking-data] ${message}`);
  process.exit(1);
}

if (!url || !serviceRoleKey) {
  fail("缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY，請確認 .env.local 已填寫。");
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// weekday: 0=週日...6=週六（對齊 Postgres extract(dow from date)）
const BUSINESS_HOURS = [
  { weekday: 0, open_time: null, close_time: null, is_closed: true }, // 週日公休
  { weekday: 1, open_time: "10:00", close_time: "19:00", is_closed: false },
  { weekday: 2, open_time: "10:00", close_time: "19:00", is_closed: false },
  { weekday: 3, open_time: "10:00", close_time: "19:00", is_closed: false },
  { weekday: 4, open_time: "10:00", close_time: "19:00", is_closed: false },
  { weekday: 5, open_time: "10:00", close_time: "19:00", is_closed: false },
  { weekday: 6, open_time: "10:00", close_time: "19:00", is_closed: false },
];

const SERVICES = [
  { name: "剪髮造型", price: 800, duration_minutes: 45, is_active: true, sort_order: 1 },
  { name: "染髮設計", price: 2400, duration_minutes: 120, is_active: true, sort_order: 2 },
  { name: "頭皮護理", price: 1200, duration_minutes: 60, is_active: true, sort_order: 3 },
];

async function seedBusinessHours() {
  const { error } = await supabase
    .from("business_hours")
    .upsert(BUSINESS_HOURS, { onConflict: "weekday" });
  if (error) fail(`寫入 business_hours 失敗：${error.message}`);
  console.log(`[seed-booking-data] business_hours 已 upsert ${BUSINESS_HOURS.length} 筆。`);
}

async function seedServices() {
  for (const service of SERVICES) {
    const { data: existing, error: selectError } = await supabase
      .from("services")
      .select("id")
      .eq("name", service.name)
      .maybeSingle();

    if (selectError) fail(`查詢 services 表失敗：${selectError.message}`);

    if (existing) {
      console.log(`[seed-booking-data] 服務「${service.name}」已存在，略過。`);
      continue;
    }

    const { error: insertError } = await supabase.from("services").insert(service);
    if (insertError) fail(`新增服務「${service.name}」失敗：${insertError.message}`);
    console.log(`[seed-booking-data] 已新增服務「${service.name}」。`);
  }
}

async function main() {
  await seedBusinessHours();
  await seedServices();
}

main().then(
  () => {
    console.log("[seed-booking-data] 完成。");
    process.exit(0);
  },
  (error) => {
    fail(`未預期錯誤：${error instanceof Error ? error.message : String(error)}`);
  },
);
