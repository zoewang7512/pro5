# AI-Ready 任務卡

## Metadata

- 任務：還原排程端點、vercel.json 與手動還原指令（預設關閉）
- 上層規格：[`feature-spec.md`](../feature-spec.md)；架構筆記：[`architecture-notes.md`](../architecture-notes.md)
- 上層 Epic：Demo 體驗帳戶
- 上層 User Story：整庫還原
- 分軌：後端
- 前置任務（dependsOn）：TASK-097, TASK-109
- 狀態：草稿（待人工核准）
- 風險等級：高
- Agent owner：Claude Code
- 人工核准者：待使用者核准

## 目標

提供受密鑰保護的還原端點與每日排程，以及手動觸發的指令；**排程旗標 `DEMO_RESET_ENABLED` 預設關閉**，但手動真實還原不受該旗標約束（需密鑰與明確的 `confirm` 參數），讓首次真實還原可以先由人工驗證，驗證成功後才開排程。

## 情境包（Context Pack）

- 相關檔案：
  - `app/api/cron/appointment-reminders/route.ts`（驗證、`maxDuration`、失敗回 500 的模式）
  - `lib/webhooks/verify-secret.ts`（`verifyBearerSecret`）
  - `vercel.json`
  - `tests/api/appointment-reminders-cron.test.ts`
- 既有模式：Vercel Cron 以 GET 呼叫並帶 `Authorization: Bearer <CRON_SECRET>`；失敗回 500 讓監控可見。
- 假設：
  - Vercel Hobby 可新增第二個每日排程；**待實作前對照 Vercel 目前文件核對**，若不允許，改為與提醒信排程合併或僅手動。
  - 排程時間 `0 19 * * *`（UTC，台北 03:00）；Hobby 只保證在該小時內觸發，畫面文案已定為「每日凌晨 3 點左右還原」。
- 未知事項：
  - Hobby 方案的排程數量與頻率限制是否仍如預期。
- 允許變更的檔案：
  - `app/api/cron/demo-reset/route.ts`（新增）
  - `vercel.json`（新增第二個 cron）
  - `scripts/reset-demo.mjs`（新增：呼叫上述端點的手動指令）
  - `package.json`（新增 `demo:reset`）
  - `tests/api/demo-reset-cron.test.ts`（新增）、`tests/lib/demo-config.test.ts`（啟用 TASK-097 預留的 cron 一致性斷言）
- 不得觸碰：
  - 既有的 `appointment-reminders` 排程與端點
  - `lib/demo/reset.ts` 的流程（TASK-109）

## 需求

- `GET /api/cron/demo-reset`：先 `verifyBearerSecret`，失敗回 401 且不執行任何邏輯。
- 三種行為：(1) 帶 `?dry_run=1`：只執行 dry-run 並回傳各表筆數；(2) 帶 `?confirm=RESET_DEMO`：**真實還原，不受 `DEMO_RESET_ENABLED` 約束**；(3) 兩者都沒有（排程呼叫）：`DEMO_RESET_ENABLED !== "true"` 時回 `{ ok: true, skipped: true }`，不呼叫任何還原邏輯，為 `"true"` 時真實還原。同時帶 `dry_run` 與 `confirm` 時以 dry-run 為準。
- 失敗回 500 `{ ok: false, error: "reset_failed" }`，伺服器 log 記錄階段與筆數，不記錄密鑰。
- `maxDuration = 60`、時間預算沿用提醒信排程做法；中止點只能在還原的步驟 1 與步驟 3。
- `scripts/reset-demo.mjs`：預設只做 dry-run 並印出各表筆數；真實還原必須帶 `--yes`（送出 `confirm=RESET_DEMO`）；目標網址必須明確給定並在執行前印出確認，密鑰讀自環境變數、不印出。
- `vercel.json` 新增 `{ path: "/api/cron/demo-reset", schedule: "0 19 * * *" }`。
- **cron 一致性測試只放在本卡**：比對 `vercel.json` 的 Demo cron 表達式與 `DEMO_RESET_LABEL`（`0 19 * * *` UTC 即台北 03:00）。

## 驗收標準

- 無密鑰、錯誤密鑰回 401，且還原邏輯零呼叫（spy 驗證）。
- 排程呼叫（無參數）且旗標關閉時回 skipped，還原邏輯零呼叫；旗標開啟時才真實還原。
- `?dry_run=1` 只呼叫 dry-run，不寫入任何東西；`?confirm=RESET_DEMO` 在旗標關閉時仍可真實還原（以 spy 驗證）。
- `npm run demo:reset`（不帶 `--yes`）只印 dry-run 摘要；帶 `--yes` 才送出 `confirm`；兩種都會先印出目標網址。
- `vercel.json` 內有 Demo cron，與 `DEMO_RESET_LABEL` 一致測試通過；既有提醒信排程不變。
- Hobby 排程限制已核對並記錄結論。

## 實作備註

- **不得在本卡把 `DEMO_RESET_ENABLED` 設為 true。** 啟用屬於 TASK-112 與使用者明確同意之後的營運動作。
- 手動還原指令對正式站執行等同觸發正式環境的端點，操作前要確認目標網址；真實還原前必須已完成備份（TASK-112）。

## 驗證契約

- 單元測試：`tests/api/demo-reset-cron.test.ts`（驗證、開關、dry-run、失敗回 500）。
- 整合測試：對本機開發伺服器執行 `npm run demo:reset`（dry-run）並貼輸出。
- E2E 測試：不適用。
- 型別檢查：`npx tsc --noEmit` 無錯誤
- Lint：`npm run lint` 無錯誤
- Build：`npm run build` 成功
- 螢幕截圖：不適用。
- 安全性檢查：密鑰驗證常數時間（沿用 `verifyBearerSecret`）；預設關閉；`--yes` 防呆；`dry_run` 不可被未驗證者觸發。

## 審查關卡

架構、安全性、驗證（測試工程）；高風險，動工前須人工核准。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：
- 已知限制：
- 後續任務：
