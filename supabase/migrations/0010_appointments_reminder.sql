-- TASK-051（Email 通知與提醒 架構基礎）
-- 新增 appointments.reminder_sent_at 欄位（timestamptz，預設 null），供 TASK-054
-- 的提醒信排程端點記錄「這筆預約的提醒信是否已寄出」，避免重複寄送。本卡只新增欄位，
-- 不建立任何觸發寄信的邏輯或端點（留給 TASK-052／053／054）。
-- 可重複執行（idempotent）：`add column if not exists`。
-- 對應回滾腳本：0010_appointments_reminder_down.sql
-- 編號說明：接續目前實際存在的最大編號 0009。

begin;

alter table public.appointments add column if not exists reminder_sent_at timestamptz;

commit;
