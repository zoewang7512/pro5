# AI-Ready 任務卡

## Metadata

- 任務：Email 通知與提醒 確認信視覺優化（店家 Logo／結尾簽章）
- 上層規格：[`feature-spec.md`](../feature-spec.md)（TASK-060 追加段落，2026-08-24）
- 上層 Epic：Email 通知與提醒
- 上層 User Story：預約成立寄送確認信／取消／改期時寄送通知信／預約前寄送提醒信
  （四種信件共用同一套版型，一次涵蓋）
- 分軌：後端（`lib/email/templates/` 內容組成＋兩支 API Route 的呼叫端傳參調整）
- 前置任務（dependsOn）：TASK-052, TASK-053, TASK-054
- 狀態：完成（使用者已核准，2026-08-24）
- 風險等級：低（純內容/樣式調整，不涉及新密鑰、新權限或新資料寫入路徑；重用既有
  `resolveStoreDisplay` 的 Logo 網址白名單機制，不新增信任邊界）

## 目標

四種通知信（確認／取消／改期／提醒）加上共用的 Header（店家 Logo banner）與
Footer（店名／電話／地址簽章），取代目前純文字、無品牌識別的版面。

## 情境包（Context Pack）

- 相關檔案：
  - `lib/email/templates/confirmation.ts`／`cancellation.ts`／`reschedule.ts`／
    `reminder.ts`（TASK-052／053／054 建立，各自獨立組 `{subject, html}`，`html`
    目前是純段落／清單，各自複製一份 `DEFAULT_STORE_NAME = "我們"` 與
    `contactLine` 邏輯）。
  - `lib/email/format.ts`：`escapeHtml`（本卡新增的 Logo 網址／地址／店名皆須沿用
    這支函式，不得省略）、`formatAppointmentDateTime`（不變）。
  - `lib/store-settings.ts`：`getStoreSettings`（不變）／`resolveStoreDisplay`
    （**本卡改用這支既有函式**，取代兩支 route.ts 目前直接讀 `StoreSettings` 原始
    欄位的寫法——`resolveStoreDisplay` 內部的 `trustedAssetUrl` 已經是本專案唯一
    「只信任 `store-assets` bucket 網址」的白名單實作，TASK-032 security-reviewer
    審查建立，本卡直接重用，不得另外自己寫一份網址驗證邏輯）。
  - `app/api/webhooks/appointment-events/route.ts`：`handleAppointmentInsert`／
    `handleAppointmentUpdate` 兩處目前各自呼叫
    `storeSettingsResult.ok ? storeSettingsResult.data : null` 後，只把
    `storeSettings?.name`／`storeSettings?.phone` 傳給範本函式，本卡需要改傳
    `resolveStoreDisplay(...)` 算出的 `logoUrl`／`address` 兩個新欄位。
  - `app/api/cron/appointment-reminders/route.ts`：同上，`storeSettings` 只在迴圈
    外算一次（批次共用），改法相同。
- 既有模式：
  - `lib/email/templates/*.ts` 皆為純函式（不做 I/O），本卡新增的
    `lib/email/templates/_layout.ts` 延續同樣的純函式風格。
  - `escapeHtml` 在「內插進 HTML 前」呼叫，不傳已 escape 過的字串在函式之間流動
    （避免重複 escape 或漏 escape），本卡新模組延續這個既有紀律，各自在自己的
    輸出邊界做 escape。
  - `resolveStoreDisplay` 已經會 trim 並把空字串轉成 `null`（`name` 除外，`name`
    trim 後可能是空字串，呼叫端仍需要自己的 fallback，見下方）。
- 假設（已於 mockup 決策階段確認，不再是待決事項）：
  - Header／Footer 版型：Header 採「淺金色（primary.50）banner＋置中放大 Logo」
    （mockup 變體 C 樣式），無 Logo 時 banner 改顯示大字店名（22px，
    `Georgia,'Noto Serif TC','PingFang TC','Microsoft JhengHei',serif`，
    `color:#6F531E`）；Footer 採「一行小字簽章，緊接內文最後一段」（mockup 變體 B
    樣式），格式為 `店名・電話・地址`，用「・」分隔，任一欄位缺值時該欄位省略
    （只保留分隔符號兩側皆有值的部分，不留下多餘的「・・」）。完整範例見
    [`mockups/confirmation-email-selected.html`](../mockups/confirmation-email-selected.html)。
  - 各範本既有的 `contactLine`（例如「如需異動預約，歡迎聯絡我們：{電話}」）**維持
    不變、不刪除**——本卡只新增 Header／Footer 包裝，不改動既有內文文字邏輯；電話
    因此可能同時出現在內文 `contactLine` 與 Footer 簽章兩處，這是刻意保留、不是
    疏漏（多數真實交易型信件也是「內文 CTA＋頁尾完整聯絡資訊」並存，且本卡範圍
    僅限「視覺優化」，改動既有文案是另一個範疇的任務）。
  - `DEFAULT_STORE_NAME = "我們"` 的 fallback 語意（`storeName` 為空或全空白時）
    延續到 Header／Footer：Header 無 Logo 時顯示「我們」、Footer 簽章第一欄也是
    「我們」。此為既有慣例的自然延伸，不是新決策。
  - Logo `<img>` 需要 `width`／`height` 明確寫死（避免圖片被信箱封鎖時版面塌陷，
    比照 `screen-spec-通知信視覺版型.md`「互動」表的既有規格）；`alt` 屬性用
    escape 過的店名。
- 未知事項：無（spec-interrogation／ui-mockup-gate 皆已走完並核准）。
- 允許變更的檔案：
  - `lib/email/templates/_layout.ts`（新增，共用 Header／Footer 組成函式）
  - `lib/email/templates/confirmation.ts`（修改：改用 `_layout.ts` 包裝，新增
    `storeLogoUrl`／`storeAddress` 兩個輸入欄位）
  - `lib/email/templates/cancellation.ts`（同上）
  - `lib/email/templates/reschedule.ts`（同上）
  - `lib/email/templates/reminder.ts`（同上）
  - `app/api/webhooks/appointment-events/route.ts`（修改：改用 `resolveStoreDisplay`，
    新增傳入 `storeLogoUrl`／`storeAddress`）
  - `app/api/cron/appointment-reminders/route.ts`（同上）
  - `tests/lib/email-layout.test.ts`（新增）
  - `tests/lib/email-confirmation-template.test.ts`／`email-cancellation-template.test.ts`／
    `email-reschedule-template.test.ts`／`email-reminder-template.test.ts`（更新既有
    測試以涵蓋新增的 Header／Footer 輸出；不得刪除既有針對 `contactLine`／主旨格式
    的既有案例）
  - `tests/api/appointment-events-webhook.test.ts`／`tests/api/appointment-reminders-cron.test.ts`
    （視需要微調 mock 資料以涵蓋 `logo_url` 有值的情境；既有案例邏輯不得變更）
- 不得觸碰：
  - 各範本既有的 `contactLine`／內文段落文字邏輯（見上方「假設」）。
  - 密鑰驗證、去重機制、webhook payload 設計（TASK-052／053／054 已審查通過的
    部分，本卡完全不涉及）。
  - `lib/store-settings.ts` 的 `trustedAssetUrl`／`resolveStoreDisplay` 本體邏輯
    （只呼叫，不修改）。

## 需求

- 新增 `lib/email/templates/_layout.ts`，匯出 `wrapEmailBody(input): string`：
  - 輸入：`{ storeName?, storeLogoUrl?, storePhone?, storeAddress?, bodyHtml }`
    （`bodyHtml` 為呼叫端已組好、已自行 escape 過動態內容的內文 HTML 片段）。
  - 輸出：完整的 `<table>...</table>` HTML 字串，依序為 Header banner、
    `bodyHtml`、Footer 簽章列。
  - Header：`storeLogoUrl`（trim 後）非空時渲染 `<img>`（`src` 為 escape 過的網址、
    `alt` 為 escape 過的店名、`width="160"` `style="max-height:64px;width:auto;
    height:64px"`）；否則渲染店名文字（見上方「假設」的樣式規格）。banner 背景色
    `#FBF4E2`（primary.50）。
  - Footer：簽章依序組出「店名／電話／地址」，用「・」分隔，任一欄位 trim 後為空
    則省略該欄位；三者皆空（理論上不會發生，`storeName` 有 `DEFAULT_STORE_NAME`
    保底）時至少顯示店名。字級 12px、顏色 `#6B6259`（grey.700）。
  - 卡片外框：`border:1px solid #E4DDD1`（grey.300）、`border-radius:12px`、
    `max-width:480px;margin:0 auto`，比照 mockup 檔案的既有數值。
  - `storeName`／`storeLogoUrl`／`storePhone`／`storeAddress` 四個輸入值皆須在
    `wrapEmailBody` 內部呼叫 `escapeHtml` 才能內插進輸出的 HTML／HTML 屬性，不得
    信任呼叫端已經 escape 過。
- 四支範本（`confirmation.ts`／`cancellation.ts`／`reschedule.ts`／`reminder.ts`）
  的 `*EmailInput` 型別新增 `storeLogoUrl?: string | null`／
  `storeAddress?: string | null` 兩個選填欄位；各自的 `build*Email` 函式改為：
  組出原本的內文 `bodyHtml`（維持既有段落／清單／`contactLine` 邏輯不變）後，呼叫
  `wrapEmailBody({ storeName, storeLogoUrl, storePhone, storeAddress, bodyHtml })`
  取得最終 `html`，`subject` 邏輯不變。四支檔案各自的 `DEFAULT_STORE_NAME` 常數與
  用於「內文提及店名」那一句（例如「您在{safeStoreName}的預約已成立」）的
  `escapeHtml(storeName)` 計算維持不變（那是內文用途，與 `_layout.ts` 內部各自
  獨立的 escape 互不影響、不算重複邏輯——同一個值在兩個不同輸出位置分別使用時
  各自 escape 是本專案既有紀律，見「既有模式」）。
- `app/api/webhooks/appointment-events/route.ts`：`handleAppointmentInsert`／
  `handleAppointmentUpdate` 兩處改用 `resolveStoreDisplay(storeSettingsResult.data)`
  取代直接讀取原始 `StoreSettings`，把 `storeDisplay?.logoUrl`／
  `storeDisplay?.address` 一併傳入對應的 `build*Email` 呼叫（`name`／`phone` 改讀
  `storeDisplay?.name`／`storeDisplay?.phone`，行為與原本讀 `storeSettings?.name`／
  `storeSettings?.phone` 等價，只是多了 trim，不影響既有測試預期）。
- `app/api/cron/appointment-reminders/route.ts`：同上，`storeSettings` 變數改為
  `storeDisplay`，`buildReminderEmail` 呼叫新增 `storeLogoUrl`／`storeAddress`。

## 驗收標準

- `store_settings.logo_url` 有值（且為 `store-assets` bucket 底下的網址）時，四種
  信件的 Header 皆顯示該 Logo 圖片；`logo_url` 為 `null`，或為不受信任網址（理論上
  不會發生，因為寫入路徑本身就限制在該 bucket，但 `resolveStoreDisplay` 仍會擋下）
  時，Header 改顯示店名文字，不留空白或破圖。
- 四種信件的 Footer 皆顯示「店名・電話・地址」簽章（缺值欄位省略，格式正確不留
  多餘分隔符號）。
- 既有的主旨格式、內文段落、`contactLine` 文字皆不受影響（既有測試案例全數維持
  綠燈，不因本卡而改變預期值）。
- 顧客姓名、店名、電話、地址、Logo 網址皆延續 `escapeHtml` 紀律，無 HTML
  injection 風險（含新增的 `<img>` 屬性內插）。
- `npx tsc --noEmit`／`npm run lint`／`npm run build` 皆通過。
- 既有整合測試（`test:notifications` 至少）重跑無回歸。
- 至少一次使用真實 Resend API key（沿用 TASK-055 已驗證過的手動觸發方式），觸發
  一封確認信，確認 Header／Footer 在真實信箱（例如 Gmail）中正確顯示，附上截圖或
  詳細文字記錄。

## 實作備註

- `_layout.ts` 的 `wrapEmailBody` 建議簽名：
  ```ts
  export type EmailShellInput = {
    storeName?: string | null;
    storeLogoUrl?: string | null;
    storePhone?: string | null;
    storeAddress?: string | null;
    bodyHtml: string;
  };
  export function wrapEmailBody(input: EmailShellInput): string { /* ... */ }
  ```
  完整版面數值（padding、字級、色碼）直接照抄
  [`mockups/confirmation-email-selected.html`](../mockups/confirmation-email-selected.html)
  的「有 Logo」／「無 Logo」兩段 `<table>` 結構，不要重新發明數值。
- 四支範本檔案的修改幅度應該很小：只在檔案最後把原本 `return { subject, html }`
  的 `html` 組成方式，從「直接 join 一堆段落」改成「先 join 出 `bodyHtml`，再包一層
  `wrapEmailBody(...)`」，其餘既有邏輯（`safeCustomerName` 等變數計算）不變。
- 兩支 route.ts 的修改僅止於：import 改成 `resolveStoreDisplay`（原本已 import
  `getStoreSettings`，新增這個 import）、把 `storeSettings` 變數改算
  `storeDisplay`、傳給 `build*Email` 的物件多帶兩個欄位。

## 驗證契約

- 單元測試：
  - `tests/lib/email-layout.test.ts`（新增）：涵蓋有 Logo／無 Logo／Logo 網址含
    需要 escape 的字元（理論案例，驗證 escape 有生效）／電話或地址缺值時 Footer
    正確省略對應欄位／`storeName` 為空白字串時 fallback 成「我們」。
  - 既有四支範本測試檔更新：驗證輸出的 `html` 含 Header／Footer 區塊、既有主旨與
    內文斷言維持不變。
- 整合測試：`npm run test:notifications` 重跑無回歸（該檔案的 `sendEmail` 全程
  mock，不受本卡影響，但需確認呼叫路徑仍正確）。
- E2E 測試：不適用（無 UI）。
- 型別檢查：`npx tsc --noEmit`
- Lint：`npm run lint`
- Build：`npm run build`
- 螢幕截圖：**需要**，至少一張真實信箱收到的確認信截圖（Header／Footer 皆需可見）。
- 安全性檢查：確認 `wrapEmailBody` 內部所有動態內插（含 `<img src>`／`alt` 屬性）
  皆經過 `escapeHtml`；確認 Logo 網址仍走 `resolveStoreDisplay` 的既有白名單，未
  另開新的信任路徑。

## 完成證據

- 變更的檔案：
  - `lib/email/templates/_layout.ts`（新增，共用 Header／Footer 組成函式
    `wrapEmailBody`）
  - `lib/email/templates/confirmation.ts`／`cancellation.ts`／`reschedule.ts`／
    `reminder.ts`（各自新增 `storeLogoUrl`／`storeAddress` 輸入欄位，改用
    `wrapEmailBody` 包裝既有 `bodyHtml`，既有段落／`contactLine`／`escapeHtml`
    邏輯不變）
  - `app/api/webhooks/appointment-events/route.ts`（`handleAppointmentInsert`／
    `handleAppointmentUpdate` 改用 `resolveStoreDisplay` 取代直接讀取
    `StoreSettings`，傳入 `storeLogoUrl`／`storeAddress`）
  - `app/api/cron/appointment-reminders/route.ts`（同上）
  - `tests/lib/email-layout.test.ts`（新增，12 個測試）
  - `tests/lib/email-confirmation-template.test.ts`／`email-cancellation-template.test.ts`／
    `email-reschedule-template.test.ts`／`email-reminder-template.test.ts`（各自
    新增 1 個涵蓋 `storeLogoUrl`／`storeAddress` 的測試案例，既有案例全數保留未改）
  - `ai/artifacts/Email 通知與提醒/feature-spec.md`（追加範圍決策段落）
  - `ai/artifacts/Email 通知與提醒/screen-spec-通知信視覺版型.md`（新增）
  - `ai/artifacts/Email 通知與提醒/mockup-decision-確認信版型.md`（新增，記錄
    Header 採變體 C／Footer 採變體 B 的混搭決策）
  - `ai/artifacts/Email 通知與提醒/mockups/confirmation-email-variant-a/b/c.html`／
    `confirmation-email-selected.html`（新增，mockup 檔案）
- 執行過的指令：
  - `npx tsc --noEmit`／`npm run lint`／`npm run build`：皆通過。
  - `npx vitest run`（新增/修改的 6 個測試檔案）：117/117 通過。
  - `npm test`（完整套件）：476/478 通過，2 個失敗皆為既有
    `tests/components/account-settings-view.test.tsx` 在系統負載高時的
    `userEvent` 逾時（5000ms），與本卡改動的檔案（`lib/email/`、
    `app/api/webhooks/`、`app/api/cron/`）完全無關；單獨重跑該檔案在負載較低時
    可 32-33/33 通過，逾時筆數隨當下系統負載波動，屬於 TASK-051 完成證據已記錄
    過的既有 flaky 現象。
  - `npm run test:notifications`：19/19 通過，無回歸。
  - `npx vercel deploy --prod --yes`：重新部署，讓正式環境反映本卡的程式碼變更。
  - 正式環境手動驗證：用 service role 建立一筆真實測試預約（`customer_email`
    設為使用者本人的 Resend 帳號註冊信箱），觸發正式環境的 Database Webhook →
    確認信寄送鏈路，`confirmation_sent_at` 成功設定（無錯誤 log），驗證完成後
    已刪除測試資料。
- 測試輸出：見上方「執行過的指令」各項通過筆數。
- 螢幕截圖：使用者已在真實信箱（Gmail）確認收到的確認信，Header Logo banner 與
  Footer「路口理髮廳・02-1234-5678・台北市大安區忠孝東路四段1號」簽章皆顯示正常
  （使用者於對話中口頭確認「顯示正常」，未另外附檔案截圖）。
- 已知限制：
  - Email 客戶端字體 fallback（Georgia／系統字體）非 Noto Serif TC 本尊，屬於
    email 媒介的既有技術限制，已於 `screen-spec-通知信視覺版型.md` 記錄。
  - 深色模式信箱的自動反轉行為未特別處理（多數 email 客戶端的深色模式是「自動
    反轉」，效果不可控），維持單一淺色版型，符合業界交易型信件慣例。
  - 本卡風險等級低，依 `ai/process/definition-of-ready.md`「高風險工作額外要求」
    的界定範圍，未另外呼叫 architect／security-reviewer 子代理審查（不涉及新
    密鑰、新權限、新信任邊界，`resolveStoreDisplay` 的既有白名單機制原樣重用）；
    `escapeHtml` 覆蓋範圍已於 `tests/lib/email-layout.test.ts` 逐項測試涵蓋
    （含 `<img>` 屬性注入案例）。
- 後續任務：無新增預期；若使用者後續想連帶調整取消/改期/提醒信各自的內文文案
  （非本卡範圍），屬於獨立任務卡。
