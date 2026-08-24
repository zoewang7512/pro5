# AI-Ready 任務卡

## Metadata

- 任務：Email 通知與提醒 架構基礎（Resend 薄封裝、共用密鑰驗證、reminder_sent_at 欄位、環境變數）
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：Email 通知與提醒
- 上層 User Story：預約成立寄送確認信
- 分軌：後端
- 前置任務（dependsOn）：TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006, TASK-007, TASK-008, TASK-009
- 狀態：完成（人工已於 2026-08-23 驗收通過）
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

詳見 `tools/kanban/cards/TASK-051.json` 的 `evidence` 欄位（commands／findings／residual）。
摘要：

- 變更的檔案：`supabase/migrations/0010_appointments_reminder.sql`／`_down.sql`
  （新增，`appointments.reminder_sent_at` 欄位）、`.env.example`（修改，新增
  `SUPABASE_WEBHOOK_SECRET`／`CRON_SECRET` 並補強產生方式說明）、`package.json`／
  `package-lock.json`（新增 `resend`／`server-only` 兩個依賴，皆精確鎖版）、
  `lib/supabase/service-role.ts`（新增）、`lib/webhooks/verify-secret.ts`（新增，
  含 `verifySecret`／`verifyBearerSecret`）、`lib/email/resend-client.ts`（新增）、
  `lib/email/format.ts`（新增，含 `formatAppointmentDateTime`／`escapeHtml`）、
  `tests/lib/verify-secret.test.ts`／`email-format.test.ts`／
  `email-resend-client.test.ts`／`supabase-service-role.test.ts`（新增，共 34 個
  測試）。另外把 TASK-051 審查發現中與後續任務相關的注意事項（HTML escape 要求、
  build 風險提醒、重複寄送防護建議）補進 TASK-052／053／054 的情境包，供後續實作
  參考（純文件補充，未變更這三張卡的範圍或核准狀態）。
- 執行過的指令：`npx tsc --noEmit`／`npm run lint`／`npm run build` 皆通過；
  `npx vitest run`（371 tests，含新增 34 個測試；1 個既有測試檔案
  `closed-dates-section.test.tsx` 在滿載並行執行時出現既有的間歇性 5000ms
  timeout，單獨重跑 100% 通過，與本卡改動的檔案無關，非本卡引入的回歸）。
- 審查：本卡風險等級高，依規則派遣 architect／security-reviewer／test-engineer
  三方審查。三方皆判定首輪「需要修改」，關鍵發現與修正：
  1. **security-reviewer MUST FIX（最關鍵）**：`lib/email/resend-client.ts` 的
     `html` 參數沒有配套的 escape 工具，而 `create_appointment` 對顧客姓名只檢查
     長度、不過濾字元，若後續任務卡直接內插姓名到信件 HTML，會形成 email HTML
     injection／釣魚管道。已在 `lib/email/format.ts` 新增 `escapeHtml`，並在
     `resend-client.ts` 檔頭明確要求「html 視為已信任的最終內容，非系統計算值
     必須先 escape」。
  2. **architect／security-reviewer 皆提出 MUST FIX**：`verifySecret` 原本要求
     `expected: string`，會誘導呼叫端寫出 `process.env.X!`（未設定時丟未預期的
     TypeError）或更危險的 `String(process.env.X)`（未設定時得到字面值
     `"undefined"`，攻擊者送出 header 值 `"undefined"` 就會通過驗證，等同無防護）。
     已改為 `expected: string | null | undefined`，函式內部 `if (!expected) return
     false` 統一收斂，呼叫端不需要也不應該自己轉換。
  3. **architect／security-reviewer 皆提出 MUST FIX**：`lib/supabase/
     service-role.ts`／`resend-client.ts` 原本「僅限伺服器端使用」只靠註解警告，
     沒有任何機制。已安裝 `server-only` 套件並在兩個檔案加
     `import "server-only"`，一旦被拉進 client 匯入鏈會直接建置失敗；同時修正
     `service-role.ts` 註解中兩處不精確的風險描述（`SUPABASE_SERVICE_ROLE_KEY`
     不會被打包進瀏覽器 bundle、`appointments` 對 authenticated 的 `is_admin()`
     其實有 `admin full access` policy）。
  4. **architect MUST FIX**：`package.json` 的 `resend` 依賴原用 `^6.22.0`，與
     本專案其餘 runtime 依賴一律精確鎖版的既有慣例不符，已改為 `6.22.0`。
  5. **test-engineer MUST FIX**：`lib/email/resend-client.ts` 完全沒有測試覆蓋
     （任務卡驗收標準明訂「型別與參數正確」）。已補上 mock-based 測試涵蓋缺少
     環境變數／成功路徑參數映射／API 回傳 error（確認不外洩個資）／拋出例外
     四種情境。
  6. NICE TO HAVE 已一併處理：不記錄 Resend 原始錯誤物件（可能含收件人 email，
     只記錄 `name`／`statusCode`）；新增 `verifyBearerSecret` 供 TASK-054 直接
     解析 Vercel Cron 的 `Bearer` 前綴；`resend-client.ts` 補上 10 秒逾時
     （SDK 本身無 timeout 注入點，改用 `Promise.race` 實作）；`.env.example`
     補跨平台密鑰產生指令、要求兩組密鑰不得相同、要求 ASCII-only；
     `formatAppointmentDateTime` 對無效輸入改為明確 throw 而非產生亂碼字串；
     補上週日／週六（陣列頭尾）與極長密鑰／非 ASCII 密鑰的測試案例；
     `lib/supabase/service-role.ts` 補上輕量測試。
  7. 未處理／延後：`lib/webhooks/` 目錄命名（architect 建議改名 `lib/auth/`）
     維持任務卡原核准的路徑，僅在檔頭註解補充說明涵蓋 cron；`README.md` 的
     環境變數說明表未同步（不在本卡允許變更清單內，已開背景任務卡片追蹤，
     見 residual）；重複寄送防護、build 風險驗證等已記錄為 TASK-052／053／054
     的情境包追加事項，留給該卡實作時處理。
- 測試輸出：新增 39 個單元測試（`verifySecret`／`verifyBearerSecret` 16 個、
  `formatAppointmentDateTime`／`escapeHtml` 10 個、`sendEmail` 5 個、
  `createServiceRoleClient` 3 個，另有既有 `password-strength.test.ts`／
  `aal.test.ts`／`policy-text.test.ts` 等既有 `tests/lib/` 測試不變），全數通過。
  已知限制：黑箱測試無法直接證明 `verifySecret` 的常數時間特性本身，這項安全屬性
  依賴程式碼審查（已由 architect／security-reviewer 確認實作路徑），已在
  `verify-secret.ts` 與測試檔案中明確記錄此限制。
- 螢幕截圖：不適用（無 UI）。
- 已知限制／殘留風險：
  - Resend SDK（6.22.0）未提供 per-call timeout 注入點，`resend-client.ts` 的
    逾時處理只能讓呼叫端不再等待，原始 fetch 請求可能仍在背景執行，非真正取消。
  - `lib/email/resend-client.ts`／`lib/webhooks/verify-secret.ts` 尚未被任何
    `app/api/` 端點實際 import／打包過，`npm run build` 因此還沒有真正編譯到
    這兩個模組；`resend` SDK 內部對未安裝的 optional peer dep 有動態 import，
    理論上可能在 TASK-052 第一次真正 import 後才浮現 build 問題，已記錄在
    TASK-052／054 情境包提醒屆時立即重跑 build 確認。
  - 確認信／通知信的重複寄送防護（webhook 重試導致同一事件觸發兩次）尚未設計，
    留給 TASK-052／053 的架構審查判斷是否需要新增去重欄位。
  - `README.md` 的環境變數說明表未同步更新（不在本卡允許變更清單內），已開背景
    任務卡片追蹤，非阻斷本卡完成。
  - Supabase Database Webhook 的實際建立方式（migration SQL trigger vs Dashboard
    手動設定）仍待 TASK-052 架構審查定案，本卡未預先假設。
- 後續任務：TASK-052（確認信）、TASK-053（取消/改期通知信）、TASK-054（提醒信）。
