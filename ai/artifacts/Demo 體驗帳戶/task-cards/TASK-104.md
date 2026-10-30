# AI-Ready 任務卡

## Metadata

- 任務：登入頁體驗入口與說明視窗旗標（前端）
- 上層規格：[`feature-spec.md`](../feature-spec.md)；架構筆記：[`architecture-notes.md`](../architecture-notes.md)
- 上層 Epic：Demo 體驗帳戶
- 上層 User Story：登入頁體驗入口
- 分軌：前端
- 前置任務（dependsOn）：TASK-097
- 狀態：草稿（待人工核准）
- 風險等級：低
- Agent owner：Claude Code
- 人工核准者：待使用者核准

## 目標

在既有登入卡片下方加上「面試官／訪客？」區塊與「進入體驗帳號」按鈕（變體 A 一鍵進入版），呼叫一鍵進入端點，成功後導向後台並設定說明視窗旗標。

## 情境包（Context Pack）

- 相關檔案：
  - `app/login/page.tsx`
  - `app/login/login-form.tsx`
  - `ai/artifacts/Demo 體驗帳戶/mockups/demo-login-entry-final.html`
  - `ai/artifacts/Demo 體驗帳戶/screen-spec-登入頁體驗入口.md`
  - `tests/components/login-form.test.tsx`
- 既有模式：既有元件：Divider／Button（`loading`）／Alert；既有 `mode` 狀態機（login／forgot-password／mfa）。
- 假設：
  - 端點契約（TASK-103）：成功 `{ ok: true }` ＋ cookie，失敗 `{ ok: false }`；本卡以 mock 的 `fetch` 開發與測試，**真正串接在 TASK-112**，所以不必等 TASK-103 完成。
  - `sessionStorage` 旗標鍵：`demo-welcome-pending`、`demo-banner-dismissed`（見架構筆記 D6）。
- 未知事項：
  - 無。
- 允許變更的檔案：
  - `app/login/page.tsx`（新增 `demoEnabled` prop）
  - `app/login/login-form.tsx`（只新增體驗入口區塊與處理函式）
  - `tests/components/login-form.test.tsx`（新增 Demo 案例，不改既有斷言）
- 不得觸碰：
  - `handleSubmit`、MFA 流程、忘記密碼流程的既有邏輯
  - `lib/supabase/*`

## 需求

- `demoEnabled` 為假時，不渲染入口，登入頁與現況逐字一致。
- 僅在 `mode === "login"` 顯示入口。
- 按鈕文字「進入體驗帳號」；說明文字「一鍵進入體驗帳號，不需要輸入密碼，後台功能全開。」。
- 按下：按鈕顯示載入與「正在進入體驗帳號…」，Email、密碼、登入、忘記密碼同時停用，防重複點擊。
- 成功：設定 `demo-welcome-pending = "1"`、移除 `demo-banner-dismissed`（兩者包 `try/catch`），然後導向 `/admin` 並 `router.refresh()`。
- 失敗（含網路錯誤）：入口區塊內顯示 error Alert「目前無法進入體驗帳號，請稍後再試。」（`role="alert"`），按鈕文字變「重新嘗試進入體驗帳號」且可再按。

## 驗收標準

- `demoEnabled` 假／真各有元件測試；入口只在 login 模式出現。
- 載入中、成功、失敗、網路錯誤四種狀態有測試；成功時兩個旗標被正確設定。
- 既有登入、MFA、忘記密碼測試全數通過，未改既有斷言。
- 手機（375）無橫向捲動，按鈕高度 ≥ 40px；亮色與暗色皆可讀。

## 實作備註

- `sessionStorage` 不可用時（例如隱私模式）不得讓入口壞掉。
- 不要在前端出現任何 Demo 的 Email 或密碼字串。

## 驗證契約

- 單元測試：`tests/components/login-form.test.tsx`（Demo 案例）。
- 整合測試：不適用。
- E2E 測試：不適用（串接於 TASK-112）。
- 型別檢查：`npx tsc --noEmit` 無錯誤
- Lint：`npm run lint` 無錯誤
- Build：`npm run build` 成功
- 螢幕截圖：最終狀態 mockup 的 F1、F2、F3、F4 各一張（桌面與手機，亮色；暗色至少一張）。
- 安全性檢查：前端程式碼與 bundle 中沒有 Demo 帳密；`fetch` 不帶任何憑證參數。

## 審查關卡

UI（畫面與 mockup 一致）、驗證（測試工程）。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：
- 已知限制：
- 後續任務：
