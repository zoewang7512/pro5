# AI-Ready 任務卡

## Metadata

- 任務：稽核紀錄 稽核資料基礎（`0019_audit_log`：`audit_log`／`audit_purge_log`、三層權限、守護 trigger、`audit_private` 內部函式、測試標記邏輯、可回滾 SQL 驗證腳本）
- 上層規格：[`feature-spec.md`](../feature-spec.md)、[`architecture-notes.md`](../architecture-notes.md)（§1、§2、§3、§5、§6、§8）
- 上層 Epic：稽核紀錄
- 上層 User Story：稽核資料基礎
- 分軌：後端
- 前置任務（dependsOn）：「專案設置」Epic 全部卡片（TASK-001～009、063～066、081～083）、TASK-067、TASK-068、TASK-079
- 狀態：就緒
- 風險等級：高（新增權限敏感的資料表與 SECURITY DEFINER 函式、資料庫遷移）
- Agent owner：Claude Code
- 人工核准者：使用者（2026-10-23 核准規格書與架構筆記第 2 版）

## 目標

建立稽核紀錄的資料庫基礎：套用後資料庫已具備不可竄改的 `audit_log`、清除帳本、操作者判定與測試標記機制，但**還沒有任何來源 trigger**（套用後不產生任何稽核列、對既有流程零影響）。

## 情境包（Context Pack）

- 相關檔案：`supabase/migrations/0016_is_admin_require_aal2.sql`（`is_admin()`）、`0017_designers.sql`（GRANT／policy／constraint 寫法慣例）、`0018_designer_aware_booking.sql`（依賴檢查、`lock_timeout`、`notify pgrst`、明寫 execute 權限）、`0011`／`0012`（Vault 讀取慣例）；`ai/context/decisions.md`（TASK-065／066／079）。
- 既有模式：migration 開頭做依賴檢查；建表同檔寫最小權限 GRANT（先 `revoke all` 再逐一 grant，含 `service_role`）；SECURITY DEFINER＋`set search_path = ''`；constraint 用 `drop constraint if exists` 再 `add`；up／down 成對、可重複執行。
- 假設：`0001`～`0018` 已套用；Supabase 專案允許建立新 schema `audit_private`，且**不會**把它加入 PostgREST exposed schemas。
- 未知事項：`request.headers` GUC 在 PostgREST／Supabase 閘道下的實際內容（由 TASK-086 端到端驗證，本卡只用 SQL 模擬 GUC 驗證邏輯）；`supabase_admin`／`postgres` 在本專案的實際 `current_user` 名稱（以 SQL 驗證腳本確認）。
- 允許變更的檔案：
  - `supabase/migrations/0019_audit_log.sql`、`0019_audit_log_down.sql`（新增）
  - `supabase/verify/0019_audit_log_verify.sql`（新增，整段 `begin; ... rollback;`）
  - `ai/context/decisions.md`（新增決策：service_role 權限偏離 TASK-065 慣例、稽核保證邊界、`system` 混合來源、日後不得新增執行任意 SQL 的 definer 函式、稽核套件不得與其他整合套件並行、設計師名稱保留政策）
- 不得觸碰：`app/`、`lib/`、既有 migration、既有測試；不得對任何業務表掛 trigger。

## 需求

- 依架構筆記 §1 建立 `audit_log`（含 `actor_role`、`test_run_id`、`entity_id` 上限 128、summary／changes 4096 bytes 備援上限）與 `audit_purge_log`；索引為 PK 與 `(entity_type, entity_id, id desc)`。
- 依 §3 建立三層權限：GRANT（`authenticated` 僅 select、`service_role` 僅 select／delete、序列一併收回）、RLS（唯一 policy `using ((select public.is_admin()))`，不 force）、守護 trigger（`before insert`／`before update`／statement 級 `before truncate`／`before delete`；刪除僅限 `test_run_id is not null` 且 `current_user = 'service_role'`，或 owner；`audit_purge_log` 的 update／delete／truncate 無條件拒絕）；每次刪除由 `after delete ... referencing old table` statement trigger 寫入清除帳本。
- 依 §2、§3、§5 建立 schema `audit_private` 與內部函式：`_audit_write`（不接受 actor／時間參數；於內部判定操作者；讀 `request.headers` 與 Vault `audit_test_secret` 決定是否寫入 `test_run_id`；以專用 SQLSTATE `AUD01` 重新拋出內部錯誤）、`_audit_diff`（invoker＋immutable）、文字截斷輔助（60 字）。對 anon、authenticated、service_role `revoke usage on schema` 並對每支函式明寫 `revoke execute`；migration 結尾以 `has_function_privilege` 自我檢查，任一為真就 `raise exception`。
- 開頭 `set local lock_timeout = '5s'`、依賴檢查（缺 `is_admin()`／`appointments` 等就 `raise exception`）、結尾 `notify pgrst, 'reload schema'`；確認 `audit_log` 不在 `supabase_realtime` publication。
- `0019_audit_log_down.sql`：開頭檢查 `pg_trigger` 是否還有 `audit_` 業務 trigger，有就 `raise exception`；預設**保留** `audit_log`、`audit_purge_log` 與其守護 trigger，`drop table` 以註解附上；檔頭寫明回滾順序（前端 → 0023 → 0022 → 0021 → 0020 → 0019）。
- 可回滾驗證腳本涵蓋（架構筆記 §7）：truncate、各角色 update／delete、三層各自獨立有效（交易內臨時 `grant` 後再以該角色寫入）、內部函式三角色呼叫皆被拒、測試標記邏輯（模擬 `request.headers`：密鑰正確／錯誤／缺漏／uuid 格式錯誤）、操作者判定四種來源（admin／anon／service_role／無 claims）、清除帳本、`0019_down` 演練後 rollback。

## 驗收標準

- `0019` 可重複執行；套用後 `audit_log` 與 `audit_purge_log` 為空，既有流程不受影響（`npm run test:booking` 與 `test:notifications` 重跑結果與套用前相同）。
- SQL 驗證腳本全數通過，輸出貼進驗證報告。
- anon 對 `audit_log` 任何操作 42501；非管理員 authenticated select 回空；任何角色 insert／update／truncate 被拒；service_role 只能刪帶標記的列且每次刪除留下清除帳本。
- `audit_private` 底下所有函式對 anon、authenticated、service_role 皆不可呼叫；經 `/rest/v1/rpc/` 呼叫得到 42501 或 PGRST202。
- `decisions.md` 已記錄上述決策與殘留風險（owner／Studio impersonate／`system` 混合來源）。

## 實作備註

- migration 需人工貼到 Supabase SQL Editor 執行；Vault 密鑰 `audit_test_secret` 由使用者在 SQL Editor 執行 `select vault.create_secret('<隨機 32 位元組以上>', 'audit_test_secret');` 建立，**值不得出現在對話、repo 或 Vercel**；同值寫入本機 `.env.local` 的 `AUDIT_TEST_SECRET`。
- Vault 讀取只在請求帶 `x-audit-test-run` header 時才發生；密鑰缺失時一律忽略標記（照常記錄為無標記列）。
- 每支函式附中文註解說明檢查理由與邊界語意（比照 0016／0018）。

## 驗證契約

- 單元測試：不適用（純資料庫）。
- 整合測試：不新增；只需最小 REST 驗證——anon select 回 42501、非管理員 authenticated select 回空陣列（完整矩陣在 TASK-086）。
- E2E 測試：不適用。
- 型別檢查：`npx tsc --noEmit`（確認未影響）；Lint：`npm run lint`；Build：`npm run build`。
- 螢幕截圖：不適用。
- 安全性檢查：套用前由 security-reviewer 與 architect 複審 `0019` 實作（高風險）；SQL 驗證腳本輸出為證據。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：不適用
- 已知限制：
- 後續任務：TASK-086（試點與端到端驗證）
