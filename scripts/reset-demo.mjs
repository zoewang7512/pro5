// 手動觸發 Demo 還原端點（TASK-110）。執行方式：
//   npm run demo:reset -- --url http://localhost:3000          只做 dry-run，印出各表筆數，不寫入任何東西
//   npm run demo:reset -- --url https://<站台> --yes --confirm-host=<站台主機名稱>
//                                                              真實還原（送出 confirm=RESET_DEMO）；
//                                                              對本機網址 --yes 即可，非本機另需 --confirm-host 與目標主機相同
//
// 目標網址必須用 --url 明確給定（沒有預設值），執行前會先印出目標與模式。密鑰讀自環境變數 CRON_SECRET，
// 不印出、不放進網址（package.json 用 --env-file=.env.local 載入；已存在於 shell 的同名變數優先，
// 對正式站執行時請在 shell 設定正式站的 CRON_SECRET）。
// 非本機網址只接受 https（避免密鑰以明文送出）；不跟隨轉址（避免密鑰被帶到別處）。
//
// 真實還原會把 Demo 帳戶的資料整個覆寫回 seed，對正式站執行等同觸發正式環境：
// 首次真實還原前必須已完成備份並取得使用者同意（見 docs 與 TASK-112/117）。
// 手動真實還原不受 DEMO_RESET_ENABLED 約束（該旗標只管排程）。

import { pathToFileURL } from "node:url";

const ENDPOINT_PATH = "/api/cron/demo-reset";
const CONFIRM_VALUE = "RESET_DEMO";
const REQUEST_TIMEOUT_MS = 90_000;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function parseArgs(argv) {
  let url = null;
  let yes = false;
  let confirmHost = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--yes") yes = true;
    else if (arg.startsWith("--confirm-host=")) confirmHost = arg.slice("--confirm-host=".length);
    else if (arg === "--url") {
      url = argv[i + 1] ?? null;
      i += 1;
      if (url === null || url.startsWith("--")) return { error: "--url 需要一個網址" };
    } else if (arg.startsWith("--url=")) url = arg.slice("--url=".length);
    else return { error: `不認得的參數：${arg}` };
  }
  if (!url) return { error: "必須用 --url 明確指定目標網址（例如 --url http://localhost:3000）" };
  return { url, yes, confirmHost };
}

// 回傳 { endpoint, origin, mode } 或 { error }。只取網址的 origin，路徑與查詢字串一律捨棄，由本函式自行組出。
// 錯誤訊息不回顯原始網址（可能夾帶帳密）。
// 非本機網址的真實還原（--yes）還要多一道確認：--confirm-host=<主機名稱> 必須與目標主機完全相同。
/** @param {string} rawUrl @param {boolean} yes @param {string | null} [confirmHost] */
export function buildTarget(rawUrl, yes, confirmHost = null) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { error: "網址格式不正確" };
  }
  const isLocal = LOCAL_HOSTS.has(parsed.hostname);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLocal)) {
    return { error: "非本機網址必須使用 https（密鑰不能以明文送出）" };
  }
  if (yes && !isLocal && confirmHost !== parsed.hostname) {
    return { error: `對非本機網址真實還原，必須再加 --confirm-host=${parsed.hostname}（確認你要對這個主機動手）` };
  }
  const endpoint = new URL(ENDPOINT_PATH, parsed.origin);
  endpoint.searchParams.set(...(yes ? ["confirm", CONFIRM_VALUE] : ["dry_run", "1"]));
  return { endpoint, origin: parsed.origin, mode: yes ? "real" : "dry_run" };
}

function fail(message) {
  console.error(`[demo:reset] ${message}`);
  process.exit(1);
}

function printSummary(body) {
  const summary = body?.summary;
  if (!summary) return;
  console.log(`耗時 ${summary.durationMs} ms；資料庫已還原：${summary.databaseRestored ? "是" : "否"}`);
  for (const [stage, info] of Object.entries(summary.stages ?? {})) {
    console.log(`  階段 ${stage}：${info.status}${info.detail ? `（${info.detail}）` : ""}`);
  }
  if (summary.sync) console.log("圖片同步：", JSON.stringify(summary.sync));
  if (summary.database?.counts) {
    console.log("各表筆數（還原後）：");
    for (const [table, count] of Object.entries(summary.database.counts)) console.log(`  ${table}: ${count}`);
  }
  if (summary.database?.deleted && Object.keys(summary.database.deleted).length > 0) {
    console.log("各表刪除筆數：", JSON.stringify(summary.database.deleted));
  }
  if (summary.warnings?.length) console.log("警告：", summary.warnings.join(", "));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) fail(args.error);
  const target = buildTarget(args.url, args.yes, args.confirmHost);
  if (target.error) fail(target.error);

  const secret = process.env.CRON_SECRET;
  if (!secret) fail("缺少環境變數 CRON_SECRET（.env.local 或 shell）");

  console.log(`目標：${target.origin}`);
  console.log(
    target.mode === "real"
      ? "模式：真實還原（--yes）。Demo 帳戶的資料會被覆寫回 seed。"
      : "模式：dry-run（只試跑，不寫入任何東西；要真實還原請加 --yes）",
  );

  let response;
  try {
    response = await fetch(target.endpoint, {
      method: "GET",
      headers: { authorization: `Bearer ${secret}` },
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    fail(`請求失敗：${error instanceof Error ? error.message : String(error)}`);
  }

  if (response.status >= 300 && response.status < 400) {
    fail(`收到轉址（HTTP ${response.status}），不跟隨。請確認 --url 是最終網址。`);
  }
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    // 非 JSON（例如平台錯誤頁）：只印狀態碼，不印整頁內容。
  }
  console.log(`HTTP ${response.status}`);
  if (body === null) fail("回應不是 JSON，無法判讀結果。");
  printSummary(body);
  if (!response.ok || body.ok !== true) {
    fail(`還原未成功：${body.error ?? "unknown"}${body.stage ? `（階段 ${body.stage}）` : ""}`);
  }
  if (body.skipped) console.log("端點回報 skipped（排程旗標未開）；手動指令正常不會走到這裡。");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
