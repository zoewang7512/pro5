# AI-Ready 任務卡

## Metadata

- 任務：報表資料層（`lib/admin/reports.ts`：期間運算、分頁查詢、彙總、趨勢、設計師篩選；單元與整合測試）
- 上層規格：[`feature-spec.md`](../feature-spec.md)（口徑定義、需求 §2）、[`architecture-notes.md`](../architecture-notes.md)（§2）
- 上層 Epic：儀表板與報表
- 上層 User Story：查看預約數量與營收統計
- 分軌：後端
- 前置任務（dependsOn）：TASK-087
- 狀態：驗證中（實作與驗證完成，待使用者人工驗收）
- 風險等級：低（唯讀、純函式為主；不改資料庫）
- Agent owner：Claude Code
- 人工核准者：待使用者核准計畫

## 目標

提供「一份資料、全頁共用」的報表資料層：給定期間與（可選）設計師，回傳彙總、趨勢，並能以台北時間正確分組。

## 情境包（Context Pack）

- 相關檔案：`lib/admin/appointments.ts`（`Result<T>`、`AdminError`、泛用錯誤、`+08:00` 查詢寫法）、`lib/admin/week-range.ts`（`addDays`、`getWeekRange`、`getTaipeiToday`）、`lib/admin/month-range.ts`、`lib/admin/format.ts`（`toTaipeiDate`、`formatPrice`）、`lib/admin/designer-filter.ts`（`buildDesignerChips`、`resolveEffectiveSelection`、`filterAppointments`）、`tests/admin/appointments.test.ts`（mock Supabase 的做法）、`tests/admin/week-range.test.ts`、`tests/helpers/designer-fixture.ts`。
- 既有模式：純函式＋薄查詢封裝；`Result<T>` 錯誤統一泛用訊息；明確列欄位、不用 `select *`；時間以 `Intl`／`+08:00` 處理，不依賴執行環境時區。
- 假設：TASK-087 已套用到正式資料庫；PostgREST 單次回傳上限 1000 列；預估單期間（月）數百筆。
- 未知事項：無。
- 允許變更的檔案：
  - `lib/admin/reports.ts`（新增）
  - `lib/admin/designer-filter.ts`（**只**放寬 `buildDesignerChips`／`countActiveAppointments` 等函式的參數型別為 `Pick<WeekAppointment, "designer_id" | "status">`，行為不變）
  - `tests/admin/reports.test.ts`（新增）、`tests/admin/designer-filter.test.ts`（補型別放寬後的案例）
  - `tests/reports.integration.test.ts`（**追加**彙總案例，檔案由 TASK-087 建立）
- 不得觸碰：任何 `app/`、`components/`、migration、其他 `lib/admin/*`。

## 需求

- 型別與函式依架構筆記 §2：`ReportGranularity`、`ReportPeriod`、`ReportAppointment`、`ReportTotals`、`TrendBucket`；`getReportPeriod`、`shiftReportPeriod`、`fetchReportAppointments`、`summarize`、`buildTrend`、`filterByDesigners`、`toReportAppointmentLike`（餵給 `buildDesignerChips` 的轉接）。
- `fetchReportAppointments`：明確欄位（`id, start_at, status, price_at_booking, service_id, designer_id, services(name, is_active)`）、範圍 `[from 00:00+08:00, to+1 00:00+08:00)`、穩定排序、最多 5 頁 ×1000 列，超過回錯誤；`price_at_booking` 轉 number 且需為有限數，否則回錯誤；錯誤統一泛用訊息，不洩漏資料庫內容。
- `summarize`／`buildTrend` 的口徑與補零規則依規格書「口徑定義」與架構筆記；日粒度的小時範圍＝`min(10, 最早)`～`max(19, 最晚)`。
- 金額加總以 `Math.round(x * 100) / 100` 收斂。

## 驗收標準

- 期間：日／週（週一～週日）／月；跨月、跨年、週跨月；`shiftReportPeriod` 前後移動正確；`isCurrent` 對今天（台北）正確。
- 彙總：各狀態組合下 `booked/completed/pending/cancelled/revenue/estimated` 正確；全部已取消時 `booked = 0`、`cancelled = N`；空陣列全為 0。
- 趨勢：月／週每個日期一格且補零；日粒度含 10:00–19:00 並可擴張；**在 `TZ=UTC` 與 `TZ=America/Los_Angeles` 下結果與 `TZ=Asia/Taipei` 相同**；23:30、00:30 的日期歸屬正確。
- 查詢：欄位清單斷言不含任何 `customer_*`／`access_token`；範圍參數含 `+08:00`；超過 5 頁回錯誤、不回傳部分資料；錯誤訊息泛用。
- 整合測試（真實 Supabase，`__TEST__` 資料、無 email）：以 service_role 造出含改價（用 update 快照）、取消、不同設計師、期間邊界（前一日 23:59、當日 00:00、次日 00:00）的預約，店長帳號呼叫 `fetchReportAppointments` + `summarize` + `buildTrend`，結果與手算一致；非店長與 anon 取不到資料。
- 既有設計師篩選與週曆測試不受型別放寬影響。

## 實作備註

- 口徑集中在 `summarize` 一處，其他卡片（面板、排行、匯出）只消費結果、不得自行重算。
- 不引入新 dependency。

## 驗證契約

- 單元測試：`npx vitest run tests/admin/reports.test.ts tests/admin/designer-filter.test.ts`；時區案例以 `TZ` 環境變數切換重跑。
- 整合測試：`npm run test:reports`。
- E2E 測試：不適用。
- 型別檢查：`npx tsc --noEmit`；Lint：`npm run lint`；Build：`npm run build`。
- 螢幕截圖：不適用。
- 安全性檢查：確認查詢欄位白名單與無顧客欄位（測試斷言）。

## 完成證據

- 變更的檔案：`lib/admin/reports.ts`（新增）、`lib/admin/designer-filter.ts`（僅型別放寬）、`tests/admin/reports.test.ts`（新增）、`tests/admin/designer-filter.test.ts`（追加 2 項）、`tests/reports.integration.test.ts`（追加 8 項）。
- 執行過的指令：`npx vitest run tests/admin/reports.test.ts tests/admin/designer-filter.test.ts`（TZ 為 UTC／PST8PDT／Asia/Taipei 各一次）、`npm run test:reports`、`npx tsc --noEmit`、`npm run lint`、`npm run build`、`npx vitest run --maxWorkers=3`。
- 測試輸出：單元 71 項通過（三個時區皆同）；整合 19 項通過；tsc／lint／build 通過；全套 1398／1399（唯一失敗為既有的 `account-settings-view` 並行逾時，乾淨基線同樣會失敗）。細節見 [`verification/TASK-088.md`](../verification/TASK-088.md)。
- 螢幕截圖：不適用
- 已知限制：單期間上限 5000 列。Windows 的 Node 不認 IANA 時區名稱（`America/Los_Angeles` 會靜默退回系統時區），洛杉磯案例以 `TZ=PST8PDT` 執行。
- 後續任務：TASK-089、TASK-090、TASK-091
