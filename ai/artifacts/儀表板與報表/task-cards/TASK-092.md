# AI-Ready 任務卡

## Metadata

- 任務：儀表板與報表 串接與驗收（`ReportsView` 容器、`/admin/reports` 頁面、載入中／空／錯誤、競態、文件、人工驗收）
- 上層規格：[`feature-spec.md`](../feature-spec.md)、[`screen-spec-報表.md`](../screen-spec-報表.md)、[`architecture-notes.md`](../architecture-notes.md)（§2、§4、§9）
- 上層 Epic：儀表板與報表
- 上層 User Story：查看預約數量與營收統計
- 分軌：前後端串接
- 前置任務（dependsOn）：TASK-090、TASK-091
- 狀態：完成（人工驗收通過 2026-10-25）
- 風險等級：中（第一次把真實營收資料接到畫面；口徑錯誤會誤導店長）
- Agent owner：Claude Code
- 人工核准者：使用者（計畫 2026-10-24；驗收 2026-10-25）

## 目標

把資料層、面板與排行串成可用的 `/admin/reports` 頁面，數字經真實資料與預約列表對帳無誤，並通過人工驗收。

## 情境包（Context Pack）

- 相關檔案：`lib/admin/reports.ts`、`lib/admin/reports-ranking.ts`、`lib/admin/designer-filter.ts`、`lib/admin/designers.ts`（`getDesignerFilterOptions`）、`app/admin/_components/AdminDashboard.tsx`（fetch 結果 `{key,status,data}` 與 `react-hooks/set-state-in-effect` 寫法）、`AuditLogView.tsx`（競態與重試）、`app/admin/_components/ReportsToolbar.tsx`／`ReportsDashboardPanel.tsx`／`ReportsTablePanel.tsx`／`ReportsTabs.tsx`／`ServiceRanking*.tsx`、`app/admin/audit-log/page.tsx`（薄頁面範本）、`tests/components/audit-log-view.test.tsx`、`ai/context/project-map.md`、`decisions.md`、`README.md`（未來規劃列表）。
- 既有模式：薄頁面渲染 client 容器；存取控制由 `app/admin/layout.tsx` 三層檢查；Supabase client 以 `useMemo(createClient)`；Toast 用 `useToast`。
- 假設：TASK-087 已套用；`getDesignerFilterOptions` 失敗時降級為不顯示 chip 列（與週曆一致）。
- 未知事項：無。
- 允許變更的檔案：
  - `app/admin/reports/page.tsx`（新增）
  - `app/admin/_components/ReportsView.tsx`（新增）
  - `tests/components/reports-view.test.tsx`（新增）
  - `ai/context/project-map.md`、`ai/context/decisions.md`、`ai/context/design-system.md`（S5 版面列）、`README.md`（把「儀表板與報表」由「未來規劃」移到已完成）
  - `ai/artifacts/儀表板與報表/verification/TASK-092.md`（新增）
- 不得觸碰：`lib/admin/reports*.ts`、面板與排行元件的內部（發現缺陷時回報並另開修正卡，或在本卡明確記錄為最小修正）、migration。

## 需求

- `ReportsView`（client）：state＝`tab`（預設儀表板）、`granularity`（預設月）、`anchor`（預設台北今天）、`selectedDesignerIds`（空＝全部）；期間改變才重新查詢；切頁籤／切設計師只重算（`filterByDesigners`→`summarize`／`buildTrend`／`buildServiceRanking`）；兩個頁籤與（日後的）匯出吃同一份計算結果。
- 查詢狀態以 `{key, status, data}` 推導載入中；遞增請求序號丟棄過期回應；切換期間時工具列與 chip 維持可操作。
- 設計師 chip：重用 `DesignerFilterChips`／`buildDesignerChips`／`resolveEffectiveSelection`／`toggleDesigner`；chip 數字＝期間內預約量（不含已取消）。
- 空（全部設計師沒預約）與篩選後空的兩種文案；全部已取消視為有資料；錯誤＝泛用訊息＋重試，不顯示部分數字。
- `app/admin/reports/page.tsx`：薄頁面。
- 文件：`project-map.md` 新增「儀表板與報表」段（價格快照、口徑、資料流、限制：單期間 5000 列、歷史快照為近似值、客戶端彙總）；`decisions.md` 記錄「客戶端彙總 vs 資料庫函式」「圖表純 CSS」「儀表板＝B／報表＝C 的選型」；`design-system.md` S5 表新增一列；README 更新。

## 驗收標準

- 元件測試（mock 資料層）：預設進入儀表板與月視圖；切頁籤不重新查詢；切設計師不重新查詢；切期間／粒度重新查詢；競態（先慢後快的兩次請求只採用最新）；空（兩種文案）／全取消／錯誤＋重試／載入中（工具列仍可點）；設計師 chip 的勾選與「清除篩選」；兩頁籤的彙總數字一致。
- **對帳（正式庫走查，不寫入任何資料）**：本月數字與預約列表／週曆人工核對至少 5 筆；營收＝已完成預約的快照價加總；預估營收＝待完成；已取消不計入；單一設計師篩選與週曆該設計師的數量一致；切到週／日的數字與月視圖內對應日期一致。
- 螢幕截圖（淺／深；預設、週、日、篩選、空、錯誤、載入中、768px）；`project-map`／`decisions`／`design-system`／README 已更新。
- 人工驗收通過後才轉 Done。

## 實作備註

- 走查只讀正式資料；需要特殊案例（全取消、跨月週）以單元測試涵蓋，不在正式庫造資料。
- 發現口徑與規格不符時，先停下來回報，不自行調整規格。

## 驗證契約

- 單元測試：`npx vitest run tests/components/reports-view.test.tsx`；`npm test` 全套回歸（已知 `designer-portfolio-tab` 並行不穩定，單獨重跑確認）。
- 整合測試：`npm run test:reports` 回歸。
- E2E 測試：不適用（以瀏覽器走查取代，比照既有 Epic）。
- 型別檢查：`npx tsc --noEmit`；Lint：`npm run lint`；Build：`npm run build`。
- 螢幕截圖：上列各狀態。
- 安全性檢查：確認頁面請求只選取白名單欄位（Network 面板）、沒有顧客欄位；`price_at_booking` 不出現在顧客前台任何請求。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：
- 已知限制：
- 後續任務：TASK-093
