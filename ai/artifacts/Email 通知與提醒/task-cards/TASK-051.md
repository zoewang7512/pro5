# AI-Ready 任務卡

## Metadata

- 任務：Email 通知與提醒 架構基礎（Resend 薄封裝、共用密鑰驗證、reminder_sent_at 欄位、環境變數）
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：Email 通知與提醒
- 上層 User Story：預約成立寄送確認信
- 分軌：後端
- 前置任務（dependsOn）：TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006, TASK-007, TASK-008, TASK-009
- 狀態：就緒（使用者於對話中核准，2026-08-18）
- 風險等級：高（首次在本專案引入第三方 Email 服務與對外可觸發端點的共用密鑰機制；密鑰
  驗證邏輯若有缺陷，後續所有 webhook／排程端點都會繼承這個安全漏洞，需架構、安全性、
  測試三方審查）

## 目標

建立本 Epic 共用的基礎設施：`appointments.reminder_sent_at` 欄位、Resend API 薄封裝
函式、webhook／排程端點共用的密鑰驗證工具函式、Email 內容組成的純函式框架（服務名稱／
時間格式化等共用邏輯）。不含任何實際觸發寄信的端點邏輯，留給 TASK-052／053／054。

## 情境包（Context Pack）

- 相關檔案：
  - `.env.example`：新增 `SUPABASE_WEBHOOK_SECRET`／`CRON_SECRET` 兩個環境變數，並把
    `EMAIL_API_KEY`／`EMAIL_FROM_ADDRESS` 的註解更新為明確對應 Resend。
  - `lib/supabase/server.ts`：既有 Supabase server client 封裝寫法可參考；本卡需要
    另外一個用 `SUPABASE_SERVICE_ROLE_KEY` 建立的 client（略過 RLS），供 webhook／
    排程端點在伺服器端使用，需確認這個 service role client **只能**在 API Route（
    伺服器端）建立，絕不可被任何 client component 匯入。
  - `supabase/migrations/0006_store_settings.sql`／`0001_core_schema.sql`：既有
    migration 的檔頭慣例（說明任務、對應回滾腳本）與 `alter table ... add column if
    not exists` 的既有寫法。
- 既有模式：
  - `Result<T>` 錯誤處理模式（`lib/booking/`／`lib/admin/` 既有慣例），本卡的 Resend
    封裝函式回傳同樣的 `Result<T>` 型別，寄送失敗回傳 `{ ok: false, error }` 而非
    throw，方便呼叫端（TASK-052/053/054）決定「記錄 log 但不影響主流程」的既有需求。
- 假設：
  - Resend 官方提供 Node.js SDK（`resend` npm 套件），本卡安裝並建立
    `lib/email/resend-client.ts` 薄封裝（讀取 `EMAIL_API_KEY`／`EMAIL_FROM_ADDRESS`）。
  - 密鑰驗證工具函式（`lib/webhooks/verify-secret.ts`）：比對請求 header 中的密鑰字串
    與環境變數是否相符，用**常數時間比較**（例如 Node.js `crypto.timingSafeEqual`）
    避免時序攻擊（timing attack）洩漏密鑰片段資訊，這是本卡在安全性審查會被檢視的
    重點。
  - Email 內容組成的共用格式化函式（例如 `lib/email/format.ts` 的
    `formatAppointmentDateTime(startAt)`），供三種信件範本共用，避免時間格式在不同
    信件中不一致。
  - Supabase Database Webhook 與 Vercel Cron 的**實際設定方式**（是否透過 migration
    SQL 建立 `supabase_functions.http_request` trigger，還是透過 Supabase Dashboard
    手動設定 webhook）留待 TASK-052／054 實作時，由架構審查決定——本卡先不建立任何
    trigger 或 `vercel.json` 設定，只準備好端點會用到的共用工具函式。
- 未知事項：Supabase Database Webhook 的建立方式（SQL migration vs Dashboard 手動
  設定）需要架構審查在 TASK-052 實作前定案，因為這牽涉到「密鑰與目標網址是否會被
  提交進版控」的安全性判斷（本專案既有慣例是 migration 需要人工貼到 SQL Editor
  執行，若 webhook 密鑰寫在 migration 檔案裡，需要額外確認該檔案不會外洩明文密鑰，
  或改用預留佔位符、由人工在套用時代換）。
- 允許變更的檔案：
  - `supabase/migrations/0010_appointments_reminder.sql`（新增；接續本次規劃的最大
    編號，實作時需先確認 `0007`～`0009` 是否已被其他 Epic 的任務卡實際套用，若編號
    衝突需調整）
  - `supabase/migrations/0010_appointments_reminder_down.sql`（新增）
  - `.env.example`
  - `package.json`（新增 `resend` 依賴）
  - `lib/email/resend-client.ts`（新增）
  - `lib/email/format.ts`（新增）
  - `lib/webhooks/verify-secret.ts`（新增）
- 不得觸碰：
  - `app/api/`（實際的 webhook／排程端點是 TASK-052／053／054 的範圍，本卡不新增任何
    API Route）。
  - `supabase/migrations/0002_booking_flow.sql`（不修改 `create_appointment` 等既有
    RPC，本卡只新增欄位）。

## 需求

- 新增 `supabase/migrations/0010_appointments_reminder.sql`：
  - `alter table public.appointments add column if not exists reminder_sent_at
    timestamptz;`
- WHEN 任何伺服器端程式碼呼叫 `lib/email/resend-client.ts` 的寄信函式並提供收件人／
  主旨／內容 THE SYSTEM SHALL 呼叫 Resend API 寄送，成功回傳 `{ ok: true }`，失敗
  回傳 `{ ok: false, error }`（不 throw）。
- WHEN 任何 API Route 呼叫 `verify-secret.ts` 的驗證函式並提供請求 header 與預期密鑰
  THE SYSTEM SHALL 用常數時間比較回傳布林結果，密鑰長度不一致或內容不符時皆回傳
  `false`。

## 驗收標準

- `appointments.reminder_sent_at` 欄位成功新增，預設為 `null`，不影響既有資料列。
- Resend SDK 已安裝，`resend-client.ts` 可用測試/開發環境的 API key 成功呼叫（或至少
  型別與參數正確，實際寄信驗證留給後續任務卡的整合測試）。
- 密鑰驗證函式對正確/錯誤/缺失密鑰皆回傳正確結果，且不透過提前 return 洩漏「密鑰長度」
  等時序資訊。
- `.env.example` 更新反映四個相關環境變數的用途說明。

## 實作備註

- `SUPABASE_SERVICE_ROLE_KEY` 的伺服器端 client 建立方式，建議獨立成
  `lib/supabase/service-role.ts`（不与既有 `lib/supabase/server.ts` 混用，避免不小心
  在錯誤情境下用了略過 RLS 的 client），並在檔案頂部加註解強調「僅限伺服器端 API
  Route 使用，絕不可被 client component 匯入」。

## 驗證契約

- 單元測試：`verify-secret.ts` 的密鑰比對邏輯（正確／錯誤／缺失／長度不同四種情境）；
  `format.ts` 的時間格式化純函式。
- 整合測試：不適用於本卡（無實際端點可測試，留給後續任務卡）。
- E2E 測試：不適用（無 UI，也無可觸發的端點）。
- 型別檢查：`npx tsc --noEmit`
- Lint：`npm run lint`
- Build：`npm run build`
- 螢幕截圖：不適用。
- 安全性檢查：密鑰比對函式使用常數時間比較，經 security-reviewer 確認無時序攻擊
  風險；`SUPABASE_SERVICE_ROLE_KEY` 的使用範圍嚴格限制在伺服器端。

## 完成證據

- 變更的檔案：待實作後填寫。
- 執行過的指令：待實作後填寫。
- 測試輸出：待實作後填寫。
- 螢幕截圖：待實作後填寫。
- 已知限制：待實作後填寫。
- 後續任務：TASK-052（確認信）、TASK-053（取消/改期通知信）、TASK-054（提醒信）。
