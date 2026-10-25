# AI-Ready 任務卡

## Metadata

- 任務：熱門服務排行（`lib/admin/reports-ranking.ts`＋橫條與表格兩種呈現元件）
- 上層規格：[`feature-spec.md`](../feature-spec.md)（需求 §3）、[`screen-spec-報表.md`](../screen-spec-報表.md)、[`architecture-notes.md`](../architecture-notes.md)（§3）
- 上層 Epic：儀表板與報表
- 上層 User Story：查看熱門服務項目排行
- 分軌：前端（含純函式計算）
- 前置任務（dependsOn）：TASK-088
- 狀態：草稿
- 風險等級：低
- Agent owner：Claude Code
- 人工核准者：待使用者核准計畫（mockup 已選定）

## 目標

依預約量算出熱門服務排行，並以兩種樣式呈現：儀表板的橫條、報表的含占比表格。

## 情境包（Context Pack）

- 相關檔案：`lib/admin/reports.ts`（TASK-088：`ReportAppointment`）、`lib/admin/format.ts`（`formatPrice`）、`mockups/reports-variant-b.html`（橫條排行）、`reports-variant-c.html`（含占比條的表格）、`app/admin/_components/ServicesTable.tsx`（已下架標示慣例）、`AuditLogView.tsx`（表格樣式）、`tests/admin/format.test.ts`。
- 既有模式：純函式＋純展示元件；純文字、`<bdi>`、`overflowWrap`。
- 假設：排行資料已依期間與設計師篩選過（由容器負責）。
- 未知事項：無。
- 允許變更的檔案：
  - `lib/admin/reports-ranking.ts`（新增）
  - `app/admin/_components/ServiceRankingBars.tsx`、`ServiceRankingTable.tsx`（新增）
  - `tests/admin/reports-ranking.test.ts`、`tests/components/service-ranking-bars.test.tsx`、`service-ranking-table.test.tsx`（新增）
- 不得觸碰：`lib/admin/reports.ts`、面板元件（TASK-090）、`app/admin/reports/`。

## 需求

- `buildServiceRanking(appts: ReportAppointment[]): RankingRow[]`：排除 cancelled；依 `serviceId` 分組；`count`＝預約量，`revenue`＝completed 的快照價加總；排序＝`count` 降序 → `revenue` 降序 → 名稱（`zh-Hant` `localeCompare`）→ `serviceId`；預約量 0 不列；不設上限；`isActive` 來自 `serviceIsActive`。
- `ServiceRankingBars`：名次、服務（已下架標籤）、橫條（長度＝`count / maxCount`，最小可見寬度）、預約量、營收；窄寬度仍不破版。
- `ServiceRankingTable`：名次、服務（已下架標籤）、預約量、占比條＋百分比（占比＝該服務預約量 ÷ 排行內預約量總和，四捨五入）、營收；窄視窗內部橫向捲動。
- 兩者皆有空資料狀態（「此期間沒有被預約的服務」）。

## 驗收標準

- `buildServiceRanking`：取消排除、同量依營收、再依名稱、再依 id 的穩定排序、已下架標示、全取消回空陣列、價格來自快照（改價後舊預約不變）、單項服務、浮點加總收斂。
- 兩個元件：渲染順序與數字正確、已下架標籤、占比總和合理（顯示四捨五入；不要求加總為 100%）、橫條長度比例、空狀態、純文字（名稱含 `<script>`／`=SUM(1)` 以文字顯示）。
- 螢幕截圖（淺／深）對照 mockup 變體 B（橫條）與 C（表格）；對照設計審查清單。

## 實作備註

- 橫條的顏色取 `primary.main`，軌道取 grey；沿用 spacing scale；不新增 token。

## 驗證契約

- 單元測試：`npx vitest run tests/admin/reports-ranking.test.ts tests/components/service-ranking-*.test.tsx`；`npm test` 回歸。
- 整合測試：不適用（計算為純函式；真實資料的排行對帳由 TASK-092 走查）。
- E2E 測試：不適用。
- 型別檢查：`npx tsc --noEmit`；Lint：`npm run lint`；Build：`npm run build`。
- 螢幕截圖：以測試 fixture 暫時頁面截圖（不留暫時頁面）。
- 安全性檢查：純文字渲染。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：
- 已知限制：
- 後續任務：TASK-092
