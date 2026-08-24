# AI-Ready 任務卡

## Metadata

- 任務：Email 通知與提醒 確認信視覺優化（店家 Logo／結尾簽章）
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：Email 通知與提醒
- 上層 User Story：預約成立寄送確認信
- 分軌：後端（`lib/email/templates/` 的內容組成，但涉及視覺設計決策，需先過
  `design-craft` 紀律）
- 前置任務（dependsOn）：TASK-052
- 狀態：草稿（使用者於 2026-08-24 收到 TASK-052 實測確認信後提出「格式簡陋，
  希望加 Logo 與簽章」的回饋；尚未走過 spec-interrogation／mockup 決策，**不算
  AI-ready**，開始實作前需先補齊「未知事項」段落列出的決策）
- 風險等級：低（純內容/樣式調整，不涉及新的密鑰、權限或資料寫入流程變更；風險
  主要在「圖片來源網址是否可靠」與「email 客戶端相容性」這類內容/呈現層面）

## 目標

在確認信（`lib/email/templates/confirmation.ts`，TASK-052 建立）加入店家 Logo
圖片與結尾簽章，改善目前純文字、格式陽春的觀感。是否同步套用到 TASK-053（取消／
改期通知信）、TASK-054（提醒信）尚未定案，見「未知事項」。

## 情境包（Context Pack）

- 相關檔案：
  - `lib/email/templates/confirmation.ts`（TASK-052 建立，本卡要修改的內容組成
    純函式；目前所有內插值皆呼叫 `escapeHtml`，這個既有紀律必須延續）。
  - `lib/store-settings.ts` 的 `getStoreSettings`／`StoreSettings` 型別已經有
    `logo_url` 欄位（`store_settings` 表，見 `0006_store_settings.sql`），但
    `app/api/webhooks/appointment-events/route.ts` 目前只把 `name`／`phone`
    傳給 `buildConfirmationEmail`，沒有傳 `logo_url`——本卡若要用 Logo，需要
    同時修改 route.ts 把 `logo_url` 一併傳入。
  - `ai/context/design-system.md`（既有 design token／元件庫，開始 mockup 前
    需先讀過，確認 email 版型要不要延續同一套色彩/字體 token，或 email 因為
    客戶端限制需要獨立一套簡化規則）。
- 既有模式：`lib/email/format.ts` 的 `escapeHtml`；email HTML 必須用 inline
  style（大多數 email 客戶端不支援外部/`<style>` 區塊 CSS）。
- 假設：待補（見下方「未知事項」，需要先由人工／`spec-interrogation` 決定）。
- 未知事項（開始實作前必須先決定，不建議直接動手改程式碼）：
  1. **Logo 圖片來源**：直接用 `store_settings.logo_url`（若店家已在「商店基本
     資料設定」Epic 上傳過）？該欄位存的是否已經是可從外部直接存取的絕對網址
     （Supabase Storage public bucket，理論上是，但需要實際確認一筆真實資料）？
     若 `logo_url` 為 `null`（店家尚未上傳），信件要完全省略圖片區塊還是顯示
     預留位置？
  2. **簽章內容範圍**：只要店名＋電話，還是要加地址／社群連結／營業時間？
  3. **Email 客戶端相容性**：Gmail／Outlook／Apple Mail 對圖片預設可能不自動
     顯示（需要 `alt` 文字 fallback）、對 CSS 支援程度不同，需要在設計階段一併
     考慮，不能直接套用一般網頁的 CSS 寫法。
  4. **套用範圍**：只改 TASK-052 的確認信，還是連帶影響 TASK-053／TASK-054
     尚未實作的信件範本（若三者共用同一個 email 版型／頁尾元件，本卡完成後
     應該把版型抽成共用函式，供後續信件範本重用，避免各自複製貼上）。
- 允許變更的檔案：**尚未定案**，需等 mockup 決策與 spec 釐清後，在
  `implementation-plan` 階段才能明確列出（初步預期會涉及
  `lib/email/templates/confirmation.ts`、`app/api/webhooks/appointment-events/route.ts`、
  可能新增 `lib/email/templates/_layout.ts` 之類的共用版型檔案）。
- 不得觸碰：TASK-052 已審查通過的密鑰驗證、payload 設計（只送 `id`）、去重／
  補償邏輯——本卡純粹是信件內容/樣式層面的調整，不得連帶修改這些已定案的機制。

## 需求

- 待補（走完 `spec-interrogation` 釐清「未知事項」後填寫）。

## 驗收標準

- 待補。

## 實作備註

- 開始寫程式碼前，建議依序：
  1. `spec-interrogation`：釐清「未知事項」段落列出的四個決策點。
  2. `ui-mockup-gate`：即使是 email 而非網頁畫面，仍建議產出 2-3 個視覺變體
     （例如「Logo 置頂＋簡短簽章」vs「Logo 與簽章都在頁尾」）供人工選擇，因為
     這是會被顧客實際看到、代表店家形象的對外內容。
  3. `implementation-plan`：定案後產出正式的允許變更清單與驗證契約，可能需要
     升級或新開一張任務卡（例如 TASK-061）承接實際實作。
- 實作時務必延續 TASK-052 已建立的 `escapeHtml` 紀律：Logo 的 `alt` 文字、簽章
  內容中任何來自 `store_settings`（後台可信輸入，但仍建議照既有慣例一併
  escape）都要走 `lib/email/format.ts` 的 `escapeHtml`。

## 驗證契約

- 單元測試：Logo／簽章區塊組成的純函式測試（含 `logo_url` 為 `null` 的
  fallback 情境）。
- 整合測試：`route.ts` 正確把 `logo_url` 傳入信件組成函式。
- E2E 測試：不適用（無 UI）；改用「至少一個主流 email 客戶端的實際呈現截圖」
  取代。
- 型別檢查：`npx tsc --noEmit`
- Lint：`npm run lint`
- Build：`npm run build`
- 螢幕截圖：**需要**——這是本卡驗證契約中少數需要視覺證據的項目，建議附上
  Gmail／Outlook 等至少一個真實信箱收到的截圖。
- 安全性檢查：Logo 圖片網址若允許動態帶入，需確認不會被利用來內嵌任意外部
  圖片網址（tracking pixel／可疑網域），建議限定只能用 `store_settings.logo_url`
  這個既有欄位，不開放信件範本以外的任意輸入。

## 完成證據

- 變更的檔案：待實作後填寫。
- 執行過的指令：待實作後填寫。
- 測試輸出：待實作後填寫。
- 螢幕截圖：待實作後填寫。
- 已知限制：待實作後填寫。
- 後續任務：待補。
