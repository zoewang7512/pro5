# AI-Ready 任務卡

## Metadata

- 任務：儀表板與報表 Epic 收尾（分頁筆數驗證與超量提示、移除示範資料腳本、文件與看板同步、README 更新）
- 來源：Epic 完成後 architect＋security-reviewer 總覽審查（2026-10-25，兩者皆「有條件通過」）；本卡處理其中的通過條件與低成本修正。
- 上層規格：[`feature-spec.md`](../feature-spec.md)、[`screen-spec-報表.md`](../screen-spec-報表.md)、[`architecture-notes.md`](../architecture-notes.md)（§4 查詢）
- 上層 Epic：儀表板與報表
- 上層 User Story：查看預約數量與營收統計
- 分軌：前後端串接（含文件）
- 前置任務（dependsOn）：TASK-093
- 狀態：草稿
- 風險等級：中（改動報表資料層的查詢正確性；刪除正式庫用的維運腳本）
- Agent owner：Claude Code
- 人工核准者：待使用者核准計畫

## 目標

1. 報表絕不顯示被靜默截斷的數字：即使 PostgREST 單頁上限被調小，也要報錯而不是少算。
2. 期間資料量超過上限時，店長看得到原因與出路（改用較短期間），而不是無限重試。
3. 移除不在任何任務範圍內、且可能誤刪真實預約的示範資料腳本。
4. 規格、文件、README 與實作一致。

## 情境包（Context Pack）

- 審查發現（均已由本卡作者實際讀碼確認 M1 與腳本存在）：
  - **M1（architect，Medium）**：`lib/admin/reports.ts:190` 以 `data.length < PAGE_SIZE` 判斷最後一頁。若 Supabase 的 Max rows 被調成小於 1000（例如 500），第一頁只回 500 列就被當成最後一頁，畫面與匯出只算 500 筆且不報錯，違反「寧可失敗也不顯示被截斷的數字」。
  - **L1（architect）**：超過 5000 列與一般失敗都回同一個泛用錯誤，店長按重試永遠失敗。
  - **M-1／L5（security＋architect）**：`scripts/seed-demo-reports.mjs`（TASK-092 加入，任務卡未列、`project-map`／`decisions` 未記）以 service_role 寫正式庫，清除只靠姓名前綴「【示範】」，且會產生佔用真實時段的未來預約。使用者決定：**直接移除**。
  - **L6**：`0020_appointment_price_snapshot_down.sql` 檔頭沒有「回滾前先匯出快照」的備份步驟。
  - **文件落差（L2）**：`screen-spec-報表.md` 第 25、47、69 行、`feature-spec.md` 第 12、174 行仍是舊說法；README 沒提匯出；`project-map.md` 第 199 行沒列匯出測試。
- 既有模式：`fetchReportAppointments` 回 `Result`；錯誤訊息一律泛用（不洩漏內部資訊）；`ReportsStates.tsx` 的 `ReportsErrorState`；測試以 fake supabase 鏈式物件。
- 設計決定（本卡內定案，需使用者核准計畫時一併確認）：
  - M1：第一頁改用 `select(REPORT_COLUMNS, { count: "exact" })`。`count > 5000` 直接回「超量」錯誤（可省掉第 6 頁探測請求）；各頁累積列數與 `count` 不符（少於 → 被截斷）回一般錯誤。**不新增資料庫函式或 migration。**
  - L1：`fetchReportAppointments` 的錯誤型別在 `reports.ts` 內擴充為 `AdminError & { code?: "too_many_rows" }`（**不改**共用的 `AdminError`）。超量時畫面顯示「此期間預約筆數超過上限（5,000 筆），請改用較短的期間（日或週）。」，**不顯示重試按鈕**（重試無意義），工具列仍可操作；其他錯誤維持現狀。
- 假設：目前 Supabase Max rows 為預設（1000）。
- 未知事項：`count: "exact"` 在帶 `.range()`、排序與 embed（`services(...)`）的查詢上的行為（預期正常；以單元測試與一次唯讀的正式庫查詢確認）。
- 允許變更的檔案：
  - `lib/admin/reports.ts`（`fetchReportAppointments` 的 count 驗證與錯誤碼）
  - `app/admin/_components/ReportsStates.tsx`、`ReportsView.tsx`（只做超量錯誤的文案與隱藏重試；匯出按鈕沿用「錯誤時停用」）
  - `tests/admin/reports.test.ts`（補 count 案例）、`tests/components/reports-view.test.tsx`（補超量案例）
  - `scripts/seed-demo-reports.mjs`（**刪除**）
  - `supabase/migrations/0020_appointment_price_snapshot_down.sql`（只改檔頭註解，加備份步驟；**不改 SQL 邏輯**）
  - `ai/artifacts/儀表板與報表/screen-spec-報表.md`、`feature-spec.md`（加註或修正舊說法）
  - `ai/context/project-map.md`、`decisions.md`、`README.md`
  - `ai/artifacts/儀表板與報表/verification/TASK-094.md`（新增）
- 不得觸碰：`summarize`／`buildTrend`／排行與匯出的計算與口徑、面板與圖表元件、其他 migration 與 `app/` 頁面、`tools/kanban/` 其他卡片的 `gates`（審查旗標由使用者決定是否勾選，見下）。

## 需求

- **分頁驗證**（`lib/admin/reports.ts`）：
  - 第一頁帶 `{ count: "exact" }`；`count == null`、查詢錯誤、`count > 5000` 皆回錯誤（`count > 5000` 帶 `code: "too_many_rows"`）。
  - 依 `count` 決定要抓幾頁（`ceil(count / PAGE_SIZE)`），不再以「這頁不足 1000 列」判斷結束；抓完累積列數必須等於 `count`，否則回一般錯誤（被截斷或翻頁期間資料變動）。
  - 保留既有行為：價格不合法或狀態未知整份失敗；錯誤訊息泛用。
- **超量提示**：`too_many_rows` 時面板（兩個頁籤）顯示專用文案、無重試按鈕；切到較短期間後恢復正常；匯出按鈕仍停用。
- **移除腳本**：刪除 `scripts/seed-demo-reports.mjs`；確認 `package.json` 與文件沒有其他引用；`verification/TASK-092.md` 的歷史記錄保留並加一句「腳本已於 TASK-094 移除」。
- **0020_down**：檔頭註解加上回滾前備份快照的 SQL 範例（`create table ... as select id, price_at_booking from public.appointments`）與「2026-10-25 之後的預約快照是真實下單價，down 後無法還原」的警告。
- **文件**：
  - `screen-spec-報表.md` 第 47、69、25 行加註「已調整，見 decisions TASK-088～092」；`feature-spec.md` 第 12、174 行的 Sidebar 項目名稱改為「儀表板與報表」。
  - `project-map.md`：測試與決策指引補 `tests/admin/reports-export*.test.ts` 與 decisions「TASK-093」；補上分頁驗證與超量錯誤的說明；升級路徑補一句：改為資料庫端彙總時，口徑要整個搬進 SQL 成為唯一來源，`summarize` 退役或以對照測試鎖定，避免兩套口徑。
  - `decisions.md`：記錄本卡決定（count 驗證、超量錯誤碼、移除示範腳本的理由）；已知限制補：`designer-filter` 的 `countActiveAppointments` 與 `summarize().booked` 必須等價。
  - `README.md`：「功能特色」的「儀表板與報表」補上匯出 Excel（.xlsx，瀏覽器端產生、不含顧客個資）；「未來規劃 → 優化項目」補入本 Epic 刻意延後的項目（見下）。
- **README 優化項目要列的延後事項**：
  1. 報表改為資料庫端彙總（觸發條件：單月接近約 3000 列；口徑須整個搬進 SQL）。
  2. 匯出明細的日期欄改輸出 YYYY-MM-DD（目前是無年份的顯示標籤）。
  3. 報表時區測試自動化（目前三個 TZ 各跑一次為手動）。
  4. 整合測試改用獨立的 Supabase 測試專案。
  5. 升級 `next`（`npm audit` 有 critical）與 `write-excel-file` 名稱 `constructor` 寫壞儲存格的上游回報（另立卡處理）。

## 驗收標準

- 單元測試：`fetchReportAppointments` — 第一頁 `count` 大於實際回列數（模擬 Max rows 被調小）→ 回錯誤而不是少算；`count > 5000` → `code: "too_many_rows"`；`count == null` → 錯誤；剛好 1000／5000 列、多頁累積列數＝count 仍正確；錯誤訊息仍是泛用文案。
- 元件測試：`too_many_rows` 顯示專用文案、無「重試」按鈕、工具列仍可操作、匯出按鈕停用；切到較短期間恢復；一般錯誤維持原本的重試按鈕。
- 確認：`scripts/` 不再有 `seed-demo-reports.mjs`；`grep` 全專案無殘留引用（歷史驗證報告的敘述除外）。
- 唯讀驗證（正式庫，不寫入）：`count: "exact"` 搭配 range／排序／embed 的實際行為，以及 `/admin/reports` 本月、其他月份數字與修改前一致。
- 文件：上列 spec、project-map、decisions、README 的修改逐項完成。
- 回歸：既有 reports 相關測試（`reports*.test.ts`、`reports-view.test.tsx`、`reports-export*.test.ts`）與 `npm run test:reports` 全過。

## 實作備註

- 本卡**不處理**：`next` 升級（另立卡）、匯出日期欄實作、時區測試自動化、`write-excel-file` 上游回報、整合測試改用測試專案、realtime publication 確認、`fflate` overrides——這些僅列入 README／decisions 的延後事項。
- 看板 `gates`：`TASK-093.json` 的 `gates.security` 與 `TASK-087.json` 的 `gates.architecture` 目前是 false，但對應的子代理審查都做過。**子代理審查不等於人工核准**，是否勾選由使用者決定，本卡不更動。

## 驗證契約

- 單元測試：`npx vitest run tests/admin/reports.test.ts tests/components/reports-view.test.tsx tests/admin/reports-export.test.ts tests/admin/reports-export-download.test.ts`；`npm test` 回歸（既有並行逾時須單獨重跑確認）。
- 整合測試：`npm run test:reports`（回歸，不新增）。
- E2E 測試：不適用。
- 型別檢查：`npx tsc --noEmit`；Lint：`npm run lint`；Build：`npm run build`。
- 螢幕截圖：超量錯誤狀態（淺／深色）。
- 安全性檢查：確認腳本已移除、錯誤訊息仍泛用、查詢欄位白名單不變。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：
- 已知限制：
- 後續任務：另立卡——升級 `next` 與 `npm audit` 其餘三項、全套測試並行逾時、`write-excel-file` 上游回報。
