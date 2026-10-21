# AI-Ready 任務卡

## Metadata

- 任務：多位設計師 後台設計師列表操作與「基本資料」頁籤（新增、編輯、停用／重新啟用、排序、頭像、專長標籤）
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：多位設計師
- 上層 User Story：管理設計師基本資料
- 分軌：前後端串接（後台畫面＋`lib/admin/designers.ts` 寫入函式；資料表已由 TASK-067 建立）
- 前置任務（dependsOn）：TASK-067
- 狀態：就緒前審查中（人工已於 2026-10-21 核准；動工前先完成 architect／security-reviewer 架構審查）
- 風險等級：中（後台寫入與頭像上傳，沿用既有 Storage／表單模式）
- Agent owner：Claude Code
- 人工核准者：使用者

## 目標

讓店長在 `/admin/designers` 完成設計師的新增、停用／重新啟用、順序調整，並在編輯頁
`/admin/designers/[id]` 建立四頁籤框架，完成「基本資料」頁籤（名稱、IG、專長、簡介、頭像）。其他三個頁籤
本卡只放占位內容，分別由 TASK-070／071／072 完成。

## 情境包（Context Pack）

- 相關檔案：
  - `ai/artifacts/多位設計師/screen-spec-後台設計師管理.md`、`mockup-decision-後台設計師管理.md`（Variant A）
  - `ai/artifacts/多位設計師/mockups/admin-designers-variant-a.html`（畫面 1、2、3、7）
  - `app/admin/_components/ServicesTable.tsx`、`ServiceFormDialog.tsx`（表格、二次確認、表單驗證的既有寫法）
  - `app/admin/_components/StoreSettingsForm.tsx`、`components/ui/ImageUploadField.tsx`（圖片上傳四態）
  - `lib/admin/account.ts`（`uploadAdminAvatar`／`removeAdminAvatar` 的 Storage＋資料列更新順序）
  - TASK-067 架構筆記 B／C／D／F
- 既有模式：表單驗證純函式放 `lib/`、元件只呼叫；`Result<T>`；寫入成功用 Toast；二次確認用 `ConfirmDialog`。
- 假設：新增設計師＝直接進入空白編輯頁，按「儲存」才建立（Variant A，無 Modal）；建立成功後網址換成
  `/admin/designers/<id>`，其他頁籤才可用。
- 未知事項：無。
- 允許變更的檔案：
  - `lib/admin/designers.ts`（`getDesigner`、`createDesigner`、`updateDesignerBasicInfo`、`setDesignerActive`、
    `swapDesignerOrder`、`countFutureAppointmentsForDesigner`、`uploadDesignerAvatar`、`removeDesignerAvatar`）
  - `lib/designers.ts`（新增驗證純函式：名稱、IG 帳號正規化與驗證、專長、簡介）
  - `app/admin/designers/page.tsx`、`app/admin/designers/new/page.tsx`、`app/admin/designers/[id]/page.tsx`（新增）
  - `app/admin/_components/DesignersTable.tsx`（啟用操作欄）
  - `app/admin/_components/DesignerEditView.tsx`（新增，頁籤框架）
  - `app/admin/_components/DesignerBasicInfoForm.tsx`（新增）
  - `components/ui/ImageUploadField.tsx`（只允許為支援圓形頭像預覽新增選填 prop，不改既有行為）
  - `ai/context/design-system.md`（S4 inventory 登記 `TagInput` 用法：MUI `Autocomplete multiple freeSolo`）
  - `tests/lib/designers.test.ts`、`tests/admin/designers.test.ts`（新增）
  - `tests/designers.integration.test.ts`（擴充寫入函式案例）
- 不得觸碰：`designer_services`／`designer_portfolio_images`／`designer_leaves` 的寫入（TASK-070～072）。

## 需求

- 列表頁：「新增設計師」、編輯、停用、重新啟用、上下箭頭排序（第一列不能上移、最後一列不能下移）。
- 停用：`ConfirmDialog` 顯示未來有效預約筆數；停用最後一位啟用中的設計師時額外警告。
- 基本資料：欄位驗證依 feature-spec（名稱 1～30、IG 格式、專長 0～5 個且每個 ≤ 12 字不重複、簡介 ≤ 200），
  前端錯誤文案依 screen-spec；IG 輸入框前綴顯示 `@`，送出時去掉使用者輸入的 `@`。
- 頁面上方顯示「這些資料會公開顯示在顧客預約頁」提示。
- 頭像：上傳／更換／移除，沿用 `ImageUploadField` 四態，路徑 `avatar/<designer_id>/<uuid>.<ext>`。
- 〔審查〕上傳前用 canvas 重新編碼成 webp（去除 EXIF）；更換頭像＝上傳新檔＋刪除舊檔（Storage 沒有 update policy），
  刪除舊檔時檢查 `remove()` 回傳筆數，不是 1 時顯示警告；網址白名單用 `resolveAdminAvatarUrl` 的 URL 解析寫法
  （TASK-067 架構筆記 D）。
- 〔審查〕走查與測試遵守單一資料庫隔離規則：只操作 `__TEST__` 設計師，不得停用或修改預設設計師（TASK-067 架構筆記 A）。

## 驗收標準

- 所有操作成功後列表或表單即時反映；失敗時顯示 Toast 通用訊息，畫面回到操作前狀態。
- 資料庫 check constraint 擋下的非法值不會出現（前端先擋），即使繞過前端也會被資料庫拒絕。
- 停用後，設計師在列表顯示「已停用」並可重新啟用。

## 實作備註

- 排序：`swapDesignerOrder` 交換兩列的 `sort_order`（兩次 update），任一失敗就重新讀取列表，不做樂觀更新。
- 新增設計師時 `sort_order` 取目前最大值 + 1。

## 驗證契約

- 單元測試：驗證純函式（各邊界值）、IG 帳號正規化、`swapDesignerOrder` 失敗時的回傳。
- 整合測試：admin 可建立／更新／停用設計師、可上傳頭像到 `designer-assets`；非 admin 寫入被拒。
- E2E 測試：Browser 走查新增設計師 → 填資料 → 儲存 → 回列表排序 → 停用（含警告對話框）→ 重新啟用。
- 型別檢查／Lint／Build：`npx tsc --noEmit`、`npm run lint`、`npm run build`
- 螢幕截圖：列表（含停用中）、停用確認、基本資料頁籤（預設與驗證錯誤）、暗色模式各一張。
- 安全性檢查：頭像網址只信任 `designer-assets` bucket；上傳只接受 jpg/png/webp、5MB。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：
- 已知限制：
- 後續任務：TASK-070、TASK-071、TASK-072
