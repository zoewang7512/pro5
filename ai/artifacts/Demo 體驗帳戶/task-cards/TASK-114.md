# AI-Ready 任務卡

## Metadata

- 任務：Demo 發動的改期／取消不寄信（改寫 notify_appointment_update，migration）
- 上層規格：[`feature-spec.md`](../feature-spec.md)；架構筆記：[`architecture-notes.md`](../architecture-notes.md)
- 上層 Epic：Demo 體驗帳戶
- 上層 User Story：濫用防護與緊急開關
- 分軌：後端
- 前置任務（dependsOn）：TASK-097
- 狀態：草稿（待人工核准）
- 風險等級：高
- Agent owner：Claude Code
- 人工核准者：待使用者核准

## 目標

堵住「以 Demo 帳戶反覆改期，藉你的寄件網域對任意 Email 發信」的濫用：由 Demo 帳戶發動的預約改期與取消，不再呼叫通知 webhook（不寄信）。面試官自己預約的確認信維持照寄。**這是對既有函式的改寫，不是純加法，因此列為高風險。**

## 情境包（Context Pack）

- 相關檔案：
  - `supabase/migrations/0012_appointments_update_webhook.sql`（原函式本文與觸發器，逐字沿用）
  - `supabase/migrations/0011_appointments_insert_webhook.sql`（確認信，不得修改）
  - `app/api/webhooks/appointment-events/route.ts`（只讀，不修改）
  - 既有 `test:notifications` 整合測試（拋棄式資料與 webhook 驗證寫法）
  - `ai/artifacts/Demo 體驗帳戶/architecture-notes.md` D13
- 既有模式：`create or replace function` 沿用 `0012` 的本文；檔頭寫明套用順序、回滾與「只新增守門、其餘逐字不變」。
- 假設：
  - Demo 以 JWT 的 `app_metadata.is_demo` 判斷，不碰 `auth` schema（與 TASK-113 同一做法）。
  - cron、service role、顧客前台請求沒有 Demo JWT，行為不變。
  - `reminder_sent_at` 被清成 null 造成提醒信重寄的風險維持為殘留風險（每日排程限制頻率）。
- 未知事項：
  - 在 `security definer`、`search_path = ''` 的觸發器函式內，`auth.jwt()` 是否讀得到發動該次 UPDATE 的請求 JWT（理論上可行，需以拋棄式帳號實測）。
  - 如何在整合測試中確認「webhook 沒有被送出」（`net` 請求佇列或回應表的查法；以既有 `test:notifications` 的做法為準）。
- 允許變更的檔案：
  - `supabase/migrations/00NN_demo_suppress_update_mail.sql` 與 `_down.sql`（新增；編號以動工當時的最大編號為準，檔頭加依賴檢查）
  - `tests/demo-mail-suppress.integration.test.ts`、`vitest.demo-mail-suppress.config.ts`（新增）
  - `package.json`（新增 `test:demo-mail-suppress`）
  - `ai/context/decisions.md`
- 不得觸碰：
  - `0011`、`0012` 與所有既有 migration 檔案
  - `notify_appointment_insert` 與其觸發器
  - `app/api/webhooks/appointment-events/route.ts`
  - 觸發器 `appointments_notify_update` 的 `when` 條件

## 需求

- `create or replace function public.notify_appointment_update()`：本文與 `0012` 逐字相同，**只在函式一開始加入守門**——`coalesce(auth.jwt() -> 'app_metadata' ->> 'is_demo', '') = 'true'` 時 `return new`，不讀 Vault、不呼叫 `net.http_post`。
- 觸發器 `appointments_notify_update` 不重建、不改條件。
- `_down.sql`：把函式還原成 `0012` 的原本文（逐字）。
- 檔頭註明：套用順序（可在任何時間套用，與應用程式部署順序無關）、回滾、以及「只擋 UPDATE；確認信不動」。

## 驗收標準

- 拋棄式 Demo 帳號（`app_metadata.is_demo = true`）改期與取消一筆有 Email 的預約：**沒有任何 webhook 請求被送出**。
- 拋棄式非 Demo 管理員做同樣操作：webhook 照常送出（與套用前一致）。
- service role 與顧客端取消（若有）行為不變。
- Demo 帳號建立預約（確認信路徑）不受影響。
- 預約資料本身的改期與取消對 Demo 仍然成功（只是不寄信）。
- `_down.sql` 後函式與 `0012` 逐字一致；既有 `test:notifications` 在套用前後都通過。

## 實作備註

- 若 `auth.jwt()` 在觸發器內讀不到請求 JWT，整張卡回報並改用 `current_setting('request.jwt.claims', true)` 方案；兩者都不可行時停止並回報，由使用者決定是否改選 B 或 C。
- 測試結尾清除拋棄式資料與帳號（`__TEST__` 前綴）。

## 驗證契約

- 單元測試：不適用。
- 整合測試：`npm run test:demo-mail-suppress`；`npm run test:notifications` 回歸。
- E2E 測試：不適用（串接於 TASK-112）。
- 型別檢查：`npx tsc --noEmit` 無錯誤
- Lint：`npm run lint` 無錯誤
- Build：`npm run build` 成功
- 螢幕截圖：不適用。
- 安全性檢查：守門條件來自 JWT 而非可被使用者竄改的欄位；只多一道早退；其餘邏輯與 `0012` 逐字相同（以 diff 證明）；不影響確認信。

## 審查關卡

架構、安全性、驗證（測試工程）；高風險，動工前須人工核准。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：
- 已知限制：
- 後續任務：
