# 驗證報告

## 摘要

- 任務：TASK-094 儀表板與報表 Epic 收尾（分頁筆數驗證與超量提示、移除示範資料腳本、文件與 README 同步）
- 結果：**通過，使用者人工驗收通過 2026-10-25**
- 驗證者：實作 agent（Claude Code）。來源是 Epic 完成後 architect＋security-reviewer 總覽審查（皆「有條件通過」）；本卡處理其通過條件。agent 輸出不等於人工核准。

## 變更的檔案

| 檔案 | 內容 |
|---|---|
| `lib/admin/reports.ts` | `fetchReportAppointments`：第一頁 `count: "exact"`、依總筆數決定頁數、取回列數必須等於總筆數；超過 5000 回 `code: "too_many_rows"`；新增 `REPORT_ROW_LIMIT`、`ReportFetchError`、`ReportFetchResult` |
| `app/admin/_components/ReportsStates.tsx` | 新增 `status: "too_large"`、`ReportsTooLargeState`（warning、無重試） |
| `ReportsView.tsx`、`ReportsTablePanel.tsx`、`ReportsDashboardPanel.tsx` | 超量狀態接線；兩個面板各加一行分支（見「範圍差異」） |
| `scripts/seed-demo-reports.mjs` | **刪除** |
| `supabase/migrations/0020_appointment_price_snapshot_down.sql` | 只改檔頭註解（備份步驟與警告），SQL 不變 |
| `tests/admin/reports.test.ts`、`tests/components/reports-view.test.tsx`、`reports-dashboard-panel.test.tsx`、`reports-table-panel.test.tsx` | 見下 |
| `screen-spec-報表.md`、`feature-spec.md`、`project-map.md`、`decisions.md`、`README.md`、`verification/TASK-092.md` | 文件同步 |
| 看板卡、任務卡、本報告 | 流程文件 |

未觸碰：`summarize`／`buildTrend`／排行與匯出的計算與口徑、圖表元件、其他 migration、其他頁面；看板其他卡的 `gates`。

## 範圍差異（需使用者知悉）

任務卡原列「面板元件不得觸碰」，但新增 `too_large` 狀態必須讓兩個面板的 error 分支旁各加一行（`if (props.status === "too_large") return <ReportsTooLargeState />;`）與一個 import。這是必要的最小擴張，沒有動到面板的繪製或計算；已更新任務卡的允許範圍並記入 decisions。

## 指令

| 指令 | 結果 | 備註 |
|---|---|---|
| `npx vitest run tests/admin/reports.test.ts` | **44 項通過**（改寫分頁相關案例並新增 count 驗證案例） | |
| 同上，`TZ=UTC`／`TZ=PST8PDT`／`TZ=Asia/Taipei` | 各 44 項通過 | 時區矩陣（Windows 的 Node 不認 `America/Los_Angeles`，用 POSIX 寫法） |
| `npx vitest run` reports-view／dashboard-panel／table-panel | 通過（reports-view 41 項，兩個面板檔共 44 項） | |
| `npx tsc --noEmit`、`npm run lint`、`npm run build` | 通過 | 0 錯誤、0 警告 |
| `npm run test:reports` | **19 項通過** | 對真實 Supabase；其中「報表彙總」案例以真實 client 呼叫新的 `fetchReportAppointments`，證實 `count: "exact"` 搭配 range／排序／embed 可用 |
| `npx vitest run --maxWorkers=3`（全套） | 1604／1608；4 項失敗在 `account-settings-view`、`designer-picker-section`、`login-form` | 並行逾時（前三者為既有已知）。**`designer-picker-section` 是這次第一次出現**；三檔 `--maxWorkers=1` 重跑 80 項全過，判斷為負載造成，與本卡無關 |

## 測試涵蓋

- **`fetchReportAppointments`**：第一頁帶 `count: "exact"`、其餘頁不帶；2003 筆＝3 頁且列數一致；剛好 1000 筆只送一個請求；剛好 5000 筆成功（5 頁）；5001 筆回 `too_many_rows` 且只送一個請求、不回傳部分資料；**單頁回的列數少於總筆數（Max rows 被調小，600 筆只回 500 列）回一般錯誤，不少算**；取回列數多於總筆數回錯誤；`count` 為 `null`／`undefined`／負數／小數／字串／`NaN` 回錯誤；中途某頁失敗回泛用錯誤且不洩漏內容；既有的欄位白名單、`+08:00` 邊界、價格與狀態驗證、網路例外案例保留。
- **元件**：超量時顯示專用標題與出路、**沒有重試按鈕**、沒有一般錯誤文案（兩個頁籤一致）、匯出按鈕停用；改成週粒度後重新查詢並恢復；一般失敗仍是原文案與重試。
- **面板**：兩個面板的 `too_large` 各一項（無重試、不顯示金額或表格）。

## 瀏覽器實測（開發伺服器、店長登入，只讀）

- 一般情況：9 月請求帶 `Prefer: count=exact`，回應 `content-range: 0-3/4`，畫面正常；10 月數字與修改前相同（預約量 1、待完成 1、預估營收 NT$5,000）。
- 超量：以改寫回應標頭 `content-range` 為 `0-999/6000` 模擬。畫面顯示 warning「此期間的預約筆數超過上限（5,000 筆）／請改用較短的期間（日或週）。」、**沒有重試按鈕**、沒有「無法載入報表」；**只送出 1 個請求**（沒有再取後面的頁）；工具列仍可操作。關閉模擬後切到週視圖恢復正常（本週 0 筆，`count=0` 也正確處理）。
- 螢幕截圖：超量狀態（淺色／深色模式皆為 `ai/context/design-system.md` 既有 `Alert` 元件，只取了深色模式截圖並目視確認；淺色未另存）。

## 移除示範腳本與文件

- `scripts/seed-demo-reports.mjs` 已刪除；全專案除歷史文件（TASK-092 驗證報告、TASK-094 任務卡）外沒有殘留引用，`package.json` 沒有對應 script。TASK-092 驗證報告已註記「已於 TASK-094 移除」。
- `0020_down` 檔頭補備份 SQL 與「2026-10-25 之後快照為真實下單價、回滾後無法還原」的警告。
- `screen-spec-報表.md`：三處舊說法加註「已調整」，新增「超過筆數上限」狀態列；`feature-spec.md`：Sidebar 項目名稱改為「儀表板與報表」。
- `project-map.md`：查詢說明、已知限制（升級時口徑整個搬進 SQL 成為唯一來源、chip 計數與 `summarize().booked` 必須等價）、測試與決策指引（補匯出測試與 decisions TASK-093／094）。
- `README.md`：「功能特色」補匯出；新增「儀表板與報表刻意延後的項目」五條（資料庫端彙總、匯出日期欄補年份、時區測試自動化、整合測試改用測試專案、升級 `next` 與回報 `write-excel-file`，後者對應 TASK-095／096）。

## 已知限制與殘留風險

- 錯誤碼只在 `reports.ts` 內擴充，共用的 `AdminError` 沒改；除 `ReportsView` 之外沒有其他呼叫端讀 `code`。
- 超量判斷依賴 `count: "exact"`：若日後 Supabase／PostgREST 行為改變而不回 `Content-Range` 總數，會回一般錯誤（不會少算）。
- 翻頁期間若有預約新增或刪除，取回列數與 `count` 可能不符而回錯誤（寧可失敗），店長按重試即可。
- 本卡不處理（已立卡或列入 README 優化項目）：`next` 升級（TASK-095）、`write-excel-file` 缺陷（TASK-096）、匯出日期欄加年份、時區測試自動化、整合測試改用獨立專案、realtime publication 確認、`fflate` overrides。
- 看板 `gates`：本卡不更動任何卡片的審查旗標。

## 人工驗收（待使用者）

1. 本機或部署後打開 `/admin/reports`：月、週、日各切一次，數字與之前一致。
2. 閱讀 README「功能特色」與「未來規劃 → 儀表板與報表刻意延後的項目」是否符合你的預期。
3. 確認 `scripts/seed-demo-reports.mjs` 移除、`0020_down` 檔頭備份提醒可接受。
4. 超量提示只能用模擬看到（正式庫資料量遠低於上限）；如需親眼確認文案與版面，可請我再給一次模擬步驟。

## 後續任務

- TASK-095（升級 `next`）、TASK-096（`write-excel-file` 缺陷）。
- 部署：本卡改了資料層與畫面，正式環境要看到修正需重新部署（由使用者決定）。
