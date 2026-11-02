-- TASK-121（Demo 體驗帳戶：Demo 動過的預約不再觸發提醒信，架構筆記 D13 的 R2 缺口）
-- 在 public.appointments 上新增 BEFORE UPDATE 觸發器 demo_appointment_reminder（函式 demo_appointment_reminder_guard()）：
-- **只有 Demo 體驗帳號的請求**（JWT 的 app_metadata.is_demo = 'true'）更新預約時，強制
--   new.reminder_sent_at := coalesce(old.reminder_sent_at, now())
-- 也就是「Demo 動過的預約一律視為已提醒」：已提醒的不能被清回 null，從沒提醒過的也會被標成已提醒。
--
-- 為什麼要做：後台的改期（lib/admin/appointments.ts rescheduleAppointment）會把 reminder_sent_at 設回 null。Demo 帳號是管理員，
-- 能對任意 Email 的預約改期；改到明天後，每日提醒排程（claimAppointmentsForReminder：start_at 在 0～26 小時內、status 為
-- pending／confirmed、reminder_sent_at 為 null，每次最多 100 筆）就會對該 Email 寄提醒信，而信件內容（顧客名、服務名、設計師名）
-- 可由 Demo 改動。0026 只擋了改期／取消通知信，沒擋這條路。每筆預約每日最多一封，但與 R1（TASK-120）搭配可以放大。
-- 使用者決定（TASK-121）：採「觸發器強制已提醒」並與還原函式白名單合併在同一個 migration。
--
-- 誰不受影響：一般管理員、cron（claim／release）、service role、匿名顧客、psql／SQL Editor——它們的請求沒有 Demo claim，
-- 函式在第一個判斷就放行，不解析 JSON、不呼叫 auth.jwt()。誰受影響：Demo 體驗帳號的請求。
-- 副作用（已接受）：Demo 對預約做任何 UPDATE（含只改狀態）都會把 reminder_sent_at 填成目前時間；Demo 動過的預約不會收到提醒信（之後若由一般管理員再改期，會被清回 null、提醒恢復）。
-- 面試官自己在前台預約（匿名、INSERT）的確認信與提醒信不受影響，直到有人用 Demo 帳號動它為止。
--
-- 觸發器如何認出 Demo：讀呼叫端 JWT 的 app_metadata.is_demo（簽章後的 claim，使用者無法自行改寫；user_metadata 或頂層欄位出現同名鍵不算），
-- 與 0026／0027 相同。後台寫入走 PostgREST，同一個交易內有 request.jwt.claims。
-- 失敗方向：預篩（claims 字串裡沒有 is_demo 就放行）之後才解析 JWT；解析丟出例外時**視為 Demo 並強制已提醒**，
-- 既不讓更新失敗，也不放過（疑似 Demo 的請求才會走到這裡，一般請求不會）。
--
-- 觸發器順序：同一個事件的 BEFORE 觸發器依名稱字母順序執行，appointments_set_updated_at 先、本觸發器後；兩者互不相干（本觸發器只改 reminder_sent_at）。
-- 限制：日後若在 appointments 新增名稱排在 demo_appointment_reminder 之後、又會改 reminder_sent_at 的 BEFORE UPDATE 觸發器，可能把本觸發器的結果蓋掉。
-- reminder_sent_at 現在也代表「Demo 動過、因而不提醒」，日後做報表或畫面時不能把它當成「提醒信已寄出」。
-- 不影響 0012 的 UPDATE webhook（它的 WHEN 只看 status／start_at／end_at；本觸發器只動 reminder_sent_at，不會額外觸發也不改變分類）。
--
-- reset_demo_data 的觸發器白名單：0024 的守門區會拒絕「被覆寫的表上不認得的觸發器」，沒補白名單的話，每日還原與手動還原都會因
-- unknown triggers 整個失敗。所以本檔在**同一個交易內**以 create or replace 重新定義 reset_demo_data，**除白名單新增
-- demo_appointment_reminder 外與 0027 逐字相同**（tests/lib/demo-reminder-guard-migration.test.ts 以逐字比對把關）。
-- 還原是先 delete 再 insert、不發 UPDATE，所以不會觸發本觸發器；還原寫入的預約 reminder_sent_at 是 null、也不帶 Email，行為不變。
-- 若日後在那十一張表上再新增觸發器，同樣要補進最新那份 reset_demo_data 的白名單（該測試與 0027 的掃描測試會在漏補時失敗）。
--
-- 套用順序：必須在 0027 之後（本檔以 0027 的還原函式為基底）；與應用程式部署順序無關。Demo 帳戶不需先存在。
-- 可重複執行（idempotent）：create or replace、drop trigger if exists 後重建。
-- **但不要在 0031 之後出現更新的 reset_demo_data 定義時重跑本檔**：它會無聲地把還原函式倒退成 0027 加一個白名單項目。
-- 緊急停用後只需要把觸發器建回來（不必重跑本檔）：
--   create trigger demo_appointment_reminder before update on public.appointments for each row execute function public.demo_appointment_reminder_guard();
-- 回滾：0031_demo_reminder_guard_down.sql（移除觸發器與函式、把 reset_demo_data 還原成 0027 本文；警告：等於重新打開缺口）。
-- 緊急停用（觸發器出問題時，只貼這一行，不要用 _down.sql，因為白名單多一個名稱不影響還原）：
--   drop trigger if exists demo_appointment_reminder on public.appointments;
-- 請在 SQL Editor 整份執行（不要只選取一部分，否則不在 begin 交易內、失敗時無法整份回滾）。
--
-- 套用前先記下目前還原函式本文的指紋（套用後它會因白名單多一項而不同；_down 之後應回到同一個值）：
--   select md5(prosrc) from pg_proc where oid = 'public.reset_demo_data(jsonb,boolean)'::regprocedure;
--   0027 的本文（換行符號為 LF）預期是 f80ed21daf4463befd02e371ee250662；若 SQL Editor 保留了 CRLF 則會不同，以套用前自己記下的值為準。
-- 套用後的驗證：
--   1. 貼上並執行 ai/artifacts/Demo 體驗帳戶/verification/TASK-121-verify.sql（整個交易以例外收尾，保證 rollback，
--      不會寄出任何信件、不留下任何資料；訊息內列出各情境結果與還原函式白名單的文字檢查，**不會執行還原**）。
--   2. select tgname, tgenabled from pg_trigger
--        where tgrelid = 'public.appointments'::regclass and tgname = 'demo_appointment_reminder' and not tgisinternal;  -- 預期 1 列、O
--   3. 本機：npm run test:demo-reminder-guard（依賴 0026：Demo 有 Email 的改期情境靠它抑制通知信）、npm run test:demo-reset（dry-run；白名單守門在 dry-run 也會執行，通過才證明還原函式接受新觸發器）。

begin;

-- drop trigger／create trigger 要取得 appointments 的表鎖（drop trigger 是 ACCESS EXCLUSIVE）：拿不到就在 5 秒內整份回滾，換個時間重跑。
-- 注意 lock_timeout 只把等待上限壓在 5 秒，等待期間讀寫 appointments 的請求（前台時段查詢、預約、後台列表）仍會排在它後面。
-- 請避開兩個排程：提醒 cron（UTC 01:00＝台北 09:00）與 Demo 還原 cron（UTC 19:00＝台北 03:00；還原會持有 appointments 的 EXCLUSIVE 鎖，此時套用必定逾時）。
set local lock_timeout = '5s';

-- 依賴檢查：缺少前置物件時直接中止，不留下半套。
do $$
begin
  if to_regclass('public.appointments') is null then
    raise exception '0031 需要 public.appointments（請先套用 0001～0030；本檔直接依賴 0010、0024、0027）';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'appointments' and column_name = 'reminder_sent_at'
  ) then
    raise exception '0031 需要 appointments.reminder_sent_at（0010 尚未套用）';
  end if;
  if to_regprocedure('auth.jwt()') is null then
    raise exception '0031 需要 auth.jwt()（此 Supabase 版本沒有；請回報，不要硬套）';
  end if;
  -- 本檔以 0027 的還原函式為基底：找不到函式、或函式本文不含 0027 的白名單，代表 0024／0027 沒套用，
  -- 硬套會把還原函式倒退成沒有筆數上限觸發器白名單的版本（之後 0027 的觸發器會讓還原失敗）。
  if to_regprocedure('public.reset_demo_data(jsonb,boolean)') is null then
    raise exception '0031 需要先套用 0024 與 0027（找不到 reset_demo_data）';
  end if;
  if position(quote_literal('demo_row_cap_closed_dates') in (select p.prosrc from pg_proc p where p.oid = 'public.reset_demo_data(jsonb,boolean)'::regprocedure)) = 0 then
    raise exception '0031 需要先套用 0027（reset_demo_data 的白名單沒有 demo_row_cap_*）';
  end if;
end
$$;

-- ============================================================
-- 觸發器函式：Demo 動過的預約視為已提醒
-- ============================================================
-- SECURITY DEFINER、search_path 為空：與同系列觸發器函式一致；本函式只讀 JWT、只改 NEW，不讀寫任何資料表。
-- 非 Demo 的請求在預篩就 return，不解析 JSON、不依賴 auth schema——即使日後平台改動 auth.jwt()，
-- 一般管理員、提醒排程（claim／release）與每日還原都不會被連帶影響。
create or replace function public.demo_appointment_reminder_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claims text;
begin
  -- 預篩：claims 字串裡根本沒有 is_demo 就一定不是 Demo，立刻放行（不解析 JSON、不呼叫 auth.jwt()）。
  -- 讀取順序與 Supabase 的 auth.jwt() 一致（request.jwt.claim 優先、再 request.jwt.claims），避免兩者讀到不同來源。
  v_claims := coalesce(nullif(current_setting('request.jwt.claim', true), ''), nullif(current_setting('request.jwt.claims', true), ''));
  if v_claims is null or strpos(v_claims, 'is_demo') = 0 then
    return new;
  end if;

  -- 疑似 Demo：以簽章後的 app_metadata.is_demo 為準。解析失敗（理論上不會發生）不得讓更新失敗，也不得放過，
  -- 所以例外分支什麼都不做、直接落到下面的強制已提醒。
  begin
    if coalesce(auth.jwt() -> 'app_metadata' ->> 'is_demo', '') <> 'true' then
      return new;
    end if;
  exception
    when others then
      null;
  end;

  new.reminder_sent_at := coalesce(old.reminder_sent_at, now());
  return new;
end;
$$;

-- 觸發器函式不需要任何角色的 execute 權限（只在 create trigger 時檢查建立者）；全部收回，避免被當一般函式呼叫。
revoke execute on function public.demo_appointment_reminder_guard() from public, anon, authenticated, service_role;

-- ============================================================
-- 觸發器：沒有 WHEN 條件，判斷全在函式內（auth.jwt() 不能放進 WHEN）
-- ============================================================
drop trigger if exists demo_appointment_reminder on public.appointments;
create trigger demo_appointment_reminder
  before update on public.appointments
  for each row
  execute function public.demo_appointment_reminder_guard();

-- ============================================================
-- reset_demo_data：與 0027 逐字相同，只有觸發器白名單新增 demo_appointment_reminder
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
      'demo_row_cap_designer_services', 'demo_row_cap_designers', 'demo_row_cap_services',
      -- TASK-121（0031）：Demo 預約提醒標記觸發器
      'demo_appointment_reminder'
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

-- 尾端自我檢查：觸發器存在、啟用、BEFORE UPDATE ROW 且只在 UPDATE；函式是 SECURITY DEFINER、search_path 為空、API 角色都不能執行；
-- 還原函式的白名單同時含 0027 的六個觸發器與本檔的新觸發器，權限未變。
do $$
declare
  v_src text;
  v_name text;
begin
  if (
    select count(*) from pg_trigger t
    where t.tgrelid = 'public.appointments'::regclass
      and t.tgname = 'demo_appointment_reminder'
      and not t.tgisinternal
      and t.tgenabled = 'O'
      and (t.tgtype & 1) = 1   -- FOR EACH ROW
      and (t.tgtype & 2) = 2   -- BEFORE
      and (t.tgtype & 16) = 16   -- UPDATE
      and (t.tgtype & (4 | 8 | 32)) = 0   -- 只有 UPDATE（不含 INSERT／DELETE／TRUNCATE）
      and t.tgfoid = 'public.demo_appointment_reminder_guard()'::regprocedure
  ) <> 1 then
    raise exception '0031 自我檢查失敗：demo_appointment_reminder 觸發器沒有建立成功（BEFORE UPDATE ROW、已啟用）';
  end if;

  if not exists (
    select 1 from pg_proc p
    where p.oid = 'public.demo_appointment_reminder_guard()'::regprocedure
      and p.prosecdef
      and p.proconfig @> array['search_path=""']
  ) then
    raise exception '0031 自我檢查失敗：demo_appointment_reminder_guard 必須是 SECURITY DEFINER、search_path 為空';
  end if;

  if has_function_privilege('anon', 'public.demo_appointment_reminder_guard()', 'execute')
     or has_function_privilege('authenticated', 'public.demo_appointment_reminder_guard()', 'execute')
     or has_function_privilege('service_role', 'public.demo_appointment_reminder_guard()', 'execute') then
    raise exception '0031 自我檢查失敗：anon／authenticated／service_role 不應能執行 demo_appointment_reminder_guard';
  end if;

  select p.prosrc into v_src from pg_proc p where p.oid = 'public.reset_demo_data(jsonb,boolean)'::regprocedure;
  foreach v_name in array array[
    'demo_appointment_reminder', 'demo_row_cap_services', 'demo_row_cap_designers', 'demo_row_cap_designer_services',
    'demo_row_cap_designer_leaves', 'demo_row_cap_designer_portfolio_images', 'demo_row_cap_closed_dates'
  ] loop
    if position(quote_literal(v_name) in v_src) = 0 then
      raise exception '0031 自我檢查失敗：reset_demo_data 的觸發器白名單缺少 %', v_name;
    end if;
  end loop;

  if has_function_privilege('anon', 'public.reset_demo_data(jsonb,boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.reset_demo_data(jsonb,boolean)', 'execute')
     or not has_function_privilege('service_role', 'public.reset_demo_data(jsonb,boolean)', 'execute') then
    raise exception '0031 自我檢查失敗：reset_demo_data 的執行權限應只有 service_role';
  end if;
end $$;

commit;
