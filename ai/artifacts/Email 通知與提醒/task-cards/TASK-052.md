# AI-Ready 任務卡

## Metadata

- 任務：Email 通知與提醒 預約成立確認信
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：Email 通知與提醒
- 上層 User Story：預約成立寄送確認信
- 分軌：後端
- 前置任務（dependsOn）：TASK-051
- 狀態：已核准（2026-08-18），待前置任務 TASK-051 完成後轉就緒
- 風險等級：高（新增對外可觸發的 webhook 端點，若密鑰驗證被繞過或 payload 驗證不足，
  可能被利用來查詢預約資料或觸發大量寄信；需架構、安全性、測試三方審查）

## 目標

新增 `/api/webhooks/appointment-events` API Route 處理 `appointments` 表的
`INSERT` 事件（webhook payload 的 `type === "INSERT"`），組成確認信內容並呼叫
TASK-051 建立的 Resend 封裝寄送；同時定案並實作 Supabase Database Webhook 的建立
方式（SQL migration 或 Dashboard 設定，由架構審查決定）。

## 情境包（Context Pack）

- 相關檔案：
  - `lib/email/resend-client.ts`／`lib/email/format.ts`／`lib/webhooks/
    verify-secret.ts`（TASK-051 建立，本卡呼叫使用）。
  - `lib/supabase/service-role.ts`（TASK-051 建立，本卡用來查詢完整的
    `appointments`／`services` 資料以組成信件內容，例如服務名稱需要 join `services`
    表）。
  - Supabase Database Webhook 的官方 payload 格式：`{ type: "INSERT" | "UPDATE" |
    "DELETE", table, record, old_record, schema }`，本卡處理 `type === "INSERT"`
    分支（`UPDATE` 分支是 TASK-053 的範圍，兩者在同一個 API Route 檔案內，依 `type`
    欄位分派到不同處理函式，互不干擾）。
- 既有模式：
  - `supabase/migrations/0002_booking_flow.sql` 的 `create_appointment` 對
    `access_token` 的既有設計（本卡**不**在確認信中使用這個 token 組連結，見
    feature-spec 非目標，本卡只需要知道這個欄位存在但不使用）。
- 假設：
  - Supabase Database Webhook 的建立方式：**採用 migration SQL 建立
    `supabase_functions.http_request` trigger**（維持本專案「一切透過 migration、
    人工貼 SQL Editor 執行」的既有慣例，不引入「Supabase Dashboard 手動設定」這種
    版控外的隱性狀態）；trigger 內呼叫的目標網址與密鑰**不得**直接寫死明文於 migration
    檔案——改用 Supabase Vault（`vault.create_secret`）或等效機制儲存密鑰，migration
    只引用密鑰名稱，實際數值由人工在套用時於 Supabase Dashboard 的 Vault 介面填入
    （比照本專案既有「敏感值只存在 .env.local／Vercel 環境變數，不進版控」的精神，
    延伸到資料庫層級的密鑰）。若 Supabase Vault 在實作階段證實不可行或過於複雜，
    改回「Dashboard 手動設定 Database Webhook」並在完成證據中詳細記錄設定步驟供人工
    覆核，兩種方式皆可接受，以實作階段的實際可行性為準，但必須避免密鑰明文進版控。
  - 確認信內容：主旨「預約確認：{服務名稱} {日期} {時間}」，內文包含服務名稱、日期
    時段、顧客姓名、店家聯絡方式（若「商店基本資料設定」Epic 已完成，可選擇性帶入
    店名；若尚未完成或讀取失敗，使用通用店名或省略，不阻擋確認信寄送）。
  - `record.customer_email` 為空字串或 `null` 時，不呼叫 Resend，函式提早 return
    成功狀態（不視為錯誤）。
- 未知事項：Supabase Vault 或等效密鑰儲存機制的實際可行性，需在實作階段驗證。
- 允許變更的檔案：
  - `app/api/webhooks/appointment-events/route.ts`（新增）
  - `lib/email/templates/confirmation.ts`（新增，確認信內容組成純函式）
  - `supabase/migrations/0011_appointments_insert_webhook.sql`（新增，若採用 SQL
    trigger 方式；若改用 Dashboard 手動設定則本檔案改為記錄設定步驟的文件，不建立
    trigger，實作階段依「未知事項」的結論決定）
  - `supabase/migrations/0011_appointments_insert_webhook_down.sql`（若適用）
- 不得觸碰：
  - `supabase/migrations/0002_booking_flow.sql`（`create_appointment` 本身不修改，
    webhook 是額外掛上去的旁路機制，不影響既有預約寫入邏輯）。
  - TASK-053 負責的 `UPDATE` 事件處理分支。

## 需求

- WHEN `appointments` 新增一筆資料列 THE SYSTEM SHALL（透過 Database Webhook）觸發
  `/api/webhooks/appointment-events` 的 `INSERT` 分支。
- WHEN 該端點收到請求 THE SYSTEM SHALL 先驗證共用密鑰，驗證失敗回傳 401 並不執行
  任何後續邏輯。
- WHEN 密鑰驗證通過且 `record.customer_email` 非空 THE SYSTEM SHALL 組成確認信內容
  並呼叫 Resend 寄送；`customer_email` 為空時跳過寄信，回傳成功狀態。
- WHEN Resend 呼叫失敗 THE SYSTEM SHALL 記錄伺服器端 log（含 `appointment id`、
  錯誤訊息，不記錄完整 email 明文），仍回傳 200 給 Supabase（避免觸發 webhook 重試
  風暴，除非是密鑰驗證失敗這類呼叫本身有問題的情況）。

## 驗收標準

- 顧客完成預約（`customer_email` 非空）後，於合理時間內收到確認信，內容正確反映
  服務與時段。
- `customer_email` 為空的預約不寄信，不產生錯誤。
- 未帶正確密鑰的請求被拒絕（401），不執行任何查詢或寄信。
- Resend 寄送失敗不影響 webhook 端點回應與既有預約流程。

## 實作備註

- Database Webhook 的實際設定方式與密鑰儲存機制，強烈建議在開始寫程式碼前先與
  architect／security-reviewer 子代理確認（見情境包「未知事項」），避免走錯方向
  重工。

## 驗證契約

- 單元測試：確認信內容組成純函式（`lib/email/templates/confirmation.ts`）。
- 整合測試：模擬 webhook 請求（正確/錯誤密鑰、`customer_email` 有無兩種情境）驗證
  端點行為；Resend 呼叫建議用測試模式 API key 或 mock，避免整合測試實際寄出大量
  真實信件。
- E2E 測試：不適用（無 UI）；改用「建立測試預約→確認 webhook 被觸發→確認 Resend
  呼叫參數正確」的端到端流程驗證取代，記錄於完成證據。
- 型別檢查：`npx tsc --noEmit`
- Lint：`npm run lint`
- Build：`npm run build`
- 螢幕截圖：不適用。
- 安全性檢查：密鑰驗證邏輯正確；webhook payload 結構驗證（避免未預期形狀導致例外）；
  密鑰儲存機制不進版控明文。

## 完成證據

- 變更的檔案：待實作後填寫。
- 執行過的指令：待實作後填寫。
- 測試輸出：待實作後填寫。
- 螢幕截圖：待實作後填寫。
- 已知限制：待實作後填寫。
- 後續任務：TASK-053（同一端點的 UPDATE 分支）、TASK-055（整合驗證）。
