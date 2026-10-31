import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// server-only 在 Vitest 的一般 Node 解析下會直接 throw，比照 appointment-reminders-cron.test.ts mock 成空模組。
vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  runDemoReset: vi.fn(),
  createServiceRoleClient: vi.fn(),
}));

vi.mock("@/lib/demo/reset", () => ({ runDemoReset: state.runDemoReset }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: state.createServiceRoleClient }));

const SECRET = "test-cron-secret-value";
const CLIENT = { marker: "service-role-client" };
const ENDPOINT = "https://example.invalid/api/cron/demo-reset";

function request(query = "", headers: Record<string, string> = { authorization: `Bearer ${SECRET}` }) {
  return new NextRequest(`${ENDPOINT}${query}`, { method: "GET", headers });
}

function okResult(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    summary: {
      dryRun: false,
      durationMs: 1200,
      databaseRestored: true,
      stages: { prepare: { status: "done" }, reset_database: { status: "done" } },
      database: { counts: { designers: 3, appointments: 40 }, deleted: { appointments: 38 } },
      health: { ok: true, error: undefined },
      warnings: [],
      ...overrides,
    },
  };
}

async function callGet(query?: string, headers?: Record<string, string>) {
  const { GET } = await import("@/app/api/cron/demo-reset/route");
  return GET(request(query, headers));
}

describe("GET /api/cron/demo-reset", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env.CRON_SECRET = SECRET;
    delete process.env.DEMO_RESET_ENABLED;
    state.runDemoReset.mockReset();
    state.runDemoReset.mockResolvedValue(okResult());
    state.createServiceRoleClient.mockReset();
    state.createServiceRoleClient.mockReturnValue(CLIENT);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  describe("密鑰驗證", () => {
    const rejected: [string, Record<string, string>][] = [
      ["缺少 Authorization", {}],
      ["密鑰錯誤", { authorization: "Bearer wrong-secret" }],
      ["不是 Bearer 格式", { authorization: SECRET }],
      ["Bearer 後面是空的", { authorization: "Bearer " }],
    ];

    it.each(rejected)("%s → 401，還原邏輯與 service role client 都零呼叫（含帶 confirm／dry_run 的請求）", async (_label, headers) => {
      for (const query of ["", "?dry_run=1", "?confirm=RESET_DEMO"]) {
        const res = await callGet(query, headers);
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: "unauthorized" });
      }
      expect(state.runDemoReset).not.toHaveBeenCalled();
      expect(state.createServiceRoleClient).not.toHaveBeenCalled();
    });

    it("CRON_SECRET 未設定時一律拒絕（fail closed），即使送出 header 值 undefined", async () => {
      delete process.env.CRON_SECRET;
      for (const authorization of [`Bearer ${SECRET}`, "Bearer undefined", "Bearer "]) {
        const res = await callGet("?confirm=RESET_DEMO", { authorization });
        expect(res.status).toBe(401);
      }
      expect(state.runDemoReset).not.toHaveBeenCalled();
      expect(state.createServiceRoleClient).not.toHaveBeenCalled();
    });

    it("密鑰放在 query 不算數", async () => {
      const res = await callGet(`?confirm=RESET_DEMO&secret=${SECRET}&cron_secret=${SECRET}`, {});
      expect(res.status).toBe(401);
      expect(state.runDemoReset).not.toHaveBeenCalled();
    });
  });

  describe("參數必須精確，含糊的一律 400 且不執行任何邏輯", () => {
    const invalid = [
      "?dry_run=0",
      "?dry_run=true",
      "?dry_run=",
      "?dry_run",
      "?dry_run=1&dry_run=1",
      "?confirm=reset_demo",
      "?confirm=RESET_DEMO%20",
      "?confirm=",
      "?confirm",
      "?confirm=true",
      "?confirm=RESET_DEMO&confirm=RESET_DEMO",
      "?dry_run=1&confirm=wrong",
      "?dry_run=0&confirm=RESET_DEMO",
    ];

    it.each(invalid)("%s → 400（旗標開啟也一樣）", async (query) => {
      process.env.DEMO_RESET_ENABLED = "true";
      const res = await callGet(query);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ ok: false, error: "invalid_params" });
      expect(state.runDemoReset).not.toHaveBeenCalled();
      expect(state.createServiceRoleClient).not.toHaveBeenCalled();
    });

    // 排程呼叫完全不帶 query：打錯參數名稱的手動呼叫不能被當成排程（旗標開啟時會變真實還原）。
    it.each(["?foo=bar", "?dryrun=1", "?dry-run=1", "?DRY_RUN=1", "?Confirm=RESET_DEMO", "?confirm=RESET_DEMO&foo=1", "?dry_run=1&foo=1"])(
      "%s → 400，旗標開啟也不會執行",
      async (query) => {
        process.env.DEMO_RESET_ENABLED = "true";
        const res = await callGet(query);
        expect(res.status).toBe(400);
        expect(state.runDemoReset).not.toHaveBeenCalled();
        expect(state.createServiceRoleClient).not.toHaveBeenCalled();
      },
    );

    it("旗標關閉時，無效參數仍回 400 而不是 skipped（驗證參數先於旗標判斷）", async () => {
      for (const query of ["?confirm=wrong", "?dryrun=1", "?dry_run=0"]) {
        const res = await callGet(query);
        expect(res.status).toBe(400);
      }
      expect(state.runDemoReset).not.toHaveBeenCalled();
    });
  });

  describe("排程呼叫（無參數）受 DEMO_RESET_ENABLED 約束", () => {
    it.each([undefined, "", "false", "TRUE", "True", "1", "yes", " true", "true "])(
      "DEMO_RESET_ENABLED 為 %j → skipped，還原邏輯與 client 零呼叫",
      async (value) => {
        if (value === undefined) delete process.env.DEMO_RESET_ENABLED;
        else process.env.DEMO_RESET_ENABLED = value;
        const res = await callGet();
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true, skipped: true });
        expect(state.runDemoReset).not.toHaveBeenCalled();
        expect(state.createServiceRoleClient).not.toHaveBeenCalled();
      },
    );

    it('DEMO_RESET_ENABLED 為 "true" → 真實還原（dryRun 為 false）', async () => {
      process.env.DEMO_RESET_ENABLED = "true";
      const res = await callGet();
      expect(res.status).toBe(200);
      expect(state.runDemoReset).toHaveBeenCalledTimes(1);
      expect(state.runDemoReset.mock.calls[0][0].dryRun).toBe(false);
    });
  });

  describe("?dry_run=1：只試跑，不受旗標約束", () => {
    it.each([undefined, "false", "true"])("DEMO_RESET_ENABLED 為 %j 時 dryRun 都是 true", async (value) => {
      if (value === undefined) delete process.env.DEMO_RESET_ENABLED;
      else process.env.DEMO_RESET_ENABLED = value;
      state.runDemoReset.mockResolvedValue(okResult({ dryRun: true, databaseRestored: false }));
      const res = await callGet("?dry_run=1");
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(state.runDemoReset).toHaveBeenCalledTimes(1);
      expect(state.runDemoReset.mock.calls[0][0].dryRun).toBe(true);
      expect(body.ok).toBe(true);
      expect(body.summary.database.counts).toEqual({ designers: 3, appointments: 40 });
    });

    it("dry_run=1 與 confirm=RESET_DEMO 同時出現 → 以 dry-run 為準", async () => {
      const res = await callGet("?dry_run=1&confirm=RESET_DEMO");
      expect(res.status).toBe(200);
      expect(state.runDemoReset).toHaveBeenCalledTimes(1);
      expect(state.runDemoReset.mock.calls[0][0].dryRun).toBe(true);
    });
  });

  describe("?confirm=RESET_DEMO：手動真實還原，不受旗標約束", () => {
    it.each([undefined, "false", "true"])("DEMO_RESET_ENABLED 為 %j 時仍真實還原", async (value) => {
      if (value === undefined) delete process.env.DEMO_RESET_ENABLED;
      else process.env.DEMO_RESET_ENABLED = value;
      const res = await callGet("?confirm=RESET_DEMO");
      expect(res.status).toBe(200);
      expect(state.runDemoReset).toHaveBeenCalledTimes(1);
      expect(state.runDemoReset.mock.calls[0][0].dryRun).toBe(false);
    });
  });

  it("maxDuration 為 60（Hobby 上限）", async () => {
    const route = await import("@/app/api/cron/demo-reset/route");
    expect(route.maxDuration).toBe(60);
  });

  describe("傳給 runDemoReset 的參數", () => {
    it("只有 supabase、now、dryRun、deadlineMs 四個欄位，dryRun 是 boolean，期限預留尾段時間", async () => {
      const before = Date.now();
      await callGet("?confirm=RESET_DEMO");
      const after = Date.now();

      const options = state.runDemoReset.mock.calls[0][0];
      expect(Object.keys(options).sort()).toEqual(["deadlineMs", "dryRun", "now", "supabase"]);
      expect(options.supabase).toBe(CLIENT);
      expect(typeof options.dryRun).toBe("boolean");
      expect(options.now).toBeInstanceOf(Date);
      // 60 秒上限內要留給交易、帳戶處理與健康檢查：期限落在開始後 35～40 秒。
      expect(options.deadlineMs - before).toBeGreaterThanOrEqual(35_000);
      expect(options.deadlineMs - after).toBeLessThanOrEqual(40_000);
    });

    it("每個請求都傳入明確的 boolean，不會因為沒帶參數變成 undefined 或字串", async () => {
      process.env.DEMO_RESET_ENABLED = "true";
      for (const query of ["", "?dry_run=1", "?confirm=RESET_DEMO"]) {
        await callGet(query);
      }
      expect(state.runDemoReset.mock.calls.map((call) => call[0].dryRun)).toEqual([false, true, false]);
    });
  });

  describe("失敗與例外：回 500，只回摘要，不回原始例外", () => {
    it("還原回報失敗（資料庫未動）→ 500，stage 與 databaseRestored 可見，原始錯誤字串不外洩", async () => {
      state.runDemoReset.mockResolvedValue({
        ok: false,
        stage: "sync_images",
        error: "RAW_INTERNAL_ERROR_TEXT",
        summary: { ...okResult().summary, databaseRestored: false, stages: { sync_images: { status: "failed", detail: "missing_seed_objects:a" } } },
      });
      const res = await callGet("?confirm=RESET_DEMO");
      const body = await res.json();
      expect(res.status).toBe(500);
      expect(body).toMatchObject({ ok: false, error: "reset_failed", stage: "sync_images", databaseRestored: false });
      expect(JSON.stringify(body)).not.toContain("RAW_INTERNAL_ERROR_TEXT");
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining("資料庫未變動"), expect.objectContaining({ failedStage: "sync_images" }));
    });

    it("資料庫已還原但後續階段失敗 → 仍回 500 讓監控看得到，databaseRestored 為 true，日誌文字不同", async () => {
      state.runDemoReset.mockResolvedValue({
        ok: false,
        stage: "health_check",
        error: "login_failed",
        summary: { ...okResult().summary, databaseRestored: true, stages: { health_check: { status: "failed", detail: "login_failed" } } },
      });
      const res = await callGet("?confirm=RESET_DEMO");
      const body = await res.json();
      expect(res.status).toBe(500);
      expect(body).toMatchObject({ ok: false, error: "reset_failed", stage: "health_check", databaseRestored: true });
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining("資料庫已還原"), expect.anything());
    });

    it("runDemoReset 丟出例外 → 500 { ok: false, error: 'reset_failed' }，例外訊息不外洩；之後的請求不會被卡住", async () => {
      state.runDemoReset.mockRejectedValueOnce(new Error("INTERNAL_STACK_DETAIL"));
      const res = await callGet("?confirm=RESET_DEMO");
      expect(res.status).toBe(500);
      const text = JSON.stringify(await res.json());
      expect(JSON.parse(text)).toEqual({ ok: false, error: "reset_failed" });
      expect(text).not.toContain("INTERNAL_STACK_DETAIL");

      const next = await callGet("?dry_run=1");
      expect(next.status).toBe(200);
    });

    it("建立 service role client 失敗（缺環境變數）→ 500，不呼叫還原", async () => {
      state.createServiceRoleClient.mockImplementationOnce(() => {
        throw new Error("缺少 SUPABASE_SERVICE_ROLE_KEY");
      });
      const res = await callGet("?dry_run=1");
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ ok: false, error: "reset_failed" });
      expect(state.runDemoReset).not.toHaveBeenCalled();
    });
  });

  describe("部分完成與日誌", () => {
    it("ok:true 但有警告或未完成階段 → 仍 200，但以 warn 記錄、摘要帶出 stages 與 warnings", async () => {
      state.runDemoReset.mockResolvedValue(
        okResult({ stages: { cleanup_orphans: { status: "partial", detail: "deadline" } }, warnings: ["close_gate_failed"] }),
      );
      const res = await callGet("?confirm=RESET_DEMO");
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.summary.stages.cleanup_orphans.status).toBe("partial");
      expect(body.summary.warnings).toEqual(["close_gate_failed"]);
      expect(console.warn).toHaveBeenCalled();
      expect(console.error).not.toHaveBeenCalled();
    });

    it("乾淨成功只記一般日誌", async () => {
      await callGet("?confirm=RESET_DEMO");
      expect(console.log).toHaveBeenCalledTimes(1);
      expect(console.warn).not.toHaveBeenCalled();
      expect(console.error).not.toHaveBeenCalled();
    });

    it("回應與所有日誌都不含 CRON_SECRET", async () => {
      await callGet("?confirm=RESET_DEMO", { authorization: `Bearer ${SECRET}` });
      state.runDemoReset.mockRejectedValueOnce(new Error("boom"));
      const failed = await callGet("?dry_run=1");
      const ok = await callGet("?dry_run=1");
      const spies = [console.log, console.warn, console.error].map((fn) => JSON.stringify(vi.mocked(fn).mock.calls));
      for (const text of [...spies, JSON.stringify(await failed.json()), JSON.stringify(await ok.json())]) {
        expect(text).not.toContain(SECRET);
      }
    });

    it("回應摘要只含白名單欄位（不整包轉傳還原結果），且該轉傳的欄位都有轉傳", async () => {
      const sync = { referenced: 45, unchanged: 45, planned: { copy: 0, replace: 0 }, copied: 0, replaced: 0 };
      const cleanup = { "admin-assets": { candidates: 2, removed: 2 } };
      const account = { factorsRemoved: 1, sessionsRevoked: 3 };
      state.runDemoReset.mockResolvedValue(
        okResult({ internalOnly: "SHOULD_NOT_LEAK", health: { ok: true, error: "SHOULD_NOT_LEAK" }, sync, cleanup, account }),
      );
      const res = await callGet("?confirm=RESET_DEMO");
      const body = await res.json();
      expect(JSON.stringify(body)).not.toContain("SHOULD_NOT_LEAK");
      expect(body.summary).toMatchObject({ sync, cleanup, account, health: { ok: true }, databaseRestored: true });
    });

    it("階段訊息只回代碼：資料庫錯誤訊息與含空白的自由文字不外洩，完整訊息只寫進日誌", async () => {
      state.runDemoReset.mockResolvedValue({
        ok: false,
        stage: "reset_database",
        error: "reset_failed:23505:duplicate key value violates unique constraint (secret_value)",
        summary: {
          ...okResult().summary,
          databaseRestored: false,
          stages: {
            sync_images: { status: "done" },
            reset_database: { status: "failed", detail: "reset_failed:23505:duplicate key value violates unique constraint (secret_value)" },
            cleanup_orphans: { status: "failed", detail: "some free text with spaces and secret_value" },
            prepare: { status: "failed", detail: "expected_exactly_1_demo_account_found_0" },
          },
        },
      });
      const res = await callGet("?dry_run=1");
      const body = await res.json();
      expect(body.summary.stages.reset_database).toEqual({ status: "failed", detail: "reset_failed:23505" });
      expect(body.summary.stages.prepare.detail).toBe("expected_exactly_1_demo_account_found_0");
      expect(body.summary.stages.sync_images).toEqual({ status: "done" });
      expect(JSON.stringify(body)).not.toContain("secret_value");
      expect(JSON.stringify(vi.mocked(console.error).mock.calls)).toContain("duplicate key value");
    });

    it("缺檔代碼超過 10 筆時尾端的「…」不會讓整段被遮蔽", async () => {
      const detail = "missing_seed_objects:a/1,a/2,…";
      state.runDemoReset.mockResolvedValue(okResult({ stages: { sync_images: { status: "failed", detail } } }));
      const body = await (await callGet("?dry_run=1")).json();
      expect(body.summary.stages.sync_images.detail).toBe(detail);
    });

    it("dry-run 的固定說明文字照常回傳", async () => {
      state.runDemoReset.mockResolvedValue(okResult({ stages: { sync_images: { status: "skipped", detail: "dry-run：只檢查來源，未複製" } } }));
      const body = await (await callGet("?dry_run=1")).json();
      expect(body.summary.stages.sync_images.detail).toBe("dry-run：只檢查來源，未複製");
    });
  });

  describe("執行鎖", () => {
    it("上一個還原還在跑時，第二個請求回 409，不重複呼叫；完成後可再執行", async () => {
      let release!: (value: unknown) => void;
      state.runDemoReset.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));

      const { GET } = await import("@/app/api/cron/demo-reset/route");
      const first = GET(request("?confirm=RESET_DEMO"));
      await vi.waitFor(() => expect(state.runDemoReset).toHaveBeenCalledTimes(1));

      const second = await GET(request("?confirm=RESET_DEMO"));
      expect(second.status).toBe(409);
      expect(await second.json()).toEqual({ ok: false, error: "already_running" });
      expect(state.runDemoReset).toHaveBeenCalledTimes(1);

      release(okResult());
      expect((await first).status).toBe(200);

      const third = await GET(request("?dry_run=1"));
      expect(third.status).toBe(200);
      expect(state.runDemoReset).toHaveBeenCalledTimes(2);
    });

    it("鎖超過函式上限仍未釋放（平台逾時中止、finally 沒跑）→ 視為失效，新請求可以執行", async () => {
      const realNow = Date.now();
      const nowSpy = vi.spyOn(Date, "now").mockReturnValue(realNow);
      state.runDemoReset.mockReturnValueOnce(new Promise(() => {})); // 永遠不結束
      const { GET } = await import("@/app/api/cron/demo-reset/route");
      void GET(request("?confirm=RESET_DEMO"));
      await vi.waitFor(() => expect(state.runDemoReset).toHaveBeenCalledTimes(1));

      nowSpy.mockReturnValue(realNow + 60_000);
      expect((await GET(request("?dry_run=1"))).status).toBe(409);

      nowSpy.mockReturnValue(realNow + 71_000);
      expect((await GET(request("?dry_run=1"))).status).toBe(200);
      expect(state.runDemoReset).toHaveBeenCalledTimes(2);
    });

    it("排程旗標關閉的 skipped 回應不受鎖影響（不佔用也不檢查），並留下日誌", async () => {
      let release!: (value: unknown) => void;
      state.runDemoReset.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
      const { GET } = await import("@/app/api/cron/demo-reset/route");
      const running = GET(request("?confirm=RESET_DEMO"));
      await vi.waitFor(() => expect(state.runDemoReset).toHaveBeenCalledTimes(1));

      const skipped = await GET(request());
      expect(await skipped.json()).toEqual({ ok: true, skipped: true });
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining("跳過"));

      release(okResult());
      await running;
    });
  });
});
