import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// TASK-120：0030 只能在 create_appointment 既有兩道 BOOKING_LIMIT 檢查之後各加一道「過去 24 小時內建立、不分狀態」
// 的滾動視窗檢查，其餘與 0018 逐字相同；_down 要把函式還原成 0018 的原本文。這裡以檔案內容逐字比對把關（不連資料庫）。

const MIGRATIONS = path.resolve(__dirname, "../../supabase/migrations");
const read = (name: string) => readFileSync(path.join(MIGRATIONS, name), "utf8").replace(/\r\n/g, "\n");

const ORIGINAL = read("0018_designer_aware_booking.sql");
const UP = read("0030_booking_limit_rolling_window.sql");
const DOWN = read("0030_booking_limit_rolling_window_down.sql");

const FN_START = "create or replace function public.create_appointment(";
const FN_END =
  "grant execute on function public.create_appointment(uuid, timestamptz, text, text, text, uuid) to anon, authenticated, service_role;";

// 函式本文（含結尾的 revoke／grant 行）。
function functionBlock(sql: string): string {
  const start = sql.indexOf(FN_START);
  const end = sql.indexOf(FN_END);
  expect(start, "找不到函式開頭").toBeGreaterThanOrEqual(0);
  expect(end, "找不到 grant 行").toBeGreaterThan(start);
  return sql.slice(start, end + FN_END.length);
}

// 去掉整行註解，只比對實際的 SQL。
const code = (sql: string) =>
  sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

const PHONE_MARKER = "\n  -- TASK-120 滾動視窗：同號碼";
const PHONE_END = "  if v_pending_count >= 3 then\n    return jsonb_build_object('ok', false, 'error_code', 'BOOKING_LIMIT_EXCEEDED', 'message', 'too many pending appointments');\n  end if;\n";
const EMAIL_MARKER = "\n    -- TASK-120 滾動視窗（Email）";
const EMAIL_END = "    if v_email_count >= 3 then\n      return jsonb_build_object('ok', false, 'error_code', 'BOOKING_LIMIT_EXCEEDED', 'message', 'too many pending appointments');\n    end if;\n";

// 取出一個「新增區塊」：從標記行（含前面的空行）到它自己的 end if;（含）。
function addedBlock(block: string, marker: string, end: string): { start: number; stop: number } {
  const start = block.indexOf(marker);
  expect(start, `找不到新增區塊 ${marker.trim()}`).toBeGreaterThan(0);
  const endAt = block.indexOf(end, start);
  expect(endAt, "新增區塊沒有收尾的 end if").toBeGreaterThan(start);
  return { start, stop: endAt + end.length };
}

function withoutAddedBlocks(block: string): string {
  const phone = addedBlock(block, PHONE_MARKER, PHONE_END);
  const withoutPhone = block.slice(0, phone.start) + block.slice(phone.stop);
  const email = addedBlock(withoutPhone, EMAIL_MARKER, EMAIL_END);
  return withoutPhone.slice(0, email.start) + withoutPhone.slice(email.stop);
}

describe("0030 滾動視窗 migration（TASK-120）", () => {
  it("_down 的函式本文（含授權）與 0018 逐字相同，沒有滾動視窗", () => {
    expect(functionBlock(DOWN)).toBe(functionBlock(ORIGINAL));
    expect(code(DOWN)).not.toContain("24 hours");
  });

  it("0030 的函式本文拿掉兩個新增區塊後，與 0018 逐字相同（只多不少、沒有改到其他地方）", () => {
    expect(withoutAddedBlocks(functionBlock(UP))).toBe(functionBlock(ORIGINAL));
  });

  it("恰好兩道滾動視窗檢查：電話一道、Email 一道，不分狀態、以 created_at 計、門檻與既有相同（≥ 3）", () => {
    const block = functionBlock(UP);
    const phone = block.slice(...Object.values(addedBlock(block, PHONE_MARKER, PHONE_END)) as [number, number]);
    const email = block.slice(...Object.values(addedBlock(block, EMAIL_MARKER, EMAIL_END)) as [number, number]);

    expect(code(block).split("interval '24 hours'")).toHaveLength(3);

    const phoneSql = code(phone);
    expect(phoneSql).toContain("where customer_phone = v_phone_digits\n    and created_at > now() - interval '24 hours';");
    expect(phoneSql).toContain("if v_pending_count >= 3 then");
    expect(phoneSql).not.toMatch(/status|start_at/);

    const emailSql = code(email);
    expect(emailSql).toContain("where public._email_dedupe_key(customer_email) = v_email_key\n      and created_at > now() - interval '24 hours';");
    expect(emailSql).toContain("if v_email_count >= 3 then");
    expect(emailSql).not.toMatch(/status|start_at/);

    // 不新增錯誤碼、不新增訊息：不洩漏是哪一道檢查擋下。
    for (const part of [phoneSql, emailSql]) {
      expect(part).toContain("'error_code', 'BOOKING_LIMIT_EXCEEDED', 'message', 'too many pending appointments'");
    }
  });

  it("新增的檢查在 advisory lock 之後、既有檢查之後、顧客去重與 insert 之前；Email 那道在 v_email is not null 的區塊內", () => {
    const body = code(functionBlock(UP));
    const lockAt = body.indexOf("pg_advisory_xact_lock(pg_catalog.hashtextextended('create_appointment:email:'");
    const firstWindow = body.indexOf("interval '24 hours'");
    const secondWindow = body.indexOf("interval '24 hours'", firstWindow + 1);
    const oldPhone = body.indexOf("and status in ('pending', 'confirmed')\n    and start_at > now();");
    const dedupe = body.indexOf("select id into v_customer_id from public.customers where phone");
    const insertAt = body.indexOf("insert into public.appointments");

    expect(lockAt).toBeGreaterThan(0);
    expect(oldPhone).toBeGreaterThan(lockAt);
    expect(firstWindow).toBeGreaterThan(oldPhone);
    expect(secondWindow).toBeGreaterThan(firstWindow);
    expect(secondWindow).toBeLessThan(dedupe);
    expect(dedupe).toBeLessThan(insertAt);

    // Email 那道位於 `if v_email is not null then` 與緊接的 `end if;`（顧客去重之前）之間。
    const emailBlockStart = body.indexOf("  if v_email is not null then\n    select count(*) into v_email_count");
    expect(emailBlockStart).toBeGreaterThan(firstWindow);
    expect(secondWindow).toBeGreaterThan(emailBlockStart);
  });

  it("0030 不動觸發器、授權以外的物件，也不碰確認信路徑", () => {
    for (const sql of [UP, DOWN]) {
      expect(code(sql)).not.toMatch(/create\s+trigger|drop\s+trigger|notify_appointment_insert|alter\s+(table|trigger)|disable\s+trigger|create\s+(unique\s+)?index/i);
    }
  });

  it("0030 與 _down 各只有一份函式定義，授權敘述與 0018 相同（revoke 先、grant 後）", () => {
    for (const sql of [UP, DOWN]) {
      const executable = code(sql);
      expect(executable.match(/create\s+or\s+replace\s+function/gi)).toHaveLength(1);
      expect(executable.match(/\bgrant\b/gi)).toHaveLength(1);
      const revokeAt = executable.indexOf("revoke execute on function public.create_appointment(");
      const grantAt = executable.indexOf("grant execute on function public.create_appointment(");
      expect(revokeAt).toBeGreaterThan(0);
      expect(grantAt).toBeGreaterThan(revokeAt);
    }
  });

  it("日後若有 migration 重新定義 create_appointment（六參數），編號最大的那份必須仍含滾動視窗（0018 不能改，不能複製它）", () => {
    const definers = readdirSync(MIGRATIONS)
      .filter((name) => name.endsWith(".sql") && !name.endsWith("_down.sql"))
      .filter((name) => /create\s+or\s+replace\s+function\s+public\.create_appointment\(\s*p_service_id uuid,[\s\S]*?p_designer_id uuid/i.test(read(name)))
      .sort();
    expect(definers.length).toBeGreaterThanOrEqual(2); // 至少 0018 與 0030
    const latest = definers[definers.length - 1];
    expect(code(read(latest)).split("interval '24 hours'"), `${latest} 重新定義了 create_appointment 卻沒有滾動視窗`).toHaveLength(3);
  });

  it("0030 有依賴檢查，且在 begin／commit 交易內；_down 同樣", () => {
    expect(UP).toContain("to_regprocedure('public.create_appointment(uuid, timestamptz, text, text, text, uuid)') is null");
    expect(UP).toContain("to_regprocedure('public._email_dedupe_key(text)') is null");
    expect(UP).toContain("column_name = 'created_at'");
    expect(UP.indexOf("\nbegin;\n")).toBeGreaterThan(-1);
    expect(UP.trimEnd().endsWith("commit;")).toBe(true);
    expect(DOWN.indexOf("\nbegin;\n")).toBeGreaterThan(-1);
    expect(DOWN.trimEnd().endsWith("commit;")).toBe(true);
  });
  it("兩個新增區塊逐字固定（不能在區塊內夾帶其他敘述）", () => {
    const block = functionBlock(UP);
    const phone = addedBlock(block, PHONE_MARKER, PHONE_END);
    const email = addedBlock(block, EMAIL_MARKER, EMAIL_END);
    expect(code(block.slice(phone.start, phone.stop))).toBe(
      `
  select count(*) into v_pending_count
  from public.appointments
  where customer_phone = v_phone_digits
    and created_at > now() - interval '24 hours';

  if v_pending_count >= 3 then
    return jsonb_build_object('ok', false, 'error_code', 'BOOKING_LIMIT_EXCEEDED', 'message', 'too many pending appointments');
  end if;
`,
    );
    expect(code(block.slice(email.start, email.stop))).toBe(
      `
    select count(*) into v_email_count
    from public.appointments
    where public._email_dedupe_key(customer_email) = v_email_key
      and created_at > now() - interval '24 hours';

    if v_email_count >= 3 then
      return jsonb_build_object('ok', false, 'error_code', 'BOOKING_LIMIT_EXCEEDED', 'message', 'too many pending appointments');
    end if;
`,
    );
  });

  it("函式以外只有依賴檢查（do 區塊，只讀）與 begin／notify／commit：沒有任何寫入或 DDL 敘述", () => {
    for (const sql of [UP, DOWN]) {
      const executable = code(sql);
      const fnStart = executable.indexOf(FN_START);
      const fnEnd = executable.indexOf(FN_END) + FN_END.length;
      const outside = executable.slice(0, fnStart) + executable.slice(fnEnd);

      const doBlocks = outside.match(/do \$\$[\s\S]*?\$\$;/g) ?? [];
      expect(doBlocks).toHaveLength(1);
      expect(doBlocks[0]).not.toMatch(/\b(insert|update|delete|drop|truncate|alter|create|grant|revoke)\b/i);

      const rest = outside.replace(doBlocks[0]!, "");
      const statements = rest
        .split(";")
        .map((statement) => statement.replace(/\s+/g, " ").trim())
        .filter(Boolean);
      expect(statements).toEqual(["begin", "notify pgrst, 'reload schema'", "commit"]);
    }
  });
});
