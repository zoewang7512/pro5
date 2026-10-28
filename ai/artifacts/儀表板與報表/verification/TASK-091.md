# 驗證報告

## 摘要

- 任務：TASK-091 熱門服務排行（`lib/admin/reports-ranking.ts`、`ServiceRankingBars`、`ServiceRankingTable`）
- 結果：**通過**（新增 37 項測試：純函式 20、橫條 8、表格 9；瀏覽器以暫時頁面在淺色／深色、桌面／360px 實測）
- 驗證者：實作 agent（Claude Code）。product／ui 關卡已由使用者核准規格書與 mockup；本卡風險低（純函式＋純展示、無資料存取、無新 dependency、純文字渲染），未另跑 security／architecture 子代理審查。人工驗收待使用者。

## 變更的檔案

| 檔案 | 內容 |
|---|---|
| `lib/admin/reports-ranking.ts`（新增） | `buildServiceRanking`、`rankingShare`（占比）、`rankingBarPercent`（橫條長度，最小 2%） |
| `app/admin/_components/ServiceRankingBars.tsx`（新增） | 儀表板橫條排行（變體 B） |
| `app/admin/_components/ServiceRankingTable.tsx`（新增） | 報表含占比條表格（變體 C） |
| `app/admin/_components/ServiceRankingName.tsx`（新增，任務卡未列） | 兩者共用的服務名稱＋「已下架」標籤（避免兩份重複） |
| `tests/admin/reports-ranking.test.ts`、`tests/components/service-ranking-{bars,table}.test.tsx`（新增） | 測試 |
| `ai/context/design-system.md` | 登記排行元件 |
| 看板卡、驗證報告 | 流程文件 |

## 指令

| 指令 | 結果 | 備註 |
|---|---|---|
| `npx vitest run tests/admin/reports-ranking.test.ts tests/components/service-ranking-bars.test.tsx tests/components/service-ranking-table.test.tsx` | **37 項全數通過** | 純函式 20、橫條 8、表格 9 |
| `npx tsc --noEmit` | 通過 | 0 錯誤 |
| `npm run lint` | 通過 | 0 error |
| `npm run build` | 通過 | |
| `npx vitest run --maxWorkers=3`（全套） | 1530／1533；3 項失敗皆為 `account-settings-view` 的 5 秒逾時 | 既有並行逾時問題（同 TASK-087～090 記錄） |
| `npx vitest run tests/components/account-settings-view.test.tsx`（單獨） | 43 項全過 | 確認非本卡造成 |

## 單元測試涵蓋

- **`buildServiceRanking`**：取消排除（含「只有取消的服務不列」）、全取消／空回空陣列、預約量降序、營收只計已完成、同量依營收、再依名稱（`zh-Hant`）、再依 `serviceId` 保底且與輸入順序無關、已下架、價格取快照（同服務不同快照價各自計入）、單項服務、25 個服務不設上限、浮點加總收斂（0.1×3＝0.3）、不修改輸入。
- **`rankingShare`／`rankingBarPercent`**：mockup 的 110 筆資料得 36／25／21／9／5／5；三等分各 33%（不要求加總 100%）；單項 100%；空 0；最大者 100%、極小比例保底 2%。
- **橫條**：順序與數字、已下架標籤只出現一次、橫條長度比例（100／50／12.5%）、最小可見寬度、橫條不進無障礙樹、窄寬度（服務欄可換行、數字 `nowrap`）、空狀態、純文字（`<script>`、`=SUM(1)` 以文字顯示且不產生元素）。
- **表格**：五個欄位、逐列內容（含占比）、四捨五入、已下架標籤、占比條長度、服務名稱為列標頭、最小寬度 480＋容器可橫向捲動、空狀態、純文字。

## UI 證據（暫時頁面，已刪除，未留在專案中）

以真實 `ReportsDashboardPanel`／`ReportsTablePanel`＋`buildTrend`／`summarize`／`buildServiceRanking` 算出的資料組成暫時頁面（含長名稱服務、已下架服務、1 筆取消），在 Browser 窗格實測：

- **淺色**：橫條排行（名次、服務、橫條、預約量、營收對齊；長名稱換行；「已下架」標籤）、報表表格（五欄、占比條＋百分比），與 mockup 變體 B／C 結構一致。
- **深色**：橫條與表格皆清楚；軌道 `rgba(255,255,255,.08)`、填色 `rgb(212,168,75)`。
- **360px 寬的面板**：服務欄換行、橫條縮到最小寬度仍可見；量測 `document` 與每一列皆無橫向溢出（`scrollWidth` ＝ `clientWidth`）。
- 截圖皆在本次對話的瀏覽器窗格截取，未另存檔案（沿用先前 Epic 慣例）。

## 與 mockup／規格的差異（皆為刻意）

1. 占比條長度＝預約量 ÷ 最大預約量（與 mockup 變體 C 一致），旁邊的百分比才是占排行總預約量的比例；因此第一名的條永遠滿格、但百分比可能只有 36%。使用者 2026-10-25 決定維持條長，僅在表頭加註「占比（條長為相對最高）」。
2. 排行標題、占比說明與外框由 TASK-090 的面板提供，本卡元件只畫內容。
3. 新增 `ServiceRankingName.tsx`（任務卡允許檔案清單未列）：兩個元件共用的名稱＋標籤，避免重複實作。

## 審查發現

| 發現 | 嚴重程度 | 狀態 |
|---|---|---|
| 排行元件的空狀態與面板的空狀態重複：面板在 `totals.booked === 0` 時不會渲染 `ranking` 插槽，元件自己的空狀態目前只在「booked > 0 但排行為空」這種不可能的情況才會出現，屬防禦性 | 資訊 | 依任務卡要求保留 |
| 全套測試並行逾時（`account-settings-view`）為既有問題，與 TASK-087～090 同一議題 | 低 | 建議另立任務 |

## 殘留風險與已知限制

- 元件尚未被頁面使用；TASK-092 串接時以 `buildServiceRanking(依期間與設計師篩選過的預約)` 的結果傳入兩個面板的 `ranking` 插槽。
- 排行以服務 id 分組，名稱取該組第一筆預約的 `serviceName`（同一服務不會有不同名稱）。
- 真實資料的排行對帳由 TASK-092 走查。
