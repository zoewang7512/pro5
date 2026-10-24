# AI-Ready 任務卡

## Metadata

- 任務：稽核紀錄 設定異動（2）（`0023_audit_settings_2`：`services`、`designers`、`designer_services`、`designer_leaves`）
- 上層規格：[`feature-spec.md`](../feature-spec.md)、[`architecture-notes.md`](../architecture-notes.md)（§1、§4、§7、§8）
- 上層 Epic：稽核紀錄
- 上層 User Story：記錄影響可預約性的設定異動
- 分軌：後端
- 前置任務（dependsOn）：TASK-086
- 狀態：草稿（前置任務完成後才可就緒）
- 風險等級：高（`designer_services` 複合鍵長度、cascade 刪除路徑、fail-closed；任一失敗會讓後台開關服務或測試清理壞掉）
- Agent owner：Claude Code
- 人工核准者：使用者（2026-10-23）

## 目標

服務項目、設計師、設計師提供的服務、請假日的異動自動留下稽核列；名稱再長、鍵再長、父列已被 cascade 刪除，都不會讓原始操作失敗。

## 情境包（Context Pack）

- 相關檔案：`lib/admin/services.ts`、`lib/admin/designers.ts`（`designer_services`／`designer_leaves` 為一般 `insert` 再吞 23505，**不是** `on conflict do nothing`）、`supabase/migrations/0017_designers.sql`（`on delete cascade`）、`tests/helpers/designer-fixture.ts`（`cleanupTestDesigners` 以 service_role cascade 刪除）、`tests/services.integration.test.ts`、`tests/designers.integration.test.ts`、`tests/mfa-rls.integration.test.ts`。
- 既有模式：同 TASK-086／087；`services.name` 在資料庫**沒有長度限制**（`designers.name` 才有 30 字限制）。
- 假設：本卡**不**修改 `services` 的 constraint；稽核以截斷處理。
- 未知事項：cascade 刪除時 AFTER DELETE trigger 查不到父列名稱（為 null）的實際行為，以測試證實不 raise。
- 允許變更的檔案：
  - `supabase/migrations/0023_audit_settings_2.sql`、`0023_audit_settings_2_down.sql`（新增；**先父表後子表**加 trigger，函式在前、`create trigger` 在最後，`lock_timeout 5s`）
  - `supabase/verify/0023_audit_settings_2_verify.sql`
  - `tests/audit-log.integration.test.ts`（本卡 describe 區塊）
  - 既有套件僅限補清理掛鉤（斷言不變）
- 不得觸碰：`lib/`、`app/`、`0017` 與 `designers`／`services` 的既有 constraint。

## 需求

- 事件依架構筆記 §4：`service.created／updated／deleted`（changes：`name`、`price`、`duration_minutes`、`buffer_minutes`、`is_active`；不含 description、sort_order）、`designer.created／updated／deleted`（changes：`name`、`is_active`；不含 bio／specialties／IG／avatar／sort_order）、`designer_service.enabled／disabled`、`designer_leave.added／removed`。
- summary 一律含對象原始 id；名稱與 changes 的文字值截斷 60 字；`entity_id`：`designer_services`＝`<designer_id>:<service_id>`（73 字）、`designer_leaves`＝`<designer_id>:<date>`。
- cascade 刪除的子列：記錄事件，名稱查不到時為 null、id 保留，**不得 raise**。
- UPDATE 只比追蹤欄位；`services` 只改 description／sort_order、`designers` 只改 bio／頭像／排序皆 0 筆。

## 驗收標準

- **每個事件各有一個 happy path**，其中必含最長 `entity_id` 的 `designer_service.enabled`；店長 session 實際開關設計師服務成功。
- cascade：刪除有 `designer_services`／`designer_leaves` 列的設計師、刪除有 `designer_services` 的服務，皆成功且稽核列保有 id；`cleanupTestDesigners` 仍可執行。
- 名稱截斷：把 `__TEST__` 服務名稱改成 3000 字（`services.name` 無限制）更新成功，稽核 summary 與 changes 不超過上限；以該服務建立預約成功（不得 `INTERNAL_ERROR`）。
- 重複開啟服務（23505）與重複請假 0 筆。
- 個資／內容掃描：設計師 bio／IG／avatar、服務 description 植入針，稽核全文與鍵白名單皆不出現。
- `test:services`、`test:designers`、`test:mfa-rls`、`test:booking`、`test:admin-booking` 重跑全數通過，時間記錄在案（`designers.integration` 約百次寫入，確認遠低於逾時）；殘留為 0。
- `0023_down` 演練後 rollback。

## 實作備註

- 套用時避開任何整合測試執行；套用後人工 smoke：後台開關一項設計師服務、標一天請假再移除，各出現記錄。
- 補 `services.name` 長度 constraint 為獨立後續建議，不在本卡。

## 驗證契約

- 單元測試：`npm test`。
- 整合測試：`npm run test:audit-log`（本卡區塊）＋上列舊套件重跑。
- E2E 測試：不適用。
- 型別檢查：`npx tsc --noEmit`；Lint：`npm run lint`；Build：`npm run build`。
- 螢幕截圖：不適用。
- 安全性檢查：確認 trigger 無動態 SQL、無 `to_jsonb(row)`；鎖順序審查。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：不適用
- 已知限制：
- 後續任務：TASK-092
