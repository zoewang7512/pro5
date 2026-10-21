-- 回滾 0018_designer_aware_booking.sql：換回 0009 的 get_available_slots（兩個參數）與 0014 的
-- create_appointment（五個參數），還原全店不分設計師的 exclusion constraint，appointments.designer_id 改回
-- nullable，並移除兩支內部判斷函式。回滾後 0017 建立的設計師資料表與 designer_id 欄位都還在（由 0017_down
-- 處理）。
--
-- **回滾順序（重要）**：先在 Vercel 回滾前端 → 再執行本檔案 → 最後才是 0017_down（如果也要回滾）。順序反過來，
-- 新前端帶 p_designer_id 的呼叫會找不到函式（PGRST202），整個預約功能中斷。
--
-- **會失敗的情況（必須先人工處理）**：還原全店 exclusion constraint 時，只要已經存在「不同設計師在同一時段」
-- 的有效預約，加入 constraint 就會失敗，整個交易回滾、什麼都不會改。多位設計師正式上線之後，這幾乎一定會
-- 發生，回滾就不再乾淨：要先決定哪些預約取消或改期，才能還原。本腳本會先檢查並以明確訊息中止。
-- 回滾即恢復「全店只有一個時段、不分設計師」的行為，並讓 create_appointment 不再檢查 buffer 與 email 上限
-- （回到 0014 的行為），屬有意識接受的風險；不可跨級回滾，回滾前務必先核對正式環境目前跑的是哪一版。
--
-- 授權：刻意不照抄 0009／0014 的授權行（只 grant anon，其餘靠 default privileges），改成明寫 anon、
-- authenticated、service_role 三個角色可呼叫，還原成 0018 套用前實測（2026-10-21）的狀態，不依賴平台的
-- default privileges 是否仍然生效。
--
-- 一開始先鎖表（access exclusive，lock_timeout 5 秒）：檢查「跨設計師同時段預約」與加回全店 constraint 之間
-- 不能有新的寫入，否則錯誤訊息會變成難懂的 gist 衝突而不是下面明確的提示。拿不到鎖時整份回滾。

begin;

set local lock_timeout = '5s';
lock table public.appointments in access exclusive mode;

do $$
begin
  if exists (
    select 1
    from public.appointments a
    join public.appointments b
      on a.id < b.id
     and a.designer_id <> b.designer_id
     and a.status in ('pending', 'confirmed', 'completed')
     and b.status in ('pending', 'confirmed', 'completed')
     and tstzrange(a.start_at, a.end_at, '[)') && tstzrange(b.start_at, b.end_at, '[)')
  ) then
    raise exception '存在不同設計師在同一時段的有效預約，無法還原全店 exclusion constraint；請先人工處理這些預約再回滾';
  end if;
end $$;

-- 新簽名先 drop（舊簽名與新簽名是不同的函式，不會被 create or replace 覆蓋）。
drop function if exists public.get_available_slots(uuid, date, uuid);
drop function if exists public.create_appointment(uuid, timestamptz, text, text, text, uuid);

alter table public.appointments drop constraint if exists appointments_no_overlap;
alter table public.appointments
  add constraint appointments_no_overlap
  exclude using gist (
    tstzrange(start_at, end_at, '[)') with &&
  )
  where (status in ('pending', 'confirmed', 'completed'));

alter table public.appointments alter column designer_id drop not null;

-- ============================================================
-- get_available_slots：換回 0009_booking_policy_lead_time.sql 的版本
-- ============================================================
create or replace function public.get_available_slots(p_service_id uuid, p_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_duration_minutes int;
  v_is_active boolean;
  v_buffer_minutes int;
  v_min_lead_hours int;
  v_weekday int;
  v_open time;
  v_close time;
  v_is_closed boolean;
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_slot_start timestamptz;
  v_slot_end timestamptz;
  v_slots jsonb := '[]'::jsonb;
  v_today date;
begin
  v_today := (now() at time zone 'Asia/Taipei')::date;

  if p_date < v_today or p_date > (v_today + 90) then
    return jsonb_build_object('ok', true, 'data', '[]'::jsonb);
  end if;

  select duration_minutes, is_active, buffer_minutes into v_duration_minutes, v_is_active, v_buffer_minutes
  from public.services where id = p_service_id;

  if v_duration_minutes is null or not v_is_active then
    return jsonb_build_object('ok', true, 'data', '[]'::jsonb);
  end if;

  select min_lead_time_hours into v_min_lead_hours from public.booking_policy where id = 1;
  v_min_lead_hours := coalesce(v_min_lead_hours, 1);

  -- closed_dates 優先於 business_hours：整天公休直接回傳空陣列，不用再查當週固定營業時間。
  if exists (select 1 from public.closed_dates where closed_dates.date = p_date) then
    return jsonb_build_object('ok', true, 'data', '[]'::jsonb);
  end if;

  v_weekday := extract(dow from p_date);

  select open_time, close_time, is_closed into v_open, v_close, v_is_closed
  from public.business_hours where weekday = v_weekday;

  if v_open is null or v_close is null or coalesce(v_is_closed, true) then
    return jsonb_build_object('ok', true, 'data', '[]'::jsonb);
  end if;

  v_day_start := (p_date + v_open) at time zone 'Asia/Taipei';
  v_day_end := (p_date + v_close) at time zone 'Asia/Taipei';
  v_slot_start := v_day_start;

  while v_slot_start + make_interval(mins => v_duration_minutes) <= v_day_end loop
    v_slot_end := v_slot_start + make_interval(mins => v_duration_minutes);

    -- 緩衝時間感知的重疊判斷：候選時段與每筆既有預約各自延伸自己的 buffer_minutes
    -- 後再比較（buffer_minutes = 0 時 make_interval(mins => 0) 是零長度 interval，
    -- 行為自動退化成修改前的原始邏輯，不需要額外的 if buffer_minutes > 0 分支）。
    -- a.start_at 的範圍限定（±1 天，services.buffer_minutes 上限 120 分鐘，遠小於一天，
    -- margin 足夠涵蓋所有可能跨日的緩衝情況）讓 planner 能改用 appointments_start_at_idx，
    -- 避免這支 anon 可呼叫、無 rate limit 的 RPC 隨資料量線性變慢（見
    -- 0004_slots_closures_buffer.sql 的既有說明）。
    if v_slot_start > now() + make_interval(hours => v_min_lead_hours)
       and not exists (
         select 1
         from public.appointments a
         join public.services s2 on s2.id = a.service_id
         where a.status in ('pending', 'confirmed', 'completed')
           and a.start_at >= v_day_start - interval '1 day'
           and a.start_at < v_day_end + interval '1 day'
           and tstzrange(a.start_at, a.end_at + make_interval(mins => s2.buffer_minutes), '[)')
               && tstzrange(v_slot_start, v_slot_end + make_interval(mins => v_buffer_minutes), '[)')
       )
    then
      v_slots := v_slots || jsonb_build_array(
        jsonb_build_object('start_at', v_slot_start, 'end_at', v_slot_end)
      );
    end if;

    v_slot_start := v_slot_start + interval '30 minutes';
  end loop;

  return jsonb_build_object('ok', true, 'data', v_slots);
exception
  when others then
    return jsonb_build_object('ok', false, 'error_code', 'INTERNAL_ERROR', 'message', 'unexpected error');
end;
$$;

revoke execute on function public.get_available_slots(uuid, date) from public, anon, authenticated, service_role;
grant execute on function public.get_available_slots(uuid, date) to anon, authenticated, service_role;

-- ============================================================
-- create_appointment：換回 0014_create_appointment_business_hours.sql 的版本
-- ============================================================
create or replace function public.create_appointment(
  p_service_id uuid,
  p_start_at timestamptz,
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_duration_minutes int;
  v_is_active boolean;
  v_end_at timestamptz;
  v_customer_id uuid;
  v_pending_count int;
  v_appointment_id uuid;
  v_service_name text;
  v_phone_digits text;
  v_email text;
  v_constraint text;
  v_min_lead_hours int;
  v_weekday int;
  v_open time;
  v_close time;
  v_is_closed boolean;
  v_day_start timestamptz;
  v_day_end timestamptz;
begin
  -- 基本欄位驗證與電話正規化（去除非數字字元；前端已做一次，後端不可只信任前端）
  if p_customer_name is null or length(trim(p_customer_name)) = 0
     or length(trim(p_customer_name)) > 50 then
    return jsonb_build_object('ok', false, 'error_code', 'VALIDATION_ERROR', 'message', 'invalid name');
  end if;

  v_phone_digits := regexp_replace(coalesce(p_customer_phone, ''), '\D', '', 'g');
  if length(v_phone_digits) < 8 or length(v_phone_digits) > 10 or left(v_phone_digits, 1) <> '0' then
    return jsonb_build_object('ok', false, 'error_code', 'VALIDATION_ERROR', 'message', 'invalid phone');
  end if;

  v_email := nullif(trim(coalesce(p_customer_email, '')), '');
  if v_email is not null and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return jsonb_build_object('ok', false, 'error_code', 'VALIDATION_ERROR', 'message', 'invalid email');
  end if;

  -- p_start_at 有限值防護（TASK-062 新增）：'infinity'::timestamptz 或 null 原本只是
  -- 偶然被 extract／when others 吞成籠統 INTERNAL_ERROR，不是設計行為，顯式攔截後語意
  -- 正確、回報 VALIDATION_ERROR 較準確。放在服務驗證之前，避免用 infinity 探測服務狀態。
  if p_start_at is null or not isfinite(p_start_at) then
    return jsonb_build_object('ok', false, 'error_code', 'VALIDATION_ERROR', 'message', 'invalid start_at');
  end if;

  -- 服務驗證
  select duration_minutes, is_active, name into v_duration_minutes, v_is_active, v_service_name
  from public.services where id = p_service_id;

  if v_duration_minutes is null or not v_is_active then
    return jsonb_build_object('ok', false, 'error_code', 'SERVICE_INACTIVE', 'message', 'service not available');
  end if;

  -- 公休日檢查（TASK-028）：整天公休是硬規則，跟 appointments_no_overlap exclusion
  -- constraint 一樣在寫入路徑本身擋下，不能只靠 get_available_slots 在畫面上不顯示時段。
  if exists (
    select 1 from public.closed_dates
    where closed_dates.date = (p_start_at at time zone 'Asia/Taipei')::date
  ) then
    return jsonb_build_object('ok', false, 'error_code', 'SLOT_CONFLICT', 'message', 'slot already booked');
  end if;

  v_end_at := p_start_at + make_interval(mins => v_duration_minutes);

  -- 營業時間檢查（TASK-062 新增）：整天公休、或時段（含服務時長）落在 open_time～
  -- close_time 之外，皆拒絕。用 timestamptz 區間比較（v_day_start／v_day_end），不是
  -- ::time——見上方檔頭「跨午夜漏洞與修正經過」，::time 比較在服務時段跨越台北時間午夜
  -- 時會回捲失效。
  v_weekday := extract(dow from (p_start_at at time zone 'Asia/Taipei'));

  select open_time, close_time, is_closed into v_open, v_close, v_is_closed
  from public.business_hours where weekday = v_weekday;

  -- v_is_closed 是 not null 欄位（0002_booking_flow.sql:22），is null 只可能代表查無
  -- 該 weekday 列（多半是列被誤刪或 upsert 部分失敗），與「該 weekday 本來就整天公休」
  -- 是不同情況，只對前者寫 log。
  if v_is_closed is null then
    raise log 'create_appointment: business_hours missing row for weekday %', v_weekday;
  end if;

  -- 查無列（v_is_closed is null）／整天公休（v_is_closed = true）／防禦性檢查
  -- open_time／close_time 為 null（理論上 business_hours_valid_range 已保證非公休列
  -- 必有這兩欄，但不假設 constraint 一定成立）→ 一律拒絕（fail-closed）。
  if v_open is null or v_close is null or coalesce(v_is_closed, true) then
    return jsonb_build_object('ok', false, 'error_code', 'SLOT_CONFLICT', 'message', 'slot already booked');
  end if;

  v_day_start := ((p_start_at at time zone 'Asia/Taipei')::date + v_open) at time zone 'Asia/Taipei';
  v_day_end := ((p_start_at at time zone 'Asia/Taipei')::date + v_close) at time zone 'Asia/Taipei';

  -- timestamptz 區間比較（非 ::time），避免跨台北午夜時回捲失效。邊界值：起點等於
  -- open_time、終點等於 close_time 皆放行（< / > 而非 <= / >=，對齊 get_available_slots
  -- 現行版本在 0009_booking_policy_lead_time.sql:110 的 while ... <= v_day_end 既有
  -- 語意）。
  if p_start_at < v_day_start or v_end_at > v_day_end then
    return jsonb_build_object('ok', false, 'error_code', 'SLOT_CONFLICT', 'message', 'slot already booked');
  end if;

  select min_lead_time_hours into v_min_lead_hours from public.booking_policy where id = 1;
  v_min_lead_hours := coalesce(v_min_lead_hours, 1);

  -- 提前量與視野上限（提前量讀取 booking_policy 設定值，視野上限維持寫死 90 天不變）
  if p_start_at < now() + make_interval(hours => v_min_lead_hours) or p_start_at > now() + interval '90 days' then
    return jsonb_build_object('ok', false, 'error_code', 'VALIDATION_ERROR', 'message', 'start_at out of allowed range');
  end if;

  -- 基本防灌爆：同號碼未過期的 pending/confirmed 預約數上限
  select count(*) into v_pending_count
  from public.appointments
  where customer_phone = v_phone_digits
    and status in ('pending', 'confirmed')
    and start_at > now();

  if v_pending_count >= 3 then
    return jsonb_build_object('ok', false, 'error_code', 'BOOKING_LIMIT_EXCEEDED', 'message', 'too many pending appointments');
  end if;

  -- 顧客去重：phone 優先，找不到才試 email；兩者都找不到才新建。
  -- phone 命中即為準，不再檢查 email、不覆寫既有顧客欄位。
  select id into v_customer_id from public.customers where phone = v_phone_digits;
  if v_customer_id is null and v_email is not null then
    select id into v_customer_id from public.customers where email = v_email;
  end if;
  if v_customer_id is null then
    insert into public.customers (name, phone, email)
    values (p_customer_name, v_phone_digits, v_email)
    returning id into v_customer_id;
  end if;

  insert into public.appointments (
    service_id, customer_id, customer_name, customer_phone, customer_email,
    start_at, end_at, status
  )
  values (
    p_service_id, v_customer_id, p_customer_name, v_phone_digits, v_email,
    p_start_at, v_end_at, 'pending'
  )
  returning id into v_appointment_id;

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'service_name', v_service_name,
      'start_at', p_start_at,
      'end_at', v_end_at,
      'customer_name', p_customer_name,
      'customer_phone', v_phone_digits
    )
  );
exception
  when unique_violation or exclusion_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'appointments_no_overlap' then
      return jsonb_build_object('ok', false, 'error_code', 'SLOT_CONFLICT', 'message', 'slot already booked');
    end if;
    -- customers_phone_key／customers_email_key 的極少數並發撞號情況：請前端重試整個請求
    return jsonb_build_object('ok', false, 'error_code', 'INTERNAL_ERROR', 'message', 'please retry');
  when others then
    return jsonb_build_object('ok', false, 'error_code', 'INTERNAL_ERROR', 'message', 'unexpected error');
end;
$$;

revoke execute on function public.create_appointment(uuid, timestamptz, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.create_appointment(uuid, timestamptz, text, text, text) to anon, authenticated, service_role;

drop function if exists public._email_dedupe_key(text);
drop function if exists public._designer_is_free(uuid, timestamptz, timestamptz, int);
drop function if exists public._designer_is_eligible(uuid, uuid, date);

-- btree_gist 擴充套件不移除：其他物件可能也依賴它，留著無害。

notify pgrst, 'reload schema';

commit;
