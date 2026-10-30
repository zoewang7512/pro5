# AI-Ready 任務卡

## Metadata

- 任務：資料庫鎖定 migration：Demo 帳戶不可改密碼、Email、MFA（auth 觸發器）與撤銷 session 函式
- 上層規格：[`feature-spec.md`](../feature-spec.md)；架構筆記：[`architecture-notes.md`](../architecture-notes.md)
- 上層 Epic：Demo 體驗帳戶
- 上層 User Story：鎖定帳號安全三項
- 分軌：後端
- 前置任務（dependsOn）：TASK-097, TASK-098
- 狀態：草稿（待人工核准）
- 風險等級：高
- Agent owner：Claude Code
- 人工核准者：待使用者核准

## 目標

依 TASK-098 的實驗結論，新增 migration，讓經由 Auth API 對 Demo 帳戶改密碼、改 Email、重設密碼、註冊 MFA 一律被資料庫擋下，且完全不影響其他帳戶與登入流程；並提供撤銷 Demo session 的函式，供每日還原與緊急關閉使用。

## 情境包（Context Pack）

- 相關檔案：
  - `ai/artifacts/Demo 體驗帳戶/verification/TASK-098.md`
  - `supabase/migrations/0016_is_admin_require_aal2.sql`（既有 migration 檔頭寫法、套用順序與回滾說明）
  - `tests/mfa-rls.integration.test.ts`、`vitest.mfa-rls.config.ts`
- 既有模式：migration 檔頭寫明用途、套用順序、回滾與重跑冪等性；`_down.sql` 對應；整合測試用拋棄式帳號並清除。
- 假設：
  - **前置條件：TASK-098 結論為「採用觸發器」。** 若結論為備案，本卡改為只在 `decisions.md` 記錄備案並請使用者確認殘留風險，不新增 migration，直接關閉。
  - 鎖定欄位清單以 TASK-098 的實測為準，架構筆記 D5 只是起點。
- 未知事項：
  - 以 TASK-098 報告為準。
- 允許變更的檔案：
  - `supabase/migrations/0021_demo_account_lock.sql`（新增；實際編號以當時最大編號為準）與 `0021_demo_account_lock_down.sql`
  - `tests/demo-lock.integration.test.ts`、`vitest.demo-lock.config.ts`（新增）
  - `package.json`（新增 `test:demo-lock`）
  - `ai/context/decisions.md`（記錄最終欄位清單與 `current_user` 判斷）
- 不得觸碰：
  - 既有 migration 檔案
  - `designer001` 與真實 Demo 帳戶（測試只用拋棄式帳號）
  - 既有 RLS policy 與 `is_admin()`

## 需求

- **觸發器函式必須是 `SECURITY INVOKER`**（若寫成 `SECURITY DEFINER`，`current_user` 變成擁有者，判斷永遠不成立，鎖等於沒做）；migration 內要有註解與測試證明這點。
- `auth.users` BEFORE UPDATE 觸發器：以 `WHEN (OLD.raw_app_meta_data ->> 'is_demo' = 'true')` 限定，讓其他帳號（含 `designer001`）的登入根本不進入函式；函式第一行 `if current_user <> 'supabase_auth_admin' then return new; end if;`，且不得有任何可能丟非預期例外的邏輯。鎖定欄位任一改變就 `raise exception`：`encrypted_password`、`email`、`email_change`、`email_change_token_new`、`email_change_token_current`、`recovery_token`、`phone`、`phone_change`（最終清單以 TASK-098 實測為準）。
- `auth.mfa_factors` BEFORE INSERT 觸發器：WHEN 不用子查詢，函式內查該 `user_id` 是否 `is_demo`，是就 `raise exception`；必須測試非 Demo 帳號啟用 MFA 的路徑不受影響。
- `demo_revoke_sessions()`：`SECURITY DEFINER`、`search_path = ''`、只有 service_role 可執行；**自己查 `is_demo` 帳戶，筆數不是剛好 1 就 `raise`**；刪除其 `auth.sessions`（可行性依 TASK-098 結果）。
- 觸發器函式 `set search_path = ''`、不給 `execute` 給 `anon`／`authenticated`。
- **緊急 `drop trigger` 的 SQL 在套用前就備妥**，並在檔頭註明；套用後立刻請使用者用自己的瀏覽器登入 `designer001` 確認不受影響。
- 檔頭註明：admin API（service_role）改 Demo 帳號也經過 GoTrue，同樣被擋；維修通道是 SQL Editor 的 `postgres` 角色。
- 冪等（`create or replace`／`drop trigger if exists`）；`_down.sql` 完整移除觸發器與函式。
- migration 檔頭寫明：只對 `is_demo` 帳戶有作用、套用前後其他帳戶行為不變、套用順序（先套用 migration，再建立 Demo 帳戶）、維修通道（SQL Editor 的 `postgres` 角色不受限）。

## 驗收標準

- 拋棄式 Demo 帳號：`updateUser({ password })`、`updateUser({ email })`、`resetPasswordForEmail`、`mfa.enroll` 皆失敗，資料庫對應欄位不變。
- 同一個拋棄式 Demo 帳號：登入、token refresh、登出（`scope: "local"`）皆成功。
- 對照組拋棄式非 Demo 帳號：上述所有操作皆成功，行為與套用前一致。
- 套用 migration 前後，`designer001` 的 `auth.users` 列（雜湊與 `updated_at`）一致，附比對輸出。
- 套用 `_down.sql` 後，Demo 拋棄式帳號的上述操作恢復成功。
- 非 Demo 拋棄式帳號啟用 MFA、登入、登出都不受觸發器影響。
- `demo_revoke_sessions()`：對只有一個 `is_demo` 帳戶的情況刪除其 session；對 0 個或 2 個以上 `is_demo` 帳戶的情況必定失敗且不刪任何東西；`anon`／`authenticated` 不可執行（以拋棄式帳號測試）。
- 既有 `test:account`、`test:mfa-rls` 仍通過。

## 實作備註

- 整合測試只能建立與刪除自己的拋棄式帳號；測試腳本結尾不得做全域 `signOut()`。
- 套用 migration 由使用者在 SQL Editor 執行，Claude 提供 SQL 與驗證查詢。
- 錯誤訊息文案要讓前端能辨識（例如固定前綴），但不洩漏資料庫細節。

## 驗證契約

- 單元測試：不適用。
- 整合測試：`npm run test:demo-lock`（拋棄式帳號）；`npm run test:account`、`npm run test:mfa-rls` 回歸。
- E2E 測試：不適用（串接於 TASK-112）。
- 型別檢查：`npx tsc --noEmit` 無錯誤
- Lint：`npm run lint` 無錯誤
- Build：`npm run build` 成功
- 螢幕截圖：不適用。
- 安全性檢查：觸發器只比對 `is_demo`；函式 `search_path` 與授權；回滾腳本實跑一次。

## 審查關卡

架構、安全性、驗證（測試工程）；高風險，動工前須人工核准。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：
- 已知限制：
- 後續任務：
