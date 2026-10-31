# 架構筆記：Demo 體驗帳戶

- 上層規格：[`feature-spec.md`](feature-spec.md)（人工已核准，2026-10-30）
- 畫面規格與決策：`screen-spec-*.md`、`mockup-decision-*.md`（三個畫面皆已選定）
- 風險等級：**高**。需要架構、安全性、測試三方審查，高風險任務卡須人工核准後才可動工。
- 狀態：**已依架構與安全性審查修訂（v2），待人工核准**。審查意見是子代理的意見，不等同人工核准；處置見第 11 節。
- 分支：`feat/demo-account`

## 1. 要解決的架構問題

1. 讓任何訪客一鍵取得「Demo 管理員」session，卻不能因此改密碼、改 Email、啟用 MFA，也不能把別人鎖在外面。
2. 在**同一個正式 Supabase 專案**內，定期把業務資料與 Storage 圖片整批還原成 seed 快照，且不能弄壞 `designer001` 的登入、個人資料與頭像。
3. 兩者都會碰到正式環境（`auth` schema 觸發器、整表覆寫、公開寫入面），要有可驗證、可回滾、**可緊急關閉**的做法。

## 2. 既有模式與可重用的東西

| 項目 | 位置 | 這個 Epic 怎麼用 |
|---|---|---|
| 登入守衛（縱深防禦） | `proxy.ts`、`lib/supabase/middleware.ts`、`app/admin/layout.tsx`、`app/login/page.tsx` | 不改邏輯。Demo 帳戶是一般 `admins` 成員，走同一套守衛。`layout.tsx` 已在伺服器端取得 `user`，是讀 `app_metadata.is_demo` 的位置。 |
| 後台個人資料 context | `app/admin/_components/AdminProfileContext.tsx` | 新增 `isDemo` 欄位。 |
| 後台外殼 | `app/admin/_components/AdminShell.tsx`（`main` 內渲染 `children`） | 橫幅與說明視窗放在 `main` 頂端，不改 `Sidebar`。 |
| 登出按鈕 | `app/admin/logout-button.tsx`（目前 `signOut()` 預設 **global**） | Demo 時改 `scope: "local"`，否則任何一位面試官登出會踢掉所有人。 |
| 帳號設定頁 | `AccountSettingsView.tsx`、`lib/admin/account.ts` | 三張卡片在 `isDemo` 時停用；`account.ts` 不改。 |
| service role client | `lib/supabase/service-role.ts`（`server-only`） | 還原編排與腳本使用。 |
| 排程端點模式 | `app/api/cron/appointment-reminders/route.ts`、`lib/webhooks/verify-secret.ts`、`vercel.json` | 還原端點照抄：GET、Bearer `CRON_SECRET`、失敗回 500、`maxDuration`、時間預算。 |
| 一次性腳本模式 | `scripts/seed-designer-account.mjs`、`seed-booking-data.mjs` | 腳本照抄：冪等、密碼不印出、`--env-file=.env.local`。 |
| migration 慣例 | `supabase/migrations/00NN_*.sql` 與 `_down.sql` | 全部遵守：`revoke all` 再逐一 `grant`、依賴檢查 `do $$`、`notify pgrst`、檔頭寫明套用順序與回滾；編號**以動工當時的最大編號為準**，不預先寫死。 |
| 稽核表 | `0019_audit_log.sql`：service_role 有 select、delete；`actor_id` 預設 `auth.uid()` | 還原只刪 Demo 帳戶產生的紀錄。 |
| Storage | `store-assets`、`admin-assets`（路徑 `avatar/<uuid>.<ext>`，不分使用者）、`designer-assets` | 見 D8、D11：admin-assets 的 update／delete policy 目前只檢查 `is_admin()`，不看擁有者。 |
| 部署 | `vercel.json`：`deploymentEnabled: { "**": false, "master": true }` | **只有 master 會部署，Vercel Cron 只在 production 執行**；見 D10。 |

## 3. 設計決定

### D1 Demo 識別：`app_metadata.is_demo = true`

- 由 service_role 的 `admin.createUser({ app_metadata: { is_demo: true } })` 設定。`app_metadata` 使用者本人無法修改（`user_metadata` 才可以），不能用 `user_metadata`，也不能用 Email 字串比對。
- 伺服器端：`user.app_metadata?.is_demo === true`（`isDemoUser(user)`）。資料庫端：`auth.users.raw_app_meta_data ->> 'is_demo' = 'true'`；RLS policy 或 Storage policy 可用 JWT 內的 `auth.jwt() -> 'app_metadata' ->> 'is_demo'`，不必碰 `auth` schema。
- 讀不到時一律視為「非 Demo」。**真正的鎖由資料庫保證**，前端判斷只是提示。
- **資料庫函式不得信任呼叫端傳入的「Demo 使用者 id」**：需要 Demo 使用者時，函式自己查 `is_demo` 的帳戶，筆數不是剛好 1 就 `raise exception`；payload 若帶 id，必須與查到的相同（見 D7）。

### D2 設定與開關（`lib/demo/config.ts`，`server-only`）

| 環境變數 | 用途 | 備註 |
|---|---|---|
| `DEMO_ENABLED` | 入口與一鍵進入端點總開關，`"true"` 才啟用 | **Vercel 環境變數改動後必須 Redeploy 才會生效**；緊急關閉手冊要寫「改變數＋Redeploy」，並搭配 `demo:disable`（見 D12） |
| `DEMO_EMAIL` | Demo 帳戶 Email | 不得等於 `DESIGNER_EMAIL`。**這個 Email 會顯示在帳號設定頁（`layout.tsx` 把 `user.email` 傳給前端），所以它是公開的**；必須是作者自己控制的信箱，避免觸發器失效時重設信寄到第三方 |
| `DEMO_PASSWORD` | Demo 密碼 | 長隨機值（≥ 32 字元），只放伺服器環境，**不加 `NEXT_PUBLIC_`** |
| `DEMO_RATE_LIMIT_SECRET` | 一鍵進入限流的 IP 雜湊金鑰（HMAC） | 長隨機值，與其他密鑰不同 |
| `DEMO_RESET_ENABLED` | **排程**還原總開關，`"true"` 才讓 cron 真的動資料 | **預設關**。手動真實還原不受此旗標約束，但需密鑰與明確確認參數（見 D9） |

- 入口是否顯示由 `app/login/page.tsx`（伺服器元件）判斷 `isDemoEntryEnabled()` 後以 prop 傳給 `LoginForm`；關閉時登入頁與現況一致。
- `DEMO_RESET_LABEL`（還原時間文案）放在**不含 `server-only` 的 `lib/demo/notice-copy.ts`**，因為前端元件要匯入；其與 `vercel.json` cron 的一致性測試只放在 TASK-110。
- 若正式環境沒有設定 `DESIGNER_EMAIL`，`getDemoConfig` 的 Email 比對等於沒有作用；**`is_demo` 驗證仍是主要防線**，可接受，但手冊要寫明。

### D3 一鍵進入端點：`POST /api/demo/enter`（Route Handler）

處理流程（任一步失敗都回同一個泛用錯誤，不洩漏原因）：

1. `getDemoConfig()` 為 `null` → 失敗。
2. 只接受 `POST`，**忽略 body 與 query**。
3. 同源檢查：`Origin` 必須與 `NEXT_PUBLIC_SITE_URL` 或請求 host 同源；缺 `Origin` 視為失敗。
4. 限流（D4）；**限流 RPC 出錯時拒絕進入**，不放行。
5. **用自訂 cookie adapter 暫存 Supabase 寫出的 cookie，不直接寫入回應**。呼叫 `signInWithPassword`。
6. 驗證 `data.user.app_metadata.is_demo === true`，且 `getAuthenticatorAssuranceLevel()` 的 `nextLevel !== "aal2"`。
7. **兩項都通過才把暫存的 cookie 寫進回應**。任何失敗路徑（包含例外）都明確讓 `sb-*` cookie 過期，**不依賴 `signOut()` 是否成功**；`signOut({ scope: "local" })` 只是額外的清理。
8. 回應加 `Cache-Control: no-store`；成功回 `200 { ok: true }`。

**為什麼不是「先寫 cookie、再撤銷」：** `createClient()` 在 `signInWithPassword` 成功時就會把 session cookie 寫進回應。若 `DEMO_EMAIL` 被誤設成真實管理員，而 `signOut` 剛好失敗，回應仍帶著管理員 session。改成「驗證通過才寫入」後，失敗路徑天生不帶 cookie。

不寫入 log 的內容：Email、密碼、token。失敗只記類別（`config_missing`、`cross_origin`、`rate_limited`、`sign_in_failed`、`not_demo`、`aal2`）。

### D4 限流：Postgres 固定時間窗（獨立卡，可降級）

Supabase Auth 自己的登入限流以呼叫端 IP 計算，而呼叫端是 Vercel 伺服器，所有訪客與**還原的健康檢查**共用同一份額度，所以不能替代每位訪客的限流。

- 表 `demo_entry_attempts(bucket text, window_start timestamptz, count int)` 與 RPC `demo_entry_check(p_bucket text, p_limit int, p_window_seconds int) returns boolean`，僅 service_role 可執行；過期列順手清除。
- **bucket 用 `HMAC-SHA256(DEMO_RATE_LIMIT_SECRET, ip)`**（不是 `sha256(ip + 日期)`：鹽不是祕密，IPv4 空間很小，可被暴力還原）。IPv6 以 /64 為單位。
- 取 IP：Vercel 的 `x-real-ip`（或 `@vercel/functions` 的 `ipAddress()`）；取不到時只套全站上限。
- 建議值：每 IP 每 10 分鐘 10 次；全站每小時的上限**必須低於 Supabase Dashboard 上實際的登入限額**（避免耗盡後連健康檢查也失敗）。**全站上限本身是阻斷服務的槓桿**（攻擊者用少量 IP 就能讓所有面試官進不來）：接受這點，或把全站上限改為只告警；實作時依使用者決定。
- 若使用者決定不做限流，TASK-102 整張移除，端點略過這一步；代價見第 8 節。

### D5 帳號安全鎖：三層

| 層 | 做法 | 能擋誰 | 限制 |
|---|---|---|---|
| 1 前端 | `isDemo` 時帳號設定頁三張卡片停用，標題旁「🔒 體驗帳號不開放」 | 一般操作 | 繞過前端就失效 |
| 2 資料庫觸發器（**待實驗驗證**） | `auth.users` BEFORE UPDATE、`auth.mfa_factors` BEFORE INSERT，僅對 `is_demo` 的列生效 | 直接呼叫 Supabase Auth API 的人 | 依賴實驗結果 |
| 3 還原與健康檢查 | 還原時用 admin API 刪除 Demo 的 MFA factor、撤銷 Demo 的 session；一鍵進入端點檢查 aal；還原後檢查 Demo 能登入並回報（**只檢查回報，不自動改密碼或 Email**） | 層 2 失效時的損害 | 事後補救 |

**觸發器的寫法限制（TASK-100，細節依 TASK-098 實驗結果調整）：**

- **觸發器函式必須是 `SECURITY INVOKER`**。若照專案慣例寫成 `SECURITY DEFINER`，函式內的 `current_user` 永遠是擁有者（`postgres`），`= 'supabase_auth_admin'` 的判斷永遠不成立，鎖等於沒做。
- `auth.users` 的觸發器**用 `WHEN (OLD.raw_app_meta_data ->> 'is_demo' = 'true')` 限定**，其他帳號（含 `designer001`）的登入根本不會進到函式；函式本身第一行 `if current_user <> 'supabase_auth_admin' then return new;`，且不得有任何可能在非預期情況下丟例外的邏輯。登入會更新 `last_sign_in_at`，觸發器一出錯，所有人都無法登入。
- 鎖定欄位（`current_user = 'supabase_auth_admin'` 且任一改變就 `raise exception`）：`encrypted_password`、`email`、`email_change`、`email_change_token_new`、`email_change_token_current`、`recovery_token`、`phone`、`phone_change`。
- `auth.mfa_factors` BEFORE INSERT：WHEN 不得用子查詢，函式精簡（查 `auth.users` 該 `user_id` 是否 `is_demo`）；**必須測試非 Demo 帳號啟用 MFA 的路徑不受影響**。
- **為什麼用 `current_user`：** GoTrue 呼叫資料庫時沒有使用者 JWT，`auth.uid()` 在觸發器內是 null。`SQL Editor`（`postgres`）與維護者的 `SECURITY DEFINER` 函式不受限，這是**維修通道**。
- **admin API（service_role）改 Demo 帳號也經過 GoTrue，角色一樣是 `supabase_auth_admin`，也會被擋。** 輪換 Demo 密碼、修復帳號只能走 SQL Editor；TASK-099、TASK-111 的手冊要寫清楚。
- 動工前準備好「緊急 `drop trigger`」的 SQL；套用後立刻實測 `designer001` 登入；手冊寫明「Auth 平台升級後若登入全面回 500，第一步只貼 migration 檔頭的兩行 `drop trigger` 移除觸發器（**不要用 `_down.sql`**：它會連 `demo_revoke_sessions()` 一起刪掉，而 `demo:disable` 依賴它）」。
- **未知事項（TASK-098 要回答）：** (a) 託管 Supabase 是否允許在 `auth.users`／`auth.mfa_factors` 建立觸發器；(b) GoTrue 連線角色是否確為 `supabase_auth_admin`；(c) 登入、refresh、登出是否都不誤觸發；(d) `updateUser({ email })` 實際寫入哪些欄位；(e) 密碼重設寫入哪些欄位；(f) 觸發器例外在客戶端看到的錯誤碼與文字；(g) `postgres` 能否 `delete from auth.sessions`（撤銷 session RPC 需要）。
- **若實驗失敗：** 層 2 改為文件化的殘留風險，並請使用者重新確認可否接受。

**忘記密碼：** Demo 的 Email 會顯示在帳號設定頁，**並非祕密**。資料庫觸發器擋下 `recovery_token` 的寫入，Auth 回錯誤，登入頁顯示既有通用錯誤文案，信不會寄出。若層 2 失敗，信會寄到 `DEMO_EMAIL`（所以它必須是作者控制的信箱）。

### D6 說明視窗與橫幅的前端旗標

- `sessionStorage` 兩個鍵：`demo-welcome-pending`、`demo-banner-dismissed`。登入頁在一鍵進入成功、導向前設前者並移除後者。`DemoNotice` 掛載時讀取；`sessionStorage` 讀寫全包 `try/catch`，不可用時每次都顯示。
- 視窗與「了解更多」是同一個元件與同一份文案（`lib/demo/notice-copy.ts`）。
- **Demo 登入時登出按鈕改用 `signOut({ scope: "local" })`**（TASK-105）。有人從 console 直接呼叫 global 登出，列為殘留風險。

### D7 還原：整體流程與「失敗時不留下半套」

```text
[1 同步圖片] 比對 → 補齊／覆寫 seed 圖片到公開 bucket 的固定路徑（只新增與覆寫，不刪）
[2 交易]     reset_demo_data(payload, dry_run)：單一交易整表覆寫，失敗全部回滾
[3 清理]     刪除不再被引用的孤兒物件（見 D8 的安全規則）
[4 帳戶]     用 admin API 刪除 Demo 的 MFA factor；呼叫 demo_revoke_sessions() 撤銷 Demo 的 session
[5 檢查]     用獨立 anon client 驗證 Demo 帳戶可登入、is_demo、無 MFA；回報，不修復
```

- **順序的好處：** 步驟 1 只新增與覆寫，若步驟 2 失敗，舊資料仍指向舊檔案；步驟 3 只在步驟 2 成功後執行。
- **步驟 1 不能用「copy 已存在則覆寫」：** Storage `copy()` 不帶 `x-upsert`，目的地已存在會失敗（實作時以實測確認）。改為：用唯讀 RPC 列出目的 bucket 與 `demo-seed` 的物件（名稱、大小、eTag）→ 只補缺少的檔；內容不同的先 `remove` 再 `copy`；平常是 0 次 copy，第一次或差異大時用有限並行（一次 5 個）。**dry-run 也要唯讀檢查來源檔是否齊全**，缺圖在真實還原前就被發現。
- **seed 資料來源：** `lib/demo/seed-data.ts` 以程式產生：**設計師、服務、作品集的 id 與 `storage_path` 沿用 `seed-base.json` 裡的固定值**（作品集路徑格式檢查綁了 `designer_id`，id 變了路徑對不上）；只有預約與顧客以 uuid v5 產生，日期以執行當下為基準相對計算。設計師列帶**明確的 `created_at`**（「預設設計師」以 `order by created_at, id` 辨識，不能因還原而改變順序）。預約不帶 `access_token`，讓資料庫預設值產生。
- **seed 圖片來源：** 私有 bucket `demo-seed`，路徑為 `demo-seed/<bucket>/<原路徑>`；預設用 `--from-public` 從目前公開 bucket 匯入（使用者作品集已補齊）。
- **還原順序（FK）：** `appointments` 的 `service_id`／`designer_id`／`customer_id` 都沒有 `on delete`，先刪 `appointments`；`designers` 刪除 cascade 到三張子表；`store_settings`、`booking_policy` 用 `insert … on conflict (id) do update`（萬一那列被誤刪也能收斂）；`business_hours` 要求 payload 剛好 7 列；`closed_dates` 整表覆寫；`customers` 在 `appointments` 之後。
- **觸發器互動：** `appointments_notify_*` 的 WHEN 條件是 `customer_email is not null`，**函式內再守一道：payload 預約的 `customer_email` 必須全為 null，否則 `raise exception`**；刪除不觸發這些觸發器；`appointments_set_price_snapshot` 是 BEFORE INSERT 從 `services` 取價，所以服務先寫；`designer_portfolio_images_limit` 限制每位 12 張。
- **`reset_demo_data(p_payload jsonb, p_dry_run boolean)` 的安全邊界：** `SECURITY DEFINER`、`set search_path = ''`、`revoke execute from public, anon, authenticated`、只 `grant execute to service_role`；**`p_dry_run` 不給預設值，呼叫端必須明確傳入**；`confirm = 'RESET_DEMO'` 加上**各必要陣列的最低筆數**（避免程式 bug 送空陣列清空整張表；`confirm` 字串是程式自己帶的，擋不住這點）；`pg_advisory_xact_lock` 避免排程與手動同時執行；`set local lock_timeout = '5s'` 再 `lock table appointments`；`do $$` 依賴檢查（比照 0018／0020）。
- **函式自己決定 Demo 使用者：** 查 `is_demo` 帳戶，筆數不是剛好 1 就 `raise`；刪 `audit_log`、更新 `admins` 都用這個 id，payload 的 id 只作交叉檢查。
- **dry-run：** 完整執行後在內層 `BEGIN … EXCEPTION` 區塊以自訂 SQLSTATE 回滾子交易，只攔截該 SQLSTATE（其他真實錯誤一律重新拋出），筆數變數宣告在外層；回傳各表會寫入與刪除的筆數。整合測試只用 dry-run，**絕不對正式庫執行真實還原**。
- **reset 函式不碰 `auth` schema：** MFA factor 由 TS 端的 admin API 刪除；session 撤銷走獨立的 `demo_revoke_sessions()`（D5 的 migration）。
- **referenced_paths 在 TS 端算：** 取 payload 的路徑加上查 `admins` 目前的頭像網址，RPC 只回傳筆數；另有唯讀 `SECURITY DEFINER` RPC `demo_list_storage_objects(p_bucket text)`（service_role 專用，回傳名稱、大小、eTag、created_at）供步驟 1 與步驟 3 使用，不逐層呼叫 `list()`（`designer-assets` 有兩層資料夾，`list()` 不遞迴）。

### D8 還原範圍與「不動」清單

| 項目 | 處理 |
|---|---|
| `services`、`designers`、`designer_services`、`designer_leaves`、`designer_portfolio_images`、`business_hours`、`closed_dates`、`booking_policy`、`store_settings`、`appointments`、`customers` | 整表還原成 seed |
| `audit_log` | 只刪 `actor_id` = Demo 帳戶的列；`designer001` 的紀錄保留。他的舊紀錄可能指向已被刪除的資料，稽核列表不得依賴對應資料存在（TASK-109 驗證） |
| `admins` | 只還原 Demo 那一列的 `display_name`／`avatar_url`；**不動 `designer001` 的登記與個人資料** |
| `auth.users` | 不動 `designer001`；Demo 帳戶只在人工修復時才改 |
| `auth.mfa_factors`、`auth.sessions` | 刪除／撤銷 Demo 帳戶的（admin API 與 `demo_revoke_sessions()`） |
| `store-assets`、`designer-assets` | 還原後只保留被 seed 資料引用的物件；只刪 `created_at` 早於還原開始時間的孤兒（避免刪到剛上傳、已被引用的圖） |
| `admin-assets` | **只刪 `owner_id` 等於 Demo 帳戶的孤兒**；任何 `admins` 仍引用的物件、以及 `owner_id` 不是 Demo 的物件一律不碰；**任何被引用的網址解析失敗時，跳過整個 bucket 的清理**（解析失敗寧可不刪）。這同時取代先前「依路徑辨識擁有者」的說法（`storage.objects.owner_id` 會記錄上傳者，需在 TASK-113 實測確認欄位） |
| `demo-seed` | 清理邏輯寫死 bucket 白名單，**絕不碰 `demo-seed`** |

### D9 排程與手動還原

- `GET /api/cron/demo-reset`，`vercel.json` 加第二個 cron：`0 19 * * *`（UTC，台北 03:00；Hobby 只保證在該小時內觸發，畫面文案已由使用者定為「每日凌晨 3 點左右還原」，2026-10-30）。
- 驗證：`verifyBearerSecret(req.headers.get("authorization"), process.env.CRON_SECRET)`。
- **旗標與手動路徑（修正先前會互相卡死的設計）：** `DEMO_RESET_ENABLED` 只管**排程**自動觸發。手動真實還原帶 `?confirm=RESET_DEMO`（加上 `Bearer CRON_SECRET`）即可執行，不受 `DEMO_RESET_ENABLED` 約束；`?dry_run=1` 只做 dry-run。判斷方式：排程呼叫（無 `confirm`／`dry_run`）→ 看旗標；有 `dry_run=1` → 只 dry-run；有 `confirm` → 真實還原。這樣首次真實還原可以在旗標關閉時由人工執行，驗證成功後才開旗標。
- `maxDuration = 60`，時間預算沿用提醒信排程做法；中止點只能在步驟 1 與步驟 3（交易不可中斷）。
- **已核對（2026-10-31，TASK-110）：** Vercel 文件（cron-jobs/usage-and-pricing，2026-07-15 更新）：Hobby 每專案最多 100 個排程、每日最多一次、精度為「該小時內」（±59 分）。第二個每日排程可行，不需合併。`0 19 * * *` 會在 UTC 19:00–19:59（台北 03:00–03:59）觸發，與文案「每日凌晨 3 點左右」相符。
- **排程模式必須完全不帶 query（TASK-110 安全審查）：** 只認 `dry_run`、`confirm` 兩個名稱，其他名稱（含打錯字的 `?dryrun=1`）回 400，避免手動打錯被當成排程、旗標開啟後變成真實還原。

### D10 部署與 migration 順序（**暗啟動**）

只有一個 Supabase，git 分支隔離不了資料庫；而且 **`vercel.json` 只有 master 會部署，Cron 只在 production 執行**，所以「先部署、驗證、再合併」做不到。改用暗啟動：

1. 本 Epic 的 migration 全部是**加法**（新表、新函式、新觸發器、新 bucket、新 Storage policy），不改既有物件；觸發器只對 `is_demo` 帳戶生效。
2. 順序：先套用 migration → **先合併到 master，`DEMO_ENABLED` 與 `DEMO_RESET_ENABLED` 皆保持關閉** → 正式部署（Vercel 環境變數改動需 Redeploy）→ 建立 Demo 帳戶、上傳圖片 → 手動 dry-run → **（先備份，使用者同意）手動真實還原一次** → 驗證 → 開 `DEMO_ENABLED` 並 Redeploy → 最後才開 `DEMO_RESET_ENABLED` 並 Redeploy。
3. **備份：** 整表覆寫的資料無法由 `_down.sql` 復原。使用者確認 Supabase 為 Free Plan，**沒有專案備份**，所以改用自建備份（D15、TASK-117）：真實還原前必須先備份並確認備份檔可讀，才可執行（TASK-112）。
4. TASK-098 的實驗會暫時在正式 Supabase 建觸發器，結束必須 drop 並附驗證輸出。
5. 合併到 master 的前提：所有高風險卡已核准、`DEMO_ENABLED=false` 時登入頁與現況逐字一致（測試證明）。

### D11 Storage 擁有者限制與 Demo 上傳上限（新增 TASK-113）

- `admin-assets` 的 update／delete policy 目前只檢查 `is_admin()`，**Demo 能刪掉或換掉 `designer001` 的頭像**，且還原刻意不動 `designer001`，成為永久的跨使用者影響。
- 新 migration 對 `storage.objects` 新增 **RESTRICTIVE** policy（只新增、不改既有 policy）：`admin-assets` 的 update／delete 必須 `owner_id = auth.uid()::text`。
- 對 Demo（以 JWT 的 `app_metadata.is_demo` 判斷，不碰 `auth` schema）在三個公開 bucket 的 insert 加上**每帳戶物件數上限**（暫定 30，依 `owner_id` 計數；還原會清除 Demo 的孤兒，所以每日重置），避免大量 5MB 上傳灌爆免費方案的 Storage 配額、影響整個正式專案。
- **未知事項：** `storage.objects.owner_id` 欄位在目前專案的 Supabase 版本是否存在（repo 內目前沒有任何 migration 使用它，需實測）；RESTRICTIVE policy 在 SQL Editor 的建立權限（既有 migration 已有建立 `storage.objects` policy 的先例）。

### D12 緊急關閉：`demo:disable`／`demo:enable`（TASK-111）

關閉 `DEMO_ENABLED` 只擋**新的進入**；已發出的 session 與 refresh token 仍有效，持有者仍能用 REST 與 Storage 行使 `is_admin()` 的全部權限。因此提供：

- `demo:disable`：刪除 Demo 的 `admins` 列（`is_admin()` 每次請求重新判斷，**立即全面失效**）→ 呼叫 `demo_revoke_sessions()` 撤銷 session → 以 admin API 設定 `ban_duration`（`banned_until` 不在鎖定欄位內）。
- `demo:enable`：反向（重新登記 `admins`、解除封鎖）。
- 手冊寫明兩種情境與完整步驟；每日還原也會撤銷 Demo 的 session，使單一濫用者最多持續 24 小時。

### D13 Demo 發動的改期／取消不寄信，並以說明視窗示意（使用者決定，TASK-114、TASK-115）

- 使用者選擇方案 A：新 migration 以 `create or replace` 改寫 `notify_appointment_update()`，在函式開頭加一道守門：`coalesce(auth.jwt() -> 'app_metadata' ->> 'is_demo', '') = 'true'` 時 `return new`，不呼叫 `net.http_post`。**其餘本文逐字沿用 `0012`**，觸發器本身與 `when` 條件不動。`_down.sql` 還原成 `0012` 的原函式本文。
- 只擋 UPDATE（改期／取消）；`notify_appointment_insert`（預約確認信）**不動**，面試官自己預約的確認信照寄。cron 與 service role 沒有 JWT，不受影響。
- **未知事項（TASK-114 實測）：** 在 `security definer`、`search_path = ''` 的觸發器函式內，`auth.jwt()` 是否讀得到發動 UPDATE 的請求 JWT（它讀 `request.jwt.claims` 設定值，理論上可行）；以拋棄式帳號實測，並用 `net._http_response`／請求佇列確認「Demo 改期零請求、非 Demo 改期照常有請求」。
- **前端（TASK-115）：** Demo 登入時，按下改期與取消的**最終確認**後先跳出說明視窗：顯示「顧客會收到的通知信」示意圖與一句說明（「正式環境會寄這封信，體驗帳號不會真的寄出」），按下確認後照常執行。一般管理員完全不變。視窗內容以圖片為主；需先出畫面規格與 mockup 給使用者確認。
- 殘留：`reminder_sent_at` 可被清成 null 造成提醒信重寄，頻率受每日排程限制，維持列為殘留風險。

### D14 Demo 專屬資料筆數上限（使用者決定做完整一套，TASK-116）

- 設計師最多 5 位（使用者指定）。其他表（服務、預約、顧客、公休日、作品集、請假）的上限在 TASK-106 產出 seed 後，依 seed 數量的約 2～3 倍列表給使用者核准，不先猜數字。
- 做法：對各表加 `BEFORE INSERT` 觸發器，**只在 JWT 的 `is_demo` 為真時**檢查該表目前列數，達上限就 `raise exception`；一般管理員與 service role（含還原）不受影響。上限是軟上限（並行時可能略超），可接受。
- 目的：避免單一 Demo session 以腳本灌爆免費方案的資料庫容量，拖垮整個正式專案。與 TASK-113（Storage 擁有者與上傳上限）互補。

### D15 備份策略（Free Plan 沒有專案備份，TASK-117）

- 使用者確認：Free Plan 不含專案備份（Pro 才有最多 7 天排程備份）。因此**真實還原前必須先自建備份**。
- `scripts/backup-demo-tables.mjs`：以 service role 唯讀匯出會被覆寫的表（`services`、`designers` 及三張子表、`business_hours`、`closed_dates`、`booking_policy`、`store_settings`、`appointments`、`customers`、`audit_log`、`admins`）為 JSON，並下載三個公開 bucket 的物件；輸出到本機 `backups/`（加入 `.gitignore`，因含顧客資料，絕不進 git）；附筆數與雜湊清單供核對。
- **更正我先前對你說的話：** 我說過「備份格式和 seed 一樣，還原備份就是把它當 seed 再跑一次」。那不完全正確：`reset_demo_data` 為了不寄信，**拒絕任何 `customer_email` 非 null 的預約**，所以含真實 Email 的備份不能用它還原。備份的還原改走另一條手動路徑：腳本同時產生依外鍵順序的 `restore.sql`，在 SQL Editor 以 `postgres` 角色於單一交易內執行，並暫停寄信觸發器（`session_replication_role = replica` 是否可用需實測，列為 TASK-117 的未知事項）。這是最後手段，不是日常工具。
- 備份必須在 TASK-112 的真實還原**之前**完成並由使用者確認；備份檔有效期間（還原成功並驗證後多久可刪）由使用者決定。

## 4. 資料與 API 契約

### `POST /api/demo/enter`

- 輸入：無（忽略 body 與 query）。需 `Origin` 同源。
- 成功：`200 { "ok": true }`＋`Set-Cookie`（Supabase session）＋`Cache-Control: no-store`。
- 失敗：`{ "ok": false }`，不帶原因，**不帶任何 session cookie**。登入頁一律顯示「目前無法進入體驗帳號，請稍後再試。」

### `reset_demo_data(p_payload jsonb, p_dry_run boolean) returns jsonb`

- 輸入：`{ confirm: "RESET_DEMO", demo_user_id（選填，交叉檢查用）, services[], designers[], designer_services[], designer_leaves[], portfolio_images[], business_hours[7], closed_dates[], booking_policy, store_settings, customers[], appointments[], demo_admin_profile }`。
- 輸出：`{ counts: { <table>: n }, dry_run: boolean }`。
- 錯誤：缺 `confirm`、必要鍵或最低筆數、`is_demo` 帳戶不是剛好 1 個、預約含非 null 的 `customer_email`、任何 constraint 違反 → 例外，整個交易回滾。

### 其他函式與端點

| 名稱 | 說明 |
|---|---|
| `demo_list_storage_objects(p_bucket text)` | 唯讀，service_role 專用，回傳名稱、大小、eTag、created_at |
| `demo_revoke_sessions()` | 自己查 `is_demo` 帳戶（剛好 1 個），刪除其 `auth.sessions`；service_role 專用 |
| `GET /api/cron/demo-reset` | Bearer `CRON_SECRET`；`dry_run=1`、`confirm=RESET_DEMO`、無參數（排程）三種行為，見 D9 |

### 腳本

| 指令 | 用途 |
|---|---|
| `npm run seed:demo-account` | 建立／檢查 Demo 帳戶（冪等，不印密碼，**不改既有帳戶的密碼**） |
| `npm run demo:export-base` | **唯讀**：只匯出白名單表（服務、設計師與子表、營業時間、公休、預約規則、店家設定），**不匯出預約與顧客** |
| `npm run demo:upload-images` | `--from-public`：把 `seed-base.json` 引用的圖片複製到私有 `demo-seed` |
| `npm run demo:reset` | 手動還原。呼叫上述端點；預設 dry-run，真實還原需 `--yes`（送出 `confirm=RESET_DEMO`） |
| `npm run demo:disable` / `demo:enable` | 緊急關閉與恢復，見 D12 |

## 5. 受影響檔案（總覽，各卡片有精確清單）

- 新增：`lib/demo/`（`config.ts`、`notice-copy.ts`、`enter.ts`、`seed-types.ts`、`seed-base.json`、`seed-data.ts`、`reset.ts`、`rate-limit.ts`）、`app/api/demo/enter/route.ts`、`app/api/cron/demo-reset/route.ts`、`app/admin/_components/DemoNotice.tsx`、`scripts/`（`seed-demo-account.mjs`、`export-demo-base.mjs`、`upload-demo-images.mjs`、`reset-demo.mjs`、`disable-demo.mjs`）、`supabase/migrations/00NN_*.sql`（五支）、`docs/demo-account.md`、對應 `tests/`。
- 修改：`app/admin/layout.tsx`、`AdminProfileContext.tsx`、`AdminShell.tsx`、`AccountSettingsView.tsx`、`app/admin/logout-button.tsx`、`app/login/page.tsx`、`login-form.tsx`、`vercel.json`、`package.json`、`.env.example`、`README.md`、`ai/context/decisions.md`、`ai/context/project-map.md`。
- **不得觸碰：** `lib/supabase/middleware.ts`、`proxy.ts` 的守衛邏輯、`lib/admin/account.ts`、既有 migration 檔案、`Sidebar.tsx`。

## 6. 測試策略與已知陷阱

- **整合測試不得對正式庫做真實還原。** 只用 `reset_demo_data(..., p_dry_run => true)`；掃描測試確保整合測試檔內沒有非 dry-run 的呼叫。真實還原只在使用者人工驗收時執行一次。
- 既有教訓：測試預約一律 `customer_email = null`；測試腳本不得對店長帳號做全域 `signOut()`（用 `scope: "local"`）；`vi.mock` 擋不住資料庫的 Database Webhook 觸發器。
- 觸發器測試只用**拋棄式帳號**（建立時帶 `is_demo`），不得用真正的 Demo 帳戶或 `designer001`。
- 一鍵進入的整合測試會建立真實 session：`scope: "local"` 登出；限流用獨立 bucket。
- 「不動 `designer001`」要以**比對雜湊或時間戳**驗證（`auth.users.encrypted_password` 與 `updated_at`、`admins` 該列、`audit_log` 其他列），不能只看「還能登入」。
- **回歸範圍（TASK-112）：** 還原會整表覆寫，而既有整合套件都對同一個正式庫跑，可能依賴現有資料。真實還原後必須重跑：`test`、`test:rls`、`test:booking`、`test:admin-booking`、`test:business-hours`、`test:store-settings`、`test:booking-policy`、`test:services`、`test:designers`、`test:account`、`test:mfa-rls`、`test:notifications`、`test:audit-log`、`test:reports`，以及本 Epic 新增的各套件。

## 7. 審查關卡

| 關卡 | 要求 |
|---|---|
| 架構 | 高風險卡（098、100、103、108、109、110、112、113）；重點：還原原子性、migration 加法性與回滾、觸發器範圍、暗啟動順序。 |
| 安全性 | 同上；重點：公開端點濫用、cookie 暫存、`is_demo` 驗證、同源、`is_admin()` 寫入面盤點（**TASK-103 上線前完成**）、service_role 還原函式授權、Storage 擁有者、密碼不外洩。 |
| 測試 | 同上；重點：不對正式庫真實還原、拋棄式帳號、`designer001` 不受影響的證據、回歸全套。 |
| 人工核准 | 高風險卡動工前人工核准；TASK-098 結果、首次真實還原、啟用 `DEMO_ENABLED` 與 `DEMO_RESET_ENABLED` 各需使用者明確同意。 |
| 子代理意見不等同人工核准。 | |

## 8. 殘留風險與待使用者決定的事

### 使用者決定結果（2026-10-30，第二輪）

| 項目 | 決定 | 落地 |
|---|---|---|
| 1 寄信濫用 | 選 A：Demo 發動的改期／取消不寄信，確認信照寄；按改期／取消後跳說明視窗示意通知信 | D13、TASK-114、TASK-115 |
| 2 資料量被灌爆 | 做完整一套筆數上限，設計師最多 5 位，其他表數字待 seed 後給使用者核准 | D14、TASK-116 |
| 3 前台被竄改 | 接受（最長約 24 小時） | 殘留風險，手冊註明立即手動還原流程 |
| 4 顧客資料互相可見 | 接受（使用者確認；正式庫現有資料都是使用者自己的測試資料） | 殘留風險 |
| 5 備份 | Free Plan 無備份，改自建備份 | D15、TASK-117 |
| 6 全站限流 | 保留，並設得低於 Supabase 的限額（使用者確認） | D4、TASK-102 |
| — 還原時間文案 | 「每日凌晨 3 點左右還原」 | 全部文案與常數 |
| — 規格書調整 | 使用者要求白話說明後，已回覆「可以」 | 本檔第 9 節 |
| — 單一串接卡 | 可以 | 第 10 節 |
| — Demo 帳號顯示名稱 | 「Demo帳號」 | TASK-099、TASK-106 |
| — Demo 登入 Email | `hair_demo@gmail.com`（使用者提供；原 `demo@gmail.com` 因可能屬他人而改掉） | TASK-099、`.env` 的 `DEMO_EMAIL` |

7. **`DEMO_EMAIL` 已定為 `hair_demo@gmail.com`**（須為使用者自己控制的信箱；它會顯示在帳號設定頁）。使用者補充：Demo 一律由登入頁「進入體驗帳號」直接進入，不會用到登入頁的「忘記密碼」；資料庫觸發器仍保留作為最後防線（有人在登入頁輸入此 Email 要求重設時，也改不了密碼）。

### 需要使用者明確決定（原始問題紀錄，已決定者見上表）

1. **寄信濫用（安全審查 M3，已核對屬實）。** 後台登入帳號可直接修改預約的 `status`、`start_at`、`end_at`、`reminder_sent_at`（`0015` 第 103 行）；預約有 Email 時，每次改開始或結束時間都會觸發寄信（`0012` 觸發器，無節流）；信件內的店名、電話、設計師名、服務名都可被 Demo 修改。攻擊者可先在前台用受害者 Email 預約（每個 Email 最多 3 筆），再用 Demo session 反覆改期，**以你的寄件網域對受害者發出內容可控的信，並耗盡 Resend 額度**。「同一 Email 最多 3 筆」只限制建立，擋不住這點。選項：
   - **A（建議）：** 新 migration 修改 `notify_appointment_update`：**修改者是 Demo 帳戶時不寄信**（函式內 `auth.uid()` 仍是呼叫者）。面試官自己預約的確認信照寄。這會修改一個既有函式（非純加法），風險高，需獨立卡與審查。
   - B：對每筆預約的改期／取消通知設每日節流。
   - C：恢復 `TASK-080` 原決定「Demo 環境關閉寄信」（與你本次的選擇相反）。
   - 即使選 A，`reminder_sent_at` 可被清成 null 造成提醒信重寄，頻率受每日排程限制（每筆預約最多每日一封），列為殘留。
2. **資料量與儲存配額被灌爆（安全審查 S2）。** 限流只管建立 session 的次數，單一 session 拿到 refresh token 後可無限次呼叫 REST：大量新增 `audit_log`（每筆最多約 8KB）、`services`、`closed_dates`，或往公開 bucket 上傳 5MB 檔案，可能在數小時內撞上免費方案的資料庫或 Storage 配額，**讓整個正式專案（含前台預約）停擺**。TASK-113 處理 Storage 這一半；**資料庫列數**暫不處理（逐表加觸發器成本高），靠監控、每日還原與 `demo:disable`。請決定是否接受。
3. **公開前台被竄改（S3）。** Demo 修改的店名、Logo、設計師作品集會直接出現在正式前台，最長到下次還原（約 24 小時）；Storage 的 MIME 限制只檢查用戶端宣告的類型，等於他人可把你的 Supabase 網域當圖片空間。請明確接受，並準備好「立即手動還原」流程（`demo:reset --yes`）。
4. **面試官輸入的顧客資料會被下一位看到。** Demo 管理員能讀全部 `appointments`／`customers`；寄信開啟後，面試官需輸入真實 Email 才收得到信。接受（建議在前台預約表單不另加說明）或之後另開卡遮罩。
5. **第一次真實還原前的備份。** 請確認你的 Supabase 方案有沒有 PITR 或可下載的備份。
6. **全站每小時限流上限是阻斷服務的槓桿（D4）。** 保留（並設得低於 Supabase 限額）或改為只告警。

### 其餘殘留風險（可接受）

- Demo 帳戶就是管理員：`is_admin()` 為真，等於公開後台全部寫入權限，靠每日還原兜底；還原之間，所有面試官共用同一份資料。已核對：**Demo 無法新增 `admins` 列**（`0015` 對 `admins` 未授權 authenticated；`get_admin_profile`／`update_admin_profile` 只作用於 `auth.uid()` 自己那列）、讀不到 `auth.users`。
- 層 2 若實驗失敗：三項鎖只剩前端與事後補救。
- 還原是整表覆寫：以確認字串、最低筆數、dry-run、advisory lock、旗標預設關閉降低機率。
- Demo 使用者可從 console 呼叫 global `signOut`，把同時在線的其他面試官踢出；他們可再按一次進入。
- Demo 讀得到 `designer001` 的 `audit_log`（只有 actor UUID、服務名、設計師名與時間，不含顧客個資，依 `lib/admin/audit-log.ts`）。
- `CRON_SECRET` 敏感度提高：外洩者可觸發還原（回到 seed、不洩漏資料；手動真實還原另需 `confirm` 參數）。
- Vercel Hobby 的排程限制待核對（見 D9）。

## 9. 對已核准規格書的調整（使用者已於 2026-10-30 同意）

> 第 6 項（還原時間文案）使用者已決定改為「每日凌晨 3 點左右還原」；第 1～5、7 項使用者要求白話說明後回覆可以。

1. **忘記密碼：** 原要求「前端辨識 Demo Email 並顯示提示」。Demo 的 Email 其實會顯示在帳號設定頁（登入前才不知道），前端在登入頁無法辨識。改為「資料庫觸發器擋下，登入頁顯示既有通用錯誤」；`screen-spec-登入頁體驗入口.md` 的「忘記密碼（輸入體驗帳號信箱）」狀態列取消。
2. **`designer001`：** 不動他的登入憑證、`admins` 個人資料、頭像與稽核紀錄；只還原業務資料與 Demo 自己的那一列。
3. **seed 圖片放私有 `demo-seed` bucket**，預設從現有公開 bucket 匯入。
4. **「還原重設 Demo 的密碼與 Email」改為「還原後檢查並回報；修復走 SQL Editor」。** 原因：觸發器啟用後，admin API 也無法改 Demo 密碼與 Email（D5），而還原函式不碰 `auth` schema。規格書第 115 行與驗收標準要同步改寫。
5. **手動真實還原不受 `DEMO_RESET_ENABLED` 約束**（需密鑰與 `confirm` 參數），旗標只管排程（D9）。
6. **還原時間文案：** Hobby 排程只保證在該小時內觸發，建議把畫面上的「每日 03:00 還原」改為「每日凌晨 3 點左右還原」。涉及已核准的文案，需你決定。
7. **新增故事「濫用防護與緊急開關」**：TASK-113（Storage 擁有者與上傳上限）、`demo:disable`／`demo:enable`、以及你對第 8 節第 1 項的決定所產生的卡片。

## 10. 任務卡一覽與依賴

> 下表是各卡**主要**前置關係；依「Epic 架構優先規則」，除 097 外每張卡的看板 `dependsOn` 也都**直接**列上 TASK-097。TASK-097 依賴「專案設置」全部卡片（TASK-001～009）。

| 卡 | 標題 | 故事 | 軌 | 風險 | 主要 dependsOn |
|---|---|---|---|---|---|
| TASK-097 | 架構基礎：Demo 識別、設定與 `isDemo` 貫穿後台外殼 | 建立與標記 Demo 帳戶 | 不適用 | 低 | TASK-001～009 |
| TASK-098 | 觸發器可行性實驗（拋棄式帳號，實驗後清除） | 鎖定帳號安全三項 | 後端 | **高** | 097 |
| TASK-099 | Demo 帳戶建立腳本 | 建立與標記 Demo 帳戶 | 後端 | 中 | 097 |
| TASK-100 | 資料庫鎖定 migration（`auth` 觸發器＋`demo_revoke_sessions`） | 鎖定帳號安全三項 | 後端 | **高** | 098 |
| TASK-101 | 帳號設定頁 Demo 鎖定狀態 | 鎖定帳號安全三項 | 前端 | 低 | 097 |
| TASK-102 | 一鍵進入限流（migration＋RPC） | 登入頁體驗入口 | 後端 | 中 | 097 |
| TASK-103 | 一鍵進入端點 `POST /api/demo/enter` | 登入頁體驗入口 | 後端 | **高** | 099、102 |
| TASK-104 | 登入頁體驗入口與說明視窗旗標 | 登入頁體驗入口 | 前端 | 低 | 097 |
| TASK-105 | 體驗帳號橫幅、說明視窗與 Demo 本地登出 | 體驗帳號提示橫幅 | 前端 | 低 | 097 |
| TASK-106 | Demo seed 資料定義與現況匯出工具 | Demo seed 資料 | 後端 | 中 | 097 |
| TASK-107 | Demo 圖片：私有 `demo-seed` bucket 與匯入腳本 | Demo seed 資料 | 後端 | 中 | 106 |
| TASK-108 | 還原函式 `reset_demo_data`＋唯讀物件清單 RPC（migration） | 整庫還原 | 後端 | **高** | 106 |
| TASK-109 | 還原編排 `lib/demo/reset.ts` | 整庫還原 | 後端 | **高** | 100、107、108 |
| TASK-110 | 還原排程端點、`vercel.json` 與手動還原指令（排程預設關閉） | 整庫還原 | 後端 | **高** | 109 |
| TASK-111 | 文件、營運指令（`demo:disable`／`enable`）與公開入口 | 文件與入口公開 | 不適用 | 中 | 100、104、105、110 |
| TASK-112 | 端到端串接、暗啟動、首次正式環境 seed 與驗收 | 文件與入口公開 | 前後端串接 | **高** | 097～113 |
| TASK-113 | Storage 擁有者限制與 Demo 上傳上限（migration） | 濫用防護與緊急開關 | 後端 | **高** | 097 |
| TASK-114 | Demo 發動的改期／取消不寄信（改寫 `notify_appointment_update`） | 濫用防護與緊急開關 | 後端 | **高** | 097 |
| TASK-115 | Demo 寄信說明視窗（改期／取消確認後的通知信示意圖） | 體驗帳號提示橫幅 | 前端 | 低 | 097 |
| TASK-116 | Demo 專屬資料筆數上限（設計師最多 5 位等，migration） | 濫用防護與緊急開關 | 後端 | **高** | 106 |
| TASK-117 | 還原前備份腳本 `backup-demo-tables`（含 `restore.sql`） | 整庫還原 | 後端 | 中 | 097 |
| TASK-118 | 帳號設定頁 Demo 鎖定操作的統一提示文案（TASK-101 驗收時發現的缺口） | 鎖定帳號安全三項 | 前端 | 低 | 097、101 |

### 為什麼只有一張串接卡

`implementation-plan` 預設把同時涉及前後端的 Story 拆成前端、後端、串接三張。這個 Epic 的前端畫面都很薄，後端才是重點，所以前端卡各自以對應後端契約的 mock 開發，**真正的串接與端到端驗證集中在 TASK-112**。這是對預設規則的刻意偏離，請在核准時一併確認。前端卡因此只依賴 097，不必等後端卡完成。

### MECE 檢查

- **完全窮盡：** 規格書 7 個故事皆有對應卡片（S1→099、S2→102/103/104、S3→098/100/101、S4→106/107、S5→108/109/110、S6→105、S7→111）；另新增「濫用防護與緊急開關」→ 113 與 111 的營運指令。寄信開啟的決定落在 111（更新 `TASK-080` 註記）與 112（驗證寄信行為）；寄信濫用的決定衍生 114（資料庫）與 115（前端視窗）；筆數上限 → 116；備份 → 117。共 21 張（097～117）；TASK-101 驗收時另發現「畫面規格的錯誤提示無卡負責」，補 TASK-118，合計 22 張（097～118）。
- **相互排斥：** 下列檔案**會被多張卡修改**，已用依賴順序排開，實作時以後一張卡「只追加、不改既有內容」為準：

| 檔案 | 修改的卡 | 分工 |
|---|---|---|
| `lib/demo/notice-copy.ts` | 097（建立並放 `DEMO_RESET_LABEL` 與文案）、105（微調文案） | 105 只改文字 |
| `tests/lib/demo-config.test.ts` | 097 | cron 一致性測試**只放在 110**，097 不寫 |
| `ai/context/decisions.md` | 098、100、108、111 | 各自追加條目 |
| `.env.example` | 097（五個變數）、111（核對） | 111 只核對文字 |
| `README.md` | 111、112 | 112 只補截圖 |
| `app/admin/layout.tsx`、`AdminProfileContext.tsx`、`AdminShell.tsx` | 只有 097 | 其餘卡不改 |
| `app/admin/_components/DemoNotice.tsx` | 097（空殼）、105（實作） | |
| `app/login/login-form.tsx`、`app/login/page.tsx` | 只有 104 | |
| `vercel.json` | 只有 110 | |

## 11. 審查紀錄（2026-10-30，子代理意見，不等同人工核准）

### 安全性審查（security-reviewer）

| 項目 | 處置 |
|---|---|
| M1 還原函式信任 payload 的 Demo id | **採納**：D1、D7，函式自己查 `is_demo` 且剛好 1 筆（TASK-108、109） |
| M2 先寫 cookie 再撤銷 | **採納**：D3 改為驗證通過才寫 cookie（TASK-103） |
| M3 寄信濫用 | **已核對屬實**，需使用者決定：第 8 節第 1 項 |
| M4 Demo 可刪 `designer001` 頭像 | **已核對屬實，採納**：D8、D11、新增 TASK-113 |
| M5 緊急開關停不掉已發 session | **採納**：D12、`demo:disable`、`demo_revoke_sessions()` |
| S1 觸發器 SECURITY INVOKER、WHEN、鎖定欄位 | **採納**：D5、TASK-100 |
| S2 配額阻斷服務 | **部分採納**：Storage 上限（TASK-113）；資料庫列數需使用者決定（第 8 節第 2 項） |
| S3 公開前台被竄改 | 需使用者明確接受（第 8 節第 3 項） |
| S4 seed 圖片可被換掉 | **採納**：D7 改為差異比對＋remove＋copy |
| S5 還原函式防呆（dry-run 無預設、最低筆數、advisory lock、白名單、不帶 access_token、匯出白名單） | **採納**：D7、D4 腳本表、TASK-106／108／109 |
| S6 HMAC、IPv6 /64、限流出錯拒絕、全站上限 | **採納**：D4；全站上限需使用者決定（第 8 節第 6 項） |
| S7 規格書與計畫不一致（重設密碼） | **採納**：第 9 節第 4 項待使用者確認 |
| S8 Demo Email 其實是公開的 | **已核對屬實，採納**：D2、D5 |
| R1～R5 可接受 | 列入第 8 節 |

### 架構審查（architect）

| 項目 | 處置 |
|---|---|
| M1 部署順序做不到 | **採納**：D10 改暗啟動；環境變數改動需 Redeploy |
| M2 手動還原與總開關互卡 | **採納**：D9，旗標只管排程 |
| M3 Storage `copy()` 不能覆寫 | **採納**：D7（初步確認 `copy` 未帶 upsert 標頭，實作時以實測為準） |
| M4 觸發器寫法限制 | **採納**：D5（與安全審查 S1 合併） |
| M5 規格書要求沒有卡負責 | **採納**：第 9 節第 4 項 |
| M6 登出按鈕 global signOut | **已核對屬實，採納**：D6、TASK-105 |
| M7 `DEMO_RESET_LABEL` 放錯位置 | **採納**：D2、TASK-097／105 |
| M8 真實還原前無備份 | **採納**：D10、TASK-112；方案確認需使用者（第 8 節第 5 項） |
| M9 依賴缺漏 | **採納**：第 10 節（107 依賴 106；108 不依賴 107；109 依賴 100、107、108） |
| M10 回歸範圍太小 | **採納**：第 6 節、TASK-112 |
| S1 簡化 Storage 步驟 | **採納**：D7（TS 端算 referenced paths、唯讀物件清單 RPC、只刪早於開始時間的孤兒） |
| S2 時間預算與文案 | **採納**：D7；文案是否改待使用者（第 9 節第 6 項） |
| S3 `reset_demo_data` 細節 | **採納**：D7 |
| S4 ID 策略 | **採納**：D7、TASK-106 |
| S5 刪 MFA factor 改 admin API | **採納**：D7（reset 函式不碰 `auth` schema） |
| S6 健康檢查用獨立 anon client、限流額度共用 | **採納**：TASK-109、D4 |
| S7 IP 雜湊 | **採納**：D4（與安全審查 S6 合併） |
| S8 砍 `--dir`、cron 測試只放 110、統一圖片來源 | **採納**：TASK-107、097、110 |
| S9 MECE 文字與實際不符 | **採納**：第 10 節改為列出被多張卡修改的檔案 |
| S10 營運手冊補充 | **採納**：TASK-111 |
| S11 migration 編號 | **採納**：第 2 節與各卡「以當時最大編號為準」 |
| S12 提早盤點 `is_admin()` 寫入面 | **採納**：TASK-103 上線前完成 |
| S13 多餘依賴 | **採納**：104 只依賴 097；100 不依賴 099 |
