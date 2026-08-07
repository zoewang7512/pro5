-- 回滾 0004_slots_closures_buffer.sql
-- 選擇：create or replace 還原成 0002_booking_flow.sql 的原始定義（而非 drop function），
-- 因為 get_available_slots 是 anon 唯一可呼叫的可預約時段來源，drop 掉會讓顧客端整段
-- 空窗到下一次 forward migration 重建為止；create or replace 可以無縫換回舊版本，
-- 行為等同本卡从未套用（回到不感知 closed_dates／buffer_minutes 的版本）。

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

commit;
