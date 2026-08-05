-- 回滾 0001_core_schema.sql
-- `drop table ... cascade` 會一併清掉附掛在表上的 policy／trigger／index，
-- 不需要（也不能安全地）在表可能已不存在時個別 drop policy/trigger。
-- 警告：DROP TABLE 會刪除資料，僅在專案還沒有真實預約/顧客資料時安全執行。

begin;

drop table if exists public.appointments cascade;
drop table if exists public.customers cascade;
drop table if exists public.services cascade;

drop function if exists public.set_updated_at();
drop function if exists public.is_admin();
drop table if exists public.admins cascade;

commit;
