-- TASK-084（稽核紀錄 簡版）
-- 新增 audit_log：後台操作日誌（只增不減）。店長在後台完成關鍵操作後，由 lib/admin/audit-log.ts 的
-- recordAdminAction 多寫一筆；這是「操作日誌」不是「防竄改稽核」，保證邊界見
-- ai/artifacts/稽核紀錄/feature-spec.md 與 decisions.md。
--
-- 本檔案不碰任何既有物件：沒有 trigger、沒有改 RPC、沒有動既有資料表；套用前後既有功能完全不變，
-- 可以先套用、再接線（TASK-085）、最後做列表畫面（TASK-086）。
--
-- 權限（GRANT＋RLS 兩層，依 decisions.md「TASK-065」規則在同檔寫明最小權限）：
--   - anon：無任何權限。
--   - authenticated：select；insert 只有欄位層級 (event_type, entity_type, entity_id, summary, changes)，
--     **不含 actor_id、created_at**，這兩欄只能走資料庫預設（auth.uid()、now()），前端無法指定或偽造。
--     沒有 update／delete 授權也沒有 policy。非店長登入者即使有 select 授權，RLS 也只讓他讀到空結果。
--   - service_role：select、delete（delete 只供整合測試清掃；不給 insert／update）。
-- 識別欄位（generated always as identity）的 insert 不需要對序列另外授權。
--
-- 可重複執行（idempotent）：if not exists／drop ... if exists。
-- 對應回滾腳本：0019_audit_log_down.sql（會刪除全部紀錄）。
-- 重要：後續 migration 若調整 audit_log 的授權或 policy，就不要再重跑本檔（重跑會把授權與 policy 還原成本檔版本）。
-- 部署順序：先套用本檔案，再部署前端。

begin;

-- 依賴檢查：缺少前置物件時直接中止，不留下半套。
do $$
begin
  if to_regprocedure('public.is_admin()') is null then
    raise exception '0019 需要先套用 0001～0018（找不到 is_admin()）';
  end if;
end $$;

-- ============================================================
-- audit_log
-- ============================================================
-- entity_id 用 text：對象主鍵型別不一（uuid、星期、日期、複合鍵）。
-- summary／changes 為 JSON 物件，序列化後各限 4096 位元組（程式端會先截斷，這裡是最終防線）。
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  actor_id uuid default auth.uid(),
  event_type text not null,
  entity_type text not null,
  entity_id text not null,
  summary jsonb not null default '{}'::jsonb,
  changes jsonb not null default '{}'::jsonb
);

-- create table if not exists 不會修正既有表的欄位定義，這裡補一行讓重跑也能收斂 actor_id 的預設值。
alter table public.audit_log alter column actor_id set default auth.uid();

-- 以 drop ... if exists 再 add 的寫法建立 constraint（比照 0017），重跑才會收斂。
alter table public.audit_log drop constraint if exists audit_log_event_type_format;
alter table public.audit_log
  add constraint audit_log_event_type_format check (event_type ~ '^[a-z_]+[.][a-z_]+$');

alter table public.audit_log drop constraint if exists audit_log_entity_type_format;
alter table public.audit_log
  add constraint audit_log_entity_type_format check (entity_type ~ '^[a-z_]+$');

alter table public.audit_log drop constraint if exists audit_log_entity_id_length;
alter table public.audit_log
  add constraint audit_log_entity_id_length check (char_length(entity_id) between 1 and 128);

alter table public.audit_log drop constraint if exists audit_log_summary_valid;
alter table public.audit_log
  add constraint audit_log_summary_valid
  check (jsonb_typeof(summary) = 'object' and octet_length(summary::text) <= 4096);

alter table public.audit_log drop constraint if exists audit_log_changes_valid;
alter table public.audit_log
  add constraint audit_log_changes_valid
  check (jsonb_typeof(changes) = 'object' and octet_length(changes::text) <= 4096);

-- 列表以 id desc 排序（主鍵即可）；類別篩選（預約／設定）另走 (entity_type, id desc)。
create index if not exists audit_log_entity_type_id_idx
  on public.audit_log (entity_type, id desc);

-- ============================================================
-- RLS 與 GRANT
-- ============================================================
-- 先 revoke all 再逐一 grant（含 truncate／references／trigger 與 Postgres 17 的 maintain）。
-- 不得啟用 force row level security。
alter table public.audit_log enable row level security;

revoke all on public.audit_log from public, anon, authenticated, service_role;
grant select on public.audit_log to authenticated;
grant insert (event_type, entity_type, entity_id, summary, changes)
  on public.audit_log to authenticated;
grant select, delete on public.audit_log to service_role;

drop policy if exists "admin read audit log" on public.audit_log;
create policy "admin read audit log"
  on public.audit_log
  for select
  to authenticated
  using ((select public.is_admin()));

drop policy if exists "admin insert audit log" on public.audit_log;
create policy "admin insert audit log"
  on public.audit_log
  for insert
  to authenticated
  with check ((select public.is_admin()));

-- 不建立 update／delete policy：登入帳號無法修改或刪除任何紀錄。

commit;

-- 通知 PostgREST 重新載入 schema，讓新資料表立即可用（不靠等待）。
notify pgrst, 'reload schema';
