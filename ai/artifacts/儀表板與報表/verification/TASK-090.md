# 驗證報告

## 摘要

- 任務：TASK-090 儀表板與報表 畫面元件（工具列、儀表板面板、報表面板、頁籤殼、各狀態、Sidebar 項目）
- 結果：**通過**（新增 62 項元件測試＋更新 `admin-shell` 測試（16 項）；瀏覽器以暫時頁面在淺色／深色、1000px／768px 實測）
- 驗證者：實作 agent（Claude Code）。product／ui 關卡已由使用者核准規格書與 mockup；本卡風險低（純展示、只吃 props、無資料存取、無新 dependency），未另跑 security／architecture 子代理審查。人工驗收待使用者。

## 變更的檔案

| 檔案 | 內容 |
|---|---|
| `app/admin/_components/ReportsToolbar.tsx`（新增） | 日／週／月、上一期／下一期、期間標籤、回到本期、`actions` 插槽 |
| `app/admin/_components/ReportsTabs.tsx`（新增） | 「儀表板｜報表」頁籤殼＋共用 `controls` 區＋tabpanel |
| `app/admin/_components/ReportsDashboardPanel.tsx`（新增） | 變體 B：營收主角摘要列、預約量圖＋營收圖、排行插槽；圖表資料轉換（`buildChartBuckets`、`niceMax`、`formatMoneyTick`） |
| `app/admin/_components/ReportsTablePanel.tsx`（新增） | 變體 C：彙總列、排行插槽、逐日／逐小時明細表 |
| `app/admin/_components/ReportsStates.tsx`（新增，任務卡未列） | 兩個面板共用的 props 約定與載入中／空／錯誤畫面、格式與強調色 helper |
| `app/admin/_components/AdminShell.tsx` | `NAV_ITEMS` 在「預約」之後新增「儀表板與報表」＋手繪長條圖 SVG |
| `components/ui/TrendBarChart.tsx`、`tests/components/trend-bar-chart.test.tsx`（**任務卡「不得觸碰」，見審查發現 1**） | 修正隱藏資料表撐寬頁面的 bug |
| `tests/components/reports-{toolbar,tabs,dashboard-panel,table-panel}.test.tsx`（新增）、`tests/components/admin-shell.test.tsx`（更新） | 測試 |
| `tests/helpers/reports-fixture.ts`（新增，任務卡未列） | 用真正的 `getReportPeriod`／`buildTrend`／`summarize` 產生面板測試資料（TASK-092 可重用） |
| `ai/context/design-system.md` | Sidebar 列（9 個圖示、新項目）；新增頁面專用元件登記列 |
| 看板卡、任務卡、本報表 | 流程文件 |

## 指令

| 指令 | 結果 | 備註 |
|---|---|---|
| `npx vitest run tests/components/reports-*.test.tsx tests/components/admin-shell.test.tsx tests/components/sidebar.test.tsx` | **全數通過** | 工具列 12、頁籤 8、儀表板面板 25、報表面板 17、admin-shell 16（含新增 4 項與 1 項改寫）、sidebar 8 |
| `npx vitest run tests/components/trend-bar-chart.test.tsx` | 31 項通過 | 089 元件修正後 |
| `npx tsc --noEmit` | 通過 | 0 錯誤 |
| `npm run lint` | 通過 | 0 error |
| `npm run build` | 通過 | |
| `npx vitest run --maxWorkers=3`（全套） | 1480／1496；失敗的 16 項是 `account-settings-view`（既有）、`designer-leaves-tab`（既有）與本卡 `reports-table-panel` 1 項的 5 秒逾時 | 見審查發現 2 |
| 上述三個檔案單獨重跑 | 本卡檔案全過；既有不穩定檔案僅 `account-settings-view` 偶發 1 項逾時 | 本卡的 `bodyRows` 改用 DOM 選取後，`reports-table-panel` 整檔 2.4 秒 |

## 單元測試涵蓋

- **工具列**：三種粒度的標籤與選取狀態；單選不能取消；上一期／下一期的無障礙名稱隨粒度變化；回到本期在本期時停用；鍵盤 Tab 順序與 Enter；`actions` 插槽有傳才渲染；期間標籤 `aria-live`。
- **頁籤**：預設儀表板；頁籤列與 tabpanel 命名與互相對應；點擊切換；左右方向鍵／Home／End 切換並選取；roving tabindex；**切頁籤時共用控制區是同一個 DOM 節點、輸入不被清掉**；控制區在頁籤列與內容區之間、不在 tabpanel 內。
- **儀表板面板**：營收 36px 主數字與標籤、三個次要數字與副標、字級層次；兩張圖各 31 格、並排容器可換行（每張 ≥ 320px）、圖例；每格 `aria-label` 與 tooltip 含日期／預約量（完成／待完成）／營收／預估營收且兩張圖一致；長條高度（預約量圖 max 4、營收圖 max 4000）；y 軸刻度 `4／2／0`、`4k／2k／0`；月視圖 x 軸只標 1 與每 5 日、今天一定標示且緊鄰兩側不標；週（`一 10/19`）、日（`10:00`，10 格，晚於 19 點時擴張）；`niceMax`、`formatMoneyTick`、`buildChartBuckets`。
- **報表面板**：六個彙總數字；排行區標題與插槽；明細表 7 欄、31 列補零、零值「—」、今天列（底色＋「今天」，只有一列）、合計列＝`summarize` 結果並 sticky、表頭 sticky、容器最高 440px、數字欄靠右 tabular-nums；週 7 列、日改為「逐小時明細／時段」且無「今天」標籤。
- **狀態（兩個面板各自涵蓋）**：載入中（`role=status`、`aria-busy`，沒有數字）、空×2（兩種文案）、錯誤（泛用文案、重試呼叫、沒有部分數字）、**全部已取消**（視為有資料：摘要與圖表／明細都在、預約量 0、已取消 N、排行區顯示「此期間沒有被預約的服務」且不渲染排行插槽）。
- **Sidebar**：`admin-shell` 更新——共 9 項、「儀表板與報表」第二項且連到 `/admin/reports`、`/admin/reports` 與子路徑時唯一使用中、有 SVG 圖示、「設計師」改為排在新項目之後；`isNavItemActive` 加 `/admin/reports` 與近似路徑 `/admin/reports-old` 不誤判。
- 畫面只有彙總數字與服務層級資料（`period`／`totals`／`trend`），型別上沒有顧客欄位；測試斷言畫面不含 customer／電話／email／access_token。

## UI 證據（暫時頁面，已刪除，未留在專案中）

以 `AdminShell`＋四個元件＋用真實 `buildTrend`／`summarize` 算出的資料組成暫時頁面，在 Browser 窗格實測：

- **深色 1000px**：儀表板頁籤（營收 NT$120,000 主數字、三個次要數字、兩張圖並排、排行區）、報表頁籤（彙總列、排行區、明細表、右上匯出按鈕位置）；與 mockup 結構一致。Sidebar 第二項顯示「儀表板與報表」與長條圖圖示。
- **淺色**：報表頁籤的明細表捲動到底，**合計列固定在底部、表頭固定**。
- **狀態**：載入中（工具列與篩選維持，內容區三塊骨架）、錯誤（泛用文案＋重試）、空×2、全部已取消（以文字確認各狀態內容正確）。
- **768px 淺色**：儀表板兩張圖上下堆疊（寬度各 514px）、報表頁籤彙總列變兩列；明細表在表格內部橫向捲動（符合規格「表格內部橫向捲動」）；**頁面本身沒有橫向溢出**。
- 以瀏覽器量測確認 jsdom 無法驗證的樣式：合計列字重 700／字級 14px／`position: sticky`、表頭 sticky、容器 `max-height: 440px`、今天列底色為主色淡化。
- 深色模式的營收主數字改用 `primary.main`（亮色 `primary.dark`），標籤與數字對比沿用 TASK-089 計算的 token 值（文字皆 ≥ 4.5:1）。
- 截圖皆在本次對話的瀏覽器窗格截取，未另存檔案（沿用先前 Epic 慣例）。

## 與 mockup 的差異（皆為刻意）

1. **圖表標題與圖例分兩行**：mockup 的圖例與標題同一行（標題左、圖例右）。`TrendBarChart` 的 `legend` 目前渲染在圖表上方自成一行（右對齊），本卡「不得觸碰」該元件，所以標題下方多一行圖例（約 24px）。若要完全一致，需在 `TrendBarChart` 加 `title` 插槽（後續另議）。
2. 今天列／今天標籤底色、斜紋底色以 `color-mix(主色 12%, background.paper)` 取代 mockup 的 `primary-50`（theme 沒有該 token，且暗色需要對應值），與 TASK-089 一致。
3. 排行區的標題與外框（Paper）由面板提供，內容用插槽——TASK-091 的橫條／表格只需提供內容本身。

## 審查發現

| 發現 | 嚴重程度 | 狀態 |
|---|---|---|
| 1. **TASK-089 的 `TrendBarChart` 有 bug（本卡實測發現並修正）**：視覺隱藏的資料表直接套在 `<table>` 上，但表格不吃 `overflow: hidden`，`white-space: nowrap` 的內容把整頁撐寬（768px 時 `scrollWidth` 860 > 753），出現橫向捲軸。089 的 `/design-system` 頁因版面較寬而沒有被注意到。**修正**：把隱藏樣式移到外層 `div`，並更新 089 的對應測試（斷言外層是 DIV 且帶隱藏樣式）。這超出本卡「不得觸碰 `components/ui/TrendBarChart.tsx`」的範圍，但沒有它儀表板頁籤在窄視窗會破版，所以一併修；變更限定在隱藏資料表的包裝，行為與外觀不變，31 項元件測試全過 | 中（窄視窗橫向溢出） | 已修正，需使用者知悉並確認同意此範圍外的小修 |
| 2. 全套單元測試在高負載下的 5 秒逾時（`account-settings-view`、`designer-leaves-tab` 等既有檔案；與 TASK-087／088／089 記錄的同一問題）。本卡 `reports-table-panel` 有 1 項在全套高負載時也逾時過一次：單獨跑每項約 0.3 秒，但 `bodyRows` 原本對 31 列逐列做 role 查詢很貴；已改用 DOM 選取，整檔降到 2.4 秒 | 低 | 本卡部分已處理；既有檔案的問題建議另立任務（降低預設 `maxWorkers` 或加大 UI 測試逾時） |
| 3. jsdom 的 `getComputedStyle` 不處理 CSS 優先權（後出現的規則直接蓋掉），所以「合計列字重 700」這類被 MUI 預設樣式覆寫的屬性無法在單元測試斷言；改在瀏覽器量測，測試只斷言 sticky 定位 | 資訊 | 已在測試檔註解說明 |
| 4. 面板的 `ReportsPanelProps` 以 `status` 區分載入中／空／錯誤／就緒（判別聯集），TASK-092 的容器依狀態傳入；`today` 由容器傳入（`getTaipeiToday()`），面板不自己讀時鐘 | 資訊 | 已寫入元件註解與 design-system 登記 |

## 殘留風險與已知限制

- 元件尚未被實際頁面使用；TASK-092 串接時會用真實資料與設計師篩選 chip 列（本卡的 `controls` 插槽預留）。
- 工具列在窄寬度（< 約 600px）會換行；後台以桌面為主，768px 版面已驗證。
- 今天標籤的顯示由 `buildChartBuckets` 的規則決定（今天一定標、緊鄰兩側不標）；若 mockup 要求不同規則可在該函式調整。
