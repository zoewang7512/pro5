# 驗證報告

## 摘要

- 任務：TASK-085 稽核紀錄 記錄後台操作（16 個來源函式接上 `recordAdminAction`）
- 結果：**通過**（實作 agent 驗證；關卡與人工驗收待人工核准）
- 驗證者：實作 agent（Claude Code）。product 關卡已由使用者確認簡版規格書；security-reviewer 實作後複審見下方「審查」；architecture／test／code_review 關卡待人工核准。
- 分支：`feat/audit_log`（接在 TASK-084 之後；TASK-084 當時為 Verify，尚未 Done）

## 變更

| 檔案 | 內容 |
|---|---|
| `lib/admin/audit-log.ts` | 新增 `readAuditValue`、`lookupName`（舊值／名稱讀取，永不 throw）；事件建構函式的名稱與時間改為可為 `null`（讀不到就從摘要省略） |
| `lib/admin/appointments.ts` | 完成／取消／改期：寫入前單一查詢取 `start_at`/`end_at`/`status`/服務名稱/設計師名稱（不含顧客欄位） |
| `lib/booking-policy.ts` | `updateBookingPolicy`；**用動態 import 載入 audit-log**（見「設計決定」） |
| `lib/admin/business-hours.ts` | `updateBusinessHours`：一次儲存一筆、只列有變動的星期 |
| `lib/admin/closed-dates.ts` | `addClosedDate`（已存在不記）、`removeClosedDate`（冪等的 0 列不記） |
| `lib/admin/services.ts` | `createService`／`updateService`（追蹤欄位沒變不記）／`setServiceActive`（狀態相同不記） |
| `lib/admin/designers.ts` | `createDesigner`／`updateDesignerBasicInfo`（僅名稱變動）／`setDesignerActive`／`setDesignerService`／`addDesignerLeave`／`removeDesignerLeave`（23505 不記） |
| `tests/admin/audit-log-wiring.test.ts`（新增 61 項） | 逐函式：成功留一筆、失敗不留、紀錄失敗仍 ok:true、無變動不記、讀不到舊值只記新值、不含顧客欄位 |
| `tests/admin/designers-write.test.ts` | 僅為相容新增的讀取而調整（見下） |
| `tests/audit-log.integration.test.ts`、`vitest.audit-log.config.ts` | 新增 5 個整合案例；config 補 `@` alias |

## 設計決定

1. **`lib/booking-policy.ts` 用動態 import**：顧客前台（`BookingFlow.tsx`）會 import 這個檔，檔頭明載「前台從不 import `lib/admin/*`」；靜態引入會讓前台反向依賴後台模組。只有後台儲存時才載入，且整段包 try/catch，載入失敗也不影響儲存結果。
2. **舊值讀取一律不可 throw**：第一次實作時 `getBookingPolicy`／`getAllBusinessHours`／`isDateClosed` 的讀取沒有包住，既有測試的 mock 因而暴露「讀取拋例外會連原操作一起壞」；已在原始碼修正（`.catch`），不是改測試。
3. 狀態切換（服務／設計師上下架）加讀目前狀態，相同時不記；公休日重複加入、請假日／設計師服務的 23505 都視為「沒有實際變動」。
4. 名稱讀不到：事件與對象編號仍記錄，摘要省略該欄位（不寫空字串）。

## 指令

| 指令 | 結果 | 備註 |
|---|---|---|
| `npx tsc --noEmit` | 通過 | 0 錯誤 |
| `npm run lint` | 通過 | 0 error、0 warning |
| `npm run build` | 通過 | |
| `npx vitest run tests/admin tests/booking-policy.test.ts` | 通過 | 含新增 61 項與既有測試（修 Low-1 後 `tests/admin` 502 項全過） |
| `npx vitest run --testTimeout=60000 --maxWorkers=4`（全套） | 77 檔／1331 項，1330 通過 | 唯一失敗 `designer-portfolio-tab`（資料列已刪但檔案沒刪成功）為既有的並行負載不穩定（TASK-084 報告已記載，單獨重跑 11 項全過），與本卡無關 |
| `npm run test:audit-log` | **28 項全數通過** | 原 23 項＋新增 5 個接線案例 |
| `npm run test:admin-booking` | 16 項通過 | |
| `npm run test:business-hours` | 33 項通過 | |
| `npm run test:booking-policy` | 7 項通過 | |
| `npm run test:services` | 17 項通過 | |
| `npm run test:designers` | 122 項通過 | |
| `npm run sweep:audit-test-rows` | 清掃 21 筆後 0 筆殘留 | 見「測試雜訊」 |

## 既有測試受影響與調整

動工第一步預期的風險確實出現，範圍很小：

- `tests/booking-policy.test.ts`、`tests/admin/business-hours.test.ts`：最初失敗，原因是原始碼的舊值讀取未包 try/catch（上述決定 2）；**修原始碼後不需改測試**。
- `tests/admin/designers-write.test.ts`（8 項）：該檔的 fake 依表名「依序消耗計畫步驟」並斷言精確呼叫序列，新增的讀取會吃掉步驟。調整方式：`designers` 表的計畫補上第一步「舊值讀取」；`designer_services`／`designer_leaves` 的序列斷言限定在該表（`forTable`）。**沒有放寬任何既有斷言的內容**。

## 突變測試（驗證測試不是空轉）

暫時植入錯誤、確認測試會失敗，每次跑完還原並以 `cmp` 驗證檔案與備份一致：

| 突變 | 結果 |
|---|---|
| 改期到原時段也記錄（拿掉 `unchanged` 判斷） | 1 項失敗 ✅ |
| 完成／取消預約不呼叫 `recordAdminAction` | 6 項失敗 ✅ |
| 改期不呼叫 `recordAdminAction` | 2 項失敗 ✅ |
| `addClosedDate` 已存在也記錄 | 1 項失敗 ✅ |
| `setDesignerService` 開啟遇 23505 也記錄 | 1 項失敗 ✅ |
| `setServiceActive` 狀態相同也記錄 | 1 項失敗 ✅ |
| `recordAdminAction` 不過濾 summary 白名單 | `audit-log.test.ts` 1 項失敗 ✅（接線測試抓不到是合理的：建構函式本來就只產出白名單欄位，這一層由 `audit-log.test.ts` 負責） |

## 安全性檢查

- 新增的行中無 `select("*")`；預約寫入前的讀取固定為 `id, start_at, end_at, status, designers(name), services(name)`（單元測試斷言字串）。
- 預約事件摘要／差異鍵集合以白名單函式斷言；刻意把 `customer_name`／`customer_phone`／`customer_email`／`access_token` 混進讀取結果與輸入，輸出與實際送出的 insert 皆不含。
- 整合案例斷言預約事件 JSON 不含 `customer`／`access_token`／`fixture`（測試顧客名稱）。

## 審查

security-reviewer 實作後複審（只讀）：**沒有 Critical／High／Medium**；個資、記錄失敗不影響原操作、操作失敗不留紀錄、前台 bundle、樂觀鎖與狀態機語意五項核心檢查都成立。審查意見不等於核准。

| 發現 | 處理 |
|---|---|
| Low-1 改期選到「原時段」仍留一筆 from＝to 的紀錄（違反「無實際變動不記」；Z 與 +00:00 字串也比不出相同） | **已修**：以 `Date.parse` 比較時間戳，相同就不記；新增 2 項測試＋突變驗證（1 項會失敗） |
| Low-2 事件建構函式當參數先算，在 `recordAdminAction` 的 try 之外；目前建構函式是純函式、追不到可觸發的路徑 | **未改**：記為已知限制；若日後建構函式變複雜，應改成傳入 thunk 在 try 內呼叫（會動到全部呼叫點） |
| Low-3 先讀後寫的競態（兩分頁同時操作可能重複記或 from 過時） | 記為已知限制（單一店長、日誌性質；不影響樂觀鎖與狀態機） |
| Low-4 讀舊值失敗時「無變動不記」退化成「照記」 | 與規格「讀不到就只記新值」一致，接受；請人工確認 |
| Low-5 每次多 1～3 次往返、無逾時；audit_log 插入卡住時畫面會久轉，重按取消會顯示失敗（第一次其實已成功） | 記為已知限制；日後可對記錄加逾時（AbortSignal） |
| Info-6 價格 numeric(10,2) 但驗證允許任意小數，100.005 存成 100.01 後同值再存會被當成有變動 | 未改（影響極小，屬服務驗證範疇，不在本卡）；可另開 follow-up |

另有一項補充：`lib/booking-policy.ts` 對 `lib/admin` 概念上仍有一條（動態）依賴邊，打包時可能產出獨立 chunk（公開可下載，但內容只有 audit-log／format／week-range，不含密鑰）；要完全切斷需改函式簽名，任務卡禁止。

## 測試雜訊

既有 5 套整合測試以店長帳號呼叫這些函式，共留下 37 筆紀錄：21 筆帶 `__TEST__` 名稱，已用清掃腳本清除；**16 筆不帶名稱**（`closed_date.added/removed` 10 筆、`business_hours.updated` 6 筆，id 65～80）依設計屬已接受雜訊，已於使用者指示（2026-10-24）刪除（先確認 id 65～80 恰為這 16 筆且無其他紀錄），`audit_log` 目前為空表。

## 已知限制

- 預約規則與營業時間的接線僅由單元測試驗證（整合案例不呼叫它們，以免改動正式環境設定）；`test:business-hours` 重跑通過，且確實呼叫過 `updateBusinessHours`（留下 6 筆紀錄可佐證）；`test:booking-policy` 重跑通過，但該套件是直接對 `booking_policy` 資料表讀寫、不呼叫 `updateBookingPolicy`（已查證），所以 `updateBookingPolicy` 的接線**只有單元測試**驗證，沒有真實資料庫的整合驗證。
- 寫入前才讀舊值，兩個分頁近乎同時操作時前後值可能略有誤差或重複記錄（日誌性質，已接受；複審 Low-3）。
- 事件建構函式在 `recordAdminAction` 的 try 之外執行，「永不影響原操作」目前靠建構函式是純函式維持（複審 Low-2）。
- 記錄寫入沒有逾時（複審 Low-5）。
- 每次操作多 1～3 個查詢（舊值／名稱讀取＋寫入）。
- 沒有顯示層：列表畫面屬 TASK-086。

## 後續任務

TASK-086（稽核紀錄列表畫面與驗收）。
