# AI-Ready 任務卡

## Metadata

- 任務：多位設計師 後台週曆／列表設計師標示與多選篩選、預約詳情顯示設計師、改期依原設計師計算時段
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：多位設計師
- 上層 User Story：後台依設計師檢視預約
- 分軌：前後端串接
- 前置任務（dependsOn）：TASK-068, TASK-072
- 狀態：完成（人工驗收通過，2026-10-22；實作與驗證完成，見 [`verification/TASK-075.md`](../verification/TASK-075.md)；人工已於 2026-10-21 核准；動工前 architect／security-reviewer 審查已於 2026-10-22 完成並採納，見「動工前審查定案」；範圍補列兩個檔案已於 2026-10-22 由使用者同意）
- 風險等級：中（改期時段計算若沒過濾設計師，後台會顯示錯誤的可選時段；資料庫 exclusion constraint 仍是最後防線）
- Agent owner：Claude Code
- 人工核准者：使用者

## 目標

依 mockup Variant A（改多選）讓後台週曆、列表、預約詳情顯示設計師，提供多選篩選與請假日標示，並讓改期
表單只用該預約原本設計師的預約與請假日計算可選時段。

## 情境包（Context Pack）

- 相關檔案：
  - `ai/artifacts/多位設計師/screen-spec-預約週曆設計師篩選.md`、`mockup-decision-預約週曆設計師篩選.md`（多選規則）
  - `ai/artifacts/多位設計師/mockups/calendar-designer-variant-a.html`（畫面 1、2、2b、3、4）
  - `app/admin/_components/AdminDashboard.tsx`、`WeekCalendar.tsx`、`AppointmentListView.tsx`、`AppointmentDetailDialog.tsx`
  - `lib/admin/appointments.ts`、`lib/admin/reschedule-slots.ts`、`tests/admin/reschedule-slots.test.ts`
- 既有模式：週曆資料一次讀整週；改期時段在前端用 `buildSlotGrid` 計算（`reschedule-slots.ts` 檔頭說明）。
- 假設：篩選在前端過濾，不重新查詢；篩選 state 放 `AdminDashboard`，切週次與切檢視時保留，重新整理後重設。
- 未知事項：無。
- 允許變更的檔案：
  - `lib/admin/appointments.ts`（select 加 `designer_id, designers(id, name, avatar_url)`）
  - `lib/admin/designers.ts`（動工前審查補列，使用者 2026-10-22 同意：新增 `getDesignerFilterOptions`、`getDesignerLeavesInRange`，並 export `isRealDate`）
  - `lib/admin/reschedule-slots.ts`（佔用時段依 `designer_id` 過濾；該設計師請假日回傳無時段）
  - `tests/business-hours.integration.test.ts`（動工前審查補列，使用者 2026-10-22 同意：既有「後台改期表單與 RPC 一致性」測試呼叫的簽名會變）
  - `tests/admin/designers.test.ts`（新增兩個查詢函式的單元測試）
  - `lib/admin/designer-filter.ts`（新增，多選規則純函式）
  - `app/admin/_components/AdminDashboard.tsx`、`WeekCalendar.tsx`、`AppointmentListView.tsx`、`AppointmentDetailDialog.tsx`
  - `app/admin/_components/DesignerFilterChips.tsx`（新增）
  - `tests/admin/appointments.test.ts`、`tests/admin/reschedule-slots.test.ts`、`tests/admin/designer-filter.test.ts`（新增）
  - `tests/admin-booking.integration.test.ts`（改期依設計師的案例）
- 不得觸碰：`rescheduleAppointment` 的 update 欄位（不能加入 `designer_id`；資料庫也沒有 grant）。

## 需求

- 篩選 Chip：「全部」加各設計師（頭像、名字、本週預約數）；多選規則依 mockup-decision。停用中但本週有預約的
  設計師也要出現，並標示「已停用」。
- 事件卡：勾選 0 位（全部）或 2 位以上時顯示「頭像＋名字」；只勾 1 位時隱藏。
- 請假標示：勾選的設計師在該週的請假日，日期格顯示「○○請假」（需要讀 `designer_leaves`，admin 有權限）。
- 列表檢視：新增「設計師」欄，套用同樣的篩選。
- 詳情 Modal：新增「設計師」列。
- 改期表單：設計師欄唯讀並說明「改期不能更換設計師」；可選時段只算該設計師。
- 篩選後該週沒有預約：空狀態文案依 screen-spec。

## 驗收標準

- 多選規則的每一條都有對應的單元測試。
- 改期時，其他設計師同時段有預約不會讓該時段被排除；同設計師有預約則會被排除。
- 既有週曆、列表、詳情、改期功能回歸正常。

## 實作備註

- 本週預約數以目前週次資料在前端計算，排除已取消。

## 動工前審查定案（architect／security-reviewer，2026-10-22，非人工核准）

**資料層**
- `getDesignerFilterOptions`、`getDesignerLeavesInRange` 放 `lib/admin/designers.ts`（依資料表分檔慣例）；`isDesignerOnLeave` 放 `reschedule-slots.ts`。
  `isRealDate` 從 `designers.ts` export，請假查詢的日期先過嚴格 `YYYY-MM-DD` 真實日期檢查。請假範圍查詢依日期範圍讀全部設計師、前端再過濾，不傳 `.in()`。
- 週曆與詳情查詢的 select 抽成共用欄位常數＋`toWeekAppointment(row)`，兩個查詢一致；embed 寫 `designers(id, name, avatar_url)`，
  不用 `*`、不用 `!inner`，攤平處理物件／陣列／null 三種形狀。整週查詢不帶電話、email。
- `getOccupiedRangesForDate` 改物件參數 `{ date, designerId, excludeAppointmentId }`，加 `.eq("designer_id", designerId)`；
  **fail-closed**：`designerId` 為 null、非合法 uuid 都回 `{ ok: false }`，不送請求，不退回全店計算也不回空陣列。
- `computeAvailableSlots` 新增必填 `isDesignerLeaveDate`（與查詢函式 `isDesignerOnLeave` 區分命名）；為 true 回空陣列。
- Dialog：`Promise.all` 加入請假查詢，四個查詢任一失敗 → 錯誤分支（fail-closed）；請假日與公休日一樣**直接給空 cells、不呼叫 `buildSlotGrid`**
  （否則會畫出一整排灰掉的按鈕且沒有說明）；`designerId` 取 `detail?.designer_id ?? appointment.designer_id`，放進 effect 依賴。
- 改期表單對停用中設計師不擋（後台受信任、資料庫 exclusion constraint 是最後防線），可加「已停用」提示。

**篩選規則**
- `toggleDesigner` 以 effective 選取為基礎運算（`setSelected(toggleDesigner(effective, id))`）；「全部」亮起與「清除篩選」顯示一律看 `effective.length`。
- 補測試：「全部勾選後切到多一位停用 chip 的週次」行為（交集、該設計師預約被隱藏）；停用設計師在 chip 列的排序（與啟用中混排依 `sort_order`）。
- 空狀態：只在 effective 非空且篩選後為空時用「○○本週沒有預約」（多位依 `sort_order` 以「、」串接）；整週本來就沒預約沿用「本週沒有預約」。
- 只有一位設計師時照規格顯示 chip 列，不自行隱藏。

**畫面**
- `DesignerFilterChips` 含「清除篩選」文字按鈕、載入中 Skeleton、「已停用」標示，並 export 共用 `DesignerAvatar`
  （`resolveDesignerAssetUrl` 白名單、`slotProps.img.referrerPolicy="no-referrer"`、`designerInitial`），Chip／事件卡／列表／詳情／改期五處共用。
  走查時用 DOM 確認 Chip 的 `<img>` 真的帶 `referrerpolicy`。
- 設計師名稱與顧客名稱用 `<bdi>` 包起來，容器 `overflow: hidden`＋ellipsis，Chip 加 `maxWidth`，計數放獨立元素；詳情 Modal 可換行但同樣裁溢出。
- 列表 `colSpan` 5 → 6。

**測試**
- 單元：`designerId` 無效／null 回錯誤且不送請求；請假查詢失敗回錯誤；`getOccupiedRangesForDate` 用兩個不同 id 同時斷言 `.eq("designer_id", D)` 與 `.neq("id", A)`。
- 整合（真實 Supabase，`__TEST__` 設計師，`customer_email: null`，第二位設計師用 `createTestDesigner` 並記下 id 給 `cleanupTestDesigners`）：
  其他設計師同時段有預約不排除，**且同一測試內有正向對照（同設計師確實被排除、查詢確實有回傳資料列），避免 RLS 回空時恆真**；
  請假日的 RLS 讀取；`tests/business-hours.integration.test.ts` 的 TS 與 RPC 一致性改成依設計師（RPC 傳 `p_designer_id`）。
- 走查：只動 `__TEST__` 設計師與預約，不替「預設設計師」加請假，不改期真實預約；請假與「已停用」截圖用停用的 `__TEST__` 設計師、40 天後的週次，
  做完立刻清除；截圖不含真實個資、不 commit。

**登記為已知限制（不在本卡處理）**
- 停用中設計師、設計師沒開此服務、請假日，改期都只在前端檢查（資料庫不強制）；表單開著期間另一分頁新增請假仍可改期成功。
  TASK-072 登記的殘留由「改期不看請假日」更新為「改期請假檢查只在前端」。
- 設計師 options 掛載時只查一次，另一分頁新增或停用設計師要重新整理才看得到。
- 後續卡建議：`customer_name` 資料庫字元檢查（方向控制字元，既有風險）、`DesignersTable` 頭像補 `referrerPolicy`。

## 驗證契約

- 單元測試：`designer-filter.ts` 多選規則；`reschedule-slots.ts` 依設計師過濾與請假日。
- 整合測試：`test:admin-booking` 新增「兩位設計師同時段，各自改期互不影響」與「改期撞到同設計師回 `SLOT_CONFLICT`」。
- E2E 測試：Browser 走查勾選一位 → 再勾一位 → 取消全部回到「全部」→ 開詳情 → 改期。
- 型別檢查／Lint／Build：`npx tsc --noEmit`、`npm run lint`、`npm run build`
- 螢幕截圖：全部、勾一位（含請假標示）、勾兩位、詳情、改期、列表、篩選空狀態、暗色模式。
- 安全性檢查：不新增 migration／grant／API route；逐項檢查「動工前審查定案」的 fail-closed、最小欄位、頭像白名單、`<bdi>` 與裁切、
  整合測試與走查只動 `__TEST__` 資料。

## 完成證據

詳見 [`verification/TASK-075.md`](../verification/TASK-075.md)。

- 變更的檔案：`lib/admin/{appointments,designers,reschedule-slots,designer-filter}.ts`；`app/admin/_components/{AdminDashboard,WeekCalendar,AppointmentListView,AppointmentDetailDialog,DesignerFilterChips}.tsx`；
  測試 `tests/admin/{appointments,designers,reschedule-slots,designer-filter}.test.ts`、`tests/components/{week-calendar,designer-filter-chips,appointment-list-view,appointment-detail-dialog}.test.tsx`、
  `tests/{admin-booking,business-hours}.integration.test.ts`；`vitest.{admin-booking,business-hours}.config.ts`（加 `@` 別名，範圍外的必要連動）；`ai/context/design-system.md`（inventory）。
- 執行過的指令：`npx tsc --noEmit`、`npm run lint`、`npm run build`、`npx vitest run --maxWorkers=3`（1026／1030，4 項為未改動檔案的 5 秒逾時，單獨重跑全過）、
  `npm run test:admin-booking`（16／16）、`npm run test:business-hours -- -t "後台改期表單"`（1／1）。
- 測試輸出：見驗證報告。
- 螢幕截圖：Browser 工具擷取，未存成專案檔案（含 `__TEST__` 資料）。
- 已知限制：停用設計師／沒開服務／請假日改期只在前端檢查；options 掛載時只查一次；顧客名稱方向控制字元為既有風險。
- 後續任務：建議另開兩張（見驗證報告）——`customer_name` 資料庫字元檢查；`DesignersTable` 頭像補 `referrerPolicy`。
