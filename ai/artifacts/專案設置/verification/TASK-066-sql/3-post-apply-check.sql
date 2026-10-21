-- TASK-066 步驟 4：正式套用後的檢查（唯讀）
-- 由 Claude Code 依 supabase/migrations/0015_explicit_table_grants.sql 產生，請整份複製貼到
-- Supabase SQL Editor 執行。
-- 用 has_table_privilege／has_column_privilege 比對實際生效的權限（PUBLIC 與角色繼承都會
-- 算進去）和權限表。預期只有一列：「全部一致」。請把結果貼回給 Claude Code。

with expected_table(tbl, role_name, privs) as (
  values
    ('services', 'anon', 'SELECT'),
    ('services', 'authenticated', 'SELECT,INSERT,UPDATE'),
    ('services', 'service_role', 'SELECT,INSERT,UPDATE,DELETE'),
    ('business_hours', 'anon', 'SELECT'),
    ('business_hours', 'authenticated', 'SELECT,INSERT,UPDATE'),
    ('business_hours', 'service_role', 'SELECT,INSERT,UPDATE,DELETE'),
    ('store_settings', 'anon', 'SELECT'),
    ('store_settings', 'authenticated', 'SELECT,UPDATE'),
    ('store_settings', 'service_role', 'SELECT,INSERT,UPDATE,DELETE'),
    ('booking_policy', 'anon', 'SELECT'),
    ('booking_policy', 'authenticated', 'SELECT,UPDATE'),
    ('booking_policy', 'service_role', 'SELECT,INSERT,UPDATE,DELETE'),
    ('closed_dates', 'anon', ''),
    ('closed_dates', 'authenticated', 'SELECT,INSERT,UPDATE,DELETE'),
    ('closed_dates', 'service_role', 'SELECT,INSERT,UPDATE,DELETE'),
    ('appointments', 'anon', ''),
    ('appointments', 'authenticated', ''),
    ('appointments', 'service_role', 'SELECT,INSERT,UPDATE,DELETE'),
    ('customers', 'anon', ''),
    ('customers', 'authenticated', ''),
    ('customers', 'service_role', 'SELECT,INSERT,UPDATE,DELETE'),
    ('admins', 'anon', ''),
    ('admins', 'authenticated', ''),
    ('admins', 'service_role', 'SELECT,INSERT,UPDATE,DELETE')
),
privs(priv) as (
  values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
),
table_mismatch as (
  select e.tbl || '/' || e.role_name || '/' || p.priv
    || ' 預期=' || (p.priv = any(string_to_array(e.privs, ',')))::text
    || ' 實際=' || has_table_privilege(e.role_name, 'public.' || e.tbl, p.priv)::text as detail
  from expected_table e cross join privs p
  where has_table_privilege(e.role_name, 'public.' || e.tbl, p.priv)
    is distinct from (p.priv = any(string_to_array(e.privs, ',')))
),
expected_column(role_name, col, priv, expected) as (
  values
    ('authenticated', 'access_token', 'SELECT', false),
    ('authenticated', 'customer_name', 'SELECT', true),
    ('authenticated', 'customer_phone', 'SELECT', true),
    ('authenticated', 'service_id', 'SELECT', true),
    ('authenticated', 'status', 'UPDATE', true),
    ('authenticated', 'start_at', 'UPDATE', true),
    ('authenticated', 'end_at', 'UPDATE', true),
    ('authenticated', 'reminder_sent_at', 'UPDATE', true),
    ('authenticated', 'customer_id', 'UPDATE', false),
    ('authenticated', 'customer_name', 'UPDATE', false),
    ('authenticated', 'access_token', 'UPDATE', false),
    ('anon', 'customer_name', 'SELECT', false)
),
column_mismatch as (
  select 'appointments.' || col || '/' || role_name || '/' || priv
    || ' 預期=' || expected::text
    || ' 實際=' || has_column_privilege(role_name, 'public.appointments', col, priv)::text as detail
  from expected_column
  where has_column_privilege(role_name, 'public.appointments', col, priv) is distinct from expected
),
all_mismatch as (
  select detail from table_mismatch
  union all
  select detail from column_mismatch
)
select case when count(*) = 0 then '全部一致'
            else '不一致 ' || count(*) || ' 筆：' || string_agg(detail, '; ') end as result
from all_mismatch;
