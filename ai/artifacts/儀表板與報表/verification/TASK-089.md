# 驗證報告

## 摘要

- 任務：TASK-089 儀表板與報表 `TrendBarChart` 圖表元件（純 CSS 堆疊長條圖）
- 結果：**通過**（31 項單元測試通過；`/design-system` 區塊在淺色／深色、桌面／768px 目視確認）
- 驗證者：實作 agent（Claude Code）。product／ui 關卡已由使用者核准 mockup 與計畫；本卡風險低（純展示元件、無資料存取、無新 dependency），未另跑 security／architecture 子代理審查。人工驗收待使用者。

## 變更的檔案

| 檔案 | 內容 |
|---|---|
| `components/ui/TrendBarChart.tsx`（新增） | 純展示元件：堆疊長條、網格與 y 軸刻度、x 軸標籤稀疏化、今天標示、tooltip、roving tabindex、隱藏資料表 |
| `tests/components/trend-bar-chart.test.tsx`（新增） | 31 項單元測試 |
| `app/design-system/page.tsx` | 新增 TrendBarChart 展示區塊（月 31 格、週 7 格、日 10 格、全零、空） |
| `ai/context/design-system.md` | 元件庫 inventory 新增一列 |
| 看板卡、任務卡、本報表 | 流程文件 |

## 指令

| 指令 | 結果 | 備註 |
|---|---|---|
| `npx vitest run tests/components/trend-bar-chart.test.tsx` | **31 項通過** | |
| `npx tsc --noEmit` | 通過 | 0 錯誤 |
| `npm run lint` | 通過 | 0 error |
| `npm run build` | 通過 | `/design-system` 正常預先產生 |
| `npx vitest run --maxWorkers=3`（全套） | 77 檔通過、3 檔 7 項失敗（1423／1430） | 見「審查發現」第 1 項；3 個檔案單獨重跑 91 項全過 |

## 單元測試涵蓋（31 項）

- **高度與堆疊**：高度＝value／max×180px；solid 在下、striped 在上（不論傳入順序）；值為 0 不渲染但欄位仍佔位；> 0 至少 2px；超過 max 夾在頂端且總高 ≤ 180px、頂到上緣後的段不再疊；max 不是正數時不畫（不產生 NaN）。
- **軸與圖例**：y 軸三個刻度＋`formatTick`；`showLabel=false` 仍佔位但 `visibility: hidden`；今天＝標籤粗體＋該格 `aria-current="date"`；圖例兩個標記帶文字、沒給就不渲染。
- **tooltip**：預設不顯示；hover 顯示（多行、第一行粗體）、移開消失；鍵盤聚焦顯示、失焦消失；方向鍵後換到新格；Esc 關閉並在下次 hover／移動焦點後重新顯示；**提示顯示時 Esc 不再往外傳、沒有提示時照常往外傳**（外層 Dialog 仍能被 Esc 關閉）；點一下（觸控）顯示；一律純文字（`<img onerror>`、`<b>` 字樣不被解析成標籤）。
- **鍵盤**：31 格只有一個 tab stop；Tab 進入一次、再 Tab 離開圖表；左右鍵移動且到邊界停住、tab stop 跟著移動；Home／End；離開後 Shift+Tab 回到上次停留的格；帶 Alt 的方向鍵不處理；`buckets` 變少時 tab stop 仍在範圍內。
- **無障礙**：`role="group"`＋名稱；每格 `role="img"`＋`aria-label`；隱藏資料表（標題、每格一列，列首與內容與 `buckets` 一致，視覺隱藏但在無障礙樹中）；斜紋以 `repeating-linear-gradient` 與實心區分，不只靠顏色。
- **空資料**：顯示 `emptyLabel`（預設「沒有資料」），沒有欄位與資料表。

## UI 證據（`/design-system` 的 TrendBarChart 區塊，Browser 窗格實測）

- **淺色桌面**：月 31 格、週 7 格、日 10 格、全零、空；與 mockup 變體 B 一致（180px 長條區、4px 欄距、最寬 32px、3 條網格、底線較深、y 軸 3 刻度、圖例在右上）。
- **深色桌面**：實心／斜紋改用暗色 `primary.main`；tooltip 反白（淺底深字）；今天標籤改用暗色 `primary.main`。
- **768px 淺色與深色**：無橫向溢出（`scrollWidth ≤ innerWidth`）；週的 `10/19（一）` 型標籤不重疊、不截斷。
- **互動**：hover 提示、Tab 進入後左右鍵移動並顯示焦點環與提示；整頁四張有資料的圖各一個 tab stop（共 4 個）。
- 截圖皆在本次對話的瀏覽器窗格截取，未另存檔案（沿用先前 Epic 的慣例）。

### 對比度（以 token 實際值計算）

| 項目 | 淺色 | 深色 | 標準 |
|---|---|---|---|
| 長條／斜紋（`primary.main` 對 `background.paper`） | 3.58:1 | 6.93:1 | 圖形 ≥ 3:1 ✓ |
| 今天標籤（淺 `primary.dark`／深 `primary.main`） | 7.16:1 | 6.93:1 | 文字 ≥ 4.5:1 ✓ |
| 刻度與 x 軸標籤（`text.secondary`） | 5.97:1 | 8.44:1 | 文字 ≥ 4.5:1 ✓ |
| tooltip（`background.paper` 字 on `grey.900` 底） | 14.97:1 | 13.27:1 | 文字 ≥ 4.5:1 ✓ |

## 設計審查檢查清單（`ai/checklists/design-review-checklist.md`）對照

- 字級只用 11／12（`typeScale.fontSize.xs`／`sm`），字重 400／700；沒有硬寫 hex（顏色全取自 theme palette）；間距為 4 的倍數（`gap` 4／8／16、tooltip 內距 8／12）。
- Depth：長條區與面板不疊用邊框＋陰影；tooltip 靠反白底色與位置區隔，沒有額外陰影。
- 互動：default／hover（tooltip）／focus（焦點環＋tooltip）／空資料皆完成；沒有 disabled／loading（本元件為純展示，載入中由呼叫端換骨架）。
- 顏色不是唯一資訊載體：已完成＝實心、待完成＝斜紋＋圖例文字；數值另有 tooltip 與隱藏資料表。
- Mockup 對齊：逐項對照 `reports-variant-b.html` 的圖表區；偏離處見下方。

## 與 mockup 的差異（皆為刻意）

1. 斜紋的底色：mockup 用 `primary-50`（`#FBF4E2`），但 theme palette 沒有 `primary.50`，且暗色模式需要對應值。改用 `color-mix(主色 12%, background.paper)`，在兩種模式都隨 token 變動、不寫死 hex。
2. 暗色模式的網格線：mockup 只有亮色。暗色的 `grey.200` 與底色幾乎同色（網格看不見），所以暗色各往上一階（網格 `grey.300`、底線 `grey.400`）。
3. tooltip 底色用 `grey.900`＋`background.paper` 字（mockup 寫死 `#fff`）：暗色模式的 `grey.900` 是近白，因此自然變成反白提示，對比兩種模式都 ≥ 13:1。

## 審查發現

| 發現 | 嚴重程度 | 狀態 |
|---|---|---|
| 1. 全套單元測試在 `--maxWorkers=3` 下仍有 3 個既有 UI 元件測試檔逾時（`account-settings-view`、`designer-basic-info-form`、`login-form`，共 7 項）；本次開發伺服器與瀏覽器同時在跑，負載比 TASK-088 高。單獨重跑這 3 檔 91 項全過；這些檔案與本卡無任何關聯。與 TASK-087／088 報告記錄的是同一個既有並行逾時問題 | 低 | 已確認非本卡造成；建議日後另立任務處理（降低預設 `maxWorkers` 或加大 UI 測試逾時） |
| 2. 圖表底線／網格的對比（暗色底線約 2:1）低於圖形 3:1：網格線是輔助參考，數值已由 y 軸刻度、tooltip、隱藏資料表完整提供，不屬於理解內容所必需的圖形 | 資訊 | 沿用 mockup「弱灰網格」意圖，已在暗色提高一階 |
| 3. 元件不替「今天」強制顯示 x 軸標籤：月視圖若今天不在每 5 日的標籤上，今天標籤不可見（mockup 同樣如此）。需要時由呼叫端對該格設 `showLabel`（TASK-090 決定） | 資訊 | 已寫入 `showLabel` 的註解 |
| 4. 瀏覽器 console 的錯誤僅為離線環境下的外部資源載入失敗（`ERR_INTERNET_DISCONNECTED`），與元件無關 | 資訊 | 不需處理 |

## 殘留風險與已知限制

- 提示框位置靠簡單規則（長條不高時浮在頂端上方、否則貼下緣；左右 20% 靠邊）；極窄容器（< 320px）時提示可能略超出圖外，後台以桌面為主，不處理。
- 觸控裝置以「點一下聚焦」顯示提示；點圖表以外的地方才會收起（失焦）。
- 元件尚未被實際頁面使用；TASK-090 之後才會以真實 `buckets` 串接，nice max 與文案由呼叫端負責。
