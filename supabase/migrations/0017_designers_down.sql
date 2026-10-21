-- 回滾 0017_designers.sql
-- 警告：本回滾具破壞性且不可逆——drop table 會永久刪除全部設計師資料（名稱、簡介、專長、IG、
-- 頭像網址、提供的服務、請假日、作品集資料列）；drop column 會永久刪除 appointments.designer_id
-- （預約本身不受影響，但哪位設計師負責的資訊會消失）。
-- 回滾順序（重要）：先在 Vercel 回滾前端 → 再執行 0018_down（如果已套用）→ 最後才是本檔案。
-- 順序反過來，新前端帶 p_designer_id 的呼叫會找不到函式（PGRST202），整個預約功能中斷；
-- 0018 套用後 appointments.designer_id 是 not null 且被 exclusion constraint 使用，本檔案會因為
-- 依賴關係（restrict）直接報錯中止，不會靜默破壞。
-- 執行前先匯出 designers／designer_services／designer_leaves／designer_portfolio_images 四張表，以及
-- appointments 的 (id, designer_id)，本腳本之後無法復原這些資料。
-- 另外提醒（0018 還沒寫，寫 0018_down 時要處理）：多位設計師正式上線後，0018_down 要還原成全店
-- exclusion constraint；只要已經有不同設計師在同一時段的預約，還原就會失敗，回滾不再乾淨。
-- designer-assets bucket：刪除 bucket 之前，若底下仍有已上傳的物件（頭像／作品集圖檔），必須先
-- 手動清空，否則本腳本會直接中止（比照 0006_store_settings_down.sql，避免留下無法從 UI 管理、
-- 但物件仍佔用空間的孤兒 bucket）。若 Supabase 平台擋下對 storage.buckets 的直接 delete，
-- 改在 Dashboard 的 Storage 頁面刪除 designer-assets bucket，再把這一段拿掉重新執行。

begin;

drop policy if exists "admin delete designer assets" on storage.objects;
drop policy if exists "admin update designer assets" on storage.objects;
drop policy if exists "admin insert designer assets" on storage.objects;
drop policy if exists "admin read designer assets" on storage.objects;

do $$
begin
  if exists (select 1 from storage.objects where bucket_id = 'designer-assets') then
    raise exception 'designer-assets bucket 底下仍有物件，請先手動清空（刪除頭像與作品集檔案）再重新執行本回滾腳本';
  end if;
end $$;

delete from storage.buckets where id = 'designer-assets';

-- appointments 先處理：欄位被 designer_id 外鍵參照 designers，必須先拿掉外鍵欄位才能 drop designers。
revoke select (designer_id) on public.appointments from authenticated;
drop index if exists public.appointments_designer_id_start_at_idx;
alter table public.appointments drop column if exists designer_id restrict;

-- restrict（非 cascade）：若之後有其他 migration 讓別的物件依賴這些表，這裡會直接報錯中止，
-- 而不是靜默把依賴物件一併砍掉。
drop table if exists public.designer_portfolio_images restrict;
drop table if exists public.designer_leaves restrict;
drop table if exists public.designer_services restrict;
drop table if exists public.designers restrict;

drop function if exists public.designer_portfolio_limit_check();
drop function if exists public.designer_specialties_valid(text[]);

notify pgrst, 'reload schema';

commit;
