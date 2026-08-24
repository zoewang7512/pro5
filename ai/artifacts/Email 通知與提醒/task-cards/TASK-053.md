# AI-Ready 任務卡

## Metadata

- 任務：Email 通知與提醒 取消／改期時寄送通知信
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：Email 通知與提醒
- 上層 User Story：取消／改期時寄送通知信
- 分軌：後端
- 前置任務（dependsOn）：TASK-051
- 狀態：已核准（2026-08-18），待前置任務 TASK-051 完成後轉就緒
- 風險等級：高（同一 webhook 端點的另一分支，需正確區分「取消」與「改期」兩種
  `UPDATE` 情境並各自寄送對應內容，判斷邏輯錯誤可能寄出錯誤的通知信誤導顧客；需
  架構、安全性、測試三方審查）

## 目標

在 `/api/webhooks/appointment-events`（TASK-052 建立）新增處理 `UPDATE` 事件的分支：
比對 `old_record` 與 `record` 判斷這次異動是取消（`status` 變為 `cancelled`）還是
改期（`start_at`／`end_at` 變更），寄送對應的通知信。

## 情境包（Context Pack）

- 相關檔案：
  - `app/api/webhooks/appointment-events/route.ts`（TASK-052 建立，本卡新增 `type
    === "UPDATE"` 的處理分支，與 `INSERT` 分支各自獨立的處理函式，不共用可變狀態）。
  - `lib/admin/appointments.ts`：既有 `markAppointmentCompleted`／`cancelAppointment`／
    `rescheduleAppointment` 的既有寫法，確認這些既有函式對 `appointments` 的
    `update` 操作會正確觸發 Database Webhook 的 `UPDATE` 事件（Supabase Database
    Webhook 對任何 `update` 語句皆會觸發，不論是透過這幾支既有函式或未來「顧客自助
    查詢／取消預約」Epic 的新函式）。
- 既有模式：
  - `lib/email/format.ts`（TASK-051）的時間格式化函式，本卡的改期通知信需要同時
    顯示「原時段」與「新時段」，用 `old_record.start_at` 與 `record.start_at` 分別
    格式化。
- 假設：
  - 判斷邏輯：`old_record.status !== 'cancelled' && record.status === 'cancelled'`
    → 觸發取消通知信；`record.status !== 'cancelled' && (old_record.start_at !==
    record.start_at || old_record.end_at !== record.end_at)` → 觸發改期通知信；
    兩個條件互斥（取消的預約不會同時被視為改期，即使改期又取消也只會在各自的
    `update` 呼叫觸發當下事件各自判斷，不會有同一次 `UPDATE` 事件同時滿足兩個條件的
    情況，因為現有 `cancelAppointment`／`rescheduleAppointment` 是各自獨立的
    `update` 呼叫）。
  - `markAppointmentCompleted`（標記完成）的 `UPDATE` 事件**不**觸發任何通知信（不
    在本 Epic 三個 User Story 範圍內，需在判斷邏輯中明確排除，避免誤寄）。
  - 取消通知信主旨「預約已取消：{原服務名稱} {原日期} {原時間}」；改期通知信主旨
    「預約已改期：{新日期} {新時間}」，內文包含原時段與新時段對照。
- 未知事項：無（Database Webhook 的建立方式已於 TASK-052 定案，本卡沿用同一個
  trigger／設定，不需要重新設定）。

**TASK-051 審查後追加的注意事項**：與 TASK-052 相同，取消／改期通知信內插的顧客
姓名等使用者輸入務必先呼叫 `lib/email/format.ts` 的 `escapeHtml`（email HTML
injection 防護，見 TASK-052 情境包同一項 MUST FIX 的完整說明）。

**TASK-052 審查後追加的注意事項**（architect／security-reviewer 於 TASK-052 審查
提出，留給本卡實作時處理）：
- **payload 設計無法直接沿用 TASK-052 的「只送 id」模式**：TASK-052 的 `INSERT`
  trigger 只送 `record: {id}`，route 端用 service role client 依 id 回讀資料庫
  最新值組信——這是為了避免把 `access_token` 等整列個資送到 webhook 目標網址
  （見 `supabase/migrations/0011_appointments_insert_webhook.sql` 的說明）。但
  `UPDATE` 事件的分類邏輯（取消 vs 改期，見上方「假設」段落）需要比對
  `old_record` 與 `record` 的 `status`／`start_at`／`end_at`，而 `old_record`
  在 `UPDATE` 語句執行後**無法從資料庫回讀**（資料庫此時只剩新值）。因此本卡的
  `UPDATE` trigger 必須讓 payload 至少帶上分類所需的欄位（例如
  `old_record: {status, start_at, end_at}`、`record: {id, status, start_at,
  end_at}`），不能只送 `id`；建議白名單到剛好夠分類與組信用的欄位（例如額外加
  `customer_name`／`customer_email`，但**不要**用 `to_jsonb(old)`／`to_jsonb(new)`
  整列送出，避免重蹈 `access_token` 外洩的問題）。
- **確認信去重的 `UPDATE` 本身會再觸發一次本卡的 trigger，需要 `when` 子句排除**：
  TASK-052 的 route handler 為了去重會對 `appointments` 執行一次
  `update ... set confirmation_sent_at = ...`，這個 `UPDATE` 也會經過既有的
  `appointments_set_updated_at` trigger（`0001_core_schema.sql`）動到
  `updated_at`，並且會被本卡新增的 `UPDATE` trigger 攔到。本卡的 trigger 建立時
  務必加 `when (old.status is distinct from new.status or old.start_at is
  distinct from new.start_at or old.end_at is distinct from new.end_at)`
  這類條件，只在真正的取消／改期時才觸發，避免確認信去重寫入或未來
  `reminder_sent_at`／本卡自己的去重欄位寫入被誤判成一次新的預約異動而寄出錯誤的
  通知信或造成不必要的 webhook 負載。
- **pg_net 不會重試**：與 TASK-052 相同的既知限制（見 0011 migration 檔頭），本卡
  的去重／補償設計需要延續 TASK-052 route.ts 的「claim 失敗就釋放佔位供後續補寄」
  模式，不能假設 Supabase 或 pg_net 會自動重送失敗的 webhook 請求。
- 允許變更的檔案：
  - `app/api/webhooks/appointment-events/route.ts`
  - `lib/email/templates/cancellation.ts`（新增）
  - `lib/email/templates/reschedule.ts`（新增）
  - `tests/lib/email-templates.test.ts`（新增或擴充）
- 不得觸碰：
  - TASK-052 負責的 `INSERT` 分支處理函式。
  - `lib/admin/appointments.ts` 既有的取消／改期／標記完成函式邏輯本身（本卡只是
    在這些操作觸發的 `UPDATE` 事件上掛外掛式的通知信邏輯，不修改這些函式的既有
    行為）。

## 需求

- WHEN `appointments.status` 由非 `cancelled` 變更為 `cancelled` THE SYSTEM SHALL
  觸發取消通知信寄送流程；`record.customer_email` 非空時寄送，內容包含原服務與時段。
- WHEN `appointments.start_at`／`end_at` 變更且變更後 `status` 非 `cancelled`
  THE SYSTEM SHALL 觸發改期通知信寄送流程；`record.customer_email` 非空時寄送，
  內容包含原時段與新時段對照。
- WHEN `UPDATE` 事件不符合上述兩種情境（例如僅 `status` 變為 `completed`，或
  `updated_at` 因既有 trigger 自動更新但無實質欄位變更） THE SYSTEM SHALL 不寄送
  任何信件。

## 驗收標準

- 預約被取消（`customer_email` 非空）後，收到取消通知信，內容正確。
- 預約被改期（`customer_email` 非空）後，收到改期通知信，內容包含新時段。
- 標記完成的 `UPDATE` 事件不觸發任何通知信。
- `customer_email` 為空的預約，取消/改期皆不寄信，不產生錯誤。

## 實作備註

- 判斷邏輯建議抽成獨立的純函式（例如
  `classifyAppointmentUpdate(oldRecord, record): "cancelled" | "rescheduled" |
  "none"`），方便單元測試涵蓋所有欄位變化組合，不要把判斷邏輯直接寫在 API Route
  handler 裡難以測試。

## 驗證契約

- 單元測試：`classifyAppointmentUpdate` 純函式（涵蓋取消／改期／標記完成／無實質
  變更等各種組合）；取消/改期信件內容組成純函式。
- 整合測試：模擬 `UPDATE` webhook 請求（取消／改期／標記完成三種情境）驗證端點
  正確分派、正確寄信或不寄信；併入 TASK-055。
- E2E 測試：不適用（無 UI）；改用「後台取消/改期一筆測試預約→確認對應通知信被
  正確觸發」的端到端流程驗證取代。
- 型別檢查：`npx tsc --noEmit`
- Lint：`npm run lint`
- Build：`npm run build`
- 螢幕截圖：不適用。
- 安全性檢查：沿用 TASK-052 已建立的密鑰驗證，本卡不重新設計驗證機制。

## 完成證據

- 變更的檔案：待實作後填寫。
- 執行過的指令：待實作後填寫。
- 測試輸出：待實作後填寫。
- 螢幕截圖：待實作後填寫。
- 已知限制：待實作後填寫。
- 後續任務：TASK-055（整合驗證）。
