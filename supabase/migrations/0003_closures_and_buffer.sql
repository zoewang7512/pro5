-- TASK-022（營業時間與可預約時段管理 架構基礎）
-- 新增 closed_dates 表（單一日期整天公休標記）與對應 RLS policy（比照 business_hours
-- 的模式），services 新增 buffer_minutes 欄位（0~120，預設 0）。
-- 純資料層：本卡不修改 get_available_slots RPC，該 RPC 的公休日／緩衝時間感知邏輯
-- 留給 TASK-024 的另一個 migration 檔案處理。
-- 可重複執行（idempotent）：使用 if not exists / drop ... if exists。
-- 對應回滾腳本：0003_closures_and_buffer_down.sql

begin;

-- ============================================================
-- closed_dates：特定單一日期的整天公休標記
-- ============================================================
create table if not exists public.closed_dates (
  date date primary key
);

alter table public.closed_dates enable row level security;

drop policy if exists "public read closed dates" on public.closed_dates;
create policy "public read closed dates"
  on public.closed_dates
  for select
  to anon, authenticated
  using (true);

drop policy if exists "admin full access to closed dates" on public.closed_dates;
create policy "admin full access to closed dates"
  on public.closed_dates
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================
-- services.buffer_minutes：服務結束後的緩衝分鐘數
-- ============================================================
alter table public.services add column if not exists buffer_minutes int not null default 0;

alter table public.services drop constraint if exists services_buffer_minutes_range;
alter table public.services
  add constraint services_buffer_minutes_range
  check (buffer_minutes >= 0 and buffer_minutes <= 120);

commit;
