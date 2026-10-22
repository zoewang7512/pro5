# AI-Ready 任務卡

## Metadata

- 任務：多位設計師 四種通知信顯示設計師名稱
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：多位設計師
- 上層 User Story：通知信顯示設計師
- 分軌：後端
- 前置任務（dependsOn）：TASK-068
- 狀態：已實作並驗證，待人工驗收（人工已於 2026-10-21 核准；動工前 architect／security-reviewer 審查已於 2026-10-22 完成並採納，見「動工前審查定案」）
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

## 動工前審查定案（2026-10-22，architect＋security-reviewer，**不等同人工核准**）

兩位審查結論皆為「可動工」，沒有阻斷級問題。採納項目：

- **webhook 不內嵌 `designers(name)`**：INSERT 分支 claim 是 `UPDATE … RETURNING`，內嵌失敗會讓語句失敗並提早 return，pg_net 不重試，確認信永久遺失。
  claim 與身分重讀的 select 只多取 `designer_id`；名稱以 `readDesignerName` 另查、與 `services`、店家設定並行。查詢回 `{error}` → 只記
  `appointmentId`＋錯誤訊息、省略該行、照常寄信、**不釋放 claim**；查詢 throw → 走既有 catch（INSERT 釋放 claim）。
- **cron 維持內嵌 `designers(name)`**（與 `services(name)` 慣例一致、避免 N+1）。**修正本卡原假設**：cron 的內嵌失敗等同整批 claim 失敗
  （交易回滾、不留佔位、route 回 500、隔天重撈），**不是**「省略該行」；「查不到就省略」只適用 webhook 與「內嵌回 null」。
- **攤平時防禦非字串**：`flattenDesignerName` 對物件／陣列／null／非字串一律回 `string | null`；範本以 `designerName?.trim()` 判斷，空值或全空白整行省略，
  跳脫只對原始值做一次。
- **插入位置**：確認信、提醒信放在「預約時段」之後；取消信放在「原預約時段」之後；改期信放在「新時段」之後。`reschedule.ts` 原本沒有 `.filter(Boolean)`，已補上，避免空字串在 `<ul>` 留下空行。
- **不加 `is_active` 條件**：已停用設計師的歷史預約仍要有名稱（service_role 略過 RLS，且 `designers` 未開 force RLS）。
- **前提記錄**：UPDATE 分支從資料庫重讀 `designer_id` 依賴「預約建立後不能改派設計師」（authenticated 無 `update(designer_id)` 權限）。已寫入 `route.ts` 檔頭；
  日後做改派必須改從 0012 trigger 的 payload 快照取得。
- **trigger payload 不加 `designer_id`／名稱**，維持「不整列送出」。
- 測試補強：名稱含雙引號、單引號、`&`、換行、全空白；webhook 設計師查詢回 error／throw／`designer_id` 為空；cron `designers` 物件、陣列、null、非字串四種形狀；
  整合測試加「已停用設計師」案例。

## 實作備註

- 範本不抽共用 helper：四支各自寫一行條件式，與既有 `contactLine` 寫法一致。
- 名稱可為 `www.evil.tw` 這類字串，部分信箱會自動轉成連結；輸入者是管理員、上限 30 字，風險低，列為已知限制。
- 設計師名稱只能放在 HTML 文字節點；若未來要放進主旨，須比照 `confirmation.ts` 去除 `\r\n`。

## 驗證契約

- 單元測試：四支範本各三個案例；cron 與 webhook 的資料攤平函式。
- 整合測試：`npm run test:notifications` 回歸並新增設計師名稱案例（沿用既有不實際寄信的防護）。
- E2E 測試：手動在正式流程送一筆預約，截圖收到的確認信（驗收卡 TASK-077 一併執行）。
- 型別檢查／Lint／Build：`npx tsc --noEmit`、`npm run lint`、`npm run build`
- 螢幕截圖：確認信（含設計師）。
- 安全性檢查：設計師名稱跳脫。

## 完成證據

- 變更的檔案：見 [`verification/TASK-076.md`](../verification/TASK-076.md)。
- 執行過的指令、測試輸出：見驗證報告。
- 螢幕截圖：未擷取（確認信實際收信截圖併入 TASK-077 的手動 E2E）。
- 已知限制：cron 內嵌失敗會讓整批提醒當天不寄（與 `services(name)` 相同的既有取捨）；名稱可能被信箱自動轉成連結；改派設計師功能出現時 UPDATE 分支須改讀 payload 快照。
- 後續任務：無（TASK-077 驗收）
