# AI-Ready 任務卡

## Metadata

- 任務：多位設計師 四種通知信顯示設計師名稱
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：多位設計師
- 上層 User Story：通知信顯示設計師
- 分軌：後端
- 前置任務（dependsOn）：TASK-068
- 狀態：就緒前審查中（人工已於 2026-10-21 核准；動工前先完成 architect／security-reviewer 架構審查）
- 風險等級：中（寄信端點是 Database Webhook 與 cron 觸發，錯誤會讓顧客收不到信；設計師名稱是店長輸入的內容，要跳脫）
- Agent owner：Claude Code
- 人工核准者：使用者

## 目標

確認信、提醒信、取消信、改期信都加上一行「設計師：○○」。

## 情境包（Context Pack）

- 相關檔案：
  - `lib/email/templates/confirmation.ts`、`reminder.ts`、`cancellation.ts`、`reschedule.ts`、`_layout.ts`、`lib/email/format.ts`
  - `app/api/webhooks/appointment-events/route.ts`（讀 `appointments` 後再查 `services(name)`）
  - `app/api/cron/appointment-reminders/route.ts`、`lib/admin/appointment-reminders.ts`（select 內嵌 `services(name)`）
  - `ai/artifacts/Email 通知與提醒/task-cards/TASK-051.md`（顧客姓名 HTML 跳脫的既有處理）
- 既有模式：範本是純函式，輸入型別明確，HTML 內插一律經過跳脫。
- 假設：設計師名稱查不到（理論上不會，`designer_id` 已 `not null`）時，該行省略，不讓整封信失敗。
- 未知事項：無。
- 允許變更的檔案：
  - `lib/email/templates/*.ts`（四支範本加 `designerName?: string | null`）
  - `app/api/webhooks/appointment-events/route.ts`（select 加 `designer_id`，與服務名稱並行查 `designers(name)`）
  - `app/api/cron/appointment-reminders/route.ts`、`lib/admin/appointment-reminders.ts`（select 內嵌 `designers(name)`）
  - `tests/lib/email-*-template.test.ts`、`tests/admin/appointment-reminders.test.ts`、`tests/notifications.integration.test.ts`、
    `tests/api/appointment-events-webhook.test.ts`、`tests/api/appointment-reminders-cron.test.ts`
- 不得觸碰：寄信觸發條件、`classifyAppointmentUpdate`。

## 需求

- 四支範本在服務、時間之後新增「設計師」一行，名稱經 HTML 跳脫。
- 〔審查〕若設計師名稱出現在信件主旨，比照 `lib/email/templates/confirmation.ts:30` 去除換行；資料庫另有
  `name !~ '[[:cntrl:]]'` 約束（TASK-067）。
- 〔審查〕webhook 與 cron 以 service_role 讀 `designers(name)`，依賴 TASK-067 補上的 service_role grant；整合測試要涵蓋。
- `designerName` 為空時不輸出該行。

## 驗收標準

- 四種信件的單元測試都涵蓋「有設計師」「沒有設計師」「名稱含 `<script>`」三種情況。
- 整合測試寄送路徑（不真的寄信）取得正確的設計師名稱。

## 實作備註

- 無。

## 驗證契約

- 單元測試：四支範本各三個案例；cron 與 webhook 的資料攤平函式。
- 整合測試：`npm run test:notifications` 回歸並新增設計師名稱案例（沿用既有不實際寄信的防護）。
- E2E 測試：手動在正式流程送一筆預約，截圖收到的確認信（驗收卡 TASK-077 一併執行）。
- 型別檢查／Lint／Build：`npx tsc --noEmit`、`npm run lint`、`npm run build`
- 螢幕截圖：確認信（含設計師）。
- 安全性檢查：設計師名稱跳脫。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：
- 已知限制：
- 後續任務：無
