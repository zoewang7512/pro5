import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const M = "C:/Users/User/Desktop/project/pro5/supabase/migrations/";
const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const verify = read("C:/Users/User/Desktop/project/pro5/ai/artifacts/Demo 體驗帳戶/verification/TASK-121-verify.sql");
const M0027 = read(M + "0027_demo_row_caps.sql");
const S = "create or replace function public.reset_demo_data(p_payload jsonb, p_dry_run boolean)";
const E = "grant execute on function public.reset_demo_data(jsonb, boolean) to service_role;";
const reset0027 = M0027.slice(M0027.indexOf(S), M0027.indexOf(E) + E.length);
const db = new PGlite();
await db.exec(`
 create role anon nologin; create role authenticated nologin; create role service_role nologin; create schema auth;
 create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim', true), ''), nullif(current_setting('request.jwt.claims', true), ''))::jsonb $$;
 create table public.appointments (id uuid primary key default gen_random_uuid(), status text not null default 'confirmed', start_at timestamptz not null, end_at timestamptz not null, customer_name text not null default 'x', customer_email text, reminder_sent_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
 insert into public.appointments (start_at, end_at) values (now() + interval '20 hours', now() + interval '21 hours');
`);
await db.exec(reset0027);
async function run(label) {
  try { await db.exec(verify); console.log(label, "NO EXCEPTION (bad)"); }
  catch (e) { console.log(label, String(e.message)); }
  await db.exec("rollback").catch(() => {});
}
await run("[套用前]");
await db.exec(read(M + "0031_demo_reminder_guard.sql"));
await run("[套用後]");
const left = await db.query("select reminder_sent_at from public.appointments");
console.log("rollback 後預約仍未被改動：", left.rows[0].reminder_sent_at === null);
