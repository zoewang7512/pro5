# AI-Ready 任務卡

## Metadata

- 任務：稽核紀錄 資料表與寫入機制（`0019_audit_log`、`lib/admin/audit-log.ts`、單元與整合測試、清掃腳本）
- 上層規格：[`feature-spec.md`](../feature-spec.md)、[`architecture-notes.md`](../architecture-notes.md)（§1～§6）
- 上層 Epic：稽核紀錄
- 上層 User Story：稽核紀錄資料表與寫入機制
- 分軌：後端
- 前置任務（dependsOn）：「專案設置」Epic 全部卡片（TASK-001～009、063～066、081～083）、TASK-079
- 狀態：就緒
- 風險等級：中（新增權限敏感的資料表與資料庫遷移；但不碰預約寫入路徑、沒有 trigger）
- Agent owner：Claude Code
- 人工核准者：使用者（2026-10-24 確認簡版規格書）

## 目標

建立一張只增不減的 `audit_log` 資料表，以及一支永不失敗地寫入、並能讀取與描述紀錄的程式模組，讓後續卡片只要呼叫 `recordAdminAction` 就能留紀錄。

## 情境包（Context Pack）

- 相關檔案：`supabase/migrations/0001_core_schema.sql`（欄位層級 `insert (...)` 寫法）、`0016_is_admin_require_aal2.sql`（`is_admin()`）、`0017_designers.sql`（GRANT／policy／constraint 慣例）、`lib/admin/appointments.ts`（`Result<T>`、泛用錯誤、`APPOINTMENT_EMBEDS`）、`lib/admin/week-range.ts`（`+08:00`）、`tests/rls.integration.test.ts`（拋棄式非店長使用者做法）、`vitest.services.config.ts`（整合測試 config 範本）。
- 既有模式：migration 開頭做依賴檢查；建表同檔寫最小權限 GRANT（先 `revoke all` 再逐一 grant，含 service_role）；up／down 成對、可重複執行；整合測試對真實 Supabase、測試資料 `__TEST__`。
- 假設：`0001`～`0018` 已套用；identity 欄位的 insert 不需對序列另外授權（若實測需要，在本卡補上並記錄）。
- 未知事項：無。
- 允許變更的檔案：
  - `supabase/migrations/0019_audit_log.sql`、`0019_audit_log_down.sql`（新增）
  - `lib/admin/audit-log.ts`（新增：`AuditEventType` 聯集型別、各事件的摘要／差異建構函式、`recordAdminAction`、`describeAuditEntry`、`listAuditLog`、型別）
  - `tests/admin/audit-log.test.ts`（新增）
  - `tests/audit-log.integration.test.ts`、`vitest.audit-log.config.ts`、`package.json`（`test:audit-log`）（新增／小改）
  - `scripts/sweep-audit-test-rows.mjs`（新增）
  - `ai/context/decisions.md`（新增決策：簡版 A 的取捨與保證邊界、擱置完整版的理由與升級路徑、`audit_log` 欄位層級 insert）
- 不得觸碰：既有後台寫入函式（TASK-085）、`app/`、既有 migration、既有測試。

## 需求

- 依架構筆記 §1、§2 建表、constraint、索引、GRANT、RLS。
- `recordAdminAction`：永不 throw；失敗只 `console.warn`（只印 error code）；文字值截斷 60 字；大小超限依序丟棄 `changes`、`summary`，仍保留事件與對象。
- 事件目錄涵蓋規格書「事件」表全部代碼；`describeAuditEntry` 產生中文事件名稱與前後差異白話（布林「是／否」、`null`「未設定」、時間轉 Asia/Taipei）；差異含白名單外的 key 時忽略。
- 各事件建構函式只接受規格白名單欄位；預約事件的輸入型別不含 `customer_*`。
- `listAuditLog`：依架構筆記 §4（類別、游標 `^\d+$`、`limit` 預設 50 且夾在 1～100、多取一筆判斷下一頁、泛用錯誤）。
- 清掃腳本：預設 dry-run，`--apply` 才刪，預設條件 `summary::text` 含 `__TEST__`，可 `--since`。
- `0019_down.sql` 檔頭註明會刪除全部紀錄。

## 驗收標準

- `0019` 可重複執行；套用後既有流程不受影響。
- 整合測試權限矩陣：anon 的 select／insert／update／delete 皆被拒（42501）；非店長登入者 select 回空陣列（先以 service_role 確認底下確有列）、insert 被拒；店長 insert 成功、select 讀得到、update／delete 被拒；店長 insert 時帶 `actor_id` 或 `created_at` 被欄位層級拒絕；店長 insert 後 `actor_id` 等於其使用者 id；service_role 可 select／delete、不能 insert／update。
- 單元測試：`recordAdminAction` 在 `insert` 回傳 error、reject、整個 `from` 拋例外三種情況下都不 throw；截斷與大小上限；事件建構函式鍵集合嚴格屬於白名單且不含顧客欄位；`describeAuditEntry` 時區測試在非 Taipei 時區環境也通過；`listAuditLog` 查詢組成。
- `decisions.md` 已記錄決策與保證邊界。

## 實作備註

- migration 需人工貼到 Supabase SQL Editor 執行；套用後 `notify pgrst, 'reload schema'` 並確認，不靠等待。
- 套用前不影響任何既有功能，可先套用再接線。

## 驗證契約

- 單元測試：`npm test`。
- 整合測試：`npm run test:audit-log`（新）；`npm run test:rls` 回歸（確認未影響既有權限）。
- E2E 測試：不適用。
- 型別檢查：`npx tsc --noEmit`；Lint：`npm run lint`；Build：`npm run build`。
- 螢幕截圖：不適用。
- 安全性檢查：套用前由 security-reviewer 快速複審 `0019` 的 GRANT／RLS／欄位層級 insert（範圍小，只審這一個檔案）。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：不適用
- 已知限制：
- 後續任務：TASK-085
