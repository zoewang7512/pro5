# AI-Ready 任務卡

## Metadata

- 任務：稽核紀錄 測試基礎建設（標記 client 工廠、清理 helper、9 個整合套件改用工廠、靜態護欄、殘留掃除腳本）
- 上層規格：[`feature-spec.md`](../feature-spec.md)、[`architecture-notes.md`](../architecture-notes.md)（§6、§7）
- 上層 Epic：稽核紀錄
- 上層 User Story：稽核資料基礎
- 分軌：後端（測試）
- 前置任務（dependsOn）：「專案設置」Epic 全部卡片（TASK-001～009、063～066、081～083）、TASK-067、TASK-068
- 狀態：就緒（不需任何 migration，可與 TASK-084 並行）
- 風險等級：中（只改測試碼；但 9 個整合套件都會被觸碰）
- Agent owner：Claude Code
- 人工核准者：使用者（2026-10-23）

## 目標

讓所有會寫入「將被稽核的表」的整合測試，改由統一的 client 工廠建立；工廠在設定了 `AUDIT_TEST_SECRET` 時，每個請求自動帶測試標記 header，未設定時行為與現在**完全相同**。完成後，稽核 migration 一套用，測試留下的稽核列就能被精確辨識與清理。

## 情境包（Context Pack）

- 相關檔案：`tests/helpers/designer-fixture.ts`；9 個套件：`tests/admin-booking.integration.test.ts`、`booking`、`business-hours`、`booking-policy`、`services`、`designers`、`notifications`、`rls`、`mfa-rls`（`account` 與 `store-settings` 不寫被稽核的表，不動）；`vitest.*.config.ts`、`.env.example`。
- 既有模式：各套件自行 `createClient(...)` 建立 anon／service_role／管理員 client；測試資料一律 `__TEST__` 前綴；`designer-fixture.ts` 的 `cleanupTestDesigners`／`sweepStaleTestDesigners`。
- 假設：`@supabase/supabase-js` 的 `createClient(url, key, { global: { headers } })` 會讓所有請求（含 RPC、Storage、auth 以外的 PostgREST）帶 header。
- 未知事項：各套件 client 建立點的數量與形式（實作第一步用 grep 列出，作為「改前基準」）。
- 允許變更的檔案：
  - `tests/helpers/audit-test-run.ts`（新增：本次執行 uuid、讀 `AUDIT_TEST_SECRET`、`createTaggedClient`、`cleanupAuditRows(runId)` 與刪除後「同標記查詢必須為 0」驗證）
  - `tests/helpers/designer-fixture.ts`（`.like("name", `${prefix}%`)` 改用跳脫函式 `escapeLikePattern`；建立 client 改用工廠）
  - 上述 9 個整合套件（**只改 client 建立行與 `afterAll` 的清理呼叫**，斷言不變）
  - `tests/audit-log/integration-clients-guard.test.ts`（新增：靜態護欄，掃描 `tests/*.integration.test.ts`，凡出現 `from("<被稽核表>")`、`createTestDesigner`、`create_appointment` 者必須使用工廠，納入 `npm test`）
  - `scripts/sweep-audit-test-rows.mjs`（新增：預設 dry-run，`--apply` 才刪；只刪有標記的列；列出每個 run id 的筆數與時間）
  - `.env.example`（新增 `AUDIT_TEST_SECRET` 說明，標註「僅本機測試用，不得設定在 Vercel」）、`package.json`（`audit:sweep` script）
- 不得觸碰：任何 migration、`lib/`、`app/`；斷言內容。

## 需求

- 被稽核的表：`appointments`、`booking_policy`、`business_hours`、`closed_dates`、`services`、`designers`、`designer_services`、`designer_leaves`。
- 工廠在 `AUDIT_TEST_SECRET` 未設定時**不帶任何 header**（與改動前位元組級相同的行為）；設定時帶 `x-audit-test-run`（本次執行 uuid）與 `x-audit-test-secret`。
- 清理 helper 以 service_role 依 run id 刪除，刪除後再查同 run id 必須為 0，否則 throw；放在各套件 `afterAll` 的**最後一步**，且不被前面步驟的例外跳過（`finally`）。稽核表尚不存在時（migration 未套用）清理 helper 必須靜默略過，不得使測試失敗。
- 掃除腳本不依賴名稱前綴或時間窗，只認 run id 標記。

## 驗收標準

- 動工前先記錄改前基準：9 套件各自的測試項數與通過狀態。改後全數重跑，項數與結果完全相同。
- 靜態護欄在故意移除某套件的工廠使用時會失敗（突變驗證一次）。
- `escapeLikePattern` 有單元測試（`_`、`%`、`\` 皆被跳脫）。
- 未設定 `AUDIT_TEST_SECRET` 時，網路請求不含 `x-audit-test-*` header（單元測試以 mock fetch 驗證）。

## 實作備註

- `tests/mfa-rls.integration.test.ts` 的拋棄式管理員與 `rls`、`notifications` 的 client 同樣經工廠建立。
- 不得為了清理引入名稱前綴／時間窗條件（安全審查 H1／H3）。
- 本卡不建立 Vault 密鑰、不套用 migration。

## 驗證契約

- 單元測試：`npm test`（含新護欄與 helper 測試）。
- 整合測試：9 套件全數重跑，與改前基準一致（`npm run test:rls`、`test:booking`、`test:admin-booking`、`test:business-hours`、`test:booking-policy`、`test:services`、`test:designers`、`test:mfa-rls`、`test:notifications`）。
- E2E 測試：不適用。
- 型別檢查：`npx tsc --noEmit`；Lint：`npm run lint`；Build：`npm run build`。
- 螢幕截圖：不適用。
- 安全性檢查：確認 `.env.example` 不含真實密鑰；工廠不把密鑰寫入 log。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：不適用
- 已知限制：
- 後續任務：TASK-086
