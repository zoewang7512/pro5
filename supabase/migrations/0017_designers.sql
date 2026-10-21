-- TASK-067（多位設計師 架構基礎）
-- 新增 designers／designer_services／designer_leaves／designer_portfolio_images 四張資料表、
-- Storage public bucket designer-assets，以及 appointments.designer_id（nullable）。
-- 套用後建立一位「預設設計師」，把全部既有預約歸給他、把全部既有服務對他開啟。
--
-- **本檔案不改任何 RPC 與 exclusion constraint**（那是 0018／TASK-068 的範圍）：
--   - 舊版 create_appointment 照常寫入，新預約的 designer_id 暫時是 null；0018 套用時會補回填。
--   - appointments_no_overlap 仍是「全店不可重疊」，不會雙重預約。
--   - 前台與既有整合測試行為完全不變。
-- 專案只有一個 Supabase 資料庫，套用當下就影響正式環境；本檔案必須能和 master 上的舊版程式碼共存。
--
-- 權限依架構筆記 C（ai/artifacts/多位設計師/task-cards/TASK-067.md，經 architect／security-reviewer
-- 動工前審查）：每張新表先對三個角色 revoke all 再逐一明確 grant（decisions.md「TASK-065」規則），
-- 四張表都不得啟用 force row level security（0018 的 SECURITY DEFINER RPC 依賴讀得到資料列，理由同
-- booking_policy／closed_dates）。
--
-- 隱藏依賴（不要拿掉）：anon 對 designers 的欄位 grant 必須保留 id 與 is_active。
-- designer_services／designer_portfolio_images 的公開讀 policy 以 anon 身分執行子查詢
-- （exists (select 1 from designers d where d.id = ... and d.is_active)），依賴這兩欄；
-- 拿掉會讓 anon 讀這兩張表整個變成 42501。
--
-- 回填副作用：把既有預約的 designer_id 填上預設設計師時，會經過 set_updated_at trigger，所有既有預約的
-- updated_at 會被刷新（可以接受）。回填不符合 0012 改期 webhook 的 WHEN 條件，不會寄信。
--
-- 可重複執行（idempotent）：if not exists／drop ... if exists／on conflict。重跑時：
--   - 「建立預設設計師」與「對全部既有服務開啟」放在同一個條件分支，只在 designers 沒有任何列
--     （第一次執行）時做，不會把店長關掉的服務重新打開。
--   - 回填預約每次都跑，只更新 designer_id is null 的列。
-- 對應回滾腳本：0017_designers_down.sql
-- 重要：0018（TASK-068）套用之後不要再重跑本檔。本檔對四張新表做 revoke all 再 grant、並重建所有
-- policy；若 0018 或之後的 migration 對這些表追加或修改過授權／policy，重跑會悄悄還原成本檔版本。
-- 這四張表的授權與 policy 以本檔為唯一來源。
-- 回滾順序（重要）：先在 Vercel 回滾前端 → 再執行 0018_down → 最後才是 0017_down。順序反過來，
-- 新前端帶 p_designer_id 的呼叫會找不到函式（PGRST202），整個預約功能中斷。
-- 編號說明：0016 由 TASK-079（is_admin() 強制 aal2）使用，新資料表的 is_admin() 寫入 policy 會自動
-- 對已啟用 MFA 的帳號要求 aal2。

begin;

-- 依賴檢查：缺少前置物件時直接中止，不留下半套。
do $$
begin
  if to_regclass('public.appointments') is null or to_regclass('public.services') is null then
    raise exception '0017 需要先套用 0001～0016（找不到 appointments／services）';
  end if;
  if to_regprocedure('public.is_admin()') is null or to_regprocedure('public.set_updated_at()') is null then
    raise exception '0017 需要先套用 0001（找不到 is_admin()／set_updated_at()）';
  end if;
end $$;

-- ============================================================
-- 專長標籤驗證函式（供 check constraint 使用）
-- ============================================================
-- 一維陣列、0～5 個、每個 1～12 字、前後無空白（含全形空白）、不含控制字元與不可見的方向／零寬
-- 字元（U+200B–200F、U+202A–202E、U+2066–2069，避免在公開頁面偽造文字顯示方向）、不重複。
-- immutable 才能用在 check constraint（[[:cntrl:]] 依 locale 判斷，嚴格說不算 immutable，實務上可忽略）。
-- 注意：check constraint 執行時會檢查呼叫者對函式的 execute 權限，所以 authenticated 與 service_role
-- 必須保留 execute（純函式、無副作用，公開沒有風險）；只收回 public／anon。這與架構筆記 E 原本寫的
-- 「同樣 revoke」不同，是有意且必要的偏差。
create or replace function public.designer_specialties_valid(p_specialties text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_ndims(p_specialties), 1) = 1
    and coalesce(cardinality(p_specialties), 0) <= 5
    and not exists (
      select 1
      from unnest(p_specialties) as t(tag)
      where tag is null
         or tag <> btrim(tag, E' 　')
         or char_length(tag) not between 1 and 12
         or tag ~ '[[:cntrl:]​-‏‪-‮⁦-⁩]'
    )
    and (select count(distinct tag) from unnest(p_specialties) as t(tag)) = coalesce(cardinality(p_specialties), 0);
$$;

revoke execute on function public.designer_specialties_valid(text[]) from public;
revoke execute on function public.designer_specialties_valid(text[]) from anon;
grant execute on function public.designer_specialties_valid(text[]) to authenticated, service_role;

-- ============================================================
-- designers：設計師基本資料
-- ============================================================
create table if not exists public.designers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  bio text,
  specialties text[] not null default '{}',
  instagram_handle text,
  avatar_url text,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 欄位驗證的資料庫層最終防線（前端先擋）。名稱去頭尾空白（含全形空白）後 1～30 字，且不含控制字元
-- 與不可見的方向／零寬字元；
-- instagram_handle 只存帳號名稱（不含 @，前端送出前去掉），由程式組出固定網域的網址，
-- 不接受任意 URL（杜絕 javascript: 與釣魚網址）；avatar_url 只限長度，網址白名單是顯示層的職責
-- （lib/designers.ts resolveDesignerAssetUrl，比照 admins.avatar_url 的既有決策）。
alter table public.designers drop constraint if exists designers_name_valid;
alter table public.designers
  add constraint designers_name_valid
  check (
    char_length(btrim(name, E' 　')) between 1 and 30
    and name !~ '[[:cntrl:]​-‏‪-‮⁦-⁩]'
  );

alter table public.designers drop constraint if exists designers_bio_length;
alter table public.designers
  add constraint designers_bio_length check (char_length(coalesce(bio, '')) <= 200);

alter table public.designers drop constraint if exists designers_specialties_valid;
alter table public.designers
  add constraint designers_specialties_valid check (public.designer_specialties_valid(specialties));

alter table public.designers drop constraint if exists designers_instagram_handle_format;
alter table public.designers
  add constraint designers_instagram_handle_format
  check (instagram_handle is null or instagram_handle ~ '^[A-Za-z0-9._]{1,30}$');

alter table public.designers drop constraint if exists designers_avatar_url_length;
alter table public.designers
  add constraint designers_avatar_url_length check (char_length(coalesce(avatar_url, '')) <= 2048);

drop trigger if exists designers_set_updated_at on public.designers;
create trigger designers_set_updated_at
  before update on public.designers
  for each row
  execute function public.set_updated_at();

-- ============================================================
-- designer_services：設計師提供的服務（有這一列代表該設計師提供這項服務）
-- ============================================================
-- 兩個外鍵都 on delete cascade：服務本身只會下架不會刪、設計師只會停用不會刪，cascade 只是保險
-- （測試以 service_role 清理 __TEST__ 設計師時會用到）。
create table if not exists public.designer_services (
  designer_id uuid not null references public.designers (id) on delete cascade,
  service_id uuid not null references public.services (id) on delete cascade,
  primary key (designer_id, service_id)
);

-- ============================================================
-- designer_leaves：設計師整天請假
-- ============================================================
create table if not exists public.designer_leaves (
  designer_id uuid not null references public.designers (id) on delete cascade,
  date date not null,
  created_at timestamptz not null default now(),
  primary key (designer_id, date)
);

-- ============================================================
-- designer_portfolio_images：作品集
-- ============================================================
create table if not exists public.designer_portfolio_images (
  id uuid primary key default gen_random_uuid(),
  designer_id uuid not null references public.designers (id) on delete cascade,
  image_url text not null,
  storage_path text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists designer_portfolio_images_designer_created_idx
  on public.designer_portfolio_images (designer_id, created_at desc);

-- 路徑格式與設計師綁定（portfolio/<designer_id>/<uuid>.<ext>），image_url 必須以 storage_path 結尾，
-- 避免資料列指向別人的路徑。注意：這**擋不住外部網域**（資料庫不知道專案的 Storage 網址），任何以
-- storage_path 結尾的網址都會通過；網址只能指向 designer-assets bucket 的唯一防線是顯示層的
-- resolveDesignerAssetUrl（origin＋pathname 白名單），前台與後台每個顯示圖片的地方都必須套用。
alter table public.designer_portfolio_images drop constraint if exists designer_portfolio_images_storage_path_format;
alter table public.designer_portfolio_images
  add constraint designer_portfolio_images_storage_path_format
  check (storage_path ~ ('^portfolio/' || designer_id::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$'));

alter table public.designer_portfolio_images drop constraint if exists designer_portfolio_images_image_url_valid;
alter table public.designer_portfolio_images
  add constraint designer_portfolio_images_image_url_valid
  check (char_length(image_url) <= 2048 and right(image_url, char_length(storage_path)) = storage_path);

-- 每位設計師最多 12 張：after insert trigger 先鎖住設計師列再數張數（數到的張數已包含剛插入的這一列，
-- 所以條件是 > 12），同一位設計師的並行上傳會排隊，不會同時看到 11 張而都通過。超過時以固定訊息前綴
-- PORTFOLIO_LIMIT 拋出（errcode P0001），整個 insert 語句回滾；前端依此對應文案。
-- 為何是 AFTER 而不是 BEFORE（security-reviewer TASK-067 審查）：RLS 的 WITH CHECK 在 BEFORE ROW
-- trigger 之後才檢查，BEFORE 的話任何自行註冊的使用者（Supabase 公開註冊是開著的）在被 42501 擋下之前，
-- 就會讓這個 SECURITY DEFINER 函式以 postgres 身分對任意設計師列取鎖、並透過錯誤碼探測作品張數。
-- AFTER ROW trigger 在 RLS 與 check constraint 都通過後才執行；多列單一 insert 也在語句結尾一次數齊。
-- 為何鎖用 FOR NO KEY UPDATE 而不是 FOR UPDATE：外鍵檢查會先對設計師列取 FOR KEY SHARE，兩個並行
-- 交易若都持有 KEY SHARE 再要 FOR UPDATE 會互相等待而死結；NO KEY UPDATE 與 KEY SHARE 相容、
-- 彼此之間互斥，所以不死結；也不會擋住 0018 的 create_appointment 對設計師列的 KEY SHARE。
-- security definer＋空 search_path：張數計算不受呼叫者 RLS 影響，也不會被 search_path 劫持。
create or replace function public.designer_portfolio_limit_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.designers where id = new.designer_id for no key update;

  if (select count(*) from public.designer_portfolio_images where designer_id = new.designer_id) > 12 then
    raise exception 'PORTFOLIO_LIMIT: 每位設計師最多 12 張作品'
      using errcode = 'P0001';
  end if;

  return null;
end;
$$;

-- trigger 函式不需要任何角色有 execute（觸發時不檢查 execute 權限）。
revoke execute on function public.designer_portfolio_limit_check() from public;
revoke execute on function public.designer_portfolio_limit_check() from anon;
revoke execute on function public.designer_portfolio_limit_check() from authenticated;

drop trigger if exists designer_portfolio_images_limit on public.designer_portfolio_images;
create trigger designer_portfolio_images_limit
  after insert on public.designer_portfolio_images
  for each row
  execute function public.designer_portfolio_limit_check();

-- ============================================================
-- appointments.designer_id（先 nullable，0018 補回填後才改 not null）
-- ============================================================
-- 不 cascade：設計師只會停用不會刪，歷史預約不能因為刪設計師而消失。
alter table public.appointments
  add column if not exists designer_id uuid references public.designers (id);

create index if not exists appointments_designer_id_start_at_idx
  on public.appointments (designer_id, start_at);

-- ============================================================
-- RLS 與 GRANT
-- ============================================================
-- 先 revoke all 再逐一 grant（含 truncate／references／trigger 與 Postgres 17 的 maintain）。
-- 不得啟用 force row level security。
alter table public.designers enable row level security;
alter table public.designer_services enable row level security;
alter table public.designer_leaves enable row level security;
alter table public.designer_portfolio_images enable row level security;

-- designers：anon 只讀「公開欄位」且只讀啟用中的設計師（id、is_active 必須保留，見檔頭說明）。
-- authenticated 不 grant delete：設計師只能停用，delete 只給 service_role（測試清理用）。
-- insert／update 都用欄位層級授權，排除 id、created_at（security-reviewer TASK-067 審查）：「預設設計師」
-- 以 order by created_at, id 辨識（0018 補回填用），若 insert 能自訂 created_at，管理員 session 被盜用時
-- 可以塞一位 created_at 很早的設計師來冒充預設設計師，讓舊 RPC 空窗期寫入的預約歸錯人。
-- updated_at 由 trigger 改寫，不受欄位授權限制。
revoke all on public.designers from anon, authenticated, service_role;
grant select (id, name, bio, specialties, instagram_handle, avatar_url, sort_order, is_active)
  on public.designers to anon;
grant select on public.designers to authenticated;
grant insert (name, bio, specialties, instagram_handle, avatar_url, is_active, sort_order)
  on public.designers to authenticated;
grant update (name, bio, specialties, instagram_handle, avatar_url, is_active, sort_order)
  on public.designers to authenticated;
grant select, insert, update, delete on public.designers to service_role;

drop policy if exists "public read active designers" on public.designers;
create policy "public read active designers"
  on public.designers
  for select
  to anon, authenticated
  using (is_active);

drop policy if exists "admin read designers" on public.designers;
create policy "admin read designers"
  on public.designers
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists "admin insert designers" on public.designers;
create policy "admin insert designers"
  on public.designers
  for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "admin update designers" on public.designers;
create policy "admin update designers"
  on public.designers
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- designer_services：開關＝insert／delete 一列。公開讀 policy 只放行啟用中設計師的列。
revoke all on public.designer_services from anon, authenticated, service_role;
grant select on public.designer_services to anon;
grant select, insert, delete on public.designer_services to authenticated;
grant select, insert, update, delete on public.designer_services to service_role;

drop policy if exists "public read designer services" on public.designer_services;
create policy "public read designer services"
  on public.designer_services
  for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.designers d
      where d.id = designer_services.designer_id and d.is_active
    )
  );

drop policy if exists "admin read designer services" on public.designer_services;
create policy "admin read designer services"
  on public.designer_services
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists "admin insert designer services" on public.designer_services;
create policy "admin insert designer services"
  on public.designer_services
  for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "admin delete designer services" on public.designer_services;
create policy "admin delete designer services"
  on public.designer_services
  for delete
  to authenticated
  using (public.is_admin());

-- designer_portfolio_images：anon 只讀 id、designer_id、image_url、created_at。storage_path 不給 anon
-- （沒有保密作用，公開網址本來就含路徑；只是讓前台查詢必須列出欄位，不能 select *）。
revoke all on public.designer_portfolio_images from anon, authenticated, service_role;
grant select (id, designer_id, image_url, created_at) on public.designer_portfolio_images to anon;
grant select, insert, delete on public.designer_portfolio_images to authenticated;
grant select, insert, update, delete on public.designer_portfolio_images to service_role;

drop policy if exists "public read designer portfolio images" on public.designer_portfolio_images;
create policy "public read designer portfolio images"
  on public.designer_portfolio_images
  for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.designers d
      where d.id = designer_portfolio_images.designer_id and d.is_active
    )
  );

drop policy if exists "admin read designer portfolio images" on public.designer_portfolio_images;
create policy "admin read designer portfolio images"
  on public.designer_portfolio_images
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists "admin insert designer portfolio images" on public.designer_portfolio_images;
create policy "admin insert designer portfolio images"
  on public.designer_portfolio_images
  for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "admin delete designer portfolio images" on public.designer_portfolio_images;
create policy "admin delete designer portfolio images"
  on public.designer_portfolio_images
  for delete
  to authenticated
  using (public.is_admin());

-- designer_leaves：請假日是設計師的個人行程，anon 完全不給（前台只透過 0018 的 SECURITY DEFINER RPC
-- 間接受影響）。
revoke all on public.designer_leaves from anon, authenticated, service_role;
grant select, insert, delete on public.designer_leaves to authenticated;
grant select, insert, update, delete on public.designer_leaves to service_role;

drop policy if exists "admin read designer leaves" on public.designer_leaves;
create policy "admin read designer leaves"
  on public.designer_leaves
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists "admin insert designer leaves" on public.designer_leaves;
create policy "admin insert designer leaves"
  on public.designer_leaves
  for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "admin delete designer leaves" on public.designer_leaves;
create policy "admin delete designer leaves"
  on public.designer_leaves
  for delete
  to authenticated
  using (public.is_admin());

-- appointments：後台需要讀 designer_id（週曆／列表顯示設計師）。**不** grant update (designer_id)：
-- 這次不做「改派設計師」，不能改派在資料庫層就生效。service_role 在 0015 已是 table-level 全權。
grant select (designer_id) on public.appointments to authenticated;

-- ============================================================
-- 回填：預設設計師、既有服務、既有預約
-- ============================================================
do $$
declare
  v_default_id uuid;
begin
  -- 只在 designers 沒有任何列（第一次執行）時建立預設設計師，並把全部既有服務（含下架中）對他開啟，
  -- 維持升級前的行為不變。放在同一個條件分支，重跑 0017 不會把店長關掉的服務重新打開。
  if not exists (select 1 from public.designers) then
    insert into public.designers (name, sort_order)
    values ('預設設計師', 0)
    returning id into v_default_id;

    insert into public.designer_services (designer_id, service_id)
    select v_default_id, s.id from public.services s;
  end if;

  -- 「預設設計師」的辨識方式：order by created_at, id limit 1（0018 補回填時用同一個規則）。
  select d.id into v_default_id from public.designers d order by d.created_at, d.id limit 1;

  -- 每次都跑（冪等）：只更新還沒有 designer_id 的預約。
  update public.appointments set designer_id = v_default_id where designer_id is null;
end $$;

-- ============================================================
-- Storage：designer-assets public bucket（頭像與作品集）
-- ============================================================
-- 設計師的名字、頭像、IG、作品集是店家刻意公開的資訊，所以用 public bucket，公開讀取走 storage-api
-- 的 /object/public/ 端點（繞過 RLS）。故意不允許 image/svg+xml（stored XSS，理由同 0006）。
-- on conflict 用 do update：確保重跑時設定不會漂移。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('designer-assets', 'designer-assets', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 不給 anon 任何 policy：避免被列舉所有檔案。
-- admin select 是必要的：Supabase storage.remove() 需要 select＋delete 兩種權限，缺 select 時不會
-- 回錯誤、只回 data: []，檔案根本沒刪掉。
drop policy if exists "admin read designer assets" on storage.objects;
create policy "admin read designer assets"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'designer-assets' and public.is_admin());

-- 路徑：avatar/<designer_id>/<uuid>.<ext> 或 portfolio/<designer_id>/<uuid>.<ext>。
-- 第一段限定 avatar／portfolio，第二段必須長得像 uuid，剛好兩層資料夾，副檔名限 jpg／png／webp
-- （路徑由程式產生，不使用使用者提供的檔名）。bucket 的 MIME 限制只看用戶端宣告的 Content-Type，
-- 不檢查實際內容，所以路徑與副檔名在這裡也要收斂（security-reviewer TASK-067 審查）。
drop policy if exists "admin insert designer assets" on storage.objects;
create policy "admin insert designer assets"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'designer-assets'
    and public.is_admin()
    and (storage.foldername(name))[1] in ('avatar', 'portfolio')
    and (storage.foldername(name))[2] ~ '^[0-9a-f-]{36}$'
    and array_length(storage.foldername(name), 1) = 2
    and storage.extension(name) in ('jpg', 'png', 'webp')
  );

drop policy if exists "admin delete designer assets" on storage.objects;
create policy "admin delete designer assets"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'designer-assets' and public.is_admin());

-- 刻意不建 update policy：檔名一律是新的 uuid，用不到覆寫，也就沒有 upsert 這條路。注意這不等於
-- 「同一個網址不能被換圖」：管理員同時有 delete 與 insert，可以先刪再上傳到同一個路徑。
drop policy if exists "admin update designer assets" on storage.objects;

notify pgrst, 'reload schema';

commit;
