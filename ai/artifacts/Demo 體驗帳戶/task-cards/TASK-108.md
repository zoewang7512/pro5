# AI-Ready 任務卡

## Metadata

- 任務：還原函式 reset_demo_data 與唯讀物件清單 RPC（migration，單一交易、含 dry-run）
- 上層規格：[`feature-spec.md`](../feature-spec.md)；架構筆記：[`architecture-notes.md`](../architecture-notes.md)
- 上層 Epic：Demo 體驗帳戶
- 上層 User Story：整庫還原
- 分軌：後端
- 前置任務（dependsOn）：TASK-097, TASK-106
- 狀態：完成（使用者人工驗收通過，2026-10-31）
- 風險等級：高
- Agent owner：Claude Code
- 人工核准者：使用者（2026-10-31）

## 目標

新增只有 service role 能執行的 SQL 函式，在**單一交易**內把業務資料表整批覆寫成 seed payload，任何一步失敗全部回滾；提供 dry-run 模式（執行後回滾子交易、只回傳筆數）；並提供唯讀的 Storage 物件清單 RPC。**函式不碰 `auth` schema。**

## 情境包（Context Pack）

- 相關檔案：
  - `ai/artifacts/Demo 體驗帳戶/architecture-notes.md` D7、D8
  - `supabase/migrations/0001`、`0017`、`0018`、`0019`、`0020`（FK、觸發器、constraint、授權）
  - `lib/demo/seed-types.ts`、`lib/demo/seed-data.ts`（TASK-106，payload 形狀）
- 既有模式：`SECURITY DEFINER`＋`set search_path = ''`＋`revoke execute from public, anon, authenticated`（`0007` 的 RPC 寫法）。
- 假設：
  - FK 順序：先刪 `appointments`（`service_id`、`designer_id`、`customer_id` 皆無 `on delete`）；`designers` 刪除 cascade 到三張子表；單列表用 `insert … on conflict (id) do update`；`business_hours` 要求 payload 剛好 7 列。實作時以當下實際 schema 為準。
  - seed 預約 `customer_email` 為 null，不會觸發寄信觸發器；`appointments_set_price_snapshot` 在 insert 時作用。
  - `audit_log` 只刪 Demo 帳戶 `actor_id` 的列；`admins` 只更新 Demo 那一列。MFA factor 與 session 不在本函式處理（改由 TASK-109 的 admin API 與 TASK-100 的 `demo_revoke_sessions()`）。
- 未知事項：
  - `booking_policy` 的單列結構與 `closed_dates` 的主鍵（實作時讀 `0008`、`0003`）。
  - `storage.objects` 的 eTag／大小欄位在目前專案版本的實際位置（`metadata` jsonb），實測確認。
  - PostgREST 的 `statement_timeout` 是否足夠完成還原（實測）。
- 允許變更的檔案：
  - `supabase/migrations/00NN_demo_reset.sql` 與 `_down.sql`（新增；編號以動工當時的最大編號為準；檔頭加 `do $$` 依賴檢查，比照 0018／0020）
  - `tests/demo-reset.integration.test.ts`、`vitest.demo-reset.config.ts`（新增；**只用 dry-run**）
  - `package.json`（新增 `test:demo-reset`）
  - `ai/context/decisions.md`
- 不得觸碰：
  - 既有 migration
  - `designer001` 的 `auth.users`、`admins` 列、`audit_log` 紀錄
  - 任何非 dry-run 的真實還原（本卡不得對正式庫真實執行）

## 需求

- 函式 `reset_demo_data(p_payload jsonb, p_dry_run boolean) returns jsonb`；**`p_dry_run` 不給預設值**，呼叫端必須明確傳入。
- 守門：`p_payload ->> 'confirm' = 'RESET_DEMO'`、所有必要鍵存在，**且各必要陣列有最低筆數**（避免程式 bug 送空陣列清空整張表）；`business_hours` 必須剛好 7 列；不符一律 `raise exception`。
- **Demo 使用者由函式自己決定**：查 `auth.users` 中 `is_demo` 的帳戶，筆數不是剛好 1 就 `raise`；payload 若帶 `demo_user_id`，必須與查到的相同；`audit_log` 與 `admins` 的處理都用查到的 id。
- **函式內再守一道：payload 預約的 `customer_email` 必須全為 null**，否則 `raise exception`（還原不寄信不能只靠 TypeScript 測試）。
- `set local lock_timeout = '5s'` 後 `lock table appointments`；`pg_advisory_xact_lock` 避免排程與手動還原同時執行。
- 覆寫範圍：`services`、`designers`、`designer_services`、`designer_leaves`、`designer_portfolio_images`、`business_hours`、`closed_dates`、`booking_policy`、`store_settings`、`appointments`、`customers`；`audit_log` 只刪 Demo 的列；`admins` 只更新 Demo 那一列的 `display_name`、`avatar_url`。**不碰 `auth` schema。**
- dry-run：完整執行後在內層 `BEGIN … EXCEPTION` 區塊以**自訂 SQLSTATE**回滾子交易，只攔截該 SQLSTATE（其他真實錯誤一律重新拋出），筆數變數宣告在外層，回傳各表會寫入與刪除的筆數。
- 回傳 `{ counts, dry_run }`（不回傳 referenced paths，改由 TS 端計算）。
- 另一支唯讀 RPC `demo_list_storage_objects(p_bucket text)`：`SECURITY DEFINER`、`search_path = ''`、只有 service_role 可執行，回傳該 bucket 內所有物件的名稱、大小、eTag、created_at、owner_id（含子目錄，不需逐層 `list()`）；白名單只允許三個公開 bucket 與 `demo-seed`。
- 授權：`reset_demo_data` 只有 service_role 可執行；`anon`、`authenticated` 呼叫被拒絕。檔頭註明套用順序、回滾，以及「絕不可由排程以外的任何程式在未確認下呼叫」。

## 驗收標準

- dry-run 後，所有受影響表的筆數與關鍵欄位雜湊與執行前**完全一致**（含 `designer001` 的 `admins` 列與 `audit_log` 其他列）。
- dry-run 回傳的筆數等於 payload 內各陣列長度；`audit_log` 只計算 Demo 帳戶的列。
- 缺 `confirm`、缺任一必要鍵、必要陣列低於最低筆數、空 payload、`business_hours` 不是 7 列、預約含非 null 的 `customer_email`、`is_demo` 帳戶不是剛好 1 個、payload 的 `demo_user_id` 與查到的不同，皆失敗，且資料不變。
- 刻意構造違反 constraint 的 payload（例如重疊預約）時整個交易失敗，資料不變。
- dry-run 以外的真實錯誤不被吞掉（以測試證明自訂 SQLSTATE 之外的錯誤會重新拋出）。
- `anon`／`authenticated` 執行失敗；service_role 可執行。兩個函式皆如此。
- `demo_list_storage_objects` 對非白名單 bucket 拒絕；回傳包含子目錄物件。
- `_down.sql` 完整移除兩個函式。

## 實作備註

- **本卡的整合測試是整個 Epic 最危險的測試**：只能 dry-run，測試呼叫處硬編碼 `p_dry_run => true`，並有一個單元測試掃描整合測試檔，確保沒有任何地方傳 false。
- 真實還原只會在 TASK-112 經使用者明確同意並完成備份後執行一次。
- dry-run 的子交易回滾會一併回滾 pg_net 的請求佇列寫入（不會送出任何 webhook）；但仍以 `customer_email` 全 null 為前提。

## 驗證契約

- 單元測試：掃描測試：整合測試檔不得出現非 dry-run 的 `reset_demo_data` 呼叫。
- 整合測試：`npm run test:demo-reset`（全部 dry-run）。
- E2E 測試：不適用。
- 型別檢查：`npx tsc --noEmit` 無錯誤
- Lint：`npm run lint` 無錯誤
- Build：`npm run build` 成功
- 螢幕截圖：不適用。
- 安全性檢查：授權最小化；`search_path`；守門字串與最低筆數；Demo 使用者由函式自己決定、不信任 payload；不影響 `designer001`；SQL 注入面（payload 只經 `jsonb_populate_recordset`／參數化，不拼接字串）；物件清單 RPC 的 bucket 白名單。

## 審查關卡

架構、安全性、驗證（測試工程）；高風險，動工前須人工核准。

## 完成證據

- 變更的檔案、執行過的指令、測試輸出、已知限制、後續任務：見 [`verification/TASK-108.md`](../verification/TASK-108.md)
- 螢幕截圖：不適用。
