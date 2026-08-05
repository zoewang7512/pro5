# AI-Ready 任務卡

## Metadata

- 任務：顧客預約流程 前端：頁面骨架、服務列表與選時段
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：顧客預約流程
- 上層 User Story：顧客瀏覽服務並選日期時段
- 分軌：前端
- 前置任務（dependsOn）：TASK-010
- 狀態：完成，已人工驗收（2026-08-05；使用者於本機 `npm run dev` 實機畫面確認無問題）
- 風險等級：中（純前端＋呼叫既有 RPC，無新的資料庫變更，但涉及顧客可見的預約邏輯正確性）
- Agent owner：待指定
- 人工核准者：使用者，2026-08-05

## 目標

建立 `app/page.tsx` 頁面骨架（S5 單頁捲動變體 B 外殼）、`lib/booking/` 的 RPC 呼叫封裝
（`get_available_slots`／`create_appointment` 的 TS 型別與呼叫函式），並實作前兩個區塊：
服務列表（可選擇）、選時段（依選定服務展開，顯示可預約時段）。

## 情境包（Context Pack）

- 相關檔案：`app/page.tsx`（TASK-010 完成後仍是預留骨架，本卡實際建立內容）、
  `lib/supabase/client.ts`（既有 Supabase client 封裝，RPC 呼叫基於此）、
  `ai/context/design-system.md`（S3 token／S4 元件庫）、
  [`customer-flow-variant-b.html`](../專案設置/mockups/customer-flow-variant-b.html)
  （已核准的版型參考，畫面 1-2）。
- 既有模式：直接用 MUI 元件＋`lib/theme` token（Card／Button／既有樣式），不新建元件；
  服務卡片選定狀態、時段格 active/disabled 樣式比照 mockup 呈現的視覺語言（金色 outline／
  filled 表示 active，灰階表示 disabled）。`lib/booking/` 封裝比照 `lib/supabase/` 的
  薄封裝風格：型別 + 呼叫函式，不含 UI 邏輯。
- 假設：日期選擇先支援「本週＋下週」的日期範圍（依 mockup 呈現的日期 chip 列，涵蓋
  `get_available_slots` 允許的 90 天視野中最常用的近期範圍；更長範圍的日期選擇視使用
  情況於後續調整，不在本卡預先擴大範圍）。
- 未知事項：無。
- 允許變更的檔案：`app/page.tsx`、`app/_components/booking/`（新增，本頁面專用的區塊
  元件，非 `components/ui/` 通用元件庫）、`lib/booking/`（新增）。
- 不得觸碰：填寫資訊／成功頁區塊（TASK-012 範圍，但 TASK-012 會延伸本卡建立的
  `lib/booking/`，加入 `create_appointment` 的呼叫函式——本卡只需確保 `lib/booking/`
  的檔案結構容易擴充，不要把它設計成封閉、難以新增函式的形式）。

## 需求

- `lib/booking/` 封裝：`getAvailableSlots(serviceId, date)` 呼叫 `get_available_slots`
  RPC，回傳型別化的可預約時段陣列；統一處理 RPC 回傳的 `{ok, data}` / `{ok, error_code,
  message}` 形狀，轉成 TS 這邊好用的 `Result<T, BookingError>` 型別（或等價設計）。
- `app/page.tsx` 頁面骨架：套用 S5 選定的單頁捲動版型外殼（區塊標題／收合摘要列的容器
  結構），抓取 `services` 列表。
- 服務列表區塊：卡片列出 `services`（名稱／時長／價格），點擊選定一筆，顯示 selected 樣式。
- 選時段區塊：選定服務後才顯示（比照 mockup 的「已完成區塊收合為摘要列＋修改連結」互動）；
  呼叫 `getAvailableSlots` 取得可預約時段，日期 chip＋時段格皆為可點擊，已佔用／非營業
  時間格顯示為 disabled、不可點擊。
- 兩區塊皆有 loading（抓資料中）與空狀態（無啟用服務／當日無空檔）畫面。
- 選定時段後，把「服務＋時段」的選擇狀態往上傳給頁面層 state，供 TASK-012 接續使用（介面
  以 props／context 明確定義，方便 TASK-012 串接，且不要求 TASK-012 修改本卡建立的檔案
  核心邏輯，只做擴充）。

## 驗收標準

- 服務列表正確反映 `services` 種子資料，只顯示 `is_active=true`。
- 選時段區塊只在選定服務後出現；已佔用／非營業時間的格子不可點擊，不會等使用者點了才提示。
- loading／空狀態皆有對應畫面，且畫面元素只用 S4 已入庫元件與 S3 token。
- `npx tsc --noEmit`／`npm run lint`／`npm run build` 皆通過。

## 實作備註

- 這是單頁組件的一部分，與 TASK-012 共用同一個 `app/page.tsx`；把本卡的區塊拆成獨立子
  元件（如 `ServiceListSection`／`SlotPickerSection`），方便 TASK-012 在同一頁面接續加入
  自己的區塊，不要把邏輯全塞在單一巨大元件裡。

## 驗證契約

- 單元測試：不適用（頁面互動邏輯，較適合用 E2E／整合驗證；若拆出可獨立測試的純函式如
  「時段格是否可點擊」的判斷邏輯，補上對應單元測試）。
- 整合測試：不適用（涵蓋在 TASK-013）。
- E2E 測試：不適用（涵蓋在 TASK-013）。
- 型別檢查：`tsc --noEmit` 成功。
- Lint：`npm run lint` 成功。
- Build：`npm run build` 成功。
- 螢幕截圖：行動裝置尺寸（375-414px，對應目標使用者「行動裝置為主」的假設）截圖服務
  列表（預設／載入中／空狀態）、選時段（預設／載入中／空狀態／disabled 格）。
- 安全性檢查：不適用（無新增資料存取邊界，沿用 TASK-010 的 RPC）。

## 完成證據

- 變更的檔案：
  - `lib/booking/types.ts`（新增：`Service`／`BusinessHours`／`AvailableSlot`／
    `BookingError`／`Result<T>` 型別）
  - `lib/booking/api.ts`（新增：`getServices`／`getBusinessHours`／`getAvailableSlots`，
    統一把 Supabase 的 PostgrestError 與 RPC 的 `{ok,data}`/`{ok,error_code,message}`
    jsonb 轉成 `Result<T>`）
  - `lib/booking/date-range.ts`（新增：`getTaipeiToday`／`buildDateRange` 純函式，供日期
    chip 列使用）
  - `lib/booking/slot-grid.ts`（新增：`buildSlotGrid` 純函式，把 `business_hours` 的營業
    時間與 `get_available_slots` 回傳的可預約時段合併成含 disabled 標記的完整時段格陣列）
  - `app/_components/booking/SectionChrome.tsx`（新增：`SectionHeader`／`SummaryLine`／
    `formatPrice`，兩區塊共用的「已完成收合為摘要列＋修改連結」樣式）
  - `app/_components/booking/ServiceListSection.tsx`（新增：服務列表區塊，含
    loading/error/空狀態）
  - `app/_components/booking/SlotPickerSection.tsx`（新增：選時段區塊，含日期 chip、
    時段格 grid（disabled 由 `buildSlotGrid` 標記）、loading/error/空狀態）
  - `app/_components/booking/BookingFlow.tsx`（新增：頁面層 client component，擁有
    服務／時段選擇 state，串接 `lib/booking/api.ts`）
  - `app/page.tsx`（改為渲染 `BookingFlow`，取代原本的佔位文字）
  - `tests/booking/date-range.test.ts`（新增：2 個案例）
  - `tests/booking/slot-grid.test.ts`（新增：5 個案例，涵蓋公休日、營業時間格點計算、
    disabled 標記、全數無空檔情境）
  - `tests/booking/api.test.ts`（新增：6 個案例，用最小假 `SupabaseClient` 驗證
    `lib/booking/api.ts` 的錯誤形狀轉換——PostgrestError／已知 RPC error_code／未知
    error_code／頂層呼叫失敗，皆正確轉成 `Result<T>` 且不外洩底層錯誤細節；此為
    security-maintainability-review 過程中發現的測試缺口補上）
- 執行過的指令：
  - `npx tsc --noEmit` — 通過
  - `npm run lint` — 通過（過程中發現並修正 MUI v9 `Stack`/`Typography` 不再支援
    `justifyContent`/`alignItems`/`fontWeight` 等捷徑 prop，需改用 `sx`；以及
    `react-hooks/set-state-in-effect` 規則不允許在 effect 內同步呼叫 `setState` 重設為
    loading，改用「fetch 結果存 `{key, status, data}`，render 時比較 key 是否對應目前
    依賴值來推導 loading 狀態」的寫法）
  - `npm test` — 通過（19 個測試，含本卡新增的 13 個測試：7 個純函式單元測試＋
    6 個 `lib/booking/api.ts` 錯誤形狀轉換測試）
  - `npm run build` — 通過（Turbopack production build 成功，`/` 路由為 Static）
  - Browser 工具（行動裝置 375×812）對本機 `npm run dev` 連線真實 Supabase 專案手動驗證：
    - 服務列表正確顯示 3 筆種子服務（剪髮造型 45 分鐘 NT$800／染髮設計 120 分鐘
      NT$2,400／頭皮護理 60 分鐘 NT$1,200），選定後正確收合為摘要列＋「修改」連結
    - 選時段區塊在選定服務後才出現，14 天日期 chip 正確渲染；選一個工作日（週四 8/6）
      時，時段格從 10:00 到 18:00 共 17 格，與 TASK-010 完成證據記錄的手動驗證結果一致
      （同一 `business_hours`／服務時長下應得到相同格點數，交叉驗證前後端計算邏輯一致）
    - 選定今天（8/5，此時已超過大多數格點的「現在＋1小時」下限）時正確顯示空狀態
      「當日時段皆已被預約，請選擇其他日期。」，不會顯示不可點擊的格子讓使用者誤觸
    - 點「修改」正確回到服務列表且收合選時段區塊
    - 瀏覽器 console 無錯誤／警告（除 React DevTools 提示）
- 測試輸出：`npm test` 19/19 通過（含 `tests/booking/date-range.test.ts`、
  `tests/booking/slot-grid.test.ts`、`tests/booking/api.test.ts`）。
- 螢幕截圖：本次驗證環境的 Browser 工具面板未於使用者端顯示，無法取得像素截圖；改用
  accessibility tree（`read_page`）與 `get_page_text` 逐狀態擷取文字/結構作為驗證證據
  （見上）。已驗證：服務列表預設狀態、選定後收合摘要列、選時段預設狀態（14 天 chip＋
  17 個時段格）、選時段空狀態。**已知限制**：未能實際擷取「部分時段被佔用（disabled
  與可點擊格並存）」的畫面，因目前 Supabase 專案資料在測試當下沒有落在候選日期範圍內
  的既有預約可製造這種情境（若要人工重現，需另外對測試專案寫入一筆未來預約再手動核對，
  未在本卡執行以避免污染既有資料）；此邏輯已由 `tests/booking/slot-grid.test.ts` 的
  「已被佔用的時段標記為 disabled，其餘維持可點擊」案例做單元測試覆蓋，判斷邏輯正確性
  已確認，缺的只是真實環境的視覺截圖。若需要視覺驗收，建議 TASK-013 整合驗證時一併
  補上（該卡本來就會建立測試用預約資料）。
- 已知限制：
  - 服務列表／選時段的 loading 狀態（骨架屏）因本機開發環境對本地 Supabase 專案查詢
    速度極快，手動操作時難以穩定截到 loading 中間態；程式碼邏輯上兩個 fetch 都有明確
    的 loading 狀態分支（見 `ServiceListSection`／`SlotPickerSection` 的 `status ===
    "loading"` 分支），未另外用人工延遲製造截圖。
  - 日期範圍固定為「今天起 14 天」，未讀取 `services`/`business_hours` 之外的設定來
    決定範圍長度，符合任務卡「未知事項：無」與「假設」段落的既定範圍。
  - 「填寫資訊」區塊（TASK-012 範圍）尚未實作；`selectedService`／`selectedSlot`
    state 已在 `BookingFlow` 內明確定義，TASK-012 可直接讀取並新增第三區塊，不需修改
    本卡建立的 `ServiceListSection`／`SlotPickerSection`／`lib/booking/` 核心邏輯。
- 後續任務：TASK-012（填寫資訊與預約成功）、TASK-013（整合驗證，含本卡遺留的
  「部分時段 disabled 視覺截圖」與 loading 態截圖，建議一併在該卡使用測試 fixture 資料
  補齊）。
