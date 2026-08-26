-- TASK-062（create_appointment RPC 加入 business_hours 檢查）
-- 起因：0013_create_appointment_closed_dates.sql（TASK-028）補上了 closed_dates（特殊
-- 公休日）檢查，但 architect／security-reviewer 於該卡總覽審查一致指出殘留風險——
-- create_appointment 仍完全不檢查 business_hours（每週固定公休、每天營業起訖時間），
-- 顧客繞過前端直接呼叫 API，理論上仍能在週固定公休日（例如週日）或凌晨等非營業時段成功
-- 建立預約。get_available_slots（見 0009_booking_policy_lead_time.sql 現行版本第
-- 89-121 行）已有感知，create_appointment 沒有，本檔案補齊。
--
-- **檢查範圍**（人工於 spec-interrogation 核准，2026-08-26）：不只擋「整天公休」
-- （is_closed = true），時段（p_start_at ~ p_start_at + duration_minutes）落在
-- open_time～close_time 之外也一併擋，涵蓋服務時長跨過打烊時間的情況。不檢查 30 分鐘
-- 時段對齊（create_appointment 本來就不驗證，非本卡範圍）。
--
-- **跨午夜漏洞與修正經過（architect／security-reviewer 兩輪審查發現並確認修正）**：
-- 本卡最初的 SQL 草稿用 ::time 只比較時分秒、丟棄日期部分，在服務時段跨越台北時間午夜
-- 時會回捲比較而 fail-open（例如週一 23:45 起訂、30 分鐘服務，v_end_at 落在週二
-- 00:15，::time 比較會讓兩個時間都誤判「落在營業時間內」而放行，等於本檔案要補的防線
-- 在每天固定時間窗內形同虛設）。下方改用 timestamptz 區間比較（v_day_start／v_day_end，
-- 比照 get_available_slots 現行版本在 0009_booking_policy_lead_time.sql:106-107 的
-- 既有寫法），語意上「預約必須完整落在當天營業窗內」，跨午夜自動不成立。**日後若考慮
-- 把這段改回更簡短的 ::time 寫法，請先重讀這段——那正是本檔案最初想避免重演的漏洞。**
--
-- **本檢查與 0013 closed_dates 檢查的相依關係**：本檢查讓「預約必須完整落在當天營業窗
-- 內」成為不可能跨當地午夜的不變量，這正是 0013 檔頭「closed_dates 只需檢查 p_start_at
-- 所屬那一天、不用管 end_at」這個論證能夠成立的前提——未來若有人覺得本檢查冗餘而移除，
-- 必須同時重新檢視 0013 的這個假設是否還成立，不可單獨移除本檢查。
--
-- **時區前提**：Asia/Taipei 自 1979 年起無日光節約時間，當地時刻與 timestamptz 一對一
-- 對應，是下方 at time zone 來回轉換寫法安全無歧義的前提；若未來需支援有 DST 的時區，
-- 需重新檢視這個寫法。
--
-- **close_time = '24:00' 的預期行為**：time 型別允許 '24:00'，business_hours_valid_range
-- 不禁止，此時 v_day_end 會落在隔日 00:00，這是預期行為，不是 bug。
--
-- **fail-closed 設計**：查無該 weekday 的 business_hours 設定列時一律拒絕，不是放行。
-- 已確認的主要觸發原因是「該 weekday 列被誤刪或 upsert 部分失敗」——0002_booking_
-- flow.sql:37-43 的 admin policy 是 for all（含 DELETE），設計師身分本來就能刪除某個
-- weekday 的列，與 RLS 完全無關、且已確認可真實發生。`force row level security`
-- 誤啟用只列為次要、**未經查證**的理論前提（Supabase 的 postgres 角色通常具有
-- BYPASSRLS，若本函式擁有者是 postgres，force RLS 對本函式可能根本不生效），不作為
-- 主要敘事。查無列時額外寫一行 raise log（僅進 Postgres log、不外洩給 client、不含
-- 顧客個資）——這個分支觸發時對顧客與 get_available_slots 都是全面靜默拒絕，沒有這行
-- 事後完全無法區分「設定列意外消失」與「單純今天公休」。
--
-- 公休日／營業時間檢查刻意放在服務驗證「之後」（沿用 0013 既有順序）：若 p_service_id
-- 本身無效或服務已停用，應該回報 SERVICE_INACTIVE（既有行為），不該被本檢查搶先攔截。
-- 放在 0013 既有 closed_dates 檢查之後，因此「同時違反 closed_dates 與 business_hours」
-- 的請求仍由 closed_dates 檢查優先攔下（既有行為不變）。
--
-- 部署順序防呆比照 0013／0004 的既有寫法：create or replace 前先確認 business_hours
-- 表存在。
-- 對應回滾腳本：0014_create_appointment_business_hours_down.sql（換回 0013 版本，不含
-- business_hours 檢查；比照既有慣例用 create or replace 換回舊版本，不用 drop
-- function，避免顧客端建立預約的唯一寫入路徑出現空窗；回滾即恢復非營業時段可被繞過
-- 寫入的狀態，屬有意識接受的風險；不可跨級回滾，回滾前務必先核對正式環境目前實際跑的
-- 是哪一版）。
-- 可重複執行（idempotent）：create or replace function。
--
-- 另新增 revoke truncate on business_hours from anon, authenticated：比照
-- 0008_booking_policy.sql:50-53 的既有縱深防禦寫法，本檔案讓 business_hours 從「只影響
-- get_available_slots 顯示」升級為 create_appointment 寫入路徑依賴，補這行的理由比
-- booking_policy 當初更充分。

begin;

do $$
begin
  if to_regclass('public.business_hours') is null then
    raise exception '0014_create_appointment_business_hours.sql 依賴 0002_booking_flow.sql 建立的 business_hours 表，請先套用 0002 再套用本檔案';
  end if;
  if to_regclass('public.closed_dates') is null then
    raise exception '0014_create_appointment_business_hours.sql 承接自 0013 的函式本體依賴 closed_dates 表，請先套用 0003 再套用本檔案';
  end if;
  if to_regclass('public.booking_policy') is null then
    raise exception '0014_create_appointment_business_hours.sql 承接自 0013 的函式本體依賴 booking_policy 表，請先套用 0008 再套用本檔案';
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

revoke execute on function public.create_appointment(uuid, timestamptz, text, text, text) from public;
grant execute on function public.create_appointment(uuid, timestamptz, text, text, text) to anon;

revoke truncate on public.business_hours from anon, authenticated;

commit;
