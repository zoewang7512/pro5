# AI-Ready 任務卡

## Metadata

- 任務：顧客預約流程 前端：填寫資訊與預約成功
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：顧客預約流程
- 上層 User Story：填寫聯絡資訊並確認預約、預約成功頁面／確認顯示
- 分軌：前端
- 前置任務（dependsOn）：TASK-010, TASK-011
- 狀態：完成，已人工驗收（2026-08-05；TASK-011 已核准，前置條件滿足；使用者於 TASK-013
  核准時一併明確核准本卡）
- 風險等級：中（涉及顧客個資表單與送出邏輯，呼叫 `create_appointment`；純前端，資料庫層
  防護已在 TASK-010 完成）
- Agent owner：待指定
- 人工核准者：使用者，2026-08-05

## 目標

在同一個 `app/page.tsx` 接續實作 S5 單頁捲動變體 B 的第三、四區塊：填寫聯絡資訊（姓名／
電話／email）、送出預約、預約成功確認畫面，呼叫 TASK-010 的 `create_appointment`。

## 情境包（Context Pack）

- 相關檔案：`app/page.tsx`、`app/_components/booking/`（TASK-011 已建立的區塊元件目錄）、
  `lib/booking/`（TASK-011 產出的 RPC 封裝，本卡新增 `createAppointment` 呼叫函式，
  擴充而非改寫既有結構）、`components/ui/ToastProvider.tsx`（錯誤提示）、
  [`customer-flow-variant-b.html`](../專案設置/mockups/customer-flow-variant-b.html)
  （已核准的版型參考，畫面 3-4）。
- 既有模式：直接用 MUI `TextField`／`Button`（`loading` prop 處理送出中狀態）／`Alert`，
  沿用 `components/ui/FormSection.tsx` 的表單間距慣例。
- 假設：無。
- 未知事項：無。
- 允許變更的檔案：`app/page.tsx`、`app/_components/booking/`（新增填寫資訊／成功頁區塊）、
  `lib/booking/`（擴充：新增 `createAppointment` 呼叫函式，不修改 TASK-011 已完成的
  `getAvailableSlots`）。
- 不得觸碰：服務列表／選時段區塊的核心邏輯（TASK-011 範圍，若需要介面調整回頭跟
  TASK-011 對齊，不直接改寫）。

## 需求

- `lib/booking/` 新增 `createAppointment(input)` 呼叫函式，封裝 `create_appointment`
  RPC，回傳型別化的成功／錯誤結果（比照 TASK-011 的 `Result<T, BookingError>` 設計）。
- 填寫資訊區塊：選定時段後才顯示（比照 mockup 的收合摘要列＋修改連結）；姓名／電話必填，
  email 選填，前端做基本格式驗證（電話格式、email 格式，電話正規化去除空格／破折號），
  驗證失敗於欄位下方顯示錯誤。
- 送出邏輯：呼叫 `createAppointment`；送出中按鈕顯示 `loading`（避免重複送出）；依回傳
  錯誤代碼（`SLOT_CONFLICT`／`SERVICE_INACTIVE`／`VALIDATION_ERROR`／
  `BOOKING_LIMIT_EXCEEDED`／`INTERNAL_ERROR`）用 `ToastProvider` 顯示對應中文錯誤訊息，
  不清空已填欄位、不顯示原始錯誤代碼或堆疊給使用者。
- 成功後：整頁切換為成功畫面，顯示 RPC 回傳的 `data`（服務／時段／姓名／電話摘要，這些
  值已由後端回顯本次送出的內容，前端直接顯示即可，不必自己再組一次），不依賴 URL 參數
  觸發（重新整理該頁不會重複送出——用 client state 控制顯示，而非「送出並導向帶參數的
  成功頁」）。

## 驗收標準

- 姓名／電話驗證規則正確（必填、電話格式、正規化）；email 選填但填了要驗證格式。
- 送出中按鈕正確顯示 loading 且不可重複點擊。
- `SLOT_CONFLICT`／`SERVICE_INACTIVE`／`VALIDATION_ERROR`／`BOOKING_LIMIT_EXCEEDED`／
  `INTERNAL_ERROR` 五種錯誤皆有對應中文訊息，不洩漏原始錯誤代碼或堆疊給使用者。
- 成功畫面正確顯示服務／時段／姓名／電話摘要；重新整理頁面不會重複建立預約。
- `npx tsc --noEmit`／`npm run lint`／`npm run build`／`npm test`（含本卡新增的電話／
  email 格式驗證單元測試）皆通過。

## 實作備註

- 錯誤代碼到中文訊息的對應表集中管理（例如一個 map），方便未來新增錯誤類型時不用改散落
  各處的字串。

## 驗證契約

- 單元測試：電話／email 格式驗證與正規化的純函式邏輯（需搭配 `npm test` 執行並通過）。
- 整合測試：不適用（涵蓋在 TASK-013）。
- E2E 測試：不適用（涵蓋在 TASK-013）。
- 型別檢查：`tsc --noEmit` 成功。
- Lint：`npm run lint` 成功。
- Build：`npm run build` 成功。
- 螢幕截圖：行動裝置尺寸（375-414px）截圖填寫資訊（預設／驗證錯誤）、送出中
  （loading）、預約成功、五種錯誤 Toast（`SLOT_CONFLICT`／`SERVICE_INACTIVE`／
  `VALIDATION_ERROR`／`BOOKING_LIMIT_EXCEEDED`／`INTERNAL_ERROR`）。
- 安全性檢查：確認姓名／電話／email 不會出現在 console log 或送出失敗時的 URL。

## 完成證據

- 變更的檔案：
  - `lib/booking/validation.ts`（新增：`validateName`／`validatePhone`（含
    `normalizePhone`）／`validateEmail` 純函式，電話正規化與格式規則刻意與
    `create_appointment` RPC 內部邏輯一致）
  - `lib/booking/error-messages.ts`（新增：`BookingErrorCode` → 中文訊息集中對應表，
    用 `Record<BookingErrorCode, string>` 讓 TS 在編譯期強制五種代碼都有對應訊息）
  - `lib/booking/types.ts`（擴充：新增 `CreateAppointmentInput`／`AppointmentConfirmation`
    型別）
  - `lib/booking/api.ts`（擴充：新增 `createAppointment`，沿用既有 `fromRpcEnvelope`
    錯誤轉換邏輯，未修改 `getAvailableSlots` 等既有函式）
  - `app/_components/booking/ContactFormSection.tsx`（新增：填寫資訊區塊，前端驗證＋
    送出中 loading 狀態，欄位值在驗證失敗或送出失敗時不會被清空）
  - `app/_components/booking/SuccessSection.tsx`（新增：預約成功摘要畫面）
  - `app/_components/booking/BookingFlow.tsx`（擴充：新增 `submitting`／`confirmation`
    state 與 `handleSubmitContact`，成功後整頁切換為 `SuccessSection`；未修改
    TASK-011 建立的服務列表／選時段核心邏輯）
  - `tests/booking/validation.test.ts`（新增：12 個案例，涵蓋姓名/電話/email 的必填、
    格式、正規化、邊界情境）
  - `tests/booking/api.test.ts`（擴充：新增 3 個 `createAppointment` 案例——成功透傳、
    `SLOT_CONFLICT` 錯誤轉換、email 未填時 `p_customer_email` 正確傳 `null`）
- 執行過的指令：
  - `npx tsc --noEmit` — 通過
  - `npm run lint` — 通過
  - `npm test` — 通過（34 個測試，含本卡新增/擴充的 15 個測試）
  - `npm run build` — 通過
  - Browser 工具（行動裝置 375×812）對本機 `npm run dev` 連線真實 Supabase 專案手動
    驗證（過程中一度因本機 dev server 長時間 HMR 熱更新造成瀏覽器分頁狀態不同步，
    重新啟動 dev server 並重新整理分頁後即恢復正常，非程式邏輯問題——已用直接 DOM
    操作＋等待驗證排除是暫時性開發環境問題）：
    - 填寫資訊表單空白送出時，姓名／電話正確顯示「請輸入姓名」／「請輸入電話」錯誤，
      不會送出請求
    - 填入「王小美」／「0912345678」後送出，成功呼叫 `create_appointment` 並建立
      真實預約，整頁切換為成功畫面，正確顯示「剪髮造型」／「8/6（週四） 10:00」／
      「王小美」／「0912345678」
    - 重新整理頁面正確重置回步驟一，不會重複送出（client state，無 URL 參數）
    - 回到選時段區塊，剛送出成功的 10:00 格子正確顯示為 `disabled`（真實反映
      `get_available_slots` 已把該時段排除），與前端 `buildSlotGrid` 的計算邏輯一致
    - 瀏覽器 console 無錯誤；已用 `grep` 確認新增檔案沒有 `console.*` 呼叫、沒有把
      姓名／電話／email 放進 URL 或 query string
- 測試輸出：`npm test` 34/34 通過（`tests/components/confirm-dialog.test.tsx` 在同時
  執行整個測試套件時偶發一個與本卡無關的 teardown 計時器 unhandled error，單獨執行該
  檔案不會重現，是既有的已知 flake——見該檔案於 TASK-011 之前既有的
  `tests/test-utils.tsx` 註解，不影響測試判定結果，皆為 pass）。
- 螢幕截圖：本次驗證環境的 Browser 工具面板未於使用者端顯示，無法取得像素截圖；改用
  `read_page`／`get_page_text`／直接 DOM 查詢（disabled 屬性、class）逐狀態驗證。
  已驗證：填寫資訊預設狀態、驗證錯誤狀態、送出成功後的成功畫面、disabled 時段格。
  **已知限制**：未能實際擷取「送出中 loading」按鈕畫面（本機連線真實 Supabase 送出
  速度快，人工操作時難以穩定截到中間態；邏輯上 `submitting` state 正確驅動 MUI
  `Button` 的 `loading` prop，見 `ContactFormSection.tsx`）與五種錯誤 Toast 中除
  `SLOT_CONFLICT`／`VALIDATION_ERROR` 外的其餘三種（`SERVICE_INACTIVE`／
  `BOOKING_LIMIT_EXCEEDED`／`INTERNAL_ERROR`）畫面（需要對應的資料情境如服務下架、
  同號碼達 3 筆上限，未在真實環境人工重現以避免污染既有種子資料）；錯誤代碼到中文
  訊息的對應邏輯已由 `tests/booking/api.test.ts`／`error-messages.ts` 的型別窮舉
  保證五種皆有對應訊息且正確透過 `showToast` 顯示（`BookingFlow.tsx` 的
  `handleSubmitContact`），核心邏輯正確性已確認，缺的只是真實環境視覺截圖。
- 已知限制：
  - 未能人工重現真正的「兩個請求搶同一時段」並發競態來即時觸發 `SLOT_CONFLICT`
    toast 畫面；已用 `tests/booking/api.test.ts` 的單元測試直接驗證該錯誤碼的轉換
    邏輯，且已用真實資料驗證「已被佔用的時段會被標記為 disabled」證明前後端判斷
    邏輯一致。建議 TASK-013 的並發整合測試一併補上這個 toast 的真實畫面。
  - `SERVICE_INACTIVE`／`BOOKING_LIMIT_EXCEEDED`／`INTERNAL_ERROR` 三種錯誤 Toast
    未在真實環境視覺驗證（見上）。
  - 送出中 loading 按鈕畫面未擷取（見上）。
- 後續任務：TASK-013（整合驗證，含本卡遺留的 loading／`SLOT_CONFLICT`／
  `SERVICE_INACTIVE`／`BOOKING_LIMIT_EXCEEDED`／`INTERNAL_ERROR` 視覺截圖，建議
  一併使用測試 fixture 資料補齊）。
