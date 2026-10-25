-- TASK-087 回滾：移除預約價格快照。
-- 警告：會刪除全部 appointments.price_at_booking 資料（歷史營收的下單價格快照無法再還原）。
-- 2026-10-25 之後新增的預約，快照都是真實的下單價格；回滾後再套用 0020 只能以「當下服務價格」回補，歷史營收無法還原。
-- 回滾前請先備份快照（在 SQL Editor 另外執行，確認有資料後再執行本檔案）：
--   create table public.appointments_price_snapshot_backup as
--     select id, price_at_booking from public.appointments;
-- 備份表用完後自行刪除（drop table public.appointments_price_snapshot_backup;）。
-- 回滾順序：先在 Vercel 回滾前端（報表頁讀這個欄位），再執行本檔案。
-- 丟掉欄位時，欄位上的 check constraint 與欄位層級授權會一併消失。
-- 請在 SQL Editor 整份執行（不要只選取一部分執行）。

begin;

-- 與 up 相同：明確取得鎖並設 5 秒逾時，拿不到鎖就整份回滾，不讓預約請求排隊卡住。
set local lock_timeout = '5s';
lock table public.appointments in access exclusive mode;

drop trigger if exists appointments_set_price_snapshot on public.appointments;
drop function if exists public.set_appointment_price_snapshot();
alter table public.appointments drop column if exists price_at_booking;

notify pgrst, 'reload schema';

commit;
