# AI-Ready 任務卡

## Metadata

- 任務：多位設計師 後台週曆／列表設計師標示與多選篩選、預約詳情顯示設計師、改期依原設計師計算時段
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：多位設計師
- 上層 User Story：後台依設計師檢視預約
- 分軌：前後端串接
- 前置任務（dependsOn）：TASK-068, TASK-072
- 狀態：就緒前審查中（人工已於 2026-10-21 核准；動工前先完成 architect／security-reviewer 架構審查）
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
  - `lib/admin/reschedule-slots.ts`（佔用時段依 `designer_id` 過濾；該設計師請假日回傳無時段）
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

## 驗證契約

- 單元測試：`designer-filter.ts` 多選規則；`reschedule-slots.ts` 依設計師過濾與請假日。
- 整合測試：`test:admin-booking` 新增「兩位設計師同時段，各自改期互不影響」與「改期撞到同設計師回 `SLOT_CONFLICT`」。
- E2E 測試：Browser 走查勾選一位 → 再勾一位 → 取消全部回到「全部」→ 開詳情 → 改期。
- 型別檢查／Lint／Build：`npx tsc --noEmit`、`npm run lint`、`npm run build`
- 螢幕截圖：全部、勾一位（含請假標示）、勾兩位、詳情、改期、列表、篩選空狀態、暗色模式。
- 安全性檢查：不適用（只讀既有授權範圍內的資料）。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：
- 已知限制：
- 後續任務：無
