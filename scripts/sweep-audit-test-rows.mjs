// 清掃 audit_log 裡的測試紀錄（整合測試用店長帳號呼叫後台函式時會留下紀錄）。
// 執行方式：npm run sweep:audit-test-rows [-- --apply] [-- --since <ISO 時間>]
// 預設 dry-run（只列出會刪的筆數與 id），加 --apply 才真的刪除。
// 預設條件：summary 內容含 "__TEST__"；--since 可縮小範圍（只看 created_at 不早於該時間的列）。
// 只用 service_role（audit_log 只授權它 select／delete）。不帶名稱的紀錄（預約規則、營業時間還原）
// 不會被清掃，屬已接受的少量雜訊。

import { createClient } from "@supabase/supabase-js";

const MARKER = "__TEST__";
const PAGE_SIZE = 500;
const DELETE_CHUNK = 100;

function fail(message) {
  console.error(`[sweep-audit-test-rows] ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const sinceIndex = args.indexOf("--since");
let since = null;
if (sinceIndex !== -1) {
  const raw = args[sinceIndex + 1];
  const parsed = raw ? new Date(raw) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) {
    fail("--since 需要有效的 ISO 時間，例如 --since 2026-10-24T00:00:00+08:00");
  }
  since = parsed.toISOString();
}
const unknown = args.filter((arg, index) => !["--apply", "--since"].includes(arg) && args[index - 1] !== "--since");
if (unknown.length > 0) {
  fail(`不認得的參數：${unknown.join(" ")}（可用：--apply、--since <ISO 時間>）`);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  fail("缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY，請確認 .env.local 已填寫。");
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// PostgREST 的篩選不支援 summary::text 轉型，改成分頁取回後在這裡比對（資料量預估每年不到一萬筆）。
// 用 includes 精確比對，避免 SQL like 的 _ 萬用字元誤傷。
async function findTestRows() {
  const matches = [];
  let cursor = null;
  for (;;) {
    let query = supabase
      .from("audit_log")
      .select("id, created_at, event_type, summary")
      .order("id", { ascending: false })
      .limit(PAGE_SIZE);
    if (since) query = query.gte("created_at", since);
    if (cursor !== null) query = query.lt("id", cursor);
    const { data, error } = await query;
    if (error) fail(`查詢 audit_log 失敗：${error.code ?? "unknown"}`);
    for (const row of data) {
      if (JSON.stringify(row.summary ?? {}).includes(MARKER)) matches.push(row);
    }
    if (data.length < PAGE_SIZE) break;
    cursor = data[data.length - 1].id;
  }
  return matches;
}

async function main() {
  const rows = await findTestRows();
  console.log(
    `[sweep-audit-test-rows] 找到 ${rows.length} 筆含 ${MARKER} 的紀錄${since ? `（created_at ≥ ${since}）` : ""}。`,
  );
  if (rows.length === 0) return;

  if (!apply) {
    console.log(`[sweep-audit-test-rows] dry-run：id = ${rows.map((row) => row.id).join(", ")}`);
    console.log("[sweep-audit-test-rows] 確認無誤後加上 --apply 才會真的刪除。");
    return;
  }

  let deleted = 0;
  for (let i = 0; i < rows.length; i += DELETE_CHUNK) {
    const ids = rows.slice(i, i + DELETE_CHUNK).map((row) => row.id);
    const { error } = await supabase.from("audit_log").delete().in("id", ids);
    if (error) fail(`刪除失敗（已刪 ${deleted} 筆）：${error.code ?? "unknown"}`);
    deleted += ids.length;
  }
  console.log(`[sweep-audit-test-rows] 已刪除 ${deleted} 筆。`);
}

// 正常結束不呼叫 process.exit（Windows 上在連線未關閉時會觸發 libuv 斷言訊息）。
await main();
