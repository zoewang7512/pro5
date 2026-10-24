# AI-Ready 任務卡

## Metadata

- 任務：稽核紀錄 `closed_dates` 試點（`0020`）與端到端驗證（header 實測、REST 權限矩陣、操作者來源、清理殘留為 0）
- 上層規格：[`feature-spec.md`](../feature-spec.md)、[`architecture-notes.md`](../architecture-notes.md)（§2、§3、§4、§6、§7、§8）
- 上層 Epic：稽核紀錄
- 上層 User Story：記錄影響可預約性的設定異動
- 分軌：後端
- 前置任務（dependsOn）：TASK-084、TASK-085
- 狀態：草稿（前置任務完成後才可就緒）
- 風險等級：高（第一次在正式資料庫掛稽核 trigger；整條方案的關鍵決策點）
- Agent owner：Claude Code
- 人工核准者：使用者（2026-10-23）

## 目標

用風險最低的表（`closed_dates`：單欄位、無個資、與預約無關）掛上第一個稽核 trigger，**端到端驗證整套機制**：測試標記 header 真的能傳進資料庫、操作者判定正確、權限矩陣與預期一致、清理後殘留為 0。

## **決策關卡**

第一步先驗證自訂 header 是否出現在資料庫的 `request.headers`，且測試標記能寫入 `test_run_id`。**若失敗，立即停止本卡及後續所有卡片，回報使用者**，退回「實體 ID 清理＋拋棄式管理員」方案重新規劃（TASK-085 的工廠與清理需改寫）。不得自行改走其他方案。

## 情境包（Context Pack）

- 相關檔案：`lib/admin/closed-dates.ts`（`upsert ignoreDuplicates:false`＝重複加入走 DO UPDATE）、`tests/business-hours.integration.test.ts`、`tests/designers.integration.test.ts`（寫 `closed_dates`）、`tests/mfa-rls.integration.test.ts`（拋棄式管理員做法）、`tests/helpers/audit-test-run.ts`（TASK-085）。
- 既有模式：同 TASK-084；整合測試獨立 `vitest.*.config.ts`＋`package.json` script。
- 假設：TASK-084 的 `0019` 已套用；使用者已建立 Vault 密鑰 `audit_test_secret` 並設定本機 `AUDIT_TEST_SECRET`。
- 未知事項：header 是否被 Supabase 閘道保留（決策關卡）。
- 允許變更的檔案：
  - `supabase/migrations/0020_audit_closed_dates.sql`、`0020_audit_closed_dates_down.sql`（新增；`audit_private` 的 `closed_dates` trigger 函式＋`AFTER INSERT`／`AFTER DELETE` 兩個 trigger，**不掛 UPDATE**；函式先建、`create trigger` 放最後）
  - `supabase/verify/0020_audit_closed_dates_verify.sql`
  - `tests/audit-log.integration.test.ts`（新增，建立骨架與共用 fixture）、`vitest.audit-log.config.ts`、`package.json`（`test:audit-log`）
  - `tests/helpers/throwaway-admin.ts`（新增，自 `mfa-rls` 抽出：`createUser`、`addToAdmins`、`enrollAndVerify`、`verifyTotp`、`sweepLeftovers`；前綴 `__TEST__audit-log-`）
  - `tests/mfa-rls.integration.test.ts`（僅改為使用抽出的 helper；抽出後必須重跑 `test:mfa-rls`）
- 不得觸碰：其他業務表、`lib/`、`app/`。

## 需求

- `closed_date.added`／`closed_date.removed`：summary 含 `date`；重複加入同一天（DO UPDATE）不產生列。
- REST 權限矩陣逐格（先用 service_role 確認底下確實有列，避免恆真）：anon select／insert／update／delete → 42501；非管理員 authenticated select → 空陣列、寫入 42501；MFA 管理員 aal1 select → 空陣列；管理員 aal2 或未啟用 MFA select → 有列、寫入 42501；service_role select 有列、insert／update 42501、delete 僅標記列。
- 操作者四種來源：店長 session → `admin`＋`actor_user_id`；anon／無法歸類 → 依架構筆記 §2；service_role → `system`；直連（無 claims）改以 SQL 驗證腳本確認，輸出存檔。
- 清理：本套件與 `test:business-hours`、`test:designers` 對 `closed_dates` 的寫入產生的稽核列，結束後以 run id 清理，同標記查詢為 0，且 `audit_purge_log` 有對應清除紀錄。
- PostgREST 在 `0020` 套用後需 `notify pgrst, 'reload schema'` 並確認，不得靠等待。
- `0020_down` 在交易內演練後 rollback。

## 驗收標準

- 決策關卡通過（header 傳入、`test_run_id` 寫入、錯誤密鑰／缺密鑰時不寫入）。
- 權限矩陣與操作者來源全部符合；`test:audit-log`、`test:mfa-rls`、`test:business-hours`、`test:designers` 全數通過。
- 套用 `0020` 並跑完上述套件後，稽核表殘留（無標記或標記未清）為 0，除手動 smoke 產生的真實紀錄外沒有多餘列。
- 人工 smoke：店長在後台新增再移除一個公休日，各出現一筆（人工驗收）。

## 實作備註

- 本卡之後，凡寫入 `closed_dates` 的既有套件都會產生稽核列；TASK-085 的清理掛鉤必須已就緒才能套用 `0020`。
- 不得新增任何「跳過稽核」的旁路。

## 驗證契約

- 單元測試：`npm test`（含 TASK-085 護欄）。
- 整合測試：`npm run test:audit-log`（新）、`test:mfa-rls`、`test:business-hours`、`test:designers` 重跑。
- E2E 測試：不適用。
- 型別檢查：`npx tsc --noEmit`；Lint：`npm run lint`；Build：`npm run build`。
- 螢幕截圖：不適用。
- 安全性檢查：security-reviewer 複審權限矩陣與標記邏輯；SQL 驗證腳本輸出為證據。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：不適用
- 已知限制：
- 後續任務：TASK-087、TASK-088、TASK-089
