-- TASK-113（Demo 體驗帳戶：Storage 擁有者限制與 Demo 上傳上限）
-- 補三個 Storage 缺口。**不改任何既有 policy、bucket 或物件**，只新增 RESTRICTIVE policy 與一個 BEFORE INSERT 觸發器：
--
--   1. admin-assets 的 update／delete 既有 policy 只檢查 is_admin()，不看擁有者。Demo 帳戶就是管理員，
--      所以能刪掉或換掉 designer001 的頭像；而每日還原刻意不動 designer001，成為永久的跨使用者影響。
--      新增 RESTRICTIVE policy：admin-assets 的 update／delete 還必須 owner_id = auth.uid()::text。
--   2. Demo 不允許任何 update（RESTRICTIVE）。實測發現 storage-api 的 move 可把物件從 store-assets 搬進 admin-assets，
--      繞過「物件數上限」；本專案的上傳流程只用 insert（新 uuid 路徑、不帶 upsert），不需要 update。
--   3. Demo 可以無限上傳 5MB 檔案，可能灌爆免費方案的 Storage 配額、拖垮整個正式專案（含前台預約）。
--      上限用 BEFORE INSERT 觸發器（不是 RLS policy）：實測發現 RLS 只在 storage-api 寫入前的「預檢」生效，
--      簽名上傳網址（先簽出大量網址再逐一上傳）與並行上傳都能超過上限；觸發器在資料列真正寫入時執行，
--      並以 advisory lock 讓同一帳戶的寫入排隊，才是硬上限。
--      規則：擁有者是 Demo 帳戶（auth.users 的 app_metadata.is_demo = 'true'）的物件，在 admin-assets／store-assets／
--      designer-assets 每個 bucket 最多 30 個；第 31 個起以 42501 拒絕（storage-api 回「違反資料列安全政策」）。
--      還原（TASK-109）會清掉 Demo 的孤兒物件，所以每日重置。
--
-- 為什麼是 RESTRICTIVE：多條 PERMISSIVE policy 是「任一條通過即可」，再加一條 PERMISSIVE 只會放寬；
-- RESTRICTIVE 是「與既有 policy 同時成立才通過」，只會收緊，不需要動既有 policy。
--
-- 觸發器如何認出 Demo：用資料列的 owner_id（storage-api 一律取自使用者 JWT 的 sub）去查 auth.users 的 app_metadata，
-- 不讀 JWT claim——storage-api 的實際寫入走的不是使用者連線，claim 可能不在。service_role 上傳的物件 owner_id 為 null，
-- 不受影響。app_metadata 使用者本人無法修改（0021 另有觸發器禁止變更 is_demo）。
--
-- 套用前後非 Demo 帳號行為：
--   * 非 Demo 管理員上傳／更新／刪除自己上傳的物件：不變（觸發器對非 Demo 只多一次 auth.users 主鍵查詢）。
--   * admin-assets：管理員只能改／刪自己上傳的物件。owner_id 為 null 的物件（例如 service_role 或 Dashboard 上傳的）
--     一般管理員也改不了、刪不了。2026-10-31 備份確認當時 50 個物件全部有 owner_id；TASK-112 第一次真實還原後，
--     service_role 複製進來的 seed 物件 owner_id 會是 null，這是預期的（Demo 與設計師動不了它們）。
--   * store-assets、designer-assets 的 update／delete 不受擁有者限制（不在本卡範圍；每日還原會補回）。
--   * service_role（BYPASSRLS）不受任何 policy 約束：還原、孤兒清理、腳本照舊。
--   * anon：沒有任何 storage.objects 寫入 policy，本來就不能寫。
--
-- 緊急停用上限觸發器（例如 Storage 升級後所有上傳都失敗時，第一步只貼這一行，不要用 _down.sql）：
--   drop trigger if exists demo_storage_cap_guard on storage.objects;
--
-- 套用順序：任何時間都可套用（只依賴 0001～0024 已存在的物件）；Demo 帳戶與上傳流程不需先存在。
-- 可重複執行（idempotent）；本檔也會移除先前版本的「insert 上限 policy」與計數函式（若存在）。
-- 回滾：0025_storage_owner_and_demo_caps_down.sql（警告：回滾等於重新打開缺口，見該檔說明）。
-- 請在 SQL Editor 整份執行（不要只選取一部分，否則不在 begin 交易內、失敗時無法整份回滾）。
-- 若託管 Supabase 不允許在 storage.objects 建立觸發器，建立步驟會失敗，整個交易回滾、不留下半套。
-- 要調整上限：把 demo_storage_cap_guard() 內的 30 改成新值後整份重跑（日後若多個上限集中管理，請另開 migration）。
--
-- 套用後的驗證查詢：
--   select policyname, permissive, roles, cmd from pg_policies
--     where schemaname = 'storage' and tablename = 'objects' and permissive = 'RESTRICTIVE' order by policyname;
--   -- 預期：3 列，roles 皆為 {authenticated}：delete（owner）、update（owner）、update（demo no update）
--   select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and permissive = 'PERMISSIVE';
--   -- 預期：11（與套用前相同；本檔沒有新增或修改任何 PERMISSIVE policy）
--   select tgname, tgenabled from pg_trigger
--     where tgrelid = 'storage.objects'::regclass and tgname = 'demo_storage_cap_guard';
--   -- 預期：1 列，tgenabled = O

begin;

-- 依賴檢查：缺少前置物件時直接中止，不留下半套。
do $$
declare
  v_missing text;
begin
  if to_regclass('storage.objects') is null or to_regclass('storage.buckets') is null then
    raise exception '0025 需要 Supabase Storage（storage.objects／storage.buckets 不存在）';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'storage' and table_name = 'objects' and column_name = 'owner_id'
  ) then
    raise exception '0025 需要 storage.objects.owner_id 欄位（此 Supabase 版本沒有；請回報，不要硬套）';
  end if;

  if to_regclass('auth.users') is null then
    raise exception '0025 需要 auth.users';
  end if;

  select string_agg(b, ', ' order by b) into v_missing
  from unnest(array['admin-assets', 'store-assets', 'designer-assets']) b
  where not exists (select 1 from storage.buckets where id = b);
  if v_missing is not null then
    raise exception '0025 缺少 bucket：%（請先套用 0006、0007、0017）', v_missing;
  end if;

  -- 記下套用前所有 PERMISSIVE policy 的內容指紋，尾端自我檢查確認本檔沒有動到它們（交易內有效）。
  perform set_config(
    'app.permissive_before',
    coalesce((
      select md5(string_agg(policyname || '|' || cmd || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''), E'\n' order by policyname))
      from pg_policies
      where schemaname = 'storage' and tablename = 'objects' and permissive = 'PERMISSIVE'
    ), ''),
    true
  );
end $$;

-- 清掉先前版本的 insert 上限 policy 與計數函式（RLS 預檢版本，已由下方觸發器取代）。
drop policy if exists "restrict demo storage insert cap" on storage.objects;
drop function if exists public.demo_owned_object_count(text);

-- ============================================================
-- RESTRICTIVE policy 1／2：admin-assets 的 update、delete 限擁有者
-- ============================================================
-- 其他 bucket 的列不受影響（bucket_id <> 'admin-assets' 時條件恆為真）。
drop policy if exists "restrict admin assets update to owner" on storage.objects;
create policy "restrict admin assets update to owner"
  on storage.objects
  as restrictive
  for update
  to authenticated
  using (bucket_id <> 'admin-assets' or owner_id = (select auth.uid())::text)
  with check (bucket_id <> 'admin-assets' or owner_id = (select auth.uid())::text);

drop policy if exists "restrict admin assets delete to owner" on storage.objects;
create policy "restrict admin assets delete to owner"
  on storage.objects
  as restrictive
  for delete
  to authenticated
  using (bucket_id <> 'admin-assets' or owner_id = (select auth.uid())::text);

-- ============================================================
-- RESTRICTIVE policy 3：Demo 不允許任何 update（含 move、upsert 覆寫）
-- ============================================================
-- 非 Demo 帳號恆為真，不受影響。Demo 的 JWT 判斷來自 app_metadata（使用者本人無法修改）。
drop policy if exists "restrict demo storage no update" on storage.objects;
create policy "restrict demo storage no update"
  on storage.objects
  as restrictive
  for update
  to authenticated
  using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'is_demo', '') <> 'true');

-- ============================================================
-- 觸發器：Demo 擁有的物件數上限（每個公開 bucket 30 個）
-- ============================================================
-- SECURITY DEFINER、search_path 為空：要讀 auth.users 與（不受 RLS 影響地）數 storage.objects。
-- 非 Demo、非目標 bucket、owner_id 為 null 或不像 uuid 的列，在查詢 auth.users 之前就直接放行。
-- 這個函式出錯會擋住所有人的上傳，所以刻意寫得很短、不做多餘判斷；緊急停用見檔頭。
create or replace function public.demo_storage_cap_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_count integer;
begin
  if new.bucket_id not in ('admin-assets', 'store-assets', 'designer-assets') then
    return new;
  end if;
  if new.owner_id is null or new.owner_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return new;
  end if;
  v_owner := new.owner_id::uuid;

  if not exists (
    select 1 from auth.users u
    where u.id = v_owner and coalesce(u.raw_app_meta_data ->> 'is_demo', '') = 'true'
  ) then
    return new;
  end if;

  -- 同一個帳戶的寫入排隊：鎖到交易結束，後面的人才看得到前面已提交的列，上限才是硬的。
  perform pg_advisory_xact_lock(hashtextextended('demo-storage-cap:' || new.owner_id, 0));

  select count(*)::integer into v_count
  from storage.objects o
  where o.bucket_id = new.bucket_id and o.owner_id = new.owner_id;

  if v_count >= 30 then
    raise exception 'new row violates row-level security policy (demo storage cap: % objects per bucket)', 30
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- 觸發器函式不需要任何角色的 execute 權限（只在 create trigger 時檢查建立者）；全部收回，避免被當一般函式呼叫。
revoke execute on function public.demo_storage_cap_guard() from public, anon, authenticated;

drop trigger if exists demo_storage_cap_guard on storage.objects;
create trigger demo_storage_cap_guard
  before insert on storage.objects
  for each row
  execute function public.demo_storage_cap_guard();

notify pgrst, 'reload schema';

-- 尾端自我檢查：三條 policy 都是 RESTRICTIVE＋authenticated；PERMISSIVE policy 內容沒變；
-- 觸發器已啟用；函式是 SECURITY DEFINER、search_path 為空、擁有者可繞過 RLS、任何 API 角色都不能執行；舊物件已移除。
do $$
declare
  v_before text := current_setting('app.permissive_before');
  v_after text;
begin
  if (
    select count(*) from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and permissive = 'RESTRICTIVE'
      and roles = '{authenticated}'::name[]
      and policyname in (
        'restrict admin assets update to owner',
        'restrict admin assets delete to owner',
        'restrict demo storage no update'
      )
  ) <> 3 then
    raise exception '0025 自我檢查失敗：三條 RESTRICTIVE policy 沒有全部建立成功';
  end if;

  select coalesce(md5(string_agg(policyname || '|' || cmd || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''), E'\n' order by policyname)), '')
  into v_after
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects' and permissive = 'PERMISSIVE';
  if v_after <> v_before then
    raise exception '0025 自我檢查失敗：既有 PERMISSIVE policy 的內容在本檔執行期間變動了（本檔不得動到既有 policy）';
  end if;

  if not exists (
    select 1 from pg_trigger t
    where t.tgrelid = 'storage.objects'::regclass
      and t.tgname = 'demo_storage_cap_guard'
      and t.tgenabled = 'O'
      and not t.tgisinternal
  ) then
    raise exception '0025 自我檢查失敗：demo_storage_cap_guard 觸發器不存在或未啟用';
  end if;

  if not exists (
    select 1 from pg_proc p
    join pg_roles r on r.oid = p.proowner
    where p.oid = 'public.demo_storage_cap_guard()'::regprocedure
      and p.prosecdef
      and p.proconfig @> array['search_path=""']
      and r.rolbypassrls
  ) then
    raise exception '0025 自我檢查失敗：demo_storage_cap_guard 必須是 SECURITY DEFINER、search_path 為空，且擁有者可繞過 RLS（否則計數永遠是 0，上限等於失效）';
  end if;

  if has_function_privilege('anon', 'public.demo_storage_cap_guard()', 'execute')
     or has_function_privilege('authenticated', 'public.demo_storage_cap_guard()', 'execute') then
    raise exception '0025 自我檢查失敗：anon／authenticated 不應能執行 demo_storage_cap_guard';
  end if;

  if to_regprocedure('public.demo_owned_object_count(text)') is not null
     or exists (
       select 1 from pg_policies
       where schemaname = 'storage' and tablename = 'objects' and policyname = 'restrict demo storage insert cap'
     ) then
    raise exception '0025 自我檢查失敗：先前版本的 insert 上限 policy／計數函式沒有移除';
  end if;
end $$;

commit;
