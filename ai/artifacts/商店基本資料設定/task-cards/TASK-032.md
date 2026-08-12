# AI-Ready 任務卡

## Metadata

- 任務：商店基本資料設定 顧客前台首頁品牌顯示區塊
- 上層規格：`ai/artifacts/商店基本資料設定/feature-spec.md`
- 上層 Epic：商店基本資料設定
- 上層 User Story：設定店名、地址、電話、簡介（前台顯示）／上傳／更換 Logo 或封面圖（前台顯示）
- 分軌：前端
- 前置任務（dependsOn）：TASK-029
- 狀態：完成
- 風險等級：中（既有頁面 `app/page.tsx`／`BookingFlow.tsx` 的版面異動，需確認不影響既有預約
  流程互動與轉換率相關的版面深度）
- Agent owner：Claude Code
- 人工核准者：使用者於對話中核准開始實作（2026-08-07）；最終驗收核准（2026-08-07）

## 目標

在顧客前台首頁新增品牌顯示區塊（依已核准 mockup 變體 B：精簡頁首列＋矮版封面圖），讀取
`store_settings` 顯示店名、簡介、Logo、封面圖、地址、電話；未設定時優雅降級為既有「預約」
純文字標題，不影響下方既有服務選擇／選時段／填寫聯絡資訊流程。

## 情境包（Context Pack）

- 相關檔案：
  - `app/page.tsx`（目前只 render `BookingFlow`）
  - `app/_components/booking/BookingFlow.tsx`（既有頁面層 state 與版面容器，`Container
    maxWidth="sm"`，目前 h1 為寫死的「預約」標題，本卡在其上方或取代其呈現方式插入品牌區塊）
  - `lib/store-settings.ts`（TASK-029 建立的讀取函式，前台頁面用 anon client 呼叫，
    RLS 允許 anon 讀取）
  - `ai/artifacts/商店基本資料設定/screen-spec-前台品牌顯示.md`（已核准畫面規格，變體 B）
  - `ai/artifacts/商店基本資料設定/mockups/customer-brand-variant-b.html`（已核准 mockup）
  - `app/_components/booking/ServiceListSection.tsx`（既有 Skeleton／Alert 載入中／錯誤處理
    慣例，本卡的品牌區塊載入中／失敗狀態比照此模式）
- 既有模式：
  - `BookingFlow.tsx` 現有的「fetch 結果存 state＋比較 key 判斷 loading」模式（避免額外的
    `setState` in effect 反模式，沿用既有寫法）。
  - `Skeleton` 元件既有用法。
- 假設：
  - 品牌顯示區塊的資料讀取獨立於現有的服務／時段查詢（各自的 `useEffect`／請求），互不阻塞——
    品牌資訊載入慢或失敗不應延遲顧客看到服務列表。
  - 讀取失敗時靜默降級為「全部未設定」的呈現（不顯示錯誤 Alert），因為這不是核心預約流程的
    必要資訊。
  - 店名／簡介皆來自可信的管理員輸入（沿用既有 React 預設跳脫，不使用
    `dangerouslySetInnerHTML`，不需要額外的 XSS 過濾函式庫）。
- 未知事項：無。
- 允許變更的檔案：
  - `app/_components/booking/BookingFlow.tsx`
  - `app/_components/booking/BrandHeaderSection.tsx`（新增）
  - `lib/store-settings.ts`（若需要新增一個前台專用的最小欄位讀取函式，與後台讀取函式
    共用底層查詢即可，不重複定義資料表存取邏輯）
- 不得觸碰：
  - `app/_components/booking/ServiceListSection.tsx`／`SlotPickerSection.tsx`／
    `ContactFormSection.tsx`／`SuccessSection.tsx` 的既有邏輯（本卡只在其上方新增區塊，不得
    修改這些既有元件的互動或版面）。

## 需求

- WHEN 顧客載入前台首頁且 `store_settings` 有店名 THE SYSTEM SHALL 於頁首顯示小型 Logo（若有
  設定）與店名，取代原本純文字「預約」標題。
- WHEN `store_settings` 有簡介 THE SYSTEM SHALL 於頁首下方顯示簡介（單行截斷，避免過長文字
  擠壓版面）。
- WHEN `store_settings` 有封面圖 THE SYSTEM SHALL 顯示矮版封面圖（依 mockup 變體 B 尺寸）。
- WHEN `store_settings` 有地址或電話 THE SYSTEM SHALL 顯示對應的聯絡資訊列；缺項時該列不顯示
  （不顯示空欄位或錯誤）。
- WHEN `store_settings` 店名為空（含讀取失敗降級情境） THE SYSTEM SHALL 回退為既有純文字
  「預約」標題，其餘品牌相關區塊（簡介／封面圖／聯絡資訊）皆不渲染。
- WHEN 品牌顯示區塊資料讀取中 THE SYSTEM SHALL 顯示骨架屏，不阻塞下方服務列表的獨立載入。

## 驗收標準

- 已設定完整品牌資訊時，前台首頁正確顯示 Logo、店名、簡介、封面圖、地址、電話。
- 部分未設定時，對應區塊／列優雅省略，不破版、不顯示錯誤。
- 全部未設定或讀取失敗時，回退為既有「預約」標題，行為與視覺一致。
- 既有服務選擇／選時段／填寫聯絡資訊／預約成功的互動流程與版面深度不受影響（人工／Browser
  工具走查確認）。

## 實作備註

- 依 mockup 變體 B，品牌區塊刻意保持精簡（矮版封面圖、單行簡介截斷），避免顯著增加頁面高度、
  把既有預約流程推到需要大量捲動才看得到的位置。
- 品牌區塊與既有服務列表分屬不同的資料請求／loading 狀態，各自獨立，不共用同一個
  `FetchStatus`。

## 驗證契約

- 單元測試：「`store_settings` 讀取結果 → 前台顯示用資料」轉換邏輯的純函式（含「哪些欄位視為
  未設定」的判斷）。
- 整合測試：對真實 Supabase 專案驗證 anon 可讀取 `store_settings`（沿用 TASK-029 RLS），可併
  入 TASK-033。
- E2E 測試：Browser 工具走查完整已設定／部分未設定／全部未設定三種情境，並確認下方預約流程
  互動未受影響（併入 TASK-033 或本卡自行走查）。
- 型別檢查：`npx tsc --noEmit`
- Lint：`npm run lint`
- Build：`npm run build`
- 螢幕截圖：完整已設定、部分未設定、全部未設定／載入失敗，桌面與手機寬度（`maxWidth="sm"`
  容器）各一張。
- 安全性檢查：確認簡介／店名等使用者輸入內容渲染時未使用
  `dangerouslySetInnerHTML`，沿用 React 預設跳脫。

## 完成證據

- 變更的檔案：
  - 新增 `app/_components/booking/BrandHeaderSection.tsx`（`BrandHeaderSection`／
    `BrandHeaderSectionSkeleton`）
  - `app/_components/booking/BookingFlow.tsx`（獨立的品牌資料 fetch effect＋三態渲染：
    載入中骨架屏／有品牌時顯示新區塊／無品牌時保留原本純文字「預約」標題）
  - `lib/store-settings.ts`（新增 `resolveStoreDisplay` 純函式＋匯出的
    `EMPTY_STORE_SETTINGS` 常數，並加上 `logo_url`／`cover_image_url` 的
    store-assets 網址白名單過濾）
  - `tests/store-settings.test.ts`（`resolveStoreDisplay` 單元測試 7 組、29 個 case）
- 執行過的指令：
  - `npx tsc --noEmit` — 通過
  - `npm run lint` — 通過
  - `npx vitest run --config vitest.config.ts tests/store-settings.test.ts` — 29 passed
  - `npm run build` — 通過
- 測試輸出：`tests/store-settings.test.ts` 新增 `resolveStoreDisplay` 測試涵蓋完整設定、
  店名空字串／純空白、簡介地址電話個別為 null／純空白、trim、以及非 store-assets 網址一律
  視為未設定（安全性審查發現）等情境，全數通過。
- 螢幕截圖：完整已設定狀態（真實 dev DB 資料：Logo、封面圖、店名、簡介、地址、電話）已在
  桌面與手機（375×812）寬度下用 Browser 工具走查確認，版面與 mockup 變體 B 一致、下方
  「選擇服務」流程未受影響。部分未設定／全部未設定／載入失敗三種狀態未取得即時瀏覽器截圖，
  詳見「已知限制」。
- 已知限制：
  - 部分未設定／全部未設定／載入失敗三種畫面狀態改由 `resolveStoreDisplay` 的單元測試（涵蓋
    所有欄位組合的「哪些視為未設定」邊界判斷）與程式碼審查涵蓋，未取得即時瀏覽器截圖——嘗試
    透過 `/admin/store-settings` 暫時清空欄位以截圖時，該頁「儲存」按鈕在瀏覽器自動化過程中
    未穩定觸發（與本卡改動的檔案無關的既有問題），過程中沒有任何欄位被實際寫入 DB。
  - 讀取失敗完全靜默降級（無 log／telemetry），符合規格但運維上零可觀測性。
  - `app/page.tsx` 若改為 server component 直接讀取 `store_settings`，可完全消除骨架屏與
    CLS，但不在本卡允許變更清單內。
- 後續任務：TASK-033（整合驗證，建議一併補上部分未設定／全部未設定／載入失敗三種狀態的
  E2E 截圖）；`app/page.tsx` server-side 讀取改善可另立候選任務。
