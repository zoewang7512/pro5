-- 回滾 0002_booking_flow.sql
-- 警告：不會恢復 0001 的舊 anon INSERT policy（該撤銷是刻意的安全修正，不是本
-- migration 的副作用）；若要恢復顧客可預約流程之前的行為，需另外評估是否真的要
-- 重新開放 anon 直接 INSERT appointments。

begin;

drop function if exists public.create_appointment(uuid, timestamptz, text, text, text);
drop function if exists public.get_available_slots(uuid, date);

alter table public.appointments drop constraint if exists appointments_no_overlap;

drop table if exists public.business_hours cascade;

commit;
