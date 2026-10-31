-- TASK-108（Demo 體驗帳戶：還原函式）
-- 新增只有 service_role 能執行的函式（另有一張單列「重置閘門」資料表，見下方第 3 點）：
--   1. reset_demo_data(p_payload jsonb, p_dry_run boolean) returns jsonb
--      在**單一交易**內把業務資料表整批覆寫成 seed payload（形狀見 lib/demo/seed-types.ts 的 DemoSeedPayload，
--      由 lib/demo/seed-data.ts 的 buildDemoSeed 產生）。任何一步失敗，整個交易回滾，不留下半套。
--      p_dry_run = true：完整執行後以自訂 SQLSTATE 'RD001' 回滾內層子交易，只回傳各表會寫入／刪除的筆數。
--   3. 重置閘門（demo_reset_gate 資料表 + demo_reset_open_gate／demo_reset_close_gate／demo_reset_gate_is_open）
--      真實還原（p_dry_run = false）需要閘門開著：平常是關的；還原端點（TASK-110）在呼叫前先 open（1～30 分鐘），
--      reset_demo_data 真實還原成功時在同一個交易內把閘門關掉（單次通行證）；失敗時閘門保持原狀，
--      由呼叫端在 finally 呼叫 demo_reset_close_gate()，最差也只開到期限為止。dry-run 不需要閘門。
--      擋的是「程式有 bug、測試或腳本誤呼叫 p_dry_run = false」；**擋不住持有 service role key 的人**
--      （open 函式同樣只有 service_role 能呼叫）。
--   2. demo_list_storage_objects(p_bucket text)
--      唯讀：列出白名單 bucket 內所有物件的名稱、大小、eTag、建立時間、擁有者（含子目錄，不必逐層 list()）。
--
-- ★★ 危險函式：真實執行（p_dry_run = false）會**清空並覆寫**下列全部資料表。
--    絕不可由「排程還原（TASK-110）」或「人工明確確認後的手動還原」以外的任何程式、測試、腳本呼叫。
--    整合測試只准傳 p_dry_run = true（TASK-108 有掃描測試把關）。真實還原前必須先備份（TASK-117）。
--
-- 覆寫範圍（D8）：
--   整表覆寫：services、designers（連帶 cascade 的 designer_services／designer_leaves／designer_portfolio_images）、
--             business_hours、closed_dates、booking_policy、store_settings、appointments、customers。
--   audit_log：只刪 actor_id = Demo 帳戶的列。
--   admins：只更新 Demo 那一列的 display_name、avatar_url。
--   不碰 auth schema（MFA factor 由 TS 端 admin API 刪、session 由 demo_revoke_sessions() 撤銷，見 0021）；
--   不碰 designer001 的任何資料。
--
-- 安全邊界：
--   * SECURITY DEFINER、search_path 為空、revoke execute from public／anon／authenticated／service_role 之後只 grant 給 service_role。
--   * p_dry_run 沒有預設值：呼叫端必須明確傳入；傳 null 也會被拒絕。
--   * 守門：confirm = 'RESET_DEMO'；所有必要鍵存在且型別正確；各必要陣列有最低筆數（含作品集至少 1 筆；避免程式 bug 送空陣列清空整張表）；
--     business_hours 剛好 7 列且 weekday 不重複。
--   * Demo 使用者由函式自己決定（查 app_metadata.is_demo 的帳戶，筆數不是剛好 1 就 raise）；payload 的 demo_user_id
--     必填，只作交叉檢查（必須與查到的相同），不信任。
--   * 還原不寄信：payload 預約與顧客的 email 必須全為 null、預約不得帶 access_token（讓資料庫預設值產生），否則 raise。
--     寄信觸發器的 WHEN 條件是 customer_email is not null，所以不會觸發；刪除不觸發任何通知。
--   * pg_try_advisory_xact_lock：同時只允許一個還原；搶不到鎖直接失敗（不排隊）。
--     set local lock_timeout = '5s' 後以一條語句 lock table 全部被覆寫的表 in exclusive mode（擋寫入、不擋讀取）。
--   * 被覆寫的表上若有不認得的觸發器（例如 Dashboard 手動建的 Database Webhook）就拒絕執行：dry-run 看不到它們寫進 pg_net
--     的請求，真實還原卻會對每一列各打一次。新增觸發器時要同步更新函式內的白名單。
--   * demo_user_id 必填；Demo 帳戶必須已登記在 admins；portfolio_images 至少 1 筆。
--   * 非 dry-run 時，RD001 不會被當成 dry-run 吞掉（會往外丟）。
--   * payload 只經 jsonb_to_recordset／參數化使用，沒有任何字串拼接 SQL。
--   * DELETE 一律寫 where true：相容 pg-safeupdate（拒絕沒有 WHERE 的 DELETE）。
--
-- 回傳：{ counts: { <表>: 寫入筆數 }, deleted: { <表>: 刪除筆數，含 audit_log（只計 Demo 的）與 cascade 的子表 }, dry_run }。
--
-- 套用前後既有功能完全不變：本檔只新增函式與一張新資料表。
-- 可重複執行（idempotent）：create or replace。
-- 對應回滾腳本：0024_demo_reset_down.sql（只移除本檔新增的函式與閘門資料表，不動任何既有資料）。
-- 請在 SQL Editor 整份執行（不要只選取一部分，否則不在 begin 交易內、失敗時無法整份回滾）。
-- 部署順序：先套用本檔案，再由 TASK-109 的還原編排呼叫。
--
-- 套用後的驗證查詢：
--   select has_function_privilege('anon', 'public.reset_demo_data(jsonb,boolean)', 'execute') as anon_can_exec,
--          has_function_privilege('authenticated', 'public.reset_demo_data(jsonb,boolean)', 'execute') as auth_can_exec,
--          has_function_privilege('service_role', 'public.reset_demo_data(jsonb,boolean)', 'execute') as svc_can_exec;
--   -- 預期：false, false, true（demo_list_storage_objects(text) 同理）

begin;

-- 依賴檢查：缺少前置物件時直接中止，不留下半套。
do $$
declare
  v_missing text;
begin
  select string_agg(t, ', ' order by t) into v_missing
  from unnest(array[
    'public.services', 'public.designers', 'public.designer_services', 'public.designer_leaves',
    'public.designer_portfolio_images', 'public.business_hours', 'public.closed_dates', 'public.booking_policy',
    'public.store_settings', 'public.appointments', 'public.customers', 'public.audit_log', 'public.admins',
    'auth.users', 'storage.objects'
  ]) t
  where to_regclass(t) is null;
  if v_missing is not null then
    raise exception '0024 缺少前置資料表：%（請先套用 0001～0023）', v_missing;
  end if;

  if to_regprocedure('public.demo_revoke_sessions()') is null then
    raise exception '0024 需要先套用 0021（找不到 demo_revoke_sessions()）';
  end if;

  select string_agg(c, ', ' order by c) into v_missing
  from unnest(array[
    'appointments.designer_id', 'appointments.price_at_booking', 'services.buffer_minutes',
    'admins.display_name', 'admins.avatar_url', 'audit_log.actor_id'
  ]) c
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = split_part(c, '.', 1) and column_name = split_part(c, '.', 2)
  );
  if v_missing is not null then
    raise exception '0024 缺少欄位：%', v_missing;
  end if;
end $$;

-- ============================================================
-- 重置閘門
-- ============================================================
-- 單列表（id 固定為 1）：open_until 為 null 或已過期 = 關閉。RLS 啟用、不建任何 policy、不授權給任何 Data API 角色；
-- 只有下面三個 SECURITY DEFINER 函式能碰（皆只有 service_role 可執行）。
create table if not exists public.demo_reset_gate (
  id int primary key default 1,
  open_until timestamptz,
  opened_at timestamptz,
  constraint demo_reset_gate_singleton check (id = 1)
);

insert into public.demo_reset_gate (id) values (1) on conflict (id) do nothing;

alter table public.demo_reset_gate enable row level security;
revoke all on public.demo_reset_gate from public, anon, authenticated, service_role;

create or replace function public.demo_reset_open_gate(p_minutes int)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_until timestamptz;
begin
  if p_minutes is null or p_minutes < 1 or p_minutes > 30 then
    raise exception 'demo_reset_open_gate: p_minutes must be between 1 and 30';
  end if;
  update public.demo_reset_gate
  set open_until = now() + make_interval(mins => p_minutes), opened_at = now()
  where id = 1
  returning open_until into v_until;
  if v_until is null then
    raise exception 'demo_reset_open_gate: gate row is missing';
  end if;
  return v_until;
end;
$$;

create or replace function public.demo_reset_close_gate()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.demo_reset_gate set open_until = null where id = 1;
end;
$$;

create or replace function public.demo_reset_gate_is_open()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select g.open_until > now() from public.demo_reset_gate g where g.id = 1), false);
$$;

revoke execute on function public.demo_reset_open_gate(int) from public, anon, authenticated, service_role;
revoke execute on function public.demo_reset_close_gate() from public, anon, authenticated, service_role;
revoke execute on function public.demo_reset_gate_is_open() from public, anon, authenticated, service_role;
grant execute on function public.demo_reset_open_gate(int) to service_role;
grant execute on function public.demo_reset_close_gate() to service_role;
grant execute on function public.demo_reset_gate_is_open() to service_role;

-- ============================================================
-- reset_demo_data
-- ============================================================
create or replace function public.reset_demo_data(p_payload jsonb, p_dry_run boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule record;
  v_demo_ids uuid[];
  v_demo_id uuid;
  v_unknown_triggers text;
  v_profile jsonb;
  v_counts jsonb := '{}'::jsonb;
  v_deleted jsonb := '{}'::jsonb;
  v_n bigint;
begin
  -- ============================================================
  -- 1. 守門（全部在任何寫入之前；失敗一律 raise，資料不變）
  -- ============================================================
  if p_dry_run is null then
    raise exception 'reset_demo_data: p_dry_run is required (true or false)';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'reset_demo_data: payload must be a json object';
  end if;
  if p_payload ->> 'confirm' is distinct from 'RESET_DEMO' then
    raise exception 'reset_demo_data: missing or wrong confirm';
  end if;
  -- 真實還原需要閘門開著（dry-run 不需要）。放在最前面，失敗得最早。
  if not p_dry_run and not public.demo_reset_gate_is_open() then
    raise exception 'reset_demo_data: reset gate is closed (call demo_reset_open_gate first)';
  end if;

  -- 必要陣列與最低筆數（0 = 鍵必須存在且是陣列，但可為空）。
  for v_rule in
    select k, m from (values
      ('services', 1), ('designers', 1), ('designer_services', 1), ('customers', 1), ('appointments', 1),
      ('portfolio_images', 1), ('designer_leaves', 0), ('closed_dates', 0)
    ) as t (k, m)
  loop
    if jsonb_typeof(p_payload -> v_rule.k) is distinct from 'array' then
      raise exception 'reset_demo_data: % must be a json array', v_rule.k;
    end if;
    if jsonb_array_length(p_payload -> v_rule.k) < v_rule.m then
      raise exception 'reset_demo_data: % has fewer than % rows', v_rule.k, v_rule.m;
    end if;
  end loop;

  if jsonb_typeof(p_payload -> 'business_hours') is distinct from 'array'
     or jsonb_array_length(p_payload -> 'business_hours') <> 7 then
    raise exception 'reset_demo_data: business_hours must be exactly 7 rows';
  end if;
  if (
    select count(distinct (b ->> 'weekday')) from jsonb_array_elements(p_payload -> 'business_hours') b
  ) <> 7 then
    raise exception 'reset_demo_data: business_hours weekday must be distinct';
  end if;

  foreach v_profile in array array[p_payload -> 'booking_policy', p_payload -> 'store_settings', p_payload -> 'demo_admin_profile'] loop
    if jsonb_typeof(v_profile) is distinct from 'object' then
      raise exception 'reset_demo_data: booking_policy, store_settings and demo_admin_profile must be json objects';
    end if;
  end loop;
  v_profile := p_payload -> 'demo_admin_profile';
  if coalesce(btrim(v_profile ->> 'display_name'), '') = '' then
    raise exception 'reset_demo_data: demo_admin_profile.display_name is required';
  end if;

  -- 還原不寄信：預約與顧客不得帶 email，預約不得帶 access_token。
  if exists (
    select 1 from jsonb_array_elements(p_payload -> 'appointments') a
    where a ->> 'customer_email' is not null or jsonb_exists(a, 'access_token')
  ) then
    raise exception 'reset_demo_data: appointments must have null customer_email and no access_token';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_payload -> 'customers') c where c ->> 'email' is not null
  ) then
    raise exception 'reset_demo_data: customers must have null email';
  end if;

  -- Demo 使用者由函式自己決定，不信任 payload。
  select array_agg(u.id order by u.id) into v_demo_ids
  from auth.users u
  where u.raw_app_meta_data ->> 'is_demo' = 'true';
  if coalesce(cardinality(v_demo_ids), 0) <> 1 then
    raise exception 'reset_demo_data: expected exactly 1 demo account, found %', coalesce(cardinality(v_demo_ids), 0);
  end if;
  v_demo_id := v_demo_ids[1];
  -- demo_user_id 必填且必須與查到的相同：避免殘留的 is_demo 帳號（測試或誤建）被當成 Demo 而被改寫 admins／刪 audit_log。
  if jsonb_typeof(p_payload -> 'demo_user_id') is distinct from 'string' then
    raise exception 'reset_demo_data: demo_user_id is required';
  end if;
  if (p_payload ->> 'demo_user_id') is distinct from v_demo_id::text then
    raise exception 'reset_demo_data: demo_user_id does not match the demo account';
  end if;
  -- Demo 帳戶必須已登記在 admins（本函式不自行新增管理員）：放在守門區，失敗得早、不必先刪再回滾。
  if not exists (select 1 from public.admins a where a.user_id = v_demo_id) then
    raise exception 'reset_demo_data: demo account is not registered in admins';
  end if;

  -- 被覆寫的表上不得有「不認得的」觸發器：例如從 Dashboard 手動建的 Database Webhook（沒有 WHEN 條件）。
  -- dry-run 時它們寫進 pg_net 佇列的請求會隨回滾消失、看不到；真實還原時卻會對每一列各打一次。
  -- 白名單是 migration 建立的觸發器；之後新增的觸發器（例如 TASK-116 的筆數上限）要同步補進這裡。
  select string_agg(c.relname || '.' || t.tgname, ', ' order by c.relname, t.tgname) into v_unknown_triggers
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  where c.relnamespace = 'public'::regnamespace
    and c.relname in (
      'services', 'designers', 'designer_services', 'designer_leaves', 'designer_portfolio_images',
      'business_hours', 'closed_dates', 'booking_policy', 'store_settings', 'appointments', 'customers'
    )
    and not t.tgisinternal
    and t.tgname not in (
      'appointments_notify_insert', 'appointments_notify_update', 'appointments_set_price_snapshot',
      'appointments_set_updated_at', 'booking_policy_set_updated_at', 'designer_portfolio_images_limit',
      'designers_set_updated_at', 'store_settings_set_updated_at'
    );
  if v_unknown_triggers is not null then
    raise exception 'reset_demo_data: unknown triggers on restored tables: %', v_unknown_triggers;
  end if;

  -- ============================================================
  -- 2. 鎖：同時只允許一個還原；鎖住所有被覆寫的表擋寫入（不擋讀取）
  -- ============================================================
  -- 鎖與 lock_timeout 放在內層區塊之外：dry-run 回滾子交易時不會連帶釋放。
  -- 一條語句鎖住全部被覆寫的表：還原期間不會有並行寫入殘留或撞主鍵；順序對齊 create_appointment
  -- （先 customers、再 appointments、最後其他表）以避免死結；取不到鎖 5 秒後失敗。
  if not pg_try_advisory_xact_lock(hashtext('demo_reset_data')) then
    raise exception 'reset_demo_data: another reset is already running';
  end if;
  set local lock_timeout = '5s';
  lock table
    public.customers, public.appointments, public.services, public.designers, public.designer_services,
    public.designer_leaves, public.designer_portfolio_images, public.business_hours, public.closed_dates,
    public.booking_policy, public.store_settings
  in exclusive mode;

  -- ============================================================
  -- 3. 覆寫（內層區塊；dry-run 在最後以 RD001 回滾，筆數變數宣告在外層所以保留）
  -- ============================================================
  begin
    -- 3.1 刪除：先刪 appointments（對 services／designers／customers 的外鍵都沒有 on delete）。
    select count(*) into v_n from public.designer_services;
    v_deleted := v_deleted || jsonb_build_object('designer_services', v_n);
    select count(*) into v_n from public.designer_leaves;
    v_deleted := v_deleted || jsonb_build_object('designer_leaves', v_n);
    select count(*) into v_n from public.designer_portfolio_images;
    v_deleted := v_deleted || jsonb_build_object('portfolio_images', v_n);

    delete from public.appointments where true;
    get diagnostics v_n = row_count;
    v_deleted := v_deleted || jsonb_build_object('appointments', v_n);

    delete from public.customers where true;
    get diagnostics v_n = row_count;
    v_deleted := v_deleted || jsonb_build_object('customers', v_n);

    delete from public.designers where true;   -- cascade：designer_services／designer_leaves／designer_portfolio_images
    get diagnostics v_n = row_count;
    v_deleted := v_deleted || jsonb_build_object('designers', v_n);

    delete from public.services where true;
    get diagnostics v_n = row_count;
    v_deleted := v_deleted || jsonb_build_object('services', v_n);

    delete from public.closed_dates where true;
    get diagnostics v_n = row_count;
    v_deleted := v_deleted || jsonb_build_object('closed_dates', v_n);

    delete from public.business_hours where true;
    get diagnostics v_n = row_count;
    v_deleted := v_deleted || jsonb_build_object('business_hours', v_n);

    -- 只刪 Demo 帳戶產生的稽核紀錄；designer001 的紀錄保留。
    delete from public.audit_log where actor_id = v_demo_id;
    get diagnostics v_n = row_count;
    v_deleted := v_deleted || jsonb_build_object('audit_log', v_n);

    -- 3.2 寫入：服務先於預約（appointments_set_price_snapshot 在 insert 時從 services 取價）。
    insert into public.services (id, name, description, price, duration_minutes, buffer_minutes, is_active, sort_order)
    select x.id, x.name, x.description, x.price, x.duration_minutes, x.buffer_minutes, x.is_active, x.sort_order
    from jsonb_to_recordset(p_payload -> 'services') as x (
      id uuid, name text, description text, price numeric, duration_minutes int,
      buffer_minutes int, is_active boolean, sort_order int
    );
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('services', v_n);

    insert into public.designers (id, name, bio, specialties, instagram_handle, avatar_url, is_active, sort_order, created_at)
    select x.id, x.name, x.bio, x.specialties, x.instagram_handle, x.avatar_url, x.is_active, x.sort_order, x.created_at
    from jsonb_to_recordset(p_payload -> 'designers') as x (
      id uuid, name text, bio text, specialties text[], instagram_handle text, avatar_url text,
      is_active boolean, sort_order int, created_at timestamptz
    );
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('designers', v_n);

    insert into public.designer_services (designer_id, service_id)
    select x.designer_id, x.service_id
    from jsonb_to_recordset(p_payload -> 'designer_services') as x (designer_id uuid, service_id uuid);
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('designer_services', v_n);

    insert into public.designer_leaves (designer_id, date)
    select x.designer_id, x.date
    from jsonb_to_recordset(p_payload -> 'designer_leaves') as x (designer_id uuid, date date);
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('designer_leaves', v_n);

    insert into public.designer_portfolio_images (id, designer_id, image_url, storage_path, created_at)
    select x.id, x.designer_id, x.image_url, x.storage_path, x.created_at
    from jsonb_to_recordset(p_payload -> 'portfolio_images') as x (
      id uuid, designer_id uuid, image_url text, storage_path text, created_at timestamptz
    );
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('portfolio_images', v_n);

    insert into public.business_hours (weekday, open_time, close_time, is_closed)
    select x.weekday, x.open_time, x.close_time, x.is_closed
    from jsonb_to_recordset(p_payload -> 'business_hours') as x (
      weekday int, open_time time, close_time time, is_closed boolean
    );
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('business_hours', v_n);

    insert into public.closed_dates (date)
    select x.date
    from jsonb_to_recordset(p_payload -> 'closed_dates') as x (date date);
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('closed_dates', v_n);

    -- 單列表：on conflict 收斂（萬一那列被誤刪也能補回）。id 固定為 1，不採用 payload 的 id。
    insert into public.booking_policy (id, min_lead_time_hours, cancel_window_hours, updated_at)
    select 1, x.min_lead_time_hours, x.cancel_window_hours, now()
    from jsonb_to_record(p_payload -> 'booking_policy') as x (min_lead_time_hours int, cancel_window_hours int)
    on conflict (id) do update set
      min_lead_time_hours = excluded.min_lead_time_hours,
      cancel_window_hours = excluded.cancel_window_hours,
      updated_at = excluded.updated_at;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('booking_policy', v_n);

    insert into public.store_settings (id, name, address, phone, description, logo_url, cover_image_url, updated_at)
    select 1, x.name, x.address, x.phone, x.description, x.logo_url, x.cover_image_url, now()
    from jsonb_to_record(p_payload -> 'store_settings') as x (
      name text, address text, phone text, description text, logo_url text, cover_image_url text
    )
    on conflict (id) do update set
      name = excluded.name,
      address = excluded.address,
      phone = excluded.phone,
      description = excluded.description,
      logo_url = excluded.logo_url,
      cover_image_url = excluded.cover_image_url,
      updated_at = excluded.updated_at;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('store_settings', v_n);

    insert into public.customers (id, name, phone, email, notes)
    select x.id, x.name, x.phone, x.email, x.notes
    from jsonb_to_recordset(p_payload -> 'customers') as x (id uuid, name text, phone text, email text, notes text);
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('customers', v_n);

    -- access_token、price_at_booking、updated_at 不由 payload 帶入：前者吃資料庫預設值、
    -- 價格快照由 BEFORE INSERT 觸發器從 services 取價。
    insert into public.appointments (
      id, service_id, designer_id, customer_id, customer_name, customer_phone, customer_email,
      start_at, end_at, status, created_at
    )
    select x.id, x.service_id, x.designer_id, x.customer_id, x.customer_name, x.customer_phone, x.customer_email,
           x.start_at, x.end_at, x.status, x.created_at
    from jsonb_to_recordset(p_payload -> 'appointments') as x (
      id uuid, service_id uuid, designer_id uuid, customer_id uuid, customer_name text, customer_phone text,
      customer_email text, start_at timestamptz, end_at timestamptz, status text, created_at timestamptz
    );
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('appointments', v_n);

    -- admins 只更新 Demo 那一列；那一列不存在代表 Demo 帳戶尚未登記，拒絕（不自行新增管理員）。
    update public.admins
    set display_name = v_profile ->> 'display_name',
        avatar_url = v_profile ->> 'avatar_url'
    where user_id = v_demo_id;
    get diagnostics v_n = row_count;
    if v_n <> 1 then
      raise exception 'reset_demo_data: demo account is not registered in admins';
    end if;
    v_counts := v_counts || jsonb_build_object('admins', v_n);

    if p_dry_run then
      raise exception 'reset_demo_data dry run rollback' using errcode = 'RD001';
    end if;

    -- 單次通行證：真實還原成功就在同一個交易內關閘門（整個交易失敗則一起回滾，閘門保持原狀）。
    update public.demo_reset_gate set open_until = null where id = 1;
  exception
    -- 只攔截 dry-run 的自訂 SQLSTATE；其他真實錯誤（constraint 違反等）一律往外丟，整個交易回滾。
    when sqlstate 'RD001' then
      -- 非 dry-run 時 RD001 不可能是自己丟的（日後若有觸發器碰巧丟出同一個 SQLSTATE），絕不靜默回滾後假裝成功。
      if not p_dry_run then
        raise;
      end if;
  end;

  return jsonb_build_object('counts', v_counts, 'deleted', v_deleted, 'dry_run', p_dry_run);
end;
$$;

revoke execute on function public.reset_demo_data(jsonb, boolean) from public, anon, authenticated, service_role;
grant execute on function public.reset_demo_data(jsonb, boolean) to service_role;

-- ============================================================
-- demo_list_storage_objects
-- ============================================================
-- 唯讀。bucket 白名單：三個公開 bucket 與 demo-seed。owner_id 以 to_jsonb 讀取，欄位不存在時回 null（不因版本差異失敗）。
-- 注意 PostgREST 預設最多回傳 1000 列；目前各 bucket 只有幾十個物件。
create or replace function public.demo_list_storage_objects(p_bucket text)
returns table (name text, size bigint, etag text, created_at timestamptz, owner_id text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_bucket is null or p_bucket not in ('store-assets', 'designer-assets', 'admin-assets', 'demo-seed') then
    raise exception 'demo_list_storage_objects: bucket not allowed';
  end if;

  return query
  select o.name::text,
         nullif(o.metadata ->> 'size', '')::bigint,
         o.metadata ->> 'eTag',
         o.created_at,
         to_jsonb(o) ->> 'owner_id'
  from storage.objects o
  where o.bucket_id = p_bucket
  order by o.name;
end;
$$;

revoke execute on function public.demo_list_storage_objects(text) from public, anon, authenticated, service_role;
grant execute on function public.demo_list_storage_objects(text) to service_role;

-- 尾端自我檢查：五個函式都必須是 SECURITY DEFINER、search_path 為空，且 anon／authenticated 不能執行；
-- 閘門資料表必須啟用 RLS、沒有任何 policy、不授權給 Data API 角色；reset_demo_data 本文必須有閘門檢查。
do $$
begin
  if (
    select count(*) from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in (
        'reset_demo_data', 'demo_list_storage_objects',
        'demo_reset_open_gate', 'demo_reset_close_gate', 'demo_reset_gate_is_open'
      )
      and p.prosecdef
      and 'search_path=""' = any (p.proconfig)
  ) <> 5 then
    raise exception '0024 自我檢查失敗：函式必須是 SECURITY DEFINER 且 search_path 為空';
  end if;

  if position('demo_reset_gate_is_open' in pg_get_functiondef('public.reset_demo_data(jsonb,boolean)'::regprocedure)) = 0 then
    raise exception '0024 自我檢查失敗：reset_demo_data 缺少閘門檢查';
  end if;

  if not exists (select 1 from pg_class where oid = 'public.demo_reset_gate'::regclass and relrowsecurity)
     or exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'demo_reset_gate')
     or has_table_privilege('anon', 'public.demo_reset_gate', 'select')
     or has_table_privilege('authenticated', 'public.demo_reset_gate', 'select')
     or has_table_privilege('service_role', 'public.demo_reset_gate', 'select') then
    raise exception '0024 自我檢查失敗：demo_reset_gate 必須啟用 RLS、沒有 policy、不授權給 anon／authenticated／service_role';
  end if;

  if has_function_privilege('anon', 'public.demo_reset_open_gate(int)', 'execute')
     or has_function_privilege('authenticated', 'public.demo_reset_open_gate(int)', 'execute')
     or has_function_privilege('anon', 'public.demo_reset_close_gate()', 'execute')
     or has_function_privilege('authenticated', 'public.demo_reset_close_gate()', 'execute')
     or has_function_privilege('anon', 'public.demo_reset_gate_is_open()', 'execute')
     or has_function_privilege('authenticated', 'public.demo_reset_gate_is_open()', 'execute')
     or not has_function_privilege('service_role', 'public.demo_reset_open_gate(int)', 'execute')
     or not has_function_privilege('service_role', 'public.demo_reset_close_gate()', 'execute')
     or not has_function_privilege('service_role', 'public.demo_reset_gate_is_open()', 'execute') then
    raise exception '0024 自我檢查失敗：閘門函式只能由 service_role 執行';
  end if;

  if has_function_privilege('anon', 'public.reset_demo_data(jsonb,boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.reset_demo_data(jsonb,boolean)', 'execute')
     or has_function_privilege('anon', 'public.demo_list_storage_objects(text)', 'execute')
     or has_function_privilege('authenticated', 'public.demo_list_storage_objects(text)', 'execute') then
    raise exception '0024 自我檢查失敗：anon／authenticated 不得有 execute 權限';
  end if;

  if not has_function_privilege('service_role', 'public.reset_demo_data(jsonb,boolean)', 'execute')
     or not has_function_privilege('service_role', 'public.demo_list_storage_objects(text)', 'execute') then
    raise exception '0024 自我檢查失敗：service_role 必須能執行';
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
