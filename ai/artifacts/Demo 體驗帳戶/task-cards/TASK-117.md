# AI-Ready 任務卡

## Metadata

- 任務：還原前備份腳本 backup-demo-tables（含 restore.sql，備份不進 git）
- 上層規格：[`feature-spec.md`](../feature-spec.md)；架構筆記：[`architecture-notes.md`](../architecture-notes.md)
- 上層 Epic：Demo 體驗帳戶
- 上層 User Story：整庫還原
- 分軌：後端
- 前置任務（dependsOn）：TASK-097
- 狀態：人工驗收通過，Done（2026-10-31）
- 風險等級：中
- Agent owner：Claude Code
- 人工核准者：使用者（2026-10-31 指示開始動工）

## 目標

Supabase Free Plan 沒有專案備份。在第一次真實還原（會整表覆寫）之前，提供自建備份：唯讀匯出會被覆寫的資料表與 Storage 圖片到本機，並產生可在 SQL Editor 還原的 `restore.sql`，作為最後手段。

## 情境包（Context Pack）

- 相關檔案：
  - `scripts/seed-booking-data.mjs`、`scripts/seed-designer-account.mjs`（service role 腳本寫法）
  - `.gitignore`
  - `ai/artifacts/Demo 體驗帳戶/architecture-notes.md` D15
  - TASK-108 的覆寫範圍清單
- 既有模式：一次性 `.mjs` 腳本：冪等、不印出密鑰、輸出摘要。
- 假設：
  - Free Plan 沒有專案備份（使用者 2026-10-30 確認）。
  - 備份檔含顧客個資，只放本機 `backups/`，**必須加入 `.gitignore`，絕不進 git**。
  - 本腳本只做 select 與下載，對資料庫與 Storage 零寫入。
- 未知事項：
  - SQL Editor 的 `postgres` 角色能否 `set local session_replication_role = replica` 以暫停寄信觸發器（需實測；若不行，`restore.sql` 要改為先停用再啟用觸發器，並在手冊註明）。
  - 三個公開 bucket 的圖片總量（決定下載耗時）。
- 允許變更的檔案：
  - `scripts/backup-demo-tables.mjs`（新增）
  - `package.json`（新增 `demo:backup`）
  - `.gitignore`（加入 `backups/`）
  - `tests/lib/backup-demo-tables.test.ts`（新增：匯出順序、SQL 產生與跳脫的純函式測試）
  - 實作時補登記：`ai/artifacts/Demo 體驗帳戶/verification/TASK-117.md`、`task-cards/TASK-117.md`（文件）、`tools/kanban/cards/TASK-117.json` 與 `TASK-111.json`（看板留言）
- 不得觸碰：
  - 資料庫與 Storage 的任何寫入
  - 既有腳本

## 需求

- 匯出表：`services`、`designers`、`designer_services`、`designer_leaves`、`designer_portfolio_images`、`business_hours`、`closed_dates`、`booking_policy`、`store_settings`、`appointments`、`customers`、`audit_log`、`admins`。每表輸出 JSON，並輸出各表筆數與檔案雜湊清單。
- 下載 `store-assets`、`designer-assets`、`admin-assets` 三個 bucket 的全部物件，保留相對路徑。
- 產生 `restore.sql`：依外鍵順序、單一交易，含清空再插入；包含警語「只在確認要回到備份時間點時，於 SQL Editor 以 postgres 角色執行」；說明如何暫停寄信觸發器與如何重新上傳圖片。
- 輸出位置 `backups/<時間戳>/`；開始前先檢查 `.gitignore` 已包含 `backups/`，否則中止。
- 輸出摘要不含任何金鑰；目標專案網址在執行前印出確認。

## 驗收標準

- 對正式庫實跑一次：各表筆數與資料庫一致；圖片數量與大小與 Storage 一致。
- 腳本對資料庫與 Storage 零寫入（前後筆數比對）。
- `backups/` 在 `.gitignore` 內；`git status` 看不到備份檔。
- `restore.sql` 的產生有單元測試（順序、跳脫、交易包覆）；並在**拋棄式資料**上實測可還原（不得對正式庫實測）。
- 手冊（TASK-111）寫明：何時可以刪備份。

## 實作備註

- 這是 TASK-112 真實還原的前置條件；備份未完成並經使用者確認前不得執行真實還原。
- `reset_demo_data` 拒絕非 null 的預約 Email，所以不能用它還原備份；備份的還原一律走 `restore.sql`。

## 驗證契約

- 單元測試：`tests/lib/backup-demo-tables.test.ts`。
- 整合測試：對正式庫唯讀實跑一次（經使用者同意）。
- E2E 測試：不適用。
- 型別檢查：`npx tsc --noEmit` 無錯誤
- Lint：`npm run lint` 無錯誤
- Build：`npm run build` 成功
- 螢幕截圖：不適用。
- 安全性檢查：備份檔不進 git、含個資只放本機；不印出金鑰；零寫入。

## 審查關卡

驗證（測試工程）。

## 完成證據

- 變更的檔案：`scripts/backup-demo-tables.mjs`、`package.json`（`demo:backup`）、`.gitignore`（`backups/`）、`tests/lib/backup-demo-tables.test.ts`
- 執行過的指令、測試輸出：見 [`verification/TASK-117.md`](../verification/TASK-117.md)（單元測試 51 項、tsc、lint、build、正式庫唯讀實跑與獨立比對、PGlite 還原實測）
- 螢幕截圖：不適用
- 已知限制：PGlite 無 Supabase 角色權限（`disable trigger user` 需擁有者，TASK-112 前先在 SQL Editor 做無副作用檢查）；備份是快照，真實還原前須重跑；圖片還原為手動
- 後續任務：TASK-111 手冊寫明「何時可刪備份」（已留言）；TASK-112 真實還原前重跑備份並取得使用者確認
