// TASK-121：演練 0031／0031_down。只用記憶體內 Postgres（PGlite）與假表，與任何真實專案無關。
// 在專案外的空目錄執行 `npm init -y && npm i @electric-sql/pglite@0.2.17` 後 `node rehearse.mjs`。
// 路徑 M 指向本機的 supabase/migrations，換機器時請改。成功時最後一行是 ALL REHEARSAL CHECKS PASSED。
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const M = "C:/Users/User/Desktop/project/pro5/supabase/migrations/";
const read = (n) => readFileSync(M + n, "utf8").replace(/\r\n/g, "\n");
const UP = read("0031_demo_reminder_guard.sql");
const DOWN = read("0031_demo_reminder_guard_down.sql");
const M0027 = read("0027_demo_row_caps.sql");
const RESET_START = "create or replace function public.reset_demo_data(p_payload jsonb, p_dry_run boolean)";
const RESET_END = "grant execute on function public.reset_demo_data(jsonb, boolean) to service_role;";
const reset0027 = M0027.slice(M0027.indexOf(RESET_START), M0027.indexOf(RESET_END) + RESET_END.length);

let failed = 0;
const ok = (cond, label) => { console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); if (!cond) failed++; };
async function expectFail(db, sql, match, label) {
  try { await db.exec(sql); ok(false, `${label}（預期失敗但成功）`); }
  catch (e) { ok(match.test(String(e.message)), `${label} -> ${String(e.message).slice(0, 100)}`); }
  await db.exec("rollback").catch(() => {});
}

async function freshDb({ withReset = true, resetBody = reset0027 } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth;
    -- 與 Supabase 的 auth.jwt() 同形：讀 request.jwt.claims（或舊式 request.jwt.claim）轉 jsonb。
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claim', true), ''), nullif(current_setting('request.jwt.claims', true), ''))::jsonb
    $$;
    create table public.appointments (
      id uuid primary key default gen_random_uuid(), status text not null default 'confirmed',
      start_at timestamptz not null, end_at timestamptz not null, customer_email text,
      reminder_sent_at timestamptz, updated_at timestamptz not null default now());
    create function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
    create trigger appointments_set_updated_at before update on public.appointments for each row execute function public.set_updated_at();
    -- 與 0012 同樣的 WHEN 條件，驗證本觸發器只動 reminder_sent_at 時不會額外觸發它。
    create table public.webhook_log (n serial primary key);
    create function public.fake_notify() returns trigger language plpgsql as $$ begin insert into public.webhook_log default values; return new; end $$;
    create trigger appointments_notify_update after update on public.appointments for each row
      when (old.status is distinct from new.status or old.start_at is distinct from new.start_at or old.end_at is distinct from new.end_at)
      execute function public.fake_notify();
  `);
  if (withReset) await db.exec(resetBody);
  return db;
}

const setClaims = (db, claims) => db.query(`select set_config('request.jwt.claims', $1, false)`, [claims === null ? "" : claims]);
const demoClaims = JSON.stringify({ role: "authenticated", sub: "11111111-1111-1111-1111-111111111111", app_metadata: { is_demo: true }, user_metadata: {} });
const spoofClaims = JSON.stringify({ role: "authenticated", sub: "22222222-2222-2222-2222-222222222222", app_metadata: {}, user_metadata: { is_demo: true } });
const adminClaims = JSON.stringify({ role: "authenticated", sub: "33333333-3333-3333-3333-333333333333", app_metadata: {}, user_metadata: {} });
const serviceClaims = JSON.stringify({ role: "service_role" });

async function seed(db, reminder) {
  const r = await db.query(
    `insert into public.appointments (start_at, end_at, customer_email, reminder_sent_at)
     values (now() + interval '20 hours', now() + interval '21 hours', 'victim@example.com', $1) returning id`, [reminder]);
  return r.rows[0].id;
}
const reminder = async (db, id) => (await db.query(`select reminder_sent_at r from public.appointments where id = $1`, [id])).rows[0].r;
// 與 rescheduleAppointment 相同的 payload：改時間並把 reminder_sent_at 清成 null。
const reschedule = (db, id) => db.query(
  `update public.appointments set start_at = now() + interval '22 hours', end_at = now() + interval '23 hours', reminder_sent_at = null where id = $1`, [id]);

const OLD = "2026-10-01T00:00:00Z";

// ============ 1. 依賴檢查 ============
let db = await freshDb({ withReset: false });
await expectFail(db, UP, /0031 需要先套用 0024 與 0027（找不到 reset_demo_data）/, "沒有 reset_demo_data：0031 中止");
db = await freshDb({ resetBody: reset0027.replace(/'demo_row_cap_closed_dates'/g, "'x'") });
await expectFail(db, UP, /0031 需要先套用 0027/, "還原函式沒有 0027 白名單：0031 中止");
ok((await db.query(`select count(*)::int c from pg_trigger where tgname = 'demo_appointment_reminder'`)).rows[0].c === 0, "中止後沒有留下觸發器（整份回滾）");
ok((await db.query(`select to_regprocedure('public.demo_appointment_reminder_guard()') is null n`)).rows[0].n, "中止後沒有留下函式");
db = await freshDb();
await db.exec(`alter table public.appointments drop column reminder_sent_at`);
await expectFail(db, UP, /0031 需要 appointments\.reminder_sent_at/, "沒有 reminder_sent_at 欄位：0031 中止");

// ============ 2. 套用 ============
db = await freshDb();
const md5Before = (await db.query(`select md5(prosrc) m from pg_proc where oid = 'public.reset_demo_data(jsonb,boolean)'::regprocedure`)).rows[0].m;
// 負向對照：套用前，白名單不含新觸發器（這就是「不補白名單、還原會失敗」的原因）。
ok(!(await db.query(`select prosrc from pg_proc where oid = 'public.reset_demo_data(jsonb,boolean)'::regprocedure`)).rows[0].prosrc.includes("demo_appointment_reminder"), "套用前：還原函式白名單不含 demo_appointment_reminder");
await db.exec(UP); ok(true, "0031 套用成功（含尾端自我檢查）");
await db.exec(UP); ok(true, "0031 重複套用成功（idempotent）");
const trg = await db.query(`select pg_get_triggerdef(oid) d, tgenabled e from pg_trigger where tgname = 'demo_appointment_reminder' and not tgisinternal`);
ok(trg.rows.length === 1 && trg.rows[0].e === "O", "恰好 1 個觸發器、已啟用");
ok(/BEFORE UPDATE ON public\.appointments FOR EACH ROW EXECUTE FUNCTION (public\.)?demo_appointment_reminder_guard\(\)/.test(trg.rows[0].d) && !/WHEN/.test(trg.rows[0].d), `觸發器定義：${trg.rows[0].d}`);
const src1 = (await db.query(`select prosrc from pg_proc where oid = 'public.reset_demo_data(jsonb,boolean)'::regprocedure`)).rows[0].prosrc;
ok(src1.includes("'demo_appointment_reminder'") && src1.includes("'demo_row_cap_closed_dates'"), "套用後：白名單同時含新觸發器與 0027 的觸發器");
ok((await db.query(`select has_function_privilege('service_role','public.reset_demo_data(jsonb,boolean)','execute') s, has_function_privilege('anon','public.reset_demo_data(jsonb,boolean)','execute') a, has_function_privilege('authenticated','public.demo_appointment_reminder_guard()','execute') g`)).rows[0].s === true, "還原函式只有 service_role 能執行；觸發器函式無人能執行");
// 白名單涵蓋：appointments 上每個非內部觸發器名稱都在還原函式的白名單文字內（其中 appointments_* 為假表上的測試觸發器，白名單另有真實版本）。
const names = (await db.query(`select tgname from pg_trigger where tgrelid = 'public.appointments'::regclass and not tgisinternal order by 1`)).rows.map((r) => r.tgname);
ok(names.includes("demo_appointment_reminder") && src1.includes(`'${names.find((n) => n === "demo_appointment_reminder")}'`), `appointments 上的觸發器：${names.join(", ")}`);

// ============ 3. 行為 ============
let id;
// 3.1 沒有 JWT（SQL Editor／psql）
await setClaims(db, null);
id = await seed(db, OLD); await reschedule(db, id);
ok((await reminder(db, id)) === null, "沒有 JWT：改期照常把 reminder_sent_at 清成 null（行為不變）");
// 3.2 一般管理員
await setClaims(db, adminClaims);
id = await seed(db, OLD); await reschedule(db, id);
ok((await reminder(db, id)) === null, "一般管理員改期：reminder_sent_at 清成 null（行為不變）");
// 3.3 service role（cron claim／release）
await setClaims(db, serviceClaims);
id = await seed(db, null);
await db.query(`update public.appointments set reminder_sent_at = now() where id = $1 and reminder_sent_at is null`, [id]);
ok((await reminder(db, id)) !== null, "service role：claim 設為非 null（行為不變）");
await db.query(`update public.appointments set reminder_sent_at = null where id = $1`, [id]);
ok((await reminder(db, id)) === null, "service role：release 清回 null（行為不變）");
// 3.4 偽裝：user_metadata.is_demo 不算 Demo
await setClaims(db, spoofClaims);
id = await seed(db, OLD); await reschedule(db, id);
ok((await reminder(db, id)) === null, "user_metadata.is_demo 偽裝：不被當成 Demo，改期照常清成 null");
// app_metadata.is_demo = false
await setClaims(db, JSON.stringify({ role: "authenticated", app_metadata: { is_demo: false } }));
id = await seed(db, OLD); await reschedule(db, id);
ok((await reminder(db, id)) === null, "app_metadata.is_demo = false：不被當成 Demo");
// 3.5 Demo
await setClaims(db, demoClaims);
id = await seed(db, OLD); await reschedule(db, id);
ok(new Date(await reminder(db, id)).toISOString() === "2026-10-01T00:00:00.000Z", "Demo 改期（原本已提醒）：reminder_sent_at 維持原值，不被清成 null");
id = await seed(db, null); await reschedule(db, id);
ok((await reminder(db, id)) !== null, "Demo 改期（原本沒提醒過，Email 為受害者）：reminder_sent_at 被標成已提醒（非 null）");
id = await seed(db, null);
await db.query(`update public.appointments set status = 'cancelled' where id = $1`, [id]);
ok((await reminder(db, id)) !== null, "Demo 只改狀態：同樣被標成已提醒（已接受的副作用）");
id = await seed(db, OLD);
await db.query(`update public.appointments set reminder_sent_at = null where id = $1`, [id]);
ok((await reminder(db, id)) !== null, "Demo 直接把 reminder_sent_at 設成 null：無效");
// 提醒排程的 claim 條件（與 claimAppointmentsForReminder 相同的謂詞）撈不到 Demo 動過的預約
await setClaims(db, serviceClaims);
const claimable = async (rid) => (await db.query(
  `select id from public.appointments where id = $1 and start_at >= now() and start_at < now() + interval '26 hours' and status in ('pending','confirmed') and reminder_sent_at is null`, [rid])).rows.length;
await setClaims(db, demoClaims);
id = await seed(db, null); await reschedule(db, id);
await setClaims(db, serviceClaims);
ok((await claimable(id)) === 0, "Demo 改期後，提醒排程的 claim 謂詞撈不到這筆預約");
await setClaims(db, adminClaims);
id = await seed(db, null); await reschedule(db, id);
await setClaims(db, serviceClaims);
ok((await claimable(id)) === 1, "對照：一般管理員改期後，提醒排程撈得到（提醒功能不受影響）");
// 3.6 INSERT 不受影響
await setClaims(db, demoClaims);
id = await seed(db, null);
ok((await reminder(db, id)) === null, "Demo 的 INSERT 不受影響（觸發器只掛 UPDATE）");
// 3.7 不額外觸發 webhook：只動 reminder_sent_at 不算 start/end/status 異動
await setClaims(db, demoClaims);
const w0 = (await db.query(`select count(*)::int c from public.webhook_log`)).rows[0].c;
await db.query(`update public.appointments set customer_email = customer_email where id = $1`, [id]);
ok((await db.query(`select count(*)::int c from public.webhook_log`)).rows[0].c === w0 && (await reminder(db, id)) !== null, "觸發器改 reminder_sent_at 不會讓 UPDATE webhook 觸發");
// 3.8 失敗方向：疑似 Demo 但 claims 無法解析 → 不讓更新失敗，也不放過
await db.query(`select set_config('request.jwt.claims', 'garbage is_demo', false)`);
id = await seed(db, OLD);
let threw = false;
try { await reschedule(db, id); } catch { threw = true; }
ok(!threw && new Date(await reminder(db, id)).toISOString() === "2026-10-01T00:00:00.000Z", "claims 含 is_demo 但無法解析：更新不失敗，且視為 Demo（維持原值）");
// 沒有 is_demo 字樣的壞 claims 不會被本觸發器解析（預篩放行；這個壞掉的 claims 會在別處失敗，與本觸發器無關）
await db.query(`select set_config('request.jwt.claims', 'garbage', false)`);
id = await seed(db, OLD); await reschedule(db, id);
ok((await reminder(db, id)) === null, "claims 沒有 is_demo 字樣：預篩放行，不解析 JSON");
// 舊式 request.jwt.claim（預篩的另一個來源）
await db.query(`select set_config('request.jwt.claims', '', false)`);
await db.query(`select set_config('request.jwt.claim', $1, false)`, [demoClaims]);
id = await seed(db, OLD); await reschedule(db, id);
ok(new Date(await reminder(db, id)).toISOString() === "2026-10-01T00:00:00.000Z", "舊式 request.jwt.claim 帶 Demo claim：同樣生效");
await db.query(`select set_config('request.jwt.claim', '', false)`);

// ============ 4. 回滾 ============
await setClaims(db, null);
await db.exec(DOWN); ok(true, "0031_down 成功（含自我檢查）");
await db.exec(DOWN); ok(true, "0031_down 重複執行成功");
ok((await db.query(`select count(*)::int c from pg_trigger where tgname = 'demo_appointment_reminder'`)).rows[0].c === 0, "回滾後觸發器已移除");
ok((await db.query(`select to_regprocedure('public.demo_appointment_reminder_guard()') is null n`)).rows[0].n, "回滾後函式已移除");
const md5After = (await db.query(`select md5(prosrc) m from pg_proc where oid = 'public.reset_demo_data(jsonb,boolean)'::regprocedure`)).rows[0].m;
ok(md5After === md5Before, `回滾後 reset_demo_data 本文指紋與套用前一致（${md5Before}）`);
await setClaims(db, demoClaims);
id = await seed(db, OLD); await reschedule(db, id);
ok((await reminder(db, id)) === null, "回滾後：Demo 改期又會把 reminder_sent_at 清成 null（缺口重新打開，基準線）");
await setClaims(db, null);
await db.exec(UP); ok(true, "回滾後重新套用成功");
ok((await db.query(`select prosrc like '%''demo_appointment_reminder''%' h from pg_proc where oid = 'public.reset_demo_data(jsonb,boolean)'::regprocedure`)).rows[0].h, "重新套用後白名單含新觸發器");
await setClaims(db, demoClaims);
id = await seed(db, OLD); await reschedule(db, id);
ok(new Date(await reminder(db, id)).toISOString() === "2026-10-01T00:00:00.000Z", "重新套用後守門再次生效");

console.log(failed === 0 ? "\nALL REHEARSAL CHECKS PASSED" : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
