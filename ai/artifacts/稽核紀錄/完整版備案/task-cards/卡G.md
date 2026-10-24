# AI-Ready 任務卡

## Metadata

- 任務：稽核紀錄 列表資料層與純函式（`lib/audit-log/*`：事件目錄、白話描述、`listAuditLog`、漂移護欄）
- 上層規格：[`feature-spec.md`](../feature-spec.md)、[`architecture-notes.md`](../architecture-notes.md)（§4、§9）
- 上層 Epic：稽核紀錄
- 上層 User Story：查看稽核紀錄列表
- 分軌：後端
- 前置任務（dependsOn）：TASK-084
- 狀態：草稿（前置任務完成後才可就緒）
- 風險等級：低（純函式與薄封裝，無畫面）
- Agent owner：Claude Code
- 人工核准者：使用者（2026-10-23）

## 目標

提供列表畫面所需的全部資料邏輯：事件代碼→中文、差異→白話、查詢條件→PostgREST 查詢、分頁游標；畫面完全不碰這些細節。

## 情境包（Context Pack）

- 相關檔案：`lib/admin/appointments.ts`（`Result<T>` 與泛用錯誤模式）、`lib/admin/week-range.ts`（`+08:00` 日界）、`lib/admin/format.ts`、`tests/admin/*.test.ts`（mock supabase query builder 的寫法）。
- 既有模式：薄封裝＋統一泛用錯誤（不洩漏 Postgres 訊息）；純函式拆檔方便單元測試；放在 `lib/audit-log/`（後台專用，不被顧客前台 import）。
- 假設：事件目錄與欄位標籤以架構筆記 §4 為準；`audit_log` 的實際資料要到 TASK-086 之後才有，本卡以 mock 驗證。
- 未知事項：無。
- 允許變更的檔案：
  - `lib/audit-log/events.ts`、`lib/audit-log/describe.ts`、`lib/audit-log/api.ts`、`lib/audit-log/types.ts`（新增）
  - `tests/audit-log/events.test.ts`、`describe.test.ts`、`api.test.ts`、`migration-drift.test.ts`（新增）
- 不得觸碰：`app/`、migration、既有 `lib/`。

## 需求

- `events.ts`：每個事件代碼的中文名稱與類別（`appointment`／`settings`）；欄位→中文標籤；不認識的事件代碼回傳原始代碼，不 throw。
- `describe.ts`：布林「是／否」、`null`「未設定」、時間轉 Asia/Taipei（不依賴執行環境時區）、價格、分鐘；`changes` 缺 `from`／`to` 或含白名單外的 key 時忽略，不顯示原值。
- `api.ts` 的 `listAuditLog(supabase, { category, from, to, appointmentId, cursor, limit })`：只用 query builder（`.eq`／`.lt`／`.gte`／`.lte`／`.like`），**禁止** `.or()` 字串拼接；`select` 明列欄位；`category`：`all` 不加條件、`appointment`＝`like 'appointment.%'`、`settings`＝其餘；日期區間以 `+08:00` 日界，非法日期（如 2026-02-30）與 `from > to` 回傳驗證錯誤；`appointmentId` trim、不分大小寫、uuid 格式驗證，非 uuid 不送查詢，查詢用 `eq('entity_type','appointment').eq('entity_id', id)`；`cursor` 僅接受 `^\d+$`，用 `lt('id', cursor)`；`limit` 預設 50、夾在 1～100（0／負數／NaN 回預設）；多取一筆判斷下一頁，剛好等於 `limit` 筆時 `nextCursor` 為 null。
- 漂移護欄（單向）：讀 `supabase/migrations/002*.sql` 中的 `event_type` 字面值，每個都必須在事件目錄內；反向（目錄中每個代碼都有 trigger）在 TASK-092 啟用。

## 驗收標準

- 上述每條需求都有單元測試；時區測試在非 Taipei 時區環境下也通過。
- 錯誤一律泛用訊息，不含 Postgres 訊息、欄位名或 constraint 名稱。
- 型別、lint、build 通過。

## 實作備註

- 事件目錄是 SQL 與 TypeScript 之間唯一的契約，修改任一邊都要同步另一邊。

## 驗證契約

- 單元測試：`npm test`（新增 4 個測試檔）。
- 整合測試：不適用（資料層在 TASK-092 串接後才連真實資料）。
- E2E 測試：不適用。
- 型別檢查：`npx tsc --noEmit`；Lint：`npm run lint`；Build：`npm run build`。
- 螢幕截圖：不適用。
- 安全性檢查：確認無字串拼接 filter、無動態欄位。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：不適用
- 已知限制：
- 後續任務：TASK-091
