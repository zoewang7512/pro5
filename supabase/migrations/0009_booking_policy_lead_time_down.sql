-- 回滾 0009_booking_policy_lead_time.sql
-- 換回 0009 套用前的原始版本（get_available_slots 換回 0004_slots_closures_buffer.sql
-- 的版本、create_appointment 換回 0002_booking_flow.sql 的版本，提前量檢查一律寫死
-- interval '1 hour'）。比照既有慣例用 create or replace（不用 drop function），避免
-- 顧客端預約功能出現空窗；函式簽名與 anon 的 grant execute 邊界不變。
-- 回滾後 booking_policy.min_lead_time_hours 的值不再被任何 RPC 讀取（僅後台頁面顯示），
-- 若之後要重新套用 0009，行為會立即恢復讀取當下的設定值，不需要額外處理。
-- 回滾順序警告：若要一併回滾 0008_booking_policy.sql（移除 booking_policy 表本身），
-- 必須先套用本檔案、確認兩支函式已換回不依賴 booking_policy 的版本，再套用
-- 0008_booking_policy_down.sql——順序顛倒的話，0008_booking_policy_down.sql 的
-- `drop table ... restrict` 不會偵測到 plpgsql 函式體對這張表的依賴（Postgres 不記錄
-- 函式原始碼對表的依賴進 pg_depend），會直接成功執行，讓兩支仍讀取 booking_policy 的
-- anon RPC 在執行期出錯、被 exception when others 吞成籠統 INTERNAL_ERROR，造成顧客端
-- 預約功能整個中斷且沒有任何可診斷的錯誤訊息（architect／security-reviewer 於 TASK-048
-- 審查提出）。

begin;

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
    -- margin 足夠涵蓋所有可能跨日的緩衝情況）是這次修改新加的：改成緩衝感知的比較式後，
    -- tstzrange(a.start_at, a.end_at + buffer, '[)') 不再與 appointments_no_overlap
    -- exclusion constraint 的索引運算式完全相同，原本能利用該 GiST 索引的查詢會退化成
    -- 全表掃描；補上這個限定條件讓 planner 能改用 appointments_start_at_idx，避免這支
    -- anon 可呼叫、無 rate limit 的 RPC 隨資料量線性變慢、且迴圈內每個候選時段都要重新
    -- 掃一次全表（一次呼叫約 18-25 輪）。
    if v_slot_start > now() + interval '1 hour'
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

revoke execute on function public.get_available_slots(uuid, date) from public;
grant execute on function public.get_available_slots(uuid, date) to anon;

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

  -- 服務驗證
  select duration_minutes, is_active, name into v_duration_minutes, v_is_active, v_service_name
  from public.services where id = p_service_id;

  if v_duration_minutes is null or not v_is_active then
    return jsonb_build_object('ok', false, 'error_code', 'SERVICE_INACTIVE', 'message', 'service not available');
  end if;

  v_end_at := p_start_at + make_interval(mins => v_duration_minutes);

  -- 提前量與視野上限
  if p_start_at < now() + interval '1 hour' or p_start_at > now() + interval '90 days' then
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

revoke execute on function public.create_appointment(uuid, timestamptz, text, text, text) from public;
grant execute on function public.create_appointment(uuid, timestamptz, text, text, text) to anon;

commit;
