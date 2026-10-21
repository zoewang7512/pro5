# AI-Ready 任務卡

## Metadata

- 任務：多位設計師 架構基礎（設計師相關資料表、RLS／GRANT、Storage bucket、appointments.designer_id 回填、後台列表骨架與 Sidebar）
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：多位設計師
- 上層 User Story：管理設計師基本資料
- 分軌：不適用（架構基礎：資料庫遷移＋頁面骨架，比照 TASK-046／TASK-029 不強套三分法）
- 前置任務（dependsOn）：TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006, TASK-007, TASK-008, TASK-009, TASK-063, TASK-064, TASK-065, TASK-066, TASK-079（人工決定排序：0016 先套用）
- 狀態：待驗證／待人工驗收（人工已於 2026-10-21 核准；動工前審查與實作後審查皆已完成並採納，見完成證據）
- 風險等級：高（新增 4 張資料表與 1 個 Storage bucket，並在 `appointments` 新增外鍵欄位、回填全部既有預約；共用正式資料庫）
- Agent owner：Claude Code
- 人工核准者：使用者

## 目標

建立本 Epic 所有後續任務卡共用的資料基礎與後台入口。套用 `0017` 後，系統行為與升級前**完全相同**
（RPC 不變、前台不變），只是資料庫多了設計師資料，而且每筆既有預約都歸給「預設設計師」。

## 架構筆記（本 Epic 共用，其他任務卡引用這一段）

> 2026-10-21 已依 architect（Request changes）與 security-reviewer（Approve with changes）的動工前審查修訂。
> 修訂處標「〔審查〕」。兩項待人工決定的項目已於同日決定，見本段最後的「人工決定」。

### A. 部署、相容性與單一資料庫隔離

- 專案只有一個 Supabase 資料庫（Preview 不連資料庫，見 2026-10 commit「Vercel 只自動部署 master 分支」），
  migration 由人工貼到 SQL Editor 套用，**套用當下就會影響正式環境**。所以每一支 migration 都必須能
  和「目前 master 上的舊版程式碼」共存：
  - `0017`（本卡）：只新增資料表、新增 nullable 欄位並回填。舊版 `create_appointment` 照常寫入，新預約
    的 `designer_id` 暫時是 `null`，舊的全店 exclusion constraint 仍然有效，不會雙重預約。
  - `0018`（TASK-068）：補回填 `null`、改成 `not null`、換 exclusion constraint、改寫兩支 RPC。新參數
    `p_designer_id` 都有 `default null`，舊前端不傳這個參數也能正常預約（等同「不指定」）。drop 舊簽名與
    create 新簽名必須在同一個交易內。
- 分支 `feat/multi-designer` 全部完成、人工驗收後才合併 master，觸發 Vercel 部署。
- 〔審查〕**回滾順序**：先在 Vercel 回滾前端 → 再執行 `0018_down` → 最後才是 `0017_down`。順序反過來，新前端
  帶 `p_designer_id` 的呼叫會找不到函式（PGRST202），整個預約功能中斷。`0017_down` 刪除 `designer-assets`
  bucket 前要先清空檔案（比照 `0006_store_settings_down.sql` 檔頭）。這段寫進兩支 `_down` 的檔頭。
- 〔審查〕**單一資料庫資料隔離規則**（`0018` 套用後到合併 master 之間，master 舊前端一律走「不指定」，任何
  啟用中、開了真實服務的設計師都會被真實顧客的預約指派到）。所有任務卡的開發、測試、走查都必須遵守：
  1. 測試與走查建立的設計師、服務一律以 `__TEST__` 開頭；測試設計師**只能**對 `__TEST__` 服務開啟。
  2. 禁止修改「預設設計師」（也就是目前唯一的真實設計師）的服務開關、請假與停用狀態。
  3. 整合測試共用 `tests/helpers/designer-fixture.ts`（TASK-068 建立）：每個套件建立自己的測試設計師，`afterAll`
     用 service_role 先刪預約再刪設計師；走查結束後同樣清除。
  4. TASK-077 合併前用 SQL 確認：沒有殘留的 `__TEST__` 設計師與相關資料；沒有「上架中但沒有任何設計師」的服務
     （`0017` 套用後到合併前，舊後台新增的服務不會自動開給任何設計師，要人工處理）。

### B. 資料模型（`0017_designers.sql`）

| 表 | 欄位 | 約束 |
|---|---|---|
| `designers` | `id uuid pk`、`name text`、`bio text null`、`specialties text[] not null default '{}'`、`instagram_handle text null`、`avatar_url text null`、`is_active boolean not null default true`、`sort_order int not null default 0`、`created_at`、`updated_at` | `name` 去頭尾空白後 1～30 字且 `name !~ '[[:cntrl:]]'`〔審查〕；`bio` ≤ 200 字；`specialties` 由 `public.designer_specialties_valid(text[])`（immutable）檢查 0～5 個、每個 1～12 字、不重複；`instagram_handle ~ '^[A-Za-z0-9._]{1,30}$'`（不含 `@`，前端送出前去掉）；`avatar_url` 長度 ≤ 2048〔審查〕；`updated_at` 沿用既有 `set_updated_at()` trigger |
| `designer_services` | `designer_id`、`service_id` | 複合主鍵；兩個外鍵都 `on delete cascade`（服務本身只會下架不會刪，cascade 只是保險） |
| `designer_leaves` | `designer_id`、`date date`、`created_at` | 複合主鍵；外鍵 `on delete cascade` |
| `designer_portfolio_images` | `id uuid pk`、`designer_id`、`image_url text`、`storage_path text unique`、`created_at` | 索引 `(designer_id, created_at desc)`；〔審查〕`storage_path ~ ('^portfolio/' \|\| designer_id \|\| '/[0-9a-f-]{36}\.(jpg\|png\|webp)$')`、`image_url` 以 `storage_path` 結尾且長度 ≤ 2048；`after insert` trigger 先 `select ... for no key update` 鎖住設計師列再數張數，> 12 時以固定 errcode（`P0001`）加固定訊息前綴 `PORTFOLIO_LIMIT` 拋出，前端依此對應文案；〔審查〕trigger 函式用 `security definer`＋`set search_path = ''`，張數計算不受呼叫者 RLS 影響；〔實作期修訂，security-reviewer 實作後審查 M1〕原設計是 `before insert`＋`for update`，但 RLS 的 WITH CHECK 在 BEFORE ROW trigger 之後才檢查，任何自行註冊的使用者（Supabase 公開註冊開著）在被 42501 擋下之前就會以 postgres 身分觸發它（取鎖、以錯誤碼探測作品張數）；改成 AFTER（RLS 與 constraint 通過後才執行）。鎖用 `for no key update` 而不是 `for update`：外鍵檢查已持有 `for key share`，兩個並行交易再要 `for update` 會互相等待而死結，`no key update` 與 `key share` 相容、彼此互斥，也不會擋住 0018 的 `create_appointment` |
| `appointments`（既有） | 新增 `designer_id uuid null references designers(id)`（不 cascade，設計師只會停用不會刪） | 索引 `(designer_id, start_at)` |

回填：〔審查〕「建立預設設計師」與「把**全部既有服務**（含下架中）對他開啟」放在**同一個條件分支**，只在
`designers` 沒有任何列（第一次執行）時做，重跑 `0017` 不會把店長關掉的服務重新打開；`update appointments
set designer_id = <預設設計師> where designer_id is null` 則每次都跑（冪等）。「預設設計師」的辨識方式：
`order by created_at, id limit 1`（TASK-068 補回填時用同一個規則）。回填會經過 `set_updated_at` trigger，
所有既有預約的 `updated_at` 會被刷新，可以接受，寫在 migration 檔頭；回填不符合 `0012` 改期 webhook 的
WHEN 條件，不會寄信（architect 已驗證）。

### C. RLS 與 GRANT（比照 TASK-065 規則：先對三個角色 `revoke all`，再逐一明確 grant）

| 表 | anon | authenticated | service_role〔審查〕 | 說明 |
|---|---|---|---|---|
| `designers` | `select (id, name, bio, specialties, instagram_handle, avatar_url, sort_order, is_active)`，policy `using (is_active)` | `select`、`insert (name, bio, specialties, instagram_handle, avatar_url, is_active, sort_order)`、`update (同上欄位)`〔審查：欄位層級，排除 `id`、`created_at`；實作期修訂：insert 原為 table-level，改成欄位層級（security-reviewer 實作後審查 L1）——「預設設計師」以 `order by created_at, id` 辨識，insert 若能自訂 `created_at`，管理員 session 被盜用時可塞一位最早建立的設計師冒充預設設計師〕；policy 1「public read active」`using (is_active)`，policy 2「admin full access」`using/with check (is_admin())` | `select, insert, update, delete` | authenticated **不 grant delete**：設計師只能停用；delete 只給 service_role（測試清理用） |
| `designer_services` | `select`，policy：`exists (select 1 from designers d where d.id = designer_services.designer_id and d.is_active)` | `select, insert, delete`（`is_admin()`）＋同樣的公開讀 policy | `select, insert, update, delete` | 開關＝insert／delete 一列 |
| `designer_portfolio_images` | `select (id, designer_id, image_url, created_at)`，policy 同上（以 `d.is_active` 判斷） | `select, insert, delete`（`is_admin()`）＋公開讀 policy | `select, insert, update, delete` | `storage_path` 不給 anon（沒有保密作用，公開網址本來就含路徑；只是讓前台查詢必須列出欄位） |
| `designer_leaves` | **無** | `select, insert, delete`（`is_admin()`） | `select, insert, update, delete` | 請假日是個人行程，前台不能直接讀，只透過 `SECURITY DEFINER` RPC 間接影響時段 |
| `appointments`（既有） | 不變（無） | 追加 `grant select (designer_id)`；**不** grant `update (designer_id)` | 既有（全權） | 不能改派在資料庫層就生效 |

- 四張新表都 `revoke truncate ... from anon, authenticated`；**都不得啟用 `force row level security`**
  （TASK-068 的 RPC 依賴讀得到資料列，理由同 `booking_policy`／`closed_dates`）。
- 〔審查〕隱藏依賴：anon 對 `designers` 的欄位 grant **必須保留 `id` 與 `is_active`**，另外兩張表的公開讀 policy
  子查詢以 anon 身分執行、依賴這兩欄；日後拿掉會讓 anon 讀 `designer_services`／作品集整個變成 42501。
  整合測試要有「anon 讀 `designer_services` 成功」的回歸案例。policy 內一律用表別名限定欄位。
- 〔審查〕前台查詢**一律列出明確欄位，不得使用 `*`**（anon 只有欄位層級 grant，`select("*")` 會 42501），
  並且一律自己過濾**設計師**的 `is_active`：管理員登入狀態下瀏覽前台時是 authenticated＋`is_admin()`，RLS 會
  放行停用中的設計師與他的 `designer_services`。
- 原本的已知殘留「`is_admin()` 不檢查 aal2」已排入 TASK-079（排在本 Epic 之前，security-reviewer 也建議作為
  合併前置條件），新表的寫入 policy 會自動受到保護。

### D. Storage

- 新 bucket `designer-assets`：public read、5MB、`image/jpeg|png|webp`。
- 〔審查〕storage.objects policy（比照 `0006`／`0007` 的完整寫法）：
  - `admin read designer assets`：`for select to authenticated using (bucket_id = 'designer-assets' and is_admin())`。
    **必要**：Supabase `storage.remove()` 需要 select＋delete 兩種權限，缺 select 時不會回錯誤、只回 `data: []`，
    檔案根本沒刪掉。**不給 anon select**，避免被列舉所有檔案。
  - insert：`with check (bucket_id = 'designer-assets' and is_admin() and (storage.foldername(name))[1] in ('avatar','portfolio') and (storage.foldername(name))[2] ~ '^[0-9a-f-]{36}$')`。
  - delete：`using (bucket_id = 'designer-assets' and is_admin())`。
  - **不建 update policy**：檔名一律是新的 uuid，用不到覆寫；session 被盜也無法「同一個網址偷偷換圖」。
- 路徑由程式產生，不用使用者檔名：`avatar/<designer_id>/<uuid>.<ext>`、`portfolio/<designer_id>/<uuid>.<ext>`。
- 〔審查〕上傳前在瀏覽器用 canvas 重新編碼（輸出 webp），去除 EXIF（GPS、拍攝時間），也擋掉多格式混合檔案。
- 〔審查〕刪除檔案時檢查 `remove()` 回傳 `data.length === 1`，不是 1 就給店長看得到的警告（不再只是記錄）。
  整合測試要驗證刪除後公開網址回 400／404，不能只驗資料列消失。
- 〔審查〕網址白名單**沿用 `lib/admin/account.ts` 的 `resolveAdminAvatarUrl` 寫法**（解析 URL 後比對 origin＋
  pathname，會正規化 `..`／`%2e%2e`），不要用 `lib/store-settings.ts` 的 `startsWith` 字串比對（環境變數缺漏時
  前綴會變成字面的 `"undefined/..."`）。`avatar_url` 與 `image_url`、前台與後台都要套用。
- 已知殘留：CDN 快取在 cache-control 到期前仍可能回傳已刪除的圖片；停用設計師後，頭像與作品仍可用原網址讀到。

### E. RPC 契約（`0018`，由 TASK-068 實作，這裡先定案讓其他卡可以並行規劃）

- `get_available_slots(p_service_id uuid, p_date date, p_designer_id uuid default null) returns jsonb`
  - 回傳格式不變：`{ ok: true, data: [{ start_at, end_at }] }`，**不含任何設計師識別資訊**。
  - 指定設計師：該設計師「合格」（啟用中、有開該服務、當天沒請假）且該時段空閒（含雙方 buffer）才列出。
    不合格時回傳空陣列：「不存在、停用、沒開服務、請假、滿檔」在單次回應中看起來完全一樣。
  - 不指定：至少一位合格設計師在該時段空閒就列出。
  - 其餘規則（公休日、固定營業時間、提前量、90 天視野、30 分鐘格點）完全不變。
  - 〔審查〕已知殘留：設計師 id 是公開的，攻擊者可以對每位設計師 × 90 天呼叫「指定」模式，推算各設計師的忙碌
    時段與疑似請假日。規格書已修正為「回應內容不含設計師識別資訊」，並列為已接受的殘留（人工決定 1）。
- `create_appointment(p_service_id, p_start_at, p_customer_name, p_customer_phone, p_customer_email, p_designer_id uuid default null) returns jsonb`
  - 成功時 `data` 追加 `designer_id`、`designer_name`。
  - 〔審查〕**檢查順序**（避免用 90 天外的時間探測設計師狀態，也讓大部分拒絕不碰 `customers`）：
    欄位驗證 → 服務 → 公休日 → 營業時間 → 提前量／視野 → **設計師候選清單**（清單為空直接 `return SLOT_CONFLICT`）
    → `BOOKING_LIMIT` → 顧客去重 → insert 迴圈。
  - 〔審查〕指定設計師＝只有一位候選人的清單，和「不指定」**共用同一個 insert 迴圈**，避免兩條路徑漂移。
    指定的設計師「不存在、停用、沒開服務、請假」四種情況回傳的 JSON 完全相同（含 `message`）。
  - 不指定的候選排序：`(當天 Asia/Taipei 有效預約數, sort_order, id)`。每位候選人在巢狀
    `begin ... exception when exclusion_violation` 內 insert，衝突就換下一位；全部失敗時
    `raise ... using errcode = 'exclusion_violation', constraint = 'appointments_no_overlap'`，交給既有外層
    handler 轉成 `SLOT_CONFLICT` 並回滾整個區塊（含顧客去重新建的 `customers` 列）。architect 已驗證寫法、
    併發等待與 webhook trigger 互動皆正確。
  - 候選清單**檢查 buffer**（人工決定 2，選項 a）：指定與不指定都只接受「合格且 `_designer_is_free`」的設計師，
    清單為空直接回 `SLOT_CONFLICT`。
  - 〔審查〕`BOOKING_LIMIT` **維持全店、以電話計算**，不改成每位設計師各自計算（多位設計師會讓可佔用的總容量
    變成 N 倍）。換電話號碼繞過上限是既有殘留，限流由 TASK-080 處理。
  - 共用判斷抽成兩支內部函式 `public._designer_is_eligible(designer_id, service_id, date)`、
    `public._designer_is_free(designer_id, start_at, end_at, buffer_minutes)`：宣告 `stable`、`set search_path = ''`、
    所有物件寫完整 schema 名稱；`revoke execute ... from public, anon, authenticated`。作品集 trigger 函式同樣 revoke。
    **`designer_specialties_valid` 例外（實作期定案）**：只 revoke public／anon，保留 authenticated 與 service_role
    的 execute——PostgreSQL 評估 CHECK 時會以當前使用者身分檢查函式的 execute 權限，revoke 會讓管理員寫入
    designers 全部失敗（整合測試證實管理員可寫入）；它是純函式、無副作用，公開沒有風險。
  - 〔審查〕**兩支 RPC 的 execute 權限要明寫**：`revoke ... from public, anon, authenticated; grant execute ... to anon, authenticated`。
    本專案 public schema 有 default privileges，drop 再 create 後授權會被重設；店長在同一個瀏覽器登入後台再開前台，
    會以 authenticated 身分呼叫。套用前用 `select proname, proacl from pg_proc where proname in (...)` 記下兩支 RPC
    目前的授權，套用後要一致（`lib/admin/reschedule-slots.ts:7-9`「authenticated 呼叫會被拒絕」的註解可能與實際
    不符，TASK-075 順手查證並更正）。
  - exclusion constraint 改為 `exclude using gist (designer_id with =, tstzrange(start_at, end_at, '[)') with &&) where (status in ('pending','confirmed','completed'))`，
    **名稱維持 `appointments_no_overlap`**（RPC 外層 handler 比對名稱；後台只看 23P01）。
    需要 `create extension if not exists btree_gist with schema extensions`。
  - 〔審查〕`0018` 開頭 `lock table public.appointments in share row exclusive mode;`，避免回填與 `set not null`
    之間有舊 RPC 寫入 `null` 讓整支 migration 失敗；結尾 `notify pgrst, 'reload schema';`。
  - 已知殘留（既有，非本 Epic 引入）：exclusion constraint 不含 buffer，併發時兩筆相鄰預約仍可能吃掉緩衝時間，
    TASK-068 記錄到 `decisions.md`。

### F. 前後端分層

- `lib/designers.ts`（本卡新增，`lib/` 頂層）：設計師型別、公開欄位清單、`resolveDesignerAssetUrl` 白名單。
  前台（TASK-073／074）與後台（TASK-069～072）共用，比照 `lib/store-settings.ts`／`lib/booking-policy.ts` 的分層方向。
- `lib/admin/designers.ts`（本卡建立讀取函式，後續卡新增寫入函式）：只給後台用。
- 前台全頁個人頁：用 MUI `Dialog fullScreen`，開啟時 `history.pushState`、`popstate` 時關閉，不新增路由，
  預約進度留在 `BookingFlow` 的 state（TASK-074）。
- 〔審查〕TASK-070／071／072 都會改 `lib/admin/designers.ts`、`DesignerEditView.tsx`、`tests/designers.integration.test.ts`，
  **依序執行，不並行**。

### 人工決定（2026-10-21）

1. **隱私承諾修正**：照建議修改。規格書已改為「時段查詢的回應內容不含設計師識別資訊」，並把「各設計師排程可透過
   逐一查詢推算」列為已接受的殘留風險（`feature-spec.md`「安全性與隱私」）。
2. **`create_appointment` 檢查 buffer**：選 **(a) 指定與不指定兩條路徑都檢查**。候選清單＝合格且
   `_designer_is_free`（含雙方 buffer）的設計師。這是對 `decisions.md` TASK-022「緩衝只是排程偏好」的有意收緊：
   繞過前端、擠進 buffer 的直接 API 請求會從成功變成 `SLOT_CONFLICT`；前台顧客本來就看不到這些時段，不受影響。
   TASK-068 要在 `decisions.md` 記錄這個收緊，並保留「exclusion constraint 不含 buffer，併發時仍可能吃掉緩衝」
   的既有殘留。
3. **建立預約的限流**：另開 TASK-080（Turnstile／依 IP 限流），不在本 Epic 範圍。

## 情境包（Context Pack）

- 相關檔案：
  - `supabase/migrations/0006_store_settings.sql`（新增資料表＋Storage bucket＋policy 的既有寫法）
  - `supabase/migrations/0007_admin_profile.sql`（`admin-assets` bucket 與白名單）
  - `supabase/migrations/0015_explicit_table_grants.sql`（最小權限 GRANT 寫法、`appointments` 欄位層級 grant）
  - `supabase/migrations/0003_closures_and_buffer.sql`（`closed_dates` 的 RLS 與不得 force RLS 的說明）
  - `app/admin/services/page.tsx`、`app/admin/_components/ServicesTable.tsx`（表格列表骨架的既有寫法）
  - `app/admin/_components/AdminShell.tsx`（`NAV_ITEMS` 與手繪 SVG 圖示，TASK-064 慣例）
  - `lib/store-settings.ts`（`resolveStoreDisplay` 網址白名單）
- 既有模式：`Result<T>` 錯誤處理、通用錯誤訊息不外洩原始錯誤、migration 可重複執行且 up/down 成對、
  依賴檢查用 `do $$ ... to_regclass ... $$`。
- 假設：`0015` 已套用（2026-10-21 已套用）；`0016` 由 TASK-079（`is_admin()` 強制 aal2）使用，人工已決定
  TASK-078／079 排在本 Epic 之前，所以本 Epic 的 migration 是 `0017`／`0018`。TASK-079 完成後，新資料表的
  `is_admin()` 寫入 policy 自動要求已啟用 MFA 的帳號達到 aal2。
- 未知事項：
  - `designer_portfolio_images` 張數 trigger 用 `for update` 鎖設計師列，管理者只有一人，競態風險極低；
    實作時確認 trigger 錯誤訊息能被前端轉成「已達 12 張上限」。
- 允許變更的檔案：
  - `supabase/migrations/0017_designers.sql`、`0017_designers_down.sql`（新增）
  - `lib/designers.ts`（新增）、`lib/admin/designers.ts`（新增，本卡只有 `listDesigners`）
  - `app/admin/designers/page.tsx`（新增）、`app/admin/_components/DesignersTable.tsx`（新增，唯讀骨架）
  - `app/admin/_components/AdminShell.tsx`（新增「設計師」導覽項目與圖示，放在「預約」之後）
  - `tests/designers.integration.test.ts`、`vitest.designers.config.ts`（新增）、`package.json`（新增 `test:designers`）
  - `tests/lib/designers.test.ts`（新增，白名單與驗證純函式）
- 不得觸碰：
  - `get_available_slots`／`create_appointment`（TASK-068）
  - `app/_components/booking/`（TASK-073／074）
  - 既有 exclusion constraint（TASK-068）

## 需求

- 依架構筆記 B／C／D 建立 `0017_designers.sql` 與 `_down.sql`。
- WHEN 已登入管理員造訪 `/admin/designers` THE SYSTEM SHALL 依 `sort_order` 以表格唯讀列出所有設計師
  （含停用中），欄位比照 mockup Variant A：順序、設計師（頭像＋名字）、專長、提供服務數、狀態、操作
  （操作按鈕本卡先停用）。
- WHEN 套用 `0017` THE SYSTEM SHALL 讓既有預約全部有 `designer_id`，而既有 RPC 與前台行為不變。

## 驗收標準

- `0017` 可重複執行；`_down` 可完整回滾。
- 套用**當下** `appointments.designer_id` 無 `null`（之後舊 RPC 寫入的 `null` 由 `0018` 補回填，〔審查〕）；
  預設設計師對所有既有服務開啟；重跑 `0017` 不會重新打開店長已關閉的服務。
- RLS／GRANT 邊界符合架構筆記 C 的表格（整合測試逐項驗證）。
- Storage `designer-assets` 只有 admin 可寫。
- Sidebar「設計師」可導覽到列表頁；未登入／非 admin 進不去（沿用 `app/admin/layout.tsx`）。
- 〔審查〕`0017` 套用後，**未修改**的既有整合測試套件全部通過（證明行為不變）。
- 開發與走查遵守架構筆記 A 的單一資料庫隔離規則。

## 實作備註

- 列表頁沿用 Variant A 表格樣式；停用中的設計師列用 `text.disabled` 與 0.5 透明度頭像。
- 頭像沒有圖時用 MUI `Avatar` 顯示名字首字。

## 驗證契約

- 單元測試：`designer_specialties_valid` 對應的前端驗證純函式、`resolveDesignerAssetUrl` 白名單。
- 整合測試：`npm run test:designers`——anon 只讀得到啟用中設計師的公開欄位；anon 讀 `designer_leaves`
  被拒（42501）；anon／非 admin authenticated 寫入四張表皆被拒；admin 可寫；admin 刪除 `designers` 被拒；
  作品第 13 張被 trigger 擋下；check constraint 擋下非法 IG 帳號與專長；authenticated 可讀
  `appointments.designer_id` 但不能 update。〔審查〕補充：service_role 可讀寫四張表並可刪除 `designers`；
  anon 讀 `designer_services` 成功（欄位 grant 隱藏依賴的回歸）；Storage 只有 admin 可 insert／delete、
  沒有任何角色可 update、anon 無法 list；路徑前綴不是 `avatar`／`portfolio` 時 insert 被拒。
- E2E 測試：Browser 走查登入後台 → Sidebar「設計師」→ 列表顯示預設設計師。
- 型別檢查：`npx tsc --noEmit`
- Lint：`npm run lint`
- Build：`npm run build`
- 螢幕截圖：設計師列表頁（預設）。
- 安全性檢查：security-reviewer 審查 RLS／GRANT／Storage policy；確認無 force RLS；確認四張表的 service_role grant 存在。

## 完成證據

完整內容見 [`../verification/TASK-067.md`](../verification/TASK-067.md)。

- 變更的檔案：`supabase/migrations/0017_designers.sql`、`0017_designers_down.sql`；`lib/designers.ts`、`lib/admin/designers.ts`；`app/admin/designers/page.tsx`、`app/admin/_components/DesignersTable.tsx`、`AdminShell.tsx`（新增「設計師」導覽項目與圖示）；`tests/designers.integration.test.ts`、`vitest.designers.config.ts`、`package.json`（`test:designers`）；`tests/lib/designers.test.ts`、`tests/admin/designers.test.ts`、`tests/components/designers-table.test.tsx`、`tests/components/admin-shell.test.tsx`。
- 執行過的指令：`tsc --noEmit`、`npm run lint`、`npm run build`、`npm test`（549 項）、`npm run test:designers`（44 項）、既有 10 套整合測試回歸；正式資料庫唯讀查詢；瀏覽器走查。
- 測試輸出：全數通過，詳見驗證報告。
- 螢幕截圖：設計師列表（載入中、已載入、窄寬度修正前後、桌面寬度），見驗證報告。
- 已知限制：見驗證報告「殘留風險」——公開註冊未關閉（待人工決定）、0017 重跑冪等與 down 未在隔離環境實跑、`test:mfa-rls` 未涵蓋新表、既有套件 global signOut。
- 實作期偏離原設計（已更正於上方架構筆記）：作品集 trigger 改 AFTER＋`for no key update`；`designers` insert 改欄位層級；`designer_specialties_valid` 保留 authenticated 的 execute；Storage insert policy 補層數與副檔名限制。
- 後續任務：TASK-068～TASK-077
