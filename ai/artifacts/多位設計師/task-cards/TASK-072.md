# AI-Ready 任務卡

## Metadata

- 任務：多位設計師 「請假」頁籤（月曆標記整天請假、受影響預約警告）
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：多位設計師
- 上層 User Story：設定設計師請假日
- 分軌：前後端串接
- 前置任務（dependsOn）：TASK-067, TASK-069
- 狀態：就緒前審查中（人工已於 2026-10-21 核准；動工前先完成 architect／security-reviewer 架構審查）
- 風險等級：低（`designer_leaves` 單純 insert／delete；請假日在預約路徑的強制執行屬於 TASK-068）
- Agent owner：Claude Code
- 人工核准者：使用者

## 目標

完成「請假」頁籤：月曆點選標記或取消整天請假、即將到來的請假清單、全店公休日唯讀標示、標記日已有該設計師
預約時顯示受影響預約警告。

## 情境包（Context Pack）

- 相關檔案：
  - `ai/artifacts/多位設計師/mockups/admin-designers-variant-a.html`（畫面 6）
  - `components/ui/MonthPicker.tsx`、`lib/admin/month-range.ts`
  - `app/admin/_components/ClosedDatesSection.tsx`、`lib/admin/closed-dates.ts`（`findAffectedAppointmentsForClosedDate`）
- 既有模式：直接比照 `ClosedDatesSection` 的「點選 → 查受影響預約 → `ConfirmDialog` children 列清單 → 寫入」流程。
- 假設：全店公休日（`closed_dates` 與每週固定公休）在月曆上以 `grey.200` 加刪除線標示，不能點。
- 未知事項：`MonthPicker` 目前只支援一種「已標記」樣式；若需要第二種（全店公休）樣式，要以選填 prop 擴充，並同步更新 inventory。
- 允許變更的檔案：
  - `lib/admin/designers.ts`（新增 `listDesignerLeaves`、`addDesignerLeave`、`removeDesignerLeave`、
    `findAffectedAppointmentsForDesignerLeave`）
  - `app/admin/_components/DesignerLeavesTab.tsx`（新增）
  - `app/admin/_components/DesignerEditView.tsx`（掛載頁籤、頁籤上的數字）
  - `components/ui/MonthPicker.tsx`（只允許新增選填 prop，不改既有行為）
  - `ai/context/design-system.md`（若 `MonthPicker` 有擴充，更新 inventory）
  - `tests/admin/designers.test.ts`、`tests/designers.integration.test.ts`
- 不得觸碰：`ClosedDatesSection.tsx`、`get_available_slots`／`create_appointment`。

## 需求

- 過去日期不能點；今天（含）以後可以點。
- 受影響預約＝該設計師當天 `pending`／`confirmed` 的預約；有的話先顯示警告（時間、顧客、服務），文案依 screen-spec。
- 取消請假不警告。
- 右側清單列出今天以後的請假日，可以直接移除。

## 驗收標準

- 標記後重新整理仍在；TASK-068 完成後，該日該設計師前台無可預約時段。
- 警告清單只包含該設計師的預約，不包含其他設計師當天的預約。

## 實作備註

- 無。

## 驗證契約

- 單元測試：`findAffectedAppointmentsForDesignerLeave` 的過濾條件（設計師、日期、狀態）。
- 整合測試：admin 讀寫成功；anon 讀取 `designer_leaves` 被拒。
- E2E 測試：Browser 走查標記有預約的日期（出現警告）→ 確認 → 移除。
- 型別檢查／Lint／Build：`npx tsc --noEmit`、`npm run lint`、`npm run build`
- 螢幕截圖：請假頁籤（預設、受影響預約警告）。
- 安全性檢查：不適用（沿用 TASK-067 的 RLS）。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：
- 已知限制：
- 後續任務：TASK-075（週曆顯示請假日）
