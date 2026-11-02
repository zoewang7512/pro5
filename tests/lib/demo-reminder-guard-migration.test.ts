import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// TASK-121：0031 的 Demo 預約提醒標記觸發器。不連資料庫，以檔案內容把關：
//   * 觸發器函式的判斷順序與強制已提醒的語句；
//   * reset_demo_data 除了觸發器白名單外與 0027 逐字相同（_down 還原成 0027）；
//   * 新觸發器名稱出現在白名單（漏補會讓每日還原失敗）；
//   * 提醒排程與後台改期這兩個「缺口的來源」仍是現在這個形狀（形狀變了，這個守門的前提就要重新評估）。
// 實際執行 SQL 的演練見 verification/TASK-121-pglite-rehearsal.mjs；對真實專案的行為見 tests/demo-reminder-guard.integration.test.ts。

const ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const read = (name: string) => readFileSync(path.join(MIGRATIONS, name), "utf8").replace(/\r\n/g, "\n");
// 剝除區塊註解、整行註解與行尾註解（避免把守門語句「註解掉」卻仍通過文字比對）。
const code = (sql: string) =>
  sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .map((line) => line.replace(/\s--.*$/, ""))
    .join("\n");

const UP = read("0031_demo_reminder_guard.sql");
const DOWN = read("0031_demo_reminder_guard_down.sql");
const PREV_RESET = read("0027_demo_row_caps.sql");

const TRIGGER = "demo_appointment_reminder";
const FUNCTION = "demo_appointment_reminder_guard";

const RESET_START = "create or replace function public.reset_demo_data(p_payload jsonb, p_dry_run boolean)";
const RESET_END = "grant execute on function public.reset_demo_data(jsonb, boolean) to service_role;";
function resetBlock(sql: string): string {
  const start = sql.indexOf(RESET_START);
  const end = sql.indexOf(RESET_END);
  expect(start, "找不到 reset_demo_data 開頭").toBeGreaterThanOrEqual(0);
  expect(end, "找不到 reset_demo_data 結尾").toBeGreaterThan(start);
  return sql.slice(start, end + RESET_END.length);
}

function whitelist(sql: string): string[] {
  const block = resetBlock(sql);
  const open = block.indexOf("and t.tgname not in (");
  const close = block.indexOf(");", open);
  expect(open, "找不到觸發器白名單").toBeGreaterThan(0);
  return [...code(block.slice(open, close)).matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
}

function guardFunction(sql: string): string {
  const start = sql.indexOf(`create or replace function public.${FUNCTION}()`);
  const end = sql.indexOf("\n$$;", start);
  expect(start, "找不到觸發器函式").toBeGreaterThanOrEqual(0);
  return sql.slice(start, end + 4);
}

describe("0031 觸發器函式（TASK-121）", () => {
  const fn = code(guardFunction(UP));

  it("先以字串預篩（沒有 is_demo 就放行、不解析 JSON），疑似 Demo 才讀簽章後的 app_metadata.is_demo", () => {
    const prescreen = "if v_claims is null or strpos(v_claims, 'is_demo') = 0 then\n    return new;\n  end if;";
    const condition = "if coalesce(auth.jwt() -> 'app_metadata' ->> 'is_demo', '') <> 'true' then\n      return new;\n    end if;";
    expect(fn).toContain(prescreen);
    expect(fn).toContain(condition);
    expect(fn).toContain("current_setting('request.jwt.claims', true)");
    // 讀取順序與 Supabase 的 auth.jwt() 一致：request.jwt.claim 優先、再 request.jwt.claims。
    expect(fn.indexOf("current_setting('request.jwt.claim', true)")).toBeGreaterThan(-1);
    expect(fn.indexOf("current_setting('request.jwt.claim', true)")).toBeLessThan(fn.indexOf("current_setting('request.jwt.claims', true)"));
    expect(fn.indexOf(prescreen)).toBeLessThan(fn.indexOf("auth.jwt()"));
    // 只有一處 auth.jwt()，且不得改讀可被使用者改寫的來源。
    expect(fn.match(/auth\.jwt\(\)/g)).toHaveLength(1);
    expect(fn).not.toMatch(/user_metadata|raw_user_meta_data|raw_app_meta_data/);
  });

  it("強制已提醒：Demo 的更新不得讓 reminder_sent_at 變 null；語句在判斷之後、唯一一處賦值", () => {
    const assign = "new.reminder_sent_at := coalesce(old.reminder_sent_at, now());";
    expect(fn).toContain(assign);
    expect(fn.match(/new\.\w+\s*:=/g)).toEqual(["new.reminder_sent_at :="]); // 只動這一欄
    expect(fn.indexOf(assign)).toBeGreaterThan(fn.indexOf("auth.jwt()"));
    expect(fn.trimEnd().endsWith("return new;\nend;\n$$;")).toBe(true);
    // 賦值必須是函式主體最上層的語句（不能被包進 if false／永遠放行的分支）：只有三處 return new（預篩、非 Demo、結尾），
    // 賦值前一行空白、再前一行是例外區塊的 end;，賦值本身是兩格縮排。
    expect(fn.match(/return new;/g)).toHaveLength(3);
    expect(fn).toContain("  end;\n\n  new.reminder_sent_at := coalesce(old.reminder_sent_at, now());\n  return new;\nend;");
    expect(fn).not.toMatch(/\bif\s+(false|true)\b/i);
  });

  it("失敗方向：解析 JWT 丟例外時視為 Demo（強制已提醒），不讓更新失敗也不放過", () => {
    const tryStart = fn.indexOf("begin\n    if coalesce(auth.jwt()");
    const handler = fn.indexOf("exception\n    when others then\n      null;\n  end;");
    expect(tryStart).toBeGreaterThan(0);
    expect(handler).toBeGreaterThan(tryStart);
    // 例外分支沒有 return／raise，會落到後面的強制已提醒。
    expect(fn.slice(handler, fn.indexOf("new.reminder_sent_at :="))).not.toMatch(/return|raise/);
  });

  it("不讀寫任何資料表；SECURITY DEFINER、search_path 為空；所有 API 角色收回 execute", () => {
    const sig = guardFunction(UP).split("as $$")[0];
    expect(sig).toMatch(/security definer/);
    expect(sig).toMatch(/set search_path = ''/);
    expect(fn).not.toMatch(/\b(select|insert|update|delete)\b[^;]*\b(from|into|public\.)\b/i);
    expect(fn).not.toMatch(/execute format|perform pg_advisory/i);
    expect(code(UP)).toContain(`revoke execute on function public.${FUNCTION}() from public, anon, authenticated, service_role;`);
    expect(code(UP)).not.toMatch(new RegExp(`\\bgrant\\b[^;]*${FUNCTION}`, "i"));
  });
});

describe("0031 觸發器與交易結構", () => {
  it("appointments 上恰好一個 BEFORE UPDATE FOR EACH ROW 觸發器，沒有 WHEN 條件，呼叫該函式", () => {
    const sql = code(UP);
    expect(sql).toContain(
      `create trigger ${TRIGGER}\n  before update on public.appointments\n  for each row\n  execute function public.${FUNCTION}();`,
    );
    expect(sql).toContain(`drop trigger if exists ${TRIGGER} on public.appointments;`);
    expect(sql.match(/create trigger/g)).toHaveLength(1);
    expect(sql).not.toMatch(/create trigger[^;]*\bwhen\b/i); // 判斷全在函式內（auth.jwt() 不能放進 WHEN）
    expect(sql).not.toMatch(/create trigger[^;]*\bupdate of\b/i); // 任何欄位的更新都要經過（含只改 start_at 的改期）
  });

  it("有依賴檢查（含必須先套用 0027），在 begin／commit 交易內，有 lock_timeout 與尾端自我檢查", () => {
    expect(UP).toContain("0031 需要 public.appointments");
    expect(UP).toContain("0031 需要 appointments.reminder_sent_at");
    expect(UP).toContain("to_regprocedure('auth.jwt()') is null");
    expect(UP).toContain("to_regprocedure('public.reset_demo_data(jsonb,boolean)') is null");
    expect(UP).toContain("position(quote_literal('demo_row_cap_closed_dates') in");
    expect(UP).toContain("0031 需要先套用 0027");
    expect(UP.indexOf("\nbegin;\n")).toBeGreaterThan(-1);
    // 檔頭註解會提到 create trigger 範例，所以順序比對用剝除註解後的程式碼。
    const sql = code(UP);
    expect(sql.indexOf("set local lock_timeout = '5s';")).toBeGreaterThan(sql.indexOf("\nbegin;\n"));
    expect(sql.indexOf("set local lock_timeout = '5s';")).toBeLessThan(sql.indexOf(`create trigger ${TRIGGER}`));
    expect(UP.trimEnd().endsWith("commit;")).toBe(true);
    expect(UP).toContain("0031 自我檢查失敗");
    expect(UP).toContain("(t.tgtype & (4 | 8 | 32)) = 0");
    expect(UP).toContain(`has_function_privilege('anon', 'public.${FUNCTION}()', 'execute')`);
  });

  it("不動任何 policy、資料表結構、grant、既有資料", () => {
    // 排除 reset_demo_data 本文（它本來就會寫入資料，但只有 service_role 能執行，且與 0027 逐字相同）。
    const sql = code(UP.replace(resetBlock(UP), ""));
    expect(sql).not.toMatch(/create\s+policy|drop\s+policy|alter\s+table|insert\s+into|update\s+public|delete\s+from|truncate|create\s+index/i);
    expect(sql).not.toMatch(/\bgrant\b/i);
  });

  it("_down 先移除觸發器再移除函式、再還原 reset_demo_data，不建立觸發器，有自我檢查", () => {
    const sql = code(DOWN);
    expect(sql).toContain(`drop trigger if exists ${TRIGGER} on public.appointments;`);
    expect(sql).toContain(`drop function if exists public.${FUNCTION}();`);
    expect(sql.indexOf("drop trigger")).toBeLessThan(sql.indexOf("drop function"));
    expect(sql.indexOf("drop function")).toBeLessThan(sql.indexOf(RESET_START));
    expect(sql).not.toMatch(/create\s+trigger/i);
    expect(DOWN).toContain("0031_down 自我檢查失敗");
    expect(DOWN).toContain("0032 以上");
    expect(DOWN.indexOf("\nbegin;\n")).toBeGreaterThan(-1);
    expect(DOWN.trimEnd().endsWith("commit;")).toBe(true);
  });

  it("檔頭寫明緊急停用的一行語句", () => {
    expect(UP).toContain(`--   drop trigger if exists ${TRIGGER} on public.appointments;`);
  });
});

describe("reset_demo_data 與 0027 逐字相同（TASK-121 只擴充觸發器白名單）", () => {
  it("_down 的 reset_demo_data 與 0027 逐字相同（白名單不含新觸發器）", () => {
    expect(resetBlock(DOWN)).toBe(resetBlock(PREV_RESET));
    expect(whitelist(DOWN)).not.toContain(TRIGGER);
  });

  it("0031 的 reset_demo_data 拿掉新增的白名單項目後，與 0027 逐字相同", () => {
    const added = /,\n      -- TASK-121[^\n]*\n      'demo_appointment_reminder'(?=\n    \);)/;
    const block = resetBlock(UP);
    expect(block).toMatch(added);
    expect(block.replace(added, "")).toBe(resetBlock(PREV_RESET));
  });

  it("0031 的白名單 = 0027 的白名單 + 新觸發器，不多不少", () => {
    expect([...whitelist(UP)].sort()).toEqual([...whitelist(PREV_RESET), TRIGGER].sort());
  });

  it("權限未變：只有 service_role 能執行 reset_demo_data", () => {
    const sql = code(resetBlock(UP));
    expect(sql).toContain("revoke execute on function public.reset_demo_data(jsonb, boolean) from public, anon, authenticated, service_role;");
    expect(sql).toContain("grant execute on function public.reset_demo_data(jsonb, boolean) to service_role;");
  });

  it("0031 是目前編號最大的 reset_demo_data 定義者，且 appointments 上每個 migration 建立的觸發器都在它的白名單內", () => {
    const migrations = readdirSync(MIGRATIONS)
      .filter((n) => n.endsWith(".sql") && !n.endsWith("_down.sql"))
      .sort();
    const definers = migrations.filter((n) => code(read(n)).includes("create or replace function public.reset_demo_data("));
    // 若日後有更新的 migration 重新定義了它：這個斷言失敗是提醒——0031_down 把函式寫死成 0027 本文，不可再直接使用（檔頭已警告）。
    expect(definers[definers.length - 1]).toBe("0031_demo_reminder_guard.sql");

    const allowed = new Set(whitelist(UP));
    const created: string[] = [];
    for (const file of migrations) {
      for (const m of code(read(file)).matchAll(/create\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\s+"?(\w+)"?([^;]*?)\son\s+(?:"?(\w+)"?\.)?"?(\w+)"?/gi)) {
        if ((m[3] ?? "public").toLowerCase() === "public" && m[4].toLowerCase() === "appointments") created.push(m[1]);
      }
    }
    expect(created).toContain(TRIGGER);
    expect(created.length).toBeGreaterThanOrEqual(4); // notify_insert／notify_update／set_updated_at／set_price_snapshot／本觸發器
    expect(created.filter((t) => !allowed.has(t))).toEqual([]);
  });
});

describe("缺口來源的形狀沒有變（前提檢查）", () => {
  const src = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

  it("後台改期仍把 reminder_sent_at 設回 null（本觸發器要擋的就是這一步）", () => {
    expect(src("lib/admin/appointments.ts")).toContain(".update({ start_at: newStartAt, end_at: newEndAt, reminder_sent_at: null })");
  });

  it("提醒排程仍以 reminder_sent_at 為 null 作為挑選條件，且排程自己不帶 Demo JWT（用 service role）", () => {
    const reminders = src("lib/admin/appointment-reminders.ts");
    expect(reminders).toContain('.is("reminder_sent_at", null)');
    expect(reminders).toContain('.update({ reminder_sent_at: new Date().toISOString() })');
    expect(reminders).toContain('.update({ reminder_sent_at: null })');
    expect(src("app/api/cron/appointment-reminders/route.ts")).toMatch(/service-role|createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
  });
});

describe("驗證腳本", () => {
  it("TASK-121-verify.sql 以 raise exception 收尾保證 rollback、不提交、不改時間或狀態", () => {
    const verify = readFileSync(
      path.join(ROOT, "ai/artifacts/Demo 體驗帳戶/verification/TASK-121-verify.sql"),
      "utf8",
    ).replace(/\r\n/g, "\n");
    const sql = code(verify);
    expect(sql).toMatch(/raise exception 'VERIFY_RESULT/);
    expect(sql).not.toMatch(/^\s*commit\s*;/im);
    // 只更新 reminder_sent_at（以及補寫起始值），絕不能改 start_at／end_at／status，否則會觸發 UPDATE webhook。
    expect(sql).not.toMatch(/set\s+(start_at|end_at|status)\b/i);
    expect(sql).not.toMatch(/net\.http_post/i);
  });
});
