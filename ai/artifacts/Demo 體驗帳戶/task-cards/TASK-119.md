# AI-Ready 任務卡

## Metadata

- 任務：忘記密碼流程對體驗帳號的提示（前端）
- 上層規格：[`feature-spec.md`](../feature-spec.md)（驗收條件：「在登入頁對 Demo 帳戶 Email 觸發忘記密碼 → 不寄出重設信，並顯示相同或明確的提示（細節於架構階段決定）」）；畫面規格：[`screen-spec-登入頁體驗入口.md`](../screen-spec-登入頁體驗入口.md)（「忘記密碼（輸入體驗帳號信箱）」與「忘記密碼」兩列）；架構筆記：[`architecture-notes.md`](../architecture-notes.md) D5「忘記密碼」
- 上層 Epic：Demo 體驗帳戶
- 上層 User Story：鎖定帳號安全三項
- 分軌：前端
- 前置任務（dependsOn）：TASK-100、TASK-104
- 狀態：完成（方案 A；人工驗收通過，2026-11-01；證據見 [`verification/TASK-119.md`](../verification/TASK-119.md)）
- 風險等級：低
- Agent owner：Claude Code
- 人工核准者：使用者（2026-11-01，下令動工並選定方案 A 與建議文案）

## 目標

補上 TASK-104 驗收時發現的缺口：畫面規格要求「在忘記密碼表單輸入體驗帳號信箱時，前端攔下並提示『體驗帳號不開放重設密碼，請直接回登入頁使用「進入體驗帳號」』」，但 TASK-104 的任務卡把前端比對排除在外，且沒有其他卡負責。本卡讓走到忘記密碼表單的訪客，不會只看到莫名其妙的「發生未預期的錯誤」，而是被引導回「進入體驗帳號」。

## 現況（沒有這張卡時使用者看到什麼）

- 資料庫觸發器（TASK-100）擋下 Demo 帳戶 `recovery_token` 的寫入 → Supabase 對 `resetPasswordForEmail` 回錯誤 → `login-form.tsx` 的 `handleForgotSubmit` 把任何錯誤顯示為「發生未預期的錯誤，請稍後再試。」。
- **沒有信被寄出（第一道防線已成立），純粹是 UX 缺口**：面試官輸入體驗帳號信箱會看到一個誤導的通用錯誤，不知道該怎麼辦。
- 前端無法比對 Demo Email：TASK-104 任務卡規定前端不得出現 Demo 的 Email；`DEMO_EMAIL` 只存在於伺服器端（`lib/demo/config.ts` 是 `server-only`）。

## 待決定事項（核准前請選一個）

| 方案 | 做法 | 優點 | 風險／代價 |
|---|---|---|---|
| **A（建議）** | 不比對信箱。`demoEnabled` 為真時，忘記密碼送出若失敗，在原本的通用錯誤下方多顯示一行「若您是要體驗，請回登入頁使用「進入體驗帳號」。」並附回登入連結 | 前端沒有任何 Email；不新增端點；一般使用者看到多一行無害的提示（成功路徑不變） | 不是「精準攔截」：Demo 信箱與其他任何失敗（網路、限流）看到相同畫面，不符合畫面規格原文（「前端攔下、不呼叫 Supabase」）；需同步修訂畫面規格 |
| B | 伺服器元件把 `DEMO_EMAIL` 當 prop 傳給 `LoginForm`，輸入相符時前端攔下、不呼叫 Supabase，顯示畫面規格原文 | 完全符合畫面規格；少打一次 Supabase | **Demo Email 會出現在 `/login` 的 HTML 中，任何訪客可見**，推翻畫面規格「Email 不再對外顯示」與 TASK-104「前端不得出現 Demo Email」；雖然 Email 本身不算祕密（D5，且已在帳號設定頁顯示給已進入者），仍需使用者確認可接受 |
| C | 新增伺服器端檢查端點，前端送出信箱詢問「是否為體驗帳號」 | 前端沒有 Email | 新端點等於公開的「是否為 Demo Email」查詢（行為上與公開 Email 相同），還要加同源、限流與測試，風險等級升為中，對一個純 UX 缺口不划算 |
| D | 不做，把畫面規格該列標為作廢 | 零成本 | 面試官誤入忘記密碼會看到莫名錯誤 |

**建議 A**：成本最小、不洩漏、不加端點；代價是提示不精準，但訪客本來就不該走到這個畫面。以下需求與驗收以 A 撰寫；若選 B，需求第 1、2 點改為「以 prop 比對信箱（不分大小寫、去前後空白）並攔下」，並另補「`demoEmail` prop 只在 `demoEnabled` 為真時傳入」的測試。

## 情境包（Context Pack）

- 相關檔案：
  - `app/login/login-form.tsx`（`handleForgotSubmit`、`forgotResult`、`backToLogin`；TASK-104 新增的 `demoEnabled` prop）
  - `tests/components/login-form.test.tsx`
  - `ai/artifacts/Demo 體驗帳戶/screen-spec-登入頁體驗入口.md`
  - `ai/artifacts/Demo 體驗帳戶/verification/TASK-098.md`、`verification/TASK-100.md`（觸發器回傳的錯誤形狀）
- 既有模式：既有 `forgotResult`（`"success" | "error" | null`）搭配 `Alert`；返回登入用既有 `backToLogin`。
- 假設：
  - 觸發器擋下時，供應端回傳的錯誤無法可靠辨識（TASK-098 (f)：HTTP 500、`code` 未定義），所以本卡**不依賴錯誤碼或錯誤文字**，只依 `forgotResult === "error"` 與 `demoEnabled`。
  - 文案由使用者最後確認（見未知事項）。
- 未知事項：
  - 提示文案：建議「若您是要體驗，請回登入頁使用「進入體驗帳號」。」，待使用者過目。
- 允許變更的檔案：
  - `app/login/login-form.tsx`（只改忘記密碼區塊的 error 顯示；不動 `handleSubmit`、MFA、一鍵進入）
  - `tests/components/login-form.test.tsx`（新增案例，不改既有斷言）
  - `ai/artifacts/Demo 體驗帳戶/screen-spec-登入頁體驗入口.md`（「忘記密碼」兩列改成與選定方案一致）
- 不得觸碰：
  - `lib/supabase/*`、資料庫 migration
  - `handleForgotSubmit` 對成功路徑的行為與固定成功文案

## 需求（方案 A）

- `demoEnabled` 為假：忘記密碼流程與現況逐字一致。
- `demoEnabled` 為真且 `forgotResult === "error"`：保留原通用錯誤 Alert，其下新增一行引導文字與「回登入頁」按鈕（呼叫既有 `backToLogin`），讓訪客一鍵回到有「進入體驗帳號」的畫面。
- 成功路徑（固定成功文案）不變，不顯示引導。
- 不得在前端出現 Demo 的 Email，也不得因輸入內容不同而改變畫面（不洩漏「這是不是 Demo 信箱」）。

## 驗收標準

- `demoEnabled` 假／真各有測試：假時失敗畫面與現況一致；真時失敗多出引導與回登入按鈕。
- 成功路徑在兩種情況下都不顯示引導。
- 點「回登入頁」回到登入表單，且「進入體驗帳號」入口可見。
- 既有登入、MFA、忘記密碼測試全數通過，未改既有斷言。
- 畫面規格兩列與實作一致。

## 實作備註

- 本卡不阻擋「一般使用者忘記密碼失敗」：多出的一行對一般管理員無害，且 `demoEnabled` 在 Demo 未啟用時為假。
- 手機（375）不得橫向捲動。

## 驗證契約

- 單元測試：`tests/components/login-form.test.tsx`（Demo 忘記密碼案例）。
- 整合測試：不適用。
- E2E 測試：不適用（串接於 TASK-112）。
- 型別檢查：`npx tsc --noEmit` 無錯誤
- Lint：`npm run lint` 無錯誤
- Build：`npm run build` 成功
- 螢幕截圖：忘記密碼失敗狀態（桌面亮色、手機）各一張。
- 安全性檢查：前端程式碼與 bundle 中沒有 Demo Email；失敗畫面不因輸入的信箱而不同。

## 審查關卡

UI（畫面與規格一致）、驗證（測試工程）。

## 完成證據

- 變更的檔案、執行過的指令、測試輸出、已知限制、後續任務：見 [`verification/TASK-119.md`](../verification/TASK-119.md)
- 螢幕截圖：以預覽頁驗證（桌面亮色／暗色、375 手機），描述見驗證報告
