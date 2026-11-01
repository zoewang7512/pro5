import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// 掃描測試（TASK-108）：reset_demo_data 真實執行會清空並覆寫正式資料，所以整合測試只准 dry-run。
// 這個測試把關（它也列在 vitest.demo-reset.config.ts 的 include，`npm run test:demo-reset` 一定會一起跑）：
//   1. 整個 repo（排除 node_modules／.next／.git／backups）裡，`reset_demo_data` 這個字串只能出現在白名單檔案：
//      migration、文件與看板卡、本檔與整合測試、產生 payload 的 lib/demo/seed-*.ts（只有註解）、
//      還原編排 lib/demo/reset.ts 與它的單元測試。任何其他程式（腳本、端點）要呼叫它，必須在審查後主動把檔案加進白名單；
//      端點與指令（TASK-110）應該呼叫 runDemoReset，不要自己呼叫 rpc。
//   2. 整合測試裡只有一處 rpc("reset_demo_data")，其 p_dry_run 來自 callReset 的 dryRun 參數；型別不含 false，
//      且 callReset 有執行期護欄（掃描與型別都能被繞過，護欄不能）。
//   3. 整合測試不得出現 p_dry_run: false、callReset(..., false, ...)。
// 這些都是文字比對，擋的是「不小心」，不是惡意；真正的第二道門見驗證報告的殘留風險（DB 端額外確認）。
const ROOT = path.resolve(__dirname, "..", "..");
const INTEGRATION_FILE = path.join(ROOT, "tests", "demo-reset.integration.test.ts");
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "backups", ".vercel", "coverage"]);

const ALLOWED = [
  /^supabase\/migrations\/0024_demo_reset(_down)?\.sql$/,
  // TASK-116：0027 為了同步觸發器白名單而重新定義 reset_demo_data（除白名單外逐字相同）；
  // 它的單元測試只讀檔案內容比對，兩者都不呼叫該函式。
  /^supabase\/migrations\/0027_demo_row_caps(_down)?\.sql$/,
  /^tests\/lib\/demo-row-caps-migration\.test\.ts$/,
  /^tests\/demo-reset\.integration\.test\.ts$/,
  /^tests\/lib\/demo-reset-test-scan\.test\.ts$/,
  /^vitest\.demo-reset\.config\.ts$/,
  /^lib\/demo\/seed-(data|types)\.ts$/,
  // TASK-109：還原編排是唯一可以對正式庫真實呼叫的程式；它的單元測試用假 client。
  /^lib\/demo\/reset\.ts$/,
  /^tests\/lib\/demo-reset\.test\.ts$/,
  /^ai\//,
  /^tools\/kanban\/cards\/TASK-\d+\.json$/,
  /^docs\//,
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP_DIRS.has(name)) return [];
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const relative = (file: string) => path.relative(ROOT, file).split(path.sep).join("/");

describe("reset_demo_data 的測試只准 dry-run", () => {
  it("整個 repo 中，reset_demo_data 只出現在白名單檔案（含 .sql、.sh、.cjs、.mts 等任何副檔名）", () => {
    const offenders = walk(ROOT)
      .filter((file) => statSync(file).size < 2_000_000)
      .filter((file) => {
        try {
          return readFileSync(file, "utf8").includes("reset_demo_data");
        } catch {
          return false;
        }
      })
      .map(relative)
      .filter((file) => !ALLOWED.some((pattern) => pattern.test(file)));
    expect(offenders).toEqual([]);
  });

  it("整合測試只有一處 rpc 呼叫，p_dry_run 來自 callReset 的 dryRun 參數，型別不含 false", () => {
    const source = readFileSync(INTEGRATION_FILE, "utf8");
    expect(source.match(/\.rpc\(\s*["'`]reset_demo_data["'`]/g) ?? []).toHaveLength(1);
    expect(source).toMatch(/type DryRun = true \| null \| "omitted";/);
    expect(source).toMatch(/async function callReset\(payload: unknown, dryRun: DryRun = true, /);
    expect(source).toMatch(/if \(dryRun !== "omitted"\) params\.p_dry_run = dryRun;/);
    expect(source).not.toMatch(/p_dry_run\s*[:=]\s*false/);
    expect(source).not.toMatch(/callReset\([^)]*\bfalse\b/);
    expect(source).not.toMatch(/DryRun\s*=\s*[^;]*\bfalse\b/);
  });

  it("callReset 有執行期護欄：dryRun 不是 true／null／\"omitted\" 就丟錯，且護欄在 rpc 呼叫之前", () => {
    const source = readFileSync(INTEGRATION_FILE, "utf8");
    const guard = source.indexOf('if (dryRun !== true && dryRun !== null && dryRun !== "omitted") {');
    const call = source.indexOf('.rpc("reset_demo_data"');
    expect(guard).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(guard);
    expect(source.slice(guard, call)).toContain("throw new Error(");
  });

  it("lib/demo/reset.ts 只有一處 rpc('reset_demo_data')，p_dry_run 來自呼叫端明確傳入的 dryRun，dryRun 沒有預設值，開閘門受 !dryRun 保護", () => {
    // 去掉行註解再比對（註解裡會寫「dryRun = true」之類的說明）。
    const source = readFileSync(path.join(ROOT, "lib", "demo", "reset.ts"), "utf8").replace(/\/\/.*$/gm, "");
    expect(source.match(/\.rpc\(\s*["'`]reset_demo_data["'`]/g) ?? []).toHaveLength(1);
    expect(source).toMatch(/\{ p_payload: payload, p_dry_run: dryRun \}/);
    expect(source).toMatch(/dryRun: boolean;/);
    expect(source).not.toMatch(/dryRun\s*[:=]\s*(true|false)\b/);
    expect(source).not.toMatch(/p_dry_run\s*:\s*(true|false)\b/);
    // 開閘門只在 !dryRun 時（可能被包在 try 裡）；用「呼叫前最近的 if (!dryRun)」確認。
    const open = source.indexOf('rpc("demo_reset_open_gate"');
    expect(open).toBeGreaterThan(-1);
    expect(source.slice(Math.max(0, open - 200), open)).toMatch(/if \(!dryRun\) \{/);
  });

  it("測試注入用的 runDemoResetWithDeps 只能被 reset.ts 自己與單元測試引用（端點與指令只能用 runDemoReset）", () => {
    const allowed = [/^lib\/demo\/reset\.ts$/, /^tests\/lib\/demo-reset\.test\.ts$/, /^tests\/lib\/demo-reset-test-scan\.test\.ts$/, /^ai\//, /^tools\/kanban\/cards\//, /^docs\//];
    const offenders = walk(ROOT)
      .filter((file) => statSync(file).size < 2_000_000)
      .filter((file) => {
        try {
          return readFileSync(file, "utf8").includes("runDemoResetWithDeps");
        } catch {
          return false;
        }
      })
      .map(relative)
      .filter((file) => !allowed.some((pattern) => pattern.test(file)));
    expect(offenders).toEqual([]);
  });

  it("還原編排的單元測試只用假 client：不匯入 createClient 或 service role", () => {
    const source = readFileSync(path.join(ROOT, "tests", "lib", "demo-reset.test.ts"), "utf8");
    expect(source).not.toMatch(/import\s*\{[^}]*\bcreateClient\b[^}]*\}/);
    expect(source).not.toMatch(/froms+["'][^"']*service-role["']|createServiceRoleClient/);
  });
});
