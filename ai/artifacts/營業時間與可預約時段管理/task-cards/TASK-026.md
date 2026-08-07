# AI-Ready 任務卡

## Metadata

- 任務：營業時間與可預約時段管理 後台週曆同步反映 `closed_dates`（特殊公休日）
- 上層規格：[`feature-spec.md`](../feature-spec.md)（第二批次）
- 上層 Epic：營業時間與可預約時段管理
- 上層 User Story：設定公休日／特殊假期
- 分軌：前端
- 前置任務（dependsOn）：TASK-022
- 狀態：完成
- 風險等級：中（修改既有共用元件 `WeekCalendar.tsx`／`AdminDashboard.tsx`，屬於「預約管理
  後台」Epic 已上線功能的資料來源異動；不涉及新的資料寫入或 RLS 邊界變更，風險與 TASK-020
  相當）
- Agent owner：claude
- 人工核准者：使用者，2026-08-07（「沒問題」）

## 目標

比照 TASK-020 已建立的「後台週曆改查資料庫」模式，讓 `WeekCalendar.tsx` 的公休日判斷除了
既有的 `closedWeekdays`（每週固定公休）之外，也查詢 `closed_dates`（特定日期公休），兩者
任一命中即顯示「公休」。

## 情境包（Context Pack）

- 相關檔案：
  - `app/admin/_components/WeekCalendar.tsx`：`closedWeekdays: Set<number>` prop 與
    `isClosed = closedWeekdays.has(day.weekday)` 判斷式（TASK-020 建立），本卡要在這裡
    合併第二個資料來源。
  - `app/admin/_components/AdminDashboard.tsx`：既有的 `closedWeekdays` state 與其
    `useEffect`（依賴陣列 `[supabase]`，只在掛載時查一次，見 TASK-020 完成證據），本卡的
    `closedDates` state **不能**沿用同一個「只查一次」的 effect 設計——`closed_dates` 是
    「特定日期」而非「每週固定規則」，使用者切換週次時，可見的日期範圍會變，若沿用只在
    掛載時查一次的 effect，切到未來幾週後新設定的特殊公休日不會顯示，這是本卡與
    TASK-020 在架構上的關鍵差異，見下方「假設」。
  - `lib/admin/closed-dates.ts`（TASK-022 產出）：`getClosedDatesInRange(supabase,
    startDate, endDate): Promise<Result<Set<string>>>`。
- 既有模式：`AdminDashboard.tsx` 既有的 `appointments` 查詢 effect（依賴
  `weekRange.weekStart`／`weekRange.weekEnd`，週次改變時重新查詢，用 `key`／`cancelled`
  guard 處理過期回應，見既有 `matchesRequest` 比對模式）是本卡 `closedDates` effect 的
  直接範本——本卡的 `closedDates` 查詢需要跟著週次變動重新查詢，架構上更接近這個既有
  effect，而不是 TASK-020 建立的「只查一次」的 `closedWeekdays` effect。
- 假設：
  - `closedDates` 的查詢依賴陣列包含 `weekRange.weekStart`／`weekRange.weekEnd`（切換
    週次時重新查詢），這是刻意的架構選擇（見上），不是自由心證。
  - 查詢失敗時 `closedDates` 維持既有值不變（或初始為空集合），比照 TASK-020 對
    `closedWeekdays` 查詢失敗的既有處理原則：不阻擋週曆本身的渲染，不跳出額外的錯誤
    訊息（公休顯示是次要的視覺輔助資訊）。
  - `AppointmentListView.tsx`（列表檢視）不需要修改——比照 TASK-020 完成證據記錄的既有
    結論：這個元件是純預約清單、沒有「每天一格」的版面結構，沒有公休標示可供改查，本卡
    維持同樣的範圍判斷。
- 未知事項：無。
- 允許變更的檔案：
  - `app/admin/_components/WeekCalendar.tsx`（新增 `closedDates` prop，合併判斷式）
  - `app/admin/_components/AdminDashboard.tsx`（新增 `closedDates` state 與對應 effect，
    傳給 `WeekCalendar`）
- 不得觸碰：`lib/admin/closed-dates.ts`（TASK-022 範圍，只呼叫不修改）、
  `AppointmentListView.tsx`（見上方假設，不需要修改）、`lib/admin/week-range.ts`、
  `WeekCalendar.tsx`／`AdminDashboard.tsx` 既有的 `closedWeekdays`／預約查詢相關邏輯（只
  新增，不重構既有部分）。

## 需求

- `WeekCalendar.tsx`：`WeekCalendarProps` 新增 `closedDates: Set<string>`；`isClosed`
  判斷式改為 `closedWeekdays.has(day.weekday) || closedDates.has(day.date)`。
- `AdminDashboard.tsx`：
  - 新增 `closedDates` state（初始為空 `Set<string>`）。
  - 新增 `useEffect`，依賴陣列含 `[supabase, weekRange.weekStart, weekRange.weekEnd]`，
    呼叫 `getClosedDatesInRange(supabase, weekRange.weekStart, weekRange.weekEnd)`，成功
    則更新 `closedDates` state；失敗維持原值、不顯示錯誤 Toast（比照 `closedWeekdays`
    既有的失敗處理原則）。需要 `cancelled` guard 避免週次快速切換時的過期回應覆蓋新回應
    （比照既有 `appointments` 查詢 effect 的既有寫法）。
  - `<WeekCalendar>` 新增 `closedDates={closedDates}` prop。

## 驗收標準

- 透過 TASK-025 建立的特殊公休日設定，把某天標記為公休後，重新載入 `/admin` 後台週曆、
  切到該天所在的週次，該天正確顯示「公休」（灰底弱化＋「公休」文字，比照既有視覺）。
- 該天若原本就是每週固定公休（`closedWeekdays` 命中）或現在額外被標記為特殊公休日
  （`closedDates` 命中），兩種情況皆正確顯示公休，不因為疊加就出現顯示異常。
- 切換週次時，`closedDates` 正確重新查詢並反映對應週次的特殊公休日設定（不是只在掛載時
  查一次）。
- `closed_dates` 查詢失敗時，後台週曆本身仍正常渲染，不會整頁出錯。
- `npx tsc --noEmit`／`npm run lint`／`npm run build`／`npm test` 皆通過。

## 實作備註

- 這是本批次第二次修改「預約管理後台」Epic 已上線的共用元件，比照 TASK-020 的既有提醒：
  改動前先確認 `WeekCalendar.tsx`／`AdminDashboard.tsx` 目前的其餘邏輯（事件卡渲染、今天
  標示、`onEventClick`、既有的 `closedWeekdays` 判斷）完全不受影響，只新增 `closedDates`
  這一個額外的資料來源，不要順便重構其他部分。
- 已知限制（沿用 TASK-020 記錄、本卡不重新處理）：跨分頁不即時同步——若設計師在另一個
  分頁透過 TASK-025 的設定頁改了特殊公休日，本分頁的週曆需要切換週次或重新整理才會反映
  最新設定（比照 `closedWeekdays` 既有的同類限制）。

## 驗證契約

- 單元測試：不適用（本卡是資料串接與 UI 合併判斷，沒有新的純函式邏輯需要抽出測試；
  `closedWeekdays.has(...) || closedDates.has(...)` 是簡單的布林運算，不需要獨立測試
  案例）。
- 整合測試：不適用（本卡不新增整合測試，留給 TASK-027；`getClosedDatesInRange` 本身的
  正確性已在 TASK-022 的資料層驗證範圍內）。
- E2E 測試：Browser 工具桌面尺寸走查，涵蓋「標記特殊公休日→切到對應週次→週曆正確顯示
  公休→移除→週曆恢復正常」的完整路徑。
- 型別檢查：`tsc --noEmit` 成功。
- Lint：`npm run lint` 成功。
- Build：`npm run build` 成功。
- 螢幕截圖：桌面尺寸，改變特殊公休日設定前後的後台週曆對照（同一天，改設定前後各一張，
  比照 TASK-020 既有驗證方式）。
- 安全性檢查：不適用（本卡不涉及新的資料寫入或權限邊界變更，沿用 TASK-022 已建立的讀取
  函式）。

## 完成證據

- 變更的檔案：
  - `app/admin/_components/WeekCalendar.tsx`（新增必填 prop `closedDates: Set<string>`，
    `isClosed` 改為 `closedWeekdays.has(day.weekday) || closedDates.has(day.date)`）
  - `app/admin/_components/AdminDashboard.tsx`（新增 `closedDates` state 與隨週次重新查詢
    的 effect，傳給 `WeekCalendar`）
  - 新增 `tests/components/week-calendar.test.tsx`（5 案例）
- 執行過的指令：`npx tsc --noEmit`／`npm run lint`／`npm test`（102 tests passed）／
  `npm run build`，皆通過。
- 子代理審查：architect（Approve）、security-reviewer（Approve）、test-engineer（判定驗證
  足夠，建議補元件測試，已補上），三者皆無阻斷性發現。
- 瀏覽器互動走查：透過 TASK-025 設定頁新增特殊公休日 2026-08-21（週五），切到對應週次確認
  `/admin` 週曆正確顯示「公休」、與既有每週固定公休（週日）並存不衝突；移除後確認週曆恢復
  正常；列表檢視不受影響。
- 已知限制：
  1. （已解決）螢幕截圖原本連續三次（TASK-023／TASK-025／TASK-026）遇到 Browser 工具
     screenshot 逾時，經人工重新打開 Browser 面板後已補拍到 8/18 標記公休前／後的週曆
     對照畫面，視覺與預期一致。
  2. 切換週次的瞬間，`closedDates` 查詢回來之前，該週真正的特殊公休日會短暫不顯示公休樣式
     （良性偽陰性，刻意的 fail-open 設計，任務卡已預期次要視覺資訊不阻擋主要內容）。
  3. 查詢失敗時的畫面與「真的沒有特殊公休日」無法區分（沿用既有 `closedWeekdays` 失敗處理
     原則，不跳錯誤 Toast）。
  4. 跨分頁不即時同步（沿用 TASK-020 已記錄的同類限制，本卡不重新處理）。
- 後續任務：TASK-027（整合驗證）依賴本卡。
