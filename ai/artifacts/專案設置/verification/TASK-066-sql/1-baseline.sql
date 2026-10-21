-- TASK-066 步驟 1：套用前基準（唯讀，不會改任何東西）
-- 由 Claude Code 依 supabase/migrations/0015_explicit_table_grants.sql 產生，請整份複製貼到
-- Supabase SQL Editor 執行。
-- 結果是兩列 JSON：policies（public schema 的 RLS policy）與 tables（各表 RLS 開關與
-- 原始授權 relacl）。請把兩列都複製貼回給 Claude Code，作為套用前的基準證據。

select 'policies' as kind, json_agg(p order by p.tablename, p.policyname) as data
from (
  select tablename, policyname, cmd, roles, permissive, qual, with_check
  from pg_policies
  where schemaname = 'public'
) p
union all
select 'tables', json_agg(t order by t.relname)
from (
  select relname, relrowsecurity, relforcerowsecurity, relacl::text
  from pg_class
  where relnamespace = 'public'::regnamespace and relkind = 'r'
) t;
