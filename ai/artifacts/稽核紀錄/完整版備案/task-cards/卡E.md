# AI-Ready 任務卡

## Metadata

- 任務：稽核紀錄 設定異動（1）（`0022_audit_settings_1`：`booking_policy`、`business_hours`）
- 上層規格：[`feature-spec.md`](../feature-spec.md)、[`architecture-notes.md`](../architecture-notes.md)（§4、§7、§8）
- 上層 Epic：稽核紀錄
- 上層 User Story：記錄影響可預約性的設定異動
- 分軌：後端
- 前置任務（dependsOn）：TASK-086
- 狀態：草稿（前置任務完成後才可就緒）
- 風險等級：中（兩張都是單例或固定 7 列的設定表，寫入頻率低，但測試會暫時改動正式設定）
- Agent owner：Claude Code
- 人工核准者：使用者（2026-10-23）

## 目標

預約規則與營業時間的新增、修改、刪除自動留下稽核列；未實際改動的儲存不產生記錄；七天營業時間一次儲存只記有變動的那幾天。

## 情境包（Context Pack）

- 相關檔案：`lib/booking-policy.ts`（`.update` 單列）、`lib/admin/business-hours.ts`（`.upsert(payload, { onConflict: "weekday" })` 七列）、`supabase/migrations/0002`／`0008`／`0009`、`tests/booking-policy.integration.test.ts`、`tests/business-hours.integration.test.ts`、`tests/booking.integration.test.ts`、`tests/designers.integration.test.ts`（皆以 service_role 還原快照）。
- 既有模式：同 TASK-086；快照＋`finally` 還原；單例表不得啟用 `force row level security`。
- 假設：`authenticated` 對這兩張表**沒有 delete 權限**（0015），所以 `.deleted` 事件只能由 service_role／SQL 產生。
- 未知事項：`open_time`／`close_time` 為 `time` 型別，比對不應因 `09:00` 與 `09:00:00` 的字串格式誤判。
- 允許變更的檔案：
  - `supabase/migrations/0022_audit_settings_1.sql`、`0022_audit_settings_1_down.sql`（新增）
  - `supabase/verify/0022_audit_settings_1_verify.sql`（`.deleted` 事件、`down` 演練；**刪除類事件只在這支可回滾腳本驗證，不得對正式庫真的刪列**）
  - `tests/audit-log.integration.test.ts`（本卡 describe 區塊）
  - 既有套件僅限補清理掛鉤（斷言不變）
- 不得觸碰：`lib/`、`app/`、`0002`／`0008`／`0009`。

## 需求

- 事件：`booking_policy.created／updated／deleted`（changes：`min_lead_time_hours`、`cancel_window_hours`）；`business_hours.created／updated／deleted`（`entity_id`＝weekday，changes：`open_time`、`close_time`、`is_closed`）。
- 只比追蹤欄位；`booking_policy.updated_at` 的變動不算差異。
- `business_hours` 七列 upsert：只有真正更新的列各記一筆；七列完全沒變 0 筆；INSERT 路徑（缺 weekday 後第一次寫入）記 `created`。

## 驗收標準

- 邊界案例全部通過：七列只改 1 天→1 筆；全沒變→0 筆；只改 `is_closed`→1 筆；`09:00` 與 `09:00:00` 不誤判；`booking_policy` 兩欄各改與同時改；`cancel_window_hours` 設為 null。
- 以拋棄式管理員或店長 session 實際儲存的操作者為 `admin`；service_role 還原快照為 `system`；全部以 run id 清理，殘留為 0，設定值還原為原值（`finally`）。
- `.deleted` 事件於可回滾腳本驗證；`authenticated` delete 這兩張表得到 42501（REST 驗證）。
- `test:booking-policy`、`test:business-hours`、`test:booking`、`test:designers` 重跑全數通過，時間記錄在案。
- `0022_down` 演練後 rollback。

## 實作備註

- 測試期間會短暫改動正式的營業時間與預約規則（既有套件已是快照還原模式）；不要高頻率重複執行。
- 套用 migration 期間不跑整合測試；套用後人工 smoke：後台儲存一次預約規則（改一個值再改回），出現兩筆記錄。

## 驗證契約

- 單元測試：`npm test`。
- 整合測試：`npm run test:audit-log`（本卡區塊）＋上列舊套件重跑。
- E2E 測試：不適用。
- 型別檢查：`npx tsc --noEmit`；Lint：`npm run lint`；Build：`npm run build`。
- 螢幕截圖：不適用。
- 安全性檢查：確認 summary／changes 只含白名單欄位。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：不適用
- 已知限制：
- 後續任務：TASK-092
