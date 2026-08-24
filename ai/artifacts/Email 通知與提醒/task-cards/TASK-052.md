# AI-Ready 任務卡

## Metadata

- 任務：Email 通知與提醒 預約成立確認信
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：Email 通知與提醒
- 上層 User Story：預約成立寄送確認信
- 分軌：後端
- 前置任務（dependsOn）：TASK-051
- 狀態：完成（人工已於 2026-08-24 驗收通過）。真實 Supabase 環境的端對端驗證
  （migration 套用、Vault 密鑰建立、`EMAIL_FROM_ADDRESS` 設定、實際測試預約收信）
  仍待人工後續完成，見「完成證據」的「已知限制／殘留風險」段落。
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

**TASK-051 審查後追加的注意事項**（security-reviewer／architect 於 TASK-051 審查提出，
留給本卡實作時處理）：
- **必須**對內插進 email HTML 的所有非系統計算值（顧客姓名、備註等使用者輸入）呼叫
  `lib/email/format.ts` 的 `escapeHtml`——`create_appointment` 對 `customer_name`
  只檢查長度 ≤ 50、不過濾字元，未跳脫直接內插會形成 email HTML injection／釣魚管道
  （MUST FIX 等級）。
- `lib/email/resend-client.ts` 目前完全沒有被任何檔案實際 import／打包過；`resend`
  SDK 內部對 `@react-email/render`（未安裝的 optional peer dep）有動態 import，
  理論上可能在 Turbopack 真正編譯到這個模組時才會浮現 build 問題。本卡第一次 import
  `resend-client.ts` 後請立刻重跑 `npm run build` 確認；若失敗，已知解法是在
  `next.config.ts` 加 `serverExternalPackages: ["resend"]`。
- 重複寄送防護：確認信目前沒有任何去重欄位（`booking_policy` Epic 的
  `reminder_sent_at` 只保護提醒信／TASK-054）。若 Supabase Database Webhook 因網路
  重試等原因對同一筆 `INSERT` 觸發兩次，會寄出兩封確認信。是否需要新增
  `confirmation_sent_at` 欄位（可能需要 `0011` migration）做去重，或評估「重複寄送
  確認信」的實際影響可接受，留給本卡的架構審查判斷。
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

- 變更的檔案：
  - `app/api/webhooks/appointment-events/route.ts`（新增，本專案第一支 API
    Route）。
  - `lib/email/templates/confirmation.ts`（新增，確認信內容組成純函式）。
  - `supabase/migrations/0011_appointments_insert_webhook.sql`／`_down.sql`
    （新增：`appointments.confirmation_sent_at` 欄位、`pg_net` extension、
    `notify_appointment_insert()` trigger function 與 trigger）。
  - `tests/api/appointment-events-webhook.test.ts`（新增，16 個測試）、
    `tests/lib/email-confirmation-template.test.ts`（新增，8 個測試）。
  - `ai/artifacts/Email 通知與提醒/task-cards/TASK-053.md`（修改，補充下一張卡
    的情境包，見下方「後續任務」）。
- 執行過的指令：
  - `npx tsc --noEmit`（通過）／`npm run lint`（通過）／`npm run build`（通過，
    `/api/webhooks/appointment-events` 出現在路由清單；確認 TASK-051 遺留的
    resend SDK optional peer dep 建置風險**不存在**，不需要
    `serverExternalPackages`）。
  - `npx vitest run tests/api/appointment-events-webhook.test.ts
    tests/lib/email-confirmation-template.test.ts`（24/24 通過）。
  - `npx vitest run`（完整套件 395 tests：390 通過／5 失敗，失敗集中在
    `tests/components/account-settings-view.test.tsx`（2 個）與
    `tests/components/login-form.test.tsx`（3 個），單獨重跑 100% 通過，屬既有
    「滿載並行執行間歇性逾時/輸入競態」的已知問題（與 TASK-051 記錄的
    `closed-dates-section.test.tsx` 同一類），與本卡變更無關，非本卡引入的
    回歸）。
- 審查：本卡風險等級高，依規則派遣 architect／security-reviewer／test-engineer
  三方審查。三方首輪皆判定「需要修改」，關鍵發現與修正：
  1. **三方一致提出的最關鍵 MUST FIX**：`notify_appointment_insert()` trigger
     原本沒有例外處理，掛在 `appointments` 的 `AFTER INSERT`（`create_appointment`
     RPC 的寫入路徑）上，任何非預期例外（Vault 權限問題、`net.http_post` 解析
     失敗等）都會讓「寄確認信」這個附加動作使顧客的預約整筆回滾，直接違反任務卡
     「webhook 是旁路機制，不影響既有預約寫入邏輯」的設計意圖——已加
     `exception when others then raise warning ...; return new;` 包住整段
     trigger body。
  2. **architect／security-reviewer MUST FIX**：原本用 `to_jsonb(new)` 把整列
     （含 `access_token` 這個顧客自助查詢用的 capability token、`customer_phone`
     等個資）送到 webhook 目標網址——已改成 payload 只帶 `{id}`，`route.ts` 用
     service role client 依 id 原子性地 claim＋回讀資料庫最新的
     `customer_name`／`customer_email`／`start_at`／`service_id`，完全不信任
     payload 攜帶的其他欄位內容。
  3. **architect／security-reviewer MUST FIX**：去重佔位
     （`confirmation_sent_at`）搶到後，若組信/查詢/寄信任一步驟失敗或拋出例外，
     原本沒有任何補償，而 **`pg_net` 實際上不會重試**（原始程式碼註解誤寫「避免
     觸發 webhook 重試風暴」，該理由對自建的 `pg_net` trigger 不成立）——已在
     `sendEmail` 失敗或例外時把 `confirmation_sent_at` 補償釋放回 `null`，供
     未來人工/排程補寄機制重新處理；同時修正相關程式碼註解與 migration 檔頭，
     明確記錄「`pg_net` 不會重試」與正確的部署順序（先部署帶密鑰的應用程式 →
     套用 migration → 最後才建立 Vault 密鑰，順序錯誤會有空窗期遺失確認信）。
  4. **test-engineer MUST FIX**：完成證據與看板卡片原本完全空白——本次已補齊
     （即本節內容）。
  5. NICE TO HAVE 已一併處理：改用既有 `lib/store-settings.ts` 的
     `getStoreSettings`，移除重複的 `store_settings` 查詢與型別 cast；trigger
     加 `revoke execute ... from public`；trigger 加
     `when (new.customer_email is not null)` 減少無謂觸發；`net.http_post` 的
     `timeout_milliseconds` 從 5000 調到 15000（避免監控訊號因逾時誤判）；
     email 主旨剝除換行字元防 header injection；webhook payload 的 `id` 加
     UUID 格式驗證。
  6. 已將與 TASK-053 相關的審查發現（TASK-052 的「payload 只送 id」模式無法
     直接沿用到 `UPDATE` 分支——`old_record` 事後無法從資料庫回讀；需要 `when`
     子句避免確認信去重的 `UPDATE` 被誤判成一次新的預約異動；`pg_net` 不重試的
     既有限制）補進 TASK-053 情境包，供該卡實作時參考。
- 測試輸出：新增 24 個測試（webhook 端點 16 個：密鑰驗證 3 種失敗態、
  payload 驗證、去重命中/未命中/查詢失敗、Resend 成功/失敗與補償釋放、例外與
  補償釋放、非 appointments 事件、UPDATE type no-op 等；確認信範本 8 個：主旨
  格式、HTML injection 防護、店名/電話可選欄位組合），全數通過。
- 螢幕截圖：不適用（無 UI）。
- 已知限制／殘留風險：
  - ~~真實 Supabase 環境尚未驗證~~ **已於 2026-08-24 由人工完成端對端驗證**：
    1. 部署正式應用程式到 Vercel（`https://pro5-nu.vercel.app`），帶正確的
       `SUPABASE_WEBHOOK_SECRET`／`EMAIL_API_KEY`／`SUPABASE_SERVICE_ROLE_KEY`
       等環境變數（`NEXT_PUBLIC_*` 系列用 `--visibility config --no-sensitive`
       加入，其餘用預設 sensitive）。部署過程中發現 `vercel link` 會在
       `.gitignore` 底部多加一行重複的 `.env*`，已清理避免與既有
       `.env.* / !.env.example` 規則衝突。
    2. 套用 `0011_appointments_insert_webhook.sql` 到正式 Supabase 專案時，第一次
       貼上執行遇到 `syntax error at or near "for"`：`create trigger` 的
       `WHEN (condition)` 子句寫在 `FOR EACH ROW` 之前，順序寫反了（PostgreSQL
       規定 `FOR EACH ROW` 須在 `WHEN` 之前）。已修正檔案順序並在該處補上註解
       記錄這個踩過的坑；確認語法錯誤發生時整段 `begin;...commit;` 交易正確
       回滾、沒有殘留任何部分套用的狀態，重新執行後套用成功
       （`confirmation_sent_at` 欄位確認存在）。
    3. 在 Supabase Dashboard SQL Editor 執行 `vault.create_secret(...)` 建立
       `appointment_webhook_url`（正式部署網址）／`appointment_webhook_secret`
       （與 `SUPABASE_WEBHOOK_SECRET` 一致）。第一次執行時 `appointment_webhook_url`
       撞到 `duplicate key value violates unique constraint "secrets_name_idx"`
       （批次重跑導致），排查後確認兩筆密鑰其實都已成功建立；額外用一段只回傳
       `true/false`（不外洩密鑰內容）的比對查詢確認兩個密鑰的值與預期完全相符。
    4. `EMAIL_FROM_ADDRESS` 最初仍留空（尚未驗證正式寄件網域），第一次真實測試
       預約因此在 Vercel log 出現 `sendEmail: 缺少 EMAIL_API_KEY 或
       EMAIL_FROM_ADDRESS 環境變數設定`（`MISSING_CONFIG`）——這正確證明了整條
       管線（trigger → Vault → pg_net → 正式環境 → 密鑰驗證 → 去重佔位 → 寄信
       失敗優雅處理並釋放佔位 → 回 200）完全照設計運作，只差寄件地址未設定。
       改用 Resend 沙盒寄件地址 `onboarding@resend.dev`（僅能寄給 Resend 帳號
       本人註冊信箱，正式上線前仍需驗證自己的網域）補上後重新部署。
    5. `npm run test:booking`（真實 Supabase 專案）23/23 通過，確認新 trigger 不
       影響既有預約流程；並用 `net._http_response` 確認測試流程中唯一一筆帶
       `customer_email` 的預約正確觸發 webhook（`status_code = 200`），其餘無
       email 的測試預約被 `when (customer_email is not null)` 正確過濾、未觸發。
    6. 用真實可收信 email 建立一筆測試預約（服務：京喚羽，2026-08-26 13:30），
       **人工確認收到確認信**，Vercel log 顯示成功（無 `MISSING_CONFIG` 或其他
       error log）。至此「顧客完成預約後收到確認信」這條驗收標準完整驗證通過。
    - 使用者對收到的確認信內容回饋：「格式有點簡陋」，希望之後加上店家 Logo
      圖片與結尾簽章——這是視覺/內容優化，不在本卡原核准範圍內，已記錄為後續
      待辦（見下方「後續任務」），需要另外走 UI/內容變更的規劃流程（例如決定
      Logo 圖片來源網址的絕對路徑、簽章內容），不在本卡緊急修正範圍。
  - `.env.example` 的 Database Webhook 說明段落仍描述舊的「Dashboard 手動設定」
    假設，與本卡定案的 Vault 方案不符；不在本卡允許變更檔案清單內，已開背景
    任務卡片追蹤（`task_2c34ce5b`），非阻斷本卡完成。
  - `resend-client.ts` 的逾時處理仍非真正取消（TASK-051 已記錄的既有限制，本卡
    未改變此行為）。
  - `EMAIL_FROM_ADDRESS` 目前仍是 Resend 沙盒地址 `onboarding@resend.dev`（只能
    寄給 Resend 帳號本人），正式上線前需要在 Resend 完成自己網域的驗證並改用
    正式寄件地址，否則無法寄給任意顧客信箱。
- 後續任務：TASK-053（同一端點的 `UPDATE` 分支，情境包已補充 payload 設計限制、
  `when` 子句建議、`pg_net` 不重試的既有限制）、TASK-055（整合驗證）、新增待辦
  「確認信視覺優化（Logo／簽章）」（使用者於 2026-08-24 收到測試信後提出，待另開
  任務卡規劃）、「Resend 正式網域驗證」（上線前必須完成，否則 `EMAIL_FROM_ADDRESS`
  只能用沙盒地址寄給帳號本人）。
