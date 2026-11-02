-- TASK-120（Demo 體驗帳戶：Email／電話寄信上限改為「建立時間」滾動視窗，TASK-114 審查 R1）
-- 以 create or replace 改寫 public.create_appointment(uuid, timestamptz, text, text, text, uuid)：在既有兩道
-- BOOKING_LIMIT 檢查（電話、Email；只計「未來的 pending／confirmed」）**之後各加一道**「過去 24 小時內建立的預約，
-- 不分狀態，≥ 3 筆即拒絕」。**其餘本文與 0018 逐字相同**（tests/lib/booking-limit-migration.test.ts 以逐字比對把關）。
--
-- 為什麼要做：create_appointment 開放給匿名使用者，確認信（0011，D13 刻意保留）每建立一筆就寄一封。原本的上限只計
-- 未來的 pending／confirmed，Demo 帳號（管理員）可把預約改成 cancelled（TASK-114 之後不寄信）釋放額度，攻擊者再用同一個
-- 受害者 Email 重新預約，確認信每輪都會寄出——等於借店家已驗證的寄件網域對任意 Email 無限次寄信，且姓名、店名、服務名、
-- 設計師名皆可控。0026 之前同一迴圈就存在，TASK-114 沒有引入也沒有關閉它。
--
-- 使用者決定（2026-11-01）：修法 A'，N = 3。為什麼不是任務卡原方案 A（把原計數「取代」成 24 小時建立數）：取代會放寬
-- 既有限制——同一個人可以每天訂 3 筆、累積任意多筆未來預約。所以**兩道並存、取其嚴**：
--   1. 原本的檢查（未來待服務 ≥ 3）逐字保留，不動。
--   2. 新增：created_at > now() - interval '24 hours'、不分狀態 ≥ 3。取消不再釋放額度。
-- 電話與 Email 兩個計數同步處理。超過上限仍回既有 BOOKING_LIMIT_EXCEEDED 與同一句 message，不新增錯誤碼、
-- 不洩漏是哪一道檢查擋下。
--
-- 對真實顧客的影響（已與使用者確認接受）：
--   * 24 小時內「訂了又取消再訂」超過 3 次的顧客會被擋（Email 與電話各自計算）。
--   * 目前沒有後台新增預約的路徑（authenticated 對 appointments 只有欄位層級的 select 與
--     update(status, start_at, end_at, reminder_sent_at)，見 0015；後台改期是 UPDATE，不新增列，不計入額度）。
--     日後若新增後台建立預約，那些列也會計入該電話與 Email 的額度。
--   * 不影響：視窗外的建立、未填 Email 的預約（不受 Email 檢查）、不同電話與 Email 的顧客、已存在預約的任何操作。
--
-- 為什麼 Demo 繞不過新視窗：Demo 是 authenticated 角色，對 appointments 不能 insert、不能 delete，也不能 update created_at
-- 與 customer_email（0015 的欄位層級授權）；所以不能靠刪除預約或改建立時間／Email 來釋放額度。
--
-- 不動的東西：
--   * 既有 advisory lock 與檢查順序（先電話、後 Email）；新增的兩道各自緊接在對應的既有檢查之後，鎖已先取得。
--   * 確認信觸發器與 notify_appointment_insert（0011）、webhook route、Demo 守門（0026）。
--   * 函式簽名、授權（revoke／grant 與 0018 逐字相同）、其餘所有驗證與 insert 迴圈。
--   * 資料表、索引、其他 migration。**新增的計數沒有索引、也沒有範圍條件**：電話那道掃全表，Email 那道還要對每一列
--     呼叫 _email_dedupe_key（既有計數有 start_at > now()，可用 start_at 索引限縮範圍，所以並不「同一取捨」）。目前資料量
--     （Demo 每日還原後只有數百筆；正式資料為個位數到數百筆）沒有實際問題；若 appointments 成長到約 5 萬列、
--     或 create_appointment 的回應時間明顯變慢，請補 create index appointments_created_at_idx on public.appointments (created_at)
--     （一個索引即可把兩道新計數限縮到最近 24 小時的列），並同步放寬 tests/lib/booking-limit-migration.test.ts 對 create index 的禁止。
--   * 重用既有變數 v_pending_count、v_email_count（不增加 declare）。
--
-- 已知殘留：
--   * 換「受害者 Email」與電話，總量仍沒有上限（0018 已記錄，這只是縱深防禦，不能取代限流）。
--   * **保證範圍只到「dedupe key 相同」，不到「信箱相同」**：_email_dedupe_key 只處理大小寫、+標籤、網域結尾的點與 Gmail 的點號；
--     供應商的多網域別名（Proton、iCloud 等）、次網域定址、自訂網域 catch-all、IDN 的兩種寫法仍是不同的 key、卻進同一個收件匣，
--     對這類信箱，速率是「3 × 別名數 / 24 小時」，等同沒有上限。
--   * create_appointment 以公開的 anon key 就能直接打 PostgREST，Next.js／Vercel 層的 IP 限流管不到它。
--   * 根本解法是全店層級的寄信預算（例如確認信每小時最多 M 封，超過只建預約、不寄信並告警），屬於任務卡原方案 B 的範圍，需另開卡。
--   * 電話額度的 DoS：任何人都能用別人的電話建立 3 筆預約（不必填 Email、不寄信）鎖住該電話。0030 之前店長把那 3 筆改成
--     cancelled 就能立刻解除；0030 之後取消不再釋放額度，只能等 24 小時（或 service_role 手動刪除／調整 created_at）。
--     前台文案「太多筆待確認的預約」對這種情況不準確。使用者需在套用前決定是否接受（見 verification/TASK-120.md）。
-- Demo 每日還原（0027）會 delete from public.appointments where true，把整張表（含 24 小時內的所有預約）清空再還原 seed，
-- 所以每次還原都會讓視窗歸零：同一個受害者 Email 在還原前後最多各約 3 封確認信，這是還原機制的副作用，不是本卡能處理的範圍。
-- 還原寫回的 seed 預約電話帶連字號、Email 為 null，與前台正規化後的電話／Email 不會相符，不影響前台預約。
--
-- 套用順序：只依賴 0018（create_appointment 六參數版本與 _email_dedupe_key）；與應用程式部署順序無關
-- （函式簽名、回傳格式與錯誤碼都沒變）。可重複執行（idempotent）。回滾：0030_booking_limit_rolling_window_down.sql
-- （把函式還原成 0018 本文）。請在 SQL Editor 整份執行（不要只選取一部分，否則不在 begin 交易內、失敗時無法整份回滾）。
--
-- 套用後的驗證：
--   1. npm run test:booking-limit（對真實專案；Email 案例的收件人是 Resend 官方測試位址 delivered+...@resend.dev）。
--   2. select prosrc like '%interval ''24 hours''%' as has_window from pg_proc
--        where oid = 'public.create_appointment(uuid, timestamptz, text, text, text, uuid)'::regprocedure;   -- 預期 true
--   3. 沒有舊簽名多載：select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'create_appointment';   -- 預期 1
--   4. 授權（三個角色都要 true，且 PUBLIC 沒有）：
--        select r as role, has_function_privilege(r, 'public.create_appointment(uuid, timestamptz, text, text, text, uuid)', 'execute') as can_execute
--        from unnest(array['anon', 'authenticated', 'service_role']) as r;   -- 預期三列皆 true
--        select proacl::text from pg_proc where oid = 'public.create_appointment(uuid, timestamptz, text, text, text, uuid)'::regprocedure;   -- 預期不含「=X/」開頭的 PUBLIC 項
--   5. 套用前後函式本文指紋：套用前先記 select md5(prosrc) from pg_proc where oid = 'public.create_appointment(uuid, timestamptz, text, text, text, uuid)'::regprocedure;
--      這同時驗證線上現況就是 0018 本文（沒有被手改過）；套用 _down 之後這個值必須與套用前相同。

begin;

-- 依賴檢查：缺少前置物件時直接中止，不留下半套。
do $$
begin
  if to_regprocedure('public.create_appointment(uuid, timestamptz, text, text, text, uuid)') is null then
    raise exception '0030 需要 public.create_appointment(uuid, timestamptz, text, text, text, uuid)（0018 尚未套用）';
  end if;
  if to_regprocedure('public._email_dedupe_key(text)') is null then
    raise exception '0030 需要 public._email_dedupe_key(text)（0018 尚未套用）';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'appointments' and column_name = 'created_at'
  ) then
    raise exception '0030 需要 public.appointments.created_at';
  end if;
end
$$;

-- ============================================================
-- create_appointment（本文與 0018 逐字相同，只多兩道滾動視窗檢查，標記為「TASK-120 滾動視窗」）
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

  -- TASK-120 滾動視窗：同號碼「過去 24 小時內建立」的預約數上限，不分狀態（含 cancelled）。上面那道檢查只計未來的
  -- pending／confirmed，把預約改成 cancelled 就釋放額度；這道檢查以建立時間計數，取消不會釋放。兩道並存、取其嚴。
  -- 重用 v_pending_count（上面那道檢查已通過，這裡重新賦值）。
  select count(*) into v_pending_count
  from public.appointments
  where customer_phone = v_phone_digits
    and created_at > now() - interval '24 hours';

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

    -- TASK-120 滾動視窗（Email）：同 Email（_email_dedupe_key 正規化後）「過去 24 小時內建立」的預約數上限，不分狀態。
    -- 堵住「建立 3 筆 → 改成 cancelled 釋放額度 → 同一個受害者 Email 再建立」造成確認信（0011）無限次寄出。
    select count(*) into v_email_count
    from public.appointments
    where public._email_dedupe_key(customer_email) = v_email_key
      and created_at > now() - interval '24 hours';

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
