# AI-Ready 任務卡

## Metadata

- 任務：帳號設定頁 Demo 鎖定狀態（前端）
- 上層規格：[`feature-spec.md`](../feature-spec.md)；架構筆記：[`architecture-notes.md`](../architecture-notes.md)
- 上層 Epic：Demo 體驗帳戶
- 上層 User Story：鎖定帳號安全三項
- 分軌：前端
- 前置任務（dependsOn）：TASK-097
- 狀態：草稿（待人工核准）
- 風險等級：低
- Agent owner：Claude Code
- 人工核准者：待使用者核准

## 目標

Demo 登入時，帳號設定頁的密碼、登入 Email、MFA 三張卡片呈現為鎖定（變體 A）；一般管理員完全不變。

## 情境包（Context Pack）

- 相關檔案：
  - `app/admin/_components/AccountSettingsView.tsx`
  - `ai/artifacts/Demo 體驗帳戶/screen-spec-帳號設定頁鎖定狀態.md`
  - `ai/artifacts/Demo 體驗帳戶/mockup-decision-帳號設定頁鎖定狀態.md`
  - `tests/components/account-settings-view.test.tsx`
- 既有模式：既有元件：Card／TextField／Button／Chip／Alert；`useAdminProfile()` 取得 `isDemo`。
- 假設：
  - `isDemo` 由 TASK-097 提供。
  - 畫面停用只是第一層提示；真正的鎖在 TASK-100。
- 未知事項：
  - 無。
- 允許變更的檔案：
  - `app/admin/_components/AccountSettingsView.tsx`
  - `tests/components/account-settings-view.test.tsx`（新增 Demo 案例，不改既有斷言）
  - `ai/artifacts/Demo 體驗帳戶/mockups/demo-account-locked-variants.html`（只修正文案，見實作備註）
- 不得觸碰：
  - `lib/admin/account.ts`
  - 個人資料卡片（顯示名稱、大頭貼）的行為
  - `Sidebar.tsx`

## 需求

- `isDemo` 為真時：密碼、登入 Email、MFA 三張卡片的欄位與按鈕全部停用；標題旁顯示 Chip「🔒 體驗帳號不開放」；卡片說明文字依下方文案。
- MFA 卡片在 Demo 下不呼叫 `listMfaFactors`（避免多餘請求與載入狀態），固定顯示「未啟用」與停用的「啟用雙重驗證」按鈕。
- 個人資料卡片（顯示名稱、大頭貼）在 Demo 下維持可用。
- `isDemo` 為假時，所有行為與現況逐字一致。
- 文案：密碼卡「體驗帳號不開放修改密碼。」、Email 卡「體驗帳號的 Email 固定，不能修改。」、MFA 卡「體驗帳號不能啟用雙重驗證。」。

## 驗收標準

- Demo 狀態：三張卡片所有輸入與送出按鈕皆為 disabled；個人資料卡片可編輯並儲存。
- 一般管理員狀態：既有測試全數通過，未改任何既有斷言。
- 鍵盤可聚焦的元素中，被鎖定的控制項不可操作，且鎖定原因可被讀屏取得（Chip 文字或 `aria-describedby`）。
- 手機（375）單欄、無橫向捲動；亮色與暗色皆可讀。

## 實作備註

- mockup A 原本的卡片說明寫成「體驗帳號的密碼是公開的」，但密碼已改為不對外顯示；**文案以本卡需求為準**，mockup 檔案的對應文字已於規劃階段同步修正（`demo-account-locked-variants.html`）。

## 驗證契約

- 單元測試：`tests/components/account-settings-view.test.tsx`（Demo 與非 Demo 案例）。
- 整合測試：不適用。
- E2E 測試：不適用（串接於 TASK-112）。
- 型別檢查：`npx tsc --noEmit` 無錯誤
- Lint：`npm run lint` 無錯誤
- Build：`npm run build` 成功
- 螢幕截圖：桌面與手機各一張（亮色），暗色至少一張。
- 安全性檢查：確認不依賴前端停用作為安全邊界（報告內註明真正的鎖在 TASK-100）。

## 審查關卡

UI（畫面與 mockup 一致）、驗證（測試工程）。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：
- 已知限制：
- 後續任務：
