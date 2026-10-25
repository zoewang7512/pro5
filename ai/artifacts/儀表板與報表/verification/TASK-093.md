# 驗證報告

## 摘要

- 任務：TASK-093 儀表板與報表 匯出 Excel（`lib/admin/reports-export.ts`、匯出按鈕與 Toast、新增 `write-excel-file` dependency、讀回測試）
- 結果：**通過，使用者人工驗收通過 2026-10-25**（65 項測試；瀏覽器實測 xlsx 讀回無公式、數字與畫面一致；security-reviewer 有條件通過、條件已處理）
- 驗證者：實作 agent（Claude Code）＋ security-reviewer 子代理（審查結論「有條件通過」，條件已處理，見下）。agent 輸出不等於人工核准。

## 變更的檔案

| 檔案 | 內容 |
|---|---|
| `lib/admin/reports-export.ts`（新增） | `buildExportSheets`（三個工作表）、`buildExportFileName`、`exportReportXlsx`、`hasExportableData`、`EXPORT_ERROR_MESSAGE` |
| `app/admin/_components/ReportsView.tsx` | 只在既有 `actions` 插槽放入匯出按鈕；`handleExport`（ref 守衛、Toast） |
| `package.json`、`package-lock.json` | dependency `write-excel-file` `4.1.1`；devDependency `fflate` `0.8.3`（皆精確版本） |
| `tests/admin/reports-export.test.ts`（新增） | 24 項：工作表、數值型別、三種粒度、檔名清理、xlsx 讀回（無 `<f>`、字串型別、無個資） |
| `tests/admin/reports-export-download.test.ts`（新增） | 3 項：下載路徑（anchor、revoke 時機）、錯誤只丟泛用訊息 |
| `tests/components/reports-view.test.tsx` | 新增 9 項匯出案例；既有案例改以 `ToastProvider` 包裝 |
| `ai/context/decisions.md`、`project-map.md` | 套件選型、取捨、已知限制 |
| 看板卡、本報告 | 流程文件 |

未觸碰：`lib/admin/reports.ts`／`reports-ranking.ts`、面板與排行元件、`ReportsToolbar.tsx`（插槽本來就在）、migration、其他頁面。

## Spike 結果

- `write-excel-file@4.1.1` 的 **`browser` 入口**在 Next 16.3（Turbopack）`npm run build` 與開發伺服器都可用，不需改用 `universal`。
- 動態 `import("write-excel-file/browser")` 在 build 產物中獨立成 chunk（`static/chunks/17hiw17068_bb.js`，約 85 KB），只被一個 215 bytes 的非同步載入器引用，不在報表頁的主 bundle；報表頁的 client reference manifest 只在 SSR 模組圖列出它（伺服器端 chunk），不在 client chunk 清單。
- 實測（開發伺服器、店長登入）：按下匯出後瀏覽器端產生 `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` Blob（5,974 bytes，檔頭 `PK`），檔名 `報表_2026-10_全部設計師.xlsx`，Toast「已匯出「報表_2026-10_全部設計師.xlsx」」。為避免在使用者電腦寫入檔案，驗證時攔截了 `<a>.click()`，只讀回 Blob。
- 在瀏覽器內以 `DecompressionStream` 解開該 Blob 讀回：三個工作表（彙總、熱門服務排行、逐日明細）、無 `<f>`、數值儲存格為數值、33 列明細（表頭＋31 天＋合計）；數字與畫面一致（預約量 1、待完成 1、預估營收 5,000、排行第 1 名 1 筆）。
- **尚未做**：用 Excel／Google 試算表實際開啟（見「人工驗收」）。

## 指令

| 指令 | 結果 | 備註 |
|---|---|---|
| `npx vitest run tests/admin/reports-export.test.ts tests/admin/reports-export-download.test.ts tests/components/reports-view.test.tsx` | **65 項全過**（24＋3＋38） | |
| `npx tsc --noEmit` | 通過 | 0 錯誤 |
| `npm run lint` | 通過 | 0 error、0 warning |
| `npm run build` | 通過 | 在最後一次改檔後重新 build；`/admin/reports` 在路由表；chunk 切分見上 |
| `npx vitest run --maxWorkers=3`（全套，審查修正前） | 1588／1593；5 項失敗在 `login-form`、`account-settings-view`、`designer-portfolio-tab` | 既有並行逾時問題（TASK-087～092 同樣記錄）。單獨重跑三檔：第一次 67／68（account-settings-view 1 項），再單獨跑該檔 43／43 全過，與本卡無關 |
| `npm run test:reports` | 19 項全過 | 對真實 Supabase 的回歸（本卡未改資料層） |
| `npm audit --omit=dev` | 4 項（next critical；nanoid、sharp、source-map-js high） | **全為既有**，與新增套件無關；`write-excel-file`、`fflate` 沒有公告。建議另立任務升級 next（審查者指出 16.0.0–16.4.0 有多個公告） |

## 測試涵蓋

- **工作表**：名稱與表頭；彙總六個數字、期間、日期範圍、設計師、匯出時間（台北）；排行順序與「已下架」；月／週／日三種粒度（日粒度改名「逐小時明細」、首欄「時段」）；合計列＝彙總且各列加總相等；空資料拒絕、全部已取消仍可匯出。
- **型別**：筆數與金額為 `Number`、金額格式 `#,##0`；文字為 `String`。
- **讀回（`write-excel-file/node` 產實檔＋`fflate` 解開；node／browser 入口共用同一個產生邏輯）**：工作表 XML 不含 `<f>`；彙總數字儲存格有 `<v>` 且無 `t="s"`；名稱為 `=SUM(1)`／`+1`／`-1`／`@x`／Tab 開頭時為共用字串、內容原樣；把顧客姓名、電話、email 塞進輸入物件，解開的所有檔案都不含。
- **檔名**：三種期間、設計師連接、路徑與保留字元、控制字元與前後空白、`..`、`./.` 與 `.\u0000.` 這類清理後重新接起來的點、結尾的點、RLO／BOM／零寬／行段分隔符、全空回退、總長 ≤ 80（含代理對）。
- **下載**：`download` 屬性等於回傳檔名、anchor 點擊時在 DOM 中且點擊後移除、999 ms 未 revoke／1000 ms 已 revoke；套件拋出含細節的錯誤與 `createObjectURL` 拋錯，都只丟「匯出失敗，請稍後再試。」且沒有下載動作。
- **元件**：按鈕只在報表頁籤；呼叫收到的期間／設計師／彙總／排行／趨勢與畫面一致且不新增查詢；套用設計師篩選後的名稱與數字；匯出中停用與「匯出中…」、成功 Toast、恢復；同一個 act 內連按兩次只觸發一次（ref 守衛）；失敗 Toast 與可重試；無資料、載入中、錯誤時停用。

## 安全性審查（security-reviewer，2026-10-25）

結論：有條件通過；沒有 Critical／High／Medium。

| 項目 | 結果 |
|---|---|
| 套件與鎖定 | 通過：精確版本、lockfile `resolved` 為 registry.npmjs.org 且有 sha512、無 install script、相依只多 `fflate`；套件 browser 程式碼無 eval／fetch／cookie／儲存空間存取；Worker 只在單檔 ≥160 KB 時用 blob URL |
| 公式注入 | 通過：所有文字 `type: String` 寫成共用字串，模組不使用 `"Formula"`；「不加前綴」的決定可接受，殘留風險已記入 decisions |
| 個資 | 通過：輸入型別只有彙總結果；檔案不含預約 id／設計師 id／作者中繼資料 |
| 下載與前端 | 通過 |
| **L-2** 檔名可出現 `..`、未移除 bidi／格式字元 | **已修正**：先刪不安全字元（含 Cc／Cf／Zl／Zp）再處理點、截斷後去掉結尾點；補測試 |
| **L-3** 下載路徑與套件錯誤沒有測試 | **已補**：`reports-export-download.test.ts` |
| 重新 build 的 chunk 證據 | **已補**（見上） |
| **L-1** 名稱為 `constructor`／`__proto__` 等 Object.prototype 成員時，套件的共用字串表（一般物件）會寫壞該儲存格 | **未修**，列為已知限制（見下）：只影響完整性、名稱只有店長能寫、非注入 |

## 已知限制與殘留風險

- **L-1（套件缺陷）**：服務或設計師名稱剛好是 `constructor`、`__proto__`、`toString` 等時，匯出檔該格內容錯誤、Excel 會跳修復對話框。不在匯出端偷改文字；建議向上游回報，必要時以 patch-package 改成 `Object.create(null)`。
- 公式注入殘留：使用者在該格按 F2＋Enter、另存 CSV 再開、經純文字剪貼簿貼回時 Excel 會重新解析為公式。目前內容只有店長自己寫的名稱；**日後匯出顧客可控文字前必須重新評估**。
- 日後若加上 CSP 且匯出可能超過 160 KB，需要 `worker-src blob:`。
- 單期間 5,000 列上限沿用（匯出吃同一份結果）。
- 失敗時錯誤被完整吞掉為泛用訊息，除錯沒有線索（刻意，避免洩漏內部細節）。
- 沒有逐筆預約明細、CSV、PDF（規格非目標）。
- 升級 `write-excel-file`／`fflate` 時必須重跑 `tests/admin/reports-export.test.ts`（讀回測試）並複查 browser 入口原始碼。
- 螢幕截圖：未存檔。載入中（匯出中）狀態只由元件測試驗證，沒有在真實瀏覽器截圖（產生太快）；淺／深色的匯出按鈕與 Toast 截圖留待人工驗收時一併確認。

## 人工驗收（待使用者）

請在正式環境（部署後）於「報表」頁籤實際按下「↓ 匯出 Excel（.xlsx）」，以 Excel 或 Google 試算表開啟下載檔，確認：

1. 三個工作表（彙總、熱門服務排行、逐日明細／逐小時明細）與畫面數字一致。
2. 金額可加總（是數值，不是文字）、合計列正確。
3. 中文檔名正常。
4. 切到儀表板頁籤時沒有匯出按鈕；沒有資料／載入中／錯誤時按鈕停用。

## 後續任務

- Epic 完成後 architect＋security-reviewer 總覽審查；README「未來規劃」同步更新。
- 建議另立任務：升級 `next`（`npm audit` 既有 critical）；向 `write-excel-file` 上游回報 L-1。
