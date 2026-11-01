import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import baseJson from "@/lib/demo/seed-base.json";
import { buildDemoSeed } from "@/lib/demo/seed-data";
import type { DemoSeedBase } from "@/lib/demo/seed-types";

// TASK-116：0027 的 Demo 筆數上限。不連資料庫，以檔案內容把關：
//   * 上限數字與使用者核准的一致，且只有函式內 case 一處來源；
//   * reset_demo_data 除了觸發器白名單外與 0024 逐字相同（_down 還原成 0024）；
//   * 日後任何 migration 在「會被還原覆寫的表」上新增觸發器，都必須補進最新 reset_demo_data 的白名單；
//   * seed 各表筆數小於上限，Demo 還原後仍有操作空間。

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

const UP = read("0027_demo_row_caps.sql");
const DOWN = read("0027_demo_row_caps_down.sql");
const ORIGINAL_RESET = read("0024_demo_reset.sql");

// 使用者核准的上限（2026-10-31／2026-11-01）；改這裡必須同時改 0027 與 TASK-116-verify.sql。
const APPROVED_CAPS: Record<string, number> = {
  services: 10,
  designers: 5,
  designer_services: 50,
  designer_leaves: 20,
  designer_portfolio_images: 60,
  closed_dates: 20,
};
// 審查後移除的表（初版曾有 customers 24／appointments 640）：Demo 只能經 create_appointment 寫入，匿名訪客能呼叫同一個 RPC，
// 上限擋不到灌資料的人，反而讓匿名流量能擠掉 Demo 的預約。0027 必須清掉初版建立的觸發器，且不得再建立。
const REMOVED_TABLES = ["customers", "appointments"];
const TABLES = Object.keys(APPROVED_CAPS).sort();
const NEW_TRIGGERS = TABLES.map((t) => `demo_row_cap_${t}`);

// reset_demo_data 覆寫的十一張表（0024 的觸發器守門範圍）。
const RESET_TABLES = [
  "services", "designers", "designer_services", "designer_leaves", "designer_portfolio_images",
  "business_hours", "closed_dates", "booking_policy", "store_settings", "appointments", "customers",
];

const RESET_START = "create or replace function public.reset_demo_data(p_payload jsonb, p_dry_run boolean)";
const RESET_END = "grant execute on function public.reset_demo_data(jsonb, boolean) to service_role;";
function resetBlock(sql: string): string {
  const start = sql.indexOf(RESET_START);
  const end = sql.indexOf(RESET_END);
  expect(start, "找不到 reset_demo_data 開頭").toBeGreaterThanOrEqual(0);
  expect(end, "找不到 reset_demo_data 結尾").toBeGreaterThan(start);
  return sql.slice(start, end + RESET_END.length);
}

// 白名單：`and t.tgname not in ( ... );` 之間的引號字串。
function whitelist(sql: string): string[] {
  const block = resetBlock(sql);
  const open = block.indexOf("and t.tgname not in (");
  const close = block.indexOf(");", open);
  expect(open, "找不到觸發器白名單").toBeGreaterThan(0);
  return [...code(block.slice(open, close)).matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
}

function guardFunction(sql: string): string {
  const start = sql.indexOf("create or replace function public.demo_row_cap_guard()");
  const end = sql.indexOf("\n$$;", start);
  expect(start, "找不到 demo_row_cap_guard").toBeGreaterThanOrEqual(0);
  return sql.slice(start, end + 4);
}

describe("0027 Demo 筆數上限觸發器函式（TASK-116）", () => {
  const guard = code(guardFunction(UP));

  it("上限只有函式內 case 一處來源，數字與核准值逐表一致，沒有多餘的表", () => {
    const caseStart = guard.indexOf("case tg_table_name");
    const caseEnd = guard.indexOf("end;", caseStart);
    expect(caseStart).toBeGreaterThan(0);
    const found = Object.fromEntries(
      [...guard.slice(caseStart, caseEnd).matchAll(/^\s*when '([a-z_]+)' then (\d+)\s*$/gm)].map((m) => [m[1], Number(m[2])]),
    );
    expect(found).toEqual(APPROVED_CAPS);
    expect(guard.match(/\bcase\b/g)).toHaveLength(1);
    expect(guard).toMatch(/\n    else null\n  end;/); // 表名不在 case 內才放行；不得改成 else <數字>
  });

  it("先以字串預篩（沒有 is_demo 就放行、不解析 JSON、不依賴 auth schema），疑似 Demo 才讀簽章後的 app_metadata.is_demo，且都在加鎖與計數之前", () => {
    const prescreen = "if v_claims is null or strpos(v_claims, 'is_demo') = 0 then\n    return new;\n  end if;";
    const condition = "if coalesce(auth.jwt() -> 'app_metadata' ->> 'is_demo', '') <> 'true' then\n    return new;\n  end if;";
    expect(guard).toContain(prescreen);
    expect(guard).toContain(condition);
    expect(guard).toContain("current_setting('request.jwt.claims', true)");
    expect(guard.indexOf(prescreen)).toBeLessThan(guard.indexOf("auth.jwt()"));
    expect(guard.indexOf("auth.jwt()")).toBeLessThan(guard.indexOf("pg_advisory_xact_lock"));
    expect(guard.indexOf(condition)).toBeLessThan(guard.indexOf("pg_advisory_xact_lock"));
    expect(guard.indexOf(condition)).toBeLessThan(guard.indexOf("count(*)"));
    // 只有一處 auth.jwt()，且不得改讀可被使用者改寫的來源。
    expect(guard.match(/auth\.jwt\(\)/g)).toHaveLength(1);
    expect(guard).not.toMatch(/user_metadata|raw_user_meta_data|raw_app_meta_data/);
  });

  it("先以 advisory lock 讓同一張表的 Demo 寫入排隊、再計數（硬上限），達上限以 P0001／DEMO_ROW_CAP 拒絕", () => {
    expect(guard.indexOf("pg_advisory_xact_lock")).toBeGreaterThan(0);
    expect(guard.indexOf("pg_advisory_xact_lock")).toBeLessThan(guard.indexOf("count(*)"));
    expect(guard).toContain("if v_count >= v_cap then");
    expect(guard).toContain("'DEMO_ROW_CAP: % (cap %)'");
    expect(guard).toContain("errcode = 'P0001'");
  });

  it("SECURITY DEFINER、search_path 為空；動態 SQL 只用 %I 嵌入觸發器提供的名稱；所有 API 角色收回 execute", () => {
    const sig = guardFunction(UP).split("as $$")[0];
    expect(sig).toMatch(/security definer/);
    expect(sig).toMatch(/set search_path = ''/);
    expect(guard).toContain("execute format('select count(*) from %I.%I', tg_table_schema, tg_table_name)");
    expect(code(UP)).toContain(
      "revoke execute on function public.demo_row_cap_guard() from public, anon, authenticated, service_role;",
    );
    expect(code(UP)).not.toMatch(/\bgrant\b[^;]*demo_row_cap_guard/i);
  });
});

describe("0027 觸發器與交易結構", () => {
  it("customers／appointments 不再有上限觸發器：0027 只清除初版建立的，且自我檢查確認已清掉；_down 也會清", () => {
    const sql = code(UP);
    const downSql = code(DOWN);
    for (const t of REMOVED_TABLES) {
      expect(sql).toContain(`drop trigger if exists demo_row_cap_${t} on public.${t};`);
      expect(downSql).toContain(`drop trigger if exists demo_row_cap_${t} on public.${t};`);
      expect(sql).not.toContain(`create trigger demo_row_cap_${t}`);
      expect(sql).not.toMatch(new RegExp(`when '${t}' then`));
      expect(whitelist(UP)).not.toContain(`demo_row_cap_${t}`);
    }
    expect(sql).toContain("tgname in ('demo_row_cap_customers', 'demo_row_cap_appointments')");
    expect(sql).toContain("0027 自我檢查失敗：初版的");
  });

  it("六張表各有一個 BEFORE INSERT FOR EACH ROW 觸發器，名稱為 demo_row_cap_<表>，都呼叫同一個函式", () => {
    const sql = code(UP);
    for (const t of TABLES) {
      expect(sql).toContain(
        `create trigger demo_row_cap_${t}\n  before insert on public.${t}\n  for each row\n  execute function public.demo_row_cap_guard();`,
      );
      expect(sql).toContain(`drop trigger if exists demo_row_cap_${t} on public.${t};`);
    }
    expect(sql.match(/create trigger/g)).toHaveLength(TABLES.length);
  });

  it("有依賴檢查，在 begin／commit 交易內，且有尾端自我檢查", () => {
    expect(UP).toContain("0027 缺少前置資料表");
    expect(UP).toContain("to_regprocedure('auth.jwt()') is null");
    expect(UP).toContain("to_regprocedure('public.reset_demo_data(jsonb,boolean)') is null");
    expect(UP.indexOf("\nbegin;\n")).toBeGreaterThan(-1);
    expect(UP.trimEnd().endsWith("commit;")).toBe(true);
    expect(UP).toContain("0027 自我檢查失敗");
    expect(UP).toContain("r.rolbypassrls");
    expect(UP).toContain("has_function_privilege('anon', 'public.demo_row_cap_guard()', 'execute')");
    for (const t of TABLES) expect(UP).toContain(`'public.${t}'`);
  });

  it("不動任何 policy、資料表結構或既有資料", () => {
    // 排除 reset_demo_data 本文（它本來就會寫入資料，但只有 service_role 能執行，且與 0024 逐字相同）。
    const sql = code(UP.replace(resetBlock(UP), ""));
    expect(sql).not.toMatch(/create\s+policy|drop\s+policy|alter\s+table|insert\s+into|update\s+public|delete\s+from|truncate/i);
  });

  it("_down 先移除八個觸發器再移除函式，最後還原 reset_demo_data，且不建立觸發器", () => {
    const sql = code(DOWN);
    for (const t of TABLES) expect(sql).toContain(`drop trigger if exists demo_row_cap_${t} on public.${t};`);
    expect(sql).toContain("drop function if exists public.demo_row_cap_guard();");
    expect(DOWN).toContain("0027_down 自我檢查失敗");
    expect(DOWN).toContain("0028 以上");
    expect(sql.lastIndexOf("drop trigger")).toBeLessThan(sql.indexOf("drop function if exists public.demo_row_cap_guard"));
    expect(sql.indexOf("drop function if exists public.demo_row_cap_guard")).toBeLessThan(sql.indexOf(RESET_START));
    expect(sql).not.toMatch(/create\s+trigger/i);
    expect(DOWN.trimEnd().endsWith("commit;")).toBe(true);
  });
});

describe("reset_demo_data 與 0024 逐字相同（TASK-116 只擴充觸發器白名單）", () => {
  it("_down 的 reset_demo_data 與 0024 逐字相同（白名單不含新觸發器）", () => {
    expect(resetBlock(DOWN)).toBe(resetBlock(ORIGINAL_RESET));
    expect(whitelist(DOWN).some((n) => n.startsWith("demo_row_cap_"))).toBe(false);
  });

  it("0027 的 reset_demo_data 拿掉新增的白名單項目後，與 0024 逐字相同", () => {
    const added = /,\n      -- TASK-116[^\n]*(\n      'demo_row_cap_[^\n]*)+(?=\n    \);)/;
    const block = resetBlock(UP);
    expect(block).toMatch(added);
    expect(block.replace(added, "")).toBe(resetBlock(ORIGINAL_RESET));
  });

  it("0027 的白名單 = 0024 的白名單 + 八個新觸發器，不多不少", () => {
    expect([...whitelist(UP)].sort()).toEqual([...whitelist(ORIGINAL_RESET), ...NEW_TRIGGERS].sort());
  });

  it("權限未變：只有 service_role 能執行 reset_demo_data", () => {
    const sql = code(resetBlock(UP));
    expect(sql).toContain("revoke execute on function public.reset_demo_data(jsonb, boolean) from public, anon, authenticated, service_role;");
    expect(sql).toContain("grant execute on function public.reset_demo_data(jsonb, boolean) to service_role;");
  });
});

describe("日後新增的觸發器必須同步補進還原的白名單", () => {
  const migrations = readdirSync(MIGRATIONS)
    .filter((n) => n.endsWith(".sql") && !n.endsWith("_down.sql"))
    .sort();

  it("所有 migration 在被覆寫的十一張表上建立的觸發器，都在編號最大的 reset_demo_data 白名單內", () => {
    const definers = migrations.filter((n) => code(read(n)).includes("create or replace function public.reset_demo_data("));
    expect(definers.length).toBeGreaterThanOrEqual(2); // 0024 與 0027
    const latest = definers[definers.length - 1];
    const allowed = new Set(whitelist(read(latest)));

    const created: Array<{ file: string; trigger: string; table: string }> = [];
    for (const file of migrations) {
      // 容許 constraint trigger、引號識別字、大小寫混用，以及省略 schema（預設 public）。
      for (const m of code(read(file)).matchAll(/create\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\s+"?(\w+)"?([^;]*?)\son\s+(?:"?(\w+)"?\.)?"?(\w+)"?/gi)) {
        const schema = (m[3] ?? "public").toLowerCase();
        if (schema === "public" && RESET_TABLES.includes(m[4].toLowerCase())) created.push({ file, trigger: m[1], table: m[4] });
      }
    }
    // 至少要抓到 0024 白名單內的既有觸發器與八個新觸發器，否則這個測試等於空轉。
    expect(created.length).toBeGreaterThanOrEqual(14);
    const missing = created.filter((c) => !allowed.has(c.trigger));
    expect(missing, `這些觸發器沒有列入 ${latest} 的 reset_demo_data 白名單（還原會在守門區失敗）`).toEqual([]);
  });
});

describe("seed 與上限", () => {
  it("seed 各表筆數都小於上限（Demo 還原後仍有新增空間）", () => {
    // 連續 30 個起始日取各表最大值：預約筆數隨營業日／週間對齊略有不同。
    const max: Record<string, number> = Object.fromEntries(TABLES.map((t) => [t, 0]));
    for (let day = 0; day < 30; day += 1) {
      const now = new Date(Date.parse("2026-10-31T06:00:00.000Z") + day * 24 * 60 * 60 * 1000);
      const payload = buildDemoSeed(now, baseJson as unknown as DemoSeedBase);
      const counts: Record<string, number> = {
        services: payload.services.length,
        designers: payload.designers.length,
        designer_services: payload.designer_services.length,
        designer_leaves: payload.designer_leaves.length,
        designer_portfolio_images: payload.portfolio_images.length,
        closed_dates: payload.closed_dates.length,
        customers: payload.customers.length,
        appointments: payload.appointments.length,
      };
      for (const t of TABLES) max[t] = Math.max(max[t], counts[t]);
    }
    for (const t of TABLES) {
      expect(max[t], `${t} 的 seed 筆數（30 個起始日取最大）必須小於上限 ${APPROVED_CAPS[t]}`).toBeLessThan(APPROVED_CAPS[t]);
    }
  });
});

describe("驗證腳本與 migration 的上限一致", () => {
  it("TASK-116-verify.sql 內獨立抄寫的上限與核准值一致，且以 raise exception 收尾保證 rollback", () => {
    const verify = readFileSync(
      path.resolve(__dirname, "../../ai/artifacts/Demo 體驗帳戶/verification/TASK-116-verify.sql"),
      "utf8",
    ).replace(/\r\n/g, "\n");
    const json = verify.match(/v_caps constant jsonb := '(\{[^']*\})'/);
    expect(json).not.toBeNull();
    expect(JSON.parse(json![1])).toEqual(APPROVED_CAPS);
    expect(code(verify)).toMatch(/raise exception E'TASK-116 verify RESULT=/);
    expect(code(verify)).not.toMatch(/^\s*commit\s*;/im); // 腳本本身不得提交交易（temp 表的 on commit drop 不算）
  });
});
