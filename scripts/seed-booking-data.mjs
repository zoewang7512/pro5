// 一次性腳本：seed 最小可行的 business_hours 與 services 資料，供「顧客預約流程」
// Epic 開發與展示使用。正式的服務項目／營業時間管理 UI 留給後續 Epic。
// 執行方式：npm run seed:booking（會用 --env-file=.env.local 載入環境變數）。
// 冪等：business_hours 以 weekday 為 key 用 upsert；services 依 name 查詢，
// 不存在才新增，重跑不會產生重複資料，也不會覆寫已被後台修改過的既有資料。
// 多位設計師 Epic 起（0017／0018），預約依設計師計算：本次**新增**的服務會對「預設設計師」
// （designers 依 created_at、id 排序的第一位）開啟，否則全新環境跑完 seed 後前台沒有任何設計師
// 提供這些服務、無法預約。已存在的服務不會被動到（店長可能已經關掉某些服務的開關）。

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
  const createdIds = [];
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

    const { data: inserted, error: insertError } = await supabase.from("services").insert(service).select("id").single();
    if (insertError) fail(`新增服務「${service.name}」失敗：${insertError.message}`);
    createdIds.push(inserted.id);
    console.log(`[seed-booking-data] 已新增服務「${service.name}」。`);
  }
  return createdIds;
}

// 本次新增的服務對預設設計師開啟；已存在的服務維持店長現有的設定，不重新開啟。
async function seedDesignerServices(serviceIds) {
  if (serviceIds.length === 0) return;

  const { data: defaultDesigner, error: designerError } = await supabase
    .from("designers")
    .select("id")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (designerError) fail(`查詢預設設計師失敗：${designerError.message}`);
  if (!defaultDesigner) {
    console.warn("[seed-booking-data] 找不到任何設計師（尚未套用 0017？），新增的服務沒有對任何設計師開啟，前台將無法預約。");
    return;
  }

  const { error } = await supabase
    .from("designer_services")
    .upsert(
      serviceIds.map((serviceId) => ({ designer_id: defaultDesigner.id, service_id: serviceId })),
      { onConflict: "designer_id,service_id", ignoreDuplicates: true },
    );
  if (error) fail(`對預設設計師開啟服務失敗：${error.message}`);
  console.log(`[seed-booking-data] 已對預設設計師開啟 ${serviceIds.length} 項新增的服務。`);
}

async function main() {
  await seedBusinessHours();
  const createdServiceIds = await seedServices();
  await seedDesignerServices(createdServiceIds);
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
