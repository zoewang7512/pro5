# AI-Ready 任務卡

## Metadata

- 任務：Email 通知與提醒 前後端串接驗證與端到端測試
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：Email 通知與提醒
- 上層 User Story：全部（整合驗證）
- 分軌：整合
- 前置任務（dependsOn）：TASK-051, TASK-052, TASK-053, TASK-054
- 狀態：已核准（2026-08-18），待前置任務 TASK-051～054 完成後轉就緒
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

- 變更的檔案：待實作後填寫。
- 執行過的指令：待實作後填寫。
- 測試輸出：待實作後填寫。
- 螢幕截圖：待實作後填寫。
- 已知限制：待實作後填寫。
- 後續任務：無（本 Epic 三個 User Story 至此皆完整涵蓋）。
