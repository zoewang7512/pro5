# Demo 體驗帳戶營運手冊

給作者本人（維護者）看的操作手冊：怎麼建立、開啟、關閉、還原、修復 Demo 體驗帳戶，以及出狀況時的第一步。
設計背景與所有決策見 [`ai/artifacts/Demo 體驗帳戶/architecture-notes.md`](../ai/artifacts/Demo%20體驗帳戶/architecture-notes.md) 與 [`ai/context/decisions.md`](../ai/context/decisions.md)。

> **這份手冊刻意不放任何帳號、密碼、金鑰、Email。** 下文的 `<DEMO_EMAIL>`、`<新密碼>`、`<站台主機>` 等都是佔位，請代入你自己的值。
> 指令與 SQL 前面標示了「驗證狀態」：✅ 代表實作期間實跑過或有自動化測試；⚠️ 代表本手冊撰寫時 agent 無法實跑（沒有 SQL Editor 存取），第一次使用時請照「驗證方式」確認。完整對照見最後一節。

---

## 0. 先看這裡：兩個最常用的動作

| 狀況 | 馬上做 |
|---|---|
| 有人在濫用體驗帳號，要立刻止血 | `npm run demo:disable -- --yes`（§4），再把 `DEMO_ENABLED` 改成 `false` 並 Redeploy（§3） |
| 登入頁**所有人**都登不進去（連店長也一樣），回 500 | 到 Supabase SQL Editor 只貼兩行 `drop trigger`（§7.4），**不要**用 `_down.sql` |

---

## 1. 概念與環境變數

Demo 體驗帳戶是一個**一般的後台管理員帳戶**（`app_metadata.is_demo = true`），登入頁的「進入體驗帳號」按鈕會由伺服器端代為登入，訪客不需要也看不到密碼。
它和正式店長帳號（`designer001`）共用**同一個 Supabase 專案**，所以保護它的是這幾層：資料庫觸發器鎖住改密碼／改 Email／啟用 MFA、各種上限觸發器、每日整庫還原、`demo:disable` 緊急開關。

五個環境變數（只放伺服器端，**絕不加 `NEXT_PUBLIC_`**）：

| 變數 | 用途 | 注意 |
|---|---|---|
| `DEMO_ENABLED` | 登入頁入口與一鍵進入端點的總開關，只有 `"true"` 才啟用 | 預設關閉 |
| `DEMO_EMAIL` | Demo 帳戶的 Email | **這個 Email 會顯示在帳號設定頁，等於公開**，必須是你自己控制的信箱（觸發器萬一失效，密碼重設信會寄到這裡）。不得等於 `DESIGNER_EMAIL` |
| `DEMO_PASSWORD` | Demo 密碼 | 長隨機值（至少 32 字元）；只有伺服器環境與你的 `.env.local` 知道 |
| `DEMO_RATE_LIMIT_SECRET` | 一鍵進入限流用的 IP 雜湊金鑰 | 長隨機值（至少 32 字元，太短一律拒絕進入）；與其他密鑰都不同 |
| `DEMO_RESET_ENABLED` | **每日排程**還原的總開關，只有 `"true"` 才讓排程真的動資料 | 預設關閉；手動還原不受它約束 |

產生長隨機值（✅）：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Vercel 環境變數改動後，必須 Redeploy 才會生效**（見 §3）。只改變數、不重新部署，正式環境仍跑舊值。

補充：
- 正式環境若沒設 `DESIGNER_EMAIL`，程式裡「`DEMO_EMAIL` 不得等於 `DESIGNER_EMAIL`」的比對形同沒作用；真正的主要防線是一鍵進入端點對 `is_demo` 的驗證（登入的帳號若不是 Demo 帳戶，不會寫入 session）。可接受，但請確認 `DEMO_EMAIL` 真的是 Demo 帳戶的信箱。
- `.env.local` 與 Vercel 的值要一致：本機腳本（`seed:demo-account`、`demo:*`）讀 `.env.local`，網站讀 Vercel。

---

## 2. 首次上線：建立、匯入、驗證（暗啟動順序）

只有一個 Supabase 專案，git 分支隔離不了資料庫；而且 `vercel.json` 只有 `master` 會部署、Cron 只在 production 執行。所以採**暗啟動**：先讓所有程式與資料庫物件上線，但入口與排程都保持關閉，驗證完才依序開。

1. **套用 migration**（`supabase/migrations/0021`～`0031`，每支整份貼到 SQL Editor 執行；順序與回滾說明見各檔檔頭）。
2. **合併到 `master` 並部署**，此時 `DEMO_ENABLED`、`DEMO_RESET_ENABLED` 皆為 `false`（入口不顯示，登入頁與沒有這個功能時一致）。
3. **建立 Demo 帳戶**（✅ `test:seed-demo-account` 14 項）：在 `.env.local` 填好 `DEMO_EMAIL`、`DEMO_PASSWORD` 後執行

   ```bash
   npm run seed:demo-account
   ```

   冪等：帳戶已存在且是 Demo 帳戶就只補登記 `admins`、校正顯示名稱「Demo帳號」、清掉 MFA；**絕不改既有帳戶的密碼**，也絕不把既有的非 Demo 帳戶轉成 Demo。
4. **匯入 seed 圖片到私有 bucket `demo-seed`**（✅ `test:demo-seed-bucket`）：

   ```bash
   npm run demo:upload-images -- --from-public --dry-run   # 先只檢查來源是否齊全
   npm run demo:upload-images -- --from-public             # 真的匯入
   ```

   這支指令在 Demo 上線中（`DEMO_ENABLED=true`，或有 Demo 帳戶仍登記在 `admins`）會**拒絕執行**，見 §6。

   > **順序提醒（TASK-112 首次上線實際遇到）：** 步驟 3 建立 Demo 帳戶後，它就登記在 `admins`，此時**非 dry-run** 的匯入會被拒絕。若 `demo-seed` 還沒有圖片，請**先匯入再建立 Demo 帳戶**，或先 `npm run demo:disable -- --yes`、匯入完再 `demo:enable -- --yes`。先用上面的 `--dry-run` 看「缺少 N」：為 0 就不需要匯入（首次上線時 `demo-seed` 已經齊全，所以略過）。
5. **手動 dry-run 還原**（✅，只試跑、不寫入任何東西）。`CRON_SECRET` 要設在目前的 shell（對正式站請用正式站的值；已存在於 shell 的同名變數優先於 `.env.local`）：

   ```bash
   npm run demo:reset -- --url https://<站台主機>
   ```

6. **先備份**（§5），**取得你的同意後**再做第一次真實還原：

   ```bash
   npm run demo:reset -- --url https://<站台主機> --yes --confirm-host=<站台主機>
   ```

   真實還原會把業務資料整表覆寫成 seed。非本機網址必須再帶 `--confirm-host=<主機名稱>`（與 `--url` 的主機完全相同）。手動真實還原**不受** `DEMO_RESET_ENABLED` 約束，所以首次可以在旗標關閉時由你親手執行。
7. **驗證**：重跑 §8 列的回歸測試、人工檢查前台與後台。
8. 全部確認後，**依序**開啟：先 `DEMO_ENABLED=true` 並 Redeploy；觀察一段時間後，才 `DEMO_RESET_ENABLED=true` 並 Redeploy。

---

## 3. 開關：入口與排程（改變數 + Redeploy）

| 要做的事 | 改什麼 | 生效條件 |
|---|---|---|
| 開啟／關閉登入頁入口與一鍵進入 | `DEMO_ENABLED` = `true`／`false` | **Redeploy** |
| 開啟／關閉每日排程還原 | `DEMO_RESET_ENABLED` = `true`／`false` | **Redeploy** |

改變數（二擇一）：Vercel Dashboard → 專案 `pro5` → Settings → Environment Variables（Production）；或

```bash
npx vercel env rm DEMO_ENABLED production --yes
npx vercel env add DEMO_ENABLED production
```

**Redeploy**（二擇一）：Dashboard → Deployments → 最新的 Production 部署 → Redeploy；或 `npx vercel deploy --prod --yes`。
部署完成後，用瀏覽器開登入頁確認入口顯示／消失。

> 關閉 `DEMO_ENABLED` **只擋新的進入**。已經發出去的 session 與 refresh token 仍有效，持有者仍能對 REST 與 Storage 行使管理員權限。要立刻止血請用 §4 的 `demo:disable`。

排程時間：`vercel.json` 的 `0 19 * * *`（UTC），也就是台北約 03:00。Vercel Hobby 的精度是「該小時內」，所以畫面文案寫「每日凌晨 3 點左右」。排程只在 production 部署執行。

---

## 4. 緊急關閉與恢復：`demo:disable`／`demo:enable`

✅ 以拋棄式 Demo 帳號實測（`npm run test:demo-disable`，8 項；另有 22 項單元測試）。

```bash
npm run demo:disable                 # 只印出目前狀態與將做的事（預覽）
npm run demo:disable -- --yes        # 真的關閉
npm run demo:enable                  # 預覽
npm run demo:enable -- --yes         # 真的恢復
```

`demo:disable -- --yes` 依序做：

1. 刪除 Demo 在 `admins` 的那一列 → `is_admin()` 每次請求都重新判斷，**已發出的 session 立刻失去全部管理權限**；
2. 以 admin API 封鎖帳戶（`ban_duration`），無法登入與 refresh；
3. 呼叫 `demo_revoke_sessions()` 撤銷 Demo 的全部 session。

每一步獨立執行，一步失敗不會阻止其他步驟；最後逐步回報，有失敗就以退出碼 1 結束，**可安全重複執行**。第 2 步排在第 3 步之前是刻意的：先撤銷 session 的話，封鎖前的空檔訪客可以重新登入拿到新 session，日後 `demo:enable` 重新登記 `admins` 後它就變回管理員。

安全設計：沒有 `--yes` 不會寫入任何東西；目標帳戶一律由「`is_demo` 且剛好 1 個」決定，不接受從命令列指定帳號，所以不可能對 `designer001` 動手；環境有 `DEMO_EMAIL` 時，找到的帳戶 Email 必須與它相同，否則中止。

`demo:enable -- --yes` 反向：解除封鎖，重新登記 `admins`（顯示名稱「Demo帳號」；頭像等個人資料由下一次還原補回）。**它不會自動開啟登入頁入口**，入口要自己把 `DEMO_ENABLED` 改回 `true` 並 Redeploy。

### 連 Supabase Auth 都不能用時：直接在 SQL Editor 關閉 — ⚠️ 未實跑（等同 `demo:disable` 的第 1 步）

`demo:disable` 要呼叫 Auth 的 admin API。若 Auth 服務本身不可用，最小的止血動作是只刪 `admins` 登記（`is_admin()` 每次請求重新判斷，已發出的 session 立刻失去管理權限），在 SQL Editor 執行：

```sql
delete from public.admins
where user_id in (select id from auth.users where raw_app_meta_data ->> 'is_demo' = 'true');
```

回報應為 `DELETE 1`。恢復時 Auth 可用後執行 `npm run demo:enable -- --yes`（會重新登記並解除封鎖）。

### 情境 A：有人濫用，要先止血

1. `npm run demo:disable -- --yes`
2. 把 `DEMO_ENABLED` 改為 `false` 並 Redeploy（關入口；否則訪客還會看到按鈕，只是進不去）。
3. 查看損害（Supabase Dashboard 看資料表、Storage、Auth 用量）。
4. 要清掉被竄改的資料：因為每日還原與手動還原都要求 Demo 已登記在 `admins`，先 `npm run demo:enable -- --yes`（此時入口已關、舊 session 已撤銷，沒有人能進來），然後 `npm run demo:reset -- --url https://<站台主機> --yes --confirm-host=<站台主機>`（**先備份**，見 §5）。
5. 確認無誤後，再依 §3 重新開啟入口。

### 情境 B：公開前台被竄改（店名、Logo、作品集、價格被改）

Demo 管理員改的資料會直接出現在正式前台，最長到下次還原（約 24 小時）。要立刻回復：

```bash
npm run demo:reset -- --url https://<站台主機> --yes --confirm-host=<站台主機>
```

它會把資料與 seed 圖片整個還原，並撤銷 Demo 的 session。

### 封鎖期間的注意事項

- 封鎖期間 Demo 不在 `admins`，每日排程還原會在資料庫守門處失敗（Demo 帳戶必須已登記），**資料庫不會被改動**。長期關閉時請一併把 `DEMO_RESET_ENABLED` 改為 `false` 並 Redeploy，避免每天一筆失敗紀錄。
- `demo:disable` 依賴資料庫函式 `demo_revoke_sessions()`（0021）。**緊急處置請永遠不要套用 `0021_..._down.sql`**，它會把這個函式一起刪掉（見 §7.4）。
- 若 `demo:disable` 回報「找到 N 個 is_demo 帳戶」：先確認沒有殘留的拋棄式測試帳號（整合測試建立的帳號，`app_metadata` 帶 `*_test` 標記，Email 含 `demoenter`、`demolock`、`demoswitch`、`seeddemo` 等字樣；用 §7.1 的查詢可以看到它們的 `is_demo` 為 true），到 Supabase Dashboard → Authentication → Users 刪除，再重跑。

---

## 5. 備份與備份的還原

Supabase **Free Plan 沒有專案備份**，所以真實還原（整表覆寫）之前必須先自建備份。

```bash
npm run demo:backup -- --yes
```

✅（`tests/lib/backup-demo-tables.test.ts` 51 項；已對正式庫唯讀實跑一次，筆數與圖片完全一致）。

- **唯讀**：只做 `select`、唯讀 RPC 與 Storage 下載，零寫入。輸出到本機 `backups/<時間戳>/`：各表 JSON、三個公開 bucket 的全部圖片、`manifest.json`（筆數／大小／SHA-256）、`restore.sql`、`README.md`。
- **含顧客個資，只放本機**，`backups/` 已在 `.gitignore`（腳本開始前會檢查，沒排除就中止）；不要上傳、不要提交進 git。
- **有 `.partial` 後綴的資料夾不是有效備份**（沒寫完或讀回驗證沒通過）。
- 備份是「某一刻」的快照。**真實還原之前請重跑一次**取得最新備份。

### 備份的還原：只能走 `restore.sql`

備份**不能**用 Demo 還原流程回復：`reset_demo_data` 為了不寄信，拒絕任何 `customer_email` 非空的預約，而備份含真實 Email。

1. 先確認真的要回到備份時間點：備份之後新增與修改的資料會全部消失。
2. 用 `manifest.json` 核對 `restore.sql` 與 `tables/*.json` 沒有被改過（重算 SHA-256）。
3. Supabase Dashboard → SQL Editor（角色 `postgres`）→ 貼上該備份資料夾的 `restore.sql` 全文執行。
4. 它是單一交易：寄信觸發器在交易內暫停再啟用（還原期間不會對顧客寄信）、結尾逐表核對筆數、失敗整個回滾。
5. `restore.sql` 只還原資料庫。圖片若遺失，依備份資料夾 `README.md` 把 `storage/<bucket>/<路徑>` 重新上傳到同一個 bucket、同一路徑。
6. 它不涵蓋 `auth.users`：`admins.user_id` 指向的帳戶必須仍存在，否則外鍵失敗、整個回滾。

驗證狀態：`restore.sql` 在拋棄式資料（PGlite 記憶體內 Postgres）上實測成功、冪等、失敗路徑整個回滾（✅）；`alter table … disable trigger user` 在 SQL Editor 的 `postgres` 角色可行（✅，使用者驗收時實跑，無錯誤）。**尚未在正式庫執行過 `restore.sql`**（⚠️ 這是最後手段，不是日常工具）。

### 何時可以刪除備份

由你決定。建議條件：真實還原成功、回歸測試全過、前台與後台人工檢查無誤、確認不再需要回到那個時間點之後，再整個資料夾一併刪除（含個資，刪除後無法復原）。備份資料夾內的 `README.md` 也寫了同一份建議。

---

## 6. 更新展示內容（seed）的流程

Demo 的還原基底是 `lib/demo/seed-base.json`（服務、設計師、作品集、營業時間等）加上私有 bucket `demo-seed` 裡的圖片。要更新展示內容：

1. **先把 `DEMO_RESET_ENABLED` 改為 `false` 並 Redeploy。** 否則你在後台新上傳的圖片尚未納入 seed，當晚會被當成孤兒圖片永久刪除。
2. **先停用 Demo**：`npm run demo:disable -- --yes`。`demo:upload-images` 在 Demo 上線中（`DEMO_ENABLED=true` 或有 Demo 帳戶仍登記在 `admins`）會拒絕執行，因為 Demo 管理員可以替換公開 bucket 裡的圖片，這時再匯入可能把被竄改的圖片當成「原圖」存進 `demo-seed`，之後每日還原還會把它推回去。
3. 用你自己的店長帳號整理好公開 bucket 內的展示圖與資料，**確認圖片是你要的**。
4. 匯出基底資料並人工審閱：

   ```bash
   npm run demo:export-base
   ```

   唯讀、只匯出白名單表（絕不匯出預約、顧客、稽核紀錄、`admins`），並把店家電話換成佔位值；產生後請逐項審閱刪改。

5. 把圖片匯入 `demo-seed`（有差異時 `--overwrite`）：

   ```bash
   npm run demo:upload-images -- --from-public --overwrite
   ```

6. commit `lib/demo/seed-base.json` 並部署（還原讀的是部署出去的 seed）。
7. `npm run demo:enable -- --yes`，再 `DEMO_ENABLED=true`（若先前改過）與 `DEMO_RESET_ENABLED=true` 並 Redeploy。
8. 建議隔天或手動 dry-run 確認 `sync.planned.replace` 為 0（圖片內容與來源一致）。

---

## 7. 修復：Demo 帳戶被改壞或登入出狀況

以下 SQL 都在 Supabase Dashboard → SQL Editor 以 `postgres` 角色執行。`postgres` 不經過 GoTrue，不受資料庫鎖限制，這是**維修通道**。

> **為什麼只能走 SQL Editor：** 觸發器擋的是 GoTrue（Auth 服務）的連線角色。admin API（service role）改 Demo 的密碼或 Email 也要經過 GoTrue，同樣會被擋；`postgres` 也無法在 SQL Editor 內 `set role supabase_auth_admin` 來模擬。

### 7.1 檢視狀態（唯讀）— ⚠️ 首次使用時確認回傳剛好 1 列

```sql
select u.id, u.email, u.raw_app_meta_data ->> 'is_demo' as is_demo, u.banned_until,
       u.updated_at, u.last_sign_in_at,
       exists (select 1 from public.admins a where a.user_id = u.id) as in_admins,
       (select count(*) from auth.mfa_factors f where f.user_id = u.id) as mfa_factors,
       (select count(*) from auth.sessions s where s.user_id = u.id) as sessions
from auth.users u
where u.raw_app_meta_data ->> 'is_demo' = 'true';
```

預期：**剛好 1 列**。0 列代表尚未建立或標記被清掉；2 列以上代表有殘留測試帳號或標記被濫用——還原與撤銷 session 函式都會拒絕執行（安全方向）。

### 7.2 輪換 Demo 密碼 — ⚠️ 未實跑，請照驗證方式確認

```sql
update auth.users
set encrypted_password = extensions.crypt('<新密碼>', extensions.gen_salt('bf', 10)),
    updated_at = now()
where raw_app_meta_data ->> 'is_demo' = 'true'
  and email = '<DEMO_EMAIL>';
```

- 必須用 bcrypt（`gen_salt('bf', 10)`）。確認回報 `UPDATE 1`。
- **SQL Editor 會保存查詢紀錄**，密碼會留在裡面：執行後刪除該查詢（不要按 Save／Favorite）。
- 同時更新 `.env.local` 與 Vercel 的 `DEMO_PASSWORD`（≥ 32 字元）並 **Redeploy**；兩邊不一致時，一鍵進入會失敗（登入頁顯示「目前無法進入體驗帳號」）。
- 輪換後撤銷舊 session：`npm run demo:disable -- --yes` 再 `npm run demo:enable -- --yes`，或在 SQL Editor 執行 `select public.demo_revoke_sessions();`。
- **驗證方式：** 在登入頁按「進入體驗帳號」實際進入後台。

### 7.3 帳戶無法修復時：刪除重建 — ⚠️ 未實跑（Dashboard 刪除使用者與 `seed:demo-account` 建立流程已有自動化測試）

1. 先用 §7.1 記下舊帳戶的 `id`。
2. Dashboard → Authentication → Users → 刪除該使用者（等同測試清理用的 admin API `deleteUser`；`admins`、`auth.sessions`、`auth.mfa_factors` 會跟著刪除）。
3. 清掉舊帳戶留下的稽核紀錄（`audit_log` 沒有指向 `auth.users` 的外鍵，不會跟著刪，而每日還原只刪「目前 Demo 帳戶」的紀錄）：

   ```sql
   delete from public.audit_log where actor_id = '<舊 id>';
   ```

4. `npm run seed:demo-account`（用 `.env.local` 的 `DEMO_EMAIL`／`DEMO_PASSWORD`；確保與 Vercel 一致）。
5. `npm run demo:reset -- --url https://<站台主機> --yes --confirm-host=<站台主機>`（先備份），讓頭像等個人資料回到 seed。
6. 在登入頁按「進入體驗帳號」實測。

### 7.4 Auth 平台升級後，**所有人**登入都回 500 — 第一步只貼這兩行 ✅

觸發器對「符合條件的 Auth 操作」做檢查；Auth 平台升級若改了連線角色或寫入欄位，可能誤擋。**只貼這兩行**（只移除觸發器、不動任何資料）：

```sql
drop trigger if exists demo_lock_users_guard on auth.users;
drop trigger if exists demo_lock_mfa_guard on auth.mfa_factors;
```

- ✅ 這兩行與 `0021_demo_account_lock_down.sql` 內的語句相同，該檔已實跑；整合測試 `test:demo-lock` 的 `DEMO_LOCK_EXPECT=off` 模式證明移除後行為恢復。
- **不要用 `_down.sql`**：它會連 `demo_revoke_sessions()` 一起刪掉，而 `demo:disable` 依賴它。`_down.sql` 只用在「下線整個 Demo 功能」。
- 移除觸發器後 Demo 帳戶可被改密碼／Email：在登入恢復、查明原因之前，先 `npm run demo:disable -- --yes` 並關閉入口。查明後重新整份套用 `0021_demo_account_lock.sql`（可重複執行）。

### 7.5 暫時停用單項防護 ✅（語句與各 `_down.sql` 內相同，皆已實跑）

只有在該防護造成誤擋、需要緊急放行時才用；處理完請重新套用對應 migration。

| 現象 | 第一步 |
|---|---|
| Storage 上傳**全面**失敗 | `drop trigger if exists demo_storage_cap_guard on storage.objects;`（**不要**用 `0025_down`） |
| Demo 的稽核紀錄（audit_log）被上限擋住而需要放行 | `drop trigger if exists demo_audit_log_cap on public.audit_log;`（0028；不要用 `0028_down`，雖然它與其他 migration 互不依賴） |
| 正常儲存服務或店家設定被長度上限擋住而需要放行（0029） | `alter table public.<表> drop constraint if exists <constraint 名稱>;`，名稱見下方「文字欄位長度上限」表（只放行那一個欄位；不要用 `0029_down`，它會一次拿掉六個）。**放行等於重新打開缺口**：放行期間先 `demo:disable` 或明確接受風險；若放行期間已寫入超長資料，之後重跑 0029 會被套用前檢查擋下而中止，需先還原資料（例如 `demo:reset -- --yes`）再重套；放行後務必回頭重套 0029 |
| 某張表的新增被 Demo 上限擋住而需要放行 | `drop trigger if exists demo_row_cap_<表> on public.<表>;`（表：`services`、`designers`、`designer_services`、`designer_leaves`、`designer_portfolio_images`、`closed_dates`） |
| Demo 動過的預約提醒標記觸發器（0031）出問題而需要放行 | `drop trigger if exists demo_appointment_reminder on public.appointments;`（不要用 `0031_down`；白名單多一個名稱不影響還原）。**放行等於重新打開缺口**：Demo 改期會讓隔天提醒信重寄到預約上的 Email，放行期間先 `demo:disable` 或明確接受風險；處理完**只需重建觸發器**：`create trigger demo_appointment_reminder before update on public.appointments for each row execute function public.demo_appointment_reminder_guard();`（不要重跑整份 0031：若之後有更新的 migration 重新定義過 `reset_demo_data`，重跑會把它倒退） |

> `0025_down` 是安全降級，`DEMO_ENABLED=true` 時須先 `demo:disable`。`reset_demo_data` 目前的版本來自 0031（0024 → 0027 → 0031 各重新定義一次，每次只差觸發器白名單）：`0031_down` 會把它寫死成 0027 的本文、`0027_down` 會寫死成 0024 的本文，**回滾必須由新到舊（先 0031_down、再 0027_down）**，且之後若有 migration 又重新定義過該函式，這兩個 `_down` 都不得使用（單元測試會在出現更新的定義者時失敗提醒）。

### 7.6 Demo 的 Storage 額度用完

每個公開 bucket 每個 Demo 帳戶最多 30 個物件，且**所有訪客共用同一個 Demo 帳戶的額度**：一個人用完，其他人當天就無法再上傳（前端只顯示通用錯誤）。每日還原會清掉 Demo 擁有的孤兒物件並重置額度；若當天孤兒清理被跳過（還原回報警告），額度不會重置。手動處理：

1. 查出 Demo 擁有的物件（唯讀）：

   ```sql
   select bucket_id, name, created_at
   from storage.objects
   where owner_id = '<Demo 帳戶 id>'
   order by created_at;
   ```

2. 到 Dashboard → Storage → 對應 bucket 刪除這些物件（不要直接 `delete from storage.objects`，那樣不會刪掉底層檔案）。刪除前確認它們不是 seed 圖片（seed 圖片是 service role 上傳，`owner_id` 為空，不在這份清單內）。

---

## 8. 一般營運注意事項

### 寄信行為
- **預約確認信照常寄出**（資料庫觸發器 0011）：面試官在前台自己預約並填真實 Email，會收到確認信。
- **Demo 發動的改期／取消不寄信**（0026）：判斷來源是請求 JWT 的 `app_metadata.is_demo`；後台在 Demo 登入時，按下改期或取消的最終確認後會先跳出說明視窗，顯示顧客在正式環境會收到的通知信示意圖。一般管理員、cron、service role 完全不受影響。
- **Demo 動過的預約不寄提醒信**（0031，TASK-121；已於 2026-11-02 套用）：資料庫在 `appointments` 上有一個 BEFORE UPDATE 觸發器 `demo_appointment_reminder`，Demo 帳號對預約做的任何更新都會把 `reminder_sent_at` 強制維持原值（原本是空的就填成目前時間），所以每日提醒排程撈不到 Demo 動過的預約，Demo 改期也無法再讓提醒信重寄。**副作用（已接受）：** Demo 動過的預約不會收到提醒信（只改狀態也算；之後若由一般管理員再改期，提醒會恢復）；面試官自己在前台預約、沒被 Demo 動過的預約，確認信與提醒信照常。一般管理員、提醒排程、service role 完全不受影響。這個觸發器也在 `reset_demo_data` 的觸發器白名單內（同一個 migration 補上）。
- 已知殘留：Demo 取消預約釋放「每個 Email 最多 3 筆」額度的缺口，已由 0030 的 24 小時視窗補上（TASK-120；套用後才生效），但 Email 的別名寫法（供應商別名、次網域、catch-all）仍可繞過，根本解法是全店寄信預算，尚未做。

### 預約額度被鎖住（0030，24 小時視窗）— ⚠️ 未實跑，請照驗證方式確認
`create_appointment` 對**同一支電話、同一個 Email**（正規化後）各有兩道上限，任一道達 3 筆就回 `BOOKING_LIMIT_EXCEEDED`：(1) 未來待服務（pending／confirmed）≥ 3；(2) **過去 24 小時內建立**的預約（不分狀態，取消也算）≥ 3。第 (2) 道是 0030 加的，目的是讓「取消再訂」不能無限寄確認信。

- **店長把預約取消不會釋放第 (2) 道的額度**；要等建立滿 24 小時（Demo 每日還原也會整表清空並歸零）。
- 已知取捨：任何人能用別人的電話建 3 筆預約鎖住那支電話 24 小時（不必填 Email、也不寄信）。前台顯示的文案是中性說法「預約次數已達上限，請稍後再試或聯繫我們。」（TASK-124；原本寫「太多筆待確認的預約」，對被 24 小時視窗擋下、其實沒有待確認預約的顧客不準確）。
- **顧客被擋、需要立刻放行時**，在 SQL Editor 把該電話（或 Email）24 小時內建立的預約的建立時間往前推 25 小時（不刪資料、不動預約內容；只改 `created_at`，不會觸發任何通知信）：

  ```sql
  -- 先看有哪些（唯讀）
  select id, customer_name, status, start_at, created_at
  from public.appointments
  where customer_phone = '<正規化後的電話，只有數字>'
    and created_at > now() - interval '24 hours';

  -- 確認後放行（電話）
  update public.appointments
  set created_at = created_at - interval '25 hours'
  where customer_phone = '<正規化後的電話，只有數字>'
    and created_at > now() - interval '24 hours';

  -- Email 版（用同一個正規化函式比對）
  update public.appointments
  set created_at = created_at - interval '25 hours'
  where public._email_dedupe_key(customer_email) = public._email_dedupe_key('<信箱>')
    and created_at > now() - interval '24 hours';
  ```

  放行後若第 (1) 道（未來待服務 ≥ 3）也擋著，需要先把多餘的預約取消或完成。這個語句是依 0030 的邏輯推導，**尚未在真實資料庫實跑**；首次使用前先用上面的「先看有哪些」確認列數，再執行 update。
- 整體停用 0030 的視窗：套用 `0030_booking_limit_rolling_window_down.sql`（把函式還原成 0018；取消會重新釋放額度，靜默取消迴圈重新開啟）。

### 各表筆數上限（0027，只對 Demo 生效，數字為整張表總列數）
`services` 10、`designers` 5、`designer_services` 50、`designer_leaves` 20、`designer_portfolio_images` 60、`closed_dates` 20。一般管理員與 service role（含還原）不受影響。調整上限：改 `demo_row_cap_guard()` 內的 case 數字後整份重跑，並同步 `tests/lib/demo-row-caps-migration.test.ts` 與 `TASK-116-verify.sql`。
- 上限是整張表總列數，惡意的 Demo 使用者可以在每次還原後立刻填滿額度，讓當天其他面試官無法新增；共用帳號的設計限制。
- **尚未有上限的容量**（TASK-123 安全審查盤點）：(1) `customers`／`appointments` 的姓名（只檢查 trim 後長度，原值可用空白填充）與 `appointments.customer_email`（無長度限制）——匿名就能做；TASK-120／121 **沒有**處理這件事，需另開卡；(2) `designers.name`（CHECK 只限制 btrim 後長度，Demo 可直接 PATCH 填充空白）；(3) `auth.users.raw_user_meta_data`（0021 刻意未鎖）。開啟入口前請確認這些項目的處置。（services／store_settings 的文字欄位長度已由 0029 處理，見下節。）

### 文字欄位長度上限（0029）
列數上限擋不住「對既有列反覆 PATCH 塞大字串」，所以 `services` 與 `store_settings` 的文字欄位另有資料庫 CHECK（以字元數計，**對所有角色生效**，不只 Demo；一般使用的值遠低於上限）：

| 欄位 | 上限 | constraint 名稱 |
|---|---|---|
| `services.name` | 60 | `services_name_length` |
| `services.description` | 500 | `services_description_length` |
| `store_settings.name` | 200 | `store_settings_name_length` |
| `store_settings.address` | 200 | `store_settings_address_length` |
| `store_settings.logo_url` | 2048 | `store_settings_logo_url_length` |
| `store_settings.cover_image_url` | 2048 | `store_settings_cover_image_url_length` |

- 後台服務表單（名稱／描述）與商店設定表單（店名／地址）會在送出前擋下並顯示「…長度須在 N 字以內」；Logo／封面圖網址只由上傳流程產生，沒有輸入欄位。直接打 REST 超過上限會得到 `23514`（check_violation）。
- 每日還原把 `seed-base.json` 寫回這兩張表；種子超過上限會讓還原失敗，所以單元測試固定「種子符合上限」。改種子文字前請先跑 `npx vitest run tests/lib/text-length-checks-migration.test.ts`。
- 調整上限：改 `0029` 內 add constraint 與套用前檢查的數字後整份重跑，並同步 `lib/admin/services.ts`、`lib/store-settings.ts` 的常數與 `tests/lib/text-length-checks-migration.test.ts`、`tests/text-length-checks.integration.test.ts`。
- 驗證：`npm run test:text-length`（預設模式＝已套用；`TEXT_LENGTH_EXPECT=off` 為未套用／已回滾的基準線）。測試會暫時改動商店設定那一列並在結束時還原。

### Demo 的稽核紀錄上限（0028）
Demo 帳戶在 `audit_log` 的列數最多 500 筆（**只算 Demo 自己的列**，designer001 的紀錄不受影響也不佔額度）；此外 Demo 的 `event_type`／`entity_type` 不得超過 64 位元組，單一請求最多寫 20 列。每筆最壞約 20 KB，500 筆最多約 10～12 MB。額度每日還原後重置（還原會刪掉 Demo 帳戶的稽核列）。
- **觸頂時的現象是預期內的**：後台操作照常成功，但稽核列表不再新增 Demo 的紀錄，伺服器日誌每個操作多一行 `[audit-log] 寫入稽核紀錄失敗 P0001`（`recordAdminAction` 永不 throw）。不要把它當成 designer001 的稽核失敗；用 `P0001` 加上 Demo 登入時段辨認。
- 額度是所有訪客共用的（只有一個 Demo 帳戶）：一個惡意訪客可以在還原後立刻用完，當天其他人的操作就不會出現在稽核列表。
- 每日還原停用（`DEMO_RESET_ENABLED=false`）時額度不會重置；手動清理：`demo:reset -- --yes`（見 §4），或在 SQL Editor 執行 `delete from public.audit_log where actor_id = '<Demo 帳戶 id>';`（⚠️ 未實跑，語句與還原函式內刪除 Demo 稽核列相同）。
- 效能：每筆 Demo 寫入都會對 `audit_log` 做一次依 `actor_id` 的計數（全表掃描）。`audit_log` 超過約 10 萬列時，考慮另開卡加 `(actor_id)` 索引。

### 一鍵進入限流
每個 IP 每 10 分鐘 10 次；全站每 5 分鐘 14 次（必須低於 Supabase Dashboard 的 Auth 登入限額，目前是每 IP 每 5 分鐘 30 次，限額若調整，`lib/demo/rate-limit.ts` 的兩個常數要一起重算）。全站上限本身是阻斷服務的槓桿：攻擊者用少量 IP 就能讓所有面試官暫時進不來，已接受。

### 要定期看的地方
- Supabase Dashboard：資料庫與 Storage 用量（Free Plan 配額）、Auth 的寄信額度（`reauthenticate` 可消耗 Auth 寄信額度）、Logs 中零星的 `DEMO_LOCKED`（是被擋下的嘗試，不是故障）。
- Authentication 設定：**Manual Linking 必須關閉、不得啟用任何 OAuth／SSO 提供者、不得啟用 passkey**，否則訪客可把自己的外部帳號綁到 Demo 帳戶，成為不受還原影響的後門。
- Vercel：cron 是否每天執行、最近一次 `/api/cron/demo-reset` 的結果（失敗時日誌有階段代碼）。

### 跑整合測試的注意事項
- 測試期間正式庫會暫時多出 1～3 個 `is_demo` 的拋棄式帳號；此時每日還原與 `demo:disable` 會因為「Demo 帳戶不是剛好 1 個」而拒絕（安全方向）。**開啟排程還原後，請避開台北 03:00–04:00 跑 `test:*`**。
- 測試被中途中斷、沒清掉拋棄式帳號時，`demo:disable` 會失敗：先到 Authentication → Users 刪除殘留帳號（同 §4 的辨認方式）。
- `npm run test:demo-disable` 只能在正式庫**沒有真實 Demo 帳戶**時執行（它要求 `is_demo` 帳戶剛好 1 個）。真實 Demo 帳戶建立後，`demo:disable` 的回歸由單元測試 `tests/lib/demo-disable-script.test.ts` 擔任，真實帳戶的演練請照 §4 的預覽模式（沒有 `--yes` 不會寫入）。
- 測試腳本不得對店長帳號做全域 `signOut()`（會踢掉你瀏覽器上的登入）；一律用 `scope: "local"`。

### 新增 migration 時
- 新增任何以 `is_admin()` 開放的資料表或 Storage policy，驗收時加一項「Demo 管理員能對它做什麼」。
- 在 `reset_demo_data` 覆寫的十一張表上新增觸發器，必須同步更新該函式內的觸發器白名單（以編號最大的那份為準，目前是 0031；見 `tests/lib/demo-reminder-guard-migration.test.ts` 與 `tests/lib/demo-row-caps-migration.test.ts`，漏補時兩者都會失敗）。

---

## 9. 驗證狀態對照

| 項目 | 狀態 | 證據 |
|---|---|---|
| `seed:demo-account` | ✅ | `npm run test:seed-demo-account`（14 項，拋棄式帳號） |
| `demo:upload-images`、`demo:export-base` | ✅ | `npm run test:demo-seed-bucket`；`demo-seed` 與公開 bucket 比對 |
| `demo:reset`（dry-run／真實的參數與保護） | ✅ 腳本層 | `tests/lib/demo-reset-script.test.ts`；端點對真實庫只跑過 dry-run，**尚未對正式庫真實還原**（TASK-112） |
| `demo:backup` 與 `restore.sql` | ✅ / ⚠️ | 備份對正式庫唯讀實跑；`restore.sql` 於 PGlite 實測，**未在正式庫執行** |
| `demo:disable`／`demo:enable` | ✅ | `npm run test:demo-disable` 8 項（拋棄式帳號）＋ `tests/lib/demo-disable-script.test.ts` 22 項 |
| 兩行 `drop trigger`（§7.4）、單項防護停用（§7.5） | ✅ | 與 `_down.sql` 內語句相同，已實跑；`test:demo-lock`、`test:storage-owner`、`test:demo-row-caps` 的 off 模式 |
| Demo 動過的預約不寄提醒信（0031，§8） | ✅ 已套用（`_down` 實測未做） | 正式庫：`TASK-121-verify.sql` ALL_OK、`test:demo-reminder-guard` 預設模式 8/8、`test:demo-reset` 34 項、`test:notifications` 20/20；套用前基準線 off 模式 8/8（重現缺口）。PGlite 演練 39 項為記憶體 Postgres。詳見 `verification/TASK-121.md` |
| Auth 不可用時刪 admins（§4）、檢視 SQL（§7.1、§7.6）、輪換密碼（§7.2）、刪除重建的稽核清理（§7.3） | ⚠️ | agent 沒有 SQL Editor 存取，未實跑。請在 TASK-112 建立 Demo 帳戶後，照各節「驗證方式」第一次使用時確認 |
