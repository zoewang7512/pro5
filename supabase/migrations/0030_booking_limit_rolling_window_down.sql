-- 回滾 0030_booking_limit_rolling_window.sql：把 public.create_appointment(uuid, timestamptz, text, text, text, uuid)
-- 還原成 0018 的函式本文（逐字相同，沒有「過去 24 小時內建立」的滾動視窗檢查），授權與 0018 相同。
--
-- 回滾後的行為：取消（改成 cancelled）重新釋放同電話／同 Email 的額度，TASK-114 審查 R1 的靜默取消迴圈重新開啟
-- （已知風險，見 0030 檔頭）。不動資料，也不影響進行中的預約；函式簽名不變，前端不需要任何配合。
-- 可重複執行（idempotent）。請在 SQL Editor 整份執行。
-- 注意：本檔案無條件把函式換回 0018 本文。日後若有編號更大的 migration（例如 0031）重新定義了 create_appointment，
-- 不要直接執行本檔案，否則會蓋掉它的內容（tests/lib/booking-limit-migration.test.ts 的最後一個函式定義者檢查會提醒）。

begin;

do $$
begin
  if to_regprocedure('public.create_appointment(uuid, timestamptz, text, text, text, uuid)') is null then
    raise exception '0030_down 需要 public.create_appointment(uuid, timestamptz, text, text, text, uuid)（0018 尚未套用）';
  end if;
  if to_regprocedure('public._email_dedupe_key(text)') is null then
    raise exception '0030_down 需要 public._email_dedupe_key(text)（0018 尚未套用）';
  end if;
end
$$;

-- ============================================================
-- create_appointment：還原成 0018 本文
-- ============================================================
create or replace function public.create_appointment(
  p_service_id uuid,
  p_start_at timestamptz,
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text,
  p_designer_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_duration_minutes int;
  v_buffer_minutes int;
  v_is_active boolean;
  v_end_at timestamptz;
  v_customer_id uuid;
  v_pending_count int;
  v_email_count int;
  v_appointment_id uuid;
  v_service_name text;
  v_phone_digits text;
  v_email text;
  v_email_key text;
  v_constraint text;
  v_min_lead_hours int;
  v_weekday int;
  v_open time;
  v_close time;
  v_is_closed boolean;
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_local_date date;
  v_local_day_from timestamptz;
  v_local_day_to timestamptz;
  v_candidates uuid[];
  v_candidate uuid;
  v_assigned_id uuid;
  v_assigned_name text;
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

  -- p_start_at 有限值防護（TASK-062）：放在服務驗證之前，避免用 infinity 探測服務狀態。
  if p_start_at is null or not isfinite(p_start_at) then
    return jsonb_build_object('ok', false, 'error_code', 'VALIDATION_ERROR', 'message', 'invalid start_at');
  end if;

  -- 服務驗證
  select duration_minutes, buffer_minutes, is_active, name
  into v_duration_minutes, v_buffer_minutes, v_is_active, v_service_name
  from public.services where id = p_service_id;

  if v_duration_minutes is null or not v_is_active then
    return jsonb_build_object('ok', false, 'error_code', 'SERVICE_INACTIVE', 'message', 'service not available');
  end if;

  v_local_date := (p_start_at at time zone 'Asia/Taipei')::date;

  -- 公休日檢查（TASK-028）：整天公休是硬規則，在寫入路徑本身擋下，不能只靠 get_available_slots 不顯示時段。
  if exists (select 1 from public.closed_dates where closed_dates.date = v_local_date) then
    return jsonb_build_object('ok', false, 'error_code', 'SLOT_CONFLICT', 'message', 'slot already booked');
  end if;

  v_end_at := p_start_at + make_interval(mins => v_duration_minutes);

  -- 營業時間檢查（TASK-062）：整天公休、或時段（含服務時長）落在 open_time～close_time 之外，皆拒絕。
  -- 用 timestamptz 區間比較，不是 ::time——::time 比較在服務時段跨越台北時間午夜時會回捲失效（見 0014 檔頭
  -- 「跨午夜漏洞與修正經過」，請勿改回較簡短的寫法）。
  v_weekday := extract(dow from (p_start_at at time zone 'Asia/Taipei'));

  select open_time, close_time, is_closed into v_open, v_close, v_is_closed
  from public.business_hours where weekday = v_weekday;

  if v_is_closed is null then
    raise log 'create_appointment: business_hours missing row for weekday %', v_weekday;
  end if;

  -- 查無列／整天公休／open_time、close_time 為 null → 一律拒絕（fail-closed）。
  if v_open is null or v_close is null or coalesce(v_is_closed, true) then
    return jsonb_build_object('ok', false, 'error_code', 'SLOT_CONFLICT', 'message', 'slot already booked');
  end if;

  v_day_start := (v_local_date + v_open) at time zone 'Asia/Taipei';
  v_day_end := (v_local_date + v_close) at time zone 'Asia/Taipei';

  if p_start_at < v_day_start or v_end_at > v_day_end then
    return jsonb_build_object('ok', false, 'error_code', 'SLOT_CONFLICT', 'message', 'slot already booked');
  end if;

  select min_lead_time_hours into v_min_lead_hours from public.booking_policy where id = 1;
  v_min_lead_hours := coalesce(v_min_lead_hours, 1);

  -- 提前量與視野上限（提前量讀取 booking_policy 設定值，視野上限維持寫死 90 天不變）
  if p_start_at < now() + make_interval(hours => v_min_lead_hours) or p_start_at > now() + interval '90 days' then
    return jsonb_build_object('ok', false, 'error_code', 'VALIDATION_ERROR', 'message', 'start_at out of allowed range');
  end if;

  -- 設計師候選清單：啟用中、有開該服務、當天沒請假，而且這個時段空閒（含雙方 buffer）。指定設計師時最多
  -- 只有那一位；不指定時依 (當天有效預約數, sort_order, id) 排序。「當天」是 Asia/Taipei 的日曆日，
  -- 用 timestamptz 區間而不是對 start_at 做日期轉換，才用得上索引。
  -- 清單為空直接回 SLOT_CONFLICT，**不論原因**（設計師不存在、停用、沒開服務、請假、時段被佔）回傳的
  -- JSON 完全相同，不能拿來探測設計師狀態；而且還沒碰 customers，大部分拒絕都不會寫入任何資料。
  v_local_day_from := v_local_date::timestamp at time zone 'Asia/Taipei';
  v_local_day_to := (v_local_date + 1)::timestamp at time zone 'Asia/Taipei';

  select coalesce(array_agg(c.id order by c.booked_today, c.sort_order, c.id), '{}'::uuid[])
  into v_candidates
  from (
    select
      d.id,
      d.sort_order,
      (
        select count(*)
        from public.appointments a
        where a.designer_id = d.id
          and a.status in ('pending', 'confirmed')
          and a.start_at >= v_local_day_from
          and a.start_at < v_local_day_to
      ) as booked_today
    from public.designers d
    where d.is_active
      and (p_designer_id is null or d.id = p_designer_id)
      and public._designer_is_eligible(d.id, p_service_id, v_local_date)
      and public._designer_is_free(d.id, p_start_at, v_end_at, v_buffer_minutes)
  ) c;

  if cardinality(v_candidates) = 0 then
    return jsonb_build_object('ok', false, 'error_code', 'SLOT_CONFLICT', 'message', 'slot already booked');
  end if;

  -- 計數前先取交易層級 advisory lock：沒有鎖的話，同一支電話或同一個 email 同時送出的請求都會看到 count < 3
  -- 而全部通過。順序固定是先電話、後 email，避免兩個請求交叉取鎖而死結。鎖在交易結束（commit／回滾）時
  -- 自動釋放；只會讓「同一支電話／同一個 email」的請求排隊，不影響其他顧客。
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('create_appointment:phone:' || v_phone_digits, 0));
  if v_email is not null then
    v_email_key := public._email_dedupe_key(v_email);
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('create_appointment:email:' || v_email_key, 0));
  end if;

  -- 基本防灌爆：同號碼未過期的 pending/confirmed 預約數上限（全店合計、不分設計師）
  select count(*) into v_pending_count
  from public.appointments
  where customer_phone = v_phone_digits
    and status in ('pending', 'confirmed')
    and start_at > now();

  if v_pending_count >= 3 then
    return jsonb_build_object('ok', false, 'error_code', 'BOOKING_LIMIT_EXCEEDED', 'message', 'too many pending appointments');
  end if;

  -- 同 email 的未過期 pending/confirmed 預約數上限（全店合計、不分設計師；未填 email 不受限）。擋下
  -- 「用別人 email 大量預約、借本站網域寄確認信」的濫用。比對用 _email_dedupe_key 正規化後的值（見檔頭）。
  -- 計數條件用不到索引（資料量小時是全表掃描，可接受）；資料量成長後再補運算式索引。
  if v_email is not null then
    select count(*) into v_email_count
    from public.appointments
    where public._email_dedupe_key(customer_email) = v_email_key
      and status in ('pending', 'confirmed')
      and start_at > now();

    if v_email_count >= 3 then
      return jsonb_build_object('ok', false, 'error_code', 'BOOKING_LIMIT_EXCEEDED', 'message', 'too many pending appointments');
    end if;
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

  -- insert 迴圈：依候選順序逐一嘗試。每位候選人在巢狀區塊內 insert，被 exclusion constraint 擋下（併發時
  -- 第一順位剛好被別人訂走）就回滾這個巢狀區塊、換下一位。其他任何錯誤原樣往外丟，交給外層 handler。
  foreach v_candidate in array v_candidates loop
    begin
      insert into public.appointments (
        service_id, customer_id, designer_id, customer_name, customer_phone, customer_email,
        start_at, end_at, status
      )
      values (
        p_service_id, v_customer_id, v_candidate, p_customer_name, v_phone_digits, v_email,
        p_start_at, v_end_at, 'pending'
      )
      returning id into v_appointment_id;

      v_assigned_id := v_candidate;
      exit;
    exception
      when exclusion_violation then
        get stacked diagnostics v_constraint = constraint_name;
        if v_constraint is distinct from 'appointments_no_overlap' then
          raise;
        end if;
        -- 這位候選人剛被訂走，換下一位。
      when deadlock_detected then
        -- 兩筆同時 insert 同一位設計師的重疊時段時，exclusion 檢查可能互相等待而死結，被選為犧牲者的一方
        -- 拿到 deadlock_detected 而不是 exclusion_violation。視同這位候選人剛被訂走，換下一位（全部失敗時
        -- 照常回 SLOT_CONFLICT）；不接的話會一路傳到外層被 when others 轉成 INTERNAL_ERROR。
        null;
    end;
  end loop;

  -- 全部候選人都失敗：以同一個 constraint 名稱往外丟，外層 handler 轉成 SLOT_CONFLICT，並回滾整個區塊
  -- （包含上面顧客去重新建的 customers 列，不留孤兒列）。
  if v_assigned_id is null then
    raise exception 'no designer available for the requested slot'
      using errcode = 'exclusion_violation', constraint = 'appointments_no_overlap';
  end if;

  select name into v_assigned_name from public.designers where id = v_assigned_id;

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'service_name', v_service_name,
      'start_at', p_start_at,
      'end_at', v_end_at,
      'customer_name', p_customer_name,
      'customer_phone', v_phone_digits,
      'designer_id', v_assigned_id,
      'designer_name', v_assigned_name
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
    raise log 'create_appointment failed: sqlstate=%', sqlstate;
    return jsonb_build_object('ok', false, 'error_code', 'INTERNAL_ERROR', 'message', 'unexpected error');
end;
$$;

revoke execute on function public.create_appointment(uuid, timestamptz, text, text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.create_appointment(uuid, timestamptz, text, text, text, uuid) to anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
