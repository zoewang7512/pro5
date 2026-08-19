-- 回滾 0007_admin_profile.sql
-- 警告：本回滾具破壞性且不可逆——drop column 會永久刪除已設定的顯示名稱／大頭貼網址；
-- 刪除 storage.buckets 的 admin-assets 列之前，若該 bucket 底下仍有已上傳的物件（大頭貼
-- 檔案），必須先手動清空，否則本腳本會直接中止、不刪除 bucket（避免留下無法從 UI 管理、
-- 但物件仍佔用空間的孤兒 bucket 狀態，比照 0006_store_settings_down.sql 既有做法）。
-- 順序警告：回滾前務必先確認沒有更新的 migration 依賴本檔案新增的 schema
-- （admins.display_name／avatar_url 欄位、get_admin_profile／update_admin_profile RPC、
-- admin-assets bucket）。

begin;

drop policy if exists "admin delete admin assets" on storage.objects;
drop policy if exists "admin update admin assets" on storage.objects;
drop policy if exists "admin insert admin assets" on storage.objects;
drop policy if exists "admin read admin assets" on storage.objects;

do $$
begin
  if exists (select 1 from storage.objects where bucket_id = 'admin-assets') then
    raise exception 'admin-assets bucket 底下仍有物件，請先手動清空（刪除大頭貼檔案）再重新執行本回滾腳本';
  end if;
end $$;

delete from storage.buckets where id = 'admin-assets';

drop function if exists public.update_admin_profile(text, text);
drop function if exists public.get_admin_profile();

alter table public.admins drop constraint if exists admins_avatar_url_length;
alter table public.admins drop constraint if exists admins_display_name_length;
alter table public.admins drop column if exists avatar_url;
alter table public.admins drop column if exists display_name;

commit;
