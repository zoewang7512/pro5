-- TASK-113 回滾：移除 0025 新增的 RESTRICTIVE policy、上限觸發器與函式（含先前版本的 insert 上限 policy／計數函式，若存在），
-- 恢復套用前的行為：admin-assets 的 update／delete 只看 is_admin()；Demo 沒有上傳物件數上限，也可以 update（含 move）。
--
-- ★ 警告（安全降級）：回滾會重新打開下列缺口——Demo 帳戶（等同公開的管理員 session）能刪除或換掉 designer001 的頭像、
--   能無限上傳並灌爆 Storage 配額、能用 move 跨 bucket 搬物件。**DEMO_ENABLED=true 時**請先執行 `npm run demo:disable`
--   （或關閉 DEMO_ENABLED 並 Redeploy）再回滾，不要讓公開入口在沒有保護的狀態下開著。
--   若只是上傳全面失敗想緊急處理，第一步只需 `drop trigger if exists demo_storage_cap_guard on storage.objects;`，不必整份回滾。
--
-- 只動 0025 自己新增的物件，不碰任何既有 policy、bucket 或物件。可重複執行。請在 SQL Editor 整份執行。

begin;

drop policy if exists "restrict admin assets update to owner" on storage.objects;
drop policy if exists "restrict admin assets delete to owner" on storage.objects;
drop policy if exists "restrict demo storage no update" on storage.objects;
drop policy if exists "restrict demo storage insert cap" on storage.objects;

drop trigger if exists demo_storage_cap_guard on storage.objects;
drop function if exists public.demo_storage_cap_guard();
drop function if exists public.demo_owned_object_count(text);

notify pgrst, 'reload schema';

-- 驗證：不應再有任何 0025 的物件。
do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname in (
        'restrict admin assets update to owner',
        'restrict admin assets delete to owner',
        'restrict demo storage no update',
        'restrict demo storage insert cap'
      )
  )
  or exists (
    select 1 from pg_trigger where tgrelid = 'storage.objects'::regclass and tgname = 'demo_storage_cap_guard'
  )
  or to_regprocedure('public.demo_storage_cap_guard()') is not null
  or to_regprocedure('public.demo_owned_object_count(text)') is not null then
    raise exception '0025 回滾失敗：仍有 0025 的物件殘留';
  end if;
end $$;

commit;
