# AI-Ready 任務卡

## Metadata

- 任務：Email 通知與提醒 換用已驗證網域寄件地址（正式上線前置作業）
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：Email 通知與提醒
- 上層 User Story：全部（四種通知信共用同一個 `EMAIL_FROM_ADDRESS`）
- 分軌：不適用（設定變更為主，僅涉及環境變數與極少量說明文件；不改動信件內容或
  程式邏輯）
- 前置任務（dependsOn）：TASK-051～055（皆已完成）
- 狀態：完成（使用者已核准，2026-08-25。2026-08-24 提出，人工步驟——購買
  `zoework.fyi`、Cloudflare DNS 設定、Resend Dashboard 網域驗證——於 2026-08-25
  完成，Claude Code 隨即接手環境變數切換／重新部署／測試收信）
- 風險等級：低（純環境變數與寄件地址切換，不改動任何程式邏輯、資料庫 schema
  或密鑰驗證機制；風險主要在「切換後忘記某個環境沒更新」這類設定疏漏）

## 目標

把 `EMAIL_FROM_ADDRESS`（目前是 Resend 沙盒地址 `onboarding@resend.dev`，只能寄
給 Resend 帳號本人）換成使用者自己網域（Cloudflare 購買、尚未定名）下的正式寄件
地址，讓四種通知信（確認／取消／改期／提醒）能真正寄給任意收件人（例如面試官、
真實顧客），不再受沙盒模式限制。

## 情境包（Context Pack）

- 相關檔案：
  - `.env.local`、Vercel production 環境變數 `EMAIL_FROM_ADDRESS`（見
    `ai/context/project-map.md`「Email 通知與提醒架構」段落，已記錄目前沙盒地址
    現況與正式上線前需完成的步驟）。
  - `lib/email/resend-client.ts`：`sendEmail` 直接讀 `process.env.EMAIL_FROM_ADDRESS`，
    不需要修改程式碼，只要環境變數值換掉即可生效。
- 既有模式：本專案環境變數異動的既有流程——`npx vercel env rm
  EMAIL_FROM_ADDRESS production` 先移除舊值，`npx vercel env add
  EMAIL_FROM_ADDRESS production` 加新值，`npx vercel deploy --prod --yes`
  重新部署讓新值生效（TASK-055 完成證據記錄過「加環境變數不會自動觸發真正的
  程式碼部署」這個教訓，換寄件地址這種情境同樣要記得重新部署才會生效——雖然這
  次只是環境變數本身的值改變，Next.js 讀取 `process.env` 是建置/執行期才生效，
  仍需要一次新的 deployment 把新的環境變數值帶進執行環境）。
- 假設：使用者會自行完成「購買網域」與「Cloudflare DNS 設定」，Claude Code 只
  在使用者明確提供「網域已在 Resend Dashboard 驗證通過」的確認後，協助執行環境
  變數切換、重新部署、與換一個非帳號本人的信箱重新測試收信這幾個可自動化的步驟。
- 未知事項（開始實作前必須先由使用者決定/提供）：
  1. **實際網域名稱**：使用者尚未購買，需等購買完成才知道要填什麼值。
  2. **寄件地址的 local part**：`noreply@<網域>`／`booking@<網域>`／其他？（純
     命名決策，不影響技術實作）。
  3. **DNS record 設定方式**：Resend 網域驗證需要在網域的 DNS 新增特定的 TXT／
     MX／CNAME record——Cloudflare 是否要開 Proxy（橘色雲朵）需依 Resend 官方文件
     指示設定（通常驗證用的 record 需要維持「僅 DNS」不開 Proxy，實際規則以驗證
     當下 Resend Dashboard 顯示的內容為準，購買/設定當下需要重新確認，不要憑舊
     記憶假設）。
  4. **驗證完成的判斷依據**：以 Resend Dashboard 該網域顯示「Verified」狀態為準，
     不要在 DNS record 設定完成、但 Resend 尚未顯示驗證通過前就先切換
     `EMAIL_FROM_ADDRESS`（切換過早會導致寄信失敗）。
- 允許變更的檔案：
  - `.env.local`（`EMAIL_FROM_ADDRESS` 新值）
  - Vercel production 環境變數 `EMAIL_FROM_ADDRESS`（透過 `npx vercel env` 指令，
    非檔案異動）
  - `ai/context/project-map.md`（更新「Email 通知與提醒架構」段落的「已知限制」，
    移除沙盒地址提醒，改記錄正式網域切換完成的事實與日期）
  - `.env.example`（若需要更新 `EMAIL_FROM_ADDRESS` 的範例值/註解說明）
- 不得觸碰：`lib/email/`、`app/api/webhooks/`、`app/api/cron/` 底下任何程式碼
  ——本卡純粹是環境變數值的切換，不應該連帶修改信件內容組成或寄送邏輯。

## 需求

- 已完成：使用者購買 `zoework.fyi`（Cloudflare Registrar）、在 Cloudflare DNS
  新增 Resend 要求的三筆 record（TXT `resend._domainkey`／MX `send`／TXT
  `send`，本次帳號的 DKIM 是 TXT 格式，非 CNAME）、Resend Dashboard 顯示 Domain
  Verified 後，提供寄件地址 local part（`noreply`），由 Claude Code 接手切換
  `EMAIL_FROM_ADDRESS`、重新部署、用非帳號本人信箱測試收信。

## 驗收標準

- `.env.local`／Vercel production 的 `EMAIL_FROM_ADDRESS` 皆已換成
  `noreply@zoework.fyi`。
- 重新部署後，用一個不是 Resend 帳號本人的信箱（`sarawang945@gmail.com`）觸發
  確認信，確認能正常收到且寄件人正確顯示為 `noreply@zoework.fyi`，沒有沙盒限制
  的錯誤。
- `project-map.md`「Email 通知與提醒架構」段落已更新反映正式網域已啟用。

## 實作備註

- 這張卡的大部分工作（購買網域、Cloudflare DNS 設定、Resend Dashboard 網域驗證）
  是人工專屬步驟，Claude Code 不會、也不能代為執行（涉及付款與第三方帳號操作）。
  使用者完成這些步驟、且 Resend Dashboard 顯示網域已驗證後，再回來請 Claude Code
  接手「環境變數切換＋重新部署＋重新測試收信」這幾個可自動化的收尾步驟即可，
  不需要重新走一次完整的 spec-interrogation／implementation-plan（本卡的情境包
  已經把可自動化的部分講清楚，人工步驟一完成即可直接動手）。

## 驗證契約

- 單元測試：不適用（無程式邏輯變更）。
- 整合測試：不適用（`test:notifications` 對此不敏感，已用 mock 隔離
  `EMAIL_FROM_ADDRESS` 實際值的影響）。
- E2E 測試：不適用。
- 型別檢查：不適用。
- Lint：不適用。
- Build：不需要重新 build 前端程式碼，但需要 `npx vercel deploy --prod --yes`
  讓新環境變數生效。
- 螢幕截圖：不適用；改附「用非帳號本人信箱收到測試信」的實際截圖或文字記錄，
  取代 TASK-055 當時「只能寄給帳號本人」的限制範圍。
- 安全性檢查：不適用（不涉及密鑰或權限變更）。

## 完成證據

- 變更的檔案：
  - `.env.local`（`EMAIL_FROM_ADDRESS` 改為 `noreply@zoework.fyi`）
  - Vercel production 環境變數 `EMAIL_FROM_ADDRESS`（同上，透過 `npx vercel env
    rm`／`add` 切換，非檔案異動）
  - `ai/context/project-map.md`（「Email 通知與提醒架構」段落的已知限制文字，改
    記錄正式網域切換完成的事實）
- 執行過的指令：
  - `npx vercel env rm EMAIL_FROM_ADDRESS production --yes`
  - `npx vercel env add EMAIL_FROM_ADDRESS production`（新值
    `noreply@zoework.fyi`）
  - `npx vercel deploy --prod --yes`（讓新環境變數生效）
  - 手動觸發驗證：用 service role 建立一筆真實測試預約
    （`customer_email=sarawang945@gmail.com`，非 Resend 帳號本人信箱），觸發正式
    環境的 Database Webhook → 確認信寄送鏈路，`confirmation_sent_at` 成功設定
    （無錯誤 log）；驗證完成後已刪除測試資料。
- 測試輸出：不適用（無自動化測試變更，見「驗證契約」）。
- 螢幕截圖：不適用；使用者已於對話中口頭確認 `sarawang945@gmail.com`
  （非帳號本人信箱）收到確認信，寄件人正確顯示 `noreply@zoework.fyi`。
- 已知限制：無新增（`EMAIL_FROM_ADDRESS` 沙盒限制已解除，`project_email_from_
  address_sandbox` 這類「上線前必須換網域」的待辦提醒已一併從記憶中移除）。
- 後續任務：無。Email 通知與提醒 Epic（TASK-051～055、060、061）至此全數完成，
  已無沙盒模式限制，可正式對外寄送四種通知信。
