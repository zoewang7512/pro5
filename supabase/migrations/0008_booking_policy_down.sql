-- 回滾 0008_booking_policy.sql
-- 警告：本回滾具破壞性且不可逆——drop table booking_policy 會永久刪除已設定的最短提前
-- 預約時間／可取消改期時限。回滾前建議先手動執行
-- `select * from public.booking_policy;` 記錄現值：若之後重新套用 0008_booking_policy.sql，
-- seed 會把值 re-seed 回預設的 1 小時／null，等同把預約規則靜默放寬回預設值（architect 於
-- TASK-046 審查提出——這比整頁壞掉更難察覺，是「放行原本該被擋掉的預約」方向的失效）。
-- 順序警告：回滾前務必先確認沒有更新的 migration 依賴本檔案新增的 schema
-- （booking_policy 表）；本卡不修改 create_appointment／get_available_slots，
-- 但若 TASK-048 之後已讓這兩支 RPC 改讀 booking_policy，必須先回滾該 migration。

begin;

-- 不需要在此另外 drop policy／revoke：restrict（非 cascade）drop table 會連同表上的
-- policy／grant 一併移除；若表本身已不存在，對不存在的 relation 執行 drop policy 會直接
-- 中止交易，反而讓可重複執行的回滾腳本變脆弱（security-reviewer 於 TASK-046 審查發現）。
-- restrict：若之後有其他 migration 讓別的物件依賴上 booking_policy（例如外鍵、view），
-- 這裡會直接報錯中止，而不是靜默把那些依賴物件一併砍掉（比照 0006_store_settings_down.sql
-- 的既有慣例）。
drop table if exists public.booking_policy restrict;

commit;
