# AI-Ready 任務卡

## Metadata

- 任務：文件、營運指令（demo:disable／enable）與公開入口：README、決策紀錄、營運手冊
- 上層規格：[`feature-spec.md`](../feature-spec.md)；架構筆記：[`architecture-notes.md`](../architecture-notes.md)
- 上層 Epic：Demo 體驗帳戶
- 上層 User Story：濫用防護與緊急開關
- 分軌：不適用
- 前置任務（dependsOn）：TASK-097, TASK-100, TASK-104, TASK-105, TASK-110
- 狀態：草稿（待人工核准）
- 風險等級：中
- Agent owner：Claude Code
- 人工核准者：待使用者核准

## 目標

把 Demo 體驗帳戶的使用方式、限制、營運與緊急關閉步驟與所有決策記錄下來，並提供「緊急關閉／恢復」的指令，讓面試官知道怎麼進來，也讓使用者日後能獨立維護、出狀況時能立即止血。

## 情境包（Context Pack）

- 相關檔案：
  - `README.md`（「線上體驗」段落）
  - `ai/context/decisions.md`
  - `ai/context/project-map.md`
  - `ai/artifacts/顧客預約流程/task-cards/TASK-080.md`
  - `ai/artifacts/Demo 體驗帳戶/architecture-notes.md`
- 既有模式：`decisions.md` 既有條目格式（日期、決策、理由、影響與殘留）。
- 假設：
  - README 不得出現 Demo 帳號的 Email 或密碼。
- 未知事項：
  - 無。
- 允許變更的檔案：
  - `scripts/disable-demo.mjs`（新增：`--disable`／`--enable`）、`package.json`（新增 `demo:disable`、`demo:enable`）
  - `README.md`（「線上體驗」加入體驗帳號說明與限制）
  - `ai/context/decisions.md`（新增本 Epic 決策條目）
  - `ai/context/project-map.md`（新增資料表、RPC、端點、腳本與環境變數）
  - `ai/artifacts/顧客預約流程/task-cards/TASK-080.md`（更新「Demo 環境關閉寄信」註記為「已改為開啟」或依使用者對寄信風險的決定）
  - `docs/demo-account.md`（新增營運手冊）
  - `.env.example`（核對五個變數說明與實作一致，不改變數名稱）
- 不得觸碰：
  - 應用程式碼與 migration（營運指令腳本除外）

## 需求

- `demo:disable`：刪除 Demo 的 `admins` 列（`is_admin()` 每次請求重新判斷，立即全面失效）→ 呼叫 `demo_revoke_sessions()` 撤銷 session → 以 admin API 設定 `ban_duration`（`banned_until` 不在鎖定欄位內）；`demo:enable` 反向。需 `--yes`，預設只印出將做的事。
- README：說明「登入頁按『進入體驗帳號』即可體驗後台」、哪三項不開放、資料還原時間、所有面試官共用同一份資料、請勿輸入真實個資。README 不得出現 Demo 帳號 Email 或密碼。
- `decisions.md`：同庫全功能 Demo、一鍵進入（推翻早先的只填入）、鎖三層與觸發器欄位清單與寫法限制、還原範圍與順序、`designer001` 不動清單、寄信決定、暗啟動順序、殘留風險（含顧客資料互相可見、配額、前台竄改）。
- `docs/demo-account.md`：建立帳戶、匯入圖片、dry-run 與真實還原、**備份**、啟用／關閉入口（改 `DEMO_ENABLED` 並 **Redeploy**）、啟用／關閉排程（`DEMO_RESET_ENABLED` 並 Redeploy）、緊急關閉（`demo:disable`）、Demo 帳戶被改壞時的修復 SQL（SQL Editor 的 `postgres` 角色）、輪換 Demo 密碼（只能走 SQL Editor，admin API 也被觸發器擋）。
- 手冊另須寫明：(1) 更新展示內容的流程是 `demo:export-base` → `demo:upload-images --overwrite` → commit → 部署，**整理展示內容前先關閉 `DEMO_RESET_ENABLED`**，否則在後台新上傳的圖會在當晚被當成孤兒永久刪除；(2) Auth 平台升級後若登入全面回 500，第一步先套用觸發器的 `_down.sql`；(3) 正式環境若沒設 `DESIGNER_EMAIL`，`getDemoConfig` 的 Email 比對無作用，`is_demo` 檢查才是主要防線；(4) `DEMO_EMAIL` 是公開的，必須是作者控制的信箱。
- `project-map.md` 與實作一致。
- `docs/demo-account.md` 加入：寄信行為（Demo 發動的改期／取消不寄信、預約確認信照寄）、各表筆數上限與數字、備份流程與還原 `restore.sql` 的步驟、備份檔何時可刪。

## 驗收標準

- `demo:disable` 對拋棄式 Demo 帳號實測：`admins` 列被刪、session 被撤銷、無法再登入；`demo:enable` 後恢復。
- README 與手冊中沒有任何帳密、金鑰、真實 Email。
- 手冊的每個指令與 SQL 都曾在實作期間實跑或有對應測試證據。
- `decisions.md` 條目包含日期與影響。
- `TASK-080` 註記已更新且不改變該卡其餘內容。

## 實作備註

- README 截圖（若要放登入頁入口）須在 TASK-112 完成後補。
- `TASK-080` 的註記要寫成：確認信開啟；Demo 發動的改期／取消不寄信（TASK-114）。

## 驗證契約

- 單元測試：不適用。
- 整合測試：`demo:disable`／`enable` 對拋棄式帳號實跑輸出。
- E2E 測試：不適用。
- 型別檢查：`npx tsc --noEmit` 無錯誤
- Lint：`npm run lint` 無錯誤
- Build：`npm run build` 成功
- 螢幕截圖：不適用（若更新 README 截圖，附於 TASK-112）。
- 安全性檢查：指令需 `--yes`；文件中無任何密鑰與帳密；`demo:disable` 對非 Demo 帳號拒絕執行。

## 審查關卡

一般程式碼審查即可。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：
- 已知限制：
- 後續任務：
