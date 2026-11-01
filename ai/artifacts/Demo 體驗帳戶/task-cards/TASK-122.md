# AI-Ready 任務卡

## Metadata

- 任務：Demo 的 audit_log 每帳戶筆數上限
- 上層規格：[`feature-spec.md`](../feature-spec.md)；來源：[`verification/TASK-116.md`](../verification/TASK-116.md)（三方審查）
- 上層 Epic：Demo 體驗帳戶
- 上層 User Story：濫用防護與緊急開關
- 分軌：後端
- 前置任務（dependsOn）：TASK-116
- 狀態：人工驗收通過，已完成（2026-11-01；上限 500 由使用者確認）；**Demo 入口開放前必須完成（TASK-112 的前置條件）**
- 風險等級：高（migration）
- Agent owner：Claude Code
- 人工核准者：使用者

## 目標

Demo 可直接透過 REST 對 `audit_log` insert（`authenticated` 有欄位層級 insert 授權，policy 只看 `is_admin()`），每筆 summary／changes 各最多 4 KB，沒有筆數上限；約 10 萬筆即超過免費方案 500 MB。`actor_id` 不可由使用者指定（只能走預設 `auth.uid()`），所以每日還原清得掉，缺口在「一天之內」。

## 情境包（Context Pack）

- 相關檔案：`supabase/migrations/0019_audit_log.sql`（資料表、constraint、grant：`authenticated` 只有欄位層級 insert，不含 `actor_id`／`created_at`；`service_role` 只有 select、delete）、`0027_demo_row_caps.sql`（同類做法的範本）、`0024_demo_reset.sql`（還原只刪 `actor_id` = Demo 的列）、`lib/admin/audit-log.ts`（`recordAdminAction` 永不 throw）。
- 既有模式：0027 的觸發器函式（預篩 claims 字串 → 簽章後的 `app_metadata.is_demo` → advisory lock → 計數 → `P0001`／`DEMO_ROW_CAP`）、尾端自我檢查、`_down.sql`、SQL Editor 回滾式驗證腳本、整合測試 on／off 模式。
- 已查證的事實：
  - `audit_log` **不在** `reset_demo_data` 覆寫的十一張表內（還原只 `delete … where actor_id = <Demo>`），所以新增觸發器**不需要**改 `reset_demo_data` 的觸發器白名單，也就不必像 0027 那樣重新定義該函式，`0027_down` 的警告不受影響。
  - 目前沒有任何 migration 在 `audit_log` 上建立觸發器。
  - Demo 的 `actor_id` 由預設值 `auth.uid()` 帶入，使用者無法指定（欄位層級 grant），所以以 `new.actor_id` 計數等於以 Demo 帳戶計數。
- 假設：`recordAdminAction` 失敗只 `console.warn`、不影響原操作，所以 Demo 觸頂後後台操作照常，只是稽核列表不再新增紀錄，每日還原後恢復。
- 未知事項：無（上限數字 500 待使用者確認）。
- 允許變更的檔案：
  - `supabase/migrations/0028_demo_audit_log_cap.sql` 與 `0028_demo_audit_log_cap_down.sql`
  - `tests/lib/demo-reset-test-scan.test.ts`（只在 `ALLOWED` 加入 0028 兩支 SQL 與本卡單元測試：它們只在註解與檔案比對中提到 `reset_demo_data`，沒有呼叫；架構審查 M1，比照 0027 前例；**卡片原清單未列，已告知使用者**）
  - `tests/lib/demo-audit-log-cap-migration.test.ts`、`tests/demo-audit-log-cap.integration.test.ts`、`vitest.demo-audit-log-cap.config.ts`、`package.json`（`test:demo-audit-cap`）
  - `ai/artifacts/Demo 體驗帳戶/verification/TASK-122.md`、`TASK-122-verify.sql`
  - `ai/context/decisions.md`、`ai/context/project-map.md`、`docs/demo-account.md`（上限清單與緊急停用）、`ai/artifacts/Demo 體驗帳戶/architecture-notes.md`（D14 補一句）
- 不得觸碰：`reset_demo_data`、既有 migration、`lib/admin/audit-log.ts`、`audit_log` 的欄位／policy／grant。

## 需求

- `audit_log` 的 `BEFORE INSERT FOR EACH ROW` 觸發器 `demo_audit_log_cap`，函式 `demo_audit_log_cap_guard()`（新函式：計數條件是「該帳戶的列」，與 0027 的「整張表」不同）。
- 只在 Demo JWT（簽章後的 `app_metadata.is_demo = 'true'`）時生效；先以 claims 字串預篩，沒有 `is_demo` 就在第一個判斷放行；預篩與解析用同一份字串（審查 N1）。
- **審查後新增（安全審查 M1、S1、S2、N2）**：Demo 的 `event_type`／`entity_type` 超過 64 位元組拒絕（0019 沒有長度限制，只限筆數守不住容量）；單一請求最多 20 列；`actor_id` 必須等於 JWT 的 `sub`；取鎖前 `lock_timeout = 2s`。
- 以 JWT 的 `sub` 計數該帳戶在 `audit_log` 的列數；沒有 `sub` 或與 `new.actor_id` 不一致時拒絕；達上限（**500**）以 `P0001`／`DEMO_ROW_CAP: audit_log (cap 500)` 拒絕，hint 為白話說明。
- 硬上限：`pg_advisory_xact_lock`（key 帶 actor_id）讓同一帳戶的寫入排隊再計數。
- **不能用整張表總列數**：`designer001` 的紀錄會無限成長，總列數上限遲早讓 Demo 永遠被擋。
- 一般管理員（含 `designer001`）、service role、匿名、SQL Editor 不受影響；每日還原本來就刪 Demo 的紀錄，所以額度每日重置。
- SECURITY DEFINER、`search_path` 為空（計數不能被 RLS 縮小）、API 角色全部收回 execute、尾端自我檢查、`_down.sql`。
- 緊急停用：`drop trigger if exists demo_audit_log_cap on public.audit_log;`

## 驗收標準

- Demo（拋棄式帳號）以 REST 寫入 `audit_log` 達 500 筆後，第 501 筆被拒絕（`P0001`、訊息 `DEMO_ROW_CAP: audit_log (cap 500)`），資料不變；一般管理員與 service role 不受影響。
- **每帳戶計數**：另一個帳戶的大量紀錄不影響 Demo 的額度（Demo 先前寫入 500 筆、另一個一般管理員已有數百筆時，Demo 仍只被自己的 500 筆限制；一般管理員在 Demo 滿額時照常寫入）。
- 並行：剩 S 個額度時同時送出多筆，恰好 S 筆成功。
- 多列單一 insert 額度不足時整句被拒絕，沒有部分寫入。
- off 模式（未套用 0028 或套用 `_down` 後）：Demo 超過 500 筆也能寫入；每個「生效中被擋」的斷言在 off 模式都有對應的「沒被擋」斷言。
- `reset_demo_data` 未被修改；`test:demo-reset`（dry-run）與 `test:audit-log`、`test:demo-row-caps` 回歸仍通過。
- 套用前後 `designer001` 的 `auth.users` 列與 `audit_log` 其他列不變。
- migration 可重複執行；`_down` 後行為恢復；SQL Editor 回滾式驗證腳本通過。

## 實作備註

- 刻意不為 `actor_id` 建索引：目前資料量下全表掃描可忽略，且索引會增加每次寫入的成本；若 `audit_log` 長大到數十萬列再評估。
- 拒絕路徑的成本：Demo 觸頂後每次嘗試都會做一次計數；上限 500 加上其他帳戶的紀錄，量級很小。
- 上限數字只在函式內一處（`v_cap constant integer := 500`），調整 = 改數字後整份重跑，並同步單元測試的核准值與驗證腳本。

## 驗證契約

- 單元測試：`tests/lib/demo-audit-log-cap-migration.test.ts`（檔案內容把關：上限、預篩順序、鎖在計數之前、SECURITY DEFINER、權限、不碰 `reset_demo_data`、`_down`）。
- 整合測試：`npm run test:demo-audit-cap`（拋棄式帳號；on／off 兩種模式）。
- SQL Editor：`verification/TASK-122-verify.sql`（交易回滾）。
- 型別檢查：`npx tsc --noEmit` 無錯誤
- Lint：`npm run lint` 無錯誤
- Build：`npm run build` 成功
- 螢幕截圖：不適用
- 安全性檢查：三方審查（架構、安全、測試）；JWT 來源不可被使用者改寫；函式不可被 API 角色呼叫；不影響非 Demo 路徑。

## 審查關卡

高風險：architect、security-reviewer、test-engineer 三方審查（子代理意見不等同人工核准）。

## 完成證據

- 變更的檔案：`supabase/migrations/0028_demo_audit_log_cap.sql` 與 `_down`、`tests/lib/demo-audit-log-cap-migration.test.ts`、`tests/demo-audit-log-cap.integration.test.ts`、`vitest.demo-audit-log-cap.config.ts`、`tests/lib/demo-reset-test-scan.test.ts`（只加白名單）、`package.json`、`verification/TASK-122-verify.sql`、`docs/demo-account.md`、`decisions.md`、`project-map.md`、`architecture-notes.md`。
- 執行過的指令：`npm run test:demo-audit-cap`（on／off）、`test:audit-log`、`test:demo-reset`、`test:demo-row-caps`、`test:demo-enter`、`npx vitest run tests/lib`、`npx tsc --noEmit`、`npm run lint`；SQL Editor 執行 `TASK-122-verify.sql`；回滾實測。
- 測試輸出：on 13 項、off 13 項（套用前與 `_down` 後）、回歸 28／34／16／22 項、`tests/lib` 530 項、verify 腳本真實庫 `RESULT=ALL_OK`（31 項）。完整對照見 [`verification/TASK-122.md`](../verification/TASK-122.md)。
- 螢幕截圖：不適用。
- 已知限制：Demo 觸頂後稽核列表不再更新（預期內）；額度為所有訪客共用；並行整合案例為機率性證明（鎖由 pg_locks 在真實庫決定性證明）；每筆 Demo 寫入都全表計數（約 10 萬列再評估索引）。
- 後續任務：raw_user_meta_data 未鎖（安全審查 N6，另開卡評估）；TASK-123（欄位長度 CHECK）仍是 Demo 入口前置條件。
