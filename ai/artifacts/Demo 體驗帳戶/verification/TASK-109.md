# 驗證報告

## 摘要

- 任務：TASK-109 還原編排 `lib/demo/reset.ts`（圖片差異同步、呼叫 RPC、孤兒清理、帳戶處理、健康檢查）
- 結果：**實作與自動化驗證完成，待使用者人工驗收。**單元測試 57 項全過（還原編排 51 項、掃描 6 項）；`tsc`、`lint`、`build` 通過；對正式庫做了一次**唯讀**實地驗證。
- 驗證者：實作 agent（Claude Code）。架構、安全、測試三個子代理審查已執行並處理，其意見是 agent 意見，**不等於人工核准**。
- 日期：2026-10-31。本卡**沒有**對正式庫做任何寫入，也沒有真實還原。

## 變更的檔案

| 檔案 | 說明 |
|---|---|
| `lib/demo/reset.ts` | 新增（`server-only`）：`runDemoReset({ supabase, now, dryRun, deadlineMs })`，另有只給測試用的 `runDemoResetWithDeps`、`parseStorageUrl`、`collectReferences` |
| `tests/lib/demo-reset.test.ts` | 新增：假 client 的單元測試（涵蓋各階段與失敗分支） |
| `tests/lib/demo-reset-test-scan.test.ts` | 修改：白名單加入 `lib/demo/reset.ts` 與其單元測試；新增 reset.ts 結構檢查、`runDemoResetWithDeps` 引用限制、單元測試只用假 client 的檢查 |

## 流程與設計重點

1. **prepare（唯讀）**：用 `app_metadata.is_demo` 找出 Demo 帳戶（必須剛好 1 個）；產生 seed payload 並補上 `demo_user_id`；檢查圖片網址：全部必須是本專案的 Storage 公開網址、至少一張，否則失敗。
2. **sync_images**：用 `demo_list_storage_objects` 列出 `demo-seed` 與三個公開 bucket；來源缺檔直接失敗（dry-run 也一樣，尚未動任何資料）；缺少的 `copy`、大小或 eTag 不同的先 `remove` 再 `copy`（一次 5 個）；`admin-assets` 覆寫要求目的物件沒有擁有者或屬於 Demo。
3. **reset_database**：真實還原前開閘門（3 分鐘）、finally 一定關；呼叫 `reset_demo_data`；進入前至少要剩 15 秒（交易、帳戶處理、健康檢查）。
4. **cleanup_orphans**（只在資料庫已提交之後）：白名單寫死三個公開 bucket，絕不碰 `demo-seed`；`admin-assets` 只刪擁有者是 Demo 且不被任何 admins 引用的；只刪早於「還原開始時間減 60 秒」的物件；同網域但無法解析的引用網址 → 整個清理跳過；列出剛好 1000 筆視為被截斷。
5. **revoke_account**：刪除 Demo 的 MFA factor、撤銷 Demo 的 session（兩件事各自處理）。
6. **health_check**：獨立 anon client 登入，驗證 `is_demo`、帳戶 id、無 MFA，登入後立即 `scope: "local"` 登出；只回報，不修復。

資料庫提交之後，任何階段失敗都不回滾、也不阻止後面的階段；最後回報第一個失敗的階段，`summary.databaseRestored` 讓呼叫端分辨「資料沒動」與「資料已還原、附屬階段失敗」。

## 指令與輸出

| 指令 | 結果 |
|---|---|
| `npx vitest run tests/lib/demo-reset.test.ts tests/lib/demo-reset-test-scan.test.ts` | 57 passed（還原編排 51、掃描 6），0 skipped |
| 變異測試（刻意弄壞程式，測試必須失敗）共 13 項 | 全部被測試抓到：admin-assets 擁有者規則移除、不看建立時間、dry-run 也開閘門、清理對象含 demo-seed、缺檔不失敗、網域不符不擋、資料庫前預留時間移除、清理例外不擋、admin 覆寫不檢查擁有者、開門失敗不關門、時鐘邊際移除、factor 失敗就不撤銷 session、dryRun 型別檢查移除 |
| `npx tsc --noEmit`／`npm run lint`／`npm run build` | 0 錯誤／0 error 0 warning／成功 |
| **正式庫唯讀實地驗證**（真實 client、`dryRun: true`、Demo 帳戶查詢以假值替代） | 讀到 45 個 seed 引用物件，與 `demo-seed` 逐一比對 **45 相同、0 複製、0 覆寫**；designer001 的頭像網址解析為本專案網址；流程在資料庫那步因「正式庫尚無 Demo 帳戶」而停止（預期），沒有任何寫入 |

## 驗收標準對照

| 驗收標準 | 結果 | 證據 |
|---|---|---|
| 步驟 1 缺檔 → 不呼叫 RPC | 通過 | 單元：缺檔（含 dry-run）不呼叫 reset／閘門／任何寫入 |
| 步驟 2 失敗 → 不清理、不處理帳戶 | 通過 | 單元：reset 失敗時另放舊孤兒，斷言沒有 remove、沒有查 admins、沒有第二輪列出、沒有 factor／session 處理、沒有健康檢查，且閘門被關閉 |
| 步驟 3 逼近預算 → 停止並回報 | 通過 | 單元：partial、skipped: deadline；另測「進入資料庫前剩餘不足 15 秒」與「複製期間用完預算」 |
| 步驟 5 失敗 → 回報但資料不變 | 通過 | 單元：5 種失敗＋缺憑證；斷言只呼叫一次 reset、仍做本機登出 |
| admin-assets 清理：designer001 與 Demo 兩個頭像、孤兒、解析失敗 | 通過 | 單元：只刪 Demo 擁有的孤兒；designer001 的、別人的、擁有者未知的、剛上傳的、被引用的都不碰；解析失敗整體不清理 |
| 清理絕不對 demo-seed 發出刪除（spy） | 通過 | 單元：demo-seed 內放 20 個雜物仍無任何 `remove demo-seed`；變異「清理含 demo-seed」讓 20 項失敗 |
| 差異同步：全部相同 0 次 copy；不同先 remove 再 copy；缺檔不動資料 | 通過 | 單元：含只有 eTag 不同、remove 失敗、remove 成功但 copy 失敗 |
| dryRun 不呼叫任何寫入型 Storage／auth API（spy） | 通過 | 單元：寫入名單涵蓋 copy、remove、deleteFactor、撤銷 session、開關閘門、健康檢查登入 |
| 稽核列表不依賴對應資料存在 | 通過（資料層） | 單元：`listAuditLog` 只查 `audit_log`；`AuditLogView.tsx` 沒有任何反查其他表的程式。**未做畫面層 render 測試** |
| 輸出摘要不含密碼與金鑰 | 通過 | 單元：成功與各種失敗的摘要不含 `DEMO_PASSWORD`、service role key、Email |

## 審查處理

三個子代理（architect、security-reviewer、test-engineer）已審查，意見是 agent 意見、不等於核准。處置如下：

| 項目（來源） | 處置 |
|---|---|
| **H1 網域對不上時引用集合變空，孤兒清理會刪光公開 bucket**（架構、安全共同列為高） | **已修正**：移除 `invalid.invalid` 預設值（拿不到網址 → prepare 失敗）；prepare 要求 seed 的每個圖片網址都是本專案網址且至少一張；補測試（不同專案、http／https 不同、缺網址） |
| 清理丟例外會中斷帳戶處理並遺失摘要（架構 M1／安全 2） | **已修正**：清理包 try/catch，轉成 `cleanup_error`；測試證明摘要保留 `databaseRestored` 且後續階段照做 |
| `dryRun` 沒有執行期型別檢查（安全 3） | **已修正**：非 boolean 直接丟錯；`now`、`deadlineMs` 一併驗證 |
| 開門失敗時不關閘門；閘門 10 分鐘偏長（安全 4／架構 L1） | **已修正**：只要呼叫過開門，finally 就關；縮短為 3 分鐘 |
| 時間預算沒有替資料庫之後的階段預留（安全 5／架構 M3） | **已修正**：進入資料庫前至少剩 15 秒；`deadlineMs` 語意寫入型別註解 |
| 測試注入點開放在正式匯出型別上（安全 6／架構） | **已修正**：正式入口 `runDemoReset` 只接受四個欄位；注入點移到 `runDemoResetWithDeps`，掃描測試限制只有 reset.ts 與其單元測試能引用 |
| admin-assets 覆寫沒有套用擁有者規則（安全 8） | **已修正**：目的物件屬於別的帳戶就拒絕，失敗在 sync_images |
| factor 刪除失敗會連帶跳過 session 撤銷（安全 9） | **已修正**：兩件事各自處理 |
| `created_at` 與應用程式時鐘可能有誤差（架構 L6） | **已修正**：早於還原開始時間 60 秒以上才算孤兒 |
| `removed` 計數用批次大小而非實際刪除數（架構 L8／測試） | **已修正**：以 Storage 回傳的已刪除物件數為準 |
| dry-run 把計畫數放進 `copied`／`replaced`（架構 L4） | **已修正**：新增 `planned`，`copied`／`replaced` 只代表實際完成 |
| `counts` 為 null 的判斷、健康檢查註解不精確（架構 L2、L3） | **已修正** |
| 測試的空洞斷言、缺漏案例（測試審查 1～9） | **已修正**：補 `deadline_before_database`、eTag-only 差異、remove 失敗、replace 後 copy 失敗、四個 bucket 列出失敗／截斷、清理階段列出失敗、listFactors／revoke 失敗、MFA 的 `userId` 參數、使用者清單分頁、prepare 的網址解析失敗、reset 失敗時真的有孤兒卻沒被清理 |
| **先 remove 再 copy 有破圖窗口**（架構 M2／安全 7／測試） | **維持現狀並列為殘留風險**（任務卡與 D7 的設計）：remove 成功、copy 失敗時公開 bucket 暫時缺檔，下一次執行會補回。已有測試鎖定這個行為。**TASK-112 必須實測**：第一次真實還原之後再跑 dry-run，`sync.planned.replace` 應為 0（證明 Storage `copy` 後 eTag 與來源一致，否則每天都會重刪重複製）。替代方案（下載後以 upsert 上傳）會是原子覆寫，但偏離任務卡，未做 |
| 目的 bucket 累積超過 999 個物件後還原會永久失敗（測試） | 殘留風險（偏安全方向）；目前最大 bucket 約 45 個 |
| 部分完成（預算用完）時仍回 `ok: true`（測試、架構 L5） | 呼叫端要讀 `stages`／`warnings`；已寫入 TASK-110 卡片的留言 |
| 畫面層稽核列表測試（測試 8） | 接受：資料層證明加原始碼 grep；列為殘留 |

## 殘留風險與已知限制

- **整合面未驗證**：真實的 `storage.copy` 跨 bucket 行為、copy 後 size／eTag 是否與來源一致、`demo_revoke_sessions`、健康檢查真實登入、真實還原與孤兒清理，都只存在假 client 的測試裡。正式庫目前沒有 Demo 帳戶，無法端到端；要等 TASK-112。
- **remove 後 copy 失敗的破圖窗口**，以及 **Storage copy 後 eTag 是否一致**（見上）。
- **維持 `ok: true` 的部分完成**（清理跳過或預算用完）需要呼叫端告警。
- 函式被 Vercel 因執行時間強制終止時，`finally` 不會執行：閘門最多再開 3 分鐘、session 可能沒撤銷（交易本身是原子的，資料不會壞）。
- 排程與手動可能同時執行：資料庫的 advisory lock 只保護交易本身；同步階段撞名會失敗（偏安全方向）。
- 本卡不接排程、不提供端點；`dryRun: false` 的呼叫端把關（只傳四個欄位、明確判斷 `dry_run`／`confirm`）屬於 TASK-110。

## 後續（TASK-110 的注意事項，已寫入該卡留言）

- 只傳 `{ supabase, now: new Date(), dryRun, deadlineMs }`，`dryRun` 必須是明確判斷出的 boolean（沒帶參數不能變成真實還原）。
- `deadlineMs` 預留交易、帳戶處理與健康檢查時間（60 秒上限時，例如開始後 35～40 秒）。
- 依 `summary.databaseRestored` 決定日誌嚴重度與回應狀態碼；`warnings` 與 `stages` 要輸出或告警。
- 回應只回摘要，不回原始例外；先驗 Bearer 密鑰再建立 service role client。
- 首次真實還原前必須先備份（TASK-117）並取得使用者同意。
