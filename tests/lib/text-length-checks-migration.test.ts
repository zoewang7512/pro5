import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SERVICE_DESCRIPTION_MAX_LENGTH, SERVICE_NAME_MAX_LENGTH } from "@/lib/admin/services";
import { STORE_ADDRESS_MAX_LENGTH, STORE_NAME_MAX_LENGTH } from "@/lib/store-settings";

// TASK-123：0029 的 services／store_settings 文字欄位長度 CHECK。不連資料庫，以檔案內容把關：
//   * 六個 CHECK 的資料表、欄位、上限、constraint 名稱與核准值一致；
//   * SQL 的上限與前端驗證常數一致（資料庫是最終防線，前端是體驗優化，兩邊不得漂移）；
//   * 套用前的既有資料檢查與 CHECK 使用同一組數字；不使用 NOT VALID；不改任何資料；
//   * _down 只移除這六個，不動 0006 既有的 description／phone CHECK；
//   * Demo 種子資料（每日還原寫回這兩張表的來源）全部符合上限，之後改種子超過上限會在這裡先失敗。

const ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS = path.join(ROOT, "supabase", "migrations");
const read = (name: string) => readFileSync(path.join(MIGRATIONS, name), "utf8").replace(/\r\n/g, "\n");
// 剝除區塊註解、整行註解與行尾註解（避免把語句「註解掉」卻仍通過文字比對）。
const code = (sql: string) =>
  sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .map((line) => line.replace(/\s--.*$/, ""))
    .join("\n");

const UP = code(read("0029_text_length_checks.sql"));
const DOWN = code(read("0029_text_length_checks_down.sql"));

// 使用者核准的上限（2026-11-01，卡片建議值）。改這裡必須同時改 0029、前端常數與整合測試。
const APPROVED = [
  { table: "services", column: "name", cap: 60, name: "services_name_length", nullable: false },
  { table: "services", column: "description", cap: 500, name: "services_description_length", nullable: true },
  { table: "store_settings", column: "name", cap: 200, name: "store_settings_name_length", nullable: false },
  { table: "store_settings", column: "address", cap: 200, name: "store_settings_address_length", nullable: true },
  { table: "store_settings", column: "logo_url", cap: 2048, name: "store_settings_logo_url_length", nullable: true },
  {
    table: "store_settings",
    column: "cover_image_url",
    cap: 2048,
    name: "store_settings_cover_image_url_length",
    nullable: true,
  },
] as const;

describe("0029 長度 CHECK（TASK-123）", () => {
  it("恰好六個 add constraint，欄位、上限、名稱與核准值一致", () => {
    // 兩種寫法：not null 欄位 char_length(col) <= N；可為 null 欄位 char_length(coalesce(col, '')) <= N（與 0006 同）。
    const found = [
      ...UP.matchAll(
        /alter table public\.(\w+)\s+add constraint (\w+) check \(char_length\((?:coalesce\((\w+), ''\)|(\w+))\) <= (\d+)\);/g,
      ),
    ].map((m) => ({ table: m[1], name: m[2], coalesced: m[3] !== undefined, column: m[3] ?? m[4], cap: Number(m[5]) }));

    expect(found).toHaveLength(APPROVED.length);
    for (const expected of APPROVED) {
      expect(found).toContainEqual({
        table: expected.table,
        name: expected.name,
        coalesced: expected.nullable,
        column: expected.column,
        cap: expected.cap,
      });
    }
    // 全檔所有 add constraint 都被上面的正規表示式涵蓋（沒有夾帶別種寫法的 constraint）。
    expect(UP.match(/add constraint/g)).toHaveLength(APPROVED.length);
  });

  it("可重複執行：每個 constraint 先 drop if exists 再建立", () => {
    for (const { table, name } of APPROVED) {
      const drop = `alter table public.${table} drop constraint if exists ${name};`;
      const add = `alter table public.${table}\n  add constraint ${name} check`;
      expect(UP, name).toContain(drop);
      expect(UP, name).toContain(add);
      expect(UP.indexOf(drop), name).toBeLessThan(UP.indexOf(add));
    }
  });

  it("只加上限：不使用 NOT VALID，不加下限或非空白條件，不碰 0006 既有的 description／phone CHECK", () => {
    expect(UP).not.toMatch(/not valid/i);
    expect(UP).not.toMatch(/char_length\([^)]*\)\)? *(>|>=|between)/i);
    expect(UP).not.toMatch(/store_settings_description_length|store_settings_phone_length/);
  });

  it("取鎖前先設 lock_timeout（0029 與 _down 都是），避免排在長交易後面卡住前台查詢", () => {
    for (const sql of [UP, DOWN]) {
      expect(sql).toContain("set local lock_timeout = '5s';");
      expect(sql.indexOf("set local lock_timeout")).toBeLessThan(sql.indexOf("alter table"));
    }
  });

  it("單一交易，且不改任何資料、policy、grant、觸發器或函式", () => {
    expect(UP.trimStart().startsWith("begin;")).toBe(true);
    expect(UP.trimEnd().endsWith("commit;")).toBe(true);
    expect(UP).not.toMatch(/\b(insert|update|delete)\b[^;]*\b(into|from|public\.)/i);
    expect(UP).not.toMatch(/create (or replace )?(function|trigger|policy)|grant |revoke |drop (function|trigger|policy)/i);
  });

  it("套用前的既有資料檢查與 CHECK 使用同一組上限，並在超過時中止", () => {
    const precheck = [...UP.matchAll(/select '(\w+\.\w+)'(?: as label)?, (\d+)(?: as cap)?, coalesce\(max\(char_length\((\w+)\)\), 0\)(?: as longest)? from public\.(\w+)/g)].map(
      (m) => ({ label: m[1], cap: Number(m[2]), column: m[3], table: m[4] }),
    );
    expect(precheck).toHaveLength(APPROVED.length);
    for (const expected of APPROVED) {
      expect(precheck).toContainEqual({
        label: `${expected.table}.${expected.column}`,
        cap: expected.cap,
        column: expected.column,
        table: expected.table,
      });
    }
    expect(UP).toContain("where longest > cap;");
    expect(UP).toContain("raise exception '0029 中止：既有資料超過新的長度上限");
    // 檢查在任何 add constraint 之前。
    expect(UP.indexOf("where longest > cap;")).toBeLessThan(UP.indexOf("add constraint"));
  });

  it("尾端自我檢查：六個 constraint 都存在、是 CHECK、已驗證", () => {
    for (const { table, name } of APPROVED) {
      expect(UP).toContain(`'public.${table}:${name}'`);
    }
    expect(UP).toContain("c.contype = 'c'");
    expect(UP).toContain("and c.convalidated");
    expect(UP).toContain("0029 自我檢查失敗");
    // 自我檢查在最後一個 add constraint 之後、commit 之前。
    expect(UP.lastIndexOf("add constraint")).toBeLessThan(UP.indexOf("0029 自我檢查失敗"));
    expect(UP.indexOf("0029 自我檢查失敗")).toBeLessThan(UP.lastIndexOf("commit;"));
  });
});

describe("前端驗證常數與 0029 一致（TASK-123）", () => {
  it("四個有前端輸入的欄位，常數等於 SQL 的上限", () => {
    const cap = (table: string, column: string) => APPROVED.find((a) => a.table === table && a.column === column)?.cap;
    expect(SERVICE_NAME_MAX_LENGTH).toBe(cap("services", "name"));
    expect(SERVICE_DESCRIPTION_MAX_LENGTH).toBe(cap("services", "description"));
    expect(STORE_NAME_MAX_LENGTH).toBe(cap("store_settings", "name"));
    expect(STORE_ADDRESS_MAX_LENGTH).toBe(cap("store_settings", "address"));
  });
});

describe("0029_down（TASK-123）", () => {
  it("移除六個 CHECK，且只移除這六個", () => {
    const dropped = [...DOWN.matchAll(/alter table public\.(\w+) drop constraint if exists (\w+);/g)].map((m) => `${m[1]}:${m[2]}`);
    expect(dropped.sort()).toEqual(APPROVED.map((a) => `${a.table}:${a.name}`).sort());
    expect(DOWN).not.toMatch(/drop constraint if exists store_settings_(description|phone)_length/);
  });

  it("尾端自我檢查：六個已移除，且 0006 的兩個既有 CHECK 仍在", () => {
    for (const { name } of APPROVED) expect(DOWN).toContain(`'${name}'`);
    expect(DOWN).toContain("'store_settings_description_length', 'store_settings_phone_length'");
    expect(DOWN).toContain("0029_down 自我檢查失敗");
    expect(DOWN.trimStart().startsWith("begin;")).toBe(true);
    expect(DOWN.trimEnd().endsWith("commit;")).toBe(true);
  });
});

describe("Demo 種子資料符合長度上限（TASK-123）", () => {
  // 每日還原把 seed-base.json 的 services／store_settings 寫回資料庫；超過上限會讓還原整個失敗。
  const seed = JSON.parse(readFileSync(path.join(ROOT, "lib", "demo", "seed-base.json"), "utf8")) as {
    services: { name: string; description: string | null }[];
    store_settings: Record<string, string | null>;
  };
  const length = (value: string | null | undefined) => Array.from(value ?? "").length;

  it("services.name／description", () => {
    expect(seed.services.length).toBeGreaterThan(0);
    for (const service of seed.services) {
      expect(length(service.name), service.name).toBeLessThanOrEqual(SERVICE_NAME_MAX_LENGTH);
      expect(length(service.description), service.name).toBeLessThanOrEqual(SERVICE_DESCRIPTION_MAX_LENGTH);
    }
  });

  it("store_settings 的 name／address／logo_url／cover_image_url", () => {
    for (const { column, cap } of APPROVED.filter((a) => a.table === "store_settings")) {
      expect(length(seed.store_settings[column]), column).toBeLessThanOrEqual(cap);
    }
  });
});
