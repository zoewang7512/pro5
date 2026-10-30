# AI-Ready 任務卡

## Metadata

- 任務：Demo 寄信說明視窗：改期／取消確認後顯示通知信示意圖（前端）
- 上層規格：[`feature-spec.md`](../feature-spec.md)；架構筆記：[`architecture-notes.md`](../architecture-notes.md)
- 上層 Epic：Demo 體驗帳戶
- 上層 User Story：體驗帳號提示橫幅
- 分軌：前端
- 前置任務（dependsOn）：TASK-097
- 狀態：草稿（待人工核准）
- 風險等級：低
- Agent owner：Claude Code
- 人工核准者：待使用者核准

## 目標

Demo 登入的面試官在後台按下改期或取消的最終確認後，先跳出說明視窗，以圖片示意「顧客會收到的通知信」，並說明正式環境會寄出、體驗帳號不會真的寄出；按下確認後才照常執行。一般管理員完全不變。

## 情境包（Context Pack）

- 相關檔案：
  - `app/admin/_components/AdminDashboard.tsx`（`handleCancel`、`handleReschedule` 約在第 241、260 行）
  - `app/admin/_components/AppointmentDetailDialog.tsx`
  - `components/ui/ConfirmDialog.tsx`（Dialog 焦點慣例）
  - `lib/demo/notice-copy.ts`（TASK-097）
  - `ai/artifacts/Demo 體驗帳戶/architecture-notes.md` D13
  - 實際通知信樣板（寄信端的信件 HTML，作為示意圖依據）
- 既有模式：既有 Dialog 慣例與 `useAdminProfile().isDemo`；說明文案放進 `lib/demo/notice-copy.ts` 單一來源。
- 假設：
  - **畫面規格與 mockup 須先經使用者確認才能動工**（UI 關卡）：`screen-spec-Demo寄信說明視窗.md`、`mockup-decision-Demo寄信說明視窗.md`、`mockups/demo-mail-notice.html`。
  - 視窗內容以圖片為主，使用者要求「顯示圖片示意圖就好」；不放長篇說明。
  - 不寄信由 TASK-114 的資料庫守門保證；前端視窗只是說明，不是安全邊界。
- 未知事項：
  - 視窗出現的時機：改期為按下「確認改期」後、取消為既有取消確認按下之後（建議）；以使用者確認的 mockup 為準。
  - 示意圖檔案的產生方式（由實際信件樣板截圖，存成 `public/demo/` 下的圖檔）。
- 允許變更的檔案：
  - `app/admin/_components/DemoMailNoticeDialog.tsx`（新增）
  - `app/admin/_components/AdminDashboard.tsx`（只在改期與取消送出前，`isDemo` 時先顯示視窗；非 Demo 路徑逐字不變）
  - `lib/demo/notice-copy.ts`（追加本視窗文案，不改既有常數）
  - `public/demo/notification-email-preview.png`（新增；示意圖）
  - `tests/components/demo-mail-notice-dialog.test.tsx`、`tests/components/admin-dashboard.test.tsx`（補 Demo 案例，不改既有斷言）
- 不得觸碰：
  - `lib/admin/appointments.ts`（資料層行為不變）
  - 寄信相關後端與 migration
  - 一般管理員的取消與改期流程

## 需求

- `isDemo` 為真時，改期與取消在使用者按下最終確認後先開啟 `DemoMailNoticeDialog`：標題、示意圖（含 alt 文字描述信件內容）、一句說明「正式環境會寄這封信給顧客，體驗帳號不會真的寄出」、按鈕「我知道了，繼續」與「返回」。
- 按「我知道了，繼續」才呼叫既有的改期或取消；按「返回」或關閉則不執行任何寫入，且回到原本的畫面狀態。
- `isDemo` 為假時，流程與現況逐字一致，不載入圖片。
- 鍵盤與讀屏：Dialog 有標題、焦點移入並可用 Esc 關閉、關閉後焦點回到觸發元件。
- 手機（375）圖片不溢出、無橫向捲動；亮暗色皆可讀。

## 驗收標準

- Demo：改期與取消在確認後都先看到視窗；按繼續才執行；按返回不寫入（以對資料層的呼叫次數驗證）。
- 一般管理員：既有測試全數通過，未改任何既有斷言；不會看到視窗。
- 示意圖有替代文字；視窗可純鍵盤操作。
- 亮色、暗色、手機各一張螢幕截圖。

## 實作備註

- 圖片內容以實際信件樣板為準，不可呈現不存在的功能。
- 視窗不宣稱「已寄出」，只說明正式環境的行為。

## 驗證契約

- 單元測試：`tests/components/demo-mail-notice-dialog.test.tsx` 與 `admin-dashboard` 的 Demo／非 Demo 案例。
- 整合測試：不適用。
- E2E 測試：不適用（串接於 TASK-112）。
- 型別檢查：`npx tsc --noEmit` 無錯誤
- Lint：`npm run lint` 無錯誤
- Build：`npm run build` 成功
- 螢幕截圖：桌面、手機各一張（亮色），暗色至少一張。
- 安全性檢查：確認前端視窗不被當成安全邊界（報告註明真正的守門在 TASK-114）；圖片為靜態資源，不含個資。

## 審查關卡

UI（畫面與 mockup 一致）、驗證（測試工程）。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：
- 已知限制：
- 後續任務：
