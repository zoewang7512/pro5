import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { verifyBearerSecret } from "@/lib/webhooks/verify-secret";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { runDemoReset, type DemoResetResult, type DemoResetSummary } from "@/lib/demo/reset";

// Demo 帳戶整庫還原端點（TASK-110）。Vercel Cron 以 GET 呼叫並帶 `Authorization: Bearer <CRON_SECRET>`
// （比照 appointment-reminders）。三種行為，由 query 決定（Vercel Cron 不帶任何 query）：
//   ?dry_run=1            只做 dry-run（唯讀檢查＋資料庫交易回滾），不受 DEMO_RESET_ENABLED 約束；優先於 confirm
//   ?confirm=RESET_DEMO   手動真實還原，不受 DEMO_RESET_ENABLED 約束（旗標只管排程）；需密鑰＋精確確認字串
//   （無參數）            排程呼叫：DEMO_RESET_ENABLED 不是 "true" 時回 skipped，不碰任何東西
// dry_run／confirm 只要出現就必須是精確值，否則 400：寧可拒絕，也不去猜 "dry_run=0"、"confirm=reset_demo" 的意思。
// 密鑰先驗證，驗證前不建立 service role client；密鑰不放 query。
//
// 本檔只呼叫 runDemoReset，不直接呼叫資料庫的還原函式，也不用測試注入入口
// （tests/lib/demo-reset-test-scan.test.ts 把關，不要把本檔加進白名單）。

// Vercel Hobby 函式上限 60 秒；同 appointment-reminders 的做法用時間預算控管。
export const maxDuration = 60;
// 還原流程的期限（距開始）。lib/demo/reset.ts 在進入資料庫前至少預留 15 秒給交易、帳戶處理與健康檢查，
// 所以真實還原最晚在開始後約 23 秒進入資料庫，最壞情形在約 38 秒之後再加尾段，仍落在 60 秒內。
const RESET_BUDGET_MS = 38_000;
const CONFIRM_VALUE = "RESET_DEMO";

// 同一個執行環境內不重疊執行（排程與手動可能同時打進來）。跨執行環境的互斥由資料庫的 advisory lock
// 保護交易本身；這裡只是多一道便宜的防線。
// 記錄開始時間而不是布林：平台逾時中止時 finally 不會執行，若執行環境被重用，鎖會永遠卡住；
// 超過函式上限（60 秒）再加一點餘裕就視為已失效。
const LOCK_STALE_MS = 70_000;
let runningSince: number | null = null;

type Mode = { kind: "dry_run" } | { kind: "manual" } | { kind: "scheduled" } | { kind: "invalid" };

function resolveMode(params: URLSearchParams): Mode {
  // 排程呼叫（Vercel Cron）完全不帶 query。任何其他參數名稱（打錯的 ?dryrun=1、?DRY_RUN=1 …）都拒絕，
  // 否則手動打錯字會被當成排程呼叫，旗標開啟後就變成真實還原。
  for (const key of params.keys()) {
    if (key !== "dry_run" && key !== "confirm") return { kind: "invalid" };
  }
  const dryRun = params.getAll("dry_run");
  const confirm = params.getAll("confirm");
  if (dryRun.length > 1 || confirm.length > 1) return { kind: "invalid" };
  if (dryRun.length === 1 && dryRun[0] !== "1") return { kind: "invalid" };
  if (confirm.length === 1 && confirm[0] !== CONFIRM_VALUE) return { kind: "invalid" };
  if (dryRun.length === 1) return { kind: "dry_run" };
  if (confirm.length === 1) return { kind: "manual" };
  return { kind: "scheduled" };
}

// 階段訊息只回「代碼」：資料庫錯誤訊息（reset.ts 的 `reset_failed:<code>:<message>`）或含空白的自由文字
// 可能夾帶鍵值內容，回應只保留前面的代碼，完整訊息只寫進伺服器日誌。
function safeDetail(detail: string | undefined): string | undefined {
  if (detail === undefined) return undefined;
  // reset.ts 寫死的 dry-run 說明文字（固定常數，不含外部內容）。
  if (detail.startsWith("dry-run")) return detail.slice(0, 60);
  const code = detail.replace(/^(reset_failed:[^:]*):[\s\S]*$/, "$1");
  return /^[A-Za-z0-9_:,.\-/…]{1,200}$/.test(code) ? code : "(詳見伺服器日誌)";
}

// 回應只放摘要：階段狀態與代碼、筆數、警告。不回原始例外。
function publicSummary(summary: DemoResetSummary) {
  return {
    dryRun: summary.dryRun,
    durationMs: summary.durationMs,
    databaseRestored: summary.databaseRestored,
    stages: Object.fromEntries(
      Object.entries(summary.stages).map(([stage, info]) => [stage, { status: info.status, detail: safeDetail(info.detail) }]),
    ),
    sync: summary.sync,
    database: summary.database,
    cleanup: summary.cleanup,
    account: summary.account,
    health: summary.health ? { ok: summary.health.ok } : undefined,
    warnings: summary.warnings,
  };
}

function logResult(mode: Mode["kind"], result: DemoResetResult) {
  const { summary } = result;
  const incomplete = Object.entries(summary.stages).filter(([, s]) => s.status === "failed" || s.status === "partial");
  const context = { mode, dryRun: summary.dryRun, durationMs: summary.durationMs, stages: summary.stages, warnings: summary.warnings };
  if (!result.ok) {
    // 資料庫已還原但附屬階段失敗，與「資料沒動」要分得出來：兩者都回 500 讓排程監控看得到。
    console.error(
      summary.databaseRestored ? "demo-reset: 資料庫已還原，但後續階段失敗" : "demo-reset: 還原失敗，資料庫未變動",
      { ...context, failedStage: result.stage, error: result.error },
    );
  } else if (incomplete.length > 0 || summary.warnings.length > 0) {
    console.warn("demo-reset: 完成但有未完成的階段或警告", context);
  } else {
    console.log("demo-reset: 完成", context);
  }
}

export async function GET(req: NextRequest) {
  // 密鑰驗證失敗一律 401，不解析參數、不建立 service role client、不執行任何邏輯。
  if (!verifyBearerSecret(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const mode = resolveMode(req.nextUrl.searchParams);
  if (mode.kind === "invalid") {
    return NextResponse.json({ ok: false, error: "invalid_params" }, { status: 400 });
  }

  // 排程呼叫且旗標沒開：什麼都不做（不建立 client、不呼叫還原）。
  if (mode.kind === "scheduled" && process.env.DEMO_RESET_ENABLED !== "true") {
    // 留一行日誌：開旗標後忘了 Redeploy 時，排程紀錄只有 200，要靠這行才看得出是被跳過。
    console.log("demo-reset: 排程呼叫被跳過（DEMO_RESET_ENABLED 不是 true）");
    return NextResponse.json({ ok: true, skipped: true });
  }

  if (runningSince !== null && Date.now() - runningSince < LOCK_STALE_MS) {
    return NextResponse.json({ ok: false, error: "already_running" }, { status: 409 });
  }
  runningSince = Date.now();

  try {
    const startedAt = Date.now();
    const supabase = createServiceRoleClient();
    // dryRun 在這裡明確判斷成 boolean：只有 ?dry_run=1 才是 true，其餘（含排程與手動）都是 false。
    const result = await runDemoReset({
      supabase,
      now: new Date(),
      dryRun: mode.kind === "dry_run",
      deadlineMs: startedAt + RESET_BUDGET_MS,
    });
    logResult(mode.kind, result);

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: "reset_failed", stage: result.stage, databaseRestored: result.summary.databaseRestored, summary: publicSummary(result.summary) },
        { status: 500 },
      );
    }
    return NextResponse.json({ ok: true, summary: publicSummary(result.summary) });
  } catch (caught) {
    // 例外只記錄訊息，不回給呼叫端。
    console.error("demo-reset: 未預期例外", { mode: mode.kind, error: caught instanceof Error ? caught.message : String(caught) });
    return NextResponse.json({ ok: false, error: "reset_failed" }, { status: 500 });
  } finally {
    runningSince = null;
  }
}
