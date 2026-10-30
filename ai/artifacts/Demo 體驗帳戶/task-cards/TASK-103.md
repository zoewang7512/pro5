# AI-Ready 任務卡

## Metadata

- 任務：一鍵進入端點 POST /api/demo/enter
- 上層規格：[`feature-spec.md`](../feature-spec.md)；架構筆記：[`architecture-notes.md`](../architecture-notes.md)
- 上層 Epic：Demo 體驗帳戶
- 上層 User Story：登入頁體驗入口
- 分軌：後端
- 前置任務（dependsOn）：TASK-097, TASK-099, TASK-102
- 狀態：草稿（待人工核准）
- 風險等級：高
- Agent owner：Claude Code
- 人工核准者：待使用者核准

## 目標

提供公開的一鍵進入端點：伺服器端以 Demo 帳戶登入、建立 session，並以多道防線確保它**只能**登入 Demo 帳戶、不洩漏任何資訊。

## 情境包（Context Pack）

- 相關檔案：
  - `lib/supabase/server.ts`（`createClient`，Route Handler 可寫 cookie）
  - `app/api/cron/appointment-reminders/route.ts`（Route Handler 與錯誤回應風格）
  - `lib/demo/config.ts`（TASK-097）
  - `lib/demo/rate-limit.ts`（TASK-102）
  - `lib/auth/aal.ts`
- 既有模式：伺服器端驗證用 `getUser()`；測試用 `scope: "local"` 登出；Route Handler 測試放 `tests/api/`。
- 假設：
  - Demo 帳戶已由 TASK-099 建立。
  - 所有失敗回同一個泛用回應，不區分原因。
- 未知事項：
  - `@supabase/ssr` 在 Route Handler 以 `cookies()` 寫入 session cookie 的行為，實作時以實測為準。
- 允許變更的檔案：
  - `app/api/demo/enter/route.ts`（新增）
  - `lib/demo/enter.ts`（新增，核心邏輯，依賴注入以便單元測試）
  - `tests/api/demo-enter.test.ts`（新增）、`tests/demo-enter.integration.test.ts`、`vitest.demo-enter.config.ts`（新增）
  - `package.json`（新增 `test:demo-enter`）
  - `ai/artifacts/Demo 體驗帳戶/verification/TASK-103-admin-surface.md`（新增：`is_admin()` 寫入面盤點）
- 不得觸碰：
  - `lib/supabase/middleware.ts`、`proxy.ts`
  - 既有登入表單與 `login-form.tsx`（TASK-104 才改）
  - `lib/supabase/server.ts` 本身

## 需求

- 只接受 `POST`；其他方法回 405。忽略 body 與 query。
- `getDemoConfig()` 為 `null`（未啟用或缺設定）→ 失敗。
- 同源檢查：`Origin` 標頭必須與 `NEXT_PUBLIC_SITE_URL` 或請求 host 同源；缺 `Origin` 視為失敗。
- 限流（TASK-102）：不通過或限流 RPC 出錯 → 失敗（**出錯不放行**）；若使用者已決定捨棄 TASK-102，略過此步。
- **用自訂 cookie adapter 暫存 Supabase 寫出的 cookie，不直接寫入回應**；再呼叫 `signInWithPassword`（`DEMO_EMAIL`／`DEMO_PASSWORD`）；錯誤 → 失敗。
- 登入成功後**必須**驗證 `user.app_metadata.is_demo === true`，且 `getAuthenticatorAssuranceLevel()` 的 `nextLevel !== "aal2"`；**兩項都通過才把暫存的 cookie 寫進回應**。
- 任何失敗路徑（含例外）都明確讓 `sb-*` cookie 過期，並額外嘗試 `signOut({ scope: "local" })`；**不得依賴 `signOut` 是否成功**。
- 回應一律加 `Cache-Control: no-store`；成功回 `200 { ok: true }`；失敗一律 `{ ok: false }` 與固定的泛用回應，登入頁文案固定。
- **本卡的安全審查前，先完成 `is_admin()` 寫入面盤點**：逐表列出 Demo 管理員能透過 REST／RPC／Storage 做的事（預約欄位、服務、設計師、店家設定、`audit_log`、Storage bucket 等），附報告，確認無法提權、無法新增 `admins`、無法讀取 `auth` 資料。
- log 只記失敗類別（`config_missing`、`cross_origin`、`rate_limited`、`sign_in_failed`、`not_demo`、`aal2`），不記 Email、密碼、token。

## 驗收標準

- 每一道防線各有單元測試：未啟用、缺設定、方法錯誤、跨站／缺 Origin、被限流、登入失敗、非 Demo 帳戶、需要 aal2。
- **非 Demo 帳戶保證測試**：把 `DEMO_EMAIL` 指向一個拋棄式的非 Demo 帳號，端點必須失敗，且回應中沒有任何 session cookie。
- **`signOut` 丟例外時**（模擬網路錯誤），回應仍不帶任何 session cookie，且 `sb-*` cookie 被標記過期。
- 成功與失敗回應都帶 `Cache-Control: no-store`。
- `is_admin()` 寫入面盤點報告已完成並附於 `verification/TASK-103-admin-surface.md`。
- 成功時回應帶有 Supabase session cookie，之後以該 cookie 存取 `/admin` 成功。
- 所有失敗的回應本文完全相同（不可分辨原因）。
- 回應、log、錯誤堆疊中找不到 Demo 的 Email 與密碼。
- 使用者可傳入的任何參數都不影響被登入的帳號（測試以不同 body／query 呼叫，結果一致）。

## 實作備註

- 整合測試會建立真實 session，結尾用 `scope: "local"`；不得做全域 `signOut()`。
- 限流測試用獨立 bucket，避免耗盡正式額度。
- 這是公開端點，審查時要特別檢查：能否被用來登入其他帳號、能否繞過限流、錯誤回應是否洩漏。

## 驗證契約

- 單元測試：`tests/api/demo-enter.test.ts`（依賴注入的各道防線）。
- 整合測試：`npm run test:demo-enter`（對真實 Supabase：成功路徑、非 Demo 帳戶保證、aal2 拒絕；使用拋棄式帳號與測試設定）。
- E2E 測試：不適用（串接於 TASK-112）。
- 型別檢查：`npx tsc --noEmit` 無錯誤
- Lint：`npm run lint` 無錯誤
- Build：`npm run build` 成功
- 螢幕截圖：不適用。
- 安全性檢查：公開端點濫用、CSRF／跨站、帳號指定、密碼與 token 不外洩、限流旁路；依 `security-reviewer` 清單逐項回報。

## 審查關卡

架構、安全性、驗證（測試工程）；高風險，動工前須人工核准。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：
- 已知限制：
- 後續任務：
