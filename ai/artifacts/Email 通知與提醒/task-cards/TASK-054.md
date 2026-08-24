# AI-Ready 任務卡

## Metadata

- 任務：Email 通知與提醒 預約前 24 小時提醒信（Vercel Cron）
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：Email 通知與提醒
- 上層 User Story：預約前寄送提醒信
- 分軌：後端
- 前置任務（dependsOn）：TASK-051
- 狀態：已核准（2026-08-18），待前置任務 TASK-051 完成後轉就緒
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

- 變更的檔案：待實作後填寫。
- 執行過的指令：待實作後填寫。
- 測試輸出：待實作後填寫。
- 螢幕截圖：待實作後填寫。
- 已知限制：待實作後填寫。
- 後續任務：TASK-055（整合驗證）。
