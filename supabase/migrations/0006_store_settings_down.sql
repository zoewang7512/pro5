-- 回滾 0006_store_settings.sql
-- 警告：本回滾具破壞性且不可逆——drop table store_settings 會永久刪除已設定的店名／地址／
-- 電話／簡介／圖片 URL；刪除 storage.buckets 的 store-assets 列之前，若該 bucket 底下仍有
-- 已上傳的物件（Logo／封面圖檔案），必須先手動清空，否則本腳本會直接中止、不刪除 bucket
-- （避免留下無法從 UI 管理、但物件仍佔用空間的孤兒 bucket 狀態）。
-- 順序警告：回滾前務必先確認沒有更新的 migration 依賴本檔案新增的 schema
-- （store_settings 表／store-assets bucket）。

begin;

drop policy if exists "admin delete store assets" on storage.objects;
drop policy if exists "admin update store assets" on storage.objects;
drop policy if exists "admin insert store assets" on storage.objects;
drop policy if exists "admin read store assets" on storage.objects;
drop policy if exists "public read store assets" on storage.objects;

do $$
begin
  if exists (select 1 from storage.objects where bucket_id = 'store-assets') then
    raise exception 'store-assets bucket 底下仍有物件，請先手動清空（刪除 Logo／封面圖檔案）再重新執行本回滾腳本';
  end if;
end $$;

delete from storage.buckets where id = 'store-assets';

-- restrict（非 cascade）：若之後有其他 migration 讓別的物件依賴上 store_settings
-- （例如外鍵、view），這裡會直接報錯中止，而不是靜默把那些依賴物件一併砍掉
-- （security-reviewer TASK-029 審查建議）。
drop table if exists public.store_settings restrict;

commit;
