# AI-Ready 任務卡

## Metadata

- 任務：設計師登入與帳號安全 帳號設定：顯示名稱與大頭貼編輯
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：設計師登入與帳號安全
- 上層 User Story：修改密碼／個人資料
- 分軌：前端
- 前置任務（dependsOn）：TASK-038
- 狀態：完成（使用者於對話中核准，2026-08-18）
- 風險等級：低（沿用 TASK-038 已建立的 `update_admin_profile` RPC 與 `admin-assets`
  bucket 權限邊界，不新增資料表或權限模型，比照 TASK-030／TASK-031 的低風險判定）

## 目標

在帳號設定頁的「個人資料」卡片接上實際編輯能力：顯示名稱可編輯並儲存，大頭貼可上傳／
更換／移除，成功後 Sidebar 即時反映。

## 情境包（Context Pack）

- 相關檔案：
  - `app/admin/_components/AccountSettingsView.tsx`（TASK-038 建立的唯讀骨架，本卡接上
    「個人資料」卡片的編輯能力）
  - `app/admin/_components/AdminProfileContext.tsx`（TASK-038 架構審查後補上的個人資料
    共用狀態，`AccountSettingsView` 已透過 `useAdminProfile()` 取得目前 `displayName`／
    `avatarUrl`；本卡儲存成功後**必須呼叫 `refresh()`**，Sidebar 才會即時反映新名稱／
    大頭貼——這是 TASK-038 architect 審查特別要求補上的更新通道，不要繞過 context
    自己另外用 `useState` 管理本卡的顯示狀態）。
  - `lib/admin/account.ts`（TASK-038 建立 `get_admin_profile` 的讀取函式與
    `resolveAdminAvatarUrl`／`resolveAdminDisplayName`，本卡新增
    `updateAdminProfile(displayName, avatarUrl)`／`uploadAdminAvatar(file)`／
    `removeAdminAvatar()`，皆呼叫 `update_admin_profile` RPC；該 RPC 內部已驗證
    `display_name` 長度 ≤ 50、`avatar_url` 長度 ≤ 2048，超長時回傳 `false` 而非拋錯，
    本卡前端驗證邏輯的上限需對齊這兩個數字）
  - `components/ui/ImageUploadField.tsx`（既有圖片上傳元件，TASK-031 建立，直接重用；
    比照該元件目前唯一使用場景 `store-settings` 的既有 props 介面）
  - `lib/store-settings.ts` 的 `uploadStoreImage`／`removeStoreImage` 寫法可直接參考
    「上傳至固定命名路徑、避免瀏覽器快取顯示舊圖」的既有慣例。
- 既有模式：
  - `resolveStoreDisplay` 的「只信任特定 bucket 底下網址」白名單模式（TASK-032
    security-reviewer 審查發現的既有慣例），本卡的 Sidebar 大頭貼渲染需要比照，只信任
    `admin-assets` bucket 底下的網址。
- 假設：
  - 大頭貼格式限制 jpg／png／webp，大小上限 5MB，比照 `store-assets` 既有規則。
  - 顯示名稱 trim 後長度需 > 0，長度上限 50 字。
  - 上傳／移除大頭貼與編輯顯示名稱可分開送出（各自有獨立的錯誤處理），或合併成單一
    「個人資料」卡片的單一儲存動作，實作階段依 mockup 變體 A 的既有版面（大頭貼與顯示
    名稱同一張卡片、共用一個「儲存」按鈕）決定；若合併，顯示名稱與大頭貼上傳需能各自
    獨立成功/失敗，不應該其中一個失敗就讓另一個也回滾（大頭貼上傳走 Storage API，顯示
    名稱走 RPC，兩者本來就是獨立呼叫）。
- 未知事項：無。
- 允許變更的檔案：
  - `app/admin/_components/AccountSettingsView.tsx`
  - `lib/admin/account.ts`
  - `app/admin/_components/AdminShell.tsx`（若 Sidebar 個人資料需要重新整理機制）
  - `tests/admin/account.test.ts`（新增，顯示名稱驗證純函式的單元測試）
- 不得觸碰：
  - `AccountSettingsView.tsx` 裡 TASK-042（密碼／Email）與 TASK-043（MFA）負責的卡片區塊。
  - `supabase/migrations/`（不新增遷移）。

## 需求

- WHEN 設計師編輯顯示名稱並送出 THE SYSTEM SHALL 驗證 trim 後非空白，通過後呼叫
  `update_admin_profile` 更新，成功後顯示成功 Toast，Sidebar 即時反映新名稱。
- WHEN 設計師上傳大頭貼圖片 THE SYSTEM SHALL 驗證格式（jpg/png/webp）與大小（5MB
  內），通過後上傳至 `admin-assets` bucket 並更新 `avatar_url`，顯示上傳後預覽，
  Sidebar 即時反映；格式或大小不符時顯示對應錯誤訊息。
- WHEN 設計師移除大頭貼 THE SYSTEM SHALL 清空 `avatar_url`，Sidebar 回退為預設頭像
  樣式（姓名縮寫或預設圖示）。
- WHEN 寫入失敗（網路或資料庫錯誤） THE SYSTEM SHALL 顯示通用錯誤 Toast，不外洩原始
  錯誤內容。

## 驗收標準

- 設計師可編輯並儲存顯示名稱，Sidebar 即時反映。
- 設計師可上傳、更換、移除大頭貼，Sidebar 即時反映；格式/大小不符有對應錯誤提示。
- 顯示名稱清空時無法送出，顯示行內錯誤。
- 非管理員（透過既有 RLS/RPC 邊界，非本卡新增邏輯）無法寫入，沿用 TASK-038 已建立的邊界。

## 實作備註

- 沿用 mockup 變體 A 的「個人資料」卡片版面：大頭貼在左，顯示名稱輸入在右，卡片底部
  單一「儲存」按鈕（大頭貼的上傳/移除為獨立的 chip 按鈕，不受「儲存」按鈕控制，比照
  mockup 呈現）。

## 驗證契約

- 單元測試：顯示名稱驗證純函式。
- 整合測試：對真實 Supabase 專案驗證管理員可成功更新個人資料/上傳大頭貼、非管理員被拒；
  併入 TASK-045。
- E2E 測試：Browser 工具走查編輯顯示名稱→儲存→Sidebar 反映；上傳大頭貼→預覽→Sidebar
  反映；移除大頭貼→Sidebar 回退預設；併入 TASK-045 或本卡自行走查皆可。
- 型別檢查：`npx tsc --noEmit`
- Lint：`npm run lint`
- Build：`npm run build`
- 螢幕截圖：顯示名稱編輯與驗證錯誤、大頭貼上傳中/預覽/移除、Sidebar 反映前後對照。
- 安全性檢查：確認 `avatar_url` 前端渲染時只信任 `admin-assets` bucket 底下的網址（白
  名單），避免被導向任意外部圖片網址；上傳路徑使用固定命名，避免路徑穿越。

## 完成證據

- 變更的檔案：`app/admin/_components/AccountSettingsView.tsx`（接上顯示名稱編輯與大頭貼
  上傳／移除）、`lib/admin/account.ts`（新增 `validateAdminDisplayName`／
  `updateAdminProfile`／`validateAdminAvatarFile`／`uploadAdminAvatar`／
  `removeAdminAvatar`）、`tests/admin/account.test.ts`（新增 22 個測試案例）。
  `components/ui/ImageUploadField.tsx` 未變更（見下方已知限制）。
- 執行過的指令：
  - `npx tsc --noEmit`（通過）
  - `npm run lint`（通過）
  - `npm run build`（通過）
  - `npx vitest run`（23 files／220 tests passed，含新增 22 case，既有測試無回歸）
  - Browser 工具對真實 Supabase 專案手動走查（`designer001@gmail.com` 登入）：
    1. 編輯顯示名稱「Alex Wang」並儲存 → 頭像縮寫與 Sidebar 即時變成「A」／
       「Alex Wang」。
    2. 用合成 `File`＋`DataTransfer` 觸發真實大頭貼上傳 → 頭像變成圖片、Sidebar
       同步、「移除」按鈕由停用轉為啟用。
    3. 點擊「移除」→ 頭像回退為縮寫、Sidebar 同步、「移除」按鈕轉回停用。
    4. 清空顯示名稱 → 行內錯誤「顯示名稱為必填」＋欄位邊框變色；點擊「儲存」正確被
       擋下（focus 欄位、不呼叫 RPC、Sidebar 未變）。
    5. 測試完成後以 service role 直接 PATCH `admins` 資料表，把 `display_name`／
       `avatar_url` 還原成測試前的原始快照（皆為 `null`），重新整理頁面確認 UI 與
       Sidebar 皆已還原。
- 測試輸出：`tests/admin/account.test.ts` 新增 22 個案例（顯示名稱驗證、
  `updateAdminProfile` 參數與錯誤處理、`validateAdminAvatarFile`、`uploadAdminAvatar`／
  `removeAdminAvatar` 的成功／失敗分支），全數通過。
- 螢幕截圖：顯示名稱編輯與儲存後 Sidebar 反映、大頭貼上傳中/後與 Sidebar 反映、移除大
  頭貼後 Sidebar 回退、顯示名稱清空的行內驗證錯誤，皆已於 Browser 走查過程截圖確認。
- 已知限制：
  - `components/ui/ImageUploadField.tsx` 內部直接 import `lib/store-settings.ts` 的
    `uploadStoreImage`／`removeStoreImage`／`validateStoreImageFile`（未把它們當成 props
    注入），只能操作 `store_settings` 表與 `store-assets` bucket，無法直接重用於
    `admins` 表／`admin-assets` bucket；且該元件未列在本卡「允許變更的檔案」清單。
    本卡骨架（TASK-038 建立）本身已經是「Avatar＋更換頭像／移除按鈕」的精簡版面
    （非 `ImageUploadField` 的拖放大方框版面），與 mockup 變體 A 一致，因此改在
    `AccountSettingsView.tsx` 內直接寫上傳邏輯，未產生新的共用元件、也未修改
    `ImageUploadField.tsx`。
  - 顯示名稱一旦儲存過非空值後，UI 不提供「清空回未設定狀態」的路徑（驗證擋掉空
    字串），為刻意的產品行為，非本卡遺漏。
  - 整合測試（對真實 Supabase 專案驗證非管理員無法寫入）併入 TASK-045，本卡未重複
    涵蓋。
- 後續任務：TASK-045（整合驗證）。
