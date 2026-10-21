-- TASK-066 步驟 2：試跑（套用後立刻回滾，資料庫不會被改變）
-- 由 Claude Code 依 supabase/migrations/0015_explicit_table_grants.sql 產生，請整份複製貼到
-- Supabase SQL Editor 執行。
-- 這段會在同一個交易裡套用 0015、比對權限、模擬非管理員與 anon 存取，最後「故意」拋出
-- 一個錯誤，讓整個交易回滾。所以執行後 SQL Editor 一定會顯示紅色錯誤訊息，這是正常的。
-- 請把錯誤訊息整段複製貼回給 Claude Code。預期內容：
--   權限不一致 0 筆；非管理員可見 appointments 0 筆；非管理員可更新 appointments 0 筆；
--   anon 可見 services 的筆數 > 0（等於目前上架中的服務數）。
-- 如果錯誤訊息不是以「DRY RUN」開頭，代表 0015 本身執行失敗，同樣已全部回滾。

do $dry_run$
declare
  v_mismatch text;
  v_mismatch_count int;
  v_nonadmin_visible int;
  v_nonadmin_updated int;
  v_anon_services int;
begin
  -- ===== 0015_explicit_table_grants.sql 的內容（去掉 begin／commit）=====
  -- services：顧客前台讀服務列表（RLS 只放行 is_active = true），後台新增／編輯／上下架。
  revoke all on public.services from anon, authenticated, service_role;
  grant select on public.services to anon;
  grant select, insert, update on public.services to authenticated;
  grant select, insert, update, delete on public.services to service_role;

  -- business_hours：顧客前台讀營業時間，後台以 upsert（onConflict: weekday）儲存。
  revoke all on public.business_hours from anon, authenticated, service_role;
  grant select on public.business_hours to anon;
  grant select, insert, update on public.business_hours to authenticated;
  grant select, insert, update, delete on public.business_hours to service_role;

  -- store_settings：單例表（id = 1，由 0006 seed 建立），顧客前台讀品牌資訊，後台只更新
  -- 既有那一列。
  revoke all on public.store_settings from anon, authenticated, service_role;
  grant select on public.store_settings to anon;
  grant select, update on public.store_settings to authenticated;
  grant select, insert, update, delete on public.store_settings to service_role;

  -- booking_policy：單例表（id = 1，由 0008 seed 建立），顧客前台讀政策說明，後台只更新
  -- 既有那一列。
  revoke all on public.booking_policy from anon, authenticated, service_role;
  grant select on public.booking_policy to anon;
  grant select, update on public.booking_policy to authenticated;
  grant select, insert, update, delete on public.booking_policy to service_role;

  -- closed_dates：只有後台直接存取（新增用 upsert，onConflict: date；移除用 delete）。
  revoke all on public.closed_dates from anon, authenticated, service_role;
  grant select, insert, update, delete on public.closed_dates to authenticated;
  grant select, insert, update, delete on public.closed_dates to service_role;

  -- appointments：顧客端一律走 create_appointment RPC；後台讀列表、標記完成／取消／改期。
  -- 日後新增欄位時，若後台需要讀寫，要在新的 migration 補上對應的欄位層級授權。
  revoke all on public.appointments from anon, authenticated, service_role;
  grant select (
    id, service_id, customer_id, customer_name, customer_phone, customer_email,
    start_at, end_at, status, created_at, updated_at, confirmation_sent_at, reminder_sent_at
  ) on public.appointments to authenticated;
  grant update (status, start_at, end_at, reminder_sent_at) on public.appointments to authenticated;
  grant select, insert, update, delete on public.appointments to service_role;

  -- customers：目前只有 create_appointment（SECURITY DEFINER）與 service_role 會存取。
  revoke all on public.customers from anon, authenticated, service_role;
  grant select, insert, update, delete on public.customers to service_role;

  -- admins：只透過 SECURITY DEFINER function 存取，比照 TASK-003「RLS 啟用、零 policy」的
  -- 鎖死設計，權限層也一併收死。
  revoke all on public.admins from anon, authenticated, service_role;
  grant select, insert, update, delete on public.admins to service_role;
  -- ===== 0015 結束 =====

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
  select count(*), coalesce(string_agg(detail, '; '), '無')
    into v_mismatch_count, v_mismatch
  from all_mismatch;

  -- 模擬一個不在 admins 表的登入帳號（非管理員 authenticated）。
  perform set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}',
    true
  );
  set local role authenticated;
  select count(id) into v_nonadmin_visible from public.appointments;
  update public.appointments set status = status;
  get diagnostics v_nonadmin_updated = row_count;
  reset role;

  -- 模擬顧客前台（anon）。
  set local role anon;
  select count(id) into v_anon_services from public.services;
  reset role;

  raise exception
    'DRY RUN（已全部回滾，資料庫未變更）｜權限不一致 % 筆：%｜非管理員可見 appointments % 筆｜非管理員可更新 appointments % 筆｜anon 可見 services % 筆',
    v_mismatch_count, v_mismatch, v_nonadmin_visible, v_nonadmin_updated, v_anon_services;
end
$dry_run$;
