-- TASK-100（Demo 體驗帳戶：鎖定帳號安全三項）
-- 讓「體驗帳戶」（auth.users.raw_app_meta_data.is_demo = true）無法經由 Auth API 改密碼、改 Email、
-- 重設密碼、註冊 MFA；另提供撤銷 Demo session 的函式。依據 TASK-098 的實測結論
-- （ai/artifacts/Demo 體驗帳戶/verification/TASK-098.md），不是推測。
--
-- 做法：
--   1. auth.users BEFORE UPDATE 觸發器，WHEN 限定 old 列 is_demo = 'true'——其他帳號（含 designer001）
--      的登入、refresh 根本不會進入函式。函式第一行就對「不是 GoTrue 連線角色」放行，所以
--      SQL Editor（postgres）與 SECURITY DEFINER 維護函式不受限（維修通道）。
--   2. auth.mfa_factors BEFORE INSERT 觸發器（INSERT 的 NEW 列無法用 WHEN 限定到特定使用者，所以
--      函式內才查 is_demo；非 Demo 帳號只多一次主鍵查詢，然後放行）。
--   3. demo_revoke_sessions()：刪除 Demo 帳戶的全部 session（每日還原、緊急關閉用）。
--
-- ★ 兩個觸發器函式必須是 SECURITY INVOKER（下面刻意寫明，且本檔尾端的自我檢查會驗證）。
--   若寫成 SECURITY DEFINER，函式內的 current_user 會變成擁有者（postgres），
--   `current_user <> 'supabase_auth_admin'` 永遠成立 → 永遠放行 → 鎖等於沒做（而且不會有任何錯誤）。
--   整合測試（tests/demo-lock.integration.test.ts）用真實 Auth API 證明鎖有效，等同證明這點。
--
-- 為什麼用 current_user：GoTrue 呼叫資料庫時沒有使用者 JWT（觸發器內 auth.uid() 是 null）；
-- TASK-098 實測 GoTrue 的連線角色是 supabase_auth_admin。
--
-- 影響範圍（套用前後其他帳戶的行為不變）：
--   * 只有 is_demo 帳戶會進入 auth.users 觸發器函式；其他帳號的 UPDATE 連函式都不呼叫。
--   * auth.mfa_factors 觸發器對所有人的 INSERT 都會呼叫，但非 Demo 一律放行（TASK-098 與整合測試已證實
--     非 Demo 帳號啟用 MFA 不受影響）。
--   * 觸發器不讀、不寫任何資料表之外的設定（沒有設定表）。TASK-098 發現：這個專案新建資料表預設啟用 RLS
--     且沒有 policy，觸發器以 supabase_auth_admin 讀寫自建表會被拒（42501）並讓所有符合條件的 Auth 操作回 500。
--     所以本檔「不建任何表」，模式固定為「擋」，把這個風險整個移除。
--
-- 鎖定欄位（任一改變就 raise）：encrypted_password、email、email_change、email_change_token_new、
--   email_change_token_current、recovery_token、reauthentication_token、phone、phone_change；
--   另外 raw_app_meta_data.is_demo 標記本身不可被改動（見函式內註解）。
--   * phone_change 與用戶端 updateUser({ phone }) 在 TASK-098 未實測（保守保留）。
--   * reauthentication_token（reauthenticate() 會寫入並寄 OTP 信）是安全審查後加入，防止灌爆作者信箱與寄信額度。
--   * 不得加入：confirmed_at（generated column，BEFORE 觸發器看到過期值，每列都「變動」）、
--     last_sign_in_at／updated_at（登入、refresh 會寫）、email_confirmed_at、raw_user_meta_data、
--     banned_until（緊急關閉 demo:disable 依賴它可寫）。
--   * 比較用 to_jsonb(NEW) 與 to_jsonb(OLD) 的同名鍵，而不是直接寫欄位名：Auth 平台日後若移除某欄位，
--     函式不會因為「欄位不存在」而丟例外讓所有 Demo 操作回 500（缺欄位時兩邊皆 null，視為沒變）。
--     代價是缺欄位時鎖會靜默變弱，所以套用時由本檔的自我檢查確認鎖定欄位目前都存在。
--
-- 客戶端看到的錯誤（TASK-098 實測）：資料庫例外的 SQLSTATE 與訊息會原文出現在 Auth API 的 HTTP 500 回應，
--   supabase-js 把它呈現成 message = {}（啟用 MFA 路徑只有通用的 unexpected_failure）。
--   所以：訊息固定為 'DEMO_LOCKED: this demo account is read-only'（固定前綴供辨識；不含欄位名稱與資料庫細節）；
--   前端不得依賴錯誤文字，鎖定 UI 以 isDemo 為準。營運上看到零星 P0001 + DEMO_LOCKED 是被擋的嘗試，不是故障。
--
-- 維修通道與限制：
--   * admin API（service_role）改 Demo 帳號也經過 GoTrue（角色同為 supabase_auth_admin），一樣被擋。
--     輪換 Demo 密碼、修復帳號只能在 SQL Editor（postgres 角色，不經 GoTrue，不受鎖限制）執行。
--   * postgres 無法在 SQL Editor `set role supabase_auth_admin`（42501），所以無法在 SQL Editor 模擬 GoTrue；
--     驗證觸發器只能走真實 Auth API（見整合測試）。
--   * 平台限制：Auth 升級後若連線角色或寫入欄位改變，鎖可能失效或誤擋。
--
-- ★★ 緊急處置（套用前就備妥；任何時候登入異常，第一步先貼這兩行，它們只移除觸發器、不動資料）：
--      drop trigger if exists demo_lock_users_guard on auth.users;
--      drop trigger if exists demo_lock_mfa_guard on auth.mfa_factors;
--    ★ 緊急時「只」貼這兩行，不要用 _down.sql：_down 會連 demo_revoke_sessions() 一起刪掉，而 demo:disable
--    （緊急關閉）依賴它。_down.sql 只用在「下線整個 Demo 功能」。
--    手冊註記：Auth 平台升級後若「登入全面回 500」，第一步先貼上面兩行 drop trigger。
--
-- 另：Dashboard 的 Authentication → Manual Linking 必須是關閉、且沒有啟用任何 OAuth／SSO 提供者；
--   否則訪客可 linkIdentity() 把自己的外部帳號綁到 Demo 帳戶（只新增 auth.identities，不在上面任何鎖內）。
--   本 migration 不處理 auth.identities（見 TASK-100 驗證報告的殘留風險）。
--
-- 套用順序：先套用本 migration，再建立 Demo 帳戶（TASK-099）。
--   Demo 帳戶建立時 GoTrue 會對該列連續 UPDATE 兩次（email_confirmed_at；raw_user_meta_data），
--   皆不在鎖定欄位，不受影響；但若觸發器本身出錯會讓建立失敗，所以整合測試涵蓋建立流程。
--
-- 套用「前」的基準（貼在 SQL Editor 先執行並記下輸出，套用後比對；只顯示雜湊的 md5，不顯示雜湊本身）：
--   select u.id, md5(u.encrypted_password) as pw_hash_md5, u.updated_at, u.last_sign_in_at
--   from auth.users u where u.id in (select user_id from public.admins) order by u.created_at;
-- 套用「後」立刻：請用自己的瀏覽器登入 designer001 確認正常（Claude 不碰該帳號），再執行同一段基準查詢比對。
--
-- 套用後的驗證查詢：
--   select t.tgname, c.relname, t.tgenabled, p.prosecdef as security_definer
--   from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid
--   where t.tgname like 'demo_lock_%' and not t.tgisinternal;       -- 兩列，tgenabled 'O'，security_definer false
--   select count(*) as demo_accounts from auth.users where raw_app_meta_data ->> 'is_demo' = 'true';
--
-- 可重複執行（idempotent）：create or replace function、drop trigger if exists 後重建；重跑不影響資料。
-- 對應回滾腳本：0021_demo_account_lock_down.sql（會讓 Demo 帳號恢復可改密碼／Email／MFA）。
-- 請在 SQL Editor 整份執行（不要只選取一部分，否則不在 begin 交易內、失敗時無法整份回滾）。

begin;

-- 依賴檢查：缺少前置物件、或鎖定欄位不存在時直接中止，不留下半套。
do $$
declare
  v_missing text;
begin
  if to_regclass('auth.users') is null or to_regclass('auth.mfa_factors') is null
     or to_regclass('auth.sessions') is null then
    raise exception '0021 需要 Supabase Auth 的 auth.users／auth.mfa_factors／auth.sessions';
  end if;

  select string_agg(c, ', ' order by c) into v_missing
  from unnest(array[
    'raw_app_meta_data', 'encrypted_password', 'email', 'email_change', 'email_change_token_new',
    'email_change_token_current', 'recovery_token', 'reauthentication_token', 'phone', 'phone_change'
  ]) c
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'auth' and table_name = 'users' and column_name = c
  );
  if v_missing is not null then
    raise exception '0021：auth.users 缺少欄位（%），鎖定清單需要重新核對（TASK-098 報告）', v_missing;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'auth' and table_name = 'mfa_factors' and column_name = 'user_id'
  ) then
    raise exception '0021：auth.mfa_factors 缺少 user_id 欄位';
  end if;
end;
$$;

-- ============================================================
-- auth.users：Demo 帳戶不可變更憑證
-- ============================================================
create or replace function public.demo_lock_users_guard()
returns trigger
language plpgsql
security invoker          -- ★ 不可改成 security definer，見檔頭
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_col text;
begin
  -- 守門：只有 GoTrue 的連線角色才受限。SQL Editor（postgres）、SECURITY DEFINER 維護函式放行。
  if current_user <> 'supabase_auth_admin' then
    return new;
  end if;

  v_old := to_jsonb(old);
  v_new := to_jsonb(new);

  foreach v_col in array array[
    'encrypted_password', 'email', 'email_change', 'email_change_token_new',
    'email_change_token_current', 'recovery_token', 'reauthentication_token', 'phone', 'phone_change'
  ] loop
    if (v_new -> v_col) is distinct from (v_old -> v_col) then
      -- 訊息固定、不含欄位名稱（會原文出現在 Auth API 回應）。
      raise exception 'DEMO_LOCKED: this demo account is read-only';
    end if;
  end loop;

  -- is_demo 標記本身不可被改動：否則可先用 admin API 清掉標記（raw_app_meta_data 不在上面的清單），
  -- 之後這個帳號就不再符合 WHEN，所有鎖一併失效。（WHEN 比對的是 OLD，所以同一個 UPDATE 同時清標記
  -- 與改密碼本來就會被擋；這裡補的是「分兩步」的路徑。）要下線 Demo 改走 SQL Editor。
  if (v_new -> 'raw_app_meta_data' -> 'is_demo') is distinct from (v_old -> 'raw_app_meta_data' -> 'is_demo') then
    raise exception 'DEMO_LOCKED: this demo account is read-only';
  end if;

  return new;
end;
$$;

drop trigger if exists demo_lock_users_guard on auth.users;
create trigger demo_lock_users_guard
  before update on auth.users
  for each row
  when (old.raw_app_meta_data ->> 'is_demo' = 'true')
  execute function public.demo_lock_users_guard();

-- ============================================================
-- auth.mfa_factors：Demo 帳戶不可註冊 MFA
-- ============================================================
create or replace function public.demo_lock_mfa_guard()
returns trigger
language plpgsql
security invoker          -- ★ 不可改成 security definer，見檔頭
set search_path = ''
as $$
begin
  if current_user <> 'supabase_auth_admin' then
    return new;
  end if;

  -- 非 Demo（含 is_demo 缺鍵 → 查無列）一律放行。
  if exists (
    select 1 from auth.users u
    where u.id = new.user_id
      and u.raw_app_meta_data ->> 'is_demo' = 'true'
  ) then
    raise exception 'DEMO_LOCKED: this demo account is read-only';
  end if;

  return new;
end;
$$;

drop trigger if exists demo_lock_mfa_guard on auth.mfa_factors;
create trigger demo_lock_mfa_guard
  before insert on auth.mfa_factors
  for each row
  execute function public.demo_lock_mfa_guard();

-- 觸發器函式不給任何人直接呼叫（它們也無法被當 RPC 呼叫：回傳型態是 trigger；這裡是多一層保險）。
-- 觸發器觸發時不檢查呼叫者的 execute 權限（只在 create trigger 時檢查建立者），所以不影響 GoTrue。
revoke execute on function public.demo_lock_users_guard() from public, anon, authenticated;
revoke execute on function public.demo_lock_mfa_guard() from public, anon, authenticated;

-- ============================================================
-- demo_revoke_sessions()：撤銷 Demo 帳戶的全部 session
-- ============================================================
-- 每日還原與 demo:disable 使用（service_role）。自己決定 Demo 使用者，不信任呼叫端帶入的 id；
-- is_demo 帳戶筆數不是剛好 1 就 raise（0 個＝尚未建立或標記被誤清；2 個以上＝標記被濫用，
-- 兩種情況都不能猜要刪誰）。auth.sessions 刪除後，其 refresh token 一併失效（TASK-098 實測）。
-- 回傳實際刪除的 session 數。
create or replace function public.demo_revoke_sessions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_deleted integer;
begin
  select array_agg(u.id) into v_ids
  from auth.users u
  where u.raw_app_meta_data ->> 'is_demo' = 'true';

  if coalesce(cardinality(v_ids), 0) <> 1 then
    raise exception 'demo_revoke_sessions: expected exactly 1 demo account, found %',
      coalesce(cardinality(v_ids), 0);
  end if;

  delete from auth.sessions where user_id = v_ids[1];
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke execute on function public.demo_revoke_sessions() from public, anon, authenticated;
grant execute on function public.demo_revoke_sessions() to service_role;

-- ============================================================
-- 自我檢查：任何一項不成立就整份回滾
-- ============================================================
do $$
begin
  -- 兩個觸發器函式必須是 SECURITY INVOKER 且 search_path 已固定（空字串）。
  if exists (
    select 1 from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('demo_lock_users_guard', 'demo_lock_mfa_guard')
      and (p.prosecdef or p.proconfig is null or not ('search_path=""' = any (p.proconfig)))
  ) then
    raise exception '0021 自我檢查失敗：觸發器函式必須是 SECURITY INVOKER 且 search_path 為空';
  end if;

  if (
    select count(*) from pg_trigger t
    where t.tgname in ('demo_lock_users_guard', 'demo_lock_mfa_guard')
      and not t.tgisinternal and t.tgenabled = 'O'
  ) <> 2 then
    raise exception '0021 自我檢查失敗：兩個觸發器應存在且為啟用狀態';
  end if;

  -- demo_revoke_sessions：SECURITY DEFINER、search_path 空，且只有 service_role 可執行。
  if not exists (
    select 1 from pg_proc p
    where p.oid = 'public.demo_revoke_sessions()'::regprocedure
      and p.prosecdef and 'search_path=""' = any (p.proconfig)
  ) then
    raise exception '0021 自我檢查失敗：demo_revoke_sessions 應為 SECURITY DEFINER 且 search_path 為空';
  end if;
  if has_function_privilege('anon', 'public.demo_revoke_sessions()', 'execute')
     or has_function_privilege('authenticated', 'public.demo_revoke_sessions()', 'execute')
     or not has_function_privilege('service_role', 'public.demo_revoke_sessions()', 'execute') then
    raise exception '0021 自我檢查失敗：demo_revoke_sessions 只能由 service_role 執行';
  end if;
end;
$$;

-- 新增了 RPC（demo_revoke_sessions），比照 0017～0020 通知 PostgREST 重載 schema cache。
notify pgrst, 'reload schema';

commit;
