-- 回滾 0031_demo_reminder_guard.sql
-- 移除 demo_appointment_reminder 觸發器與 demo_appointment_reminder_guard()，並把 reset_demo_data 還原成 0027 的本文（逐字，白名單不含新觸發器）。
--
-- 警告：回滾等於重新打開缺口——Demo 體驗帳號改期會把 reminder_sent_at 設回 null，隔天的提醒排程會對該預約的 Email 寄提醒信。
-- 回滾期間請確認 Demo 入口已關閉（DEMO_ENABLED=false 並執行 demo:disable），或接受這個風險。
-- 順序：先 drop 觸發器與函式，再還原 reset_demo_data（同一個交易內，失敗整份回滾）。
-- 注意：本檔把 reset_demo_data 寫死成 0027 的本文。若 0031 之後有 migration（0032 以上）又重新定義了 reset_demo_data，
-- **不得使用本檔**（會無聲地蓋掉那份修改）；請改為手動只 drop 觸發器與 demo_appointment_reminder_guard()。回滾順序：本檔必須先於 0027_down。
-- 可重複執行（idempotent）。請在 SQL Editor 整份執行。

begin;

set local lock_timeout = '5s';

drop trigger if exists demo_appointment_reminder on public.appointments;

drop function if exists public.demo_appointment_reminder_guard();

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
      'designers_set_updated_at', 'store_settings_set_updated_at',
      -- TASK-116（0027）：Demo 筆數上限觸發器
      'demo_row_cap_closed_dates', 'demo_row_cap_designer_leaves', 'demo_row_cap_designer_portfolio_images',
      'demo_row_cap_designer_services', 'demo_row_cap_designers', 'demo_row_cap_services'
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

-- 尾端自我檢查：觸發器與函式都已移除；reset_demo_data 的白名單不再含 demo_appointment_reminder、仍含 0027 的觸發器；執行權限仍只有 service_role。
do $$
declare
  v_src text;
begin
  if exists (select 1 from pg_trigger where tgname = 'demo_appointment_reminder' and not tgisinternal)
     or to_regprocedure('public.demo_appointment_reminder_guard()') is not null then
    raise exception '0031_down 自我檢查失敗：仍有 demo_appointment_reminder 觸發器或函式';
  end if;
  select p.prosrc into v_src from pg_proc p where p.oid = 'public.reset_demo_data(jsonb,boolean)'::regprocedure;
  if position('demo_appointment_reminder' in v_src) > 0 then
    raise exception '0031_down 自我檢查失敗：reset_demo_data 的白名單仍含 demo_appointment_reminder';
  end if;
  if position('demo_row_cap_closed_dates' in v_src) = 0 then
    raise exception '0031_down 自我檢查失敗：reset_demo_data 的白名單應保留 0027 的 demo_row_cap_*';
  end if;
  if has_function_privilege('anon', 'public.reset_demo_data(jsonb,boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.reset_demo_data(jsonb,boolean)', 'execute')
     or not has_function_privilege('service_role', 'public.reset_demo_data(jsonb,boolean)', 'execute') then
    raise exception '0031_down 自我檢查失敗：reset_demo_data 的執行權限應只有 service_role';
  end if;
end $$;

commit;
