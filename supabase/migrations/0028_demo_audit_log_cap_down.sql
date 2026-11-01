-- 回滾 0028_demo_audit_log_cap.sql
-- 移除 demo_audit_log_cap 觸發器與 demo_audit_log_cap_guard()。不動 audit_log 的資料、欄位、policy、grant，也不動 reset_demo_data
-- （0028 本來就沒有改它；所以 0027_down 的警告不受影響，回滾順序沒有限制）。
--
-- 警告：回滾等於重新打開缺口——Demo 體驗帳號可以無限制往 audit_log 寫入（每筆最多約 8 KB），灌爆免費方案的資料庫容量。
-- 回滾期間請確認 Demo 入口已關閉（DEMO_ENABLED=false 並執行 demo:disable），或接受這個風險。
-- 若只是想暫時放行，不必整份回滾，貼這一行即可：drop trigger if exists demo_audit_log_cap on public.audit_log;
-- 可重複執行（idempotent）。請在 SQL Editor 整份執行。

begin;

drop trigger if exists demo_audit_log_cap on public.audit_log;
drop function if exists public.demo_audit_log_cap_guard();

-- 尾端自我檢查：觸發器與函式都已移除。
do $$
begin
  if exists (select 1 from pg_trigger where tgname = 'demo_audit_log_cap' and not tgisinternal)
     or to_regprocedure('public.demo_audit_log_cap_guard()') is not null then
    raise exception '0028_down 自我檢查失敗：仍有 demo_audit_log_cap 觸發器或函式';
  end if;
end $$;

commit;
