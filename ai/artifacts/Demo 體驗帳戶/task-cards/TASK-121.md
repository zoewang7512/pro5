# AI-Ready 任務卡

## Metadata

- 任務：Demo 動過的預約不再觸發提醒信（TASK-114 審查 R2）
- 上層規格：[`feature-spec.md`](../feature-spec.md)；架構筆記：[`architecture-notes.md`](../architecture-notes.md) D13；來源：[`verification/TASK-114.md`](../verification/TASK-114.md)「未關閉的殘留風險」
- 上層 Epic：Demo 體驗帳戶
- 上層 User Story：濫用防護與緊急開關
- 分軌：後端
- 前置任務（dependsOn）：TASK-114
- 狀態：已實作並通過三方審查，**0031 待使用者在 SQL Editor 套用**；套用後證據與人工驗收待補（見 [`verification/TASK-121.md`](../verification/TASK-121.md)）
- 風險等級：高（新增 `appointments` 觸發器，且牽動 Demo 還原函式的觸發器白名單）
- Agent owner：Claude Code
- 人工核准者：使用者（2026-11-02 下令動工並選定修法 A + 單一 migration 0031；最終驗收仍待使用者）

## 目標

堵住「Demo 正常改期就讓提醒排程對任意 Email 寄信」：`rescheduleAppointment` 本身會把 `reminder_sent_at` 設回 null，提醒排程（0～26 小時內、每次最多 100 筆）隔天就會對該預約的 Email 寄提醒信，內容可由 Demo 控制。TASK-114 只擋了改期信，沒擋這條路。頻率上限是每筆預約每日一封，搭配 R1（TASK-120）可放大。

## 需要使用者先決定的事（動工前）

> **已決定（2026-11-02）：選 A，且觸發器與還原函式白名單合併成單一 migration 0031。** 下表保留作歷史。未知事項的結論：還原函式最新版是 0027（白名單在其第 299–306 行）；觸發器不加 WHEN（判斷全在函式內）；「Demo 動過就不提醒」只影響 Demo 動過的預約，seed 預約本來就沒有 Email。

| 選項 | 做法 | 影響 | 備註 |
|---|---|---|---|
| **A（建議）** | 新增 `BEFORE UPDATE` 觸發器：JWT `app_metadata.is_demo` 為真時，強制 `new.reminder_sent_at = coalesce(old.reminder_sent_at, now())`（Demo 動過的預約視為已提醒） | 不影響一般管理員與 cron（沒有 Demo JWT）；Demo 的預約永遠不會被提醒排程撈到 | **必須同步處理 0024 還原函式的觸發器白名單**（見下方），否則還原會因「unknown triggers」整個失敗 |
| B | 在提醒排程查詢排除「最近由 Demo 動過」的預約 | 需要預約有 Demo 標記欄位，改動面更大 | 需新增欄位與寫入邏輯 |
| C | 接受為殘留風險 | 無 | 每筆預約每日最多一封、每日還原清除；但可被 R1 放大 |

## 重要相依：0024 的觸發器白名單

`supabase/migrations/0024_demo_reset.sql`（約第 270-287 行）會檢查被還原的表上是否有「不在白名單內的觸發器」，有就 `raise exception` 讓還原失敗，註解明寫「之後新增的觸發器要同步補進這裡」。選 A 新增觸發器後，若不更新白名單，**每日還原與手動還原都會失敗**。更新方式是新 migration 以 `create or replace` 重新定義 `reset_demo_data`（逐字沿用最新版本、只在白名單加入新觸發器名稱），這本身也是高風險改寫，要有逐字比對測試，並跑 `test:demo-reset` 回歸。

## 情境包（Context Pack）

- 相關檔案：
  - `lib/admin/appointments.ts:252`（`rescheduleAppointment` 把 `reminder_sent_at` 設回 null）
  - `lib/admin/appointment-reminders.ts`、`app/api/cron/appointment-reminders/route.ts`（排程只動 `reminder_sent_at`，不帶 Demo JWT）
  - `supabase/migrations/0015_explicit_table_grants.sql:25,103`（authenticated 可更新 `status, start_at, end_at, reminder_sent_at`）
  - `supabase/migrations/0024_demo_reset.sql`（白名單；還原是先 delete 再 insert，不發 UPDATE，不會觸發新的 `BEFORE UPDATE` 觸發器）
  - `supabase/migrations/0026_demo_suppress_update_mail.sql`（同一個 JWT 判斷式）
  - 既有 `test:demo-reset`、`test:notifications` 整合測試
- 既有模式：JWT `app_metadata.is_demo` 判斷、`create or replace`、檔頭寫明套用順序與回滾、逐字比對單元測試、SQL Editor 內以 rollback 收尾的驗證腳本（比照 `TASK-114-verify.sql`）。
- 假設：選 A。
- 未知事項：
  - 0024 目前最新版本是哪一個 migration（動工時確認）。
  - 「Demo 動過就永遠不提醒」是否影響面試官體驗展示（提醒信原本就不寄給 Demo 預約，因為 seed 預約不帶 Email）。
  - 觸發器是否限定 `when` 條件（只在 `reminder_sent_at` 相關更新時介入），以降低對其他更新的影響。
- 允許變更的檔案（選 A 的預估）：
  - `supabase/migrations/00NN_demo_reminder_guard.sql` 與 `_down.sql`（新增觸發器；檔頭加依賴檢查）
  - `supabase/migrations/00MM_demo_reset_whitelist.sql` 與 `_down.sql`（重新定義 `reset_demo_data`，白名單加入新觸發器；可與上一個合併成同一個 migration，由使用者決定）
  - 單元、整合測試與 vitest 設定、`package.json`、驗證腳本
  - `ai/context/decisions.md`
- 不得觸碰：既有 migration 檔案、`notify_appointment_*` 函式與觸發器、`app/api/cron/appointment-reminders/route.ts`。

## 需求

- 選 A：Demo JWT 的 UPDATE 不得讓 `reminder_sent_at` 從非 null 變 null，也不得讓 null 保持 null（強制為 `coalesce(old.reminder_sent_at, now())`）；沒有 Demo JWT 的呼叫者（一般管理員、cron、service role）行為不變。
- 還原函式白名單同步更新，`test:demo-reset` 與 dry-run 仍通過；新觸發器名稱要在單元測試中與白名單比對，避免日後漏補。
- 失敗方向安全：JWT 讀取例外時不得讓 Demo 的改期失敗，也不得放過（以測試確認行為並記錄）。

## 驗收標準

- 拋棄式 Demo 改期一筆有 Email 的預約後，`reminder_sent_at` 非 null，提醒排程查詢（以拋棄式資料、不寄信的方式）撈不到它。
- 一般管理員改期後 `reminder_sent_at` 仍被設回 null（行為不變）；cron 的 claim／release 行為不變。
- 還原（dry-run 與真實還原）在新觸發器存在時仍成功；`test:demo-reset` 套用前後都通過。
- `_down.sql` 後觸發器移除、還原函式與套用前逐字一致。
- 測試與驗證腳本不寄真實信件。

## 驗證契約

- 單元測試：逐字比對還原函式（只差白名單）；新觸發器名稱必須出現在白名單。
- 整合測試：新增 `test:demo-reminder-guard`；`test:demo-reset`、`test:notifications` 回歸（套用前後）。
- E2E 測試：不適用（串接於 TASK-112）。
- 型別檢查：`npx tsc --noEmit`；Lint：`npm run lint`；Build：`npm run build`
- 安全性檢查：Demo 以 `user_metadata` 或字串 claim 偽裝不得繞過；觸發器不得影響一般管理員與 cron。

## 審查關卡

架構、安全性、驗證（測試工程）；高風險，動工前須人工核准。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：
- 已知限制：
- 後續任務：
