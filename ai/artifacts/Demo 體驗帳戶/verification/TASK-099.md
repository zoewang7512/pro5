# 驗證報告

## 摘要

- 任務：TASK-099 Demo 體驗帳戶 建立腳本（`seed:demo-account`）
- 結果：**通過**（新增 14 項整合測試全過；`tsc`、`lint`、`build` 皆通過；資料庫無拋棄式帳號殘留）
- 驗證者：實作 agent（Claude Code）。任務卡列的審查關卡（安全性、驗證）**尚未另跑子代理審查**，目前只有實作者自查（見「審查發現」）；人工驗收待使用者。

## 變更的檔案

| 檔案 | 內容 |
|---|---|
| `scripts/seed-demo-account.mjs`（新增） | 冪等建立／檢查 Demo 帳戶：`createUser`（`email_confirm`、`app_metadata.is_demo`）、`admins` 登記與顯示名稱「Demo帳號」、刪除 MFA factor；既有非 Demo 帳戶一律中止；不印密碼 |
| `package.json` | 新增 `seed:demo-account`、`test:seed-demo-account` 兩個指令 |
| `tests/seed-demo-account.integration.test.ts`（新增） | 對真實 Supabase 以拋棄式帳號（`__test__seeddemo-*@resend.dev`）跑腳本子程序的整合測試 |
| `vitest.seed-demo-account.config.ts`（新增） | 獨立的 vitest 設定，比照其他 `test:*` |
| `tools/kanban/cards/TASK-099.json`、本報表、任務卡 | 流程文件 |

任務卡「允許變更的檔案」只列腳本與 `package.json`；整合測試與其 vitest 設定是驗證契約要求的測試產物，比照 `test:demo-lock` 的既有慣例新增，未動任何應用程式碼、migration 或 `seed-designer-account.mjs`。

## 指令

| 指令 | 結果 | 備註 |
|---|---|---|
| `npm run test:seed-demo-account` | **14 項通過**（約 23 秒） | 第一次執行 2 項失敗，原因見「審查發現」1、2，修正後全過 |
| `npx tsc --noEmit` | 通過 | 0 錯誤 |
| `npm run lint` | 通過 | 0 error |
| `npm run build` | 通過 | |
| `grep -rl "seed-demo-account\|DEMO_PASSWORD" .next/static` | 無結果 | 腳本與密碼名稱不進前端產物 |
| 清理檢查（listUsers 與 admins 計數） | 拋棄式帳號 0 個殘留；`is_demo` 帳戶 0 個；`admins` 1 列（designer001） | 正式庫目前沒有 Demo 帳戶，符合「TASK-112 才真正建立」 |

## 驗收標準對照

| 驗收標準 | 證據 |
|---|---|
| 第一次執行建立帳戶並標記；連跑第二次不產生重複、不報錯 | 「第一次執行」「連跑第二次」兩項：`is_demo === true`、`email_confirmed_at` 有值、`admins` 剛好 1 列、顯示名稱「Demo帳號」；第二次 exit 0、同 Email 只有 1 個使用者、`updated_at` 不變、`admins` 仍 1 列 |
| 既有帳戶不改密碼 | 第二次用**不同**密碼執行，原密碼仍可登入 |
| `DEMO_EMAIL` 等於 `DESIGNER_EMAIL` 時中止且資料庫無變更 | 兩項：大小寫不同的拋棄式 Email（使用者總數、`admins` 筆數不變、帳戶未建立）；以及**真正的** `DESIGNER_EMAIL`（大寫）→ exit 1，designer001 快照不變 |
| 已存在但非 Demo 的拋棄式帳號會中止且未被修改 | exit 1、訊息含「不是 Demo 帳戶」；`is_demo` 仍為 undefined、`updated_at` 不變、沒有 `admins` 列、`admins` 總筆數不變、原密碼仍可登入 |
| 執行輸出與 shell 歷史找不到密碼 | 輸出（stdout＋stderr）不含 `DEMO_PASSWORD`、不含 service role key；測試以子程序環境變數傳入，沒有經過 shell 命令列 |
| `designer001` 的 `auth.users` 列在執行前後一致 | 整個測試前後的快照相等：`updated_at`、`last_sign_in_at`、`app_metadata`、`admins` 列 |

其他涵蓋：密碼少於 32 字元、缺 `DEMO_EMAIL`、缺 `DEMO_PASSWORD`、缺 `SUPABASE_SERVICE_ROLE_KEY` 皆 exit 1 且不建立帳戶；顯示名稱被改掉時重跑會校正且只動該列；`admins` 登記被移除時重跑會補登記；既有 Demo 帳戶帶 MFA factor 時刪除並提示（先以非 Demo 身分註冊 TOTP，再用 admin API 標記為 Demo——觸發器只對「舊列已是 Demo」生效，所以這個順序可行；也間接確認 TASK-099 的未知事項「MFA admin API 簽名」：`mfa.listFactors({ userId })`／`mfa.deleteFactor({ id, userId })`）。

## UI 證據

不適用（無畫面變更）。

## 審查發現

| 發現 | 嚴重程度 | 狀態 |
|---|---|---|
| 1. **腳本在 Windows 上的退出碼錯誤**：拒絕分支在 supabase-js 連線尚未關閉時呼叫 `process.exit(1)`，Node 以 `0xC0000409`（3221226505）崩潰。資料未被修改，但退出碼不是 1。`seed-designer-account.mjs` 有同樣寫法（不在本卡範圍，未動） | 中 | **已修正**：啟動時的輸入檢查（無連線）才直接 `process.exit`；連線之後的失敗改丟例外，由最外層設 `process.exitCode = 1`，成功路徑也不再強制 `exit` |
| 2. 首版測試在登入之後才取 `updated_at` 基準；`signInWithPassword` 會更新 `updated_at`，造成誤判 | 低 | **已修正**：基準改在第二次執行前才取 |
| 3. 實作者自查（尚未有獨立審查）：密碼只存在於 `createUser` 的呼叫，沒有任何 `console` 輸出含它；錯誤訊息只用 Supabase 回傳的 `error.message`（不含請求內容）；既有帳戶沒有任何 `updateUserById` 呼叫；對 `admins` 的更新與寫入都以 `user_id` 限定。 | 資訊 | 建議 Verify 階段由安全性與測試子代理各審一次（任務卡審查關卡），目前未執行 |
| 4. 若另有其他帶 `is_demo` 的帳戶，腳本只**警告**不中止（資料庫的還原與撤銷函式要求剛好 1 個，多出來會讓它們拒絕執行）。這是任務卡沒有要求的額外提示 | 資訊 | 保留；若要改為中止，需另行決定 |

## 殘留風險

- **designer001 的密碼雜湊沒有直接比對。** Auth API 不暴露 `encrypted_password`，這次用 `updated_at`、`last_sign_in_at`、`app_metadata`、`admins` 列代替（密碼變更一定會更新 `updated_at`）。本腳本在 `DEMO_EMAIL` 與 `DESIGNER_EMAIL` 相同時於連線前就中止，**不會觸及 designer001**；若要有雜湊證據，可在 SQL Editor 比對 `md5(encrypted_password)`（TASK-100 驗收時的做法），需要的話你執行前後各貼一次。
- 正式 `.env.local`／Vercel **尚未設定** `DEMO_EMAIL`、`DEMO_PASSWORD`；真正建立 Demo 帳戶在 TASK-112。`DEMO_EMAIL`（已定為 `hair_demo@gmail.com`）會顯示在帳號設定頁，必須是你自己控制的信箱；腳本結尾會印出這個提醒。
- 未設定 `DESIGNER_EMAIL` 的環境，腳本只警告、不比對衝突（與架構筆記 D2 一致，主要防線是 `is_demo` 驗證）。
- 測試會在正式庫短暫建立並刪除帳號與 `admins` 列，並寄不出任何信（`email_confirm: true` 建立、收件網域為 `resend.dev`）；若測試中途被強制中止，下次執行的 `beforeAll` 會清除殘留。
