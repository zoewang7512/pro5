# AI-Ready 任務卡

## Metadata

- 任務：預約價格快照（`0020_appointment_price_snapshot`：欄位、BEFORE INSERT trigger、回補、欄位層級授權；整合測試；`decisions.md`）
- 上層規格：[`feature-spec.md`](../feature-spec.md)（需求 §1）、[`architecture-notes.md`](../architecture-notes.md)（§1、§7、§8、§9）
- 上層 Epic：儀表板與報表
- 上層 User Story：預約價格快照
- 分軌：後端
- 前置任務（dependsOn）：「專案設置」Epic 全部卡片（TASK-001～009、063～066、081～083）
- 狀態：草稿（待使用者核准計畫後轉就緒）
- 風險等級：中高（資料庫遷移＋對 `appointments`（顧客預約核心表）新增 trigger 並回補既有資料；`create_appointment` 本身不改）
- Agent owner：Claude Code
- 人工核准者：待使用者核准（本計畫與 0020 套用皆需人工）

## 目標

讓每筆預約都記住「下單當下的服務價格」，並讓店長登入的後台能讀到它，但任何人都改不了，使日後改價不影響過去營收。

## 情境包（Context Pack）

- 相關檔案：`supabase/migrations/0001_core_schema.sql`（`appointments` 結構與 `set_updated_at` trigger）、`0011_appointments_insert_webhook.sql`（AFTER INSERT，WHEN `customer_email is not null`）、`0012_appointments_update_webhook.sql`（AFTER UPDATE，WHEN 狀態轉取消／起訖時間變動且有 email）、`0015_explicit_table_grants.sql`（`appointments` 欄位層級授權，新欄位需補授權）、`0017_designers.sql`（`grant select (designer_id)` 的寫法、`drop constraint if exists` 再 `add`）、`0018_designer_aware_booking.sql`（`create_appointment` 的 insert 欄位清單）、`0019_audit_log.sql`（檔頭註解與依賴檢查範本）、`tests/helpers/designer-fixture.ts`、`vitest.audit-log.config.ts`、`tests/audit-log.integration.test.ts`（整合測試與拋棄式使用者做法）。
- 既有模式：migration 單一交易、可重複執行、開頭依賴檢查、結尾 `notify pgrst, 'reload schema'`；up／down 成對；建表／欄位同檔寫最小權限 GRANT（`decisions.md` TASK-065）；整合測試對真實 Supabase、`__TEST__` 資料。
- 假設：`0001`～`0019` 已套用；Supabase `postgres` 可對 `appointments` 執行 `alter table ... disable/enable trigger`（若不行，退而接受 `updated_at` 被回補更新並在決策記錄說明——**先在套用前確認**）。
- 未知事項：正式環境既有預約筆數（回補耗時與鎖）；套用前以 `select count(*)` 確認（預估數百筆，毫秒級）。
- 允許變更的檔案：
  - `supabase/migrations/0020_appointment_price_snapshot.sql`、`0020_appointment_price_snapshot_down.sql`（新增）
  - `tests/reports.integration.test.ts`、`vitest.reports.config.ts`、`package.json`（`test:reports`）（新增／小改）
  - `ai/context/decisions.md`（新增決策條目）
- 不得觸碰：`create_appointment`／`get_available_slots` 與其他 RPC、既有 migration、`app/`、`lib/`、既有測試。

## 需求

- 依架構筆記 §1：新增 `price_at_booking numeric(10,2)`；BEFORE INSERT trigger（`security definer`、`set search_path = ''`、`revoke execute ... from public`）**無條件**以 `services.price` 覆寫；回補既有資料（回補前後停用／啟用 `appointments_set_updated_at`，同一交易）；`not null` 與 `check (price_at_booking >= 0)`；`grant select (price_at_booking) on public.appointments to authenticated`，**不給 update**。
- 套用前以 `pg_get_triggerdef` 確認 `appointments_notify_update` 的 WHEN 不含 `price_at_booking`、不會因回補觸發寄信，並把結果記在完成證據。
- `0020_down.sql`：丟 trigger、function、欄位；檔頭註明會刪除全部快照資料。
- 整合測試 `npm run test:reports`（新）——**測試預約一律 `customer_email = null`（避免觸發真實資料庫的 webhook）、姓名／服務／設計師皆 `__TEST__`、不對店長帳號做全域 `signOut()`**（用 `scope: "local"` 或不登出）：
  1. 新增預約（service_role）→ `price_at_booking` 等於當下服務價格。
  2. 之後把服務改價 → 既有預約快照不變；再新增一筆 → 新價格。
  3. 新增預約時帶入不同的 `price_at_booking` → 被覆寫為服務價格。
  4. service_role 可 update `price_at_booking`（供後續彙總測試造資料）。
  5. 店長（authenticated）可 select 該欄；update 該欄被拒（欄位層級）；anon select／insert 被拒；非店長登入者 select 得到空結果。
  6. 顧客端 RPC（`get_available_slots`、`create_appointment`）回傳內容不含 `price_at_booking`；`create_appointment` 建立的預約快照正確（需有未來可預約時段的 `__TEST__` 服務與設計師，沿用 `designer-fixture`）。
- `decisions.md`：記錄快照決策（trigger vs RPC、無條件覆寫、回補為近似值、不給 update、套用順序與回滾）。

## 驗收標準

- `0020` 可重複執行；套用後既有預約流程（顧客預約、後台標記完成／取消／改期）不受影響；既有預約的 `updated_at` 未被回補改動（抽樣比對套用前後）；套用過程沒有寄出任何通知信。
- 整合測試全數通過（含上列六項）；`test:booking`、`test:admin-booking`、`test:rls`、`test:designers` 回歸通過。
- 正式環境套用後：`select count(*) from appointments where price_at_booking is null` 為 0；任一筆既有預約的快照等於其服務目前價格。

## 實作備註

- migration 需**人工**貼到 Supabase SQL Editor 整份執行；套用前先給人工審閱（security-reviewer 快速複審 `0020`：trigger／grant／回補／webhook 副作用，範圍只有這一個檔案）。
- 只有 `INSERT` 會寫快照；`UPDATE` 不重算（改期、改狀態不改價）。
- 套用前可先套用、再做後續卡片（前端尚未讀此欄，不影響任何畫面）。

## 驗證契約

- 單元測試：不適用（純資料庫變更）；`npm test` 回歸確認未受影響。
- 整合測試：`npm run test:reports`（新）；回歸 `test:booking`、`test:admin-booking`、`test:rls`、`test:designers`、`test:notifications`（不得寄出信件）。
- E2E 測試：不適用。
- 型別檢查：`npx tsc --noEmit`；Lint：`npm run lint`；Build：`npm run build`。
- 螢幕截圖：不適用。
- 安全性檢查：security-reviewer 複審 `0020`；人工確認 trigger 定義與授權查詢結果（`information_schema.column_privileges`）。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：不適用
- 已知限制：歷史預約的快照是回補當下的服務價格（近似值）；`UPDATE` 不重算快照。
- 後續任務：TASK-088
