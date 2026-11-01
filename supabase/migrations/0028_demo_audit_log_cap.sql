-- TASK-122（Demo 體驗帳戶：Demo 的 audit_log 容量防護，TASK-116 審查 M1）
-- 對 public.audit_log 加一個 BEFORE INSERT 觸發器：**只有 Demo 體驗帳號的請求**（JWT 的 app_metadata.is_demo = 'true'）受以下限制：
--   1. 該帳戶自己在 audit_log 的列數已達 500 時，新增被拒絕（每帳戶筆數上限）；
--   2. event_type／entity_type 超過 64 位元組的列被拒絕（單筆大小上限，見下）；
--   3. 單一請求（交易）最多寫入 20 列（限制「寫入後再中止」造成的膨脹，見下）。
-- 目的：Demo 可直接用 REST 對 audit_log insert（authenticated 有欄位層級 insert、policy 只看 is_admin()），
-- 沒有筆數上限也沒有 event_type 長度上限；灌爆免費方案的 500 MB 會拖垮整個正式專案（含前台預約）。
-- 與 0025（Storage 物件數上限）、0027（六張表筆數上限）互補。
--
-- 為什麼是「每帳戶」計數而不是整張表總列數：designer001 的紀錄會無限成長，總列數上限遲早讓 Demo 永遠被擋。
-- actor_id 由欄位預設值 auth.uid() 帶入、使用者無法指定（authenticated 對 actor_id 沒有 insert 權限，0019），
-- 函式另外要求 new.actor_id 與 JWT 的 sub 一致（日後若有 SECURITY DEFINER RPC 代為寫入自訂 actor_id，也不會悄悄繞過計數）。
-- 每日還原只刪 actor_id = Demo 的列（0024），額度每日重置。上限是「絕對筆數」不是每日筆數：即使某天還原失敗也不會繼續成長。
--
-- 容量估算（為什麼要有第 2 項）：0019 對 event_type／entity_type 只有格式檢查（正規表示式）、沒有長度限制，
-- 若只限筆數，Demo 可以把單筆做得很大（TOAST 儲存的長字串），500 筆 × 大欄位仍可灌滿配額。加上 64 位元組上限後，
-- 每筆最壞約 20 KB（summary／changes 各 4096 位元組的文字上限，jsonb 二進位表示可能放大到 2～3 倍；entity_id 已有 128 字元上限，0019），
-- 500 筆最多約 10～12 MB，不到免費方案 500 MB 的 3%。真實事件名稱最長約 33 字元，64 留有餘裕。
-- 第 3 項：筆數是以「已提交的列」計算，Demo 可送出「額度內的列＋一列壞資料」的多列 insert，前面的列寫入後整句中止、額度不變，
-- 可無限重複並留下待回收的 dead tuple。後台的 recordAdminAction 每次只寫 1 列，所以單一請求 20 列的上限不影響正常使用。
--
-- 誰不受影響：一般管理員（含 designer001）、service role、匿名、psql／SQL Editor——它們的請求沒有 Demo claim，
-- 函式在第一個判斷就放行，不做任何查詢。誰受影響：Demo 體驗帳號的請求。
--
-- 規則細節：
--   * 硬上限：先 pg_advisory_xact_lock（key 帶 actor_id）讓同一帳戶的寫入排隊，再計數；並行時不會超出。
--     這依賴 READ COMMITTED 隔離等級（PostgREST 預設）：取鎖後的 count 要看得到前面已提交的列；
--     不得以 repeatable read 以上的隔離等級寫入 audit_log。
--   * 取鎖前先設定 lock_timeout = 2s（只影響這個 Demo 請求自己的交易）：攻擊者佔住鎖時，排隊的 Demo 請求最多等 2 秒就失敗，
--     不會長時間佔住 PostgREST 連線而拖累前台匿名預約。不影響「不超過上限」；極端排隊時 Demo 會多出 55P03 失敗。
--   * 成本：每一筆 Demo 寫入都會在鎖內對 audit_log 做一次 count(*) where actor_id = …（audit_log 只有主鍵與 (entity_type, id desc) 兩個索引，
--     所以是全表掃描）。目前資料量可忽略；非 Demo 不受影響。重新評估門檻：audit_log 超過約 10 萬列時，考慮加 (actor_id) 索引
--     （還原的 delete … where actor_id = Demo 也會受益）。不在本檔建立，避免改動既有資料表。
--   * 被拒絕時 errcode P0001、訊息以 DEMO_ROW_CAP: 開頭，hint 是白話說明（與 0027 同格式）：
--       DEMO_ROW_CAP: audit_log (cap 500)                      筆數已達上限
--       DEMO_ROW_CAP: audit_log (row too large)                event_type／entity_type 超過 64 位元組
--       DEMO_ROW_CAP: audit_log (max 20 rows per request)      單一請求超過 20 列
--       DEMO_ROW_CAP: audit_log (invalid actor)                沒有 sub，或 actor_id 與 JWT 的 sub 不一致
--   * 後台的 recordAdminAction 永不 throw（失敗只 console.warn），所以 Demo 觸頂後後台操作照常，
--     只是稽核列表不再新增紀錄，伺服器日誌每次多一行 P0001 警告（預期內，見 docs/demo-account.md），每日還原後恢復。
--     Demo 的額度是所有訪客共用的（只有一個 Demo 帳戶）。
--   * 只管新增：不影響既有資料，也不影響 update／delete（authenticated 本來就沒有）。
--   * 若日後重建 Demo 帳戶（新的 uid），舊帳戶最多 500 筆紀錄不會被還原刪除（還原只刪目前 Demo 的列），手冊有清理語句。
--
-- 不需要改 reset_demo_data：audit_log 不在它覆寫的十一張表內（還原只 delete … where actor_id = Demo），
-- 它的觸發器白名單只檢查那十一張表，所以本檔不像 0027 那樣重新定義它，0027_down 的警告也不受影響。
--
-- 觸發器如何認出 Demo：讀呼叫端 JWT claims 字串，**預篩與解析用同一份字串**（不再另外呼叫 auth.jwt()，避免兩者讀到不同來源），
-- 以其中簽章後的 app_metadata.is_demo 為準（user_metadata 或頂層欄位出現同名鍵不算），與 0026／0027 的判斷結果相同。
-- audit_log 的寫入走 PostgREST（同一個交易內有 request.jwt.claims）。
-- 失敗方向：claims 字串裡沒有 is_demo 就直接放行，不解析 JSON、不依賴 auth schema——
-- 即使日後平台改動，一般管理員與每日還原也不會被連帶擋住；只有「疑似 Demo」的請求才會解析 JSON，解析失敗就拒絕。
--
-- 套用前後非 Demo 帳號行為：不變（觸發器對非 Demo 只多一次 JWT 字串判斷）。既有資料、policy、grant、其他觸發器都不動。
-- 套用順序：任何時間都可套用（只依賴 0019 已存在的物件）；Demo 帳戶不需先存在。
-- 可重複執行（idempotent）：create or replace、drop trigger if exists 後重建。
-- 回滾：0028_demo_audit_log_cap_down.sql（移除上限；警告：等於重新打開缺口，見該檔說明）。
-- 請在 SQL Editor 整份執行（不要只選取一部分，否則不在 begin 交易內、失敗時無法整份回滾）。
--
-- 緊急停用（例如上限設太低導致 Demo 稽核紀錄無法新增時，只貼這一行，不要用 _down.sql）：
--   drop trigger if exists demo_audit_log_cap on public.audit_log;
-- 要調整上限：把 demo_audit_log_cap_guard() 內 v_cap 的數字改掉後整份重跑，並同步更新
-- tests/lib/demo-audit-log-cap-migration.test.ts 的核准值與 verification/TASK-122-verify.sql 的 v_cap。
--
-- 套用後的驗證：
--   1. 貼上並執行 ai/artifacts/Demo 體驗帳戶/verification/TASK-122-verify.sql（整個交易以例外收尾，保證 rollback，
--      不留下任何資料；訊息內列出各項結果）。
--   2. select c.relname, t.tgname, t.tgenabled from pg_trigger t join pg_class c on c.oid = t.tgrelid
--        where t.tgname = 'demo_audit_log_cap' and not t.tgisinternal;   -- 預期 1 列（audit_log）、tgenabled 'O'

begin;

-- 依賴檢查：缺少前置物件時直接中止，不留下半套。
do $$
begin
  if to_regclass('public.audit_log') is null then
    raise exception '0028 缺少前置資料表 public.audit_log（請先套用 0019）';
  end if;
end
$$;

-- ============================================================
-- 觸發器函式：Demo 的 audit_log 容量防護
-- ============================================================
-- SECURITY DEFINER、search_path 為空：計數必須是該帳戶的真實列數，不能被呼叫者的 RLS 縮小
-- （audit_log 的 select policy 是 is_admin()，縮小後上限可被繞過）。
-- 非 Demo 的請求在第一個判斷就 return，不做任何查詢也不解析 JSON。
-- 這個函式出錯會擋住 Demo 的稽核寫入，所以刻意寫得很短；緊急停用見檔頭。
create or replace function public.demo_audit_log_cap_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claims text;
  v_jwt jsonb;
  v_actor uuid;
  v_cap constant integer := 500;
  v_count bigint;
  v_rows integer;
begin
  -- 預篩：claims 字串裡根本沒有 is_demo 就一定不是 Demo，立刻放行（不解析 JSON）。
  v_claims := coalesce(nullif(current_setting('request.jwt.claims', true), ''), nullif(current_setting('request.jwt.claim', true), ''));
  if v_claims is null or strpos(v_claims, 'is_demo') = 0 then
    return new;
  end if;

  -- 疑似 Demo：解析「同一份」字串；以簽章後的 app_metadata.is_demo 為準。無法解析就讓例外往外丟（拒絕這筆寫入）。
  v_jwt := v_claims::jsonb;
  if coalesce(v_jwt -> 'app_metadata' ->> 'is_demo', '') <> 'true' then
    return new;
  end if;

  -- Demo 的請求一定有 sub；actor_id 必須與它一致（欄位預設值 auth.uid()）。沒有 actor 或不一致就無法正確計數，直接拒絕。
  v_actor := nullif(v_jwt ->> 'sub', '')::uuid;
  if v_actor is null or new.actor_id is distinct from v_actor then
    raise exception 'DEMO_ROW_CAP: audit_log (invalid actor)'
      using errcode = 'P0001',
            hint = '體驗帳號的稽核紀錄無法寫入，每日凌晨會自動還原。';
  end if;

  -- 單筆大小：event_type／entity_type 在 0019 只有格式檢查、沒有長度限制（entity_id 有 128 字元上限）。
  if octet_length(new.event_type) > 64 or octet_length(new.entity_type) > 64 then
    raise exception 'DEMO_ROW_CAP: audit_log (row too large)'
      using errcode = 'P0001',
            hint = '體驗帳號的稽核紀錄內容過大，無法寫入。';
  end if;

  -- 單一請求（交易）最多 20 列：交易內計數器（set_config 的第三個參數 true = 交易結束即失效，使用者無法預先設定）。
  v_rows := coalesce(nullif(current_setting('demo.audit_rows', true), ''), '0')::integer + 1;
  perform set_config('demo.audit_rows', v_rows::text, true);
  if v_rows > 20 then
    raise exception 'DEMO_ROW_CAP: audit_log (max 20 rows per request)'
      using errcode = 'P0001',
            hint = '體驗帳號單次請求寫入的稽核紀錄筆數過多。';
  end if;

  -- 同一個帳戶的 Demo 寫入排隊：鎖到交易結束，後面的人才看得到前面已提交的列，上限才是硬的。
  -- lock_timeout 只設在這個交易內：等不到鎖就失敗，不長時間佔住連線。
  perform set_config('lock_timeout', '2s', true);
  perform pg_advisory_xact_lock(hashtextextended('demo-audit-cap:' || v_actor::text, 0));

  select count(*) into v_count from public.audit_log where actor_id = v_actor;

  if v_count >= v_cap then
    raise exception 'DEMO_ROW_CAP: audit_log (cap %)', v_cap
      using errcode = 'P0001',
            hint = '體驗帳號的稽核紀錄筆數已達上限，每日凌晨會自動還原。';
  end if;
  return new;
end;
$$;

-- 觸發器函式不需要任何角色的 execute 權限（只在 create trigger 時檢查建立者）；全部收回，避免被當一般函式呼叫。
revoke execute on function public.demo_audit_log_cap_guard() from public, anon, authenticated, service_role;

-- ============================================================
-- 觸發器
-- ============================================================
drop trigger if exists demo_audit_log_cap on public.audit_log;
create trigger demo_audit_log_cap
  before insert on public.audit_log
  for each row
  execute function public.demo_audit_log_cap_guard();

-- 尾端自我檢查：觸發器存在、啟用、BEFORE INSERT ROW 且只掛在 audit_log；函式是 SECURITY DEFINER、search_path 為空、
-- 擁有者可繞過 RLS（否則計數永遠是 0，上限等於失效）、API 角色都不能執行。
do $$
begin
  if (
    select count(*) from pg_trigger t
    where t.tgname = 'demo_audit_log_cap'
      and t.tgrelid = 'public.audit_log'::regclass
      and not t.tgisinternal
      and t.tgenabled = 'O'
      and (t.tgtype & 1) = 1   -- FOR EACH ROW
      and (t.tgtype & 2) = 2   -- BEFORE
      and (t.tgtype & 4) = 4   -- INSERT
      and (t.tgtype & (8 | 16 | 32)) = 0   -- 只有 INSERT
      and t.tgfoid = 'public.demo_audit_log_cap_guard()'::regprocedure
  ) <> 1 then
    raise exception '0028 自我檢查失敗：demo_audit_log_cap 觸發器沒有建立成功（BEFORE INSERT ROW、已啟用、掛在 audit_log）';
  end if;

  if not exists (
    select 1 from pg_proc p
    join pg_roles r on r.oid = p.proowner
    where p.oid = 'public.demo_audit_log_cap_guard()'::regprocedure
      and p.prosecdef
      and p.proconfig @> array['search_path=""']
      and r.rolbypassrls
  ) then
    raise exception '0028 自我檢查失敗：demo_audit_log_cap_guard 必須是 SECURITY DEFINER、search_path 為空，且擁有者可繞過 RLS（否則計數永遠是 0，上限等於失效）';
  end if;

  if has_function_privilege('anon', 'public.demo_audit_log_cap_guard()', 'execute')
     or has_function_privilege('authenticated', 'public.demo_audit_log_cap_guard()', 'execute')
     or has_function_privilege('service_role', 'public.demo_audit_log_cap_guard()', 'execute') then
    raise exception '0028 自我檢查失敗：anon／authenticated／service_role 不應能執行 demo_audit_log_cap_guard';
  end if;
end $$;

commit;
