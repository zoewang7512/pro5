-- 回滾 0012_appointments_update_webhook.sql
-- 不移除 Vault 密鑰（appointment_webhook_url／appointment_webhook_secret）：
-- 這兩個密鑰由 0011（TASK-052）的 INSERT trigger 共用，回滾本卡的 UPDATE
-- trigger 不應該連帶讓 INSERT 分支失去密鑰。

begin;

drop trigger if exists appointments_notify_update on public.appointments;
drop function if exists public.notify_appointment_update();

commit;
