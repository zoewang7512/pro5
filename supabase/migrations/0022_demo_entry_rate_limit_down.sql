-- TASK-102 還原：移除一鍵進入限流的資料表與函式。
-- 會刪除全部限流計數（無需保留，過期列本來就會被清除）。
-- 還原後 demo_entry_check() 不存在；一鍵進入端點（TASK-103）若仍呼叫它會出錯，而「出錯一律拒絕進入」，
-- 所以請同步停用 Demo 入口（DEMO_ENABLED=false）或讓端點略過限流步驟。
-- 只動本 migration 建立的物件；可重複執行。

begin;

drop function if exists public.demo_entry_check(text, integer, integer);
drop table if exists public.demo_entry_attempts;

-- 預期：兩個數字皆為 0
select
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'demo_entry_check') as leftover_functions,
  (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname = 'demo_entry_attempts') as leftover_tables;

notify pgrst, 'reload schema';

commit;
