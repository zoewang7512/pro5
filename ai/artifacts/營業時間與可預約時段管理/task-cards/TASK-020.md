# AI-Ready 任務卡

## Metadata

- 任務：營業時間與可預約時段管理 技術債修正：後台週曆串接 `business_hours`
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：營業時間與可預約時段管理
- 上層 User Story：設定每週固定營業時間（技術債部分）
- 分軌：前端
- 前置任務（dependsOn）：TASK-018
- 狀態：完成（Done，人工審核通過，2026-08-06）
- 風險等級：中（修改既有共用元件 `WeekCalendar.tsx`／`AdminDashboard.tsx`，屬於「預約管理
  後台」Epic 已上線功能的資料來源異動，需要確認不影響既有的預約顯示邏輯；不涉及新的資料
  寫入或 RLS 邊界變更）
- Agent owner：Claude Code
- 人工核准者：使用者（2026-08-06，指名要求「繼續做 TASK-020」，視為核准開始實作）；
  architect 核准（2026-08-06，approve with minor suggestions，非阻擋）

## 目標

把後台週曆（`WeekCalendar.tsx`）的公休日判斷從寫死的 `isClosedWeekday()`（固定
`weekday === 0`）改成查詢 `business_hours.is_closed`，讓公休日顯示與 TASK-018/019 建立的
營業時間設定頁、以及既有的資料庫層（`get_available_slots` RPC）、改期表單
（`getBusinessHoursForWeekday()`）三處一致。這是 TASK-014 完成證據裡記錄的既知技術債
（見 `ai/artifacts/預約管理後台/task-cards/TASK-014.md` 完成證據第 3 點），本卡負責結清。

## 情境包（Context Pack）

- 相關檔案：
  - `lib/admin/week-range.ts`（`isClosedWeekday(weekday: number): boolean` 目前寫死
    `weekday === 0`，本卡移除這個函式；`WEEKDAY_LABELS`／`getWeekday()`／`buildWeekDays()`
    等其他函式不受影響，不要動）
  - `app/admin/_components/WeekCalendar.tsx`（唯一呼叫 `isClosedWeekday()` 的地方，第 12 行
    `import`、第 60 行呼叫；已確認 `AppointmentListView.tsx` 沒有使用這個函式，不需要
    修改）
  - `app/admin/_components/AdminDashboard.tsx`（本卡要新增讀取 `business_hours` 的邏輯，
    掛載時呼叫一次 `getAllBusinessHours`（TASK-018 已建立），把結果整理成
    `closedWeekdays: Set<number>` 往下傳給 `WeekCalendar`）
  - `lib/admin/business-hours.ts` 的 `getAllBusinessHours()`（TASK-018 已建立，本卡直接
    重用，不新增查詢函式）
  - `tests/admin/week-range.test.ts`（既有測試檔，若涵蓋 `isClosedWeekday()` 的案例需要
    同步移除）
- 既有模式：`AdminDashboard.tsx` 目前已有一個掛載時的資料讀取 pattern（週次 appointments
  查詢，依 `weekStart`／`refetchToken` 觸發），本卡新增的 `business_hours` 讀取**不需要**
  跟著這兩個依賴重新查詢——營業時間變更頻率遠低於預約異動，掛載時查一次即可（見下方
  「假設」）。
- 假設：`business_hours` 讀取採「頁面掛載時查一次，不即時同步」的簡化取捨——若設計師在
  另一個分頁透過 TASK-019 的設定頁改了公休日，目前這個週曆頁面分頁不會自動更新，需要重新
  整理頁面才會看到最新設定。這與「預約」資料的即時反映（`refetchToken`）行為不同，需要在
  完成證據記錄為已知限制，不在本卡解決跨分頁即時同步（規格書「驗證計畫」與「使用者旅程」
  沒有要求跨分頁即時同步，屬於合理簡化）。
- 未知事項：無。
- 允許變更的檔案：`lib/admin/week-range.ts`（移除 `isClosedWeekday()`）、
  `app/admin/_components/WeekCalendar.tsx`（改用傳入的 `closedWeekdays` prop 取代
  `isClosedWeekday()` 呼叫）、`app/admin/_components/AdminDashboard.tsx`（新增讀取
  `business_hours` 並往下傳）、`tests/admin/week-range.test.ts`（移除已刪除函式的測試
  案例）。
- 不得觸碰：`app/admin/business-hours/`／`BusinessHoursForm.tsx`（TASK-018/019 範圍）；
  `AppointmentListView.tsx`（已確認不需要修改，不要順手加公休判斷進去，維持範圍最小）；
  `lib/admin/appointments.ts`／`lib/admin/reschedule-slots.ts` 的既有函式邏輯。

## 需求

- `WeekCalendar.tsx` 新增 prop `closedWeekdays: Set<number>`，內部原本呼叫
  `isClosedWeekday(day.weekday)` 的地方改成 `closedWeekdays.has(day.weekday)`。
- `AdminDashboard.tsx`：
  - 掛載時（`useEffect`，依賴陣列為空或僅在初次渲染執行一次）呼叫 `getAllBusinessHours`，
    成功後把回傳的 7 列轉成 `Set<number>`（只收集 `is_closed === true` 的 `weekday`）存進
    state，傳給 `WeekCalendar` 的 `closedWeekdays` prop。
  - 查詢失敗時：`closedWeekdays` 維持空集合（不顯示任何公休弱化效果），不阻擋週曆本身的
    渲染，不跳出額外的錯誤訊息——公休顯示是次要的視覺輔助資訊，查詢失敗不應該讓整個週曆
    頁面不可用。
- `lib/admin/week-range.ts`：移除 `isClosedWeekday()` 函式與其匯出。
- 確認並清理程式碼庫內對 `isClosedWeekday` 的所有殘留引用（`grep` 確認移除後無編譯錯誤）。

## 驗收標準

- 透過 TASK-019 建立的營業時間設定頁把某天的公休狀態改變後，重新載入 `/admin` 後台週曆，
  該天的公休顯示（灰底弱化＋「公休」文字）正確反映新設定，不再固定顯示週日公休。
- `isClosedWeekday()` 已從 `lib/admin/week-range.ts` 移除，程式碼庫（含測試檔）無殘留引用。
- `business_hours` 查詢失敗時，後台週曆本身仍正常渲染（只是公休弱化效果不顯示），不會整頁
  出錯。
- `npx tsc --noEmit`／`npm run lint`／`npm run build`／`npm test` 皆通過。

## 實作備註

- 這是本卡範圍內少數會修改「預約管理後台」Epic 既有已上線程式碼的任務卡，改動前先確認
  `WeekCalendar.tsx`／`AdminDashboard.tsx` 目前的其餘邏輯（事件卡渲染、今天標示、
  `onEventClick` 等）完全不受影響，只新增/替換公休判斷這一個資料來源，不要順便重構其他
  部分。
- `tests/admin/week-range.test.ts` 若有涵蓋 `isClosedWeekday()` 的測試案例，移除該函式時要
  一併移除對應測試，不要留下針對已刪除函式的失敗測試。

## 驗證契約

- 單元測試：`tests/admin/week-range.test.ts` 更新（移除已刪除函式的案例，確認其餘既有
  案例仍通過）；若 `AdminDashboard.tsx` 把 `business_hours` 轉 `Set<number>` 的邏輯抽成
  獨立純函式，需要對應單元測試。
- 整合測試：不適用（涵蓋在 TASK-021，會驗證公休日設定變更後週曆是否正確反映）。
- E2E 測試：不適用（涵蓋在 TASK-021）。
- 型別檢查：`tsc --noEmit` 成功。
- Lint：`npm run lint` 成功。
- Build：`npm run build` 成功。
- 螢幕截圖：桌面尺寸截圖修改公休日前後的後台週曆對照（同一天，改設定前後各一張）。
- 安全性檢查：不適用（本卡不涉及新的資料寫入或權限邊界變更，沿用 TASK-018 已建立的讀取
  函式）。

## 完成證據

- 變更的檔案：
  - `lib/admin/week-range.ts`：移除 `isClosedWeekday()` 與其匯出，其餘函式不變。
  - `app/admin/_components/WeekCalendar.tsx`：新增必填 prop `closedWeekdays: Set<number>`，公休判斷改成
    `closedWeekdays.has(day.weekday)`；事件卡渲染、今天標示、`onEventClick` 等其餘邏輯未變動。
  - `app/admin/_components/AdminDashboard.tsx`：新增掛載時執行一次（依賴陣列 `[supabase]`，不隨
    `weekStart`／`refetchToken` 重跑）的 `useEffect`，呼叫 `getAllBusinessHours` 把回傳列轉成
    `Set<number>`（只收 `is_closed === true`）存進 `closedWeekdays` state 並往下傳；查詢失敗時維持空集合，
    不阻擋週曆渲染、不跳額外錯誤訊息。
  - `tests/admin/week-range.test.ts`：確認未涵蓋 `isClosedWeekday()`，無需異動；其餘既有案例原樣保留。
- 執行過的指令：
  - `npx tsc --noEmit`（乾淨）
  - `npm run lint`（0 problems）
  - `npx vitest run`（11 files / 75 tests passed，與 TASK-019 完成時數量相同，未新增/刪除案例）
  - `npm run build`（成功，`/admin`、`/admin/business-hours` 仍為 dynamic route）
  - 瀏覽器（Browser 工具）對真實 Supabase 專案手動走查：於 `/admin/business-hours` 把週一切成公休並儲存
    → 重新整理該頁確認寫入持久化 → 切到 `/admin` 週曆確認週一正確顯示「· 公休」（不再固定只有週日）→
    改回週一 10:00–19:00（比照 `scripts/seed-booking-data.mjs` 原始種子值）並儲存 → 重新整理兩頁分別確認
    設定與週曆皆已還原為僅週日公休
- 測試輸出：`Test Files 11 passed (11)` / `Tests 75 passed (75)`。
- 螢幕截圖：沿用 TASK-018/019 記錄的既有 Browser pane 限制（screenshot 逾時），改以
  accessibility tree（`read_page`）／`get_page_text`／`javascript_tool` 讀取 DOM 狀態取得對照證據
  （設定頁 checkbox/time input 值、`/admin` 週曆文字內容），變更前後皆已核對。
- 已知限制：
  1. `closedWeekdays` 只在 `AdminDashboard` 掛載時查詢一次；若另一個分頁透過設定頁修改公休日，本分頁
     需要重新整理（或切換頁面觸發重新掛載）才會看到最新結果——任務卡預先記錄的已知限制，未變更範圍
     內解決跨分頁即時同步。
  2. `closedWeekdays` 的推導只看 `is_closed` 欄位，未比照 `isAppointmentOutsideHours()`／
     `get_available_slots` RPC 對 `open_time`/`close_time` 為 null 的保守判斷；因
     `business_hours_valid_range` constraint 與 seed script 保證現有 7 列資料完整，architect 審查判定為
     理論風險、可接受，非本卡範圍內處理。
  3. `business_hours` 查詢失敗時公休弱化效果會 fail-open（誤判為全部開放，不顯示公休提示，也不跳錯誤
     訊息）——這是任務卡明確要求的簡化行為（公休顯示屬次要視覺輔助資訊，查詢失敗不應該讓整個週曆頁面
     不可用），architect 審查同意此為刻意取捨並接受。
  4. `AppointmentListView.tsx`（列表檢視）沒有公休判斷，任務卡已確認不需要修改、維持範圍最小；
     architect 審查指出這代表 Epic 使用者旅程裡「週曆＋列表」兩種檢視只有週曆反映公休設定，屬既有狀態、
     不在本卡允許變更檔案範圍內，留待後續評估是否需要補上。
  5. architect 審查建議把 `closedWeekdays` 的推導邏輯抽成 `lib/admin/business-hours.ts` 的獨立純函式並
     補單元測試，以恢復 TASK-014 原本用具名函式讓公休規則可單元測試的特性。因 `lib/admin/business-hours.ts`
     不在本卡允許變更的檔案清單內（任務卡明確要求「不新增查詢函式」），且該推導僅 2 行、無獨立分支邏輯，
     判定為不影響本卡驗收標準的優化建議，未採納，留待後續任務評估。
- 後續任務：TASK-021（整合驗證）。
