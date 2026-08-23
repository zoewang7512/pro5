-- TASK-048（預約規則與政策設定 create_appointment／get_available_slots 讀取最短提前預約
-- 時間設定值）
-- create or replace public.create_appointment／public.get_available_slots：把兩支函式
-- 原本寫死的「最短提前 1 小時」（interval '1 hour'）改為讀取 TASK-046 建立的
-- booking_policy.min_lead_time_hours。最遠視野上限（create_appointment 的 90 天）維持
-- 寫死不變，不受本卡影響。函式簽名（參數/回傳型別）與 anon 的 grant execute 邊界皆不變，
-- 只換函式本體；既有公休日（closed_dates）、緩衝時間（buffer_minutes）檢查邏輯原封不動，
-- 只新增提前量讀取這一項判斷條件，彼此獨立生效、互不覆蓋或短路。
-- get_available_slots 的最新定義在 0004_slots_closures_buffer.sql（0002 的原始版本已被
-- 0004 的 create or replace 取代），本檔案以 0004 版本為基礎再疊加提前量讀取；
-- create_appointment 自 0002 後未被其他 migration 動過，以 0002 版本為基礎修改。
-- booking_policy 表恆有 1 列（0008_booking_policy.sql migration seed 保證），若查詢意外
-- 回傳空結果（理論上不會發生）fallback 為 1 小時（既有預設值），避免因設定表意外清空
-- 導致整個預約功能中斷（比照既有防禦性寫法）。此 fallback 的失效方向刻意選擇「退回較
-- 寬鬆的預設值」而非 fail-closed 拒絕預約——與 lib/booking-policy.ts 對「查無資料」一律
-- 視為錯誤的決策方向相反，這是刻意的不對稱：lib/booking-policy.ts 只影響後台顯示（低
-- 影響範圍），這裡若 fail-closed 會讓顧客端唯一的預約路徑整個中斷（security-reviewer 於
-- TASK-048 審查提出的取捨）。**重要隱性約束**：這個 fallback 假設 booking_policy 的
-- select 不受 RLS 限制（函式擁有者 postgres 繞過 RLS）；若未來對 booking_policy 執行
-- `alter table ... force row level security`，這兩支函式會因為擁有者不屬於 anon/
-- authenticated 角色而讀不到任何列，靜默降級成 1 小時（即使管理員設定了更長的提前量）。
-- booking_policy 表不得啟用 force row level security，除非同時把這裡的 fallback 邏輯
-- 改為 fail-closed。**這個隱性約束目前有一個功能性偵測器**：
-- tests/booking.integration.test.ts 的「min_lead_time_hours 設為上限 720 小時時，近期
-- 營業日的可預約時段全部消失」案例——若有人啟用 force row level security，這兩支函式的
-- select 會讀到 0 列，coalesce 靜默退回 1 小時，時段就不會消失，該案例會失敗。不要因為
-- 看似與「3 小時邊界」案例重複而刪掉或簡化它（security-reviewer 於 TASK-050 Epic
-- 總覽性審查提出；PostgREST 只暴露 public schema、本專案無可執行任意 SQL 的 RPC，
-- 無法直接斷言 pg_class.relforcerowsecurity，這是目前唯一可行的迴歸防護）。
-- 對應下方兩支函式的部署順序防呆：見 0009_booking_policy_lead_time_down.sql 的回滾順序
-- 警告——若要一併回滾 0008_booking_policy.sql，必須先套用本檔案的回滾腳本，再回滾 0008。
-- 部署順序防呆：create or replace function 前先確認 booking_policy 表存在，理由同
-- 0004_slots_closures_buffer.sql 對 closed_dates 表的既有防呆——plpgsql 函式體在
-- create or replace 當下不會解析內容，若 0008 尚未套用，本函式仍會建立成功但每次呼叫都
-- 會在執行期出錯（被 exception when others 吞成籠統 INTERNAL_ERROR）。
-- 對應回滾腳本：0009_booking_policy_lead_time_down.sql（換回寫死 1 小時的原始版本，
-- 不用 drop function，避免顧客端預約功能出現空窗）。
-- 可重複執行（idempotent）：create or replace function。

begin;

do $$
begin
  if to_regclass('public.booking_policy') is null then
    raise exception '0009_booking_policy_lead_time.sql 依賴 0008_booking_policy.sql 建立的 booking_policy 表，請先套用 0008 再套用本檔案';
  end if;
end $$;

-- ============================================================
-- get_available_slots：在 0004_slots_closures_buffer.sql 的既有版本基礎上，
-- 把 interval '1 hour' 改為讀取 booking_policy.min_lead_time_hours。
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

revoke execute on function public.get_available_slots(uuid, date) from public;
grant execute on function public.get_available_slots(uuid, date) to anon;

-- ============================================================
-- create_appointment：在 0002_booking_flow.sql 的既有版本基礎上，把提前量檢查的
-- interval '1 hour' 改為讀取 booking_policy.min_lead_time_hours；視野上限
-- interval '90 days' 維持寫死不變。
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
