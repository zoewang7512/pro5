# AI-Ready 任務卡

## Metadata

- 任務：服務項目管理 新增/編輯服務項目（Modal 表單、驗證、寫入）
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：服務項目管理
- 上層 User Story：新增/編輯服務項目
- 分軌：前端
- 前置任務（dependsOn）：TASK-034
- 狀態：完成（人工已於 2026-08-18 驗收通過）
- 風險等級：低（沿用 TASK-034 已建立的頁面骨架與既有 `services` RLS 邊界，寫入僅呼叫既有
  `admin full access to services` policy 保護的 `insert`／`update`，不新增資料表、不新增
  權限模型，比照 TASK-030 的低風險判定）

## 目標

在 TASK-034 建立的服務項目管理頁上，接上「新增服務項目」與「編輯服務項目」的 Modal 表單
（依已核准 mockup 變體 A）：名稱／價格／時長／描述可填寫並驗證，送出後寫入 `services`，
成功後顯示 Toast 並更新列表。

## 情境包（Context Pack）

- 相關檔案：
  - `app/admin/_components/ServicesTable.tsx`（TASK-034 建立的唯讀骨架，本卡接上「新增」
    「編輯」按鈕的實際行為）
  - `lib/admin/services.ts`（TASK-034 建立的 `listServices()`，本卡新增 `createService()`／
    `updateService()` 與對應驗證純函式）
  - `components/ui/ToastProvider.tsx`（既有成功/錯誤提示，全域佇列）
  - `lib/store-settings.ts` 的欄位驗證純函式寫法（`validateStoreName` 等）可直接參考命名與
    「trim 後檢查長度」的既有模式
  - `ai/artifacts/服務項目管理/mockups/admin-services-variant-a.html`（狀態 2「新增服務項目
    Modal」為本卡對應畫面）
- 既有模式：
  - MUI `Dialog` 直接使用（元件庫 inventory `Modal/Dialog` 已完成，`ConfirmDialog.tsx` 是
    「確認」情境的既有包裝；本卡的新增/編輯表單是「輸入型」Modal，內容較複雜，直接用 MUI
    `Dialog` 組裝欄位即可，不強套 `ConfirmDialog.tsx` 的確認流程 API）。
  - `Result<T>` 錯誤處理模式，寫入失敗顯示通用 Toast，不外洩原始 Postgres 錯誤內容（比照
    `lib/store-settings.ts`／`lib/admin/business-hours.ts` 既有寫法）。
- 假設：
  - 名稱必填（trim 後長度 > 0）；價格為 `>= 0` 的數字（對應資料庫 `check` constraint）；
    時長為 `> 0` 的整數分鐘（對應資料庫 `check` constraint）；描述選填，無長度上限（資料庫
    `description` 欄位無長度限制，需求也未提出上限，本卡不額外新增）。
  - 新增服務項目時 `is_active` 固定為 `true`（資料庫預設值，前端不提供切換，符合 feature-spec
    「新增項目預設為上架狀態」的驗收標準）；`sort_order` 沿用資料庫預設值 `0`，本卡表單不
    提供排序欄位。
  - 名稱不做唯一性檢查（見 feature-spec 非目標），允許重複名稱。
- 未知事項：無。
- 允許變更的檔案：
  - `app/admin/_components/ServicesTable.tsx`
  - `app/admin/_components/ServiceFormDialog.tsx`（新增，新增/編輯共用的 Modal 表單元件）
  - `lib/admin/services.ts`
  - `tests/admin/services.test.ts`（新增，名稱／價格／時長驗證純函式的單元測試）
- 不得觸碰：
  - `ServicesTable.tsx` 裡 TASK-036 負責的下架／重新上架按鈕行為（本卡只需確保操作欄兩組
    按鈕不互相干擾，「下架／重新上架」按鈕本卡維持 TASK-034 的留白狀態）。
  - `supabase/migrations/`（不新增遷移）。

## 需求

- WHEN 設計師點擊「＋ 新增服務項目」 THE SYSTEM SHALL 開啟空白 Modal 表單（名稱／價格／
  時長／描述）。
- WHEN 設計師點擊某服務項目的「編輯」 THE SYSTEM SHALL 開啟 Modal 表單並帶入該項目目前的
  名稱／價格／時長／描述。
- WHEN 設計師在 Modal 表單送出新增或編輯 THE SYSTEM SHALL 驗證名稱非空白、價格 ≥ 0、時長
  > 0，通過後寫入 `services`（新增時 `is_active` 預設 `true`），成功後關閉 Modal、顯示成功
  Toast、更新列表；驗證失敗時阻擋送出並標示錯誤欄位，Modal 保持開啟。
- WHEN 寫入失敗（網路或資料庫錯誤） THE SYSTEM SHALL 顯示通用錯誤 Toast，不外洩原始錯誤
  內容，Modal 保留使用者已填內容不清空。
- WHEN 設計師點擊 Modal 的「取消」 THE SYSTEM SHALL 關閉 Modal，不寫入任何變更。

## 驗收標準

- 設計師可在後台新增服務項目（名稱、價格、時長必填，描述選填），新增後預設為上架狀態，
  立即出現在列表。
- 設計師可編輯既有服務項目的名稱、價格、時長、描述，儲存後列表即時反映。
- 名稱空白、價格為負數、時長為 0 或負數時，對應行內錯誤訊息顯示，無法送出。
- 非管理員（透過既有 RLS，非本卡新增邏輯）無法新增或編輯，沿用既有邊界。

## 實作備註

- 沿用 mockup 變體 A 的 Modal 版面：名稱單獨一列，價格／時長並排，描述獨立一列
  （`textarea`），底部「取消」「新增／儲存」兩個動作。
- 新增與編輯共用同一個 `ServiceFormDialog` 元件，用 `mode: "create" | "edit"` 與是否傳入
  既有資料區分行為，比照既有元件避免重複程式碼的慣例。

## 驗證契約

- 單元測試：名稱／價格／時長驗證純函式（`vitest`）。
- 整合測試：對真實 Supabase 專案驗證管理員可成功新增/編輯、非管理員（anon／非管理員
  authenticated）寫入被拒；併入 TASK-037 的整合測試檔案。
- E2E 測試：Browser 工具走查新增服務項目全流程（含驗證錯誤與修正）、編輯既有項目全流程；
  併入 TASK-037 或本卡自行走查皆可，實作階段決定。
- 型別檢查：`npx tsc --noEmit`
- Lint：`npm run lint`
- Build：`npm run build`
- 螢幕截圖：新增表單（含驗證錯誤）、編輯表單（含既有值）、儲存中、儲存成功 Toast。
- 安全性檢查：確認寫入路徑沿用既有 `is_admin()` RLS 邊界，前端驗證不是唯一防線；描述欄位
  前台渲染時避免 XSS（沿用既有 React 預設跳脫，不使用 `dangerouslySetInnerHTML`）。

## 完成證據

詳見 `tools/kanban/cards/TASK-035.json` 的 `evidence` 欄位（commands／findings／residual）。
摘要：

- 變更的檔案：`lib/admin/services.ts`（新增 `createService`／`updateService`／三個驗證
  函式）、`app/admin/_components/ServiceFormDialog.tsx`（新增）、
  `app/admin/_components/ServicesTable.tsx`（接上新增/編輯按鈕與 Dialog）、
  `tests/admin/services.test.ts`（新增）。
- 執行過的指令：`npx tsc --noEmit`（乾淨）、`npm run lint`（0 problems，過程中修正一次
  `react-hooks/set-state-in-effect` 違規）、`npm run build`（成功）、`npx vitest run`
  （18 files / 152 tests passed，含新增 15 tests，無回歸）。
- 測試輸出：`validateServiceName`／`validateServicePrice`／`validateServiceDuration`
  純函式測試，`createService`／`updateService` 以 fake client 涵蓋成功/RLS 擋下/資料庫
  錯誤三種情境。
- 螢幕截圖：Browser 工具對真實 Supabase 專案手動走查，編輯既有服務項目（含驗證錯誤與
  成功寫入並還原）、新增表單空白渲染與取消流程皆確認正確。
- 已知限制：「新增服務項目」的實際資料庫寫入未在瀏覽器端送出驗證（後台目前無法清除
  測試建立的服務項目，避免污染正式資料），改由單元測試涵蓋，與已驗證的 `updateService`
  共用同一套邏輯，風險低。
- 後續任務：TASK-037（整合驗證）。
