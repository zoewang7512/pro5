# AI-Ready 任務卡

## Metadata

- 任務：Demo 體驗帳戶 端到端串接、暗啟動、首次正式環境 seed 與驗收
- 上層規格：[`feature-spec.md`](../feature-spec.md)；架構筆記：[`architecture-notes.md`](../architecture-notes.md)
- 上層 Epic：Demo 體驗帳戶
- 上層 User Story：文件與入口公開
- 分軌：前後端串接
- 前置任務（dependsOn）：TASK-097, TASK-098, TASK-099, TASK-100, TASK-101, TASK-102, TASK-103, TASK-104, TASK-105, TASK-106, TASK-107, TASK-108, TASK-109, TASK-110, TASK-111, TASK-113
- 狀態：草稿（待人工核准）
- 風險等級：高
- Agent owner：Claude Code
- 人工核准者：待使用者核准

## 目標

逐條對照規格書驗收標準走一遍，依「暗啟動」順序在正式環境執行首次 seed 與真實還原（先備份、經使用者明確同意），確認 `designer001` 完全不受影響，然後交由人工驗收。

## 情境包（Context Pack）

- 相關檔案：
  - `ai/artifacts/Demo 體驗帳戶/` 全部文件
  - `ai/artifacts/多位設計師/task-cards/TASK-077.md`（整合驗證卡範例）
  - `docs/demo-account.md`
- 既有模式：驗證報告以 `ai/templates/verification-report.md` 為範本，存到 `verification/TASK-112.md`。
- 假設：
  - **正式環境動作須使用者在場並逐步同意。**
  - **暗啟動：** `vercel.json` 只有 master 會部署、Cron 只在 production 執行，所以不是「先部署驗證再合併」。順序：套用 migration → **合併到 master，`DEMO_ENABLED` 與 `DEMO_RESET_ENABLED` 皆關閉** → 正式部署 → 建立 Demo 帳戶、匯入圖片 → dry-run → 備份 → **使用者同意後手動真實還原一次** → 驗證 → 開 `DEMO_ENABLED` 並 Redeploy → 最後才開 `DEMO_RESET_ENABLED` 並 Redeploy。環境變數改動需 Redeploy 才生效。
  - 合併到 master 的前提：所有高風險卡已核准；`DEMO_ENABLED=false` 時登入頁與現況逐字一致（測試證明）。
- 未知事項：
  - Vercel 部署與環境變數設定的實際時機（使用者操作）。
- 允許變更的檔案：
  - `ai/artifacts/Demo 體驗帳戶/verification/TASK-112.md`（新增）
  - `README.md`（補登入頁截圖，若使用者要）
  - 驗證過程發現的小型修正（只限本 Epic 的檔案，修正前先回報）
- 不得觸碰：
  - 本 Epic 範圍外的功能
  - `designer001` 的任何憑證與個人資料

## 需求

- 逐條對照 feature-spec「驗收標準」並附證據（測試名稱、指令輸出或截圖）。
- 執行並貼出所有相關測試套件：`test`、`test:rls`、`test:booking`、`test:admin-booking`、`test:business-hours`、`test:store-settings`、`test:booking-policy`、`test:services`、`test:designers`、`test:account`、`test:mfa-rls`、`test:notifications`、`test:audit-log`、`test:reports`，以及本 Epic 新增的 `test:demo-lock`、`test:demo-rate-limit`、`test:demo-enter`、`test:demo-seed-bucket`、`test:demo-reset`，加上 `tsc`、`lint`、`build`。**真實還原後必須把既有整合套件再跑一次**（它們對同一個正式庫執行，可能依賴現有資料，例如「預設設計師」以 `created_at` 排序辨識）；若有測試依賴還原前的資料，另開卡修正測試，不改 seed。
- 本機以瀏覽器走完整流程：登入頁按「進入體驗帳號」→ 說明視窗 → 橫幅 → 後台主要操作 → 帳號設定頁三項鎖定 → Demo 登出不影響其他 session → 前台用自己的 Email 預約並確認收到確認信。
- **真實還原前的備份：** 先確認 Supabase 方案有沒有 PITR 或可下載備份；並做一次完整 data-only 匯出（含 `appointments`、`customers`、`audit_log`、`admins`），寫出還原步驟，經使用者確認後才執行。
- 還原後驗證：各表筆數等於 seed；`designer001` 的 `auth.users` 雜湊與 `updated_at`、`admins` 列、頭像物件、`audit_log` 其他列與還原前一致；`designer001` 仍可登入（含既有 MFA 狀態）；沒有寄出任何信。
- 人工驗證手動還原成功後，才由使用者決定是否把 `DEMO_ENABLED` 與 `DEMO_RESET_ENABLED` 依序設為 true（各需 Redeploy）；確認排程第一次觸發的結果。
- 回報殘留風險（架構筆記第 8 節）目前實況，以及使用者對各項決定的最終結論。

## 驗收標準

- feature-spec 每條驗收標準皆有證據。
- 所有測試套件通過（含還原後的回歸）；`designer001` 不受影響的證據齊全。
- 從登入頁一鍵進入到完整體驗流程無錯誤，亮暗與手機皆走查。
- 正式環境真實還原只執行一次且經使用者同意、已備份，結果符合預期。
- `DEMO_ENABLED=false` 時登入頁與現況逐字一致。
- 使用者人工驗收通過。

## 實作備註

- 任何一步失敗就停止並回報，不自行重試對正式庫的寫入動作。
- 不可把子代理審查意見當成人工核准。

## 驗證契約

- 單元測試：全套 `npm run test`。
- 整合測試：上列各 `test:*`（含真實還原後的回歸重跑）。
- E2E 測試：瀏覽器完整走查（含正式站）。
- 型別檢查：`npx tsc --noEmit` 無錯誤
- Lint：`npm run lint` 無錯誤
- Build：`npm run build` 成功
- 螢幕截圖：登入頁、說明視窗、橫幅、帳號設定頁鎖定狀態（亮／暗／手機）。
- 安全性檢查：公開端點濫用、`designer001` 不受影響、密碼不外洩、`is_admin()` 寫入面盤點（報告第 8 節風險 1 的實測）。

## 審查關卡

架構、安全性、驗證（測試工程）；高風險，動工前須人工核准。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：
- 已知限制：
- 後續任務：
