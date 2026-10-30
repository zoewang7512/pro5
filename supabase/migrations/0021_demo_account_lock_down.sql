-- TASK-100 還原：移除 Demo 帳戶鎖定的觸發器與函式。
-- **警告（安全降級）**：還原後，is_demo 帳戶又能經由 Auth API 改密碼、改 Email、重設密碼、註冊 MFA。
-- 使用情境：確認要下線整個 Demo 功能。
-- ★ 緊急情況（例如 Auth 平台升級後登入全面回 500）不要用本檔：它會連 demo_revoke_sessions() 一起刪掉，
--   而 demo:disable（緊急關閉）依賴該函式。緊急時只貼 0021_demo_account_lock.sql 檔頭的兩行 drop trigger。
-- 還原後 demo_revoke_sessions() 不存在；每日還原與 demo:disable 若仍呼叫它會失敗，請同步停用。
-- 只動本 migration 建立的物件，不影響任何資料；可重複執行。

begin;

drop trigger if exists demo_lock_users_guard on auth.users;
drop trigger if exists demo_lock_mfa_guard on auth.mfa_factors;

drop function if exists public.demo_lock_users_guard();
drop function if exists public.demo_lock_mfa_guard();
drop function if exists public.demo_revoke_sessions();

-- 預期：三個數字皆為 0
select
  (select count(*) from pg_trigger where tgname like 'demo_lock_%' and not tgisinternal) as leftover_triggers,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
     and proname in ('demo_lock_users_guard', 'demo_lock_mfa_guard', 'demo_revoke_sessions')) as leftover_functions;

notify pgrst, 'reload schema';

commit;
