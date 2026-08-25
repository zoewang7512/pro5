-- TASK-028（create_appointment RPC 加入 closed_dates 檢查）
-- 起因：0004_slots_closures_buffer.sql（TASK-024）當時刻意不修改 create_appointment，
-- 只讓 get_available_slots 感知 closed_dates／buffer_minutes（見該檔頭註解）；
-- security-reviewer 於 TASK-024 審查指出這是殘留風險——「整天公休」是硬規則，唯一防線是
-- get_available_slots 在畫面上不顯示公休日時段，顧客若繞過前端直接呼叫 create_appointment
-- 仍能在公休日訂到位。本檔案補上這道防線：在 create_appointment 服務驗證之後、提前量與
-- 視野上限檢查之前，新增 closed_dates 命中檢查，命中即回傳既有 SLOT_CONFLICT 錯誤碼
-- （不新增錯誤碼、不改前端——理由見任務卡「既有模式」：get_available_slots 已經把
-- 公休日／已被預約／超出視野三種「沒有時段」的原因統一回傳同一種空陣列，不對外細分原因，
-- create_appointment 的公休日拒絕比照同一個姿態）。
--
-- **編號與內容基準（TASK-028 任務卡撰寫於 2026-08-07，本檔案於 2026-08-25 才實際套用，
-- 期間有 0006～0012 共 7 個 migration 插進來，任務卡原始計畫的檔名/內容基準已過時，
-- 套用前重新核對過）**：
-- - 任務卡原本計畫叫 `0005_...`，當時 0005 這個編號確實還沒被用到；但實際部署順序上，
--   本檔案是接在 0012 之後才新增，取名 0005 會誤導成「排在 0004 和 0006 之間」，與真實
--   部署順序不符，因此改用 0013（下一個真正未使用的編號）。
-- - 任務卡原本計畫以 0002_booking_flow.sql 的 create_appointment 版本為底；但
--   0009_booking_policy_lead_time.sql（TASK-048）已經用 create or replace 把提前量檢查
--   從寫死 interval '1 hour' 改成讀取 booking_policy.min_lead_time_hours，是目前正式
--   資料庫實際在跑的版本。若仍以 0002 版本為底，會讓 create_appointment 退回沒有
--   booking_policy 提前量邏輯的舊行為，等於讓 TASK-048 的成果消失——本檔案改以 0009 版本
--   為底，只插入公休日檢查那一段，其餘驗證/寫入邏輯（含提前量讀取 booking_policy）原封
--   不動。
--
-- 公休日判定比照 lib/admin/closed-dates.ts findAffectedAppointmentsForClosedDate 的既有
-- 邏輯：一律以 Asia/Taipei 時區圈定「這筆預約屬於哪一天」，不是 UTC。只檢查 p_start_at
-- 所屬的那一天——get_available_slots 的候選時段生成邏輯已保證同一天內，create_appointment
-- 沿用同一批候選時段，不需要額外檢查 end_at 所屬日期。
--
-- 公休日檢查刻意放在「服務驗證」之後：若 p_service_id 本身無效或服務已停用，應該回報
-- SERVICE_INACTIVE（既有行為），不該被公休日檢查搶先攔截、回報語意不精確的
-- SLOT_CONFLICT；放在「提前量與視野上限檢查」之前，比照 get_available_slots 讓公休日
-- 檢查在其他業務規則檢查之前的既有慣例。
--
-- 部署順序防呆比照 0004_slots_closures_buffer.sql 的既有寫法：create or replace 前先
-- 確認 closed_dates 表存在，避免本機無 Supabase CLI／migration ledger（人工貼 SQL
-- Editor 執行）的既有限制下，套用順序錯誤只在顧客端執行期才顯現。本檔案承接自 0009 的
-- 函式本體同時也讀取 booking_policy（TASK-048），一併檢查該表存在，理由相同——這是
-- 0009 本身遺漏檢查的部分（0009 只檢查了自己新增的依賴，沒有回頭替它保留的舊邏輯補
-- 防呆），architect／security-reviewer 於本卡總覽審查一併提出。
--
-- 函式簽名（參數/回傳型別）、security definer／set search_path = ''、
-- grant execute ... to anon 邊界、其餘既有驗證與寫入邏輯全部不變。
-- 對應回滾腳本：0013_create_appointment_closed_dates_down.sql（換回 0009 版本，不含
-- closed_dates 檢查；比照既有慣例用 create or replace 換回舊版本，不用 drop function，
-- 避免顧客端建立預約的唯一寫入路徑出現空窗）。
-- 可重複執行（idempotent）：create or replace function。
--
-- **已知隱性約束（security-reviewer 於本卡總覽審查提出）**：下方公休日檢查依賴
-- `select 1 from public.closed_dates where ...` 能實際讀到資料列——`closed_dates` 目前
-- 對 anon／authenticated 皆有 select policy（見 0003_closures_and_buffer.sql），本函式
-- 的 security definer 身分不受此限；但若該表未來被啟用 `force row level security`
-- （比照 booking_policy 已知不能開啟的理由，見 0009_booking_policy_lead_time.sql 與
-- ai/context/project-map.md 的說明），這裡的 `exists` 會讀到 0 列，讓公休日檢查靜默
-- 失效（fail-open，比 booking_policy 提前量 fallback 回 1 小時更危險——那裡至少還有
-- 提前量，這裡整個防線消失）。**該表同樣不得啟用 force row level security**。

begin;

do $$
begin
  if to_regclass('public.closed_dates') is null then
    raise exception '0013_create_appointment_closed_dates.sql 依賴 0003_closures_and_buffer.sql 建立的 closed_dates 表，請先套用 0003 再套用本檔案';
  end if;
  if to_regclass('public.booking_policy') is null then
    raise exception '0013_create_appointment_closed_dates.sql 承接自 0009_booking_policy_lead_time.sql 的函式本體依賴 booking_policy 表，請先套用 0008 再套用本檔案';
  end if;
end $$;

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

  -- 公休日檢查（TASK-028 新增）：整天公休是硬規則，跟 appointments_no_overlap exclusion
  -- constraint 一樣在寫入路徑本身擋下，不能只靠 get_available_slots 在畫面上不顯示時段。
  -- 不是靠 constraint 觸發 exception，而是在寫入前主動 if exists 擋下，用同樣的
  -- jsonb_build_object('ok', false, 'error_code', ..., 'message', ...) 回傳格式直接
  -- return，不進 exception 區塊。重用既有 SLOT_CONFLICT 錯誤碼（理由見檔頭註解），前端
  -- 不需要新增任何錯誤文案分支。
  if exists (
    select 1 from public.closed_dates
    where closed_dates.date = (p_start_at at time zone 'Asia/Taipei')::date
  ) then
    return jsonb_build_object('ok', false, 'error_code', 'SLOT_CONFLICT', 'message', 'slot already booked');
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
