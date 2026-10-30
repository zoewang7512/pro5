# 驗證報告

## 摘要

- 任務：TASK-098 觸發器可行性實驗：auth.users／auth.mfa_factors 觸發器（拋棄式帳號，實驗後清除）
- 結果：**實驗完成，結論：採用觸發器（層 2 可行）**。七個未知皆已有答案與證據；實驗物件、拋棄式帳號已清除並附證據；`designer001` 前後一致。
- 驗證者：實作 agent（Claude Code）。**結論待人工核准**；任務卡列的架構、安全性、測試三個審查關卡尚未執行（建議併入 TASK-100 的審查，見「後續任務」）。
- 日期：2026-10-30。SQL 全由使用者在 Supabase SQL Editor 執行，腳本由 agent 執行。

## 結論：採用觸發器

在託管 Supabase 上，`auth.users`（BEFORE UPDATE）與 `auth.mfa_factors`（BEFORE INSERT）觸發器可用，以 `current_user = supabase_auth_admin` 區分 GoTrue 與維修通道可行。block 模式下，Demo 帳號的改密碼、改 Email、重設密碼、啟用 MFA（含 admin API 路徑）全部被擋，且登入、refresh、登出、非 Demo 帳號（含啟用 MFA）、`designer001` 登入皆不受影響。

**最終鎖定欄位清單（供 TASK-100）：**
`encrypted_password`、`email`、`email_change`、`email_change_token_new`、`email_change_token_current`、`recovery_token`、`phone`、`phone_change`。

- 已由 block 階段實際擋下並驗證：`encrypted_password`、`email_change`、`email_change_token_current`、`email_change_token_new`（用戶端 `PUT /user` 回應直接列出）、`recovery_token`（`POST /recover` 回應列出）、`phone`（admin 設電話被擋）、`email`（admin 改 Email 被擋）。
- **未實測**：`phone_change`（用戶端 `updateUser({ phone })` 需要簡訊供應商，本專案未必啟用）。維持在清單內作為保守做法；它與 `phone` 同類，不影響登入。
- **不得放入清單**：`confirmed_at`（generated column，BEFORE 觸發器看到過期值，每一列都「變動」）、`last_sign_in_at`、`updated_at`、`email_confirmed_at`、`raw_user_meta_data`、`banned_until`（緊急關閉 D12 依賴它可寫）。

## 七個未知的答案

| 未知 | 答案 | 證據 |
|---|---|---|
| (a) 能否建觸發器 | **能** | 步驟 1：兩個 `create trigger` 成功；`pg_trigger` 兩列、`tgenabled = O` |
| (b) GoTrue 的角色 | **`supabase_auth_admin`** | 日誌 34＋20 列 `cur_user`／`sess_user` 全為 `supabase_auth_admin` |
| (c) 登入／refresh／登出 | **不誤觸發鎖定欄位** | 登入只改 `last_sign_in_at`、`updated_at`；refresh 只改 `updated_at`；登出（local）沒有 UPDATE。block 階段 demo 的這三項全部成功 |
| (d) `updateUser({ email })`／phone 寫入欄位 | **email**：`email_change`、`email_change_sent_at`、`email_change_token_current`、`email_change_token_new`（`email` 本身要等確認信才變）；**phone**：admin 路徑寫 `phone`（用戶端路徑未測） | observe 日誌；block 階段 `PUT /user` 回應 `locked (email_change,email_change_token_current,email_change_token_new)` |
| (e) 重設密碼 | 寫 `recovery_sent_at`、`recovery_token`；被擋時回 HTTP 500 | observe 日誌；block 階段 `POST /recover`（demo 本人 Email）回 `locked (recovery_token)`。對不存在的 Email 回 200 `{}`（Auth 防帳號探測的既有行為） |
| (f) 例外在客戶端的樣子 | 見下節 | 直接打 Auth API 的原始回應 |
| (g) `postgres` 能否刪 `auth.sessions` | **能** | 步驟 5 的 delete 無錯誤，`sessions_after = 0`；同一 demo session 的 refresh token 在刪除前 HTTP 200、刪除後 `400 refresh_token_not_found`。（`sessions_before` 的數字使用者貼的內容沒有顯示，以刪除前後 refresh 行為佐證） |

### (f) 客戶端看到的錯誤（原始回應）

| 操作 | 回應 |
|---|---|
| `PUT /auth/v1/user`（改密碼） | HTTP 500，`{"code":"P0001","message":"spike098: demo account is locked (encrypted_password)"}` |
| `PUT /auth/v1/user`（改 Email） | HTTP 500，`{"code":"P0001","message":"...locked (email_change,email_change_token_current,email_change_token_new)"}` |
| `POST /auth/v1/recover`（demo 本人 Email） | HTTP 500，`{"code":"P0001","message":"...locked (recovery_token)"}` |
| `POST /auth/v1/factors`（啟用 MFA） | HTTP 500，`{"code":500,"error_code":"unexpected_failure","msg":"Unexpected failure, please check server logs for more information"}`（通用，沒有資料庫訊息） |
| supabase-js 的呈現 | `status = 500`、`code` 未定義、`message = {}` |

**含義（寫給 TASK-100）：**
1. 資料庫例外的原文（SQLSTATE `P0001` 與訊息）會**直接出現在客戶端回應**。正式觸發器的訊息必須是不含欄位名稱與內部細節的通用文字（例如 `demo account is read-only`）。
2. 前端**不能依賴錯誤文字或錯誤碼辨識「被鎖」**（supabase-js 把它呈現成 `message = {}`）；前端鎖定仍以 `isDemo` 為準，三張卡片在 `isDemo` 時停用（TASK-101），登入頁對重設密碼顯示既有通用錯誤。
3. 這些錯誤都是 HTTP 500，會與真實伺服器故障混在一起；營運上看到零星 `P0001 ... locked` 是被擋的嘗試，不是故障。

## 對 TASK-100 與其他卡的影響（重要）

1. **RLS 預設啟用**：這個專案新建的資料表預設啟用 RLS 且沒有 policy。觸發器以 `supabase_auth_admin` 讀寫的任何表都必須顯式處理（關閉或建立 policy）；否則寫入被拒（SQLSTATE 42501）會讓所有符合 WHEN 的 Auth 操作回 500（包含**建立 Demo 帳戶本身**），讀取則靜默讀到零列使判斷失效。**TASK-100 的正式觸發器建議不讀任何設定表**（模式開關不需要，直接寫死「擋」），把這個風險整個移除。
2. **維修通道**：SQL Editor 的 `postgres` 不能 `set role supabase_auth_admin`（`42501`），所以無法在 SQL Editor 模擬 GoTrue；要驗證觸發器只能走真實 Auth API（拋棄式帳號）。`postgres` 直接改 `auth.users` 的 `current_user` 不是 `supabase_auth_admin`，不受鎖限制，維修通道成立。
3. **建立使用者時 GoTrue 會對該列連續 UPDATE 兩次**（`email_confirmed_at`；`raw_user_meta_data`），皆不在鎖定清單，所以 TASK-099 建立 Demo 帳戶不受觸發器影響；但觸發器出任何錯都會讓建立失敗，需有測試。
4. **`is_demo` 缺鍵時為 null**：判斷要用 `coalesce`／`is true`，不能寫 `= true` 之外的反向條件。
5. **admin API（service_role）也被擋**（D5 的預期成立）：輪換 Demo 密碼只能走 SQL Editor。`ban_duration`（`banned_until`）可寫（D12 成立）。
6. **MFA 觸發器對所有人的 INSERT 都會觸發**（沒有 WHEN）；本實驗以「函式第一步查拋棄式標記、不是就放行」處理，`designer001` 登入與其他帳號不受影響。TASK-100 的版本需測試非 Demo 帳號啟用 MFA 仍成功（本實驗對照組已證實可行）。
7. **紀錄的取捨**：實驗函式在 block 時 raise 會讓同交易的日誌寫入一併回滾，所以被擋的嘗試不會留在日誌；正式版不需要日誌。

## 過程紀錄（按時間順序）

## 步驟 0：實驗前基準（2026-10-30，使用者在 SQL Editor 執行）

`designer001`（`public.admins` 唯一登記帳號）：

| id | pw_hash_md5 | updated_at | last_sign_in_at |
|---|---|---|---|
| c70e38fb-0315-46f8-934e-242cef48278f | 8874451a96330d231bc13949730dcfd5 | 2026-10-30 12:37:59.271085+00 | 2026-10-30 09:54:55.380825+00 |

殘留檢查：`leftover_users = 0`、`leftover_triggers = 0`、`leftover_schema = 0`。

## 實驗過程中的發現（按時間順序）

1. **步驟 1 成功**：`create trigger` 在 `auth.users`（BEFORE UPDATE）與 `auth.mfa_factors`（BEFORE INSERT）皆成功，`pg_trigger` 兩列、`tgenabled = 'O'`。→ **未知 (a)：允許。**
2. **第一次 observe 失敗**：`admin.createUser`（帶 `spike098` 標記）回 `500 unexpected_failure "Database error creating new user"`；不帶標記的同樣請求 HTTP 200。GoTrue 建立使用者時會在同一交易內對該列再做 UPDATE，觸發了函式，函式內出錯使整筆交易回滾。
3. **根因（Dashboard Logs，SQLSTATE 42501）**：`new row violates row-level security policy for table "log"`。**這個 Supabase 專案對新建的資料表預設啟用 RLS（無 policy）**；`spike098.log` 與 `spike098.config` 都是。`log` 寫入被拒；`config` 讀到零列（`mode` 會是 null，block 永遠不會擋）。修正：`alter table ... disable row level security`（兩張表）。
   - **對 TASK-100 的影響：** 任何要讓 `supabase_auth_admin` 讀寫的資料表都必須顯式處理 RLS（關閉，或建立對應 policy），否則觸發器內讀寫失敗會讓所有符合 WHEN 的 Auth 操作回 500。正式觸發器若需要讀設定／寫紀錄，必須有測試覆蓋。
4. **`set role supabase_auth_admin` 在 SQL Editor 被拒**（`42501: permission denied to set role`）：`postgres` 不是該角色成員，無法模擬 GoTrue；維修通道是 `postgres` 直接改（不經 GoTrue，`current_user` 不是 `supabase_auth_admin`，不受鎖限制）。
5. **第三次 observe 成功**：26 項通過、0 失敗（含兩個拋棄式帳號建立、登入、refresh、改密碼、改 Email、重設密碼、啟用 MFA、admin API 各項、登出）。腳本中 `control` 的 admin 設電話回 500 是因電話欄位唯一限制（兩帳號用了同一假號碼），已改為不同號碼，與觸發器無關。

## observe 階段日誌判讀（`spike098.log`，34 列）

- **未知 (b)**：所有列 `cur_user = supabase_auth_admin`、`sess_user = supabase_auth_admin`。**`current_user = 'supabase_auth_admin'` 的判斷成立。**
- **`confirmed_at` 出現在每一列的變動欄位**：它是 generated column，BEFORE 觸發器看到的 NEW 值尚未重算，判斷「鎖定欄位」時**不得**把它列入，也不得用「任何欄位有變動」當條件。
- **未知 (c)（登入／refresh／登出）**：
  - 登入：UPDATE，只改 `last_sign_in_at`、`updated_at`。
  - `refreshSession`：UPDATE，只改 `updated_at`。
  - `signOut({ scope: "local" })`：**沒有任何 UPDATE**。
  - 三者都沒有碰到任何鎖定欄位，所以鎖定欄位清單不會誤擋它們（block 階段再以實際操作驗證）。
- **未知 (d)**：
  - `updateUser({ password })` → `encrypted_password`。
  - `updateUser({ email })` → `email_change`、`email_change_sent_at`、`email_change_token_current`、`email_change_token_new`（**`email` 本身不變**，要等確認信連結）。
  - admin `updateUserById({ email })` → `email`、`email_change`。
  - admin `updateUserById({ phone })` → `phone`（`phone_confirmed_at` 另外變）。
  - 用戶端 `updateUser({ phone })` 未測（專案未必啟用簡訊）；admin 路徑的 `phone` 已確認會寫入。
- **未知 (e)**：`resetPasswordForEmail` → `recovery_sent_at`、`recovery_token`。`recovery_token` 在鎖定清單內，可擋。
- **其他非鎖定欄位的行為**：`updateUser({ data })` 只改 `raw_user_meta_data`；admin `ban_duration` 只改 `banned_until`；兩者不在鎖定清單。
- **`mfa_factors` INSERT 觸發器**確實對兩個拋棄式帳號各觸發一次（`is_demo` 分別為 true／false）。
- **建立使用者時 GoTrue 會連續 UPDATE 兩次**（`email_confirmed_at`；`raw_user_meta_data`），皆非鎖定欄位，所以 Demo 帳戶建立（TASK-099）在觸發器啟用後不受影響。
- `is_demo` 欄位對照組為 `null`（`raw_app_meta_data` 沒有該鍵），語意同 false，TASK-100 判斷時需用 `coalesce`／`is true`。

## block 階段結果（觸發器 mode = block，第二次執行；第一次因設定表仍是 observe 而作廢）

- 29 項通過、0 失敗、2 項資訊。
- demo：改密碼／改 Email／重設密碼／啟用 MFA／admin 改密碼／admin 改 Email 皆被擋（HTTP 500）；admin 設電話被擋（資訊項，證實 `phone` 在鎖內）。
- 讀回確認被擋後無半套狀態：`email` 未變、`new_email` 為空、`recovery_sent_at` 為空。
- demo 的登入、refresh、改 `user_metadata`、`ban_duration` 設定與解除、第二個 session 登入並本地登出皆成功；被擋後用原密碼仍能登入（證明密碼未被改）。
- 對照組（非 demo）所有操作成功，**含啟用 MFA**。
- 第一次 block 因 `spike098.config` 仍是 `observe`（切換未寫入）而全數「未擋」，日誌 `mode` 欄位證實；該次結果作廢，帳號已清除。第二次先以全新查詢分頁確認 `block` 已寫入才執行。

## revoke-check 階段

- demo：刪除 session 後 refresh → `400 refresh_token_not_found`（通過）。
- control：**失敗，屬測試設計問題**：對照組的 refresh token 是在它自己成功改完密碼之後才存下來的，GoTrue 在密碼變更後會使舊 session 失效，所以該 token 本來就不能用，與觸發器、與 demo 的 session 刪除皆無關。此項不在驗收標準內，未另行補測（保守推測，未以實驗確認原因）。

## designer001 與清除證據

- 實驗觸發器存在、block 模式下，**使用者本人用自己的瀏覽器登入 designer001 一次，登入正常**（2026-10-30 約 13:37 UTC）；agent 全程沒有讀取、登入或修改該帳號。
- 步驟 8 後比對（`designer001`，id `c70e38fb-0315-46f8-934e-242cef48278f`）：

| | pw_hash_md5 | updated_at | last_sign_in_at |
|---|---|---|---|
| 實驗前（步驟 0） | 8874451a96330d231bc13949730dcfd5 | 2026-10-30 12:37:59.271085+00 | 2026-10-30 09:54:55.380825+00 |
| 實驗後（步驟 8） | 8874451a96330d231bc13949730dcfd5 | 2026-10-30 13:37:20.518711+00 | 2026-10-30 13:37:20.501816+00 |

  密碼雜湊一致；`updated_at`／`last_sign_in_at` 的差異來自使用者 13:37:20 的登入（兩者相差 17 毫秒），是預期行為。
- 清除（步驟 8 後查詢）：`leftover_triggers = 0`、`leftover_schema = 0`、`leftover_functions = 0`、`leftover_users = 0`。腳本 cleanup 階段另行確認「剩餘 0 個拋棄式帳號」，狀態檔已刪除。
- 診斷用的兩個暫存腳本（直接打 Auth API 看原始回應）放在 agent 的暫存目錄，不在專案內；它們建立的兩個診斷帳號（無標記者已刪除、帶標記者建立失敗而未產生）也已清除。

## 指令

| 指令 | 結果 |
|---|---|
| `node --env-file=.env.local .../TASK-098-spike.mjs observe` | 第三次執行：26 PASS、0 FAIL、2 INFO（前兩次因 RLS 問題在建立帳號時 500） |
| 同上 `block` | 第二次執行：29 PASS、0 FAIL、2 INFO |
| 同上 `revoke-check` | 1 PASS（demo）、1 FAIL（control，測試設計問題，見上） |
| 同上 `cleanup` | 找到 2 個、全部刪除、剩餘 0 |
| `npx tsc --noEmit` | 通過（0 錯誤） |
| `npm run lint` | 通過（0 error） |
| `npm run build` | 通過 |

## 殘留風險與限制

- **實驗用的 SQL 在實驗期間（約 1 小時）曾短暫存在於正式 Supabase**，且曾對 `public` 授權（診斷用，僅限非公開的 `spike098` schema，已隨 schema 移除）。期間只有帶 `spike098` 標記的拋棄式帳號進入函式；實驗期間 `designer001` 登入正常。
- **兩次失敗的 observe（建立拋棄式帳號 500）**期間，GoTrue 對任何帶標記帳號的建立都會失敗；沒有影響其他帳號（失敗的交易回滾、無殘留）。
- 本實驗證明的是「**目前**這個專案、這個 Auth 版本」的行為。Auth 平台升級可能改變寫入欄位或連線角色；TASK-100／TASK-111 的手冊須寫明「升級後若登入全面回 500，第一步套用 `_down.sql` 移除觸發器」（架構筆記 D5 已列）。
- `phone_change`、用戶端 `updateUser({ phone })` 未實測（見上）。
- 未執行任務卡列的架構、安全性、測試三個子代理審查；本卡未新增任何要保留的資料庫物件或程式碼，建議把審查併入 TASK-100（真正新增觸發器的卡）。

## 後續任務

- **TASK-100**：依本報告的欄位清單、通用錯誤訊息、不讀設定表、RLS 注意事項實作 migration；套用後立即實測 `designer001` 登入；附 `_down.sql`。審查關卡（架構、安全、測試）在該卡執行。
- **TASK-099／TASK-111**：手冊寫明 `postgres` 無法 `set role`、輪換 Demo 密碼只能走 SQL Editor、admin API 也被擋。
