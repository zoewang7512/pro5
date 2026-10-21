# AI-Ready 任務卡

## Metadata

- 任務：顧客預約流程 建立預約加上人機驗證（Cloudflare Turnstile）與依 IP 限流
- 上層規格：[`feature-spec.md`](../feature-spec.md)（本卡範圍需另寫規格補充，見「未知事項」）
- 上層 Epic：顧客預約流程
- 上層 User Story：填寫聯絡資訊並確認預約
- 分軌：不適用（同時涉及資料庫權限、新的 API Route、前台表單與外部服務；實作前依「未知事項」決定是否拆卡）
- 前置任務（dependsOn）：TASK-077（多位設計師 Epic 會改寫 `create_appointment` 簽名與 `BookingFlow`，本卡排在其後，避免同時改同一條路徑）
- 狀態：**延後**（人工已於 2026-10-21 決定：MVP 不做，留在 Backlog；尚未釐清需求，不可進入就緒）
- 風險等級：高（改變顧客唯一的預約寫入路徑；引入外部服務與新的伺服器端端點；做錯會讓所有顧客無法預約）
- Agent owner：Claude Code
- 人工核准者：使用者

## 目標

讓「繞過前端、直接用 anon key 大量呼叫 `create_appointment`」的濫用無法進行。目前每支電話最多 3 筆待服務預約的上限
（`0014_create_appointment_business_hours.sql:194-203`），換電話號碼就能繞過；多位設計師上線後，可被惡意佔用的總容量
變成設計師人數倍（多位設計師 Epic 動工前 security-reviewer 審查 S4）。

## 延後決定（2026-10-21）

- 理由：本專案是面試作品，沒有真實營業的店家與顧客；預期流量低，被針對性灌單的機率低；Demo 環境會定期還原資料庫，
  假預約會被清除；既有「同電話最多 3 筆待服務預約」與資料庫 exclusion constraint 已避免雙重預約與資料錯亂。本卡要
  引入外部服務、新的伺服器端端點並收回 anon 直接呼叫，風險高、成本大於效益。
- 較實際的風險是「用別人的 email 大量預約，借本站網域寄確認信」（耗用 Resend 額度、損害寄件網域信譽）。改用低成本
  緩解：TASK-068 在 `create_appointment` 加上「同一個 email 最多 3 筆待服務預約」；Demo 環境關閉寄信（Demo 帳戶 Epic）；
  Resend 本身的每日上限是最壞情況的天花板。
- **重新啟動條件**（任一成立就回來做本卡）：有真實店家要上線使用；觀察到灌單或異常預約；Resend 寄信量異常或收到
  濫用回報。

## 背景

- 目前瀏覽器直接用 anon key 呼叫 Supabase RPC（`app/_components/booking/BookingFlow.tsx:40, 183` → `lib/booking/api.ts`），
  請求不經過 Vercel，所以 Vercel 的防火牆與任何 Next.js 中介層都攔不到。
- 要真正限流，必須讓 `create_appointment` **不能再被 anon 直接呼叫**，改成只能經過伺服器端端點。

## 情境包（Context Pack）

- 相關檔案：
  - `supabase/migrations/0014_create_appointment_business_hours.sql`（或多位設計師 Epic 之後的 `0018`）：`create_appointment` 的授權
  - `lib/booking/api.ts`（`createAppointment`）、`app/_components/booking/BookingFlow.tsx`、`ContactFormSection.tsx`
  - `lib/supabase/service-role.ts`（`import "server-only"` 的 service role client）
  - `app/api/webhooks/appointment-events/route.ts`、`lib/webhooks/verify-secret.ts`（既有 Route Handler 寫法）
  - `.env.example`（新增環境變數的登記處）
- 既有模式：Route Handler 放 `app/api/`；密鑰只放伺服器端環境變數並登記在 `.env.example`；錯誤回應不外洩原始錯誤。
- 預定做法（需求釐清後才定案）：
  1. 新增 `POST /api/bookings`：伺服器端驗證 Turnstile token（呼叫 Cloudflare siteverify）→ 依 IP 限流 → 以 service role
     呼叫 `create_appointment` → 回傳既有的 `{ ok, data | error_code }` 形狀，前端錯誤對應不變。
  2. migration：`create_appointment` 的 execute 從 anon、authenticated 收回，只留 service_role。
  3. 限流狀態存 Postgres（新表，只有 service_role 可讀寫），IP 以伺服器端密鑰做 HMAC 後才存，不存原始 IP；不引入新的
     付費服務（Upstash／Vercel KV）。
  4. 前台聯絡表單加入 Turnstile widget，送出時帶 token。
- 未知事項（開工前必須先走 `spec-interrogation`，以下是阻擋性問題）：
  - **限流門檻**：例如同一 IP 每小時最多幾次「建立預約」嘗試、每天最多幾筆成功預約？被擋時顧客看到什麼文案？
  - **Turnstile 模式**：隱形（大部分人無感）或顯示勾選框？顯示的話屬於 UI 變更，要走 `ui-mockup-gate`。
  - **Cloudflare 帳號**：需要由使用者本人建立 Cloudflare 帳號並產生 site key／secret key，再設定到 Vercel 環境變數
    （Agent 不能代為建立帳號或輸入金鑰）。
  - **`get_available_slots` 要不要一起限流**：它同樣可被 anon 無限呼叫（可用來推算各設計師排程，多位設計師 Epic
    已列為已接受殘留）。預設不在本卡範圍。
  - **本機開發與整合測試**：Turnstile 提供測試用金鑰；整合測試改打 `/api/bookings` 或直接用 service role 呼叫 RPC，
    要一起決定。
  - **部署順序**：收回 anon execute 的 migration 必須在新前端部署**之後**才套用，否則舊前端會無法預約。
- 允許變更的檔案：需求釐清後於本卡補齊。
- 不得觸碰：`create_appointment` 函式本體的商業邏輯（只改授權）；其他 RPC。

## 需求

- 待 `spec-interrogation` 完成後補齊。

## 驗收標準

- 待需求釐清後補齊。至少包含：anon 直接呼叫 `create_appointment` 回 42501；沒有有效 Turnstile token 的請求被拒；
  超過門檻的 IP 被拒並顯示友善文案；一般顧客的正常預約流程不受影響；資料庫內不存原始 IP。

## 實作備註

- 無。

## 驗證契約

- 單元測試：Turnstile 驗證函式（成功／失敗／逾時）、限流計算、IP HMAC。
- 整合測試：anon 直接呼叫被拒；`/api/bookings` 正常建立預約；超過門檻被拒。
- E2E 測試：Browser 走查前台完整預約（含 Turnstile）。
- 型別檢查：`npx tsc --noEmit`
- Lint：`npm run lint`
- Build：`npm run build`
- 螢幕截圖：聯絡表單（含 Turnstile）、被限流時的錯誤畫面。
- 安全性檢查：architect＋security-reviewer＋test-engineer 三方審查；確認 service role 只在伺服器端使用、IP 不以明文儲存、
  `x-forwarded-for` 的取值方式在 Vercel 上不可被偽造。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：
- 已知限制：
- 後續任務：
