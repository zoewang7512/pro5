# AI-Ready 任務卡

## Metadata

- 任務：還原編排：lib/demo/reset.ts（圖片差異同步、呼叫 RPC、孤兒清理、帳戶處理、健康檢查）
- 上層規格：[`feature-spec.md`](../feature-spec.md)；架構筆記：[`architecture-notes.md`](../architecture-notes.md)
- 上層 Epic：Demo 體驗帳戶
- 上層 User Story：整庫還原
- 分軌：後端
- 前置任務（dependsOn）：TASK-097, TASK-100, TASK-107, TASK-108
- 狀態：草稿（待人工核准）
- 風險等級：高
- Agent owner：Claude Code
- 人工核准者：待使用者核准

## 目標

實作還原的完整流程與順序：先差異同步圖片、再執行資料庫交易、成功後才清理孤兒、處理 Demo 帳戶的 MFA 與 session、最後檢查；任何階段失敗都不留下壞掉的網站。

## 情境包（Context Pack）

- 相關檔案：
  - `ai/artifacts/Demo 體驗帳戶/architecture-notes.md` D7、D8
  - `lib/demo/seed-data.ts`、`lib/demo/config.ts`
  - `lib/supabase/service-role.ts`
  - `lib/admin/appointment-reminders.ts`（時間預算與釋放模式的參考）
  - `node_modules/@supabase/storage-js`（`copy`、`remove` 的實際行為）
- 既有模式：`server-only`；結果用 `Result<T>` 風格；時間預算（`TIME_BUDGET_MS`）。
- 假設：
  - 流程順序固定：[1 同步圖片] → [2 RPC] → [3 清理孤兒] → [4 帳戶處理] → [5 健康檢查]。步驟 1 只新增與覆寫；步驟 3 只在步驟 2 成功後執行。
  - Storage `copy()` 目前沒有帶 `x-upsert`（初步確認），目的地已存在會失敗，所以**不能**依賴「copy 覆寫」；實作時以實測為準。
- 未知事項：
  - Storage `copy` 的延遲與並行上限（實測；平常差異同步為 0 次 copy，第一次或差異大時一次 5 個）。
  - `auth.admin.mfa` 刪除 factor API 的實際簽名。
- 允許變更的檔案：
  - `lib/demo/reset.ts`（新增，`server-only`）
  - `tests/lib/demo-reset.test.ts`（新增，以假的 client 測各步驟與失敗分支）
- 不得觸碰：
  - TASK-108 的 migration
  - `vercel.json`、cron 端點（TASK-110）
  - `lib/supabase/service-role.ts`

## 需求

- `runDemoReset({ supabase, now, dryRun, deadlineMs })` 回傳 `{ ok, summary }` 或 `{ ok: false, stage, error }`。
- 步驟 1（差異同步）：用 `demo_list_storage_objects` 列出目的 bucket 與 `demo-seed`，只補缺少的檔；內容不同（大小或 eTag）的**先 `remove` 再 `copy`**；有限並行（一次 5 個）。任何來源缺檔直接失敗，**尚未動任何資料**。dry-run 也唯讀檢查來源檔是否齊全。
- 步驟 2：呼叫 `reset_demo_data(buildDemoSeed(now, base), dryRun)`；失敗則停止，不執行後續步驟。
- 步驟 3（孤兒清理）：`referenced_paths` 在 TS 端計算（payload 的路徑加上查 `admins` 目前的頭像網址）。`store-assets`、`designer-assets`：刪除不在清單且 `created_at` 早於還原開始時間的物件；`admin-assets`：**只刪 `owner_id` 等於 Demo 帳戶的孤兒**，任何 `admins` 仍引用的物件與非 Demo 擁有的物件一律不碰；**任何引用網址解析失敗時，跳過整個 bucket 的清理**。清理對象白名單寫死，**絕不碰 `demo-seed`**；單批最多 1000 個。
- 步驟 4：以 admin API 刪除 Demo 帳戶的 MFA factor；呼叫 `demo_revoke_sessions()` 撤銷 Demo 的 session。
- 步驟 5（健康檢查）：用**獨立的 anon client（`persistSession: false`）**驗證 Demo 帳戶可登入、`is_demo`、無 MFA，登入後立即 `scope: "local"` 登出；失敗要在摘要中明確標示，但不回滾也**不自動改密碼或 Email**（修復走 SQL Editor）。
- `dryRun` 為真時只執行步驟 1 的唯讀檢查與步驟 2 的 dry-run，不複製、不刪除、不清理、不登入。
- 時間預算：逼近上限時只能在步驟 1 與步驟 3 中止（交易本身不可被中斷），並回報。
- 只記錄階段、筆數與耗時，不記錄任何密碼與金鑰。

## 驗收標準

- 各階段失敗路徑有測試：步驟 1 缺檔 → 不呼叫 RPC；步驟 2 失敗 → 不清理、不處理帳戶；步驟 3 逼近預算 → 停止並回報；步驟 5 失敗 → 回報但資料不變。
- `admin-assets` 清理測試：模擬 `designer001`（擁有者不是 Demo）與 Demo 兩個頭像、若干孤兒、一個引用網址解析失敗的案例，只刪 Demo 擁有的孤兒；解析失敗時整個 bucket 不清理。
- 清理永遠不會對 `demo-seed` 發出刪除（以 spy 驗證）。
- 差異同步：全部相同時 0 次 `copy`；內容不同時先 `remove` 再 `copy`；缺檔時不動資料。
- `dryRun` 不呼叫任何寫入型 Storage API 與 auth API（以 spy 驗證）。
- `designer001` 的舊 `audit_log` 紀錄指向已刪除的資料時，稽核列表仍可顯示（驗證 `AuditLogView` 不依賴對應資料存在）。
- 輸出摘要不含密碼與金鑰。

## 實作備註

- 不得提供任何繞過 `dryRun` 的便利方法；呼叫端必須明確傳入。
- 此卡不接排程；排程在 TASK-110。
- 若使用者在後台新上傳了展示用圖片但尚未納入 seed，當晚會被當成孤兒刪除；手冊（TASK-111）要寫「整理展示內容前先關閉排程」。

## 驗證契約

- 單元測試：`tests/lib/demo-reset.test.ts`（假 client，涵蓋全部階段與失敗分支）。
- 整合測試：不適用（不對正式庫真實執行；dry-run 的整合驗證在 TASK-110 的指令與 TASK-112）。
- E2E 測試：不適用。
- 型別檢查：`npx tsc --noEmit` 無錯誤
- Lint：`npm run lint` 無錯誤
- Build：`npm run build` 成功
- 螢幕截圖：不適用。
- 安全性檢查：`designer001` 頭像不被刪除（擁有者規則加引用規則雙重保護）；失敗不留半套；絕不碰 `demo-seed`；無金鑰外洩；健康檢查不影響共用 session。

## 審查關卡

架構、安全性、驗證（測試工程）；高風險，動工前須人工核准。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：
- 已知限制：
- 後續任務：
