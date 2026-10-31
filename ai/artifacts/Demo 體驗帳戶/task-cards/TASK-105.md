# AI-Ready 任務卡

## Metadata

- 任務：體驗帳號橫幅、說明視窗與 Demo 本地登出（前端）
- 上層規格：[`feature-spec.md`](../feature-spec.md)；架構筆記：[`architecture-notes.md`](../architecture-notes.md)
- 上層 Epic：Demo 體驗帳戶
- 上層 User Story：體驗帳號提示橫幅
- 分軌：前端
- 前置任務（dependsOn）：TASK-097
- 狀態：完成（使用者 2026-10-31 人工驗收通過）
- 風險等級：低
- Agent owner：Claude Code
- 人工核准者：使用者（2026-10-31）

## 目標

僅 Demo 登入時，在後台內容區頂端顯示可關閉的橫幅，並在一鍵進入後彈出說明視窗一次；一般管理員完全看不到。

## 情境包（Context Pack）

- 相關檔案：
  - `app/admin/_components/DemoNotice.tsx`（TASK-097 建立的空殼）
  - `lib/demo/notice-copy.ts`（TASK-097）
  - `ai/artifacts/Demo 體驗帳戶/screen-spec-體驗帳號提示.md`
  - `ai/artifacts/Demo 體驗帳戶/mockups/demo-login-entry-final.html`（F5、F6）
  - `components/ui/ConfirmDialog.tsx`（Dialog 焦點慣例）
- 既有模式：既有元件：Alert（`onClose`）／Dialog／Button；`useAdminProfile()` 取得 `isDemo`。
- 假設：
  - 說明視窗不放副標（使用者 2026-10-30 要求移除）。
  - 橫幅關閉只記在本分頁（`sessionStorage`）；還原時間文案來自 `DEMO_RESET_LABEL`。
- 未知事項：
  - 無。
- 允許變更的檔案：
  - `app/admin/_components/DemoNotice.tsx`
  - `lib/demo/notice-copy.ts`（只調整文字，不改匯出名稱）
  - `app/admin/logout-button.tsx`（`isDemo` 時 `signOut({ scope: "local" })`）
  - `tests/components/demo-notice.test.tsx`（新增）
  - `tests/components/admin-shell.test.tsx`（補登出案例，不改既有斷言）
- 不得觸碰：
  - `AdminShell.tsx`（掛載點已在 TASK-097）
  - `Sidebar.tsx`
  - `layout.tsx`

## 需求

- **Demo 登入時，登出按鈕改用 `signOut({ scope: "local" })`**：預設的 global 登出會撤銷所有面試官共用的 Demo session，任何一位按「登出」都會把其他人踢掉。非 Demo 行為不變。
- `isDemo` 為假：渲染 `null`。
- 橫幅：info Alert，文字「您正在使用體驗帳號。不開放改密碼、改 Email、啟用 MFA；資料每日凌晨 3 點左右還原。」，右側「了解更多」與 ✕；✕ 設 `demo-banner-dismissed`，關閉後同分頁不再顯示。
- 說明視窗：標題「您正在使用體驗帳號」，兩份清單「可以體驗」（預約週曆、改期、取消、標記完成；設計師、作品集、請假與服務設定；營業時間、公休日、儀表板與報表）與「不開放」（修改密碼、登入 Email；啟用／停用雙重驗證（MFA）），按鈕「開始體驗」。
- 掛載時若 `demo-welcome-pending` 存在：開啟視窗並清除旗標。「了解更多」開啟同一份視窗。Esc 與按鈕可關閉，關閉後焦點回到頁面（`aria-labelledby`、焦點陷阱由 MUI Dialog 處理）。
- `sessionStorage` 讀寫全部包 `try/catch`；不可用時每次進後台都顯示橫幅與視窗。
- 錯誤或缺少還原時間時，橫幅降級為不含時間的簡短版。

## 驗收標準

- 非 Demo：完全不渲染橫幅與視窗（元件測試）。
- Demo 且有旗標：視窗開啟且旗標被清除；重新整理不再開啟。
- ✕ 關閉橫幅後，同一分頁導覽到其他頁仍不顯示；新分頁會顯示。
- 視窗可用 Esc、按鈕關閉；開啟時焦點在視窗內，關閉後回到頁面。
- 手機（375）橫幅文字換行不被截斷、✕ 觸控區 ≥ 40px，視窗在小螢幕可捲動；亮色與暗色皆可讀。
- Demo 登入時按登出只呼叫 `scope: "local"`（以 spy 驗證）；非 Demo 仍是預設行為。

## 實作備註

- 文案單一來源 `notice-copy.ts`，登入頁入口的說明文字不在此檔。
- 有人從 console 直接呼叫 global `signOut` 仍會踢掉其他面試官，列為殘留風險（架構筆記第 8 節）。

## 驗證契約

- 單元測試：`tests/components/demo-notice.test.tsx`。
- 整合測試：不適用。
- E2E 測試：不適用（串接於 TASK-112）。
- 型別檢查：`npx tsc --noEmit` 無錯誤
- Lint：`npm run lint` 無錯誤
- Build：`npm run build` 成功
- 螢幕截圖：最終 mockup 的 F5、F6（桌面與手機，亮色；暗色至少一張）。
- 安全性檢查：文案純文字渲染，不使用 `dangerouslySetInnerHTML`。

## 審查關卡

UI（畫面與 mockup 一致）、驗證（測試工程）。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：
- 已知限制：
- 後續任務：
