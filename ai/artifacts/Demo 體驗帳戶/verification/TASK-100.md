# 驗證報告

## 摘要

- 任務：TASK-100 資料庫鎖定 migration：Demo 帳戶不可改密碼、Email、MFA（auth 觸發器）與撤銷 session 函式
- 結果：**實作與自動化驗證完成，使用者人工驗收通過（2026-10-30）**。鎖定模式 24 項、回歸 `test:account` 17 項、`test:mfa-rls` 20 項全過；回滾（`_down.sql`）實跑一次並驗證行為恢復。
- 驗證者：實作 agent（Claude Code）。架構、安全、測試三個子代理審查已執行，其意見是 agent 意見，**不等於人工核准**；需使用者處理的項目見「待你確認」。
- 日期：2026-10-30。migration 由使用者在 Supabase SQL Editor 套用，測試由 agent 執行。

## 變更的檔案

| 檔案 | 說明 |
|---|---|
| `supabase/migrations/0021_demo_account_lock.sql` | 新增：兩個觸發器函式（SECURITY INVOKER）＋兩個觸發器＋`demo_revoke_sessions()`；套用時自我檢查 |
| `supabase/migrations/0021_demo_account_lock_down.sql` | 新增：移除上述全部物件 |
| `tests/demo-lock.integration.test.ts`、`vitest.demo-lock.config.ts` | 新增：24 項整合測試（拋棄式帳號） |
| `package.json` | 新增 `test:demo-lock` |
| `ai/context/decisions.md` | 新增 TASK-100 條目 |
| `ai/artifacts/Demo 體驗帳戶/architecture-notes.md`、`task-cards/TASK-111.md` | 各改一句（不在任務卡允許清單內，已告知）：緊急處置改為只貼兩行 `drop trigger`，不用 `_down.sql` |

## 套用過程

1. 第一版 0021 套用 → `designer001` 登入正常（使用者本人回報）→ 鎖定模式 22 項通過。
2. 套用 `_down.sql` → off 模式（`DEMO_LOCK_EXPECT=off`）17 項通過、5 項略過（1 項錯誤前綴案例＋4 項 `demo_revoke_sessions` 案例，函式已移除，屬預期）。Demo 拋棄式帳號的改密碼、改 Email、重設密碼、啟用 MFA、admin 改密碼、admin 改 Email 全部恢復成功，與對照組一致。
3. 重新套用第一版 0021 → 鎖定模式 22 項通過（證明回滾後可重新套用、鎖回復）。
4. 三個審查後修正 0021（第二版：`is_demo` 標記不可改動、`reauthentication_token` 入鎖定清單、`notify pgrst`、緊急處置文字）與測試（見「審查處理」），重新套用 → 鎖定模式 24 項通過。
   - **誠實說明：** off 模式與回滾只用第一版驗證過。第二版對 `_down.sql` 只多一行 `notify pgrst`，未再另行實跑 off 模式。

## 指令與輸出

| 指令 | 結果 |
|---|---|
| `npm run test:demo-lock`（第二版，鎖定中） | **24 passed**（1 檔） |
| `DEMO_LOCK_EXPECT=off npm run test:demo-lock`（`_down` 之後，第一版） | 17 passed、5 skipped |
| `npm run test:account` | 17 passed |
| `npm run test:mfa-rls` | 20 passed |
| `npx tsc --noEmit` | 通過（0 錯誤） |
| `npm run lint` | 通過（0 error） |
| `npm run build` | 通過（第一版測試完成後執行；第二版只改 SQL 與測試檔，未再重跑 build） |

## 驗收標準對照

| 驗收標準 | 結果 | 證據 |
|---|---|---|
| 拋棄式 Demo：`updateUser({ password })`、`updateUser({ email })`、`resetPasswordForEmail`、`mfa.enroll` 皆失敗，欄位不變 | 通過 | 測試「憑證變更被資料庫擋下」；被擋要求 HTTP 500，並讀回確認：原密碼仍可登入、新密碼不可、`email` 不變、無 `new_email`、無 `recovery_sent_at`、無 MFA factor |
| 同帳號：登入、token refresh、登出（local）成功 | 通過 | 測試「不受影響的操作」；另含 `user_metadata` 更新、admin `ban_duration` 設定與解除 |
| 對照組（非 Demo）上述操作皆成功 | 通過 | 測試「對照組」六項，含 `mfa.enroll` |
| 套用前後 `designer001` 的 `auth.users` 列一致，附比對輸出 | 通過 | 見下方「designer001 前後比對」；`pw_hash_md5` 一致，使用者本人回報登入正常 |
| 套用 `_down.sql` 後，Demo 操作恢復成功 | 通過 | off 模式 17 項；`_down` 內的 `leftover_*` 查詢輸出使用者未貼回，行為恢復為間接證據 |
| 非 Demo 帳號啟用 MFA、登入、登出不受影響 | 通過 | 對照組測試；`test:mfa-rls` 20 項 |
| `demo_revoke_sessions()`：1 個／0 個／2 個以上／anon／authenticated | 通過 | 4 項測試：anon、authenticated 皆 `42501`；0 個 → 失敗；1 個 → 回傳 2（兩個 session）、兩個 session 的 refresh 失效、對照組 session 不受影響、Demo 仍可重新登入；2 個 → 失敗且兩邊 session 仍有效 |
| 既有 `test:account`、`test:mfa-rls` 仍通過 | 通過 | 17／20 項 |

## 審查處理

三個子代理審查（架構、安全、測試）的處理：

**已修正**

- 緊急處置指引原本寫「套用 `_down.sql`」，但它會連 `demo_revoke_sessions()` 一起刪，而 `demo:disable` 依賴它。已改為只貼兩行 `drop trigger`（migration 檔頭、`_down.sql` 檔頭、架構筆記 D5、TASK-111）。
- 補 `notify pgrst, 'reload schema'`（兩個 migration）。
- `is_demo` 標記本身不可被改動（否則可先清標記、再改密碼，分兩步繞過）。
- `reauthentication_token` 加入鎖定清單（避免灌爆作者信箱與寄信額度）。
- 測試：「2 個以上」案例期望值改為 `preexisting + 2`（TASK-099 之後不會變紅）；被擋要求 HTTP 500（排除 4xx、網路錯誤誤判）；錯誤前綴檢查擴到改 Email 與重設密碼；`loginWorks` 只在 `invalid_credentials` 才算不可登入；清除遇錯不再中止其餘；新增 `is_demo` 標記與 `reauthenticate` 兩案例；檔頭註明限流（勿 5 分鐘內連跑）。

**待你確認（需要決定，尚未處理）**

1. **Dashboard 設定（使用者已確認，2026-10-30）：Sign In / Providers 只啟用 Email，Allow manual linking 關閉。** 因此 `linkIdentity()` 目前無法綁定外部帳號；日後若啟用任何提供者或 manual linking，須重新評估 `auth.identities`（需要加觸發器）。原問題： Authentication → Manual Linking 必須關閉、且不啟用任何 OAuth／SSO 提供者。否則訪客可 `linkIdentity()` 把外部帳號綁到 Demo 帳戶，`auth.identities` 不在本卡的鎖內。**我無法從程式碼確認，需要你看過後回報。**
2. **`to_jsonb` 比對的取捨：** 已決定（使用者，2026-10-30）**維持現狀**，不改成 fail-closed。缺欄位時鎖會靜默變弱（套用時自我檢查只證明「套用當下」欄位都在），列為殘留風險，靠 TASK-109 的還原後健康檢查探測補強。

**殘留風險與交給後續卡片**

- `auth.identities` 路徑（見上，取決於 Dashboard 設定）。
- `raw_user_meta_data` 無大小上限：訪客可寫入大量資料進 JWT／cookie，使後續登入失敗；每日還原不動 `auth.users`（TASK-109 可考慮把它重設回 seed）。
- 撤銷 session 只讓 refresh token 失效，已發出的 access token 到期前（預設 1 小時）對 REST／Storage 仍有效；`demo:disable` 先刪 `admins` 列所以即時，每日還原殘留最多約 1 小時（TASK-109、TASK-111 手冊）。
- 鎖若因 Auth 升級靜默失效無人知曉：建議 TASK-109 的還原後健康檢查加不破壞的探測（用 Demo session 嘗試改密碼，預期 500）。
- `demo:disable` 的撤銷步驟 raise 時不應中斷後面的 ban，或順序改為先 ban 再撤銷（TASK-111）。
- 真實 Demo 帳戶存在後：本卡測試的「0 個」「剛好 1 個」案例會自動略過（不碰真實帳戶）；TASK-111 以拋棄式 Demo 實測 `demo:disable` 會因筆數為 2 而必定失敗，需改寫測試方式。
- 測試期間正式庫暫時多出 1–2 個 `is_demo` 帳號：若遇每日還原排程，`demo_revoke_sessions`／還原函式會因筆數不是 1 而失敗（安全方向）。手冊註明不要在排程時段（約台北 03:00）跑 `test:demo-lock`。
- `is_demo` 判斷：資料庫用 `->> 'is_demo' = 'true'`（字串也命中），應用程式只認布林；只有 service_role 能寫，影響小。
- 未實測：`phone`、`phone_change`、`email_change_token_current`、`signInWithOtp` 的鎖定（皆在清單內；`phone_change` 與用戶端 `updateUser({ phone })` 在 TASK-098 就未實測）。
- 從 SQL Editor 輪換 Demo 密碼時，須用 `crypt(pw, gen_salt('bf', 10))`，並立刻實測 Demo 登入（手冊，TASK-099／111）。
- 本證明針對「目前」專案與 Auth 版本；Auth 升級後行為可能改變（手冊：登入全面回 500 時先貼兩行 `drop trigger`）。

## designer001 前後比對

`designer001`（id `c70e38fb-0315-46f8-934e-242cef48278f`）。「前」沿用 TASK-098 結束時的值；「後」是第二版 0021 重新套用後、使用者本人登入後的查詢輸出（使用者貼回）：

| | pw_hash_md5 | updated_at | last_sign_in_at |
|---|---|---|---|
| 前（TASK-098 步驟 8 後） | 8874451a96330d231bc13949730dcfd5 | 2026-10-30 13:37:20.518711+00 | 2026-10-30 13:37:20.501816+00 |
| 後（0021 第二版套用後） | 8874451a96330d231bc13949730dcfd5 | 2026-10-30 14:14:37.210642+00 | 2026-10-30 14:14:37.208109+00 |

密碼雜湊一致。`updated_at`／`last_sign_in_at` 的差異來自使用者本人 14:14:37 的登入（兩者只差 2 毫秒），是預期行為。限制：這是第二版套用後的單點輸出；第一版套用後使用者只回報登入正常，沒有貼查詢輸出。

## 後續任務

- **TASK-099**：建立 Demo 帳戶；手冊寫明輪換密碼只能走 SQL Editor、雜湊用 bcrypt。
- **TASK-109／111**：見「殘留風險與交給後續卡片」。
