-- 回滾 0029_text_length_checks.sql
-- 移除 services 與 store_settings 上的六個長度 CHECK。不動資料、欄位、policy、grant，也不動 0006 既有的
-- store_settings_description_length／store_settings_phone_length。
--
-- 警告：回滾等於重新打開缺口——Demo 體驗帳號可以對這兩張表的既有列塞入任意大的字串，繞過 0027 的列數上限、
-- 灌爆免費方案的資料庫容量。回滾期間請確認 Demo 入口已關閉（DEMO_ENABLED=false 並執行 demo:disable），或接受這個風險。
-- 若只是想暫時放行某一個欄位，不必整份回滾，貼對應的 drop constraint 那一行即可（見 0029 檔頭）。
-- 可重複執行（idempotent）。請在 SQL Editor 整份執行。

begin;

-- 同 0029：等不到 ACCESS EXCLUSIVE 鎖 5 秒就失敗並整份回滾，不讓前台查詢排隊卡住。
set local lock_timeout = '5s';

alter table public.services drop constraint if exists services_name_length;
alter table public.services drop constraint if exists services_description_length;
alter table public.store_settings drop constraint if exists store_settings_name_length;
alter table public.store_settings drop constraint if exists store_settings_address_length;
alter table public.store_settings drop constraint if exists store_settings_logo_url_length;
alter table public.store_settings drop constraint if exists store_settings_cover_image_url_length;

-- 尾端自我檢查：六個 CHECK 都已移除，且 0006 的兩個既有 CHECK 仍在。
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname in (
      'services_name_length',
      'services_description_length',
      'store_settings_name_length',
      'store_settings_address_length',
      'store_settings_logo_url_length',
      'store_settings_cover_image_url_length'
    )
  ) then
    raise exception '0029_down 自我檢查失敗：仍有長度 CHECK constraint 未移除';
  end if;

  if (
    select count(*) from pg_constraint
    where conrelid = 'public.store_settings'::regclass
      and conname in ('store_settings_description_length', 'store_settings_phone_length')
  ) <> 2 then
    raise exception '0029_down 自我檢查失敗：0006 既有的 store_settings_description_length／store_settings_phone_length 不應被動到';
  end if;
end $$;

commit;
