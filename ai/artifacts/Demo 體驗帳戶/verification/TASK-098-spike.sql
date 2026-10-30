-- TASK-098：auth.users／auth.mfa_factors 觸發器可行性實驗（拋棄式帳號，實驗後全部清除）
--
-- 在 Supabase SQL Editor（角色 postgres）執行。**每個「步驟」分開貼上、分開執行**，
-- 並與 TASK-098-spike.mjs 的階段交替進行（完整順序見檔尾「執行順序」）。
-- 本檔不新增 migration、不改任何既有物件；所有實驗物件都在獨立 schema `spike098`，
-- 該 schema 不在 PostgREST 暴露清單內，anon／authenticated 無法存取。
--
-- 範圍限制（為什麼不會影響 designer001 與一般登入）：
--   * auth.users 觸發器用 WHEN 限定 `raw_app_meta_data ->> 'spike098' = 'true'`，
--     只有實驗腳本建立的拋棄式帳號會進入函式；其他帳號的登入、refresh 根本不會呼叫它。
--   * auth.mfa_factors 觸發器沒有 WHEN（INSERT 的 NEW 列無法限定到特定使用者），
--     所以函式第一件事查該 user_id 是不是拋棄式帳號，不是就立刻 return new（不記錄、不擋）。
--   * 函式皆為 SECURITY INVOKER，search_path 清空。
--   * 「擋」只在 mode = 'block' 且該帳號 is_demo = true 時發生；對照組（非 is_demo）永遠不擋。
--
-- 與任務卡的一處差異（請審閱時留意）：任務卡要求函式「第一行就對非 supabase_auth_admin
-- return new」。實驗函式改為「先記錄 current_user 再判斷」，因為第二個未知（GoTrue 連線角色
-- 是不是 supabase_auth_admin）本身就需要這筆記錄，否則角色不符時只會看到「沒有任何紀錄」而
-- 分不清是觸發器沒觸發還是角色不同。由於 WHEN／拋棄式帳號檢查已限定範圍，這個順序不會誤傷
-- 其他帳號。TASK-100 的正式函式仍會把守門判斷放在最前面。

-------------------------------------------------------------------------------
-- 緊急處置（任何時候登入異常、或想立刻中止實驗，先執行這兩行；它們只移除實驗觸發器）
-------------------------------------------------------------------------------
--   drop trigger if exists spike098_users_guard on auth.users;
--   drop trigger if exists spike098_mfa_guard on auth.mfa_factors;

-------------------------------------------------------------------------------
-- 步驟 0：實驗前基準（唯讀）
-------------------------------------------------------------------------------
-- 記下輸出（尤其 pw_hash_md5 與 updated_at），實驗結束後（步驟 8）再比對。
-- 只對 admins 表登記的帳號取雜湊的 md5，不會顯示密碼雜湊本身。
select u.id,
       md5(u.encrypted_password) as pw_hash_md5,
       u.updated_at,
       u.last_sign_in_at
from auth.users u
where u.id in (select user_id from public.admins)
order by u.created_at;

-- 確認沒有上次殘留（預期：三個都是 0）
select
  (select count(*) from auth.users where raw_app_meta_data ->> 'spike098' = 'true' or email like '%spike098%') as leftover_users,
  (select count(*) from pg_trigger where tgname like 'spike098%' and not tgisinternal) as leftover_triggers,
  (select count(*) from pg_namespace where nspname = 'spike098') as leftover_schema;

-------------------------------------------------------------------------------
-- 步驟 1：建立實驗物件（mode = observe：只記錄、不擋）
-------------------------------------------------------------------------------
create schema spike098;

create table spike098.config (
  mode text not null check (mode in ('observe', 'block'))
);
insert into spike098.config (mode) values ('observe');

-- 只記錄「被改變的欄位名稱」，不記錄任何值（避免把密碼雜湊或 token 寫進表）。
create table spike098.log (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default clock_timestamp(),
  tg_table text not null,
  tg_op text not null,
  cur_user text not null,
  sess_user text not null,
  user_id uuid,
  is_demo boolean,
  changed_cols text[],
  mode text
);

-- 【實際執行時的修正，已回填】這個專案對新建資料表預設啟用 RLS（且沒有 policy），
-- 觸發器以 supabase_auth_admin 身分寫入 log 會被拒（SQLSTATE 42501，使 GoTrue 回 500），
-- 讀 config 則讀到零列。所以兩張表必須關閉 RLS（它們在非公開 schema，沒有 API 暴露面）。
alter table spike098.log disable row level security;
alter table spike098.config disable row level security;

-- 觸發器以 supabase_auth_admin 身分執行（SECURITY INVOKER），需要能讀設定與寫紀錄。
-- 【實際執行時另外對 public 授權】當時還不確定 GoTrue 的連線角色（SQL Editor 看不到、也無法
-- set role 模擬）；事後證實就是 supabase_auth_admin，所以下面三行對 supabase_auth_admin 即足夠，
-- 對 public 的授權是診斷期間的暫時放寬，隨 drop schema 一併移除。
grant usage on schema spike098 to supabase_auth_admin;
grant select on spike098.config to supabase_auth_admin;
grant insert on spike098.log to supabase_auth_admin;

create function spike098.users_guard() returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_mode text;
  v_cols text[];
  v_hit text[];
  v_locked constant text[] := array[
    'encrypted_password', 'email', 'email_change', 'email_change_token_new',
    'email_change_token_current', 'recovery_token', 'phone', 'phone_change'
  ];
begin
  -- 與 OLD 比較、列出所有被改變的欄位名稱（不含值）。
  v_cols := array(
    select n.key
    from jsonb_each(to_jsonb(new)) n
    join jsonb_each(to_jsonb(old)) o on o.key = n.key
    where n.value is distinct from o.value
    order by n.key
  );
  select c.mode into v_mode from spike098.config c limit 1;

  insert into spike098.log (tg_table, tg_op, cur_user, sess_user, user_id, is_demo, changed_cols, mode)
  values ('auth.users', tg_op, current_user, session_user, old.id,
          old.raw_app_meta_data ->> 'is_demo' = 'true', v_cols, v_mode);

  if current_user <> 'supabase_auth_admin' then
    return new;
  end if;

  if v_mode = 'block' and old.raw_app_meta_data ->> 'is_demo' = 'true' then
    v_hit := array(select c from unnest(v_cols) c where c = any (v_locked));
    if cardinality(v_hit) > 0 then
      raise exception 'spike098: demo account is locked (%)', array_to_string(v_hit, ',');
    end if;
  end if;

  return new;
end;
$$;

create function spike098.mfa_guard() returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_is_demo boolean;
  v_spike boolean;
  v_mode text;
begin
  select u.raw_app_meta_data ->> 'is_demo' = 'true',
         u.raw_app_meta_data ->> 'spike098' = 'true'
    into v_is_demo, v_spike
  from auth.users u
  where u.id = new.user_id;

  -- 不是實驗用的拋棄式帳號：立刻放行，不記錄、不擋（例如 designer001 若啟用 MFA）。
  if not coalesce(v_spike, false) then
    return new;
  end if;

  select c.mode into v_mode from spike098.config c limit 1;

  insert into spike098.log (tg_table, tg_op, cur_user, sess_user, user_id, is_demo, changed_cols, mode)
  values ('auth.mfa_factors', tg_op, current_user, session_user, new.user_id, coalesce(v_is_demo, false), null, v_mode);

  if current_user <> 'supabase_auth_admin' then
    return new;
  end if;

  if v_mode = 'block' and coalesce(v_is_demo, false) then
    raise exception 'spike098: demo account cannot enroll mfa';
  end if;

  return new;
end;
$$;

-- 這兩個 create trigger 是第一個未知（託管 Supabase 是否允許）的答案：
-- 成功 = 允許；出現權限錯誤（例如 must be owner of relation）= 不允許，請把完整錯誤文字貼給我。
create trigger spike098_users_guard
  before update on auth.users
  for each row
  when (old.raw_app_meta_data ->> 'spike098' = 'true')
  execute function spike098.users_guard();

create trigger spike098_mfa_guard
  before insert on auth.mfa_factors
  for each row
  execute function spike098.mfa_guard();

-- 確認（預期：兩列，tgenabled = 'O'）
select t.tgname, c.relname, t.tgenabled
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
where t.tgname like 'spike098%' and not t.tgisinternal;

-------------------------------------------------------------------------------
-- 步驟 2：（回到終端機）執行  observe  階段，見檔尾
-------------------------------------------------------------------------------

-------------------------------------------------------------------------------
-- 步驟 3：讀取 observe 階段的紀錄（唯讀），再切換到 block 模式
-------------------------------------------------------------------------------
-- 把整張結果貼給我。重點欄位：cur_user（第二個未知）、changed_cols（第四、五個未知，
-- 以及登入／refresh／登出是否會觸發，第三個未知）。at 可對照腳本輸出的時間。
select at, tg_table, tg_op, cur_user, sess_user, is_demo, user_id, changed_cols
from spike098.log
order by at;

-- 確認後再執行這一行切換到「擋」模式：
update spike098.config set mode = 'block';
select mode from spike098.config;

-------------------------------------------------------------------------------
-- 步驟 4：（回到終端機）執行  block  階段；同一段時間內請你用自己的瀏覽器
--          登入一次 designer001（見檔尾說明），確認登入正常後登出。
-------------------------------------------------------------------------------

-------------------------------------------------------------------------------
-- 步驟 5：撤銷 session 測試（第七個未知：postgres 能否 delete from auth.sessions）
-------------------------------------------------------------------------------
-- 把 <DEMO_ID> 換成 block 階段結尾印出的 demo 拋棄式帳號 id。
-- 這行 delete 額外限定 spike098 帳號，即使 id 貼錯也不會動到真實帳號的 session。
select count(*) as sessions_before from auth.sessions where user_id = '<DEMO_ID>';

delete from auth.sessions s
using auth.users u
where u.id = s.user_id
  and u.id = '<DEMO_ID>'
  and u.raw_app_meta_data ->> 'spike098' = 'true';

select count(*) as sessions_after from auth.sessions where user_id = '<DEMO_ID>';

-------------------------------------------------------------------------------
-- 步驟 6：（回到終端機）執行  revoke-check  階段，確認被刪的 session 無法 refresh
-- 步驟 7：（回到終端機）執行  cleanup  階段，刪除拋棄式帳號
-------------------------------------------------------------------------------

-------------------------------------------------------------------------------
-- 步驟 8：拆除實驗物件，並附清除證據
-------------------------------------------------------------------------------
drop trigger if exists spike098_users_guard on auth.users;
drop trigger if exists spike098_mfa_guard on auth.mfa_factors;
drop schema spike098 cascade;

-- 預期：四個數字全為 0
select
  (select count(*) from pg_trigger where tgname like 'spike098%' and not tgisinternal) as leftover_triggers,
  (select count(*) from pg_namespace where nspname = 'spike098') as leftover_schema,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'spike098') as leftover_functions,
  (select count(*) from auth.users where raw_app_meta_data ->> 'spike098' = 'true' or email like '%spike098%') as leftover_users;

-- 與步驟 0 比對：pw_hash_md5 必須相同；updated_at 與 last_sign_in_at 若因為你手動登入
-- 而更新是預期的（登入會寫入 last_sign_in_at），請連同說明一起貼給我。
select u.id,
       md5(u.encrypted_password) as pw_hash_md5,
       u.updated_at,
       u.last_sign_in_at
from auth.users u
where u.id in (select user_id from public.admins)
order by u.created_at;

-------------------------------------------------------------------------------
-- 執行順序（SQL Editor ↔ 終端機）
-------------------------------------------------------------------------------
--   SQL   步驟 0  基準與殘留檢查
--   SQL   步驟 1  建立實驗物件（observe）
--   終端  node --env-file=.env.local "ai/artifacts/Demo 體驗帳戶/verification/TASK-098-spike.mjs" observe
--   SQL   步驟 3  讀紀錄 → 切換 block
--   終端  node --env-file=.env.local "ai/artifacts/Demo 體驗帳戶/verification/TASK-098-spike.mjs" block
--         （同時：你用自己的瀏覽器登入 designer001 一次，確認正常，登出；Claude 不碰該帳號）
--   SQL   步驟 5  刪除 demo 拋棄式帳號的 session
--   終端  node --env-file=.env.local "ai/artifacts/Demo 體驗帳戶/verification/TASK-098-spike.mjs" revoke-check
--   終端  node --env-file=.env.local "ai/artifacts/Demo 體驗帳戶/verification/TASK-098-spike.mjs" cleanup
--   SQL   步驟 8  拆除與清除證據
