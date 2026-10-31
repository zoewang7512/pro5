-- TASK-108 還原：移除還原函式、Storage 物件清單 RPC、重置閘門函式與閘門資料表。
-- 只移除本 migration 建立的函式與 demo_reset_gate 資料表，不動任何既有資料。
-- 還原後 reset_demo_data() 不存在；還原編排（TASK-109／110）若仍呼叫它會出錯，請同步停用排程還原（DEMO_RESET_ENABLED=false）。
-- 可重複執行。

begin;

drop function if exists public.reset_demo_data(jsonb, boolean);
drop function if exists public.demo_list_storage_objects(text);
drop function if exists public.demo_reset_open_gate(int);
drop function if exists public.demo_reset_close_gate();
drop function if exists public.demo_reset_gate_is_open();
drop table if exists public.demo_reset_gate;

-- 預期：0
select count(*) as leftover_functions
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('reset_demo_data', 'demo_list_storage_objects', 'demo_reset_open_gate', 'demo_reset_close_gate', 'demo_reset_gate_is_open');

notify pgrst, 'reload schema';

commit;
