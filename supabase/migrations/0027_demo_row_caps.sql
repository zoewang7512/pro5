-- TASK-116（Demo 體驗帳戶：Demo 專屬資料筆數上限，架構筆記 D14）
-- 對六張表各加一個 BEFORE INSERT 觸發器，共用 public.demo_row_cap_guard()：**只有 Demo 體驗帳號的請求**
-- （JWT 的 app_metadata.is_demo = 'true'）在該表目前總列數已達上限時，新增被拒絕。
-- 目的：避免公開入口的任何人以 Demo 身分用腳本大量新增資料，灌爆免費方案的資料庫容量、拖垮整個正式專案
-- （含前台預約）。與 0025（Storage 物件數上限）互補。
--
-- 上限（整張表的總列數，使用者核准；集中在 demo_row_cap_guard() 內的 case 一處）：
--   services                   10
--   designers                  5
--   designer_services          50
--   designer_leaves            20
--   designer_portfolio_images  60
--   closed_dates               20
--
-- 誰不受影響：一般管理員、service role（含每日還原與 dry-run）、匿名顧客、psql／SQL Editor——它們的請求沒有
-- Demo claim，函式在第一個判斷就放行，不做任何查詢。
-- 誰受影響：Demo 體驗帳號的請求。
--
-- 為什麼沒有 customers／appointments（審查後移除，初版曾有 24／640）：Demo 寫入這兩張表的唯一途徑是 create_appointment，
-- 而匿名訪客能呼叫同一個 RPC、能力完全相同，所以這兩個上限擋不到想灌資料的人；反而任何人用匿名身分刷 12 支新電話，
-- 就能讓 Demo 當天無法預約。這兩張表的容量防護改由 TASK-120／121（匿名預約）處理。本檔會清掉初版建立的這兩個觸發器。
--
-- 規則細節：
--   * 硬上限：先 pg_advisory_xact_lock（每張表一把）讓 Demo 對同一張表的寫入排隊，再計算總列數；並行時不會超出。
--   * 計數是整張表的總列數，不只算 Demo 新增的。
--   * 被拒絕時 errcode P0001、訊息以 DEMO_ROW_CAP: 開頭並帶表名與上限，hint 是白話說明。
--   * 公休日（closed_dates）的新增是 upsert：on conflict 之前 BEFORE INSERT 就會觸發，所以表已滿時，對「已存在日期」
--     的重複新增也會被拒絕（每日還原後恢復）；請假（designer_leaves）重複日期同理。
--   * 只管新增：不影響既有資料，也不影響 update／delete。正式庫目前資料量若已超過某些上限，Demo 要等第一次真實還原
--     （TASK-112）後才有額度。
--
-- reset_demo_data 的觸發器白名單：0024 的守門區會拒絕「被覆寫的表上不認得的觸發器」，所以本檔以 create or replace
-- 重新定義 reset_demo_data，**除白名單新增六個觸發器外與 0024 逐字相同**（tests/lib/demo-row-caps-migration.test.ts 把關）。
-- 若日後在那十一張表上再新增觸發器，同樣要補進最新那份 reset_demo_data 的白名單（該測試會在漏補時失敗）。
--
-- 觸發器如何認出 Demo：讀呼叫端 JWT 的 app_metadata.is_demo（簽章後的 claim，使用者無法自行改寫），與 0026 相同。
-- 這些表的寫入都走 PostgREST（同一個交易內有 request.jwt.claims）；0025 的 storage-api 寫入不走使用者連線，所以當時改查 owner_id。
-- 失敗方向：函式先以核心函式 current_setting 檢查 claims 字串有沒有出現 is_demo，沒有就直接放行，**不解析 JSON、不依賴 auth schema**——
-- 即使日後平台改動 auth.jwt()，一般管理員、匿名預約與每日還原也不會被連帶擋住；只有「疑似 Demo」的請求才會解析 JWT，解析失敗就拒絕。
--
-- 套用前後非 Demo 帳號行為：不變（觸發器對非 Demo 只多一次 JWT 判斷）。既有資料、policy、其他觸發器都不動。
-- 套用順序：任何時間都可套用（只依賴 0001～0026 已存在的物件）；Demo 帳戶不需先存在。
-- 可重複執行（idempotent）：create or replace、drop trigger if exists 後重建；已套用過初版（8 個觸發器）的庫重跑本檔即可，會清掉 customers／appointments 的兩個。
-- 回滾：0027_demo_row_caps_down.sql（移除上限；警告：等於重新打開缺口，見該檔說明）。
-- 請在 SQL Editor 整份執行（不要只選取一部分，否則不在 begin 交易內、失敗時無法整份回滾）。
--
-- 緊急停用單一張表的上限（例如上限設太低導致 Demo 無法使用時，只貼這一行，不要用 _down.sql）：
--   drop trigger if exists demo_row_cap_<表名> on public.<表名>;
-- 要調整上限：把 demo_row_cap_guard() 內 case 的數字改掉後整份重跑，並同步更新 tests/lib/demo-row-caps-migration.test.ts 的預期值。
--
-- 套用後的驗證：
--   1. 貼上並執行 ai/artifacts/Demo 體驗帳戶/verification/TASK-116-verify.sql（整個交易以例外收尾，保證 rollback，
--      不留下任何資料；訊息內列出六張表的結果）。
--   2. select c.relname, t.tgname, t.tgenabled from pg_trigger t join pg_class c on c.oid = t.tgrelid
--        where t.tgname like 'demo_row_cap_%' and not t.tgisinternal order by 1;   -- 預期 8 列、tgenabled 皆 O

begin;

-- 依賴檢查：缺少前置物件時直接中止，不留下半套。
do $$
declare
  v_missing text;
begin
  select string_agg(t, ', ' order by t) into v_missing
  from unnest(array['public.services', 'public.designers', 'public.designer_services', 'public.designer_leaves', 'public.designer_portfolio_images', 'public.closed_dates']) t
  where to_regclass(t) is null;
  if v_missing is not null then
    raise exception '0027 缺少前置資料表：%（請先套用 0001～0026）', v_missing;
  end if;

  if to_regprocedure('auth.jwt()') is null then
    raise exception '0027 需要 auth.jwt()（此 Supabase 版本沒有；請回報，不要硬套）';
  end if;

  -- reset_demo_data 與其白名單來自 0024；找不到代表 0024 沒套用，本檔會在沒有函式可更新的情況下留下半套。
  if to_regprocedure('public.reset_demo_data(jsonb,boolean)') is null then
    raise exception '0027 需要先套用 0024（找不到 reset_demo_data）';
  end if;
end
$$;

-- ============================================================
-- 觸發器函式：Demo 筆數上限
-- ============================================================
-- SECURITY DEFINER、search_path 為空：計數必須是整張表的總列數，不能被呼叫者的 RLS 縮小（否則上限可被繞過）。
-- 非 Demo 的請求在第一個判斷就 return，不做任何查詢也不解析 JSON；表名不在 case 內（理論上不會發生）也直接放行。
-- 這個函式出錯會擋住新增，所以刻意寫得很短；緊急停用見檔頭。
-- 動態 SQL 只用 %I 嵌入 tg_table_schema／tg_table_name（來自觸發器本身，不是使用者輸入）。
create or replace function public.demo_row_cap_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claims text;
  v_cap integer;
  v_count bigint;
begin
  -- 預篩：claims 字串裡根本沒有 is_demo 就一定不是 Demo，立刻放行（不解析 JSON、不呼叫 auth.jwt()）。
  v_claims := coalesce(nullif(current_setting('request.jwt.claims', true), ''), nullif(current_setting('request.jwt.claim', true), ''));
  if v_claims is null or strpos(v_claims, 'is_demo') = 0 then
    return new;
  end if;

  -- 疑似 Demo：以簽章後的 app_metadata.is_demo 為準（user_metadata 或頂層欄位出現同名鍵不算）。
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'is_demo', '') <> 'true' then
    return new;
  end if;

  v_cap := case tg_table_name
    when 'services' then 10
    when 'designers' then 5
    when 'designer_services' then 50
    when 'designer_leaves' then 20
    when 'designer_portfolio_images' then 60
    when 'closed_dates' then 20
    else null
  end;
  if v_cap is null then
    return new;
  end if;

  -- 同一張表的 Demo 寫入排隊：鎖到交易結束，後面的人才看得到前面已提交的列，上限才是硬的。
  perform pg_advisory_xact_lock(hashtextextended('demo-row-cap:' || tg_table_name, 0));

  execute format('select count(*) from %I.%I', tg_table_schema, tg_table_name) into v_count;

  if v_count >= v_cap then
    raise exception 'DEMO_ROW_CAP: % (cap %)', tg_table_name, v_cap
      using errcode = 'P0001',
            hint = '體驗帳號的資料筆數已達上限，每日凌晨會自動還原。';
  end if;
  return new;
end;
$$;

-- 觸發器函式不需要任何角色的 execute 權限（只在 create trigger 時檢查建立者）；全部收回，避免被當一般函式呼叫。
revoke execute on function public.demo_row_cap_guard() from public, anon, authenticated, service_role;

-- ============================================================
-- 六個觸發器（以及清掉初版的 customers／appointments 觸發器）
-- ============================================================
drop trigger if exists demo_row_cap_customers on public.customers;
drop trigger if exists demo_row_cap_appointments on public.appointments;

drop trigger if exists demo_row_cap_services on public.services;
create trigger demo_row_cap_services
  before insert on public.services
  for each row
  execute function public.demo_row_cap_guard();

drop trigger if exists demo_row_cap_designers on public.designers;
create trigger demo_row_cap_designers
  before insert on public.designers
  for each row
  execute function public.demo_row_cap_guard();

drop trigger if exists demo_row_cap_designer_services on public.designer_services;
create trigger demo_row_cap_designer_services
  before insert on public.designer_services
  for each row
  execute function public.demo_row_cap_guard();

drop trigger if exists demo_row_cap_designer_leaves on public.designer_leaves;
create trigger demo_row_cap_designer_leaves
  before insert on public.designer_leaves
  for each row
  execute function public.demo_row_cap_guard();

drop trigger if exists demo_row_cap_designer_portfolio_images on public.designer_portfolio_images;
create trigger demo_row_cap_designer_portfolio_images
  before insert on public.designer_portfolio_images
  for each row
  execute function public.demo_row_cap_guard();

drop trigger if exists demo_row_cap_closed_dates on public.closed_dates;
create trigger demo_row_cap_closed_dates
  before insert on public.closed_dates
  for each row
  execute function public.demo_row_cap_guard();

-- ============================================================
-- reset_demo_data：與 0024 逐字相同，只有觸發器白名單新增六個 demo_row_cap_* 觸發器
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

-- 尾端自我檢查：六個觸發器都存在、啟用、BEFORE INSERT ROW；函式是 SECURITY DEFINER、search_path 為空、
-- 擁有者可繞過 RLS（否則計數永遠是 0，上限等於失效）、API 角色都不能執行；還原函式的白名單含六個新觸發器，初版的兩個已移除，權限未變。
do $$
declare
  v_names text[] := array['demo_row_cap_services', 'demo_row_cap_designers', 'demo_row_cap_designer_services', 'demo_row_cap_designer_leaves', 'demo_row_cap_designer_portfolio_images', 'demo_row_cap_closed_dates'];
  v_name text;
begin
  if (
    select count(*) from pg_trigger t
    where t.tgname = any (v_names)
      and not t.tgisinternal
      and t.tgenabled = 'O'
      and (t.tgtype & 1) = 1   -- FOR EACH ROW
      and (t.tgtype & 2) = 2   -- BEFORE
      and (t.tgtype & 4) = 4   -- INSERT
      and (t.tgtype & (8 | 16 | 32)) = 0   -- 只有 INSERT
      and t.tgfoid = 'public.demo_row_cap_guard()'::regprocedure
  ) <> cardinality(v_names) then
    raise exception '0027 自我檢查失敗：六個 demo_row_cap_* 觸發器沒有全部建立成功（BEFORE INSERT ROW、已啟用）';
  end if;

  if exists (select 1 from pg_trigger where tgname in ('demo_row_cap_customers', 'demo_row_cap_appointments') and not tgisinternal) then
    raise exception '0027 自我檢查失敗：初版的 demo_row_cap_customers／demo_row_cap_appointments 觸發器沒有清掉';
  end if;

  if not exists (
    select 1 from pg_proc p
    join pg_roles r on r.oid = p.proowner
    where p.oid = 'public.demo_row_cap_guard()'::regprocedure
      and p.prosecdef
      and p.proconfig @> array['search_path=""']
      and r.rolbypassrls
  ) then
    raise exception '0027 自我檢查失敗：demo_row_cap_guard 必須是 SECURITY DEFINER、search_path 為空，且擁有者可繞過 RLS（否則計數永遠是 0，上限等於失效）';
  end if;

  if has_function_privilege('anon', 'public.demo_row_cap_guard()', 'execute')
     or has_function_privilege('authenticated', 'public.demo_row_cap_guard()', 'execute')
     or has_function_privilege('service_role', 'public.demo_row_cap_guard()', 'execute') then
    raise exception '0027 自我檢查失敗：anon／authenticated／service_role 不應能執行 demo_row_cap_guard';
  end if;

  foreach v_name in array v_names loop
    if position(quote_literal(v_name) in (select p.prosrc from pg_proc p where p.oid = 'public.reset_demo_data(jsonb,boolean)'::regprocedure)) = 0 then
      raise exception '0027 自我檢查失敗：reset_demo_data 的觸發器白名單缺少 %', v_name;
    end if;
  end loop;

  if has_function_privilege('anon', 'public.reset_demo_data(jsonb,boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.reset_demo_data(jsonb,boolean)', 'execute')
     or not has_function_privilege('service_role', 'public.reset_demo_data(jsonb,boolean)', 'execute') then
    raise exception '0027 自我檢查失敗：reset_demo_data 的執行權限應只有 service_role';
  end if;
end $$;

commit;
