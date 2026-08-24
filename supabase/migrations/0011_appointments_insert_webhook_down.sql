-- 回滾 0011_appointments_insert_webhook.sql
-- 不移除 pg_net 擴充套件（可能被同專案未來其他 migration 共用，drop extension 屬於
-- 破壞性操作且非本卡引入的風險，比照既有 down migration 只回滾本卡新增內容的慣例）。
-- 不移除 Vault 密鑰（'appointment_webhook_url'／'appointment_webhook_secret'）：
-- 密鑰本身由人工於 Supabase Dashboard 建立，非本 migration 建立，回滾 schema 不等於
-- 需要一併清除人工設定的密鑰，避免誤刪需要重新設定的風險。

begin;

drop trigger if exists appointments_notify_insert on public.appointments;
drop function if exists public.notify_appointment_insert();

alter table public.appointments
  drop column if exists confirmation_sent_at;

commit;
