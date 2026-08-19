-- TASK-038（設計師登入與帳號安全 架構基礎）
-- 新增 admins.display_name／admins.avatar_url 兩個個人資料欄位，以及對應的
-- SECURITY DEFINER RPC（get_admin_profile／update_admin_profile）讓已登入的管理員可以
-- 讀取／更新自己的個人資料。admins 表刻意零 RLS policy 的既有安全姿態（見
-- 0001_core_schema.sql 註解：「一般角色（含 authenticated 自己）完全無法直接讀寫這張表，
-- 只有 SECURITY DEFINER function 能繞過 RLS」）延續不變——本檔案不新增任何
-- admins 表的直接 RLS policy，兩支 RPC 都只操作 auth.uid() 對應的自己那一列，
-- 不接受任意 user_id 參數。
-- 同時新增 Supabase Storage public bucket admin-assets（大頭貼），與「商店基本資料設定」
-- Epic 的 store-assets（顧客可見的公開品牌資訊）職責分離；政策比照 0006_store_settings.sql
-- 的既有寫法：file_size_limit／allowed_mime_types 限制、只有 is_admin() 可寫入、公開讀取
-- 走 bucket 的 public 端點（繞過 RLS，不需要 select policy 給 anon）。
-- 純資料層＋Storage 基礎設施：本卡不含任何編輯表單互動，留給 TASK-041（顯示名稱／大頭貼）、
-- TASK-042（密碼／Email）、TASK-043（MFA）。
-- 可重複執行（idempotent）：使用 if not exists / drop ... if exists / on conflict。
-- 對應回滾腳本：0007_admin_profile_down.sql
-- 編號說明：接續目前實際存在的最大編號 0006；0005 已由 TASK-028
-- （create_appointment RPC 加入 closed_dates 檢查）保留，該任務尚未實作，本卡不搶用該編號。

begin;

-- ============================================================
-- admins：新增個人資料欄位
-- ============================================================
alter table public.admins add column if not exists display_name text;
alter table public.admins add column if not exists avatar_url text;

-- 長度上限對齊 feature-spec 的驗證規則（顯示名稱上限 50 字）：雖然本批次的寫入路徑是
-- SECURITY DEFINER RPC（下方 update_admin_profile，已於函式內部先驗證長度、失敗時回傳
-- false 而不是讓這條 constraint 拋出原始例外，見下方函式定義），這條 constraint 仍是
-- 縱深防禦的資料庫層最終防線，比照 0006_store_settings.sql 對 description／phone 長度加
-- constraint 的既有慣例。avatar_url 刻意不加格式 constraint（比照 store_settings.logo_url
-- 的既有決策：只信任 admin-assets bucket 底下網址的白名單邏輯是前端渲染層的職責，見
-- TASK-041，資料庫層只存文字），但加長度上限（2048 字）避免管理員意外寫入超大字串。
alter table public.admins drop constraint if exists admins_display_name_length;
alter table public.admins
  add constraint admins_display_name_length check (char_length(coalesce(display_name, '')) <= 50);

alter table public.admins drop constraint if exists admins_avatar_url_length;
alter table public.admins
  add constraint admins_avatar_url_length check (char_length(coalesce(avatar_url, '')) <= 2048);

-- ============================================================
-- get_admin_profile／update_admin_profile：SECURITY DEFINER RPC
-- ============================================================
-- 比照 is_admin() 的既有寫法（stable／security definer／set search_path = ''）。
-- 找不到 auth.uid() 對應列時（呼叫者非管理員，或未登入）回傳空結果集，不拋出任何
-- 洩漏「這個 user_id 是否存在於 admins 表」內部狀態的錯誤訊息——呼叫端（前端）看到
-- 空結果與「查無資料」的處理方式完全相同，無法從回應差異反推任何資訊。
create or replace function public.get_admin_profile()
returns table (display_name text, avatar_url text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.display_name, a.avatar_url
  from public.admins a
  where a.user_id = auth.uid();
$$;

-- 明確對 anon 也 revoke（不能只 revoke from public）：本 Supabase 專案對 public schema
-- 設定了 default privileges，新建立的 function 會自動額外 grant execute 給 anon／
-- authenticated／service_role（獨立於 PUBLIC 偽角色之外的明確授權），只 revoke from public
-- 不會撤銷這個獨立授權——實測驗證發現用純 anon key（無 session）呼叫這兩支 RPC 在只
-- revoke from public 時仍能成功執行，回傳 200，就是這個原因（security-reviewer TASK-038
-- 審查發現）。service_role 保留其預設授權（不特別 revoke）：它本來就能透過 service role
-- key 繞過所有權限直接操作 admins 表，讓它同時也能呼叫這兩支 RPC 不構成額外風險，且
-- TASK-045 等整合測試若需要用 service role 驗證，不會被這裡的收斂邊界誤擋。
revoke execute on function public.get_admin_profile() from public;
revoke execute on function public.get_admin_profile() from anon;
grant execute on function public.get_admin_profile() to authenticated;

-- 更新自己的個人資料：where 子句限定 auth.uid()，非管理員（auth.uid() 不在 admins 表）
-- 呼叫時 update 影響 0 筆，回傳 false，不寫入任何資料、不拋錯。函式內部先驗證
-- display_name 長度（對齊 admins_display_name_length constraint 的上限 50 字），驗證失敗
-- 一律回傳 false 而非讓資料庫 constraint 拋出原始例外——若放給 constraint 處理，
-- PostgREST 會把 Postgres 的原始錯誤訊息（含表名、constraint 名稱等內部 schema 細節）
-- 原封不動回傳給呼叫端，且會與「非管理員」的 false 回應形成可觀察的回應型態差異
-- （security-reviewer TASK-038 審查發現：兩種語意混在一起，必須收斂成單一回傳型態）。
create or replace function public.update_admin_profile(p_display_name text, p_avatar_url text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated int;
begin
  if char_length(coalesce(p_display_name, '')) > 50 then
    return false;
  end if;
  if char_length(coalesce(p_avatar_url, '')) > 2048 then
    return false;
  end if;

  update public.admins
  set display_name = p_display_name, avatar_url = p_avatar_url
  where user_id = auth.uid();
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke execute on function public.update_admin_profile(text, text) from public;
revoke execute on function public.update_admin_profile(text, text) from anon;
grant execute on function public.update_admin_profile(text, text) to authenticated;

-- ============================================================
-- Storage：admin-assets public bucket（大頭貼）
-- ============================================================
-- 已知取捨（security-reviewer TASK-038 審查提出）：admin-assets 設為 public bucket，代表
-- 知道確切網址即可匿名下載大頭貼，即使該網址從未對外公開過。這與 store-assets（本來就要
-- 給匿名顧客前台讀取品牌圖片）的情境不同——admin-assets 的唯一消費者是已登入管理員自己的
-- Sidebar／帳號設定頁。評估後維持 public（而非改用 private bucket + createSignedUrl）：
-- (1) 本專案僅一位管理員帳號，非公開對外服務，帳號本身遭入侵時攻擊者已能透過
-- update_admin_profile／upload 直接讀寫，pre-signed URL 機制對這個威脅模型防護有限；
-- (2) 沿用與 store-assets 一致的既有 public bucket 模式，避免同一個專案內兩種不同的圖片
-- 存取模式（public URL vs 需要處理過期/更新的 signed URL）增加後續維護複雜度；
-- (3) 大頭貼非高敏感個資（比照店家 Logo 的公開性質，非顧客個資）。若未來風險模型改變
-- （例如開放多位管理員帳號），應重新評估改為 private bucket。
-- 故意不允許 image/svg+xml，理由同 0006_store_settings.sql：public bucket 的 URL 直接從
-- Supabase 網域回傳，SVG 會在該網域執行內嵌 script，等同開放一個 stored XSS 管道。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('admin-assets', 'admin-assets', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 不給 anon/authenticated 一般讀取 policy：公開讀取（Sidebar／帳號設定頁顯示大頭貼）走
-- storage-api 的 /object/public/ 端點，繞過 RLS，不需要 select policy；只留給 is_admin()
-- 供後台管理用途，理由同 store-assets 既有決策。
drop policy if exists "admin read admin assets" on storage.objects;
create policy "admin read admin assets"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'admin-assets' and public.is_admin());

-- 路徑前綴限制（storage.foldername 取路徑第一段）：只允許 avatar/ 前綴，比照
-- store-assets 限定 logo/／cover/ 的既有縱深防禦做法。
drop policy if exists "admin insert admin assets" on storage.objects;
create policy "admin insert admin assets"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'admin-assets'
    and public.is_admin()
    and (storage.foldername(name))[1] = 'avatar'
  );

drop policy if exists "admin update admin assets" on storage.objects;
create policy "admin update admin assets"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'admin-assets' and public.is_admin())
  with check (
    bucket_id = 'admin-assets'
    and public.is_admin()
    and (storage.foldername(name))[1] = 'avatar'
  );

drop policy if exists "admin delete admin assets" on storage.objects;
create policy "admin delete admin assets"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'admin-assets' and public.is_admin());

commit;
