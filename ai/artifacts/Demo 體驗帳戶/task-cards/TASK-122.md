# AI-Ready 任務卡

## Metadata

- 任務：Demo 的 audit_log 每帳戶筆數上限
- 上層規格：[`feature-spec.md`](../feature-spec.md)；來源：[`verification/TASK-116.md`](../verification/TASK-116.md)（三方審查）
- 上層 Epic：Demo 體驗帳戶
- 上層 User Story：濫用防護與緊急開關
- 分軌：後端
- 前置任務（dependsOn）：TASK-116
- 狀態：草稿（**待使用者核准數字與動工**）；**Demo 入口開放前必須完成（TASK-112 的前置條件）**
- 風險等級：高（migration）
- Agent owner：Claude Code
- 人工核准者：待使用者核准

## 目標

Demo 可直接透過 REST 對 `audit_log` insert（`authenticated` 有欄位層級 insert 授權，policy 只看 `is_admin()`），每筆 summary／changes 各最多 4 KB，沒有筆數上限；約 10 萬筆即超過免費方案 500 MB。`actor_id` 不可由使用者指定（只能走預設 `auth.uid()`），所以每日還原清得掉，缺口在「一天之內」。

## 需求（草稿）

- `audit_log` 的 `BEFORE INSERT` 觸發器：只在 Demo JWT 時，以 `new.actor_id` 計數該帳戶的列數，達上限（建議 500，待核准）以 `P0001`／`DEMO_ROW_CAP` 拒絕；以 `pg_advisory_xact_lock`（key 帶 actor_id）做硬上限。
- **不能用整張表總列數**：`designer001` 的紀錄會無限成長，總列數上限遲早讓 Demo 永遠被擋。
- 一般管理員（含 `designer001`）與 service role 不受影響；每日還原本來就刪 Demo 的紀錄。
- 沿用 `demo_row_cap_guard()` 還是新函式由動工時決定（計數條件不同）。

## 注意

- 若新增觸發器的表在 `reset_demo_data` 的覆寫範圍內，必須同步更新最新那份 `reset_demo_data` 的觸發器白名單（`tests/lib/demo-row-caps-migration.test.ts` 的全域不變量會在漏補時失敗）。
- 沿用 0027 的做法：預篩 claims 字串、SECURITY DEFINER、search_path 為空、API 角色不可執行、尾端自我檢查、`_down.sql`、SQL Editor 回滾式驗證腳本、整合測試 on／off 兩種模式。

## 允許變更的檔案（預估）

- `supabase/migrations/00NN_demo_audit_log_cap.sql` 與 `_down.sql`
- 單元／整合測試、vitest 設定、`package.json`、驗證腳本
- `ai/context/decisions.md`

## 驗證契約（草稿）

- 單元測試、整合測試（拋棄式帳號）、`test:demo-reset` 與既有回歸、`npx tsc --noEmit`、`npm run lint`、`npm run build`。
- 動工前補完整驗收標準。

## 完成證據

（待填）
