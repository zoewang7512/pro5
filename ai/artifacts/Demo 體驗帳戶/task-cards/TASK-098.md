# AI-Ready 任務卡

## Metadata

- 任務：觸發器可行性實驗：auth.users／auth.mfa_factors 觸發器（拋棄式帳號，實驗後清除）
- 上層規格：[`feature-spec.md`](../feature-spec.md)；架構筆記：[`architecture-notes.md`](../architecture-notes.md)
- 上層 Epic：Demo 體驗帳戶
- 上層 User Story：鎖定帳號安全三項
- 分軌：後端
- 前置任務（dependsOn）：TASK-097
- 狀態：草稿（待人工核准）
- 風險等級：高
- Agent owner：Claude Code
- 人工核准者：待使用者核准

## 目標

用拋棄式帳號實測「在託管 Supabase 的 `auth` schema 建觸發器鎖住 Demo 帳戶」是否可行，回答六個未知，並產出「採用／退回備案」的結論，供 TASK-100 依據。**本卡不新增任何要保留的資料庫物件。**

## 情境包（Context Pack）

- 相關檔案：
  - `ai/artifacts/Demo 體驗帳戶/architecture-notes.md` D5
  - `lib/admin/account.ts`（`updateUser`、`mfa.enroll` 的實際呼叫方式）
  - `scripts/seed-designer-account.mjs`（service role client 寫法）
  - `tests/mfa-rls.integration.test.ts`（拋棄式帳號與 `scope: "local"` 的既有做法）
- 既有模式：拋棄式帳號以 `__TEST__` 前綴建立並在結尾刪除；測試不得對店長帳號做全域 `signOut()`。
- 假設：
  - SQL 由使用者在 Supabase SQL Editor 執行（本專案沒有直接的資料庫連線）；Claude 負責撰寫 SQL、腳本與判讀結果。
  - 觸發器只對帶 `is_demo` 的拋棄式帳號生效，實驗期間不影響 `designer001` 與一般登入。
- 未知事項：
  - 託管 Supabase 是否允許在 `auth.users`／`auth.mfa_factors` 建立觸發器？
  - GoTrue 連資料庫的角色是否為 `supabase_auth_admin`（`current_user` 判斷是否成立）？
  - 登入、token refresh、登出是否都不會誤觸發？
  - `updateUser({ email })`、`updateUser({ phone })` 實際寫入哪些欄位？
  - `resetPasswordForEmail` 寫入哪些欄位、被擋時 Auth 回傳什麼錯誤？
  - 觸發器丟出的例外，客戶端看到的錯誤碼與文字為何？
  - `postgres` 角色能否 `delete from auth.sessions`（TASK-100 的 `demo_revoke_sessions()` 需要）？
- 允許變更的檔案：
  - `ai/artifacts/Demo 體驗帳戶/verification/TASK-098.md`（實驗報告）
  - `ai/artifacts/Demo 體驗帳戶/verification/TASK-098-spike.sql`（實驗用 SQL，含建立與清除）
  - `ai/artifacts/Demo 體驗帳戶/verification/TASK-098-spike.mjs`（實驗用腳本，只操作 `__TEST__` 拋棄式帳號）
  - `ai/context/decisions.md`（記錄結論）
- 不得觸碰：
  - 任何既有 migration
  - `designer001` 與任何真實帳號（Claude 不得讀寫或登入；**唯一例外**：實驗觸發器存在期間，由使用者本人用自己的瀏覽器手動登入一次，確認不受影響）
  - `supabase/migrations/` 目錄（本卡不新增 migration）

## 需求

- 先把實驗 SQL 與腳本交給使用者審閱並取得同意，才請使用者執行。實驗 SQL 要附**緊急 `drop trigger` 的語句**，並先備妥。
- 實驗用的觸發器函式必須是 `SECURITY INVOKER`，`auth.users` 觸發器以 `WHEN (OLD.raw_app_meta_data ->> 'is_demo' = 'true')` 限定，函式第一行就對非 `supabase_auth_admin` 呼叫 `return new`（避免誤傷其他帳號的登入）。
- 建立兩個拋棄式帳號：一個帶 `app_metadata.is_demo`，一個不帶（對照組）。
- 逐項驗證：Demo 帳戶 `updateUser({ password })`、`updateUser({ email })`、`resetPasswordForEmail`、`mfa.enroll` 被擋；登入、refresh、登出正常；對照組上述操作全部成功（含非 Demo 帳號啟用 MFA）。
- 實驗觸發器存在期間，請使用者用自己的瀏覽器登入 `designer001` 一次，確認可正常登入（Claude 不碰該帳號）。
- 驗證 `postgres` 能否刪除拋棄式帳號的 `auth.sessions`。
- 記錄觸發器內 `current_user` 的實際值，以及各動作實際被寫入的欄位。
- 實驗結束必須 drop 觸發器與函式、刪除拋棄式帳號，並附上確認已清除的查詢輸出。
- 結論二選一寫入報告與 `decisions.md`：採用觸發器（附最終欄位清單），或退回備案（層 3 加強並請使用者重新確認殘留風險）。

## 驗收標準

- 六個未知各有答案與證據（指令輸出或查詢結果）。
- 實驗後 `pg_trigger` 查詢顯示沒有殘留的實驗觸發器，`auth.users` 沒有 `__TEST__` 帳號。
- `designer001` 的 `auth.users` 列（`encrypted_password` 雜湊與 `updated_at`）在實驗前後一致，附比對輸出。
- 結論明確（採用或備案），並經人工核准。

## 實作備註

- 若 `current_user` 不是 `supabase_auth_admin`，D5 的判斷要改寫，報告需給出替代條件。
- 實驗期間不要用 `designer001` 的瀏覽器登入做任何操作，避免與實驗觸發器同時存在。

## 驗證契約

- 單元測試：不適用。
- 整合測試：實驗腳本逐項輸出（通過／失敗）貼入報告。
- E2E 測試：不適用。
- 型別檢查：`npx tsc --noEmit` 無錯誤
- Lint：`npm run lint` 無錯誤
- Build：`npm run build` 成功
- 螢幕截圖：不適用。
- 安全性檢查：觸發器範圍只比對 `is_demo`；清除後的查詢證據；不使用任何真實帳號。

## 審查關卡

架構、安全性、驗證（測試工程）；高風險，動工前須人工核准。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：
- 已知限制：
- 後續任務：
