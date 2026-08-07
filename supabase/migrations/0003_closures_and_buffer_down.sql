-- 回滾 0003_closures_and_buffer.sql
-- 警告：本回滾具破壞性且不可逆——drop table closed_dates 會永久刪除所有已設定的
-- 公休日；drop column buffer_minutes 會永久丟掉每個服務已設定的緩衝分鐘數，重新套用
-- 0003 只會補回預設值 0，不會恢復原本的資料。
-- 順序警告：若後續 migration（TASK-024 規劃中）已讓 get_available_slots RPC 讀取
-- closed_dates／buffer_minutes，在該 migration 套用之後才回滾本檔案，會讓 RPC 在執行期
-- 找不到欄位／表而失敗（該 RPC 用 exception when others 吞掉錯誤，只會回傳籠統的
-- INTERNAL_ERROR，不易察覺是回滾順序造成的）；回滾前務必先確認沒有更新的 migration
-- 依賴本檔案新增的 schema。

begin;

drop table if exists public.closed_dates cascade;

alter table public.services drop constraint if exists services_buffer_minutes_range;
alter table public.services drop column if exists buffer_minutes;

commit;
