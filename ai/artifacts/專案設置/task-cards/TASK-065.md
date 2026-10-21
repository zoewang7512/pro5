# AI-Ready 任務卡

## Metadata

- 任務：建立「新建資料表的 migration 必須附上明確 GRANT」規則
- 上層規格：無（因應 Supabase 2026-10-30 平台變更的流程規則）
- 上層 Epic：專案設置
- 上層 User Story：核心資料模型與認證框架基礎
- 分軌：不適用（流程／文件）
- 前置任務（dependsOn）：無
- 狀態：完成
- 風險等級：低
- Agent owner：Claude Code
- 人工核准者：使用者（2026-10-21 核准開工）

## 目標

讓之後每一支建立 `public` schema 資料表的 migration，都在同一個檔案裡寫出明確且最小權限的 `GRANT`，並在審查關卡被檢查到。

## 情境包（Context Pack）

- 相關檔案：
  - `ai/context/decisions.md`（新增一筆決策紀錄）
  - `ai/checklists/security-checklist.md`（新增一條檢查項目）
  - `ai/context/project-map.md`（`supabase/migrations/` 目錄說明那一列補一句）
- 既有模式：
  - 函式已有明確授權慣例：`revoke execute ... from public` + `grant execute ... to <角色>`（見 `0002`、`0007`、`0009`、`0013`、`0014`）。
  - `0007_admin_profile.sql` 註解已說明本專案 `public` schema 對 anon／authenticated／service_role 有獨立的明確授權，不能只 revoke from public。
  - `0001` 對 `appointments` 用欄位層級 GRANT、`0008` 對 `booking_policy` revoke truncate，都是收緊權限的先例。
- 假設：
  - Supabase 通知（2026-10-20 收到）：2026-10-30 起，既有專案在 `public` 新建的資料表不再自動授權給 Data API 角色；既有資料表維持原授權。
  - 本專案目前沒有 Supabase CLI、preview branch，migration 都是人工貼到 SQL Editor 執行。
- 未知事項：
  - 無。
- 允許變更的檔案：
  - `ai/context/decisions.md`、`ai/checklists/security-checklist.md`、`ai/context/project-map.md`
- 不得觸碰：
  - `supabase/migrations/` 內任何 SQL（補既有資料表的 grant 屬於 TASK-066）。
  - `ai/templates/`（範本唯讀）。

## 需求

- `decisions.md` 新增決策：建立資料表的 migration 必須在同一檔案內寫出明確的 `GRANT`；依該表實際用途對 `anon`／`authenticated`／`service_role` 分別給最小權限，**不得直接照抄 Supabase 通知信的範例**（範例對所有表都開 anon select）。
- 決策內容需說明：
  - 背景（Supabase 2026-10-30 平台變更），以及「沒寫 grant → API 回 permission denied」的症狀。
  - grant 與 RLS 的分工：grant 決定角色能不能碰這張表，RLS 決定能碰哪幾列，兩者都要。
  - 不需要的權限要明確 revoke（例如 truncate），比照 `0008` 的做法。
  - down migration 不需要另外 revoke（drop table 會一併移除授權）。
- `security-checklist.md` 新增一條：新建資料表的 migration 是否附上最小權限的明確 GRANT。
- `project-map.md` 的 `supabase/migrations/` 列補一句指向這條決策。

## 驗收標準

- 上述三個檔案都已更新，內容彼此一致，並可指回 decisions.md 的同一筆決策。
- 規則寫明「依用途給最小權限」，而不是照抄通知信範例。
- 沒有修改任何 SQL 或程式碼。

## 實作備註

- 純文件變更，不需要架構或安全性子代理審查；仍需人工核准規則內容。

## 驗證契約

- 單元測試：不適用。
- 整合測試：不適用。
- E2E 測試：不適用。
- 型別檢查：不適用。
- Lint：不適用。
- Build：不適用。
- 螢幕截圖：不適用。
- 安全性檢查：人工確認規則內容。

## 完成證據

- 變更的檔案：
  - `ai/context/decisions.md`：新增「TASK-065：建立資料表的 migration 必須在同一檔案寫出明確且最小權限的 GRANT」決策（寫法：先 revoke all from anon, authenticated → 依用途 grant → service_role 明確 grant；不照抄通知信範例；down migration 不需另外 revoke）。
  - `ai/checklists/security-checklist.md`：新增一條「新建 Supabase 資料表的 migration 要附明確且最小權限的 GRANT」檢查項，指回上述決策。
  - `ai/context/project-map.md`：`supabase/migrations/` 那一列補一句規則說明，指回上述決策。
- 執行過的指令：
  - `git diff --stat`：只有上述 3 個檔案變更（+43／-1）。
  - `git diff --name-only -- supabase app lib components`：無輸出，確認沒有動到 SQL 或程式碼。
- 測試輸出：不適用（純文件）。
- 螢幕截圖：不適用。
- 已知限制：
  - 規則只約束之後的新表；既有 8 張表仍靠自動授權，要等 TASK-066 補齊。
  - 規則靠審查關卡與 checklist 執行，沒有自動化檢查（例如 CI 掃描 migration 是否含 GRANT）。
- 後續任務：TASK-066（依本規則補齊既有 8 張資料表的明確 GRANT）。
