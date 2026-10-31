import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTarget, parseArgs } from "../../scripts/reset-demo.mjs";

// scripts/reset-demo.mjs（TASK-110）：預設只 dry-run，真實還原必須 --yes；目標網址必須明確給定。
// 單元部分測 parseArgs／buildTarget；行為部分用本機假伺服器跑完整的指令（不會連到任何真實站台）。
const SCRIPT = path.resolve(__dirname, "..", "..", "scripts", "reset-demo.mjs");
const SECRET = "script-test-secret-value";

describe("parseArgs", () => {
  it("沒有 --url → 錯誤（沒有預設目標）", () => {
    expect(parseArgs([])).toHaveProperty("error");
    expect(parseArgs(["--yes"])).toHaveProperty("error");
  });
  it("--url 後面沒有值或接著另一個旗標 → 錯誤", () => {
    expect(parseArgs(["--url"])).toHaveProperty("error");
    expect(parseArgs(["--url", "--yes"])).toHaveProperty("error");
  });
  it("不認得的參數 → 錯誤", () => {
    expect(parseArgs(["--url", "http://localhost:3000", "--force"])).toHaveProperty("error");
    expect(parseArgs(["--url", "http://localhost:3000", "yes"])).toHaveProperty("error");
  });
  it("預設 yes 為 false；--yes 才為 true；兩種 --url 寫法都可以；--confirm-host 預設為 null", () => {
    expect(parseArgs(["--url", "http://localhost:3000"])).toEqual({ url: "http://localhost:3000", yes: false, confirmHost: null });
    expect(parseArgs(["--url=http://localhost:3000", "--yes"])).toEqual({ url: "http://localhost:3000", yes: true, confirmHost: null });
    expect(parseArgs(["--url", "https://a.example", "--yes", "--confirm-host=a.example"])).toEqual({
      url: "https://a.example",
      yes: true,
      confirmHost: "a.example",
    });
  });
});

describe("buildTarget", () => {
  it("沒有 --yes → dry_run=1，不帶 confirm", () => {
    const target = buildTarget("http://localhost:3000", false);
    expect(target.mode).toBe("dry_run");
    expect(target.endpoint?.href).toBe("http://localhost:3000/api/cron/demo-reset?dry_run=1");
  });
  it("--yes → confirm=RESET_DEMO，不帶 dry_run", () => {
    const target = buildTarget("https://example.com", true, "example.com");
    expect(target.mode).toBe("real");
    expect(target.endpoint?.href).toBe("https://example.com/api/cron/demo-reset?confirm=RESET_DEMO");
  });
  it("只取 origin：使用者給的路徑與查詢字串一律捨棄", () => {
    const target = buildTarget("https://example.com/some/path?dry_run=0&x=1#frag", false);
    expect(target.endpoint?.href).toBe("https://example.com/api/cron/demo-reset?dry_run=1");
  });
  it.each(["http://example.com", "ftp://example.com", "http://localhost.evil.com"])("非本機網址只接受 https：%s → 錯誤", (url) => {
    expect(buildTarget(url, true)).toHaveProperty("error");
  });
  it.each(["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"])("本機網址可用 http：%s", (url) => {
    expect(buildTarget(url, false)).not.toHaveProperty("error");
  });
  it("網址格式不正確 → 錯誤，且錯誤訊息不回顯原始網址（可能夾帶帳密）", () => {
    const result = buildTarget("https://user:p@ss@@@bad host", false);
    expect(result).toHaveProperty("error");
    expect(JSON.stringify(result)).not.toContain("p@ss");
  });
  it("非本機網址的真實還原必須有相符的 --confirm-host；dry-run 與本機不需要", () => {
    expect(buildTarget("https://demo.example.com", true)).toHaveProperty("error");
    expect(buildTarget("https://demo.example.com", true, "other.example.com")).toHaveProperty("error");
    expect(buildTarget("https://demo.example.com", true, "demo.example.com")).not.toHaveProperty("error");
    expect(buildTarget("https://demo.example.com", false)).not.toHaveProperty("error");
    expect(buildTarget("http://localhost:3000", true)).not.toHaveProperty("error");
  });
});

describe("package.json", () => {
  it("demo:reset 指向 scripts/reset-demo.mjs 並載入 .env.local", () => {
    const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "..", "..", "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["demo:reset"]).toBe("node --env-file=.env.local scripts/reset-demo.mjs");
  });
});

// 每個案例都會 spawn 一個 node 行程；Windows 加防毒時可能比預設 5 秒慢。
describe("scripts/reset-demo.mjs 完整執行（本機假伺服器）", { timeout: 20_000 }, () => {
  let server: Server;
  let requests: { url: string; authorization: string | undefined; stdoutSoFar: string }[];
  // 子行程到目前為止的輸出；假伺服器收到請求時記下來，用來驗證「先印目標再送請求」。
  let liveStdout = "";
  let respond: (req: IncomingMessage) => { status: number; body: unknown; headers?: Record<string, string> };

  const baseUrl = () => `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  beforeEach(async () => {
    requests = [];
    liveStdout = "";
    respond = () => ({
      status: 200,
      body: { ok: true, summary: { dryRun: true, durationMs: 5, databaseRestored: false, stages: { prepare: { status: "done" } }, database: { counts: { designers: 3 } }, warnings: [] } },
    });
    server = createServer((req, res) => {
      requests.push({ url: req.url ?? "", authorization: req.headers.authorization, stdoutSoFar: liveStdout });
      const { status, body, headers } = respond(req);
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function run(args: string[], env: Record<string, string | undefined> = { CRON_SECRET: SECRET }) {
    return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
      const child = spawn(process.execPath, [SCRIPT, ...args], { env: { ...process.env, CRON_SECRET: undefined, ...env } as NodeJS.ProcessEnv });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
        liveStdout = stdout;
      });
      child.stderr.on("data", (chunk) => (stderr += chunk));
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    });
  }

  it("不帶 --yes：先印目標網址與 dry-run 模式，只送 dry_run=1（不帶 confirm），印出各表筆數", async () => {
    const result = await run(["--url", baseUrl()]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`目標：${baseUrl()}`);
    expect(result.stdout).toContain("模式：dry-run");
    expect(result.stdout).not.toContain("模式：真實還原");
    expect(result.stdout).toContain("designers: 3");
    expect(requests[0].stdoutSoFar).toContain(`目標：${baseUrl()}`);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("/api/cron/demo-reset?dry_run=1");
    expect(requests[0].url).not.toContain("confirm");
    expect(requests[0].authorization).toBe(`Bearer ${SECRET}`);
  });

  it("帶 --yes：先印目標網址與真實還原模式，才送出 confirm=RESET_DEMO（不帶 dry_run）", async () => {
    const result = await run(["--url", baseUrl(), "--yes"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`目標：${baseUrl()}`);
    expect(result.stdout).toContain("模式：真實還原（--yes）");
    expect(result.stdout).not.toContain("模式：dry-run");
    expect(requests).toHaveLength(1);
    expect(requests[0].stdoutSoFar).toContain(`目標：${baseUrl()}`);
    expect(requests[0].stdoutSoFar).toContain("模式：真實還原");
    expect(requests[0].url).toBe("/api/cron/demo-reset?confirm=RESET_DEMO");
  });

  it("密鑰不出現在輸出與網址裡", async () => {
    const ok = await run(["--url", baseUrl(), "--yes"]);
    respond = () => ({ status: 500, body: { ok: false, error: "reset_failed", stage: "sync_images" } });
    const failed = await run(["--url", baseUrl()]);
    for (const text of [ok.stdout, ok.stderr, failed.stdout, failed.stderr, ...requests.map((r) => r.url)]) {
      expect(text).not.toContain(SECRET);
    }
  });

  it("沒有 --url → 非 0 離開，不送出任何請求", async () => {
    const result = await run([]);
    expect(result.code).not.toBe(0);
    expect(requests).toHaveLength(0);
  });

  it("缺少 CRON_SECRET → 非 0 離開，不送出任何請求", async () => {
    const result = await run(["--url", baseUrl(), "--yes"], {});
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("CRON_SECRET");
    expect(requests).toHaveLength(0);
  });

  it("端點回 500 或 ok:false → 非 0 離開並顯示階段", async () => {
    respond = () => ({ status: 500, body: { ok: false, error: "reset_failed", stage: "sync_images" } });
    const result = await run(["--url", baseUrl()]);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("reset_failed");
    expect(result.stderr).toContain("sync_images");
  });

  it("HTTP 200 但 ok:false → 非 0 離開", async () => {
    respond = () => ({ status: 200, body: { ok: false, error: "reset_failed", stage: "health_check" } });
    const result = await run(["--url", baseUrl()]);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("health_check");
  });

  it("回應不是 JSON → 非 0 離開，只印狀態碼不印整頁內容", async () => {
    server.removeAllListeners("request");
    server.on("request", (_req, res) => {
      res.writeHead(502, { "content-type": "text/html" });
      res.end("<html>PLATFORM_ERROR_PAGE</html>");
    });
    const result = await run(["--url", baseUrl()]);
    expect(result.code).not.toBe(0);
    expect(result.stdout).toContain("HTTP 502");
    expect(result.stdout + result.stderr).not.toContain("PLATFORM_ERROR_PAGE");
  });

  it("回應為 skipped（排程旗標未開）→ 印出說明", async () => {
    respond = () => ({ status: 200, body: { ok: true, skipped: true } });
    const result = await run(["--url", baseUrl(), "--yes"]);
    expect(result.stdout).toContain("skipped");
  });

  it("端點回 401 → 非 0 離開", async () => {
    respond = () => ({ status: 401, body: { error: "unauthorized" } });
    const result = await run(["--url", baseUrl()]);
    expect(result.code).not.toBe(0);
  });

  it("收到轉址 → 不跟隨（密鑰不會被帶到別處），非 0 離開", async () => {
    respond = () => ({ status: 302, body: {}, headers: { location: "http://127.0.0.1:1/elsewhere" } });
    const result = await run(["--url", baseUrl(), "--yes"]);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("轉址");
    expect(requests).toHaveLength(1);
  });
});
