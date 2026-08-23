-- TASK-046（預約規則與政策設定 架構基礎）
-- 新增 booking_policy 單例資料表（固定 1 列，id 恆為 1）與對應 RLS policy，寫法比照
-- 0006_store_settings.sql 的既有單例表模式：anon/authenticated 可讀，只有 is_admin()
-- 可寫（insert/update，不給 delete——理由同 store_settings：「至多 1 列」由 primary key
-- ＋booking_policy_singleton check constraint 在資料庫層強制，「至少 1 列」靠下方 migration
-- seed 保證；不給 delete policy 是為了守住後者，開放 delete 只會製造把唯一一列砍掉、讓
-- .single() 查詢整頁壞掉的風險，且沒有任何需求需要真的刪掉這一列。RLS 不涵蓋 TRUNCATE，
-- 下方另外 revoke truncate 補齊這道縱深防禦，security-reviewer 於 TASK-046 審查提出）。
-- min_lead_time_hours 對齊 create_appointment（0002_booking_flow.sql）目前寫死的既有行為
-- （seed 為 1 小時）；本卡不修改任何既有 RPC，只建立資料表讓 TASK-048 之後改成讀這裡的值。
-- 純資料層＋唯讀頁面骨架：本卡不含編輯/儲存邏輯，留給 TASK-047。
-- 注意：本表所有欄位對 anon 公開（見下方 select policy），日後新增欄位一律視為對外公開，
-- 不得把非公開設定加進這張表（security-reviewer 於 TASK-046 審查提出）。
-- 可重複執行（idempotent）：使用 if not exists / drop ... if exists / on conflict。
-- 對應回滾腳本：0008_booking_policy_down.sql
-- 編號說明：接續目前實際存在的最大編號 0007（「設計師登入與帳號安全」Epic 的
-- TASK-038 已使用）。

begin;

-- ============================================================
-- booking_policy：預約規則設定，固定單例（僅 1 列，id 恆為 1）
-- ============================================================
create table if not exists public.booking_policy (
  id int primary key default 1,
  min_lead_time_hours int not null default 1,
  cancel_window_hours int,
  updated_at timestamptz not null default now()
);

alter table public.booking_policy drop constraint if exists booking_policy_singleton;
alter table public.booking_policy
  add constraint booking_policy_singleton check (id = 1);

alter table public.booking_policy drop constraint if exists booking_policy_min_lead_time_range;
alter table public.booking_policy
  add constraint booking_policy_min_lead_time_range
  check (min_lead_time_hours > 0 and min_lead_time_hours <= 720);

-- 上界對齊 min_lead_time_hours 的 720 小時上限（一致性，architect／security-reviewer 於
-- TASK-046 審查提出）：寫入路徑是直接 table update，沒有 RPC 可以集中做應用層驗證，這條
-- constraint 是唯一的伺服器端防線（比照 0006_store_settings.sql 的既有論證）。
alter table public.booking_policy drop constraint if exists booking_policy_cancel_window_range;
alter table public.booking_policy
  add constraint booking_policy_cancel_window_range
  check (cancel_window_hours is null or (cancel_window_hours >= 0 and cancel_window_hours <= 720));

alter table public.booking_policy enable row level security;

-- RLS 不涵蓋 TRUNCATE（Postgres 限制），Supabase 專案的 default privileges 會讓
-- anon/authenticated 預設就有 truncate 權限；PostgREST 本身不會發出 TRUNCATE，目前不可
-- 實際利用，但作為縱深防禦明確 revoke（security-reviewer 於 TASK-046 審查提出）。
revoke truncate on public.booking_policy from anon, authenticated;

drop policy if exists "public read booking policy" on public.booking_policy;
create policy "public read booking policy"
  on public.booking_policy
  for select
  to anon, authenticated
  using (true);

drop policy if exists "admin insert booking policy" on public.booking_policy;
create policy "admin insert booking policy"
  on public.booking_policy
  for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "admin update booking policy" on public.booking_policy;
create policy "admin update booking policy"
  on public.booking_policy
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 沿用 0001_core_schema.sql 已建立的 public.set_updated_at() 共用 trigger 函式。
drop trigger if exists booking_policy_set_updated_at on public.booking_policy;
create trigger booking_policy_set_updated_at
  before update on public.booking_policy
  for each row
  execute function public.set_updated_at();

insert into public.booking_policy (id, min_lead_time_hours, cancel_window_hours)
values (1, 1, null)
on conflict (id) do nothing;

commit;
