import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// TASK-114：0026 只能在 notify_appointment_update() 開頭多一道 Demo 守門，其餘與 0012 逐字相同；
// _down 要把函式還原成 0012 的原本文。這裡以檔案內容逐字比對把關（不連資料庫）。

const MIGRATIONS = path.resolve(__dirname, "../../supabase/migrations");
const read = (name: string) => readFileSync(path.join(MIGRATIONS, name), "utf8").replace(/\r\n/g, "\n");

const ORIGINAL = read("0012_appointments_update_webhook.sql");
const UP = read("0026_demo_suppress_update_mail.sql");
const DOWN = read("0026_demo_suppress_update_mail_down.sql");

const FN_START = "create or replace function public.notify_appointment_update()";
const FN_END = "revoke execute on function public.notify_appointment_update() from public;";

// 函式本文（含 revoke 行）。
function functionBlock(sql: string): string {
  const start = sql.indexOf(FN_START);
  const end = sql.indexOf(FN_END);
  expect(start, "找不到函式開頭").toBeGreaterThanOrEqual(0);
  expect(end, "找不到 revoke 行").toBeGreaterThan(start);
  return sql.slice(start, end + FN_END.length);
}

// 去掉整行註解，只比對實際的 SQL（註解裡可能提到 net.http_post、notify_appointment_insert 等字樣）。
const code = (sql: string) =>
  sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

const GUARD_CONDITION = "if coalesce(auth.jwt() -> 'app_metadata' ->> 'is_demo', '') = 'true' then";

describe("0026 Demo 寄信守門 migration（TASK-114）", () => {
  it("_down 的函式本文與 0012 逐字相同（沒有守門）", () => {
    expect(functionBlock(DOWN)).toBe(functionBlock(ORIGINAL));
    expect(DOWN).not.toContain("is_demo");
  });

  it("0026 的函式本文拿掉守門區塊後，與 0012 逐字相同", () => {
    const block = functionBlock(UP);
    const guardStart = block.indexOf("  -- TASK-114 Demo 守門");
    const guardEnd = block.indexOf("  end if;\n\n", guardStart);
    expect(guardStart).toBeGreaterThan(0);
    expect(guardEnd).toBeGreaterThan(guardStart);
    const withoutGuard = block.slice(0, guardStart) + block.slice(guardEnd + "  end if;\n\n".length);
    expect(withoutGuard).toBe(functionBlock(ORIGINAL));
  });

  it("守門只有一處、條件讀 JWT 的 app_metadata.is_demo，且在讀 Vault 與送 webhook 之前早退", () => {
    const block = code(functionBlock(UP));
    expect(block.split(GUARD_CONDITION)).toHaveLength(2);
    const guardAt = block.indexOf(GUARD_CONDITION);
    expect(block.slice(guardAt, guardAt + GUARD_CONDITION.length + 40)).toContain("return new;");
    expect(guardAt).toBeGreaterThan(block.indexOf("\nbegin\n"));
    expect(guardAt).toBeLessThan(block.indexOf("vault.decrypted_secrets"));
    expect(guardAt).toBeLessThan(block.indexOf("net.http_post"));
    // 不得改讀可被使用者改寫的來源。
    expect(block).not.toMatch(/user_metadata|raw_user_meta_data/);
  });

  it("0026 不動觸發器與確認信路徑", () => {
    expect(code(UP)).not.toMatch(/create\s+trigger|drop\s+trigger|notify_appointment_insert/i);
    expect(code(DOWN)).not.toMatch(/create\s+trigger|drop\s+trigger|notify_appointment_insert/i);
  });

  it("守門區塊逐字固定：緊接在函式的 begin 之後、讀 Vault 之前，中間沒有其他敘述", () => {
    const body = code(functionBlock(UP));
    expect(body).toContain(
      "\nbegin\n  " + GUARD_CONDITION + "\n    return new;\n  end if;\n\n  select decrypted_secret into v_webhook_url",
    );
  });

  it("0026 與 _down 只有一份函式定義，且不附加停用觸發器、改觸發器或授權敘述（守門不能被後面的敘述架空）", () => {
    for (const sql of [UP, DOWN]) {
      const executable = code(sql);
      expect(executable.match(/create\s+or\s+replace\s+function/gi)).toHaveLength(1);
      expect(executable).not.toMatch(/alter\s+(table|trigger)|disable\s+trigger|\bgrant\b/i);
    }
  });

  it("日後若有 migration 重新定義 notify_appointment_update()，編號最大的那份必須仍含 Demo 守門（0012 不能改，不能複製它）", () => {
    const definers = readdirSync(MIGRATIONS)
      .filter((name) => name.endsWith(".sql") && !name.endsWith("_down.sql"))
      .filter((name) => /create\s+or\s+replace\s+function\s+public\.notify_appointment_update\(/i.test(read(name)))
      .sort();
    expect(definers.length).toBeGreaterThanOrEqual(2); // 至少 0012 與 0026
    const latest = definers[definers.length - 1];
    expect(code(read(latest)), `${latest} 重新定義了 notify_appointment_update() 卻沒有 Demo 守門`).toContain(GUARD_CONDITION);
  });

  it("0026 有依賴檢查，且在 begin／commit 交易內", () => {
    expect(UP).toContain("to_regprocedure('public.notify_appointment_update()') is null");
    expect(UP).toContain("appointments_notify_update");
    expect(UP.indexOf("\nbegin;\n")).toBeGreaterThan(-1);
    expect(UP.trimEnd().endsWith("commit;")).toBe(true);
    expect(DOWN.trimEnd().endsWith("commit;")).toBe(true);
  });
});
