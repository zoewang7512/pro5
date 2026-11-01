// TASK-123：演練 0029／0029_down。只用記憶體內 Postgres（PGlite）與假表，與任何真實專案無關。
// PGlite 不是專案依賴：在專案外的空目錄執行 `npm init -y && npm i @electric-sql/pglite@0.2.17`，把本檔複製進去後 `node rehearse.mjs`。
// 路徑 M 指向本機的 supabase/migrations，換機器時請改。成功時最後一行是 ALL REHEARSAL CHECKS PASSED。
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const M = "C:/Users/User/Desktop/project/pro5/supabase/migrations/";
const UP = readFileSync(M + "0029_text_length_checks.sql", "utf8");
const DOWN = readFileSync(M + "0029_text_length_checks_down.sql", "utf8");

let failed = 0;
const ok = (cond, label) => { console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); if (!cond) failed++; };
async function throws(db, sql, params, match, label) {
  try { await db.query(sql, params); ok(false, `${label}（預期失敗但成功）`); }
  catch (e) { ok(match.test(String(e.message)), `${label} -> ${String(e.message).slice(0, 90)}`); }
}

async function freshDb() {
  const db = new PGlite();
  // 與 0001／0003／0006 相同形狀的假表（只含本卡相關欄位與既有 CHECK）。
  await db.exec(`
    create table public.services (
      id uuid primary key default gen_random_uuid(), name text not null, description text,
      price numeric(10,2) not null check (price >= 0), duration_minutes int not null check (duration_minutes > 0),
      is_active boolean not null default true, sort_order int not null default 0, created_at timestamptz not null default now());
    create table public.store_settings (
      id int primary key default 1, name text not null default '', address text, phone text, description text,
      logo_url text, cover_image_url text, updated_at timestamptz not null default now());
    alter table public.store_settings add constraint store_settings_description_length check (char_length(coalesce(description, '')) <= 500);
    alter table public.store_settings add constraint store_settings_phone_length check (char_length(coalesce(phone, '')) <= 20);
    insert into public.store_settings (id, name, address, logo_url, cover_image_url) values (1, '普洛午理髮廳', '台北市', 'https://x/' || repeat('a', 114), 'https://x/' || repeat('b', 115));
    insert into public.services (name, description, price, duration_minutes) values ('剪髮', '78 字內', 600, 60), ('燙髮', null, 1500, 120);
  `);
  return db;
}

// --- 1. 正常套用、重複套用 ---
let db = await freshDb();
await db.exec(UP); ok(true, "0029 套用成功（含尾端自我檢查）");
await db.exec(UP); ok(true, "0029 重複套用成功（idempotent）");
const cons = await db.query(`select conname, convalidated from pg_constraint where conname like '%\\_length' order by 1`);
ok(cons.rows.length === 8 && cons.rows.every((r) => r.convalidated), `8 個 *_length（6 新 + 0006 的 2 個）皆已驗證：${cons.rows.map((r) => r.conname).join(",")}`);

// --- 2. 邊界 ---
const ins = (n, d) => db.query(`insert into public.services (name, description, price, duration_minutes) values ($1,$2,0,30)`, [n, d]);
await ins("a".repeat(60), null); ok(true, "services.name 60 成功");
await throws(db, `insert into public.services (name, price, duration_minutes) values ($1,0,30)`, ["a".repeat(61)], /services_name_length/, "services.name 61 被拒");
await ins("剪".repeat(60), null); ok(true, "services.name 60 個全形字成功（字元不是位元組）");
await ins("😀".repeat(60), null); ok(true, "services.name 60 個表情符號成功（碼點不是 UTF-16 單位）");
await throws(db, `insert into public.services (name, price, duration_minutes) values ($1,0,30)`, ["😀".repeat(61)], /services_name_length/, "services.name 61 個表情符號被拒");
await ins("ok", "字".repeat(500)); ok(true, "services.description 500 成功");
await ins("ok2", ""); await ins("ok3", null); ok(true, "description 空字串與 null 成功");
await throws(db, `insert into public.services (name, description, price, duration_minutes) values ('x', $1, 0, 30)`, ["字".repeat(501)], /services_description_length/, "services.description 501 被拒");
await throws(db, `update public.services set name = $1 where name = '剪髮'`, ["a".repeat(61)], /services_name_length/, "update 超長 name 被拒");
ok((await db.query(`select count(*)::int c from public.services where name = '剪髮'`)).rows[0].c === 1, "被拒的 update 後原值仍在");
for (const [col, cap, con] of [["name", 200, "store_settings_name_length"], ["address", 200, "store_settings_address_length"], ["logo_url", 2048, "store_settings_logo_url_length"], ["cover_image_url", 2048, "store_settings_cover_image_url_length"]]) {
  await db.query(`update public.store_settings set ${col} = $1 where id = 1`, ["z".repeat(cap)]); ok(true, `store_settings.${col} ${cap} 成功`);
  await throws(db, `update public.store_settings set ${col} = $1 where id = 1`, ["z".repeat(cap + 1)], new RegExp(con), `store_settings.${col} ${cap + 1} 被拒`);
}
await db.query(`update public.store_settings set address = null, logo_url = null, cover_image_url = null, name = '' where id = 1`); ok(true, "null 與 name 空字串成功");
await throws(db, `update public.store_settings set description = $1 where id = 1`, ["d".repeat(501)], /store_settings_description_length/, "0006 既有 description 仍有效");

// --- 3. 回滾 ---
await db.exec(DOWN); ok(true, "0029_down 成功（含自我檢查）");
await db.exec(DOWN); ok(true, "0029_down 重複執行成功");
await ins("a".repeat(61), null); ok(true, "回滾後 services.name 61 可寫入");
await db.query(`update public.store_settings set name = $1 where id = 1`, ["z".repeat(201)]); ok(true, "回滾後 store_settings.name 201 可寫入");
await throws(db, `update public.store_settings set phone = $1 where id = 1`, ["1".repeat(21)], /store_settings_phone_length/, "回滾後 0006 的 phone CHECK 仍在");

// --- 4. 套用前既有資料超過上限：以明確訊息中止，且不留下半套 ---
try{await db.exec(UP);ok(false,"超限時應中止")}catch(e){const m=String(e.message);ok(/0029 中止：既有資料超過新的長度上限.*services.name（上限 60，目前最長 61）.*store_settings.name（上限 200，目前最長 201）/s.test(m),"既有資料超限時 0029 中止並指名欄位 -> "+m.slice(0,160))}
//：既有資料超過新的長度上限.*services\.name（上限 60，目前最長 61）.*store_settings\.name（上限 200，目前最長 201）/s, "既有資料超限時 0029 中止並指名欄位");
await db.exec("rollback").catch(() => {});
const left = await db.query(`select count(*)::int c from pg_constraint where conname in ('services_name_length','store_settings_name_length')`);
ok(left.rows[0].c === 0, "中止後沒有留下任何新 constraint（整份回滾）");

// --- 5. 清掉超限資料後可重新套用 ---
await db.query(`delete from public.services where char_length(name) > 60`);
await db.query(`update public.store_settings set name = 'ok' where id = 1`);
await db.exec(UP); ok(true, "資料修正後重新套用成功");

console.log(failed === 0 ? "\nALL REHEARSAL CHECKS PASSED" : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
