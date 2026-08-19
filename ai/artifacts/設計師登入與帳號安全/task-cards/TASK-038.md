# AI-Ready 任務卡

## Metadata

- 任務：設計師登入與帳號安全 架構基礎（admins 個人資料欄位、SECURITY DEFINER RPC、admin-assets Storage bucket、帳號設定頁骨架、Sidebar 顯示登入者資訊）
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：設計師登入與帳號安全
- 上層 User Story：修改密碼／個人資料
- 分軌：不適用（同時涉及資料庫遷移與頁面骨架，比照 TASK-029 的「架構基礎」不強套三分法）
- 前置任務（dependsOn）：TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006, TASK-007, TASK-008, TASK-009, TASK-014
- 狀態：完成（人工已於 2026-08-18 驗收通過）
- 風險等級：高（新增 `admins` 表欄位與 SECURITY DEFINER RPC——`admins` 表刻意零 RLS policy
  的既有安全設計，任何 RPC 邏輯錯誤都可能讓非管理員繞過身分邊界；新增 Storage bucket 若權限
  設定有誤會造成檔案外洩或被竄改；需架構、安全性、測試三方審查）

## 目標

新增 `admins.display_name`／`admins.avatar_url` 欄位與對應的 `SECURITY DEFINER` RPC（讀取／
更新自己的個人資料），新增 `admin-assets` Storage bucket，建立 `/admin/account` 受保護頁面
骨架（唯讀顯示目前個人資料），並讓後台 Sidebar 顯示目前登入設計師的顯示名稱與大頭貼。不含
可編輯的表單互動、密碼／Email／MFA 邏輯，留給後續任務卡。

## 情境包（Context Pack）

- 相關檔案：
  - `supabase/migrations/0001_core_schema.sql`：`admins` 表定義與註解（「一般角色（含
    authenticated 自己）完全無法直接讀寫這張表，只有 SECURITY DEFINER function 能繞過
    RLS」），本卡新增欄位與 RPC 必須延續這個既有安全姿態，**不得**為 `admins` 表新增任何
    直接開放的 table-level RLS policy。
  - `supabase/migrations/0006_store_settings.sql`：最近一次新增 Storage bucket 的既有寫法
    （`file_size_limit`／`allowed_mime_types`／`on conflict do update`／路徑前綴限制），
    `admin-assets` bucket 比照同一套模式建立，只調整 bucket 名稱與路徑前綴（例如
    `avatar/`）。
  - `lib/store-settings.ts`：既有「讀取＋更新」薄封裝函式寫法，`lib/admin/account.ts`
    （本卡新增）比照同樣的 `Result<T>` 錯誤處理模式。
  - `app/admin/_components/AdminShell.tsx`：`NAV_ITEMS` 目前沒有「帳號設定」項目，本卡
    新增 `{ label: "帳號設定", href: "/admin/account" }`。
  - `components/ui/Sidebar.tsx`：本卡在 `logoutSlot` 上方或整合處新增顯示大頭貼＋顯示
    名稱的區塊（比照 mockup 變體 A 的 `.sidebar-profile` 樣式），需要 `AdminShell.tsx`
    額外傳入目前登入者的 `display_name`／`avatar_url`（透過本卡新增的 RPC 讀取）。
  - `ai/artifacts/設計師登入與帳號安全/screen-spec-帳號設定頁.md`（已核准畫面規格，
    變體 A：單頁捲動五卡片，本卡只做骨架與唯讀顯示）。
  - `ai/artifacts/設計師登入與帳號安全/mockups/account-settings-variant-a.html`（狀態 1
    「預設」為本卡對應的唯讀顯示版本，不含互動）。
- 既有模式：
  - `is_admin()` 的既有寫法（`security definer`／`set search_path = ''`／`stable`）是本卡
    新 RPC 的直接範本；讀取／更新自己個人資料的 RPC 內部用 `auth.uid()` 找到對應
    `admins` 列，不需要額外的角色檢查（能呼叫到這支 RPC 的前提就是已通過 `authenticated`
    身分驗證，函式內部再確認 `auth.uid()` 存在於 `admins` 表）。
  - Storage bucket 政策比照 `store-assets`：只有 `is_admin()` 可寫入，公開讀取。
- 假設：
  - 新增兩支 RPC（或一支讀取＋一支更新，實作階段依既有慣例決定是否合併）：
    - `get_admin_profile()`：回傳目前登入者的 `display_name`／`avatar_url`（`auth.uid()`
      找不到對應列時，代表非管理員呼叫，回傳空值或依既有慣例處理，不拋出洩漏內部狀態的
      錯誤訊息）。
    - `update_admin_profile(p_display_name text, p_avatar_url text)`：更新目前登入者的
      `display_name`／`avatar_url`，`auth.uid()` 對應列不存在時視為非管理員，拒絕更新
      （不寫入、回傳失敗）。
  - `avatar_url` 欄位驗證：與 `store_settings.logo_url` 比照，只信任 `admin-assets`
    bucket 底下的網址（前端渲染時的白名單邏輯留給 TASK-041，本卡只需確保 RPC／欄位本身
    不限制格式，白名單是前端渲染層的既有既有慣例）。
  - `/admin/account` 頁面本卡先做唯讀顯示（目前顯示名稱、目前大頭貼、密碼區塊顯示遮罩
    文字如「••••••••」不可編輯、Email 區塊唯讀顯示目前 email、MFA 區塊唯讀顯示「未啟用」），
    所有「編輯／儲存」按鈕本卡先渲染但不需要有實際寫入行為。
- 未知事項：無。
- 允許變更的檔案：
  - `supabase/migrations/0007_admin_profile.sql`（新增）
  - `supabase/migrations/0007_admin_profile_down.sql`（新增）
  - `lib/admin/account.ts`（新增，讀取個人資料的薄封裝函式）
  - `app/admin/account/page.tsx`（新增）
  - `app/admin/_components/AccountSettingsView.tsx`（新增，唯讀骨架，實際命名可依實作
    階段調整）
  - `app/admin/_components/AdminShell.tsx`（新增 Sidebar 導覽項目、讀取並傳入登入者
    個人資料）
  - `components/ui/Sidebar.tsx`（新增顯示名稱／大頭貼區塊）
- 不得觸碰：
  - `app/login/`（本卡不涉及登入頁改版，見 TASK-039）。
  - `supabase/migrations/` 既有檔案（只新增 `0007`，不修改 `0001`～`0006`）。
  - `admins` 表不得新增任何 RLS policy（見「情境包」的既有安全姿態要求）。

## 需求

- 新增 `supabase/migrations/0007_admin_profile.sql`：
  - `alter table public.admins add column if not exists display_name text;`
  - `alter table public.admins add column if not exists avatar_url text;`
  - 新增 `get_admin_profile()`／`update_admin_profile(...)` 兩支 `SECURITY DEFINER` RPC，
    比照 `is_admin()` 的既有寫法慣例（`set search_path = ''`／適當的 `stable` 或
    `volatile` 標記）。
  - 新增 `admin-assets` Storage bucket，比照 `0006_store_settings.sql` 的既有寫法（
    `file_size_limit`／`allowed_mime_types` 限制 jpg/png/webp／5MB，`on conflict do
    update`，只有 `is_admin()` 可寫入，公開讀取，路徑前綴限制）。
  - 對應 `0007_admin_profile_down.sql`：欄位與 RPC／bucket 的回滾。
- WHEN 已登入管理員造訪 `/admin/account` THE SYSTEM SHALL 顯示帳號設定頁骨架，唯讀顯示
  目前的顯示名稱、大頭貼、目前 Email；密碼與 MFA 區塊顯示對應的預設唯讀狀態。
- WHEN 後台任何頁面渲染 Sidebar THE SYSTEM SHALL 顯示目前登入者的顯示名稱與大頭貼；
  兩者皆未設定時顯示合理預設（例如姓名縮寫圖示與「設計師」文字）。
- WHEN 非管理員呼叫 `get_admin_profile()`／`update_admin_profile(...)` THE SYSTEM SHALL
  拒絕或回傳空值，不洩漏其他管理員的個人資料（本專案僅一位管理員，此為防禦性設計）。

## 驗收標準

- Sidebar「帳號設定」連結可點擊並正確導覽至 `/admin/account`。
- 帳號設定頁正確唯讀顯示目前顯示名稱、大頭貼、Email。
- Sidebar 正確顯示登入者的顯示名稱與大頭貼，未設定時顯示合理預設，不顯示空白或錯誤。
- `admins` 表未新增任何直接開放的 RLS policy；`get_admin_profile`／`update_admin_profile`
  皆為 `SECURITY DEFINER`，非管理員呼叫被拒或回傳空值。
- `admin-assets` bucket 僅 `is_admin()` 可寫入，公開讀取；格式與大小限制生效。
- 未登入或非管理員無法看到頁面內容，沿用既有 `app/admin/layout.tsx` 保護機制。

## 實作備註

- 沿用 mockup 變體 A 的卡片版型（個人資料／密碼／Email／MFA 各自一張卡片），本卡先渲染
  骨架與唯讀內容，卡片內的「編輯」「儲存」按鈕可先無實際行為。
- Sidebar 大頭貼未設定時的預設樣式，建議用姓名縮寫（例如顯示名稱「Alex」→「A」）比照
  mockup 的 `.avatar` 樣式；顯示名稱也未設定時，用固定文字（例如「設」或「設計師」）。

## 驗證契約

- 單元測試：不適用（本卡為唯讀頁面骨架與純 SQL migration，若 `lib/admin/account.ts` 含
  資料轉換邏輯，視實作情況補上純函式測試）。
- 整合測試：對真實 Supabase 專案驗證 `get_admin_profile`／`update_admin_profile` 的權限
  邊界（非管理員呼叫被拒／回傳空值，管理員可成功呼叫）；`admin-assets` bucket 的上傳
  權限邊界（比照 `store-assets` 既有測試模式）；併入或先於 TASK-045 整合測試。
- E2E 測試：Browser 工具走查登入後台→點擊「帳號設定」→確認頁面骨架與 Sidebar 個人資料
  正確顯示。
- 型別檢查：`npx tsc --noEmit`
- Lint：`npm run lint`
- Build：`npm run build`
- 螢幕截圖：帳號設定頁骨架（預設）、Sidebar 顯示名稱/大頭貼已設定與未設定兩種狀態。
- 安全性檢查：`admins` 表零 RLS policy 的既有姿態未被打破；兩支新 RPC 皆為
  `SECURITY DEFINER` 且僅操作 `auth.uid()` 對應的自己那一列，不接受任意 `user_id`
  參數；`admin-assets` bucket 政策比照 `store-assets` 通過 security-reviewer 審查。

## 完成證據

詳見 `tools/kanban/cards/TASK-038.json` 的 `evidence` 欄位（commands／findings／residual）。
摘要：

- 變更的檔案：`supabase/migrations/0007_admin_profile.sql`／`_down.sql`（新增）、
  `lib/admin/account.ts`（新增）、`app/admin/account/page.tsx`（新增）、
  `app/admin/_components/AccountSettingsView.tsx`（新增）、
  `app/admin/_components/AdminProfileContext.tsx`（新增，architect 審查後補的狀態管理層）、
  `app/admin/_components/AdminShell.tsx`（修改）、`app/admin/layout.tsx`（修改，個人資料
  改在伺服器端讀取一次）、`components/ui/Sidebar.tsx`（修改）、`tests/admin/account.test.ts`
  （新增）。
- 執行過的指令：`npx tsc --noEmit`／`npm run lint`／`npm run build` 皆通過；
  `npx vitest run`（19 files／170 tests passed，含新增 15 tests，無回歸）。
- 審查：本卡風險等級高，依既有慣例派遣 architect 與 security-reviewer 子代理審查，
  兩者皆一開始判定「需要修改」，修正後重新驗證。關鍵發現：(1) 個人資料狀態原本在
  Sidebar／帳號設定頁各自獨立 fetch，Sidebar state 無對外更新通道，會讓 TASK-041 存檔
  後無法讓 Sidebar 即時反映——已重構為 `app/admin/layout.tsx` 伺服器端讀取一次＋
  `AdminProfileContext` 共用狀態＋`refresh()`。(2) **安全性關鍵**：本 Supabase 專案的
  `public` schema 設有 default privileges，新建立的 function 會自動額外把 execute 權限
  授予 `anon`，只 `revoke ... from public` 沒有實際撤銷——修正前用純 anon key（無
  session）呼叫兩支新 RPC 仍能成功執行（回傳 200），修正後（明確 `revoke from anon`）
  重新驗證取得正確的 401 permission denied。(3) `update_admin_profile` 原本讓超長
  `display_name` 觸發資料庫 constraint、拋出原始 Postgres 錯誤，與函式註解宣稱的「不
  拋錯」矛盾——已改為函式內部先驗證長度、回傳 `false`。
- 測試輸出：`tests/admin/account.test.ts` 涵蓋 `getAdminProfile`（含 RPC 空結果集/失敗）、
  `resolveAdminAvatarUrl`（白名單通過/外部網域/bucket 名稱相近/非法網址/偽協定/
  `NEXT_PUBLIC_SUPABASE_URL` 未設定等 8 種情境）、`resolveAdminDisplayName`。
- 螢幕截圖：Browser 工具對真實 Supabase 專案完整走查，取得登入後 Sidebar 個人資料顯示、
  跨頁面一致性（無 pop-in）、`/admin/account` 四張卡片唯讀顯示（顯示名稱欄位為空值＋
  placeholder，非「設計師」字面值）的畫面證據。
- 已知限制：`admins` 表零 RLS policy 的既有安全姿態目前僅靠程式碼審查把關，建議
  TASK-045 補上自動化斷言（`pg_policies` 計數為 0）；TASK-045 整合測試若用 service role
  直接呼叫這兩支 RPC 會得到 permission denied，需改用真實 designer session 驗證；
  `admin-assets` bucket 維持 public（已記錄取捨理由於 migration 檔案內，非遺漏）。
- 後續任務：TASK-041（顯示名稱與大頭貼編輯，需呼叫 context 的 `refresh()`）、TASK-042
  （密碼與 Email 修改）、TASK-043（MFA 註冊與停用）。
