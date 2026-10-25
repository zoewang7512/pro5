# AI-Ready 任務卡

## Metadata

- 任務：儀表板與報表 畫面元件（工具列、儀表板面板、報表面板、頁籤殼、各狀態、Sidebar 項目）——以 props 餵資料
- 上層規格：[`feature-spec.md`](../feature-spec.md)（需求 §2）、[`screen-spec-報表.md`](../screen-spec-報表.md)、[`mockup-decision-報表.md`](../mockup-decision-報表.md)、[`architecture-notes.md`](../architecture-notes.md)（§4）
- 上層 Epic：儀表板與報表
- 上層 User Story：查看預約數量與營收統計
- 分軌：前端
- 前置任務（dependsOn）：TASK-088、TASK-089
- 狀態：草稿
- 風險等級：低
- Agent owner：Claude Code
- 人工核准者：待使用者核准計畫（mockup 已由使用者選定並確認）

## 目標

做出「儀表板（變體 B）／報表（變體 C）」兩個頁籤的畫面與工具列、Sidebar 入口，並涵蓋所有畫面狀態；資料與請求由下一張串接卡提供。

## 情境包（Context Pack）

- 相關檔案：`mockups/reports-final-tabs.html`（定案）、`reports-variant-b.html`／`reports-variant-c.html`、`ai/context/design-system.md`、`app/admin/_components/AdminShell.tsx`（`NAV_ITEMS`、圖示寫法）、`app/admin/_components/AdminDashboard.tsx`（`ToggleButtonGroup` 切換）、`DesignerFilterChips.tsx`、`DesignerEditView.tsx`（Tabs 樣式）、`AuditLogView.tsx`（骨架／空／錯誤寫法）、`components/ui/TrendBarChart.tsx`（TASK-089）、`lib/admin/reports.ts`（TASK-088 型別）、`lib/admin/format.ts`（`formatPrice`）、`tests/components/admin-shell.test.tsx`、`tests/components/sidebar.test.tsx`。
- 既有模式：頁面專用元件放 `app/admin/_components/`、不入 `components/ui/`；純文字渲染、`<bdi>`；狀態以 props 決定。
- 假設：排行以 `ranking: ReactNode` 插槽傳入（TASK-091 提供）；匯出按鈕以 `toolbarActions: ReactNode` 插槽傳入（TASK-093 提供）。
- 未知事項：無。
- 允許變更的檔案：
  - `app/admin/_components/ReportsToolbar.tsx`、`ReportsDashboardPanel.tsx`、`ReportsTablePanel.tsx`、`ReportsTabs.tsx`（新增；頁籤殼＝頁籤列＋內容切換）
  - `app/admin/_components/AdminShell.tsx`（`NAV_ITEMS` 在「預約」之後新增「儀表板與報表」＋手繪 SVG 圖示）
  - `tests/components/reports-toolbar.test.tsx`、`reports-dashboard-panel.test.tsx`、`reports-table-panel.test.tsx`、`reports-tabs.test.tsx`（新增）、`tests/components/admin-shell.test.tsx`、`sidebar.test.tsx`（更新項目數）
  - `ai/context/design-system.md`（Sidebar 列：圖示數量與新項目；新增頁面專用元件的簡短登記）
- 不得觸碰：`lib/`、`components/ui/TrendBarChart.tsx`、排行元件（TASK-091）、`app/admin/reports/`（TASK-092）。

## 需求

- **ReportsToolbar**：日／週／月（`ToggleButtonGroup`，單選）、`‹`／`›`、期間標籤、「回到本期」（`isCurrent` 時停用）、右側 `actions` 插槽；所有控制項有 `aria-label`，鍵盤可操作。
- **ReportsDashboardPanel（B）**：營收主角摘要列（營收 36px 主數字＋「營收（已完成 N 筆）」；預約量／預估營收／已取消為次要，副標依 mockup：「完成 N ・ 待完成 M」「待完成，未計入營收」「不計入預約量」）；預約量圖與營收圖並排（`TrendBarChart`，窄視窗堆疊；月視圖 x 軸每 5 日標一次）；`ranking` 插槽。
- **ReportsTablePanel（C）**：彙總列（預約量、已完成、待完成、已取消、營收（已完成）、預估營收（待完成））；`ranking` 插槽；逐日（日粒度為逐小時）明細表：表頭 sticky、合計列 sticky 在底、今天列底色＋「今天」標籤、零值顯示「—」、內部捲動（月 440px）。
- **ReportsTabs**：「儀表板｜報表」頁籤（`role="tablist"`、方向鍵切換），預設儀表板；切換不遺失父層 state。
- **狀態（所有面板與頁籤殼共用同一組 props 約定）**：載入中（骨架，工具列不動）、空（兩種文案：「此期間沒有預約」「所選設計師在此期間沒有預約」）、錯誤（泛用文案＋重試）、全部已取消（有資料、排行區顯示「此期間沒有被預約的服務」）。
- **Sidebar**：新項目「儀表板與報表」放在「預約」之後，圖示手繪 SVG（與既有 8 個圖示同尺寸／同色來源），`/admin/reports` 與其子路徑 active。
- 圖表／表格所用的數字格式沿用 `formatPrice`（`NT$105,300`）；所有使用者可控字串純文字。

## 驗收標準

- 元件測試涵蓋：各粒度標籤、回到本期停用、頁籤預設與鍵盤切換、儀表板／報表內容與 mockup 結構一致（數字由 props 決定）、五種狀態（預設／載入中／空×2／錯誤／全部已取消）、零值「—」、合計列、今天標示、窄視窗堆疊（以 class／結構斷言）。
- `admin-shell`／`sidebar` 既有測試更新後通過（項目數 9、順序、active 規則）。
- 螢幕截圖（淺／深、桌面／768px）對照 `mockups/reports-final-tabs.html`；對照 `design-review-checklist.md`；`design-system.md` 已更新。
- 色彩、字體、間距、圓角、陰影取自 token，無硬寫一次性數值。

## 實作備註

- 面板只吃 props（`ReportData` 形狀的資料與 `ReportTotals`／`TrendBucket[]`），不 import Supabase；展示專用 fixture 可放測試檔內。
- 「新」徽章不實作（mockup 備註）。

## 驗證契約

- 單元測試：`npx vitest run tests/components/reports-*.test.tsx tests/components/admin-shell.test.tsx tests/components/sidebar.test.tsx`；`npm test` 回歸。
- 整合測試：不適用。
- E2E 測試：不適用。
- 型別檢查：`npx tsc --noEmit`；Lint：`npm run lint`；Build：`npm run build`。
- 螢幕截圖：以測試 fixture 的暫時頁面或 `/design-system` 區塊截圖（實作完不留暫時頁面）。
- 安全性檢查：純文字渲染；元件不接觸顧客欄位（型別上沒有）。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：
- 已知限制：
- 後續任務：TASK-092
