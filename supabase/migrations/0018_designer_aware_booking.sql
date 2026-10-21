-- TASK-068（多位設計師 依設計師計算時段與建立預約）
-- 讓 get_available_slots／create_appointment 改成依設計師計算，並把防雙重預約的資料庫約束從「全店
-- 不可重疊」改成「同一位設計師不可重疊」。依 TASK-067 任務卡「架構筆記 E」與動工前 architect／
-- security-reviewer 審查意見實作；本檔案前提是 0017_designers.sql 已套用。
--
-- **這份 migration 一次做的事**（順序有意義，全部在同一個交易內）：
--   1. lock table appointments（access exclusive，並設 lock_timeout 5 秒）→ 補回填 designer_id 的 null →
--      set not null。鎖表是為了避免「回填」與「set not null」之間，舊版 create_appointment（0017 之後仍照舊
--      寫入 designer_id = null）又寫進新的 null 列，導致 set not null 失敗而整支 migration 回滾。
--      **一開始就取 access exclusive，不先取較弱的鎖再升級**：舊版 RPC 的交易先讀 appointments（access share）
--      再 insert（row exclusive），若 migration 先取 share row exclusive 再升級，會和它互相等待而死結（architect／
--      security-reviewer 套用前審查）。拿不到鎖（5 秒逾時）時整份回滾、什麼都不會改，換個時間重跑即可。
--      套用瞬間進行中的舊版 create_appointment 若在拿到鎖之後才 insert，designer_id 是 null 會違反 not null，
--      該筆預約回 INTERNAL_ERROR（顧客重試即可）；請選離峰時段套用。
--   2. 換 exclusion constraint：appointments_no_overlap 改成 (designer_id =, 時段 &&)，**名稱不變**
--      （RPC 外層 handler 比對名稱；後台改期只看 23P01，不用改）。需要 btree_gist（uuid 的 gist 等值運算）。
--   3. 建立兩支內部判斷函式 _designer_is_eligible／_designer_is_free，由兩支 RPC 共用，避免兩條路徑漂移。
--   4. drop 舊簽名、create 新簽名的 get_available_slots／create_appointment（新增 p_designer_id uuid
--      default null）。新參數有預設值，所以舊版前端（不傳這個參數）在本 migration 套用之後、新前端部署
--      之前仍可正常預約，等同「不指定設計師」（部署順序相容）。
--   5. 明寫 execute 權限：revoke from public, anon, authenticated，再 grant 給 anon, authenticated。
--      本專案 public schema 有 default privileges，drop 再 create 之後授權會被重設；店長在同一個瀏覽器
--      登入後台再開前台時，會以 authenticated 身分呼叫這兩支 RPC。套用前實測（2026-10-21）兩支 RPC 對
--      anon／authenticated／service_role 都可呼叫，本檔案套用後必須維持一致。
--
-- **get_available_slots 的語意**：
--   - 指定設計師：該設計師「合格」（啟用中、有開該服務、當天沒請假）而且該時段空閒（含雙方 buffer）才列出。
--     不合格時回傳空陣列——「不存在、停用、沒開服務、請假、滿檔」在單次回應中看起來完全一樣。
--   - 不指定：至少一位合格設計師在該時段空閒就列出。
--   - 回傳格式不變，**不含任何設計師識別資訊**。已知殘留（已人工接受）：設計師 id 是公開的，可以對每位
--     設計師 × 90 天呼叫「指定」模式逐一推算各自的忙碌時段與疑似請假日；get_available_slots 沒有限流（既有）。
--   - 其餘規則（公休日、固定營業時間、提前量、90 天視野、30 分鐘格點）完全不變。
--
-- **create_appointment 的檢查順序**（architect／security-reviewer 審查定案）：
--   欄位驗證 → 有限值防護 → 服務 → 公休日 → 營業時間 → 提前量／視野 → 設計師候選清單（空則直接
--   SLOT_CONFLICT）→ BOOKING_LIMIT（以電話）→ BOOKING_LIMIT（以 email，新增）→ 顧客去重 → insert 迴圈。
--   - 設計師檢查放在提前量／視野「之後」：用 90 天外的時間呼叫時，合格與不合格設計師都回
--     VALIDATION_ERROR，不能拿來探測設計師狀態；候選清單為空也在碰 customers 之前回傳，大部分拒絕不寫入。
--   - 指定設計師＝只有一位候選人的清單，和「不指定」共用同一個 insert 迴圈，兩條路徑不會漂移。
--     指定的設計師「不存在、停用、沒開服務、請假、時段被佔」回傳的 JSON 完全相同（含 message）。
--   - 候選清單**同時檢查 buffer**（人工 2026-10-21 決定，選項 a）：只接受「合格且 _designer_is_free」的
--     設計師。這是對 decisions.md TASK-022「緩衝只是排程偏好」的有意收緊：繞過前端、擠進既有預約 buffer 的
--     直接 API 請求會從成功變成 SLOT_CONFLICT；前台顧客本來就看不到這些時段，不受影響。
--   - 不指定的排序：(當天 Asia/Taipei 有效預約數, sort_order, id)。每位候選人在巢狀
--     begin ... exception when exclusion_violation 內 insert，衝突就換下一位；全部失敗時 raise
--     exclusion_violation（constraint = appointments_no_overlap），交給既有外層 handler 轉成 SLOT_CONFLICT，
--     並回滾整個區塊（含顧客去重時新建的 customers 列，不留孤兒列）。
--   - BOOKING_LIMIT 維持**全店、以電話計算**，不改成每位設計師各自計算（多位設計師會讓可佔用的總容量變成
--     N 倍）。新增**以 email 計算**的同等上限（人工 2026-10-21 決定併入本卡，取代延後的 TASK-080 限流）：
--     同一個 email 已有 3 筆未過期的 pending／confirmed 預約就拒絕，擋下「用別人 email 大量預約、借本站網域
--     寄確認信」的濫用；全店合計、不分設計師；未填 email 不受限。沿用既有錯誤碼 BOOKING_LIMIT_EXCEEDED 與前台
--     文案，不新增錯誤碼。比對用 _email_dedupe_key 正規化後的值（security-reviewer 套用前審查）：去頭尾空白、
--     不分大小寫、去掉 `+標籤`、去掉網域結尾的點、gmail.com／googlemail.com 另外去掉本地部分的點。計數前先取
--     交易層級 advisory lock（先電話、後 email，順序固定避免死結），否則同時送出的請求都會看到 count < 3 而
--     全部通過。**這只是縱深防禦，不能取代限流**：換受害者 email、換電話，總量仍沒有上限；國際化網域等其他
--     同形寫法也擋不住。已知殘留：BOOKING_LIMIT 檢查在候選清單之後，所以已達上限的電話去約一個被佔的時段會
--     得到 SLOT_CONFLICT 而不是 BOOKING_LIMIT_EXCEEDED（與 0014 不同，是架構筆記 E 定案的檢查順序）。
--
-- **已知殘留（既有，非本 Epic 引入）**：exclusion constraint 不含 buffer，併發時兩筆相鄰預約仍可能吃掉
-- 緩衝時間（buffer 只在 RPC 的候選清單與 get_available_slots 檢查）；第 90 天晚於「現在時刻」的時段會被
-- get_available_slots 列出、create_appointment 卻以 90 天上限拒絕（0009／0014 起就如此）。
-- **已知殘留（本卡）**：候選清單算完之後、insert 之前，店長剛好停用設計師或新增請假，預約仍可能成立
-- （exclusion constraint 只管時段重疊）；兩支 RPC 沒有限流，指定模式可逐一推算各設計師的忙碌時段，
-- 回應時間與 BOOKING_LIMIT 的回應也能當成「不留痕跡」的探測管道，資訊量與人工已接受的殘留同一類。
-- **併發改派**：兩筆同時 insert 同一位設計師的重疊時段時，exclusion 檢查可能互相等待而死結，被選為犧牲者的
-- 一方拿到 deadlock_detected（不是 exclusion_violation）；巢狀 handler 兩者都接，視同這位候選人被訂走。
-- **0018 之後不要重跑 0009／0014**：舊簽名會和新簽名並存，舊前端只傳 5（或 2）個參數時兩個簽名都符合，
-- PostgREST 會回 PGRST203。
-- **部署順序**：先套用本 migration，再合併 master／部署新前端（新前端的 lib/booking/api.ts 一定會送出
-- p_designer_id，在本 migration 套用前部署會讓預約整個中斷）。套用本 migration 到合併 master 之間，舊後台
-- 新增的服務不會對任何設計師開啟（createService 不寫 designer_services），前台沒有時段、直接呼叫會 SLOT_CONFLICT，
-- 期間請不要在後台新增服務，或盡量把套用時間排在接近合併的時候。
--
-- **回滾順序（重要）**：先在 Vercel 回滾前端 → 再執行 0018_down → 最後才是 0017_down。順序反過來，新前端帶
-- p_designer_id 的呼叫會找不到函式（PGRST202），整個預約功能中斷。0018_down 還原全店 exclusion constraint；
-- 只要已經有不同設計師在同一時段的預約，還原就會失敗，必須先人工處理。
--
-- 可重複執行（idempotent）：create or replace／drop ... if exists／if not exists。重跑只會補回填 null、
-- 重建 constraint 與函式，不會改動任何預約的設計師。0018 套用後不要再重跑 0017（見 0017 檔頭）。
-- 對應回滾腳本：0018_designer_aware_booking_down.sql

begin;

do $$
begin
  if to_regclass('public.designers') is null
     or to_regclass('public.designer_services') is null
     or to_regclass('public.designer_leaves') is null then
    raise exception '0018 需要先套用 0017_designers.sql（找不到 designers／designer_services／designer_leaves）';
  end if;
  if to_regclass('public.business_hours') is null
     or to_regclass('public.closed_dates') is null
     or to_regclass('public.booking_policy') is null then
    raise exception '0018 承接自 0009／0014 的函式本體依賴 business_hours／closed_dates／booking_policy，請先套用 0002～0009';
  end if;
  -- 套用後預約依設計師計算：上架中卻沒有任何啟用中設計師開啟的服務，會立刻變成沒有時段、無法預約。
  -- 寧可讓 migration 在這裡失敗，也不要套用之後才發現（security-reviewer 套用前審查）。
  if exists (
    select 1
    from public.services s
    where s.is_active
      and not exists (
        select 1
        from public.designer_services ds
        join public.designers d on d.id = ds.designer_id
        where ds.service_id = s.id and d.is_active
      )
  ) then
    raise exception '0018：有上架中的服務沒有任何啟用中的設計師開啟，套用後將無法預約，請先在後台設計師頁處理';
  end if;
end $$;

-- uuid 的 gist 等值運算（exclusion constraint 的第一個欄位 designer_id with =）需要 btree_gist。
create extension if not exists btree_gist with schema extensions;

-- ============================================================
-- 1. 補回填 designer_id 的 null，再改成 not null
-- ============================================================
set local lock_timeout = '5s';
lock table public.appointments in access exclusive mode;

do $$
declare
  v_default_id uuid;
begin
  -- 「預設設計師」的辨識方式與 0017 相同：order by created_at, id limit 1。
  select d.id into v_default_id from public.designers d order by d.created_at, d.id limit 1;
  if v_default_id is null then
    raise exception '0018 找不到任何設計師（0017 應該已建立預設設計師）';
  end if;

  -- 0017 套用之後、本檔案套用之前，舊版 create_appointment 寫入的預約 designer_id 是 null，在這裡補上。
  update public.appointments set designer_id = v_default_id where designer_id is null;
end $$;

alter table public.appointments alter column designer_id set not null;

-- ============================================================
-- 2. exclusion constraint：同一位設計師的有效預約時段不可重疊
-- ============================================================
-- 不同設計師的同一時段可以同時存在。排除 cancelled：取消的預約不應永久佔用時段。名稱維持
-- appointments_no_overlap（RPC 外層 handler 與後台都依賴它）。
alter table public.appointments drop constraint if exists appointments_no_overlap;
alter table public.appointments
  add constraint appointments_no_overlap
  exclude using gist (
    designer_id with =,
    tstzrange(start_at, end_at, '[)') with &&
  )
  where (status in ('pending', 'confirmed', 'completed'));

-- ============================================================
-- 3. 內部判斷函式（兩支 RPC 共用）
-- ============================================================
-- 宣告 stable、set search_path = ''、所有物件寫完整 schema 名稱。由 SECURITY DEFINER 的 RPC 呼叫，以函式
-- 擁有者身分執行；revoke 之後 anon／authenticated 不能直接呼叫（42501）。

-- 合格：設計師啟用中、有開該服務、該日（Asia/Taipei 日期）沒請假。
create or replace function public._designer_is_eligible(p_designer_id uuid, p_service_id uuid, p_date date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.designers d
    join public.designer_services ds on ds.designer_id = d.id and ds.service_id = p_service_id
    where d.id = p_designer_id
      and d.is_active
      and not exists (
        select 1 from public.designer_leaves l where l.designer_id = d.id and l.date = p_date
      )
  );
$$;

-- 空閒：該設計師沒有任何有效預約與候選時段重疊。候選時段與每筆既有預約各自延伸自己的 buffer_minutes 後
-- 再比較（比照 0009 get_available_slots 的既有寫法；buffer 為 0 時自動退化成原始邏輯）。a.start_at 的範圍
-- 限定（±1 天，buffer 上限 120 分鐘遠小於一天）讓 planner 能用 appointments 的 start_at 相關索引。
create or replace function public._designer_is_free(
  p_designer_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_buffer_minutes int
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select not exists (
    select 1
    from public.appointments a
    join public.services s2 on s2.id = a.service_id
    where a.designer_id = p_designer_id
      and a.status in ('pending', 'confirmed', 'completed')
      and a.start_at >= p_start_at - interval '1 day'
      and a.start_at < p_end_at + interval '1 day'
      and tstzrange(a.start_at, a.end_at + make_interval(mins => s2.buffer_minutes), '[)')
          && tstzrange(p_start_at, p_end_at + make_interval(mins => p_buffer_minutes), '[)')
  );
$$;

-- email 上限用的正規化 key：去頭尾空白、不分大小寫、去掉 `+標籤`、去掉網域結尾的點；gmail.com／googlemail.com
-- 視為同一個網域並去掉本地部分的點（Gmail 忽略點號）。去掉 `+標籤` 後本地部分若變成空字串就保留原樣，
-- 避免所有 `+xxx@網域` 被併成同一個 key。只用於計數比對，不改寫儲存的 customer_email。
create or replace function public._email_dedupe_key(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_email is null then null
    else (
      select
        case
          when t.dom in ('gmail.com', 'googlemail.com')
            then replace(t.stripped, '.', '') || '@gmail.com'
          else t.stripped || '@' || t.dom
        end
      from (
        select
          coalesce(nullif(split_part(u.local_part, '+', 1), ''), u.local_part) as stripped,
          u.dom
        from (
          select
            lower(btrim(split_part(btrim(p_email), '@', 1))) as local_part,
            regexp_replace(lower(btrim(split_part(btrim(p_email), '@', 2))), '\.+$', '') as dom
        ) u
      ) t
    )
  end;
$$;

revoke execute on function public._email_dedupe_key(text) from public, anon, authenticated;
revoke execute on function public._designer_is_eligible(uuid, uuid, date) from public, anon, authenticated;
revoke execute on function public._designer_is_free(uuid, timestamptz, timestamptz, int) from public, anon, authenticated;

-- ============================================================
-- 4. get_available_slots（新簽名：加 p_designer_id）
-- ============================================================
-- drop 舊簽名與 create 新簽名在同一個交易內完成，顧客端不會有函式不存在的空窗。
drop function if exists public.get_available_slots(uuid, date);

create or replace function public.get_available_slots(
  p_service_id uuid,
  p_date date,
  p_designer_id uuid default null
)
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
  v_designer_ids uuid[];
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
  -- 全店公休與每週固定公休對所有設計師都生效，和設計師個人請假是疊加關係。
  if exists (select 1 from public.closed_dates where closed_dates.date = p_date) then
    return jsonb_build_object('ok', true, 'data', '[]'::jsonb);
  end if;

  v_weekday := extract(dow from p_date);

  select open_time, close_time, is_closed into v_open, v_close, v_is_closed
  from public.business_hours where weekday = v_weekday;

  if v_open is null or v_close is null or coalesce(v_is_closed, true) then
    return jsonb_build_object('ok', true, 'data', '[]'::jsonb);
  end if;

  -- 候選設計師：指定時只有那一位（必須合格），不指定時是全部合格的設計師。清單為空直接回空陣列。
  select coalesce(array_agg(d.id order by d.sort_order, d.id), '{}'::uuid[]) into v_designer_ids
  from public.designers d
  where d.is_active
    and (p_designer_id is null or d.id = p_designer_id)
    and public._designer_is_eligible(d.id, p_service_id, p_date);

  if cardinality(v_designer_ids) = 0 then
    return jsonb_build_object('ok', true, 'data', '[]'::jsonb);
  end if;

  v_day_start := (p_date + v_open) at time zone 'Asia/Taipei';
  v_day_end := (p_date + v_close) at time zone 'Asia/Taipei';
  v_slot_start := v_day_start;

  while v_slot_start + make_interval(mins => v_duration_minutes) <= v_day_end loop
    v_slot_end := v_slot_start + make_interval(mins => v_duration_minutes);

    -- 至少一位候選設計師在這個時段空閒（含雙方 buffer）才列出。
    if v_slot_start > now() + make_interval(hours => v_min_lead_hours)
       and exists (
         select 1
         from unnest(v_designer_ids) as c(designer_id)
         where public._designer_is_free(c.designer_id, v_slot_start, v_slot_end, v_buffer_minutes)
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
    raise log 'get_available_slots failed: sqlstate=%', sqlstate;
    return jsonb_build_object('ok', false, 'error_code', 'INTERNAL_ERROR', 'message', 'unexpected error');
end;
$$;

revoke execute on function public.get_available_slots(uuid, date, uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_available_slots(uuid, date, uuid) to anon, authenticated, service_role;

-- ============================================================
-- 5. create_appointment（新簽名：加 p_designer_id）
-- ============================================================
drop function if exists public.create_appointment(uuid, timestamptz, text, text, text);

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
