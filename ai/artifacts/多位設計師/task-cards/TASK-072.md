# AI-Ready 任務卡

## Metadata

- 任務：多位設計師 「請假」頁籤（月曆標記整天請假、受影響預約警告）
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：多位設計師
- 上層 User Story：設定設計師請假日
- 分軌：前後端串接
- 前置任務（dependsOn）：TASK-067, TASK-069
- 狀態：完成（人工驗收通過，2026-10-22；實作與驗證完成，見 [`verification/TASK-072.md`](../verification/TASK-072.md)；人工已於 2026-10-21 核准；動工前 architect／security-reviewer 審查已於 2026-10-22 完成並採納，見「動工前審查定案」）
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
  - `app/design-system/page.tsx`（MonthPicker Demo 補上唯讀日期狀態；動工前審查補列）
  - 測試：`tests/admin/designers.test.ts`（讀取與 `findAffectedAppointmentsForDesignerLeave`）、`tests/admin/designers-write.test.ts`
    （`addDesignerLeave`／`removeDesignerLeave`）、`tests/components/designer-leaves-tab.test.tsx`（新增）、
    `tests/components/month-picker.test.tsx`（新增）、`tests/components/designer-edit-view.test.tsx`（頁籤數字）、
    `tests/designers.integration.test.ts`（動工前審查補列）
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

## 動工前審查定案（architect／security-reviewer，2026-10-22，非人工核准）

**資料層**
- 四個函式都包 try/catch，一律回通用錯誤訊息；元件層 Toast 只用固定文案，不 `console.*` 回應物件。
- `designerId` 先過 `isDesignerId`、`date` 先過嚴格的 `YYYY-MM-DD` 真實日期檢查（擋 `2099-02-30`、`today`、`infinity`、`2099-2-1`），
  不通過不送請求；**add、remove、find 三者都要驗證**。`remove` 的 `.eq("designer_id")` 與 `.eq("date")` 兩個條件都必須寫死（少一個會刪掉整批）。
- `addDesignerLeave`：函式層也擋「早於台北今天」（`getTaipeiToday()`；資料庫沒有這道 check）；`insert` 不用 `upsert`（authenticated 無 update）；
  **只有 `23505` 算成功**，其餘錯誤碼（含 `23503` 外鍵、`42501` RLS）一律回通用失敗。
- `removeDesignerLeave`：`delete().select("date")`，剛好 1 列才算成功；0 列（別的分頁已移除或 RLS 擋下）回失敗，由呼叫端重讀。
- `listDesignerLeaves`：**回傳全部（含過去）**，月曆往前翻月時過去的請假日仍顯示為已標記；元件自行篩出「今天以後」做清單與頁籤數字。
- `findAffectedAppointmentsForDesignerLeave`：select 字串寫成常數，只選 `id, customer_name, start_at, services(name)`（不用 `*`，不含 phone／email／access_token）；
  `eq designer_id`、`status in (pending, confirmed)`、台北時間該日 `[00:00, 次日 00:00)`、`order start_at`、`limit 200`。
  **刻意與 `findAffectedAppointmentsForClosedDate` 不同的兩點**：不加 `start_at > now`、不含 `completed`——請假擋掉整天，當天稍早仍是
  pending／confirmed 的預約本身就是異常，值得提醒。查詢失敗時元件**不寫入**（fail closed）。
- `isShopClosedDate(date, businessHours, closedDates)`：對齊 RPC——查不到該週幾的列、或 `open_time`／`close_time` 為 null、或 `is_closed`，
  或在 `closed_dates` 內，都算全店公休（`0018` 與 `business-hours.ts` 的既有判斷）。註明 TASK-075 可能搬去共用。

**元件與畫面**
- `MonthPicker` 只新增選填 `readOnlyDates?: Set<string>`：不可點、`tabIndex -1`、`aria-disabled`、灰底加刪除線，優先於「已標記」樣式；
  省略時行為完全不變。灰底用 **`grey.200`**（與 `WeekCalendar` 公休格同 token；暗色模式 grey 色階已覆寫，見 `lib/theme/index.ts`）。
  唯讀日期格補 `aria-label`，**內容含日期**（例如「15 日，全店公休」），否則無障礙名稱會被蓋成只剩「全店公休」。
  順手更正 `MonthPicker.tsx` 內「暗色模式沒有覆寫 grey」的過時註解（只改註解，不改行為）。
- `DesignerLeavesTab`：同一天既是請假又是全店公休——月曆上唯讀，但右側清單仍可移除（補測試）。
  任何寫入後都重讀 leaves 為準；**寫入成功但重讀失敗**時保留畫面現狀並 Toast 提示，不整個換成錯誤 Alert。
- `DesignerEditView`：頁籤標籤加 `leaves` 的數字與無障礙名稱（「已排 N 個請假日」）。

**登記為已知限制（不在本卡處理）**
- 查受影響預約到寫入之間顧客剛好下單，這筆不會出現在警告裡（與公休日同類）。
- TASK-075 完成前，後台改期（`lib/admin/reschedule-slots.ts`）不看請假日，店長可以把預約改到請假日。
- 「今天」只在掛載時算一次，跨午夜不會更新（沿用 `ClosedDatesSection` 寫法）。
- 請假日在資料庫層沒有「>= 今天」約束（過去的請假日不影響前台，加 constraint 反而讓日後清理舊資料變麻煩）。

## 驗證契約

- 單元測試：`findAffectedAppointmentsForDesignerLeave` 的過濾條件（設計師、日期、狀態）與選取欄位；`addDesignerLeave`／`removeDesignerLeave`
  的日期與 id 驗證（不通過時沒有呼叫 supabase）、23505 冪等、其他錯誤碼失敗、delete 0 列失敗、delete 兩個 `eq` 都帶；`isShopClosedDate`；
  `MonthPicker` 的 `readOnlyDates`；`DesignerLeavesTab` 各狀態。
- 整合測試（真實 Supabase，只用 `__TEST__` 設計師；建立預約一律 `customer_email: null`，避免 Database Webhook 寄信）：
  - admin 新增／讀取／移除成功；重複新增冪等；不存在的 designerId 回通用錯誤且不含 constraint 名稱。
  - 非 admin 與 anon：新增失敗（42501 不被當成成功）、移除失敗且資料列仍在（service_role 確認）、讀取被拒。
  - 移除只影響指定那一天：同設計師的其他日期、其他設計師的同一天都還在。
  - `findAffectedAppointmentsForDesignerLeave`：排除其他設計師當天預約、`cancelled`、台北時間 00:00 前後跨日的預約；回傳欄位剛好是
    `id, customer_name, start_at, services`，不含 phone／email。
  - 標記請假後，`get_available_slots` 指定該設計師回空陣列（TASK-068 已完成，驗收標準 1 現在就能測）。
- E2E 測試：Browser 走查標記有預約的日期（出現警告）→ 確認 → 移除。
- 型別檢查／Lint／Build：`npx tsc --noEmit`、`npm run lint`、`npm run build`
- 螢幕截圖：請假頁籤（預設、受影響預約警告、暗色模式）。
- 安全性檢查：沿用 TASK-067 的 RLS（不新增 migration），以上整合測試涵蓋新增的程式碼路徑。

## 完成證據

完整內容見 [`../verification/TASK-072.md`](../verification/TASK-072.md)。

- 變更的檔案：`lib/admin/designers.ts`（`listDesignerLeaves`、`addDesignerLeave`、`removeDesignerLeave`、`findAffectedAppointmentsForDesignerLeave`、
  `isShopClosedDate`）、`components/ui/MonthPicker.tsx`（選填 `readOnlyDates`／`readOnlyLabel`）、`app/admin/_components/DesignerLeavesTab.tsx`（新增）、
  `DesignerEditView.tsx`、`app/design-system/page.tsx`、`ai/context/design-system.md`；測試 `tests/admin/designers.test.ts`、
  `tests/admin/designers-write.test.ts`、`tests/components/month-picker.test.tsx`（新增）、`designer-leaves-tab.test.tsx`（新增）、
  `designer-edit-view.test.tsx`、`tests/designers.integration.test.ts`
- 執行過的指令、測試輸出、螢幕截圖、已知限制：見驗證報告（tsc／lint／build 通過；全套 847／850，3 項為既有的 `account-settings-view` 逾時（單獨跑全過）；`test:designers -t TASK-072` 10 項通過；
  瀏覽器走查通過並已清除測試資料）
- 實作期補充：圖例色塊加 `grey.300` 邊框（暗色下 `grey.200` 貼近背景）；移除 `DesignerEditView` 的 `placeholder` 欄位；清單「移除」改危險色（使用者確認）並修日期折行；
  初次載入補 `.catch`（實作後安全審查建議）
- 已知限制（摘要）：TASK-075 完成前後台改期不看請假日；查預約到寫入之間顧客剛好下單不會出現在警告；請假日資料庫層沒有「>= 今天」約束；
  aal1 情境未測；實作後 security／test 審查已做（見驗證報告「實作後審查」），建議已採納，唯 `mfa-rls` 案例未補
- 後續任務：TASK-075（週曆顯示請假日、改期表單依請假日過濾）
