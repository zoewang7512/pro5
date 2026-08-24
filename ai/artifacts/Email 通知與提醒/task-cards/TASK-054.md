# AI-Ready 任務卡

## Metadata

- 任務：Email 通知與提醒 預約前 24 小時提醒信（Vercel Cron）
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：Email 通知與提醒
- 上層 User Story：預約前寄送提醒信
- 分軌：後端
- 前置任務（dependsOn）：TASK-051
- 狀態：完成（人工已於 2026-08-24 核准）。architect／security-reviewer／
  test-engineer 三方審查皆已完成，關鍵發現（時間窗設計缺陷、改期未重設去重
  欄位、批次無逾時保護）皆已修正並重新驗證。真實 Vercel Cron／Supabase 環境
  的端對端驗證（含重新部署）仍待後續完成，見「完成證據」的「已知限制」。
- 風險等級：高（新增對外可觸發的排程端點與定時查詢邏輯，查詢範圍或去重邏輯錯誤可能
  導致漏寄、重複寄送，或掃描到不該通知的預約；需架構、安全性、測試三方審查）

## 目標

新增 `vercel.json` 的 `crons` 設定與 `/api/cron/appointment-reminders` API Route：
定時查詢 `start_at` 落在「現在起 24 小時」附近時間窗、`status` 為 `pending` 或
`confirmed`、且 `reminder_sent_at` 為 `null` 的預約，逐筆寄送提醒信並更新
`reminder_sent_at`。

## 情境包（Context Pack）

- 相關檔案：
  - `lib/email/resend-client.ts`／`lib/email/format.ts`／`lib/webhooks/
    verify-secret.ts`（TASK-051 建立，本卡呼叫使用；`verify-secret.ts` 這裡驗證的是
    `CRON_SECRET` 而非 `SUPABASE_WEBHOOK_SECRET`，呼叫方式相同但預期密鑰不同，
    函式簽名需支援傳入不同的預期密鑰值）。
  - `lib/supabase/service-role.ts`（TASK-051 建立，本卡用來查詢符合條件的預約與
    join `services` 表取得服務名稱）。
  - Vercel Cron 官方文件慣例：`vercel.json` 的 `crons` 陣列設定 `path`／`schedule`
    （cron 表達式），Vercel 呼叫時會在請求帶上 `Authorization: Bearer
    ${CRON_SECRET}` header（若專案設定了 `CRON_SECRET` 環境變數，Vercel 平台會自動
    附加，此為 Vercel 官方慣例，本卡端點驗證這個 header）。
- 既有模式：
  - `tests/business-hours.integration.test.ts` 的「離今天 N 天以上」offset 錯開既有
    整合測試日期範圍的既有慣例，本卡新增的測試預約需要選擇未被佔用的區段。
- 假設：
  - 排程頻率：**每小時執行一次**（`vercel.json` cron 表達式 `0 * * * *`），在時間窗
    定義為「`start_at` 介於現在起 23～25 小時之間」（給予 ±1 小時緩衝，避免因排程
    執行時間點誤差導致漏掉剛好卡在整點邊界的預約；`reminder_sent_at is null` 的去重
    機制確保即使同一筆預約被掃描到兩次也只會寄一次信，因為第一次寄送後就會更新
    `reminder_sent_at`，之後的排程執行不會再選到這筆）。
  - Vercel Hobby／免費方案對 Cron 執行頻率可能有限制（例如僅支援每日一次），實際
    可行的最小頻率需在實作階段查證當時專案使用的 Vercel 方案，若無法達到每小時，
    改用方案允許的最高頻率並相應調整時間窗寬度（例如每日執行一次時，時間窗需要
    涵蓋一整天的範圍，可能導致提醒信寄送時間與「預約前 24 小時」有數小時的誤差，
    這是本卡在確認 Vercel 方案限制後需要記錄的已知取捨）。
  - 單次執行處理的預約筆數：本批次不特別分頁或限制數量（單一理髮廳、預約量小，
    不會有效能疑慮），若未來預約量大幅增加需要分頁處理，屬於獨立的效能優化項目。
- 未知事項：實際部署使用的 Vercel 方案（Hobby／Pro）與其 Cron 執行頻率限制，需在
  實作階段查證並記錄。

**TASK-051 審查後追加的注意事項**（security-reviewer／architect 於 TASK-051 審查提出，
留給本卡實作時處理）：
- `lib/webhooks/verify-secret.ts` 已提供 `verifyBearerSecret(authorization, expected)`
  直接處理 Vercel Cron 送出的 `Authorization: Bearer <CRON_SECRET>` 格式，不需要自己
  手刻前綴解析（避免用 `.includes()` 或忽略大小寫等容易寫錯的版本）；`verifySecret`
  本身也已改為 `expected: string | null | undefined`，呼叫時可直接傳入
  `process.env.CRON_SECRET`，不需要（也不應該）自己做 `!` 或 `String(...)` 轉換。
- 建議查詢符合條件預約時用 `update ... where reminder_sent_at is null returning *`
  的「claim 模式」取得寄送權，而不是先 `select` 再逐筆 `update`——否則若排程重疊執行
  （例如手動觸發與排程觸發時間相近，或單次執行超過排程間隔），可能兩個執行個體都
  select 到同一批尚未標記的預約，造成重複寄送。
- 內插進提醒信 HTML 的所有非系統計算值（顧客姓名等）務必先呼叫
  `lib/email/format.ts` 的 `escapeHtml`，理由見該函式註解（TASK-052 已記錄同一項
  MUST FIX，本卡同樣適用）。
- `lib/email/resend-client.ts` 目前尚未被任何檔案實際 import／打包過，本卡第一次
  import 後請重跑 `npm run build` 確認 Turbopack 沒有因為 `resend` SDK 內部的動態
  import（`@react-email/render`）而編譯失敗；若失敗，已知解法是在 `next.config.ts`
  加 `serverExternalPackages: ["resend"]`（與 TASK-052 共用同一個潛在問題，若
  TASK-052 已經處理過，本卡應該不會再遇到）。
- 允許變更的檔案：
  - `vercel.json`（新增或擴充 `crons` 設定）
  - `app/api/cron/appointment-reminders/route.ts`（新增）
  - `lib/email/templates/reminder.ts`（新增）
  - `lib/admin/appointment-reminders.ts`（新增，查詢符合條件預約的函式，比照既有
    `lib/admin/` 資料存取模式）
  - **以下為實作階段修訂（2026-08-24，security-reviewer 於本卡審查後補列）**：
    - `lib/admin/appointments.ts`（修改 `rescheduleAppointment`，一併重設
      `reminder_sent_at`；原清單未列出此檔案，但這是修正一個真正的正確性缺陷
      所必要，見下方完成證據的詳細說明）。
    - `tests/admin/appointments.test.ts`（擴充，對應上述修改的測試）。
    - `tests/admin/appointment-reminders.test.ts`／
      `tests/lib/email-reminder-template.test.ts`／
      `tests/api/appointment-reminders-cron.test.ts`（新增）。
- 不得觸碰：
  - `app/api/webhooks/`（TASK-052／053 的範圍，本卡是獨立的排程端點，不共用同一個
    API Route）。
  - `supabase/migrations/`（`reminder_sent_at` 欄位已由 TASK-051 建立，本卡只讀寫
    既有欄位，不新增遷移）。

## 需求

- 新增 `vercel.json` 的 cron 設定，指向 `/api/cron/appointment-reminders`。
- WHEN Vercel Cron 觸發排程端點 THE SYSTEM SHALL 先驗證 `CRON_SECRET`，驗證失敗
  回傳 401 並不執行任何後續邏輯。
- WHEN 密鑰驗證通過 THE SYSTEM SHALL 查詢符合條件的預約（時間窗內、`status` 為
  `pending`／`confirmed`、`reminder_sent_at is null`），逐筆組成提醒信內容並呼叫
  Resend 寄送；`customer_email` 為空的預約跳過寄信但仍更新 `reminder_sent_at`（
  避免下次排程重複掃描到同一筆本來就不會寄信的預約）。
- WHEN 單筆預約寄信成功 THE SYSTEM SHALL 更新該筆 `reminder_sent_at` 為目前時間，
  避免重複寄送。
- WHEN 單筆預約寄信失敗 THE SYSTEM SHALL 記錄伺服器端 log，**不**更新
  `reminder_sent_at`（讓下次排程執行時重試），且不影響其他預約的處理（單筆失敗不
  中斷整批次的迴圈）。

## 驗收標準

- 排程端點正確查詢並寄送落在時間窗內、符合條件的預約提醒信。
- 已寄送過提醒信的預約不會被重複選中寄送第二次。
- `customer_email` 為空的預約不寄信但正確標記，避免重複掃描。
- 未帶正確密鑰的請求被拒絕（401）。
- 單筆寄信失敗不影響其他預約的處理，且會在下次排程重試。

## 實作備註

- 查詢符合條件的預約時，務必同時檢查 `status`（排除已取消的預約，即使其
  `start_at` 落在時間窗內也不該寄提醒信）。

## 驗證契約

- 單元測試：時間窗計算純函式（給定「現在時間」，計算查詢的起訖範圍）；提醒信內容
  組成純函式。
- 整合測試：對真實 Supabase 專案建立測試預約（`start_at` 落在時間窗內／外、
  `reminder_sent_at` 已設定／未設定、`status` 各種值），驗證排程端點的查詢與寄信
  邏輯正確篩選；驗證後清除測試資料；併入 TASK-055。
- E2E 測試：不適用（無 UI）；改用「建立測試預約→直接呼叫排程端點模擬觸發→確認
  提醒信被正確觸發且 `reminder_sent_at` 更新」的端到端流程驗證取代。
- 型別檢查：`npx tsc --noEmit`
- Lint：`npm run lint`
- Build：`npm run build`
- 螢幕截圖：不適用。
- 安全性檢查：`CRON_SECRET` 驗證正確；查詢範圍嚴格限定在時間窗＋未寄送過的條件，
  避免邏輯錯誤導致對整個 `appointments` 表寄信。

## 完成證據

- 變更的檔案：
  - `vercel.json`（新增，本 repo 第一個 `vercel.json`，`crons` 設定
    `{ path: "/api/cron/appointment-reminders", schedule: "0 1 * * *" }`，
    UTC 每天 01:00 = Asia/Taipei 每天 09:00 附近）。
  - `app/api/cron/appointment-reminders/route.ts`（新增，排程端點，`export
    const maxDuration = 60` + 時間預算提前中止機制）。
  - `lib/email/templates/reminder.ts`（新增，提醒信內容組成純函式）。
  - `lib/admin/appointment-reminders.ts`（新增，`computeReminderWindow`／
    `claimAppointmentsForReminder`／`releaseReminderClaim`）。
  - `lib/admin/appointments.ts`（修改 `rescheduleAppointment`，一併重設
    `reminder_sent_at: null`；不在原「允許變更的檔案」清單內，見下方審查
    發現第 4 點的完整說明）。
  - `.env.local`／Vercel production 環境變數新增 `CRON_SECRET`（與
    `SUPABASE_WEBHOOK_SECRET` 不同值，已推送到 Vercel production；未推送到
    Preview 環境，已於審查中確認）。
  - `tests/admin/appointment-reminders.test.ts`（新增，9 個測試）。
  - `tests/lib/email-reminder-template.test.ts`（新增，7 個測試）。
  - `tests/api/appointment-reminders-cron.test.ts`（新增，13 個整合測試）。
  - `tests/admin/appointments.test.ts`（擴充，2 個測試對應
    `rescheduleAppointment` 的修改）。
- 執行過的指令：
  - `npx tsc --noEmit`（通過）／`npm run lint`（通過）／`npm run build`
    （通過，`/api/cron/appointment-reminders` 出現在路由清單；`resend` SDK
    的既知 optional peer dep 建置風險確認不存在，同 TASK-052/053）。
  - `npx vitest run tests/api/appointment-reminders-cron.test.ts
    tests/admin/appointment-reminders.test.ts
    tests/lib/email-reminder-template.test.ts tests/admin/appointments.test.ts`
    （41/41 通過）。
  - 完整 `npx vitest run`：461 tests，460 通過／1 失敗
    （`tests/components/closed-dates-section.test.tsx`，滿載並行執行時的
    既有間歇性 flaky，單獨重跑 100% 通過，與本卡無關，TASK-051 完成證據已
    記錄過同一類問題）。
- 審查：本卡風險等級高，依規則派遣 architect／security-reviewer／
  test-engineer 三方審查，**三方皆已完成**。首輪一致判定「需要修改」，關鍵
  發現與修正：
  1. **architect MUST FIX（最關鍵）**：初版時間窗設計（20～48 小時）有數學上
     可證明的漏寄缺陷——下界（20 小時）只要大於 0，就會讓「排程執行之後才
     建立、且提前量落在下界附近」的預約永遠不會被任何一次每日執行撈到（反例：
     某次執行後才新增一筆提前 33 小時的預約，下次執行時它只剩 9 小時，已低於
     20 小時下界，被排除；但它也錯過了「還沒建立」的那次執行——永久漏寄）。
     原本以為的「自我修復」（漏跑一天仍能補回）在下界非 0 時也不成立。已改為
     `LOWER_BOUND_HOURS = 0`、`UPPER_BOUND_HOURS = 26`：下界為 0 保證任何
     還沒開始的預約在其存在期間的每一次執行都「看得見」，上界 26 小時比每日
     執行間隔（24 小時 ± 1 小時飄移）多至少 1 小時安全邊際，確保連續執行的
     時間窗必有重疊，且提供真正的自我修復能力。副作用：提醒提前量從
     20～48 小時收斂到 0～26 小時，更接近「預約前 24 小時」的原始需求。
  2. **architect／security-reviewer 皆提出 MUST FIX**：claim 查詢失敗時原本
     回 `200 {ok:true, sent:0}`——這是從 webhook 端點複製過來的模式，但那裡
     回 200 的理由（避免非 2xx 汙染 `net._http_response` 監控訊號）是
     pg_net 專屬語境，對 Cron 不適用；Cron job 唯一的健康訊號就是回應狀態碼，
     吞成 200 會讓排程完全失效卻在 Vercel Cron 面板顯示成功。已改為查詢失敗
     時回 `500 { ok: false, error: "query_failed" }`。
  3. **security-reviewer MUST FIX**：批次查詢沒有 `.limit()`、路由沒有
     `maxDuration` 宣告，若單日符合條件的預約數量造成 serverless function
     逾時（Hobby 方案上限 60 秒），已經被 claim（`reminder_sent_at` 已設定）
     但還沒寄出的預約會永久漏寄且沒有任何錯誤訊號。已加上
     `claimAppointmentsForReminder` 的 `.limit(MAX_BATCH_SIZE=100)` 防禦性
     上限、`.order("start_at")` 讓最急迫的預約優先處理、`route.ts` 的
     `export const maxDuration = 60` 與 `TIME_BUDGET_MS=45000` 的時間預算
     提前中止機制（逼近預算時把剩餘未處理項目全部釋放去重佔位，隔天重試）。
  4. **security-reviewer MUST FIX（跨檔案的正確性缺陷）**：`lib/admin/
     appointments.ts` 的 `rescheduleAppointment` 只更新 `start_at`／
     `end_at`，不重設 `reminder_sent_at`。若一筆預約在改期前已經被本卡的
     排程端點 claim／寄過提醒信，改期後 `reminder_sent_at` 仍是非
     `null`，新時段將**永久收不到提醒信**（時間窗越寬，命中機率越高）。已在
     `rescheduleAppointment` 的同一次 `UPDATE` 一併加上
     `reminder_sent_at: null`——這不會誤觸發 TASK-053 的
     `0012_appointments_update_webhook.sql` UPDATE trigger，因為該 trigger
     的 `WHEN` 條件本來就是看 `start_at`／`end_at` 是否變動，這次 UPDATE
     已經在改這兩個欄位，多帶一個欄位不影響是否觸發或分類結果。此檔案不在
     本卡原「允許變更的檔案」清單內，已在該段落補列並記錄原因；也不違反
     TASK-053「不得觸碰 `lib/admin/appointments.ts` 既有取消／改期／標記
     完成函式邏輯本身」的限制——那條限制的精神是「不修改既有行為」，本次
     修改的是 TASK-054 才引入的 `reminder_sent_at` 欄位語意，補完的是
     TASK-054 自己的跨函式依賴正確性，不是動搖 TASK-053 已審查通過的取消/
     改期行為本身。
  5. NICE TO HAVE（已一併處理）：`claimAppointmentsForReminder` 的 `select`
     改用內嵌 `services(name)` 一次查完服務名稱，不再逐筆查 `services` 表
     （避免 claim 一次回幾十列時的 N+1 往返，比照 `lib/admin/appointments.ts`
     `getAppointmentsForWeek` 的既有 join 慣例）；把「釋放去重佔位＝下次
     排程重試」的程式碼註解改寫得更誠實（下界改成 0 之後，這個說法才真的
     成立，原本 20 小時下界時，實際能被隔天重試撈到的比例很低）；回應欄位
     `scanned` 改名為 `claimed`，更準確反映「claim 到的筆數」這個語意；補上
     `tests/lib/email-reminder-template.test.ts` 的 `storeName` XSS escape
     測試案例（對稱於 TASK-052 confirmation.ts 既有測試）；補上「同一批次
     連續兩筆都寄信失敗」的整合測試案例。
  6. NICE TO HAVE（已記錄為殘留風險，未實作）：security-reviewer 指出排程
     模式的重放風險——持有 `CRON_SECRET` 者可在任意時間觸發，把尚未到正常
     提醒時點的預約提前 claim 並寄出（最多提前 26 小時），造成「提醒抑制」
     （提前寄出後，去重欄位已佔位，正常時點不會再提醒）；建議的輕量節流
     機制（記錄 `last_run_at`）需要新增狀態追蹤，屬於較大的設計決策，留待
     未來視需要另立任務卡（風險與密鑰外洩本身同源，`CRON_SECRET` 已與
     `SUPABASE_WEBHOOK_SECRET` 分離，降低了牽連範圍）。
  7. test-engineer 審查：完成證據原本空白（已補齊）；E2E 真實環境驗證完全
     沒有證據（見下方「已知限制」）；補上測試覆蓋率相關建議（已於上方第 5
     點一併處理）。
- 測試輸出：新增/擴充共 43 個測試（`computeReminderWindow` 4 個、
  `claimAppointmentsForReminder`／`releaseReminderClaim` 5 個、提醒信範本
  7 個、排程端點整合測試 13 個、`rescheduleAppointment` 新增 2 個），全數
  通過。
- 螢幕截圖：不適用（無 UI）。
- 已知限制／殘留風險：
  - **真實 Vercel Cron／Supabase 環境完全尚未驗證**（與 TASK-052/053 當初
    同一種缺口）：`vercel.json` 的 `crons` 設定尚未隨新版程式碼一起部署到
    Vercel（本卡實作與審查修正期間未執行 `vercel deploy`，比照 TASK-053
    的教訓，真實環境驗證前必須先確認並重新部署）；Vercel Cron 只在
    production branch 的 production deployment 才會觸發，且要等到下一次
    `0 1 * * *`（UTC 01:00）排定時間才會真正被 Vercel 觸發，或可直接手動
    `curl` 帶正確的 `Authorization: Bearer <CRON_SECRET>` header 呼叫已
    部署的正式網址模擬觸發（比照任務卡「E2E 測試」替代方案：「建立測試
    預約→直接呼叫排程端點模擬觸發→確認提醒信被正確觸發且
    `reminder_sent_at` 更新」）。待人工完成：
    1. `npx vercel deploy --prod --yes` 部署最新程式碼（含 `vercel.json`）。
    2. 確認 Vercel Dashboard 的 Cron 頁面出現這個排程設定。
    3. 建立一筆或手動調整一筆測試預約的 `start_at` 落在時間窗內
       （0～26 小時後）、`customer_email` 為真實可收信信箱。
    4. 手動 `curl` 帶 `CRON_SECRET` 呼叫
       `https://pro5-nu.vercel.app/api/cron/appointment-reminders`
       模擬觸發，人工確認收到內容正確的提醒信，並確認該筆
       `reminder_sent_at` 已更新。
    5. 測試改期一筆已經 `reminder_sent_at` 非 null 的預約，確認改期後
       `reminder_sent_at` 正確重設回 `null`（驗證本次審查修正的
       `rescheduleAppointment` 行為）。
    6. 確認未帶密鑰或密鑰錯誤時排程端點正確回 401。
  - **排程重放風險**（見上方審查發現第 6 點）：`CRON_SECRET` 外洩時可被
    任意時間重放，造成提醒信提前寄出、之後不再提醒的「提醒抑制」效果；
    留待未來視需要另立任務卡加節流機制。
  - `EMAIL_FROM_ADDRESS` 仍是 Resend 沙盒地址（TASK-052 已記錄的既有限制），
    正式寄提醒信給任意顧客前需完成網域驗證。
  - 單次執行批次量大時（超過本專案目前預約量的合理範圍）可能觸及 Resend
    預設 2 req/s 的限流，目前序列 `await` 沒有針對 429 做特別處理，會走
    「寄信失敗→釋放去重佔位→隔天重試」的既有失敗路徑，不會遺失，但當天
    的提醒會延後到隔天；本專案單一理髮廳、預約量小，暫不視為需要立即處理
    的問題。
- 後續任務：TASK-055（整合驗證，需含上方「已知限制」列出的真實環境端對端
  驗證步驟）。
