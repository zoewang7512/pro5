# AI-Ready 任務卡

## Metadata

- 任務：營業時間與可預約時段管理 特殊公休日設定頁串接（月曆選取器＋受影響預約警告）
- 上層規格：[`feature-spec.md`](../feature-spec.md)（第二批次）、
  [`screen-spec-營業時間設定.md`](../screen-spec-營業時間設定.md)
- 上層 Epic：營業時間與可預約時段管理
- 上層 User Story：設定公休日／特殊假期
- 分軌：前後端串接
- 前置任務（dependsOn）：TASK-022, TASK-023
- 狀態：完成
- 風險等級：中（新增頁面區塊、寫入 `closed_dates`；沿用既有 `is_admin()` RLS 邊界，不新增
  anon 可觸及的寫入介面，風險與 TASK-019 相當）
- Agent owner：claude
- 人工核准者：使用者，2026-08-07（「沒問題」）

## 目標

在 `/admin/business-hours` 頁面新增「特殊公休日」區塊：用 TASK-023 的 `MonthPicker`
讓設計師點選日期新增／移除整天公休標記，寫入 TASK-022 的 `closed_dates`；新增時若有受影響
的未來預約，顯示二次確認警告（沿用 TASK-019 建立的既有互動模式）。

## 情境包（Context Pack）

- 相關檔案：
  - `app/admin/_components/BusinessHoursForm.tsx`：本卡要在這個檔案的既有 return 區塊裡，
    緊接在既有 `<Stack>`（週表格＋儲存按鈕）之後掛載新元件 `<ClosedDatesSection />`（見
    下方「允許變更的檔案」），比照 mockup 的垂直排列；不修改 `BusinessHoursForm.tsx` 既有
    的任何邏輯（週表格的編輯/儲存/警告流程完全不變），只新增一行掛載新元件。
  - `components/ui/MonthPicker.tsx`（TASK-023 產出）：`MonthPickerProps`（`year`／`month`／
    `todayDate`／`markedDates`／`onDayClick`／`onMonthChange`）。
  - `lib/admin/closed-dates.ts`（TASK-022 產出）：`getAllClosedDates`／`addClosedDate`／
    `removeClosedDate`／`findAffectedAppointmentsForClosedDate`。
  - `components/ui/ConfirmDialog.tsx`：`children` 插槽模式（TASK-019 已建立，見
    `BusinessHoursForm.tsx` 第 291-325 行的既有用法），本卡的受影響預約警告 Modal 直接沿用
    同一個元件、同一種插槽模式，不新建對話框元件。
  - `ai/artifacts/營業時間與可預約時段管理/mockups/business-hours-closures-variant-b.html`
    （已核准的視覺與互動規格：月曆＋右側清單兩欄版面、清單每筆一個移除按鈕）。
- 既有模式：`BusinessHoursForm.tsx` 的 `warningAppointments`／`handleConfirmSaveWithWarning`
  是本卡受影響預約警告流程的直接範本（送出前查受影響預約 → 有則顯示警告 Modal 需二次確認
  → 無則直接寫入 → 成功後重新整理清單），但本卡是獨立的新元件、獨立的 state，不與
  `BusinessHoursForm.tsx` 既有的 `warningAppointments` state 共用或耦合。
- 假設：
  - 新元件 `ClosedDatesSection` 自己建立 Supabase client（`useMemo(() => createClient(),
    [])`，比照 `BusinessHoursForm.tsx`／`AdminDashboard.tsx` 的既有寫法），不透過 props
    接收，維持元件自我完備、與 `BusinessHoursForm.tsx` 零耦合。
  - 月曆預設顯示「今天所在的月份」（`getTaipeiToday()` 算出的年月），使用者可透過
    `MonthPicker` 的導覽箭頭切換到未來月份新增公休日；不限制能切換到多遠的未來（後台是
    受信任內部使用者，比照 `reschedule-slots.ts` 不套用 90 天視野的既有假設）。
  - 點擊月曆上「已標記」的日期＝觸發移除（不顯示警告，見 feature-spec 非目標：移除不影響
    既有預約合法性）；點擊「未標記」的日期＝觸發新增流程（可能顯示警告）。這個切換邏輯
    在 `onDayClick` 回呼裡用 `markedDates.has(date)` 判斷，`MonthPicker` 本身不知道這個
    語意（見 TASK-023 的既有設計）。
  - 右側清單顯示全部已設定的公休日（不受目前月曆顯示的月份限制，清單是全域清單，月曆只是
    其中一種新增/檢視的介面），比照 mockup 右側 `list-col` 的既有設計。
- 未知事項：無。
- 允許變更的檔案：
  - `app/admin/_components/ClosedDatesSection.tsx`（新增）
  - `app/admin/_components/BusinessHoursForm.tsx`（只新增一行掛載 `<ClosedDatesSection
    />`，不修改既有邏輯）
- 不得觸碰：`lib/admin/closed-dates.ts`（TASK-022 範圍，只呼叫不修改）、
  `components/ui/MonthPicker.tsx`（TASK-023 範圍，只呼叫不修改）、
  `components/ui/ConfirmDialog.tsx`（只使用既有 `children` 插槽，不修改該元件本身）、
  `app/admin/_components/WeekCalendar.tsx`／`AdminDashboard.tsx`（TASK-026 範圍）。

## 需求

- `ClosedDatesSection.tsx` 需要處理的狀態（比照
  [`screen-spec-營業時間設定.md`](../screen-spec-營業時間設定.md) 「特殊公休日區塊狀態」
  表）：
  - 掛載時查詢 `getAllClosedDates`，載入中顯示 `Skeleton`（比照既有 Skeleton 用法），
    失敗顯示錯誤訊息＋不阻擋頁面其他部分（比照 `BusinessHoursForm.tsx` 頂層錯誤處理的
    既有寬鬆度，不需要完全一致，本卡可以簡化成一則 `Alert severity="error"`）。
  - 清單為空時顯示空狀態提示「尚無設定的特殊公休日」（比照 mockup 的 `Alert
    severity="info"` 風格，比照 `WeekCalendar.tsx` 既有的空狀態寫法）。
  - `onDayClick(date)`：
    - 若 `date` 已在 `markedDates` 中：直接呼叫 `removeClosedDate`，成功後重新查詢清單、
      顯示成功 Toast；失敗顯示錯誤 Toast（比照既有 `showToast` 用法）。
    - 若 `date` 不在 `markedDates` 中：先驗證 `date >= getTaipeiToday()`（過去日期理論上
      `MonthPicker` 已經不可點擊，這裡是最後一層防呆，直接忽略不處理，不需要跳錯誤訊息，
      因為使用者從 UI 上根本點不到）；接著呼叫 `findAffectedAppointmentsForClosedDate`，
      若有受影響預約則存進 state 顯示警告 Modal（記錄下待新增的 `date`），若無則直接呼叫
      `addClosedDate`。
  - 警告 Modal（`ConfirmDialog`）：標題「部分預約將落在新的公休日」、說明文字
    `"${date}（週${weekdayLabel}）目前有 N 筆未來預約會受影響："`（`weekdayLabel` 用
    `WEEKDAY_LABELS[getWeekday(date)]`，從 `lib/admin/week-range.ts` import），`children`
    插槽渲染受影響預約清單（比照 `BusinessHoursForm.tsx` 既有的清單渲染樣式：顧客姓名 +
    日期時段，逐筆一行），確認按鈕文案「仍要新增」、取消按鈕「再想想」。確認後呼叫
    `addClosedDate`，成功關閉 Modal＋重新整理清單＋成功 Toast，失敗保留 Modal 開啟＋錯誤
    Toast（比照 `BusinessHoursForm.tsx` 既有的失敗不關閉 Dialog 慣例）。
  - 右側清單：每筆顯示 `date`（格式化為 `YYYY/MM/DD` + 星期，比照 mockup）與一個移除按鈕
    （直接呼叫 `removeClosedDate`，不顯示警告，比照上方 `onDayClick` 對已標記日期的處理，
    這裡可以重用同一段移除邏輯）。
- 版面：`MonthPicker` 在左、清單在右，兩欄式（比照 mockup 的 `section-card` 兩欄版面，用
  MUI `Stack direction="row"` 或 `Box sx={{display:"flex"}}` 皆可）。

## 驗收標準

- 設計師可在頁面上透過月曆點選日期新增／移除特殊公休日，清單即時反映。
- 新增時若有受影響的未來預約，顯示警告並需二次確認才寫入；沒有受影響預約則直接寫入，不
  顯示警告。
- 移除不顯示警告，直接刪除。
- 過去日期無法透過 UI 新增（`MonthPicker` 本身已擋，這裡不需要重複的可見錯誤訊息）。
- 查詢／寫入失敗時顯示對應的錯誤處理（不外洩原始 Postgres 錯誤內容）。
- `npx tsc --noEmit`／`npm run lint`／`npm run build`／`npm test` 皆通過。

## 實作備註

- `ClosedDatesSection` 是全新獨立元件，不要為了「共用一個 Supabase client」或「共用一個
  Toast provider 呼叫」就去修改 `BusinessHoursForm.tsx` 的既有結構——`useToast()` 是
  `ToastProvider` 提供的 hook，`ClosedDatesSection` 直接呼叫 `useToast()` 取得自己的
  `showToast`，不需要透過 props 從 `BusinessHoursForm.tsx` 傳遞。
- 月曆目前顯示的年月是本元件自己的 state（例如 `React.useState(() =>
  parseTaipeiToday-based-year-month)`），不是全域狀態，頁面重新整理後永遠回到「今天所在的
  月份」，這是合理的簡化（比照 `AdminDashboard.tsx` 的 `weekStart` 也是每次掛載重置為本週，
  沒有記住使用者上次瀏覽到哪一週）。

## 驗證契約

- 單元測試：本卡邏輯以資料串接與互動流程為主，沒有新的獨立純函式需要抽出測試（日期格式化
  可重用既有 `lib/admin/format.ts` 的函式，若既有函式不敷使用才新增，新增的話要補測試）。
- 整合測試：不適用（本卡不新增整合測試，留給 TASK-027）。
- E2E 測試：Browser 工具桌面尺寸走查，涵蓋新增（無警告／有警告兩種路徑）、移除、空狀態、
  跨月導覽。
- 型別檢查：`tsc --noEmit` 成功。
- Lint：`npm run lint` 成功。
- Build：`npm run build` 成功。
- 螢幕截圖：桌面尺寸，涵蓋預設（含清單）、空狀態、受影響預約警告 Modal 三種畫面。
- 安全性檢查：不適用（沿用 TASK-022 已建立的 RLS 邊界，本卡不新增權限判斷邏輯）。

## 完成證據

- 變更的檔案：
  - 新增 `app/admin/_components/ClosedDatesSection.tsx`
  - `app/admin/_components/BusinessHoursForm.tsx`（只新增 import 與 `<ClosedDatesSection />`
    掛載一行，經 architect 逐行核對確認未變更既有邏輯）
  - `lib/admin/format.ts`（新增 `formatDateSlash`，architect review 後從元件私有搬移）
  - 新增 `tests/components/closed-dates-section.test.tsx`（7 案例）、
    `tests/admin/format.test.ts`（2 案例）
  - `ai/context/project-map.md`（登記新檔案）
- 執行過的指令：`npx tsc --noEmit`／`npm run lint`／`npm test`（97 tests passed）／
  `npm run build`，皆通過。
- 子代理審查：architect（提出 3 項必改後已修正並重新驗證）、security-reviewer（通過，
  附帶建議見下方已知限制）、test-engineer（指出測試與螢幕截圖缺口，已補測試；螢幕截圖
  缺口為環境限制，見下方）。
- 瀏覽器互動走查：登入設計師帳號，實際操作 `/admin/business-hours`——預設狀態（含清單）、
  空狀態、跨月導覽、清單移除按鈕、日曆點選新增（無警告／有警告兩種路徑，含建立/取消一筆
  真實測試預約來觸發警告 Modal）皆確認行為正確；未能取得螢幕截圖（見已知限制）。
- 已知限制：
  1. （已解決）螢幕截圖原本因 Browser 工具 screenshot 逾時未能取得，人工核准後、面板重新
     顯示時已補拍到「預設（含清單）」「空狀態」「受影響預約警告 Modal」三種畫面，視覺與
     預期一致。
  2. `lib/admin/closed-dates.ts`／`components/ui/MonthPicker.tsx` 至今仍無單元測試
     （TASK-022/023 遺留缺口，非本卡範圍）。
  3. `closed_dates` 的 RLS 讀寫權限邊界仍無整合測試覆蓋，TASK-027 範圍已明確涵蓋，待該卡
     執行。
  4. architect 建議：`AffectedAppointmentList` 與 `BusinessHoursForm.tsx` 現有的受影響預約
     清單重複、清單未過濾過去日期、mockup 的 `section-card` 卡片外框與圖例未實作——皆為
     非阻斷建議，留給後續任務卡評估。
  5. security-reviewer 指出的 TOCTOU（受影響預約清單查詢與寫入之間非原子）比照 TASK-019
     既有流程的已知殘留風險，未在本卡處理。
- 後續任務：TASK-027（整合驗證）依賴本卡，範圍已涵蓋 closed_dates RLS 邊界測試。
