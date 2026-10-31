-- TASK-107 還原：移除私有 bucket `demo-seed`。
-- 只動本 migration 建立的 bucket；可重複執行。
--
-- 安全閥：bucket 內仍有物件時**拒絕執行**（不在這裡刪物件）。Supabase 也禁止直接以 SQL 刪除 storage.objects
-- （要走 Storage API 或 Dashboard）。請先在 Dashboard → Storage → demo-seed 清空整個 bucket（Empty bucket）
-- 之後再執行本檔。還原後 TASK-109 的還原編排找不到 demo-seed 會失敗，請同步停用排程還原（DEMO_RESET_ENABLED=false）。
-- 若 SQL 直接刪除 bucket 也被 Storage 的保護機制擋下，改在 Dashboard 刪除 bucket 即可（結果相同）。

begin;

do $$
begin
  if exists (select 1 from storage.objects where bucket_id = 'demo-seed') then
    raise exception '0023_down 中止：demo-seed 內仍有物件，請先在 Dashboard 清空 bucket';
  end if;
end $$;

delete from storage.buckets where id = 'demo-seed';

-- 預期：0
select count(*) as leftover_buckets from storage.buckets where id = 'demo-seed';

commit;
