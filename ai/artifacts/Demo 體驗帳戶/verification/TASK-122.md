# 驗證報告

## 摘要

- 任務：TASK-122 Demo 的 audit_log 容量防護（migration 0028）
- 結果：**實作與自動化驗證完成，使用者已套用 0028 並確認上限 500；待人工驗收。**on 模式整合測試 13 項、回歸套件全過。`TASK-122-verify.sql` 已由使用者在 SQL Editor 執行，結果 `RESULT=ALL_OK`（見下）。回滾實測也已完成（`_down` → off 模式 13 項 → 重新套用 → on 模式 13 項，見下）。
- 驗證者：實作 agent（Claude Code）。架構、安全、測試三個子代理審查已執行，其意見是 agent 意見，**不等於人工核准**。
- 日期：2026-11-01。上限 500 已由使用者確認；0028 已由使用者在 SQL Editor 套用。

## 變更的檔案

| 檔案 | 說明 |
|---|---|
| `supabase/migrations/0028_demo_audit_log_cap.sql`、`_down.sql` | 新增：觸發器 `demo_audit_log_cap` ＋ 函式 `demo_audit_log_cap_guard()`；尾端自我檢查；不改 `reset_demo_data`、不改 `audit_log` 的結構／policy／grant |
| `tests/lib/demo-audit-log-cap-migration.test.ts` | 新增：20 項檔案內容把關 |
| `tests/demo-audit-log-cap.integration.test.ts`、`vitest.demo-audit-log-cap.config.ts`、`package.json` | 新增：13 項整合測試（on／off 兩種模式）、`test:demo-audit-cap` |
| `ai/artifacts/Demo 體驗帳戶/verification/TASK-122-verify.sql` | 新增：SQL Editor 回滾式驗證腳本（含 `pg_locks` 的決定性鎖證明） |
| `tests/lib/demo-reset-test-scan.test.ts` | **任務卡原清單未列**：只在 `ALLOWED` 加入 0028 兩支 SQL 與本卡單元測試（架構審查 M1：它們只在註解與檔案比對中提到 `reset_demo_data`，沒有呼叫；比照 0027 前例） |
| `docs/demo-account.md`、`ai/context/decisions.md`、`project-map.md`、`architecture-notes.md`（D14 補一段） | 文件同步 |
| `tools/kanban/cards/TASK-122.json`、`task-cards/TASK-122.md`、本報告 | 看板與文件 |

## 設計（與草稿卡的差異）

草稿卡只有「每帳戶 500 筆」。審查後 0028 共有四項限制，皆只對 Demo 生效：

1. 該帳戶（JWT 的 `sub`）在 `audit_log` 的列數 ≥ 500 → 拒絕（硬上限，advisory lock）。
2. `event_type`／`entity_type` > 64 位元組 → 拒絕（**安全審查 M1**：0019 對這兩欄只有格式檢查、沒有長度限制，只限筆數守不住容量）。
3. 單一請求（交易）> 20 列 → 拒絕（安全審查 S2：限制「寫入後再中止」造成的膨脹；`recordAdminAction` 每次只寫 1 列）。
4. `actor_id` 必須等於 JWT 的 `sub`（安全審查 N2）。

另外：取鎖前 `lock_timeout = 2s`（S1）；預篩與解析用同一份 claims 字串、不再呼叫 `auth.jwt()`（N1）。

## 子代理審查與處置

| 來源 | 項目 | 處置 |
|---|---|---|
| 架構 M1 | 新檔案含 `reset_demo_data` 字樣，被全 repo 掃描測試擋下（`npm test`、`test:demo-reset` 會失敗） | **採納**：加入白名單（比照 0027），不用改字面字串規避 |
| 架構 S1 | 成本說明不準確：每筆 Demo 寫入都全表計數，不只拒絕時 | **採納**：改 migration 檔頭與手冊，寫明重新評估門檻（約 10 萬列） |
| 架構 S2 | Demo 觸頂後日誌雜訊與稽核列表無聲停止更新 | **採納**：手冊與 migration 檔頭寫明為預期內現象 |
| 架構 S3／S4 | 文件未補、500 待確認 | 文件已補；**500 待你確認** |
| 架構 N1、N2 | 永遠成立的斷言；verify 的 `blocked` 太籠統 | **採納**：改為比對被拒後 admin1 筆數不變；verify 改記 sqlstate（預期 22P02） |
| 架構 N3、N4 | 自我檢查略嚴；觀察到還原守門不檢查 audit_log | 維持（與 0027 一致）／記為日後項目 |
| 安全 M1 | `event_type` 無長度上限，500 筆上限守不住容量 | **採納**：方案 (a)，在函式內限制 64 位元組（不觸碰既有 constraint）。方案 (b)（對所有人加 CHECK）需擴大範圍，列為可選的縱深防禦，未做 |
| 安全 S1 | advisory lock 無等待上限，可間接耗盡連線池 | **採納**：`lock_timeout = 2s`（交易內） |
| 安全 S2 | 「寫入後再中止」的膨脹不受筆數限制 | **採納**：單一請求 20 列上限 |
| 安全 N1 | 預篩與 `auth.jwt()` 讀的來源順序不一致 | **採納**：同一份字串，不再呼叫 `auth.jwt()` |
| 安全 N2 | 以 `auth.uid()` 計數並強制 actor 一致；寫明 READ COMMITTED 前提 | **採納** |
| 安全 N3、N4、N5 | 無 actor_id 索引；輪換 Demo 帳號留孤兒列；共用額度的體驗 | 索引：記為重新評估門檻；孤兒列：手冊 §7.3 原有清理語句；共用額度：手冊寫明 |
| 安全 N6 | 範圍外觀察：`raw_user_meta_data` 未鎖，Demo 可能寫入很大的 user_metadata（未查證） | **未處理**，建議另開卡評估 |
| 測試 M1 | 並行案例沒有證明「拿掉鎖就會失敗」 | **採納**：`TASK-122-verify.sql` 加 `pg_locks` 決定性檢查（變異「拿掉鎖」被抓到）；並行案例加強為 30 個同時請求，**誠實標示為機率性證明** |
| 測試 M2 | 缺真實庫證據 | **進行中**：待你套用 0028 |
| 測試 S1、S2、S4 | 缺「管理員自己超過 500 筆」、真實 JWT 的 `user_metadata` 偽造帳號、剛好用完額度的邊界 | **採納**：整合測試新增三項 |
| 測試 S3 | 結尾筆數相等的斷言可能因真實後台寫入誤報 | 維持斷言並加註說明（實際上它抓到了我自己的測試洩漏，見下） |
| 測試 S5、S6 | 數字一致性、鎖前綴不衝突 | **採納**：單元測試新增兩項。`recordAdminAction` 遇 P0001 不 throw 的行為，既有 `tests/admin/audit-log.test.ts` 已涵蓋「回傳 error 不 throw」 |

## 過程中發現並修正的測試缺陷

整合測試第一版的清理只依 `event_type = 'test.demo_audit_cap'`，一般管理員寫的 300 位元組長 `event_type` 案例**洩漏了 1 列到正式庫 `audit_log`**（id 10797，結尾筆數斷言 151 ≠ 150 抓到）。已：(1) 以 id、`event_type`、`entity_type`、`entity_id` 四個條件精確刪除該列（筆數回到 150）；(2) 清理改為先依拋棄式帳號的 `actor_id` 清除所有列；(3) 重跑後 `audit_log` 維持 150 列、無殘留帳號。

## 已執行的驗證（套用 0028 之前）

| 項目 | 結果 |
|---|---|
| `npx vitest run tests/lib` | 27 檔 530 項通過（含全 repo 掃描測試） |
| `npx tsc --noEmit`、`npm run lint` | 0 錯誤、0 警告 |
| `DEMO_AUDIT_CAP_EXPECT=off npm run test:demo-audit-cap`（基準線：尚未套用，無上限） | 13 項通過；結束後 `audit_log` 150 列、`is_demo`／測試帳號 0 個 |
| 預設 on 模式（初版 8 項，尚未套用） | 3 項失敗（證明測試有鑑別力；新增案例後尚未重跑 on 模式基準） |
| PGlite（記憶體內 Postgres，假 `auth.jwt()`／`uid()`）演練：0028、重複套用、`TASK-122-verify.sql`、`authenticated` 角色下的實際寫入、欄位層級 grant（`actor_id` 回 42501）、API 角色不可呼叫函式、`_down`、`_down` 重複執行、重新套用 | 全過；verify 腳本 `RESULT=ALL_OK`（36 項） |
| 8 個變異（整表計數、無 actor 檢查、上限 501、信任 `user_metadata`、無鎖、無列數限制、無大小限制、不比對 actor） | 全部被 verify 腳本抓到 |

PGlite 不是 Supabase：它驗證 SQL 語法、順序、權限與回滾，但沒有驗證真實的 `auth.jwt()`、PostgREST 設定 claims 的方式與真實的連線池行為。**這就是需要在正式庫再跑一次的原因。**

## 套用 0028 之後的驗證（正式庫）

| 指令 | 結果 |
|---|---|
| `npm run test:demo-audit-cap`（on 模式，拋棄式帳號） | **13 項通過**（約 36 秒）；結束後 `audit_log` 150 列（與開始相同）、`test.%` 列 0、`is_demo`／測試帳號 0 個 |
| `npm run test:audit-log` | 28 項通過 |
| `npm run test:demo-reset`（只 dry-run；含全 repo 掃描） | 2 檔 34 項通過 |
| `npm run test:demo-row-caps` | 16 項通過 |
| `npm run test:demo-enter`（含 Demo 的 `is_admin()` 寫入面） | 22 項通過 |
| 回歸後檢查 | `audit_log` 150 列、`admins` 1 列、無殘留拋棄式帳號 |
| `TASK-122-verify.sql`（使用者在 SQL Editor 執行，真實庫） | **`RESULT=ALL_OK`，31 項全數與預期相符，沒有 MISMATCH**：觸發器為 BEFORE INSERT ROW 且啟用、函式 SECURITY DEFINER／search_path 為空／擁有者可繞過 RLS、API 角色不可執行、函式內上限與獨立抄寫的 500 一致；Demo（布林與字串 true）滿額被拒；非 Demo（含偽造 claims、超過 500 筆）與 service role 不受限；另一個 Demo actor 不被整張表總筆數擋住；剩一個額度可寫一次再被拒；多列單一 insert 整句被拒；64／65 位元組邊界；20／21 列邊界；actor 不一致與無 actor 被拒；**`pg_locks` 證明 Demo 寫入後持有該帳戶的 advisory lock（1）、非 Demo actor 沒有（0）**；claims 不是合法 JSON 且含 is_demo 時以 22P02 擋下。Rollback 已保證（腳本內暫時 1163 列，rollback 後恢復） |

未跑：`test:demo-lock`（auth 觸發器，與 `audit_log` 無關且登入次數多）、`test:demo-mail-suppress`（會寄信到你的信箱，與本卡無關）、`test:demo-disable`、`test:demo-seed-bucket`、`test:demo-rate-limit`、預設 `npm test` 全套（UI 元件測試偶有逾時，既有不穩）。本卡只新增 `audit_log` 上的一個觸發器，沒有碰這些路徑。

### 驗收標準對照

| 驗收標準 | 結果 |
|---|---|
| Demo 寫到 500 筆後第 501 筆被拒（P0001、訊息 `DEMO_ROW_CAP: audit_log (cap 500)`），資料不變；一般管理員與 service role 不受影響 | **通過**（整合測試「滿額時」；service_role 對 `audit_log` 沒有 insert 權限，改由 verify 腳本模擬 claims 驗證） |
| 每帳戶計數（另一帳戶的大量紀錄不影響 Demo） | **通過**（兩項：他人 300 筆時 Demo 仍可寫滿 500；整張表 ≫ 500、Demo 自己 0 筆仍可新增；另有管理員自己 510 筆仍可寫入） |
| 並行：剩 S 個額度恰好 S 筆成功 | **通過**：30 個同時請求搶 3 個額度，恰好 3 筆（機率性）；鎖的決定性證明在 verify 腳本的 `pg_locks` 檢查，**真實庫已通過** |
| 多列單一 insert 額度不足整句被拒、無部分寫入 | **通過**（含剛好用完額度的邊界） |
| off 模式對稱 | **通過**（套用前與 `_down` 後的 off 模式各 13 項通過；每個「被擋」斷言在 off 模式都有「沒被擋」斷言） |
| `reset_demo_data` 未被修改；`test:demo-reset`、`test:audit-log`、`test:demo-row-caps` 回歸仍通過 | **通過** |
| 套用前後 `designer001` 的 `auth.users` 列與 `audit_log` 其他列不變 | **間接**：`audit_log` 總筆數前後相同（150）；本卡只新增觸發器、沒有碰 `auth` schema，未另做 `designer001` 列的雜湊比對 |
| migration 可重複執行；`_down` 後行為恢復；SQL Editor 驗證腳本通過 | **通過**：驗證腳本真實庫 ALL_OK；`_down` 後 off 模式 13 項通過；重新套用後 on 模式 13 項通過（見「回滾實測」） |

### 回滾實測（真實庫）

| 步驟 | 結果 |
|---|---|
| 1. 使用者執行 `_down`，回報「成功」 | 隨後的 off 模式 **6 項失敗、7 項通過**：Demo 仍被擋（21 列、長 event_type 的錯誤訊息只可能來自 `demo_audit_log_cap_guard()`，另以拋棄式 Demo 探針確認）。使用者的唯讀查詢顯示函式仍存在 → **`_down` 沒有生效**（推測貼錯成同名的 up 檔：兩份檔案執行後都只顯示 Success，看不出差別；`_down` 的尾端自我檢查在函式仍存在時會中止並報錯）。測試失敗的是「上限消失」的斷言，測試本身無誤；期間保護仍在，沒有失守 |
| 2. 使用者重新執行 `_down` | 唯讀查詢：觸發器 0 列、`to_regprocedure('public.demo_audit_log_cap_guard()')` 為 null |
| 3. off 模式整合測試 | **13 項通過**；`audit_log` 150 列、無殘留帳號 → 「`_down` 後行為恢復」在真實庫證實 |
| 4. 使用者重新套用 `0028` | 成功（同時證明 migration 在真實庫可重複套用：先前已套用過一次，經 `_down` 後再套用） |
| 5. on 模式整合測試 | **13 項通過**；`audit_log` 150 列、無殘留帳號 → 限制恢復 |

教訓：`_down` 與 up 檔案的執行結果都只顯示 Success。之後回滾實測請在執行後立刻用唯讀查詢確認（`pg_trigger`／`to_regprocedure`）再跑測試；`_down` 檔頭的註解第一行是「回滾 0028_demo_audit_log_cap.sql」。

## 待你處理

（已完成：確認上限 500、套用 0028、執行 `TASK-122-verify.sql` 得 ALL_OK、回滾實測與重新套用。）剩下人工驗收；通過後我把看板轉 Done 並 commit。

## 殘留風險

- 並行整合案例是機率性證明；鎖的存在由 verify 腳本的 `pg_locks` 檢查證明，兩者合起來才完整。
- Demo 觸頂後稽核列表不再更新，日誌每次一行 P0001（預期內）；額度所有訪客共用。
- 範圍外：`raw_user_meta_data` 未鎖（安全審查 N6，未查證）。
- 完整 `vitest run` 偶有 UI 元件測試逾時（既有不穩，與本卡無關，TASK-117 報告已記錄）；本卡相關檔案全部穩定通過。
