-- 回滾 0019_audit_log.sql
-- 警告：本回滾具破壞性且不可逆——drop table 會永久刪除 audit_log 的全部紀錄。
-- 執行前先匯出 audit_log（Dashboard 的 Table Editor 可匯出 CSV）。
-- 回滾順序：先在 Vercel 回滾前端（TASK-085 起的前端會呼叫 recordAdminAction，表不存在時只會
-- console.warn、不影響操作；但稽核紀錄列表頁會顯示錯誤狀態），再執行本檔案。

begin;

drop table if exists public.audit_log;

commit;

notify pgrst, 'reload schema';
