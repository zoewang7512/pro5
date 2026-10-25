# AI-Ready 任務卡

## Metadata

- 任務：`TrendBarChart` 圖表元件（純 CSS 堆疊長條圖，含 hover／focus 提示、鍵盤操作、無障礙資料表）
- 上層規格：[`feature-spec.md`](../feature-spec.md)（需求 §2 圖表）、[`screen-spec-報表.md`](../screen-spec-報表.md)（設計系統對照、視覺驗收）、[`architecture-notes.md`](../architecture-notes.md)（§4）
- 上層 Epic：儀表板與報表
- 上層 User Story：查看預約數量與營收統計
- 分軌：前端
- 前置任務（dependsOn）：TASK-088
- 狀態：草稿
- 風險等級：低
- Agent owner：Claude Code
- 人工核准者：待使用者核准計畫（mockup 已由使用者選定：`mockups/reports-final-tabs.html` 儀表板頁籤）

## 目標

做出儀表板頁籤會用兩次（預約量圖、營收圖）的跨頁共用圖表元件，並登記回元件庫 inventory。

## 情境包（Context Pack）

- 相關檔案：`ai/context/design-system.md`（token 與 inventory）、`lib/theme/index.ts`（palette，含暗色）、`components/ui/PortfolioGrid.tsx`／`MonthPicker.tsx`（純展示元件與鍵盤互動慣例）、`app/design-system/page.tsx`（展示頁）、`tests/components/month-picker.test.tsx`、`mockups/reports-variant-b.html`（長條圖樣式：24px 起的欄寬、flat 長條、斜紋、3 條網格、y 軸 3 個刻度）。
- 既有模式：純展示元件不 import `lib/admin/*`、不碰 Supabase；顏色一律取自 theme palette；測試用 `tests/test-utils.tsx`。
- 假設：不引入圖表套件；`primary.main`（已完成）與 `primary.50` 對應色用於斜紋（暗色模式取 theme 的對應值）。
- 未知事項：無。
- 允許變更的檔案：
  - `components/ui/TrendBarChart.tsx`（新增）
  - `tests/components/trend-bar-chart.test.tsx`（新增）
  - `app/design-system/page.tsx`（補一個展示區塊，若該頁已有同類慣例）
  - `ai/context/design-system.md`（元件庫 inventory 新增一列）
- 不得觸碰：`lib/`、`app/admin/`、其他 `components/ui/`。

## 需求

- props（建議）：`buckets: { key; label; showLabel?; segments: { value: number; kind: "solid" | "striped" }[]; tooltip: string[]; ariaLabel: string; today?: boolean }[]`、`max: number`、`formatTick?: (n:number)=>string`、`legend?: { solid: string; striped: string }`、`emptyLabel?`。
- 呈現：堆疊長條（striped 在上、solid 在下）、3 條網格（頂／中／底，底線較深）、y 軸 3 個刻度、x 軸標籤可稀疏化（`showLabel`）、今天以粗體＋主色標示、值為 0 的格子仍佔位、最小可見高度 2px（值 > 0 時）。
- 互動：hover 與鍵盤焦點顯示 tooltip（多行純文字）；**單一 tab stop**，方向鍵左右移動、Home／End 跳首尾（roving tabindex），Esc 關閉提示；觸控裝置點一下顯示。
- 無障礙：圖表有 `role="group"`＋`aria-label`；每格有 `aria-label`（來自 `ariaLabel`）；另提供視覺上隱藏的等價資料表；斜紋與實心靠圖例與圖樣區分，不只靠顏色。
- 載入中、空資料由呼叫端處理（本元件在 `buckets` 為空時顯示 `emptyLabel`）。

## 驗收標準

- 單元測試涵蓋：各格高度比例（含 0 值、最小高度、超過 `max` 被夾住）、堆疊順序、標籤稀疏化、今天標示、tooltip 在 hover／focus／方向鍵／Esc 的顯示與關閉、roving tabindex（只有一個 tab stop）、隱藏資料表內容與 `buckets` 一致、`buckets` 為空。
- 螢幕截圖（淺色＋深色、桌面＋768px）：與 mockup 變體 B 的圖表一致；文字不截斷、不溢出；對比 ≥ 4.5:1（文字）、圖形標記 ≥ 3:1。
- 對照 `ai/checklists/design-review-checklist.md` 逐項檢查；元件已登記回 `design-system.md`（涵蓋狀態、用到的 token、檔案位置、來源階段 TASK-089）。
- 全部顏色、字級、間距取自 token，沒有硬寫 hex。

## 實作備註

- 長條寬度：`flex: 1`＋`max-width: 32px`；欄距 4px（spacing scale）；圖高 180px、x 軸標籤列 24px，與 mockup 一致。
- 提示框用絕對定位，不使用 MUI `Tooltip`（需要多行與鍵盤驅動時的穩定行為）；若評估後 MUI `Tooltip` 可滿足，允許改用並在決策中說明。

## 驗證契約

- 單元測試：`npx vitest run tests/components/trend-bar-chart.test.tsx`；`npm test` 回歸。
- 整合測試：不適用。
- E2E 測試：不適用。
- 型別檢查：`npx tsc --noEmit`；Lint：`npm run lint`；Build：`npm run build`。
- 螢幕截圖：`/design-system` 的 TrendBarChart 區塊（淺／深、月 31 格、週 7 格、日 10 格、全零、空）。
- 安全性檢查：純文字渲染，無 `dangerouslySetInnerHTML`。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：
- 已知限制：
- 後續任務：TASK-090
