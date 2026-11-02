# 驗證報告

## 摘要

- 任務：TASK-112 Demo 體驗帳戶 端到端串接、暗啟動、首次正式環境 seed 與驗收
- 結果：**暗啟動前五步已完成並驗證**：migration 已套用、master 已合併部署（兩個開關關閉）、Demo 帳戶已建立、圖片已就緒、備份後完成**一次**真實還原、還原後回歸與瀏覽器走查完成。**入口與排程尚未開啟**（`DEMO_ENABLED`、`DEMO_RESET_ENABLED` 皆未設）；開啟與人工驗收待使用者。
- 風險：高（正式庫整表覆寫）。所有對正式庫／正式站的寫入都由使用者同意後執行；agent 的寫入指令被權限分類器擋下，改由使用者在自己的終端機執行，agent 唯讀驗證。
- 日期：2026-11-02。驗證者：Claude Code；正式環境動作：使用者。審查意見與人工核准不同，本卡的人工核准由使用者下令動工與逐步同意構成。

## 暗啟動時間線（2026-11-02，台北時間）

| 步驟 | 動作 | 執行者 | 結果與證據 |
|---|---|---|---|
| 0 | 真實還原前基準線：26 個 `test:*` 套件對正式庫依序執行、`tsc`、`lint`、`build` | agent | 全過；輸出 `TASK-112-baseline-before-reset/` |
| 1 | `master` fast-forward 到 `c7cd5d0` 並 push，Vercel Production 部署（兩個開關關閉） | agent（使用者同意） | 部署 Ready；`/login` 200 且無入口（`demoEnabled=false`）、`POST /api/demo/enter` 403、`/api/cron/demo-reset` 無／錯密鑰 401、`/api/cron/appointment-reminders` 無密鑰 401；截圖 `00-production-login-flag-off.jpg` |
| 2 | `npm run seed:demo-account` 建立 Demo 帳戶 | **使用者** | 唯讀驗證：`is_demo` 1 個、Email 符合 `DEMO_EMAIL`、MFA 0、未封鎖、`admins` 登記「Demo帳號」；`designer001` 未動 |
| 3 | 匯入 seed 圖片 | — | `--dry-run`：45 個物件已相同 45、缺少 0、內容不同 0，不需寫入（`demo-seed` 先前已齊全） |
| 4 | Vercel Production 新增 `DEMO_EMAIL`／`DEMO_PASSWORD`／`DEMO_RATE_LIMIT_SECRET`（Sensitive）並 Redeploy；`demo:reset` dry-run | **使用者** | `vercel env ls` 只見三個名稱、無 `DEMO_ENABLED`；dry-run HTTP 200、資料庫已還原：否、`reset_database` 已回滾、預計刪除 預約 16／顧客 14／服務 4／設計師 4… |
| 5 | 備份 `npm run demo:backup -- --yes` → `backups/20261102T084511Z` | agent（唯讀） | 13 張表、50 個圖片物件 10,693,517 bytes；agent 另行重算 13 個 SHA-256、`restore.sql`、50 個圖片全部吻合；使用者確認備份可用 |
| 6 | **第一次也是唯一一次真實還原** `demo:reset --yes --confirm-host=pro5-nu.vercel.app` | **使用者（明確同意）** | HTTP 200、12136 ms、資料庫已還原：是；六階段 `prepare／sync_images／reset_database／cleanup_orphans／revoke_account／health_check` 全部 done |
| 7 | 還原後驗證與回歸 | agent | 見下方 |

## 還原後驗證

### 資料與 `designer001`
- 各表筆數等於 seed：預約 425（過去 completed 269／cancelled 26，未來 confirmed 84／pending 35／cancelled 11，2026-09-21～2026-11-23）、顧客 12、服務 4、設計師 4、請假 2、作品集圖片 40、設計師服務 14、公休日 1、營業時間 7、`booking_policy` 1、`store_settings` 1。
- 預約與顧客帶 Email 的筆數 0、`reminder_sent_at` 非 null 的筆數 0——沒有任何信的來源。
- **`designer001` 不受影響**（還原前後快照 `TASK-112-designer001-before/after-reset.json` 完全相同）：`auth.users` 的欄位、metadata／identities 雜湊、`admins` 列、`audit_log` 261 列、`admin-assets` 的 3 個頭像（含 etag）；**使用者另在 SQL Editor 比對 `md5(encrypted_password)`、`updated_at`、`last_sign_in_at`，前後相同**（`8874451a…`）。
- Demo 帳戶：`last_sign_in` 08:49:16 為還原的健康檢查登入成功，代表 Vercel 上的 `DEMO_EMAIL`、`DEMO_PASSWORD` 正確。
- Storage：`designer-assets` 43、`admin-assets` 3、`demo-seed` 45 不變；`store-assets` 4→2，少掉兩個 8/7 上傳、還原前已沒有任何資料引用的舊封面與舊 Logo（公開 bucket 孤兒清理的設計行為；備份內仍有）。

### 還原後回歸（24 個整合套件，`TASK-112-regression-after-reset/`）
- 21 個與基準線完全相同（`notifications` 20、`rls` 18、`booking` 23、`admin-booking` 16、`business-hours` 33、`store-settings` 11、`booking-policy` 7、`services` 17、`designers` 122、`account` 17、`mfa-rls` 20、`audit-log` 28、`reports` 19、`demo-rate-limit` 21、`demo-enter` 22、`demo-row-caps` 16、`storage-owner` 19、`demo-audit-cap` 13、`text-length` 21、`booking-limit` 8、`demo-reminder-guard` 8）。
- 3 個有差異，**全部是「測試假設沒有真實 Demo 帳戶」，不是產品問題**：`demo-lock` 22 過／2 跳過、`demo-reset` 31 過／3 跳過（測試內建條件式跳過，輸出標示 skipped 非 passed）、`demo-seed-bucket` 13 過／**1 失敗**（該案例預期 Demo 樣態帳號未登記 `admins` 時允許匯入，但真實 Demo 已登記，守門正確拒絕）。已另開 **TASK-125**（只改測試）。
- `test:demo-disable`、`test:seed-demo-account` 在真實 Demo 存在後無法執行（既有限制，手冊已記載）；以 `tests/lib`（30 檔 569 項全過）與 `npm run demo:disable` 預覽模式（辨識 Demo 帳戶、列出三個動作、無 `--yes` 不寫入）替代。
- 補跑 `test:demo-mail-suppress` 3/3（見寄信驗證）。測試後正式庫無殘留（`auth.users` 2、`is_demo` 1）。
- 本機：`tsc` 0、`lint` 0、`build` 成功（基準線與回歸階段）。

## 瀏覽器走查（本機 `next-dev-demo`，連同一個正式庫；截圖 `TASK-112-screenshots/`）

方式：`.claude/launch.json` 新增 `next-dev-demo`，**只對本機開發伺服器注入 `DEMO_ENABLED=true`**，不改 `.env.local`、不動 Vercel。

| 項目 | 結果 |
|---|---|
| 登入頁出現「進入體驗帳號」（01） | ✓ |
| 一鍵進入後不輸入帳密到 `/admin`，出現說明視窗（可以體驗／不開放）（02） | ✓ |
| 提示橫幅（可關閉、含「了解更多」）每頁都在（02、03） | ✓ |
| 預約週曆（本週 43 筆）／列表、儀表板（本月 129 筆、已完成營收 NT$17,000、預估營收 NT$274,200）（10）、設計師、服務設定、營業時間（含 11/11 特殊公休日）、預約規則、商店設定、稽核紀錄 | ✓ 皆可載入 |
| 帳號設定頁：密碼、登入 Email、啟用雙重驗證三項「🔒 體驗帳號不開放」、按鈕 `disabled=true`（DOM 確認）（04） | ✓ |
| Demo 取消預約 → 說明視窗「顧客會收到這封取消通知信」＋「正式環境會寄出這封信；體驗帳號不會真的寄出。」→ 繼續後資料庫 `status=cancelled`（05） | ✓ |
| Demo 改期 → 同樣的說明視窗（08）→ 繼續後 `start_at` 變更 | ✓ |
| 亮色（06）、暗色（01～05）、手機 375px（07） | ✓（手機有觀察，見下） |
| Demo 登出（`signOut({scope:"local"})`）回登入頁、入口仍在 | ✓ |
| 前台預約成功（09） | ✓ |

## 寄信行為驗證（使用者信箱 `zoework0401@gmail.com`）

| 行為 | 方式 | 結果 |
|---|---|---|
| 前台預約確認信照寄 | 前台以該信箱預約 11/6 14:00（`confirmation_sent_at` 09:14:44） | 使用者收到 1 封確認信 |
| Demo 改期與取消不寄信 | 以 Demo 帳號把同一筆預約改期到 16:00、再取消 | 使用者於約 3 分鐘後確認**沒有任何新信** |
| 非 Demo 管理員改期照常寄信 | `DEMO_MAIL_TEST_EMAIL=… npm run test:demo-mail-suppress`（拋棄式管理員帳號，不使用店長密碼）3/3 | 使用者收到 1 封「預約已改期」 |
| **TASK-121 在真實情境生效** | 同一筆**帶真實 Email** 的預約，Demo 改期後 `reminder_sent_at` 變為 09:16:19（非 null；app 的改期 payload 是設為 null） | 隔天提醒排程撈不到，不會對該信箱寄提醒信 |

## 對照 feature-spec 驗收標準

| 驗收標準 | 證據 |
|---|---|
| Demo 帳戶存在、為管理員、有 `is_demo`、沒有 MFA；重跑不重複 | 唯讀驗證（見時間線第 2 步）；`test:seed-demo-account` 14 項（基準線，真實 Demo 建立前） |
| 一鍵進入、說明視窗、可操作後台各功能 | 走查（01～03、各頁載入） |
| 失敗文案、一般登入不受影響、限流、前端與 log 找不到密碼 | `test:demo-enter` 22、`test:demo-rate-limit` 21；`.next/static`（267 檔）與 `.next/server/app`（225 檔）掃描不含 `DEMO_PASSWORD`／`DEMO_RATE_LIMIT_SECRET`（0 個） |
| 密碼、Email、MFA 三項停用；直接呼叫 Auth API 失敗 | 走查 DOM（04）；`test:demo-lock` 22 項（觸發器；2 項因真實 Demo 存在而跳過） |
| 非 Demo 管理員改密碼／Email／MFA 不受影響 | `test:account` 17、`test:mfa-rls` 20（基準線與還原後皆過） |
| 還原後各表／bucket 等同 seed；Demo 憑證重設；`designer001` 不變；沒寄信 | 還原後驗證（上）；`revoke_account` 階段 done、健康檢查登入成功 |
| 還原失敗時資料完整保留 | `test:demo-reset`（原子性與回滾案例，dry-run；31 過／3 跳過）；真實還原成功，未演練失敗路徑 |
| 排程端點沒有密鑰回 401／403 且資料不變 | 正式站 `curl`：無／錯密鑰皆 401；`tests/api` 單元測試 |
| seed 預約橫跨過去與未來，儀表板與報表有非零資料 | 預約分佈（上）；儀表板 10 |
| 作品集補完關卡有執行並留下紀錄 | 使用者於 2026-10-30 確認作品集已補齊（專案記憶與卡片紀錄）；還原前的現況匯出為 seed 來源 |
| README、`.env.example`、`decisions.md` 已同步；TASK-080 註記已更新 | README「線上體驗」章節、`.env.example` 的 `DEMO_*`、`decisions.md`、TASK-080（2026-11-01 更新註記）皆已存在；本次補手冊 §2 的順序提醒 |

## 變更的檔案（本卡）

`ai/artifacts/Demo 體驗帳戶/verification/TASK-112*`（報告、基準線、回歸、`designer001` 前後快照、截圖）、`.claude/launch.json`（新增 `next-dev-demo`）、`docs/demo-account.md`（§2 順序提醒）、`tools/kanban/cards/TASK-112.json`、`TASK-125.json`（新卡，草稿）。**未動任何產品程式碼、migration 或 seed。**

## 觀察與殘留風險（需要使用者決定）

1. **稽核紀錄頁對 Demo 顯示 `designer001` 的 261 筆紀錄**，多為整合測試殘留的 `__TEST__…` 事件；面試官看得到。還原只刪 Demo 自己的紀錄（`audit_log` 刪除 0）。**使用者於 2026-11-02 決定「先接受」**（日後若要清除：由使用者在 SQL Editor 刪除測試殘留事件，備份 `backups/20261102T084511Z` 已含這些列；或另開卡讓還原一併處理）。
2. **手機 375px**：後台側邊欄不收合（既有版面，非 Demo 專屬）；帳號設定頁「🔒 體驗帳號不開放」徽章文字被截斷成「體驗帳號不…」、顯示名稱欄只剩「Dem」。屬本 Epic 的畫面細節，尚未修改。
3. **TASK-125**：測試相容性（見上）。
4. 已知殘留沿用：R-A（Demo 可改信件文字，搭配匿名預約可寄純文字釣魚信，需全店寄信預算）、R1 Email 別名繞過、顧客資料互相可見、公開前台最長約 24 小時被竄改（皆已被使用者接受或另案）。
5. `_down` 回滾實測（TASK-121）、真實還原**失敗**路徑未演練。
6. 備份資料夾 `backups/20261102T084511Z`（含顧客個資，只在本機）何時刪除由使用者決定；建議開啟入口並穩定運作後再刪。

## 尚待（使用者）

- 決定上列 2（手機畫面）的處置；上列 1 已決定先接受。
- 依序開啟：先 `DEMO_ENABLED=true` 並 Redeploy、觀察；再 `DEMO_RESET_ENABLED=true` 並 Redeploy，確認排程第一次觸發的結果（台北約 03:00）。
- 人工驗收；通過後轉 Done（本卡 dependsOn 的 22 張前置卡皆已 Done）。
