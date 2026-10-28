# AI-Ready 任務卡

## Metadata

- 任務：匯出報表為 Excel（`lib/admin/reports-export.ts`、匯出按鈕與 Toast、新增 `write-excel-file` dependency、讀回測試、人工驗收）
- 上層規格：[`feature-spec.md`](../feature-spec.md)（需求 §4、安全性與隱私）、[`screen-spec-報表.md`](../screen-spec-報表.md)（匯出狀態）、[`architecture-notes.md`](../architecture-notes.md)（§5、§6）
- 上層 Epic：儀表板與報表
- 上層 User Story：匯出報表為 Excel
- 分軌：前後端串接（純前端，瀏覽器端產生）
- 前置任務（dependsOn）：TASK-092
- 狀態：草稿
- 風險等級：中（新增第三方套件＝供應鏈；檔案產生與下載；公式注入；匯出內容不得含個資）
- Agent owner：Claude Code
- 人工核准者：待使用者核准計畫

## 目標

店長在「報表」頁籤按一下，下載與畫面數字完全一致的 `.xlsx`，且不含任何顧客資料。

## 情境包（Context Pack）

- 相關檔案：`lib/admin/reports.ts`／`reports-ranking.ts`（已算好的結果）、`app/admin/_components/ReportsView.tsx`、`ReportsToolbar.tsx`（`actions` 插槽）、`components/ui/ToastProvider.tsx`（`useToast`）、`lib/admin/format.ts`、`package.json`、`next.config.ts`（確認沒有會擋 Worker／blob 的 CSP；已查：目前沒有 CSP 設定）、`tests/components/closed-dates-section.test.tsx`（按鈕 loading 測試慣例）。
- 既有模式：dependency 一律精確版本鎖定（`package.json` 無 `^`）；`server-only`／用戶端分界；Toast 提示。
- 假設：套件 `write-excel-file@4.1.1`（MIT，唯一相依 `fflate`，2026-06-08 發布）；若 spike 證明 browser 入口在 Next 16 打包或瀏覽器執行有問題，改試 `universal` 入口；兩者皆不行時**停下來回報**，不自行改用其他套件。
- 未知事項：`write-excel-file/browser` 的 Web Worker 在 Next 16 Turbopack 下的行為；`.toBlob()` 是否為 4.x 的正確 API（以套件型別定義與 README 為準）。
- 允許變更的檔案：
  - `lib/admin/reports-export.ts`（新增：`buildExportSheets`、`buildExportFileName`、`exportReportXlsx`）
  - `app/admin/_components/ReportsView.tsx`、`ReportsToolbar.tsx`（**只**在既有 `actions` 插槽放入匯出按鈕與其狀態）
  - `package.json`、`package-lock.json`（新增 `write-excel-file`（精確版本）；devDependency `fflate`（精確版本，供測試解開 xlsx））
  - `tests/admin/reports-export.test.ts`、`tests/components/reports-view.test.tsx`（補匯出案例）（新增／追加）
  - `ai/context/decisions.md`、`project-map.md`（新增套件與匯出決策）
  - `ai/artifacts/儀表板與報表/verification/TASK-093.md`（新增）
- 不得觸碰：`lib/admin/reports.ts`／`reports-ranking.ts`（匯出只消費結果）、面板與排行元件、migration、其他 `app/` 頁面。

## 需求

- **Spike（第一步，結果寫入完成證據）**：安裝套件後，用最小程式在 `npm run build` 與瀏覽器中實際產生並下載一個 xlsx；確認可被 Excel／Google 試算表開啟；決定使用 `browser` 或 `universal` 入口；使用動態 `import()`（只在按下匯出時載入，不進主 bundle）。
- `buildExportSheets(report)`（純函式，輸入型別只有彙總結果，**型別上沒有任何 `customer_*`**）：
  1. 「彙總」：期間、設計師篩選（「全部設計師」或名稱）、匯出時間（台北）、預約量、已完成、待完成、已取消、營收、預估營收、口徑說明文字。
  2. 「熱門服務排行」：名次、服務、是否已下架、預約量、營收（全部有預約的服務）。
  3. 「逐日明細」（日粒度為「逐小時明細」）：日期／時段、預約量、已完成、待完成、已取消、營收、預估營收；最後一列「合計」。
  - 筆數與金額為**數值儲存格**（金額格式 `#,##0`）；文字一律字串型別；欄寬與表頭粗體（簡單即可）。
- `buildExportFileName(period, designerNames)`：`報表_<期間>_<設計師>.xlsx`；期間＝`2026-10`／`2026-10-19_2026-10-25`／`2026-10-24`；設計師＝`全部設計師` 或所選名稱以 `_` 連接；移除 `\ / : * ? " < > |` 與控制字元、前後空白；總長 ≤ 80；清理後為空回退為 `全部設計師`。
- `exportReportXlsx(report)`：動態載入套件 → 產生 Blob → 暫時 `<a download>` 觸發下載 → `URL.revokeObjectURL`；失敗丟出泛用錯誤。
- UI：報表頁籤工具列右側「↓ 匯出 Excel（.xlsx）」（outline 次要按鈕）；儀表板頁籤不顯示；匯出中停用並顯示 spinner＋「匯出中…」；沒有資料／載入中／錯誤時停用；成功 Toast「已匯出「<檔名>」」；失敗 Toast「匯出失敗，請稍後再試。」可再按重試；匯出內容＝畫面目前的期間與設計師篩選，使用與畫面**同一份**計算結果。
- `decisions.md`：記錄套件選型（含否決 `xlsx`／`exceljs` 的理由）、瀏覽器端產生的取捨、公式注入處理、版本升級須重跑讀回測試。

## 驗收標準

- 單元測試：`buildExportSheets` 的工作表名稱、欄位、數值型別、合計列與輸入一致（月／週／日三種粒度）；空資料不產生檔案（按鈕停用，函式也拒絕）；`buildExportFileName` 清理（路徑字元、控制字元、過長、全空、`..`）；以 `write-excel-file/node` 的 `toBuffer()` 產生實檔，用 `fflate` 解開後驗證：**工作表 XML 不含 `<f>`**、筆數與金額為數值（`<v>` 且非字串型別）、含 `=SUM(1)`／`+1`／`-1`／`@x`／Tab 開頭名稱的儲存格為字串型別且內容原樣；解開的所有檔案文字中**不含**測試用的顧客姓名／電話／email。
- 元件測試：匯出按鈕只在報表頁籤出現；匯出中停用與文案；無資料停用；成功／失敗 Toast；失敗後可再按；匯出呼叫收到的內容與畫面彙總一致（mock 匯出函式）；連點只觸發一次。
- 手動驗證（人工驗收）：在正式環境實際按下匯出，下載檔案以 Excel（或 Google 試算表）開啟，三個工作表與畫面數字一致、金額可加總、合計正確、中文檔名正常。
- 套件：`package.json` 為精確版本；`npm audit`（production 相依）無新增的 high／critical；`npm run build` 通過；主 bundle 不含 `write-excel-file`（動態 chunk）。
- security-reviewer 審查通過：套件與鎖定、檔名清理、無個資、公式注入、下載實作。

## 實作備註

- 匯出的資料來源是 `ReportsView` 已有的計算結果，**不重新查詢**，也不為匯出新增任何請求。
- 不做 CSV／PDF、不做逐筆預約明細（規格非目標）。

## 驗證契約

- 單元測試：`npx vitest run tests/admin/reports-export.test.ts tests/components/reports-view.test.tsx`；`npm test` 回歸。
- 整合測試：`npm run test:reports` 回歸（不新增）。
- E2E 測試：不適用。
- 型別檢查：`npx tsc --noEmit`；Lint：`npm run lint`；Build：`npm run build`（並檢查 chunk 切分）。
- 螢幕截圖：匯出按鈕預設／匯出中／停用、成功與失敗 Toast（淺／深）；實際開啟的 xlsx 截圖。
- 安全性檢查：security-reviewer；`npm audit`；解開 xlsx 檢查無個資、無公式。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：
- 已知限制：
- 後續任務：Epic 完成後 architect＋security-reviewer 總覽審查；README「未來規劃」同步更新。
