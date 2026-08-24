# AI-Ready 任務卡

## Metadata

- 任務：Email 通知與提醒 前後端串接驗證與端到端測試
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：Email 通知與提醒
- 上層 User Story：全部（整合驗證）
- 分軌：整合
- 前置任務（dependsOn）：TASK-051, TASK-052, TASK-053, TASK-054
- 狀態：完成（使用者已核准，2026-08-24）
- 風險等級：高（涵蓋對外端點、真實第三方服務整合、資料庫 webhook 觸發鏈的整合驗證，
  比照本 Epic 其他卡片的風險等級判定）

## 目標

新增 `npm run test:notifications` 整合測試，涵蓋 webhook／排程端點的密鑰驗證與查詢
邏輯；重跑既有整合測試確認無回歸；至少各一次使用真實（或測試模式）Resend API key
手動觸發確認信、提醒信、取消/改期通知信，確認信件實際送達且內容正確；更新
`project-map.md`（含 Database Webhook／Vercel Cron 的實際設定步驟記錄，供未來部署
到新環境時參考）。

## 情境包（Context Pack）

- 相關檔案：
  - `tests/booking.integration.test.ts`：既有建立測試預約的既有寫法可參考。
  - `ai/context/project-map.md`：更新「常用指令」表新增 `test:notifications`，補充
    Email 通知架構描述（Resend、webhook 觸發鏈、Cron 排程）；新增一段記錄 Supabase
    Database Webhook 與 Vercel Cron 的實際設定步驟（若最終採用 Dashboard 手動設定，
    這段記錄尤其重要，因為它是版控外的狀態，未來重新部署或換專案時需要照著步驟
    重新設定）。
- 既有模式：
  - 各整合測試檔案的「離今天 N 天以上」offset 慣例，本卡新增涉及 `create_appointment`
    的測試案例需依 `project-map.md` 記錄的既有範圍表挑選未使用的區段。
- 假設：
  - 整合測試對 Resend 的呼叫使用測試模式 API key 或 mock（避免自動化測試每次執行都
    寄出真實信件騷擾測試信箱或耗用額度），真實信件送達的驗證改為本卡「手動」步驟
    執行，不併入自動化 CI 流程。
- 未知事項：無。
- 允許變更的檔案：
  - `tests/notifications.integration.test.ts`（新增）
  - `vitest.notifications.config.ts`（新增）
  - `package.json`（新增 `test:notifications` script）
  - `ai/context/project-map.md`（更新）
  - `ai/context/decisions.md`（記錄 Database Webhook 建立方式的最終決策，若 TASK-052
    的架構審查有產生需要留存的決策記錄）
- 不得觸碰：
  - 既有整合測試檔案的既有測試案例邏輯（僅執行重跑確認無回歸）。

## 需求

- 新增整合測試涵蓋：
  - webhook 端點：密鑰驗證（正確/錯誤/缺失）、`INSERT`／`UPDATE`（取消／改期／
    標記完成三種情境）事件的正確分派。
  - 排程端點：密鑰驗證、時間窗內外預約的正確篩選、`reminder_sent_at` 去重機制。
- 重跑既有整合測試（依當時已完成的 Epic 而定，至少含 `test:rls`／`test:booking`／
  `test:admin-booking`），確認無回歸。
- 手動驗證：使用真實或測試模式 Resend API key，實際觸發並確認收到一封確認信、一封
  提醒信（可直接呼叫排程端點模擬，或調整測試預約的 `start_at` 落入時間窗）、一封
  取消通知信、一封改期通知信，逐一確認內容正確。

## 驗收標準

- `npm run test:notifications` 全數通過。
- 既有整合測試重跑無回歸。
- `npx tsc --noEmit`／`npm run lint`／`npm run build` 皆通過。
- 四種信件（確認、提醒、取消、改期）皆至少手動驗證過一次實際送達且內容正確，證據
  記錄於完成證據（截圖或詳細文字記錄，例如 Resend Dashboard 的寄送記錄截圖）。
- `project-map.md` 更新反映 Email 通知架構與 Database Webhook／Cron 的實際設定步驟。

## 實作備註

- 本卡風險等級高，建議額外執行 `security-reviewer` 子代理對整個 Epic（TASK-051～054
  累積的變更）做一次總覽性審查，重點確認密鑰驗證機制、`SUPABASE_SERVICE_ROLE_KEY`
  使用範圍、Database Webhook 密鑰儲存方式皆無外洩風險。

## 驗證契約

- 單元測試：（若前置任務尚未涵蓋齊全）補齊遺漏的純函式測試。
- 整合測試：`npm run test:notifications`（新增）；重跑既有整合測試組。
- E2E 測試：不適用傳統 UI E2E；手動觸發驗證取代（見上方「需求」）。
- 型別檢查：`npx tsc --noEmit`
- Lint：`npm run lint`
- Build：`npm run build`
- 螢幕截圖：不適用（無 UI）；改附 Resend Dashboard 寄送記錄或實際收信截圖作為證據。
- 安全性檢查：`security-reviewer` 對整個 Epic 的總覽性審查（見「實作備註」）。

## 完成證據

- 變更的檔案：
  - `tests/notifications.integration.test.ts`（新增，19 個測試案例）
  - `vitest.notifications.config.ts`（新增）
  - `package.json`（新增 `test:notifications` script）
  - `ai/context/project-map.md`（新增「Email 通知與提醒架構」段落，含正式環境
    Database Webhook／Vercel Cron 實際設定步驟；「重要目錄」「常用指令」表新增
    對應項目）
  - `ai/context/decisions.md`（新增 TASK-051～054 的 Database Webhook 建立方式決策
    紀錄）
- 執行過的指令：
  - `npm run test:notifications`：19/19 通過（涵蓋 webhook 密鑰驗證、INSERT 事件
    確認信去重與失敗補償、UPDATE 事件取消/改期/標記完成三種分派、cron 密鑰驗證、
    時間窗篩選與 `reminder_sent_at` 去重）。
  - `npx tsc --noEmit`／`npm run lint`／`npm run build`：皆通過。
  - `npm test`：461/462 通過；1 個既有測試檔案（`account-settings-view.test.tsx`）
    在並行執行時逾時，單獨重跑 100% 通過，與本卡無關（TASK-051 完成證據已記錄過
    同一個既有 flaky 現象）。
  - 既有整合測試重跑無回歸：`test:rls`／`test:booking`／`test:admin-booking`／
    `test:business-hours`／`test:store-settings`／`test:booking-policy`／
    `test:services`／`test:account` 全數通過。
  - `security-reviewer` 對整個 Epic（TASK-051～054 累積變更）的總覽審查：核心關注
    的密鑰驗證、`SUPABASE_SERVICE_ROLE_KEY` 使用範圍、Vault 密鑰儲存、payload 最小化、
    HTML escape 五項皆確認無虞；發現 2 項 MUST FIX，皆已修正（見下方）。
- MUST FIX 修正記錄（security-reviewer 發現於本卡新增的測試檔案本身，非既有程式碼）：
  1. `tests/notifications.integration.test.ts` 的 fixture 若在 INSERT 當下就帶非
     null 的 `customer_email`，會讓 `appointments` 表上真實掛著的 Database Webhook
     trigger（`0011`／`0012` migration）真的觸發，經 pg_net 打到正式部署網址、用
     真實 Resend key 寄信——`vi.mock` 只保護本測試行程，擋不住資料庫層級的
     trigger。已修正為「INSERT 時 `customer_email` 一律先設 null，需要非 null 值時
     另外用『只改這一欄』的獨立 UPDATE 補上」，兩步都不滿足對應 trigger 的 `WHEN`
     條件，不會驚動正式環境。修正後重新執行 `npm run test:notifications` 並用
     `npx vercel logs` 比對確認正式環境端點不再被意外呼叫（本次教訓已另外記錄，
     供未來任何在有 Database Webhook 的表上寫整合測試時參考）。
  2. 排程端點整合測試原本用「執行前快照當下符合條件的既有 id、執行後還原」保護
     真實資料，但快照時間點與真正 GET handler 內部重新計算時間窗的時間點有落差，
     且無法涵蓋測試執行期間才由真實顧客新建立的預約，會讓這類漏網之魚被真的
     claim（`reminder_sent_at` 設非 null）卻永遠不會被還原。已修正為「記錄測試
     開始前的時間戳，執行後把這段期間內所有 `reminder_sent_at` 被設定的列（不論
     是本檔案的 fixture 或真實資料）一律還原回 null」，涵蓋範圍更完整；已知殘留
     取捨：若剛好與正式 Vercel Cron（`0 1 * * *` UTC）同時執行，會讓那批預約隔天
     重複收到提醒信，避免在 UTC 01:00 前後執行本測試即可規避（已記錄在測試檔案
     註解）。
  - 其餘 4 項 NICE TO HAVE（migration exception handler 只記 sqlstate、webhook URL
    scheme 白名單等）皆涉及已套用到正式資料庫的 `0011`／`0012` migration 檔案，
    超出本卡「允許變更的檔案」範圍，未在本卡處理，留待未來視需要另立任務卡。
- 正式環境手動驗證（四種信件皆至少驗證一次）：
  - 發現並修正部署缺口：觸發提醒信前用 `curl` 直接打
    `https://pro5-nu.vercel.app/api/cron/appointment-reminders`（不帶密鑰）
    回應 404，同時 webhook 端點回應正常的 401——證明 cron 路由本身沒有被建置進
    先前新增 `CRON_SECRET` 環境變數當下的那次正式部署（環境變數更新不會自動觸發
    重新部署）。執行 `npx vercel deploy --prod --yes` 後 cron 端點恢復正常（缺
    密鑰回 401），已記錄進 Vercel 部署記憶供未來排查參考。
  - 建立 3 筆真實測試預約（`customer_email` 皆設為使用者本人的 Resend 帳號註冊
    信箱，因 `EMAIL_FROM_ADDRESS` 目前是 Resend 沙盒地址、只能寄給帳號本人），
    讓正式環境已安裝的 Database Webhook trigger／手動 curl 觸發 cron 端點走完整
    真實鏈路（真實 pg_net → 正式部署 → 真實 Resend API），總計送出 6 封信
    （確認×2、取消×1、改期×1、提醒×1，另 2 封確認信是建立測試預約的自然副作用）。
  - 使用者已於收件信箱逐一確認：**確認信、提醒信、取消信、改期信皆收到，主旨／
    服務名稱／時段等內容皆正確**。
  - 驗證完成後已刪除全部 3 筆測試預約，正式資料庫無殘留測試資料。
- 已知限制：
  - `EMAIL_FROM_ADDRESS` 仍是 Resend 沙盒地址 `onboarding@resend.dev`，只能寄給
    帳號本人，正式上線前需完成自訂網域 DNS 驗證並更換（已記錄於 project-map.md
    與既有記憶）。
  - Webhook 端點 UPDATE 分支無節流機制（TASK-053 已知殘留風險，非本卡新發現，
    詳見該任務卡）。
  - security-reviewer 提出的 4 項 migration 層級 NICE TO HAVE（見上方）留待未來
    任務卡處理。
- 後續任務：無新增（本 Epic 三個 User Story 至此皆完整涵蓋）；未來若要正式上線，
  需另外處理「換用已驗證網域寄件地址」與上述 migration NICE TO HAVE 項目。
