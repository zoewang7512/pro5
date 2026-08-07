-- TASK-029（商店基本資料設定 架構基礎）
-- 新增 store_settings 單例資料表（固定 1 列，id 恆為 1）與對應 RLS policy（比照
-- business_hours／closed_dates 的模式：anon/authenticated 可讀，只有 is_admin() 可寫），
-- migration 內直接 seed 這唯一一列，確保應用層永遠查得到資料，不需要處理「零列」的特殊情境。
-- 同時新增 Supabase Storage public bucket store-assets（存放 Logo／封面圖）：公開讀取走
-- bucket 的 public 端點（繞過 RLS，見下方說明），storage.objects 的 RLS policy 只管寫入
-- （insert/update/delete 皆限 is_admin()，且路徑前綴限定 logo/／cover/）。
-- 純資料層＋Storage 基礎設施：本卡不含任何編輯/上傳邏輯，留給 TASK-030／TASK-031。
-- 可重複執行（idempotent）：使用 if not exists / drop ... if exists / on conflict。
-- 對應回滾腳本：0006_store_settings_down.sql
-- 編號說明：0005 已由 TASK-028（create_appointment RPC 加入 closed_dates 檢查）保留，
-- 該任務尚未實作，本卡不搶用該編號，避免未來兩者都要落地時衝突。

begin;

-- ============================================================
-- store_settings：店家基本資訊與品牌圖片，固定單例（僅 1 列，id 恆為 1）
-- ============================================================
create table if not exists public.store_settings (
  id int primary key default 1,
  name text not null default '',
  address text,
  phone text,
  description text,
  logo_url text,
  cover_image_url text,
  updated_at timestamptz not null default now()
);

alter table public.store_settings drop constraint if exists store_settings_singleton;
alter table public.store_settings
  add constraint store_settings_singleton check (id = 1);

-- 長度上限比照 feature-spec 的驗證規則（簡介 500 字、電話 20 字）：寫入路徑是直接
-- table update（沒有 RPC 可以集中做應用層驗證），這兩條 constraint 是唯一的伺服器端
-- 防線（architect TASK-029 審查建議）。name 刻意不加「非空白」constraint——seed 列
-- 的 name 本來就是空字串（代表「尚未設定」，見上方單例設計說明），資料庫層無法同時
-- 允許這一列存在又擋非空白，「店名必填」只能留給 TASK-030 的應用層驗證。
alter table public.store_settings drop constraint if exists store_settings_description_length;
alter table public.store_settings
  add constraint store_settings_description_length check (char_length(coalesce(description, '')) <= 500);

alter table public.store_settings drop constraint if exists store_settings_phone_length;
alter table public.store_settings
  add constraint store_settings_phone_length check (char_length(coalesce(phone, '')) <= 20);

alter table public.store_settings enable row level security;

drop policy if exists "public read store settings" on public.store_settings;
create policy "public read store settings"
  on public.store_settings
  for select
  to anon, authenticated
  using (true);

-- 拆成 insert／update 兩條、刻意不給 admin delete 權限：store_settings 的「永遠恰有 1 列」
-- 不變量目前只靠 migration seed，沒有資料庫層強制；若給 for all（含 delete），意外刪掉
-- id=1 會讓 .single() 查詢失敗、前後台整頁跟著壞掉。不需要「移除商店設定」這個操作
-- （欄位本身可以透過 update 清空成空字串/null，不需要真的刪列），排除 delete 沒有
-- 犧牲任何既有需求（security-reviewer TASK-029 審查意見）。
drop policy if exists "admin full access to store settings" on public.store_settings;
drop policy if exists "admin insert store settings" on public.store_settings;
create policy "admin insert store settings"
  on public.store_settings
  for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "admin update store settings" on public.store_settings;
create policy "admin update store settings"
  on public.store_settings
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 沿用 0001_core_schema.sql 已建立的 public.set_updated_at() 共用 trigger 函式。
drop trigger if exists store_settings_set_updated_at on public.store_settings;
create trigger store_settings_set_updated_at
  before update on public.store_settings
  for each row
  execute function public.set_updated_at();

insert into public.store_settings (id) values (1) on conflict (id) do nothing;

-- ============================================================
-- Storage：store-assets public bucket（Logo／封面圖）
-- ============================================================
-- file_size_limit（bytes，伺服器端強制）／allowed_mime_types 是縱深防禦的第一層：
-- TASK-031 的前端格式/大小驗證只是體驗優化，不能是唯一防線（security-reviewer
-- TASK-029 審查意見）。故意不允許 image/svg+xml——public bucket 的 URL 直接從 Supabase
-- 網域回傳，SVG 會在該網域執行內嵌 script，等同開放一個 stored XSS 管道。
-- on conflict 用 do update（而非 do nothing）：若 bucket 先前已用舊設定建立過（例如本
-- migration 重新套用以修正設定），確保設定不會漂移、悄悄維持舊值。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('store-assets', 'store-assets', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 不給 anon/authenticated 一般讀取 policy：public bucket 的公開讀取（前台顯示圖片）走
-- storage-api 的 /object/public/ 端點，繞過 RLS，不需要 select policy；若給了，額外賦予
-- 的其實是 storage.list() 的匿名列舉能力，對「顯示圖片」毫無必要，只留給 is_admin()
-- 供後台未來管理用途（security-reviewer TASK-029 審查意見）。
drop policy if exists "public read store assets" on storage.objects;
drop policy if exists "admin read store assets" on storage.objects;
create policy "admin read store assets"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'store-assets' and public.is_admin());

-- 路徑前綴限制（storage.foldername 取路徑第一段）：目前只有 is_admin() 能寫，不算真正
-- 可被利用的漏洞，但作為縱深防禦，確保 TASK-031 只能寫進 logo/ 或 cover/ 兩個既定前綴，
-- 不會不小心（或被繞過前端邏輯）寫進其他路徑（security-reviewer TASK-029 審查建議）。
drop policy if exists "admin insert store assets" on storage.objects;
create policy "admin insert store assets"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'store-assets'
    and public.is_admin()
    and (storage.foldername(name))[1] in ('logo', 'cover')
  );

drop policy if exists "admin update store assets" on storage.objects;
create policy "admin update store assets"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'store-assets' and public.is_admin())
  with check (
    bucket_id = 'store-assets'
    and public.is_admin()
    and (storage.foldername(name))[1] in ('logo', 'cover')
  );

drop policy if exists "admin delete store assets" on storage.objects;
create policy "admin delete store assets"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'store-assets' and public.is_admin());

commit;
