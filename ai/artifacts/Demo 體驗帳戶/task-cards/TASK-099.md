# AI-Ready 任務卡

## Metadata

- 任務：Demo 帳戶建立腳本（seed:demo-account）
- 上層規格：[`feature-spec.md`](../feature-spec.md)；架構筆記：[`architecture-notes.md`](../architecture-notes.md)
- 上層 Epic：Demo 體驗帳戶
- 上層 User Story：建立與標記 Demo 帳戶
- 分軌：後端
- 前置任務（dependsOn）：TASK-097
- 狀態：草稿（待人工核准）
- 風險等級：中
- Agent owner：Claude Code
- 人工核准者：待使用者核准

## 目標

提供一支冪等的伺服器端腳本，用 service role 建立 Demo 管理員帳戶、標記 `is_demo`、登記 `admins`、設定顯示名稱，並保證不會誤動既有的真實管理員。

## 情境包（Context Pack）

- 相關檔案：
  - `scripts/seed-designer-account.mjs`
  - `supabase/migrations/0007_admin_profile.sql`（`admins.display_name`）
  - `supabase/migrations/0015_explicit_table_grants.sql`（service_role 對 `admins` 的授權）
- 既有模式：一次性 `.mjs` 腳本、`--env-file=.env.local`、冪等、密碼全程不印出（`seed-designer-account.mjs`）。
- 假設：
  - Supabase 公開註冊已關閉，帳戶只能由 service role 建立。
  - TASK-100 的觸發器套用後，既有帳戶的密碼與 Email 無法再經 Auth API 修改，所以本腳本對已存在的帳戶**只檢查與補登記，不改密碼**。
- 未知事項：
  - `auth.admin.mfa` 的 factor 列出／刪除 API 在目前 supabase-js 版本的實際簽名（實作時查型別定義確認）。
- 允許變更的檔案：
  - `scripts/seed-demo-account.mjs`（新增）
  - `package.json`（新增 `seed:demo-account` 指令）
- 不得觸碰：
  - `scripts/seed-designer-account.mjs`
  - 任何應用程式碼與 migration

## 需求

- 讀取 `NEXT_PUBLIC_SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`、`DEMO_EMAIL`、`DEMO_PASSWORD`；缺任何一個就中止。
- `DEMO_PASSWORD` 長度至少 32；`DEMO_EMAIL` 不得等於 `DESIGNER_EMAIL`（不分大小寫），否則中止。
- 帳戶不存在：`createUser({ email, password, email_confirm: true, app_metadata: { is_demo: true } })`。
- 帳戶已存在：若 `app_metadata.is_demo !== true` 就**中止並提示**（絕不把既有的非 Demo 帳戶轉成 Demo，也不改它的密碼）；若是 Demo 則略過建立。
- 確保 `admins` 有登記；`admins.display_name` 設為「體驗帳號」（只動這個帳戶那一列）。
- 若該帳戶存在任何 MFA factor，刪除並提示。
- 全程不印出密碼、service role key、token；只印出步驟結果。

## 驗收標準

- 第一次執行建立帳戶並標記；連跑第二次不產生重複、不報錯。
- 把 `DEMO_EMAIL` 設成 `DESIGNER_EMAIL` 時中止，且資料庫沒有任何變更。
- 對一個已存在但非 Demo 的拋棄式帳號執行會中止，且該帳號未被修改。
- 執行輸出與 shell 歷史中找不到密碼。
- `designer001` 的 `auth.users` 列在執行前後一致（雜湊與 `updated_at`）。

## 實作備註

- 用拋棄式帳號測試「已存在但非 Demo」，測完刪除；不要用 `designer001`。
- 建立 Demo 帳戶的動作在 TASK-112 的正式環境步驟才真正執行，這張卡只在本機環境驗證，使用 `__TEST__` 前綴的 Email 與一次性密碼。
- `DEMO_EMAIL` 會顯示在帳號設定頁（公開），必須是作者自己控制的信箱；腳本與手冊都要提醒。
- 觸發器（TASK-100）啟用後，admin API 也無法改 Demo 的密碼與 Email（同樣經過 GoTrue），本腳本因此對既有帳戶只檢查不修改；輪換密碼只能走 SQL Editor（手冊在 TASK-111）。

## 驗證契約

- 單元測試：不適用（腳本）；可把純驗證函式拆出並測試，非必要。
- 整合測試：對拋棄式帳號跑腳本的輸出與資料庫查詢（建立、冪等、拒絕轉換）。
- E2E 測試：不適用。
- 型別檢查：`npx tsc --noEmit` 無錯誤
- Lint：`npm run lint` 無錯誤
- Build：`npm run build` 成功
- 螢幕截圖：不適用。
- 安全性檢查：輸出無密碼；拒絕轉換非 Demo 帳戶；`DEMO_EMAIL` 與 `DESIGNER_EMAIL` 衝突檢查。

## 審查關卡

安全性、驗證（測試工程）。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：
- 已知限制：
- 後續任務：
