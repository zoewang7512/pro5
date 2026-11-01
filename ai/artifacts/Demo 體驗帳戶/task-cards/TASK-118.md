# AI-Ready 任務卡

## Metadata

- 任務：帳號設定頁 Demo 鎖定操作的統一提示文案（前端）
- 上層規格：[`feature-spec.md`](../feature-spec.md)；畫面規格：[`screen-spec-帳號設定頁鎖定狀態.md`](../screen-spec-帳號設定頁鎖定狀態.md)（「錯誤」與「嘗試操作被鎖項目」兩列）；架構筆記：[`architecture-notes.md`](../architecture-notes.md)
- 上層 Epic：Demo 體驗帳戶
- 上層 User Story：鎖定帳號安全三項
- 分軌：前端
- 前置任務（dependsOn）：TASK-097、TASK-101
- 狀態：完成（人工驗收通過，2026-11-01；證據見 [`verification/TASK-118.md`](../verification/TASK-118.md)）
- 風險等級：低
- Agent owner：Claude Code
- 人工核准者：使用者（2026-11-01，下令動工）

## 目標

補上 TASK-101 驗收時發現的缺口：畫面規格要求「Demo 帳號嘗試被鎖的操作時，統一顯示『體驗帳號不開放這項操作』」，但 TASK-101 的需求沒有包含、也沒有其他卡負責。本卡讓 Demo 在帳號設定頁觸發被鎖操作時看到這句提示，而不是靜默無反應。

## 為什麼不是「辨識資料庫錯誤再轉成文案」

TASK-098 實驗 (f) 已證明：觸發器的例外回到客戶端是 HTTP 500，supabase-js 把它呈現成 `status = 500`、`code` 未定義、`message = {}`；MFA 路徑只有通用的 `unexpected_failure`。**前端無法可靠辨識「被鎖」，也不該依賴錯誤文字或錯誤碼**（見 `verification/TASK-098.md` (f) 與其下的第 2 點）。因此本卡不做錯誤對應，改由 `isDemo` 判斷：Demo 在這三個入口被觸發時，一律顯示固定提示，不呼叫任何更新函式（真正的鎖仍是 TASK-100）。

## 情境包（Context Pack）

- 相關檔案：
  - `app/admin/_components/AccountSettingsView.tsx`（TASK-101 加的三個 `if (isDemo) return`：`handleUpdatePassword`、`handleUpdateEmail`、`handleStartMfaEnrollment`）
  - `lib/demo/notice-copy.ts`（文案單一來源，TASK-097）
  - `components/ui/ToastProvider`（`showToast(message, "error")`）
  - `tests/components/account-settings-view.test.tsx`
  - `ai/artifacts/Demo 體驗帳戶/screen-spec-帳號設定頁鎖定狀態.md`
  - `ai/artifacts/Demo 體驗帳戶/verification/TASK-098.md`（(f) 客戶端看到的錯誤）
- 既有模式：既有 handler 以 `showToast(..., "error")` 顯示通用失敗；說明文案放 `lib/demo/notice-copy.ts`。
- 假設：
  - 這條路徑只在使用者用開發者工具移除 `disabled` 後才能走到（正常情況按鈕是停用的），屬於低頻的防禦性提示。
  - 在 console 直接呼叫 Supabase 的請求不經過畫面，沒有畫面可以顯示文案，不在本卡範圍。
- 未知事項：
  - 無。
- 允許變更的檔案：
  - `app/admin/_components/AccountSettingsView.tsx`（只把三個靜默 `return` 改成顯示提示後 `return`；其餘不動）
  - `lib/demo/notice-copy.ts`（追加一個常數，不改既有常數）
  - `tests/components/account-settings-view.test.tsx`（補案例與調整 TASK-101 新增的那一項，見需求；**不改 TASK-101 之前既有的斷言**）
  - `ai/artifacts/Demo 體驗帳戶/screen-spec-帳號設定頁鎖定狀態.md`（把「錯誤」列的描述改成與實作一致：由 `isDemo` 提示、不顯示資料庫原始錯誤、前端不辨識資料庫錯誤）
- 不得觸碰：
  - `lib/admin/account.ts`
  - 個人資料卡片的行為
  - 非 Demo 的任何流程

## 需求

- 新增常數 `DEMO_ACTION_BLOCKED_MESSAGE = "體驗帳號不開放這項操作。"` 於 `lib/demo/notice-copy.ts`。
- `isDemo` 為真且 `handleUpdatePassword`、`handleUpdateEmail`、`handleStartMfaEnrollment` 被觸發時：呼叫 `showToast(DEMO_ACTION_BLOCKED_MESSAGE, "error")`，不呼叫 `updateAdminPassword`／`updateAdminEmail`／`enrollMfa`，也不設定任何表單驗證錯誤狀態。
- `isDemo` 為假時行為與現況逐字一致。
- 不得顯示資料庫或 Supabase 的原始錯誤文字。

## 驗收標準

- Demo：對密碼表單與 Email 表單直接 `submit`、對 MFA 呼叫啟用入口，各自出現「體驗帳號不開放這項操作。」提示，且三個更新函式皆未被呼叫。
- TASK-101 新增的「鎖定的表單即使被直接送出也不會呼叫更新函式」案例仍然成立（可擴充為同時斷言提示出現）。
- 一般管理員：既有測試全數通過，不會出現該提示。
- `screen-spec-帳號設定頁鎖定狀態.md` 的「錯誤」列與實作一致。

## 實作備註

- 提示每次觸發都會顯示，不做節流；入口本身就只有開發者工具才能觸發，不需要額外處理。
- MFA 的啟用入口在 UI 上是停用的按鈕；直接以測試呼叫 handler 不容易，測試可改為「移除 disabled 屬性後點擊」來覆蓋。

## 驗證契約

- 單元測試：`tests/components/account-settings-view.test.tsx`（Demo 三個入口各出現提示、更新函式未呼叫；非 Demo 不出現）。
- 整合測試：不適用。
- E2E 測試：不適用（串接於 TASK-112）。
- 型別檢查：`npx tsc --noEmit` 無錯誤
- Lint：`npm run lint` 無錯誤
- Build：`npm run build` 成功
- 螢幕截圖：不適用（只多一個既有 Toast 元件顯示的文字；報告以測試輸出為證）。
- 安全性檢查：確認不顯示任何資料庫錯誤原文；報告註明提示只是 UX，不是安全邊界（真正的鎖在 TASK-100）。

## 審查關卡

驗證（測試工程）。純文案與單一元件內的流程調整，無新畫面，不需另出 mockup。

## 完成證據

- 變更的檔案、執行過的指令、測試輸出、已知限制、後續任務：見 [`verification/TASK-118.md`](../verification/TASK-118.md)
- 螢幕截圖：不適用（依驗證契約）
