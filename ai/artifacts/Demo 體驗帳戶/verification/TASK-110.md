# 驗證報告

## 摘要

- 任務：TASK-110 還原排程端點、`vercel.json` 與手動還原指令（排程預設關閉）
- 結果：**實作與自動化驗證完成，待使用者人工驗收。**相關測試 180 項全過；`tsc`、`lint`、`build` 通過；對本機開發伺服器做了 dry-run 與參數防呆的實測。
- 驗證者：實作 agent（Claude Code）。架構、安全、測試三個子代理審查已執行並處理，其意見是 agent 意見，**不等於人工核准**。
- 日期：2026-10-31。本卡**沒有**對任何站台做真實還原，也**沒有**把 `DEMO_RESET_ENABLED` 設為 true（`.env.local` 與 `.env.example` 都維持關閉）。

## 變更的檔案

| 檔案 | 說明 |
|---|---|
| `app/api/cron/demo-reset/route.ts` | 新增：`GET`，先驗 Bearer 密鑰；三種行為（`dry_run=1`／`confirm=RESET_DEMO`／無參數排程）；只呼叫 `runDemoReset` |
| `scripts/reset-demo.mjs` | 新增：手動指令。預設 dry-run；真實還原需 `--yes`；目標網址必須 `--url` 明確給定 |
| `vercel.json` | 新增第二個排程 `/api/cron/demo-reset`，`0 19 * * *`；提醒信排程不變 |
| `package.json` | 新增 `demo:reset` |
| `tests/api/demo-reset-cron.test.ts` | 新增：端點測試（驗證、參數、旗標、傳給還原的參數、失敗、日誌、執行鎖） |
| `tests/lib/demo-reset-script.test.ts` | 新增：指令的參數解析、網址檢查，以及對本機假伺服器跑完整流程（任務卡未列出，實作時補登記） |
| `tests/lib/demo-config.test.ts` | 修改：啟用 cron 與 `DEMO_RESET_LABEL` 一致性斷言 |
| `ai/artifacts/Demo 體驗帳戶/architecture-notes.md`、`task-cards/TASK-110.md` | 更新 Hobby 核對結論、任務卡狀態與檔案清單 |

## 設計重點

- **排程模式必須完全不帶 query**：只認 `dry_run`、`confirm`；其他名稱（含打錯字的 `?dryrun=1`）、重複參數、值不精確（`dry_run=0`、`confirm=reset_demo`）一律 400，且參數檢查先於旗標檢查。
- **優先順序**：密鑰（401）→ 參數（400）→ 排程旗標（skipped）→ 執行鎖（409）→ 建立 service role client → `runDemoReset`。驗證前不建立 client、不解析參數。
- **`dryRun` 明確判斷成 boolean**：只有 `?dry_run=1` 為 true，其餘都是 false；只傳 `{ supabase, now, dryRun, deadlineMs }` 四個欄位。
- **時間預算**：`maxDuration = 60`，`deadlineMs = 開始 + 38 秒`。`reset.ts` 進入資料庫前至少要剩 15 秒，所以最晚約 23 秒進入資料庫，尾段最晚約 38 秒之後再收尾。
- **狀態碼**：`ok:false` 一律 500（含「資料庫已還原但附屬階段失敗」，以 `databaseRestored` 與日誌文字區分）；`ok:true` 但有 `warnings` 或未完成階段 → 200，以 `console.warn` 記錄。
- **回應只放摘要**：階段狀態與「代碼」（資料庫錯誤訊息、含空白的自由文字被遮成「詳見伺服器日誌」，完整訊息只寫進日誌）、筆數、警告；不回原始例外。
- **執行鎖**：模組層級，記錄開始時間，超過 70 秒視為失效（平台逾時中止時 `finally` 不會執行）。
- **指令**：只接受 https（本機網址可用 http）、不跟隨轉址、密鑰只讀環境變數且不印出；非本機網址的真實還原另需 `--confirm-host=<主機>` 與目標相同；錯誤訊息不回顯原始網址。

## Hobby 排程限制核對（驗收標準）

Vercel 文件「Usage & Pricing for Cron Jobs」（頁面標示 2026-07-15 更新）：Hobby 每專案最多 100 個排程、**每日最多一次**、精度為**該小時內（±59 分）**。結論：第二個每日排程可行，不需與提醒信合併；`0 19 * * *` 會在 UTC 19:00–19:59（台北 03:00–03:59）觸發，與文案「每日凌晨 3 點左右」相符。已寫回架構筆記。

## 指令與輸出

| 指令 | 結果 |
|---|---|
| `npx vitest run tests/api/demo-reset-cron.test.ts tests/lib/demo-reset-script.test.ts tests/lib/demo-config.test.ts tests/lib/demo-reset-test-scan.test.ts tests/lib/demo-reset.test.ts` | 5 檔 180 項全過 |
| `npx tsc --noEmit` | 0 錯誤 |
| `npm run lint` | 0 錯誤 |
| `npm run build` | 成功，路由表含 `/api/cron/demo-reset` |
| `npm run demo:reset -- --url http://localhost:3000`（對本機開發伺服器，連到正式庫，dry-run） | 見下方輸出 |
| `curl`：無密鑰／錯誤密鑰＋`confirm` | 401 `{"error":"unauthorized"}` |
| `curl`：排程呼叫（旗標未設） | 200 `{"ok":true,"skipped":true}` |
| `curl`：`?dry_run=0`、`?confirm=reset_demo`、`?dryrun=1` | 400 `{"ok":false,"error":"invalid_params"}` |
| `npm run demo:reset`（沒有 `--url`） | 中止：必須用 `--url` 明確指定目標網址 |
| `npm run demo:reset -- --url https://example.invalid --yes` | 中止：非本機網址必須再加 `--confirm-host=example.invalid`，沒有送出任何請求 |

本機 dry-run 輸出：

```
目標：http://localhost:3000
模式：dry-run（只試跑，不寫入任何東西；要真實還原請加 --yes）
HTTP 500
耗時 1151 ms；資料庫已還原：否
  階段 prepare：failed（expected_exactly_1_demo_account_found_0）
[demo:reset] 還原未成功：reset_failed（階段 prepare）
```

這是**預期結果**：正式庫目前沒有 Demo 帳戶（TASK-112 才建立），流程在唯讀的 prepare 階段停止，沒有任何寫入。端到端（真實 `reset_demo_data` 的 dry-run 計數、圖片同步計畫）要等 TASK-112 建立帳戶後才能驗。

## 驗收標準對照

| 驗收標準 | 結果 | 證據 |
|---|---|---|
| 無密鑰、錯誤密鑰回 401，還原邏輯零呼叫（spy） | 通過 | 單元：4 種拒絕＋密鑰未設定＋密鑰放 query；`runDemoReset` 與 `createServiceRoleClient` 都零呼叫（含帶 `confirm`／`dry_run` 的請求） |
| 排程呼叫且旗標關閉 → skipped、零呼叫；旗標 `"true"` 才真實還原 | 通過 | 單元：9 種非 `"true"` 值（含 `TRUE`、`1`、`" true"`）皆 skipped；`"true"` 時 `dryRun === false` |
| `?dry_run=1` 只 dry-run；`?confirm=RESET_DEMO` 在旗標關閉時仍真實還原（spy） | 通過 | 單元：旗標未設／false／true 三種都符合；`dry_run=1` 與 `confirm` 同時出現以 dry-run 為準 |
| `npm run demo:reset` 不帶 `--yes` 只做 dry-run；帶 `--yes` 才送 `confirm`；都先印目標網址 | 通過 | 對本機假伺服器跑完整指令：請求網址、模式文字、「收到請求時 stdout 已含目標」 |
| `vercel.json` 有 Demo 排程且與 `DEMO_RESET_LABEL` 一致；提醒信排程不變 | 通過 | `demo-config.test.ts`：剛好 1 個、每日一次、UTC→台北小時＝文案小時、提醒信排程原樣 |
| Hobby 排程限制已核對並記錄 | 通過 | 見上節 |

## 審查處理

| 項目（來源） | 處置 |
|---|---|
| **打錯參數名稱（`?dryrun=1`）被當成排程，旗標開啟後變真實還原**（安全，中） | **已修正**：排程模式必須完全沒有 query；測試 7 種打錯寫法在旗標開啟時皆 400，且旗標關閉時無效參數仍回 400（鎖定順序） |
| 回應帶出資料庫原始錯誤訊息（安全，低） | **已修正**：階段訊息只回代碼，完整訊息只寫日誌；有測試 |
| 執行鎖在平台逾時中止後可能永遠卡住（架構，中） | **已修正**：記錄開始時間，超過 70 秒視為失效；有測試 |
| skipped 沒有日誌（架構，低） | **已修正** |
| 缺檔代碼超過 10 筆時尾端「…」使整段被遮蔽（架構，低） | **已修正** |
| `--yes` 對非本機網址沒有第二道確認；錯誤訊息回顯原始網址（安全，低） | **已修正**：非本機真實還原需 `--confirm-host`；錯誤訊息不回顯網址 |
| `maxDuration`、`demo:reset` 指令、`ok:false` 但 HTTP 200、非 JSON 回應、順序變異等測試缺口（測試） | **已補**：新增對應斷言；模式文字改比對完整字串；驗證「先印目標再送請求」；指令測試設 20 秒逾時 |
| 測試檔不在任務卡允許清單（架構，低） | 已在任務卡補登記 |
| `CRON_SECRET` 外洩時，持有者可繞過旗標反覆真實還原；409 只擋同一執行環境（安全，低） | **殘留風險**：架構筆記 D9 已定「手動與排程共用密鑰」；損害上限是 Demo 資料回到 seed，且資料庫端有 advisory lock 與閘門。若要再降低，可改用另一把手動專用密鑰或加冷卻時間，屬新任務 |
| 直接讀 `DEMO_RESET_ENABLED`，未集中到 `lib/demo/config.ts`（架構，低） | 接受：僅一處使用，之後再收斂 |

## 殘留風險與已知限制

- **整合面未驗證**：真實的 dry-run 計數與圖片同步、真實還原、健康檢查，都要等 Demo 帳戶存在（TASK-112）。本卡只證明端點的把關、參數、狀態碼與指令行為。
- **排程時間精度**：Hobby 只保證在該小時內觸發；冷啟動時間沒算進 `deadlineMs`，`reset.ts` 的尾段各呼叫也沒有逾時保護（屬 TASK-109 範圍，記錄在此）。
- **平台逾時強制終止**時 `finally` 不會執行：資料庫閘門最多再開 3 分鐘、session 可能未撤銷（交易本身是原子的）；執行鎖已用過期時間處理。
- **部分完成仍 `ok:true`**（清理跳過或預算用完）：只靠 `console.warn` 與回應的 `stages`／`warnings` 告警；沒有外部告警通道。
- **全套測試的元件測試偶發 5 秒逾時**（`tests/components/*`，每次失敗的案例不同，單獨重跑多半通過），與本卡無關，未修改那些檔案。
- 首次真實還原前必須先備份（TASK-117）並取得使用者同意；啟用 `DEMO_RESET_ENABLED` 屬 TASK-112 與使用者明確同意之後的營運動作。

## 後續

- TASK-112：建立 Demo 帳戶後，先手動 dry-run，再（備份、取得同意後）手動真實還原一次，之後才開排程旗標；驗證 `sync.planned.replace` 在第一次真實還原後為 0。
