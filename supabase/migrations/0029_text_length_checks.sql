-- TASK-123（Demo 體驗帳戶：services／store_settings 文字欄位長度上限，TASK-116 安全審查 M2）
-- 對下列六個欄位加長度 CHECK（以 char_length 計「字元數」，與 designers 的欄位 CHECK 同一慣例）：
--   services.name                    <= 60      constraint services_name_length
--   services.description             <= 500     constraint services_description_length
--   store_settings.name              <= 200     constraint store_settings_name_length
--   store_settings.address           <= 200     constraint store_settings_address_length
--   store_settings.logo_url          <= 2048    constraint store_settings_logo_url_length
--   store_settings.cover_image_url   <= 2048    constraint store_settings_cover_image_url_length
-- （store_settings.description <= 500、phone <= 20 早在 0006 就有；這六個是兩張表僅剩沒有長度限制的文字欄位。）
--
-- 目的：0027 限制了 Demo 可寫入的列數，但這兩張表的欄位沒有長度限制；Demo 可以對既有列反覆 PATCH 塞入大字串
-- （單欄理論上到 1 GB，實際取決於請求大小限制），繞過列數上限、灌爆免費方案的 500 MB。資料庫層的 CHECK 是最終防線，
-- 前端驗證（lib/admin/services.ts、lib/store-settings.ts）只是體驗優化，兩邊的數字由單元測試比對防止漂移。
--
-- 對所有角色生效，不只 Demo：這是資料完整性規則。正常使用的值遠低於上限（套用前的唯讀量測：services.name 最長 4、
-- description 最長 78；store_settings.name 6、address 14、兩個 URL 124／125；Demo 種子資料同樣遠低於上限），行為不變。
-- 每日還原把種子資料寫回這兩張表，種子符合上限，所以不會被擋；之後若種子資料超過上限，單元測試會先失敗。
--
-- 設計：
--   * 只加「上限」，不加下限、不加「非空白」：store_settings.name 的 seed 列本來就是空字串（0006 說明）；services.name 的必填由前端把關，維持現狀。
--   * 可為 null 的欄位用 char_length(coalesce(col, '')) <= N（與 0006 同寫法）；name 欄位是 not null，直接 char_length(name) <= N。
--   * 計數單位是字元（碼點），不是位元組：60 個全形字 = 60，可通過；前端以 Array.from(...).length 計算，兩邊一致。
--   * 不使用 NOT VALID：兩張表只有個位數列，要的是完整驗證；套用前先檢查既有資料，不符合就以明確訊息中止。
--   * add constraint 會短暫取得 ACCESS EXCLUSIVE 鎖並掃描整張表（兩張表各只有個位數列，可忽略）。
--
-- 被拒絕時資料庫回傳 23514（check_violation），訊息帶 constraint 名稱。前端驗證先行擋下，一般使用者不會看到；
-- 直接打 REST 的人（含 Demo）才會遇到。
--
-- 套用前後非 Demo 帳號行為：不變（既有值都符合）。既有資料、policy、grant、觸發器都不動。
-- 套用順序：任何時間都可套用（只依賴 0001／0006 已存在的欄位）。
-- 可重複執行（idempotent）：drop constraint if exists 後重建。
-- 回滾：0029_text_length_checks_down.sql（移除六個 CHECK；警告：等於重新打開缺口，見該檔說明）。
-- 請在 SQL Editor 整份執行（不要只選取一部分，否則不在 begin 交易內、失敗時無法整份回滾）。
--
-- 緊急停用單一上限（例如某個上限設太低導致正常儲存失敗時，只貼對應那一行，不要用 _down.sql）。
-- 放行等於重新打開缺口：放行期間先 demo:disable 或明確接受風險；若放行期間已寫入超長資料，之後重跑本檔會被套用前檢查擋下而中止，
-- 需先還原資料（例如 demo:reset -- --yes）再重套；放行後務必回頭重套本檔：
--   alter table public.services       drop constraint if exists services_name_length;
--   alter table public.services       drop constraint if exists services_description_length;
--   alter table public.store_settings drop constraint if exists store_settings_name_length;
--   alter table public.store_settings drop constraint if exists store_settings_address_length;
--   alter table public.store_settings drop constraint if exists store_settings_logo_url_length;
--   alter table public.store_settings drop constraint if exists store_settings_cover_image_url_length;
-- 要調整上限：改下方 add constraint 的數字後整份重跑，並同步前端常數（lib/admin/services.ts、lib/store-settings.ts）
-- 與 tests/lib/text-length-checks-migration.test.ts、tests/text-length-checks.integration.test.ts 的核准值。
--
-- 套用後的驗證：
--   1. npm run test:text-length（真實庫；預設模式預期全數通過；套用前請用 TEXT_LENGTH_EXPECT=off 取得基準線）。
--   2. select conrelid::regclass as tbl, conname, convalidated, pg_get_constraintdef(oid) as def
--        from pg_constraint where conname in ('services_name_length','services_description_length',
--          'store_settings_name_length','store_settings_address_length','store_settings_logo_url_length',
--          'store_settings_cover_image_url_length') order by 1, 2;   -- 預期 6 列、convalidated 皆為 t

begin;

-- alter table 會取得 ACCESS EXCLUSIVE 鎖；若排在長交易（每日還原、備份傾印）後面，之後所有讀這兩張表的查詢
-- （前台頁面、時段查詢、預約）都會跟著卡住。等不到鎖 5 秒就失敗並整份回滾，稍後重跑即可（比照 0018／0020）。
set local lock_timeout = '5s';

-- 依賴檢查：缺少前置物件時直接中止，不留下半套。
do $$
begin
  if to_regclass('public.services') is null or to_regclass('public.store_settings') is null then
    raise exception '0029 缺少前置資料表 public.services／public.store_settings（請先套用 0001、0006）';
  end if;
end
$$;

-- 既有資料檢查：任何一列超過新上限就中止，並列出是哪個欄位、目前最長多少（add constraint 本身也會失敗，這裡給更清楚的訊息）。
do $$
declare
  v_msg text;
begin
  select string_agg(format('%s（上限 %s，目前最長 %s）', label, cap, longest), '；' order by label)
    into v_msg
  from (
    select 'services.name' as label, 60 as cap, coalesce(max(char_length(name)), 0) as longest from public.services
    union all
    select 'services.description', 500, coalesce(max(char_length(description)), 0) from public.services
    union all
    select 'store_settings.name', 200, coalesce(max(char_length(name)), 0) from public.store_settings
    union all
    select 'store_settings.address', 200, coalesce(max(char_length(address)), 0) from public.store_settings
    union all
    select 'store_settings.logo_url', 2048, coalesce(max(char_length(logo_url)), 0) from public.store_settings
    union all
    select 'store_settings.cover_image_url', 2048, coalesce(max(char_length(cover_image_url)), 0) from public.store_settings
  ) checks
  where longest > cap;

  if v_msg is not null then
    raise exception '0029 中止：既有資料超過新的長度上限，請先修正這些資料：%', v_msg;
  end if;
end
$$;

-- ============================================================
-- services
-- ============================================================
alter table public.services drop constraint if exists services_name_length;
alter table public.services
  add constraint services_name_length check (char_length(name) <= 60);

alter table public.services drop constraint if exists services_description_length;
alter table public.services
  add constraint services_description_length check (char_length(coalesce(description, '')) <= 500);

-- ============================================================
-- store_settings
-- ============================================================
alter table public.store_settings drop constraint if exists store_settings_name_length;
alter table public.store_settings
  add constraint store_settings_name_length check (char_length(name) <= 200);

alter table public.store_settings drop constraint if exists store_settings_address_length;
alter table public.store_settings
  add constraint store_settings_address_length check (char_length(coalesce(address, '')) <= 200);

alter table public.store_settings drop constraint if exists store_settings_logo_url_length;
alter table public.store_settings
  add constraint store_settings_logo_url_length check (char_length(coalesce(logo_url, '')) <= 2048);

alter table public.store_settings drop constraint if exists store_settings_cover_image_url_length;
alter table public.store_settings
  add constraint store_settings_cover_image_url_length check (char_length(coalesce(cover_image_url, '')) <= 2048);

-- 尾端自我檢查：六個 constraint 都存在、是 CHECK、已驗證（convalidated），且掛在正確的資料表上。
do $$
declare
  v_expected constant text[] := array[
    'public.services:services_name_length',
    'public.services:services_description_length',
    'public.store_settings:store_settings_name_length',
    'public.store_settings:store_settings_address_length',
    'public.store_settings:store_settings_logo_url_length',
    'public.store_settings:store_settings_cover_image_url_length'
  ];
  v_item text;
begin
  foreach v_item in array v_expected loop
    if not exists (
      select 1 from pg_constraint c
      where c.conrelid = split_part(v_item, ':', 1)::regclass
        and c.conname = split_part(v_item, ':', 2)
        and c.contype = 'c'
        and c.convalidated
    ) then
      raise exception '0029 自我檢查失敗：缺少或未驗證的 CHECK constraint %', v_item;
    end if;
  end loop;
end $$;

commit;
