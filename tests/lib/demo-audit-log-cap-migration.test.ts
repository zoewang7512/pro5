import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// TASK-122：0028 的 Demo audit_log 每帳戶筆數上限。不連資料庫，以檔案內容把關：
//   * 上限數字與核准值一致，且只有函式內一處來源；
//   * 計數是「該帳戶的列」，不是整張表（designer001 的紀錄會無限成長）；
//   * 預篩 → 簽章後的 is_demo → actor 檢查 → 單筆大小 → 單一請求列數 → lock_timeout → 加鎖 → 計數 的順序；
//   * 本檔不碰 reset_demo_data（audit_log 不在還原覆寫的十一張表內），也不改 audit_log 的結構、policy、grant。

const MIGRATIONS = path.resolve(__dirname, "../../supabase/migrations");
const read = (name: string) => readFileSync(path.join(MIGRATIONS, name), "utf8").replace(/\r\n/g, "\n");
// 剝除區塊註解、整行註解與行尾註解（避免把守門語句「註解掉」卻仍通過文字比對）。
const code = (sql: string) =>
  sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .map((line) => line.replace(/\s--.*$/, ""))
    .join("\n");

const UP = read("0028_demo_audit_log_cap.sql");
const DOWN = read("0028_demo_audit_log_cap_down.sql");

// 使用者核准的上限（動工時採卡片建議值；待使用者確認）。改這裡必須同時改 0028 與 TASK-122-verify.sql。
const APPROVED_CAP = 500;

function guardFunction(sql: string): string {
  const start = sql.indexOf("create or replace function public.demo_audit_log_cap_guard()");
  const end = sql.indexOf("\n$$;", start);
  expect(start, "找不到 demo_audit_log_cap_guard").toBeGreaterThanOrEqual(0);
  return sql.slice(start, end + 4);
}

describe("0028 Demo audit_log 上限觸發器函式（TASK-122）", () => {
  const raw = guardFunction(UP);
  const guard = code(raw);

  it("上限只有函式內 v_cap 一處來源，數字與核准值一致", () => {
    expect([...guard.matchAll(/v_cap constant integer := (\d+);/g)].map((m) => Number(m[1]))).toEqual([APPROVED_CAP]);
    // 其餘數字 500 不得以字面值出現在判斷中（一律走 v_cap）。
    expect(guard.match(/\b500\b/g)).toHaveLength(1);
    expect(guard).toContain("if v_count >= v_cap then");
  });

  it("計數是該帳戶自己的列（actor_id），不是整張表總列數", () => {
    expect(guard).toContain("select count(*) into v_count from public.audit_log where actor_id = v_actor;");
    expect(guard.match(/count\(\*\)/g)).toHaveLength(1);
    // 沒有任何不帶 where 的整表計數。
    expect(guard).not.toMatch(/count\(\*\)[^;]*from public\.audit_log\s*;/);
  });

  it("先以字串預篩（沒有 is_demo 就放行、不解析 JSON），疑似 Demo 才解析「同一份」字串並讀簽章後的 app_metadata.is_demo，且都在加鎖與計數之前", () => {
    const prescreen = "if v_claims is null or strpos(v_claims, 'is_demo') = 0 then\n    return new;\n  end if;";
    const condition = "if coalesce(v_jwt -> 'app_metadata' ->> 'is_demo', '') <> 'true' then\n    return new;\n  end if;";
    expect(guard).toContain(prescreen);
    expect(guard).toContain("v_jwt := v_claims::jsonb;");
    expect(guard).toContain(condition);
    expect(guard).toContain("current_setting('request.jwt.claims', true)");
    expect(guard.indexOf(prescreen)).toBeLessThan(guard.indexOf("v_claims::jsonb"));
    expect(guard.indexOf(condition)).toBeLessThan(guard.indexOf("pg_advisory_xact_lock"));
    expect(guard.indexOf(condition)).toBeLessThan(guard.indexOf("count(*)"));
    // 預篩與解析用同一份字串，不再另外呼叫 auth.jwt()（審查 N1：兩者可能讀到不同來源）。
    expect(guard).not.toMatch(/auth\./);
    // 不得改讀可被使用者改寫的來源。
    expect(guard).not.toMatch(/user_metadata|raw_user_meta_data|raw_app_meta_data/);
  });

  it("Demo 的請求必須有 sub，且 actor_id 與 JWT 的 sub 一致，否則拒絕（在加鎖之前）；之後一律用 sub 計數與加鎖", () => {
    expect(guard).toContain("v_actor := nullif(v_jwt ->> 'sub', '')::uuid;");
    expect(guard).toContain("if v_actor is null or new.actor_id is distinct from v_actor then");
    const check = guard.indexOf("if v_actor is null");
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(guard.indexOf("pg_advisory_xact_lock"));
    expect(guard.slice(check, guard.indexOf("end if;", check))).toContain("errcode = 'P0001'");
    expect(guard).toContain("'demo-audit-cap:' || v_actor::text");
    expect(guard).toContain("where actor_id = v_actor;");
  });

  it("單筆大小：event_type／entity_type 超過 64 位元組被拒，在加鎖之前", () => {
    expect(guard).toContain("if octet_length(new.event_type) > 64 or octet_length(new.entity_type) > 64 then");
    expect(guard.indexOf("octet_length(new.event_type)")).toBeLessThan(guard.indexOf("pg_advisory_xact_lock"));
    expect(guard).toContain("'DEMO_ROW_CAP: audit_log (row too large)'");
  });

  it("單一請求最多 20 列：交易內計數器（set_config 第三個參數必須是 true），在加鎖之前，超過即拒絕", () => {
    expect(guard).toContain("set_config('demo.audit_rows', v_rows::text, true)");
    expect(guard).toContain("if v_rows > 20 then");
    expect(guard.indexOf("v_rows > 20")).toBeLessThan(guard.indexOf("pg_advisory_xact_lock"));
    expect(guard).toContain("'DEMO_ROW_CAP: audit_log (max 20 rows per request)'");
    // 所有 set_config 都是交易內（第三個參數 true），不會洩漏到連線池的下一個請求。
    const calls = [...guard.matchAll(/set_config\(([^;]*)\);/g)].map((m) => m[1].trim());
    expect(calls.length).toBe(2);
    for (const c of calls) expect(c.endsWith(", true")).toBe(true);
  });

  it("取鎖前設定 lock_timeout = 2s（只在這個交易內），避免排隊請求長時間佔住連線", () => {
    expect(guard).toContain("perform set_config('lock_timeout', '2s', true);");
    expect(guard.indexOf("set_config('lock_timeout'")).toBeLessThan(guard.indexOf("pg_advisory_xact_lock"));
  });

  it("先以 advisory lock 讓同一帳戶的寫入排隊、再計數（硬上限），達上限以 P0001／DEMO_ROW_CAP 拒絕", () => {
    expect(guard).toContain("pg_advisory_xact_lock(hashtextextended('demo-audit-cap:' || v_actor::text, 0))");
    expect(guard.indexOf("pg_advisory_xact_lock")).toBeLessThan(guard.indexOf("count(*)"));
    expect(guard.match(/'DEMO_ROW_CAP: audit_log \(cap %\)'/g)).toHaveLength(1);
    // 四種拒絕：invalid actor、row too large、max 20 rows、cap
    expect(guard.match(/errcode = 'P0001'/g)).toHaveLength(4);
    expect(guard).toContain("每日凌晨會自動還原");
  });

  it("SECURITY DEFINER、search_path 為空、沒有動態 SQL；所有 API 角色收回 execute 且不授權", () => {
    const sig = raw.split("as $$")[0];
    expect(sig).toMatch(/security definer/);
    expect(sig).toMatch(/set search_path = ''/);
    expect(guard).not.toMatch(/\bexecute\b/);
    expect(code(UP)).toContain(
      "revoke execute on function public.demo_audit_log_cap_guard() from public, anon, authenticated, service_role;",
    );
    expect(code(UP)).not.toMatch(/\bgrant\b/i);
  });

  it("所有表與函式都帶 schema 前綴（search_path 為空時才解析得到）", () => {
    expect(guard).not.toMatch(/\bfrom audit_log\b/);
    expect(guard).toContain("from public.audit_log");
  });
});

describe("上限數字在各處一致（獨立抄寫的副本不得與 migration 分歧）", () => {
  it("migration、驗證腳本、整合測試的 500 與 20 / 64 一致", () => {
    const verify = readFileSync(path.resolve(__dirname, "../../ai/artifacts/Demo 體驗帳戶/verification/TASK-122-verify.sql"), "utf8");
    const integration = readFileSync(path.resolve(__dirname, "../demo-audit-log-cap.integration.test.ts"), "utf8");
    expect(verify).toContain(`v_cap constant int := ${APPROVED_CAP};`);
    expect(verify).toContain("DEMO_ROW_CAP: audit_log (cap 500)");
    expect(integration).toContain(`const CAP = ${APPROVED_CAP};`);
    expect(integration).toContain("const MAX_ROWS_PER_REQUEST = 20;");
    expect(code(UP)).toContain("v_rows > 20");
    expect(code(UP)).toContain("> 64");
  });

  it("鎖的 key 前綴與其他 migration 的 advisory lock 不衝突", () => {
    const others = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql") && !f.endsWith("_down.sql") && !f.startsWith("0028_"));
    for (const f of others) expect(code(read(f))).not.toContain("demo-audit-cap:");
  });
});

describe("0028 觸發器與交易結構", () => {
  it("audit_log 上恰好一個 BEFORE INSERT FOR EACH ROW 觸發器 demo_audit_log_cap，呼叫該函式", () => {
    const sql = code(UP);
    expect(sql).toContain(
      "create trigger demo_audit_log_cap\n  before insert on public.audit_log\n  for each row\n  execute function public.demo_audit_log_cap_guard();",
    );
    expect(sql).toContain("drop trigger if exists demo_audit_log_cap on public.audit_log;");
    expect(sql.match(/create trigger/g)).toHaveLength(1);
    // 沒有 WHEN 條件：判斷全在函式內（auth.jwt() 不能放進 WHEN）。
    expect(sql).not.toMatch(/create trigger[^;]*\bwhen\b/i);
  });

  it("有依賴檢查，在 begin／commit 交易內，且有尾端自我檢查", () => {
    expect(UP).toContain("0028 缺少前置資料表 public.audit_log");
    // 不再依賴 auth schema（預篩與解析都用 request.jwt.claims 字串）。
    expect(code(UP)).not.toMatch(/auth\.jwt\(|auth\.uid\(/);
    expect(UP.indexOf("\nbegin;\n")).toBeGreaterThan(-1);
    expect(UP.trimEnd().endsWith("commit;")).toBe(true);
    expect(UP).toContain("0028 自我檢查失敗");
    expect(UP).toContain("r.rolbypassrls");
    expect(UP).toContain("p.proconfig @> array['search_path=\"\"']");
    expect(UP).toContain("has_function_privilege('anon', 'public.demo_audit_log_cap_guard()', 'execute')");
    expect(UP).toContain("has_function_privilege('service_role', 'public.demo_audit_log_cap_guard()', 'execute')");
  });

  it("不動任何 policy、資料表結構、grant、既有資料，也不碰 reset_demo_data", () => {
    const sql = code(UP);
    expect(sql).not.toMatch(/create\s+policy|drop\s+policy|alter\s+table|insert\s+into|update\s+public|delete\s+from|truncate|create\s+index/i);
    expect(sql).not.toMatch(/reset_demo_data/);
    expect(sql).not.toMatch(/\bgrant\b/i);
    expect(code(DOWN)).not.toMatch(/reset_demo_data/);
  });

  it("_down 先移除觸發器再移除函式，不建立觸發器，有自我檢查", () => {
    const sql = code(DOWN);
    expect(sql).toContain("drop trigger if exists demo_audit_log_cap on public.audit_log;");
    expect(sql).toContain("drop function if exists public.demo_audit_log_cap_guard();");
    expect(sql.indexOf("drop trigger")).toBeLessThan(sql.indexOf("drop function"));
    expect(sql).not.toMatch(/create\s+(trigger|function)/i);
    expect(DOWN).toContain("0028_down 自我檢查失敗");
    expect(DOWN.indexOf("\nbegin;\n")).toBeGreaterThan(-1);
    expect(DOWN.trimEnd().endsWith("commit;")).toBe(true);
  });

  it("檔頭寫明緊急停用的一行語句", () => {
    expect(UP).toContain("--   drop trigger if exists demo_audit_log_cap on public.audit_log;");
  });
});

describe("與 reset_demo_data 的關係（為什麼不需要改它）", () => {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql") && !f.endsWith("_down.sql"));

  it("最新一份 reset_demo_data 的觸發器檢查範圍不含 audit_log（還原只 delete … where actor_id = Demo）", () => {
    const definers = files.filter((f) => read(f).includes("create or replace function public.reset_demo_data(")).sort();
    expect(definers.length).toBeGreaterThan(0);
    const latest = read(definers[definers.length - 1]);
    const open = latest.indexOf("c.relname in (");
    const close = latest.indexOf(")", open);
    expect(open).toBeGreaterThan(0);
    const scanned = [...latest.slice(open, close).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(scanned.length).toBe(11);
    expect(scanned).not.toContain("audit_log");
    // 還原對 audit_log 只刪 Demo 帳戶的列。
    expect(latest).toContain("delete from public.audit_log where actor_id = v_demo_id;");
  });

  it("全部 migration 中，只有 0028 在 audit_log 上建立觸發器；日後再加時要重新評估與 reset_demo_data 的關係", () => {
    const creators = files.filter((f) => /create\s+trigger[^;]*\bon\s+public\.audit_log\b/i.test(code(read(f))));
    expect(creators).toEqual(["0028_demo_audit_log_cap.sql"]);
  });

  it("audit_log 的欄位層級 insert grant 不含 actor_id／created_at（0019），所以 new.actor_id 一定是 auth.uid()", () => {
    const sql = code(read("0019_audit_log.sql"));
    const grant = sql.match(/grant insert \(([^)]*)\)\s+on public\.audit_log to authenticated;/);
    expect(grant, "找不到 audit_log 的欄位層級 insert grant").not.toBeNull();
    const cols = grant![1].split(",").map((c) => c.trim());
    expect(cols).toEqual(["event_type", "entity_type", "entity_id", "summary", "changes"]);
    expect(sql).toContain("alter table public.audit_log alter column actor_id set default auth.uid();");
  });
});
