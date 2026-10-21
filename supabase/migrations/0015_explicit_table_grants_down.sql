-- 回滾 0015_explicit_table_grants.sql
-- 還原成 0015 套用前、2026-10-21 於正式環境查得的實際授權：anon／authenticated／
-- service_role 對 8 張表都有全部權限，例外只有 anon 對 appointments 沒有 insert（0001／
-- 0002 撤銷），以及 anon／authenticated 對 booking_policy／business_hours 沒有 truncate
-- （0008／0014 撤銷）。
--
-- **只適用於 2026-10-21 查得基準的這個既有 Supabase 專案**。不得在 2026-10-30 之後用
-- migration 新建的環境執行：那種環境套用 0015 前本來就是零授權，執行本檔案反而會開出比
-- 原本寬得多的權限（包括 anon 對 customers／admins 的全部權限）。
--
-- **優先修正、最後才回滾**：如果套用 0015 後只是某一條路徑壞掉（API 回 42501），先只補
-- 那一個缺少的權限（例如 `grant select on public.X to authenticated;`），並把它補進新的
-- migration；整份回滾會恢復「權限層全開、只剩 RLS 一道邊界」的狀態，屬有意識接受的風險，
-- 只在需要先止血時使用。回滾後要重跑 npm run test:rls 與 npm run test:booking。
--
-- 已知限制：在 Postgres 17 上 grant all 也會授予 MAINTAIN，而套用前的基準查詢
-- （information_schema.role_table_grants）看不到 MAINTAIN，這部分無法確認與套用前一致；
-- 精確比對請用套用前存下的 pg_class.relacl。
-- 可重複執行（idempotent）。

begin;

-- grant all 會一併授予所有欄位，0015 的欄位層級授權被涵蓋在內，不需要另外 revoke。
grant all on public.services, public.business_hours, public.store_settings,
  public.booking_policy, public.closed_dates, public.appointments, public.customers,
  public.admins
  to anon, authenticated, service_role;

-- 還原 0001／0002 對 anon insert on appointments 的撤銷（appointments 唯一寫入路徑是
-- create_appointment RPC，見 ai/context/decisions.md TASK-010）。
revoke insert on public.appointments from anon;

-- 還原 0008／0014 對 truncate 的撤銷。
revoke truncate on public.booking_policy from anon, authenticated;
revoke truncate on public.business_hours from anon, authenticated;

commit;
