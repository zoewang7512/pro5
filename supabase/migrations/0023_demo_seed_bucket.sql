-- TASK-107（Demo 體驗帳戶：seed 圖片素材）
-- 建立私有 Storage bucket `demo-seed`，存放 Demo 還原要回到的 seed 原圖。還原時（TASK-109）再由此處補齊到
-- 公開 bucket 的固定路徑。圖片的匯入由 scripts/upload-demo-images.mjs（--from-public）負責，不在 migration 內。
--
-- 內容只有一件事：insert into storage.buckets。
--   * public = false：沒有公開網址；只有 service_role（BYPASSRLS）能讀寫。
--   * **不建立任何 storage.objects policy**：anon／authenticated 在 RLS 預設拒絕下完全讀不到、列不出、寫不進
--     （含 Demo 帳戶——Demo 是 authenticated + is_admin()，但沒有任何 policy 提到 demo-seed）。
--   * 5MB 上限與 MIME 白名單（jpg／png／webp，不含 svg）同三個既有公開 bucket。
--   * 路徑規則：demo-seed/<來源 bucket>/<原路徑>，例如 demo-seed/designer-assets/portfolio/<designer_id>/<uuid>.webp。
--
-- 套用前後既有功能完全不變：本檔不碰任何既有 bucket、policy 或物件。
-- 可重複執行（idempotent）：on conflict do update（設定漂移時拉回，比照 0006／0007／0017）。
-- 對應回滾腳本：0023_demo_seed_bucket_down.sql（bucket 內仍有物件時會拒絕執行，見該檔說明）。
-- 請在 SQL Editor 整份執行（不要只選取一部分，否則不在 begin 交易內、失敗時無法整份回滾）。
-- 部署順序：先套用本檔案，再執行 `npm run demo:upload-images -- --from-public`。
--
-- 套用後的驗證查詢：
--   select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'demo-seed';
--   -- 預期：demo-seed, false, 5242880, {image/jpeg,image/png,image/webp}
--   select policyname, permissive, roles, cmd, qual, with_check from pg_policies
--     where schemaname = 'storage' and tablename = 'objects' order by policyname;
--   -- 預期：目前 11 列（store-assets 4、admin-assets 4、designer-assets 3），全是 PERMISSIVE、roles 為 {authenticated}，
--   --       每列的 qual／with_check 都以 bucket_id = '<固定 bucket>' 開頭。
--   select policyname from pg_policies
--     where schemaname = 'storage' and tablename = 'objects' and permissive = 'PERMISSIVE'
--       and (coalesce(qual, '') || coalesce(with_check, '')) !~ $re$bucket_id = '(store-assets|admin-assets|designer-assets)'$re$;
--   -- 預期：0 列（沒有任何允許型 policy 不限定 bucket——那種 policy 會讓 Demo 帳戶讀得到 demo-seed）

begin;

-- 依賴檢查：缺少 Storage 時直接中止，不留下半套（非 Supabase 環境會在這裡明確失敗）。
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise exception '0023 需要 Supabase Storage（storage.buckets 不存在）';
  end if;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('demo-seed', 'demo-seed', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 尾端自我檢查：
--   1. bucket 必須是私有。
--   2. 沒有任何「允許型（PERMISSIVE）」policy 不限定 bucket：這種 policy（例如 Dashboard 手動建的
--      using (public.is_admin())）不會出現 demo-seed 這個字，卻會讓 Demo 帳戶（authenticated + is_admin()）讀寫 demo-seed。
--      現有 policy 都以 bucket_id = '<固定 bucket>' 開頭；不符合就 raise，並列出 policy 名稱。
--      這是啟發式檢查（看文字，不是證明），實測見 tests/demo-seed-bucket.integration.test.ts（is_admin 帳號被拒絕）。
--   3. 沒有任何允許型 policy 提到 demo-seed（私有 bucket 不得有 policy）。
--      限制型（RESTRICTIVE）policy 只會收窄權限，不在 2、3 的檢查範圍；之後（如 TASK-113）新增限制型 policy 重跑本檔不會被誤擋。
do $$
declare
  v_unbounded text;
begin
  if exists (select 1 from storage.buckets where id = 'demo-seed' and public) then
    raise exception '0023 自我檢查失敗：demo-seed 不是私有 bucket';
  end if;

  select string_agg(policyname, ', ' order by policyname) into v_unbounded
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects' and permissive = 'PERMISSIVE'
    and (coalesce(qual, '') || coalesce(with_check, '')) !~ $re$bucket_id = '(store-assets|admin-assets|designer-assets)'$re$;
  if v_unbounded is not null then
    raise exception '0023 自我檢查失敗：這些 storage.objects 允許型 policy 沒有限定 bucket，可能涵蓋 demo-seed：%', v_unbounded;
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and permissive = 'PERMISSIVE'
      and (coalesce(qual, '') || coalesce(with_check, '')) like '%demo-seed%'
  ) then
    raise exception '0023 自我檢查失敗：有允許型 storage.objects policy 提到 demo-seed，私有 bucket 不得有 policy';
  end if;
end $$;

commit;
