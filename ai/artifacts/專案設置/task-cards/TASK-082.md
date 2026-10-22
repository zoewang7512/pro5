# AI-Ready 任務卡

## Metadata

- 任務：UI 設計系統 後台「未儲存變更」離開提示：商店基本資料、帳號設定、營業時間
- 上層規格：[`feature-spec-未儲存變更離開提示.md`](../feature-spec-未儲存變更離開提示.md)（人工已核准 2026-10-22）
- 畫面規格／mockup：[`screen-spec-未儲存變更離開提示.md`](../screen-spec-未儲存變更離開提示.md)、[`mockup-decision-未儲存變更離開提示.md`](../mockup-decision-未儲存變更離開提示.md)（變體 B）
- 上層 Epic：專案設置
- 上層 User Story：UI 設計系統
- 分軌：前端
- 前置任務（dependsOn）：TASK-081（共用機制：`useUnsavedChangesGuard`、Provider、提示對話框、Sidebar／登出接線）
- 狀態：**計畫待人工核准**；前置 TASK-081 完成後才可就緒
- 風險等級：中（前端互動；套用既有機制，不碰資料與權限）
- Agent owner：Claude Code
- 人工核准者：使用者
- 分支：`feat/task-081-unsaved-changes-guard`（與 TASK-081／083 同一分支，依序實作）

## 目標

把 TASK-081 的共用機制套用到三個有「儲存」按鈕的後台表單：商店基本資料、帳號設定（顯示名稱與登入 Email 兩個區塊）、營業時間。

## 情境包（Context Pack）

- 相關檔案：
  - `app/admin/_components/StoreSettingsForm.tsx`（`BasicInfoCard` 已有 `hasChanges`＝`fields` 與 `savedFields` 比對四個欄位；Logo／封面圖是即時上傳，**不在範圍**）
  - `app/admin/_components/AccountSettingsView.tsx`（顯示名稱 `hasNameChanges = nameInput !== (displayName ?? "")`；登入 Email `hasEmailChanges`；儲存後呼叫 context 的 `refresh()`，基準值隨之更新）
  - `app/admin/_components/BusinessHoursForm.tsx`（**沒有** dirty 判定；`LoadState.loaded` 只有目前的 `rows`，儲存成功後 `loadRows()` 重新載入）
  - `lib/admin/business-hours.ts`（`BusinessHoursInput`、`validateBusinessHoursRow`，純函式放這裡）
- 既有模式：同 TASK-081（外部 store、固定 key、沒有 Provider 時 no-op）。
- 假設：
  - 規格 A1：帳號設定的**密碼區塊不納入**（自動填入會誤報、內容易重打）。
  - 規格 A4：營業時間需新增 dirty 判定，與載入時的每週設定比對。
  - `ClosedDatesSection`（公休日新增）是動作型即時儲存，不納入。
- 未知事項：無。
- 允許變更的檔案：
  - `app/admin/_components/StoreSettingsForm.tsx`、`AccountSettingsView.tsx`、`BusinessHoursForm.tsx`
  - `lib/admin/business-hours.ts`（新增純函式 `hasBusinessHoursChanges(rows, savedRows)`）
  - 測試：`tests/lib/business-hours.test.ts`（擴充）、`tests/components/account-settings-view.test.tsx`（擴充）、
    `tests/components/store-settings-form.test.tsx`（新增）、`tests/components/business-hours-form.test.tsx`（新增）
- 不得觸碰：各表單的儲存邏輯、驗證規則、資料層；圖片上傳控制項；密碼區塊；`ClosedDatesSection`；TASK-081 建立的共用機制本身（發現缺口時停下來回報，不自行改）。

## 需求

- 商店基本資料：WHEN 店名／地址／電話／簡介任一欄位與已儲存值不同 THE SYSTEM SHALL 以 key `store-basic-info` 回報有變更；改回原值或儲存成功後回報乾淨。
- 帳號設定：WHEN 顯示名稱與目前顯示名稱不同 THE SYSTEM SHALL 以 key `account-name` 回報有變更；WHEN 登入 Email 與目前 Email 不同（不分大小寫、去前後空白，沿用 `hasEmailChanges`）THE SYSTEM SHALL 以 key `account-email` 回報有變更。兩個 key 任一有變更即視為有未儲存變更。
- 密碼區塊（目前密碼／新密碼／確認密碼）THE SYSTEM SHALL NOT 計入變更。
- 營業時間：WHEN 七個星期的任一列（`is_closed`、`open_time`、`close_time`）與載入時或最近一次儲存成功的值不同 THE SYSTEM SHALL 以 key `business-hours` 回報有變更；「儲存變更」成功重新載入後回報乾淨；載入中或載入失敗時回報乾淨。
- 三個表單被攔截離開時的提示、焦點、繼續編輯／放棄變更行為，完全沿用 TASK-081 的共用機制，不得各自另做。

## 驗收標準

- 三個表單各自：改了→點側邊欄／登出 → 出現提示；繼續編輯後輸入不變；放棄變更後完成離開。
- 沒改、改回原值、儲存成功後 → 不提示。
- 帳號設定：只改顯示名稱、只改 Email、兩者皆改都提示；只在密碼欄位輸入**不**提示。
- 營業時間：切換公休、改開店或打烊時間 → 提示；改回原值 → 不提示；儲存成功 → 不提示；營業時間載入中或失敗 → 不提示。
- 商店資料：上傳 Logo／封面圖（即時儲存）不會讓表單被視為有變更。
- 既有測試全數通過；沒有 Provider 時行為不變。

## 實作備註

- `BusinessHoursForm`：在 `LoadState.loaded` 增加 `savedRows`（載入與儲存後重新載入時一起設定），`hasBusinessHoursChanges(rows, savedRows)` 逐星期比對三個欄位；注意 `rows` 是 `Map<number, BusinessHoursInput>`。
- `AccountSettingsView`：兩個區塊在各自元件內呼叫 `useUnsavedChangesGuard`（`AccountNameCard`／`AccountEmailCard` 或對應子元件），不要在外層用單一 key 合併，避免其中一個儲存後另一個的狀態被蓋掉。
- 三個表單目前都沒有直接的 `useUnsavedChangesGuard`，只需在計算出布林值後加一行呼叫；不重構既有結構。

## 驗證契約

- 單元測試：
  - `hasBusinessHoursChanges`（相同、改公休、改時間、七列任一不同、空字串與 null 的等價處理）。
  - 各表單：改欄位→dirty、改回原值→乾淨、儲存成功→乾淨（以包 Provider 的測試輔助驗證 store 的 key）。
  - 帳號設定：密碼欄位輸入不影響兩個 key。
- 整合測試：不涉及資料層，不重跑；既有套件不受影響。
- E2E 測試：Browser 走查三個表單各一次（改→點側邊欄→繼續編輯／放棄變更；改回原值；儲存後）；帳號設定另測「只改密碼欄位不提示」。
- 型別檢查／Lint／Build：`npx tsc --noEmit`、`npm run lint`、`npm run build`。
- 螢幕截圖：三個表單各一張有提示的畫面。
- 安全性檢查：同 TASK-081；特別確認**不記錄、不保存密碼欄位內容**（密碼區塊完全不接 guard）。
- 注意：Browser 走查會改動正式庫的店家資料、營業時間，**必須在儲存前離開或改回原值**，不得真的儲存；若需驗證「儲存成功後不提示」，只儲存與原值相同的內容，並事前記錄原值、事後確認未變。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：
- 已知限制：瀏覽器上一頁／下一頁不攔截；密碼區塊不計入變更。
- 後續任務：TASK-083
