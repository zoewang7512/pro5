-- TASK-102（Demo 體驗帳戶：一鍵進入限流）
-- 提供適用於 serverless 的固定時間窗限流：以資料庫計數，不依賴記憶體。供一鍵進入端點
-- （TASK-103，POST /api/demo/enter）以 service_role 呼叫。
--
-- 為什麼不用 Supabase Auth 內建限流：它以「呼叫端 IP」計算，而呼叫端是 Vercel 伺服器，
-- 所有訪客與還原的健康檢查共用同一份額度，不能替代每位訪客的限流（架構筆記 D4）。
--
-- 內容：
--   1. 資料表 demo_entry_attempts(bucket, window_start, count)：啟用 RLS、不建任何 policy、
--      revoke all 後只授權 service_role。bucket 由應用程式組出（每 IP 的 HMAC 雜湊、或 'global'），
--      這張表**不存任何明文 IP**。
--   2. RPC demo_entry_check(p_bucket, p_limit, p_window_seconds) returns boolean：
--      以 insert … on conflict do update 原子累加；本次是時間窗內第 N 次且 N <= 上限回 true，
--      超過回 false。順手刪除兩小時前的過期列。僅 service_role 可執行。
--
-- 設計選擇：
--   * 函式是 SECURITY INVOKER、search_path 為空：只有 service_role 能執行，而且 anon／authenticated
--     對資料表也沒有任何權限——就算日後有人誤把 execute 授權出去，呼叫仍會因為沒有資料表權限而失敗
--     （兩層，不是只靠一層）。service_role 在 Supabase 具 BYPASSRLS，所以「RLS 開啟、無 policy」不影響它。
--   * 時間窗對齊 epoch（window_start = floor(epoch / 窗長) * 窗長），同一個窗長的所有呼叫落在同一列。
--   * 被拒絕的呼叫也會累加計數（count 會超過上限）：這是固定時間窗的標準行為，不影響判斷。
--   * 參數驗證：bucket 長度 1～200、上限 1～1000000、窗長 1～3600 秒；不合法就 raise。
--     呼叫端（lib/demo/rate-limit.ts）把任何錯誤都視為「不允許」，所以參數錯誤不會放行。
--     窗長上限 3600 與「清除兩小時前的列」配合：進行中的時間窗不可能被清掉（間隔用 '2 hours'，
--     不用 '1 day'：天數會隨 session 時區的夏令時間變成 23 小時）。
--     保留期刻意短：攻擊者輪替 bucket（例如 IPv6 /48 內的 /64）會讓列數隨請求數成長，保留越久越佔儲存配額。
--   * 清除過期列每次呼叫都做（有 window_start 索引，表很小）：不依賴排程。
--
-- 套用前後既有功能完全不變：本檔不碰任何既有物件。
-- 可重複執行（idempotent）：if not exists／create or replace／drop ... if exists。
-- 對應回滾腳本：0022_demo_entry_rate_limit_down.sql（會刪除全部限流計數；一鍵進入端點若仍呼叫此 RPC，
--   會因出錯而一律拒絕進入——出錯不放行是設計）。
-- 請在 SQL Editor 整份執行（不要只選取一部分，否則不在 begin 交易內、失敗時無法整份回滾）。
-- 部署順序：先套用本檔案，再部署呼叫它的端點（TASK-103）。
--
-- 套用後的驗證查詢：
--   select has_function_privilege('anon', 'public.demo_entry_check(text,int,int)', 'execute') as anon_can_exec,
--          has_function_privilege('authenticated', 'public.demo_entry_check(text,int,int)', 'execute') as auth_can_exec,
--          has_function_privilege('service_role', 'public.demo_entry_check(text,int,int)', 'execute') as svc_can_exec;
--   -- 預期：false, false, true

begin;

-- 依賴檢查：缺少前置物件時直接中止，不留下半套。0022 不依賴 0021 的內容，只確認 service_role 角色存在
-- （Supabase 專案一定有；在非 Supabase 環境套用時會在這裡明確失敗，而不是 grant 時才出現難懂的錯誤）。
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    raise exception '0022 需要 Supabase 的 service_role 角色';
  end if;
end $$;

-- ============================================================
-- demo_entry_attempts
-- ============================================================
-- bucket：'global' 或 'ip:<HMAC-SHA256 十六進位>'（見 lib/demo/rate-limit.ts）；不存明文 IP。
-- window_start：時間窗起點（epoch 對齊）。count：該時間窗內已嘗試的次數。
create table if not exists public.demo_entry_attempts (
  bucket text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (bucket, window_start)
);

-- 以 drop ... if exists 再 add 的寫法建立 constraint（比照 0019），重跑才會收斂。
alter table public.demo_entry_attempts drop constraint if exists demo_entry_attempts_bucket_length;
alter table public.demo_entry_attempts
  add constraint demo_entry_attempts_bucket_length check (char_length(bucket) between 1 and 200);

-- 清除過期列用（where window_start < …）。
create index if not exists demo_entry_attempts_window_start_idx
  on public.demo_entry_attempts (window_start);

-- RLS 與 GRANT：先 revoke all 再逐一 grant（含 truncate／references／trigger 與 Postgres 17 的 maintain；
-- maintain 在較舊版本不存在，所以下面的自我檢查不列入，但 revoke all 已涵蓋）。
-- 不得啟用 force row level security。沒有任何 policy：anon／authenticated 即使取得授權也讀不到、寫不進。
alter table public.demo_entry_attempts enable row level security;

revoke all on public.demo_entry_attempts from public, anon, authenticated, service_role;
-- select：on conflict do update 與 returning 需要；insert／update：累加；delete：清除過期列與整合測試清掃。
grant select, insert, update, delete on public.demo_entry_attempts to service_role;

-- ============================================================
-- demo_entry_check
-- ============================================================
create or replace function public.demo_entry_check(
  p_bucket text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security invoker          -- 刻意不用 security definer，見檔頭「設計選擇」
set search_path = ''
as $$
declare
  v_window_start timestamptz;
  v_count integer;
begin
  if p_bucket is null or char_length(p_bucket) not between 1 and 200 then
    raise exception 'demo_entry_check: invalid bucket';
  end if;
  if p_limit is null or p_limit not between 1 and 1000000 then
    raise exception 'demo_entry_check: invalid limit';
  end if;
  if p_window_seconds is null or p_window_seconds not between 1 and 3600 then
    raise exception 'demo_entry_check: invalid window';
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  -- 先清除兩小時前的列（窗長上限 3600 秒，進行中的時間窗不會被清掉）。放在累加之前，
  -- 避免交易握著熱點列（global）的鎖等清除完成。
  delete from public.demo_entry_attempts
  where window_start < now() - interval '2 hours';

  -- 原子累加：並行請求在同一列上序列化，每個請求拿到不同的 count。
  insert into public.demo_entry_attempts as t (bucket, window_start, count)
  values (p_bucket, v_window_start, 1)
  on conflict (bucket, window_start)
  do update set count = t.count + 1
  returning t.count into v_count;

  return v_count <= p_limit;
end;
$$;

-- 預設 ACL 會把新函式的 execute 授權給 public／anon／authenticated，這裡明確收回，只留 service_role。
revoke execute on function public.demo_entry_check(text, integer, integer) from public, anon, authenticated;
grant execute on function public.demo_entry_check(text, integer, integer) to service_role;

-- ============================================================
-- 自我檢查：任何一項不成立就整份回滾
-- ============================================================
do $$
begin
  -- 函式：SECURITY INVOKER、search_path 為空。
  if not exists (
    select 1 from pg_proc p
    where p.oid = 'public.demo_entry_check(text,integer,integer)'::regprocedure
      and not p.prosecdef
      and 'search_path=""' = any (p.proconfig)
  ) then
    raise exception '0022 自我檢查失敗：demo_entry_check 應為 SECURITY INVOKER 且 search_path 為空';
  end if;

  -- 函式只有 service_role 可執行。
  if has_function_privilege('anon', 'public.demo_entry_check(text,integer,integer)', 'execute')
     or has_function_privilege('authenticated', 'public.demo_entry_check(text,integer,integer)', 'execute')
     or not has_function_privilege('service_role', 'public.demo_entry_check(text,integer,integer)', 'execute') then
    raise exception '0022 自我檢查失敗：demo_entry_check 只能由 service_role 執行';
  end if;

  -- 資料表：RLS 開啟、不 force、沒有 policy；anon／authenticated 沒有任何權限。
  if not exists (
    select 1 from pg_class c
    where c.oid = 'public.demo_entry_attempts'::regclass and c.relrowsecurity and not c.relforcerowsecurity
  ) then
    raise exception '0022 自我檢查失敗：demo_entry_attempts 應啟用 RLS 且不 force';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'demo_entry_attempts') then
    raise exception '0022 自我檢查失敗：demo_entry_attempts 不應有任何 policy';
  end if;
  if exists (
    select 1
    from unnest(array['anon', 'authenticated']) r,
         unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) priv
    where has_table_privilege(r, 'public.demo_entry_attempts', priv)
  ) then
    raise exception '0022 自我檢查失敗：anon／authenticated 不應對 demo_entry_attempts 有任何權限';
  end if;
  if not (
    has_table_privilege('service_role', 'public.demo_entry_attempts', 'select')
    and has_table_privilege('service_role', 'public.demo_entry_attempts', 'insert')
    and has_table_privilege('service_role', 'public.demo_entry_attempts', 'update')
    and has_table_privilege('service_role', 'public.demo_entry_attempts', 'delete')
  ) then
    raise exception '0022 自我檢查失敗：service_role 應有 select／insert／update／delete';
  end if;
end;
$$;

-- 新增了 RPC，比照 0017～0021 通知 PostgREST 重載 schema cache。
notify pgrst, 'reload schema';

commit;
