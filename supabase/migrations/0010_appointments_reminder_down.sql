-- 回滾 0010_appointments_reminder.sql
-- 警告：`drop column` 會永久刪除已記錄的提醒信寄送狀態（哪些預約已經寄過提醒信）；
-- 回滾後若重新套用本 migration，所有既有預約的 reminder_sent_at 會重新變成 null，
-- TASK-054 的排程端點會把它們全部視為「尚未寄過提醒信」，可能造成已經寄過提醒信的
-- 預約被重複寄送一次。回滾前務必先確認沒有更新的 migration 依賴這個欄位。

begin;

alter table public.appointments drop column if exists reminder_sent_at;

commit;
