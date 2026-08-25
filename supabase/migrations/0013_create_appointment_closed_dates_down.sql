-- 回滾 0013_create_appointment_closed_dates.sql
-- 換回 0013 套用前的版本（0009_booking_policy_lead_time.sql 建立的版本：提前量讀取
-- booking_policy.min_lead_time_hours，不含 closed_dates 檢查）。比照既有慣例用
-- create or replace（不用 drop function），避免顧客端建立預約的唯一寫入路徑出現空窗；
-- 函式簽名與 anon 的 grant execute 邊界不變。
-- 回滾後，顧客繞過前端直接呼叫 create_appointment 將重新能在公休日訂到位（回到
-- TASK-024 安全性審查發現的殘留風險），僅在需要暫時撤銷本卡變更時使用。
--
-- **不可跨級回滾（architect 於本卡審查提出）**：本檔案只能在「當下正式環境跑的就是
-- 0013 版本」時使用，換回的是 0013 套用前一刻的版本（0009）。若日後有更後面的
-- migration（例如未來的 0014+）又用 create or replace 重寫過 create_appointment，
-- 此時直接套用本檔案會把那個更新版本蓋回這裡寫死的舊版本，等於連同後面幾版的修正
-- 一起消失且沒有任何警示——這正是本卡最初想修正的那種「任務卡撰寫時的版本基準過時」
-- 問題，回滾時同樣要先確認「正式環境目前實際跑的是哪一版」，不能只看檔名數字順序。

begin;

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

revoke execute on function public.create_appointment(uuid, timestamptz, text, text, text) from public;
grant execute on function public.create_appointment(uuid, timestamptz, text, text, text) to anon;

commit;
