-- TASK-024（get_available_slots RPC 加入公休日／緩衝時間邏輯）
-- create or replace public.get_available_slots：在 0002_booking_flow.sql 的原始定義基礎上
-- 加入 (1) closed_dates 命中即回傳空陣列（優先於 business_hours 檢查）、(2) 緩衝時間感知的
-- 時段過濾（候選時段與既有預約各自扣掉所屬服務的 buffer_minutes 後仍不可重疊）。
-- 函式簽名（參數/回傳型別）不變，anon 的 grant execute 邊界不變，只換函式本體。
-- 本卡不修改 create_appointment RPC（顧客端建立預約只依賴 appointments_no_overlap
-- exclusion constraint，不需要感知緩衝時間／公休日，見 feature-spec 非目標——安全性審查
-- 對此有不同意見，見任務卡完成證據段落記錄的殘留風險，需另立任務卡決定）。
-- 依賴 0003_closures_and_buffer.sql 建立的 closed_dates 表／services.buffer_minutes 欄位；
-- plpgsql 函式體在 create or replace 當下不會解析內容，若 0003 尚未套用，本函式仍會建立
-- 成功但每次呼叫都會在執行期出錯（被 exception when others 吞成籠統 INTERNAL_ERROR，
-- 顧客端會看到整站沒有任何可預約時段、且無法從錯誤訊息看出根因）——本機沒有 Supabase
-- CLI／migration ledger，套用順序全靠人工貼 SQL Editor（見 ai/context/project-map.md），
-- 沒有自動化的順序保護，因此在此加一段部署期前置檢查，讓順序錯誤在套用當下就失敗，而不是
-- 延後到顧客端執行期才顯現。
-- 對應回滾腳本：0004_slots_closures_buffer_down.sql
-- 可重複執行（idempotent）：create or replace function。

begin;

do $$
begin
  if to_regclass('public.closed_dates') is null then
    raise exception '0004_slots_closures_buffer.sql 依賴 0003_closures_and_buffer.sql 建立的 closed_dates 表，請先套用 0003 再套用本檔案';
  end if;
end $$;

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

commit;
