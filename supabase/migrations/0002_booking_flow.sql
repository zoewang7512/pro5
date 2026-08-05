-- TASK-010（顧客預約流程 架構基礎）
-- 新增 business_hours 表、撤銷 TASK-003 開放的 anon 直接 INSERT appointments 路徑、
-- 新增時段衝突防護（exclusion constraint）與兩個 anon 可呼叫的 SECURITY DEFINER RPC：
-- get_available_slots／create_appointment。
-- 只含 schema 變更，不含種子資料——種子資料由 scripts/seed-booking-data.mjs 負責
-- （services/business_hours 沒有天然的冪等 upsert key，塞進 migration 會在重跑時
-- 產生重複資料，或在未來「服務項目管理」Epic 刪除種子服務後被 migration 復活）。
-- 可重複執行（idempotent）：使用 if not exists / drop ... if exists。
-- 對應回滾腳本：0002_booking_flow_down.sql
-- 相關決策：ai/context/decisions.md 2026-08-05（撤銷 anon INSERT policy；
-- exclusion constraint 設計：不分服務、排除已取消預約）。

begin;

-- ============================================================
-- business_hours：每週固定營業時間，供可預約時段運算使用
-- ============================================================
create table if not exists public.business_hours (
  weekday int primary key check (weekday between 0 and 6), -- 0=週日...6=週六，對齊 extract(dow from date)
  open_time time,
  close_time time,
  is_closed boolean not null default false,
  constraint business_hours_valid_range check (
    is_closed or (open_time is not null and close_time is not null and close_time > open_time)
  )
);

alter table public.business_hours enable row level security;

drop policy if exists "public read business hours" on public.business_hours;
create policy "public read business hours"
  on public.business_hours
  for select
  to anon, authenticated
  using (true);

drop policy if exists "admin full access to business hours" on public.business_hours;
create policy "admin full access to business hours"
  on public.business_hours
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================
-- 撤銷 TASK-003 開放的 anon 直接 INSERT 路徑
-- appointments 的唯一寫入路徑改為 create_appointment RPC（見下方），
-- 該 RPC 才能在交易內做時段衝突檢查與顧客去重；寬鬆的 INSERT policy 做不到。
-- ============================================================
drop policy if exists "anyone can create pending appointment" on public.appointments;
revoke insert (service_id, customer_name, customer_phone, customer_email, start_at, end_at)
  on public.appointments from anon;

-- ============================================================
-- 時段衝突防護：資料庫層 exclusion constraint
-- 不以 service_id 分割——只有一位設計師，不同服務也不能同時段重疊。
-- 排除 cancelled：取消的預約不應永久佔用該時段。
-- 純 tstzrange 的 exclusion 用內建 range_ops GiST 運算子類別即可，不需要 btree_gist
-- 擴充套件（btree_gist 只有在排除鍵混合了非 range 的等值比較欄位時才需要）。
-- ============================================================
alter table public.appointments drop constraint if exists appointments_no_overlap;
alter table public.appointments
  add constraint appointments_no_overlap
  exclude using gist (
    tstzrange(start_at, end_at, '[)') with &&
  )
  where (status in ('pending', 'confirmed', 'completed'));

-- ============================================================
-- get_available_slots：查詢可預約時段，anon 可呼叫
-- 只回傳時間資訊，不回傳任何 appointments/customers 的個資欄位。
-- ============================================================
drop function if exists public.get_available_slots(uuid, date);

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

  select duration_minutes, is_active into v_duration_minutes, v_is_active
  from public.services where id = p_service_id;

  if v_duration_minutes is null or not v_is_active then
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

    if v_slot_start > now() + interval '1 hour'
       and not exists (
         select 1 from public.appointments a
         where a.status in ('pending', 'confirmed', 'completed')
           and tstzrange(a.start_at, a.end_at, '[)') && tstzrange(v_slot_start, v_slot_end, '[)')
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

-- ============================================================
-- create_appointment：建立預約，anon 可呼叫
-- 交易內完成：驗證 → 顧客去重（找/建）→ 寫入 appointments（交由 exclusion constraint
-- 擋衝突）。回傳值一律回顯本次請求送出的 customer_name/customer_phone，不是資料庫裡
-- 既有顧客記錄的值——避免變成用電話號碼反查他人姓名的列舉漏洞。
-- ============================================================
drop function if exists public.create_appointment(uuid, timestamptz, text, text, text);

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
