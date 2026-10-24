# AI-Ready 任務卡

## Metadata

- 任務：稽核紀錄 記錄後台操作（16 個來源函式接上 `recordAdminAction`）
- 上層規格：[`feature-spec.md`](../feature-spec.md)（「事件」表）、[`architecture-notes.md`](../architecture-notes.md)（§3）
- 上層 Epic：稽核紀錄
- 上層 User Story：記錄後台操作
- 分軌：後端
- 前置任務（dependsOn）：TASK-084
- 狀態：草稿（前置任務完成後才可就緒）
- 風險等級：中（觸碰 7 個既有後台資料模組，且是店長日常操作路徑；但記錄永不影響原結果）
- Agent owner：Claude Code
- 人工核准者：使用者（2026-10-24 確認簡版規格書）

## 目標

後台完成取消、改期、改設定等操作後自動留下紀錄；操作失敗時不留、紀錄失敗時操作照常成功。

## 情境包（Context Pack）

- 相關檔案：`lib/admin/appointments.ts`（`markAppointmentCompleted`／`cancelAppointment`／`rescheduleAppointment`）、`lib/booking-policy.ts`（`updateBookingPolicy`）、`lib/admin/business-hours.ts`（`updateBusinessHours`、`hasBusinessHoursChanges`）、`lib/admin/closed-dates.ts`（`addClosedDate`／`removeClosedDate`）、`lib/admin/services.ts`（`createService`／`updateService`／`setServiceActive`）、`lib/admin/designers.ts`（`createDesigner`／`updateDesignerBasicInfo`／`setDesignerActive`／`setDesignerService`／`addDesignerLeave`／`removeDesignerLeave`）；對應既有測試 `tests/admin/*.test.ts`、`tests/booking-policy.test.ts`；`lib/admin/audit-log.ts`（TASK-084）。
- 既有模式：`Result<T>` 泛用錯誤；`.select("id")` 檢查實際受影響列數；`23505` 重複視為成功（`addDesignerLeave`／`setDesignerService`）。
- 假設：`recordAdminAction` 永不 throw（TASK-084）；舊值讀取失敗就只記新值。
- 未知事項：既有單元測試中依賴 `from` 呼叫次數或逐次回傳的 mock 有哪些（動工第一步先跑一次基準，列出受影響檔案）。
- 允許變更的檔案：上列 7 個資料模組及其既有測試（只為相容新增的 `audit_log` 呼叫與舊值讀取而調整）、`tests/admin/audit-log-wiring.test.ts`（新增逐函式測試）、`tests/audit-log.integration.test.ts`（新增整合案例）。
- 不得觸碰：函式簽名與回傳型別、`app/` 元件、migration、顧客端 `lib/booking/*`。

## 需求

- 事件、摘要與差異依規格書「事件」表；只在原操作成功且有實際變動時記錄：
  - 預約：寫入前以單一查詢取得 `start_at`／`end_at`／`status`／服務名稱／設計師名稱（不含顧客欄位）；`rescheduleAppointment` 的舊時段取自 `currentStartAt` 與舊值讀取。
  - 設定：寫入前先讀舊值；`updateBusinessHours` 一次儲存只記一筆、只列有變動的星期；`updateDesignerBasicInfo` 僅名稱有變動時記錄；`addClosedDate` 重複加入同一天（upsert）不記錄；`setDesignerService`／`addDesignerLeave` 遇 `23505` 視為成功但不記錄。
- 記錄一律在確認成功之後 `await recordAdminAction(...)`；原函式的回傳值不因記錄而改變。
- 不記錄：商店基本資料、設計師頭像／作品集／排序、帳號設定。

## 驗收標準

- 16 個函式各有測試：成功→呼叫一次 `audit_log` insert 且事件與摘要／差異正確；失敗（error、0 列、狀態不符）→不呼叫；`recordAdminAction` 失敗→函式仍回 `ok: true`；無實際變動→不記錄。
- 所有預約事件的摘要與差異鍵集合不含 `customer_*`、`access_token`（以斷言鍵白名單驗證）。
- 既有後台相關單元測試全數通過（含為相容而做的調整），`npm test` 全綠。
- 整合案例（`test:audit-log`）：店長以測試資料實際呼叫取消、改期、設定類函式後，能在 `audit_log` 讀到對應事件；測試後以清掃腳本清除，殘留（帶 `__TEST__` 者）為 0。
- `test:admin-booking`、`test:business-hours`、`test:booking-policy`、`test:services`、`test:designers` 重跑通過。

## 實作備註

- 一次接一類並跑對應測試：先預約，再預約規則／營業時間／公休日，再服務，最後設計師。
- 整合測試會因呼叫這些函式而留下不帶名稱的紀錄（預約規則、營業時間還原），屬已接受雜訊，不為此改既有套件。

## 驗證契約

- 單元測試：`npm test`。
- 整合測試：`npm run test:audit-log` ＋上列既有套件重跑。
- E2E 測試：不適用。
- 型別檢查：`npx tsc --noEmit`；Lint：`npm run lint`；Build：`npm run build`。
- 螢幕截圖：不適用。
- 安全性檢查：確認事件建構函式只取白名單欄位，無 `select("*")`、無顧客欄位進入摘要。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：不適用
- 已知限制：
- 後續任務：TASK-086
