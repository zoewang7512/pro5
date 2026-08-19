# AI-Ready 任務卡

## Metadata

- 任務：設計師登入與帳號安全 登入流程 MFA 挑戰步驟
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：設計師登入與帳號安全
- 上層 User Story：設計師登入／登出
- 分軌：前端
- 前置任務（dependsOn）：TASK-039, TASK-043
- 狀態：已核准（2026-08-18），待前置任務 TASK-039／TASK-043 完成後轉就緒
- 風險等級：高（登入流程是身分驗證的最終關卡，MFA 挑戰步驟若實作有誤可能讓已啟用 MFA
  的帳號被繞過只用密碼登入，或反過來讓合法使用者被永久卡在驗證步驟，需架構、安全性、
  測試三方審查）

## 目標

在登入頁接上帳密驗證成功後的條件分支：若帳號已啟用 MFA，顯示 TOTP 驗證碼輸入步驟
（重用 TASK-043 建立的 `OtpInput`），驗證通過才真正完成登入導向 `/admin`；若未啟用
MFA，維持既有行為直接導向 `/admin`。

## 情境包（Context Pack）

- 相關檔案：
  - `app/login/login-form.tsx`（TASK-039 已改版、TASK-040 已接上忘記密碼），本卡在
    `signInWithPassword` 成功後新增 MFA 檢查分支。
  - `components/ui/OtpInput.tsx`（TASK-043 建立，本卡重用於登入頁的驗證碼輸入）。
  - `ai/artifacts/設計師登入與帳號安全/mockups/auth-flow-variant-a.html`：狀態 4「MFA
    驗證步驟」為本卡對應畫面。
- 既有模式：
  - Supabase Auth 的 Authenticator Assurance Level（AAL）機制：
    `supabase.auth.mfa.getAuthenticatorAssuranceLevel()` 回傳
    `{ currentLevel, nextLevel }`；若 `nextLevel === "aal2"` 且
    `currentLevel !== nextLevel`，代表這個帳號已啟用 MFA 但目前 session 尚未完成
    第二層驗證，需要走 `mfa.challenge()`／`mfa.verify()` 流程才能把 `currentLevel`
    推進到 `aal2`。
- 假設：
  - `signInWithPassword` 成功後，不論帳號是否啟用 MFA，Supabase 都會先建立一個
    `aal1` session（帳密驗證通過本身就成立）；因此需要額外呼叫
    `getAuthenticatorAssuranceLevel()` 才能判斷是否需要進入 MFA 挑戰步驟，不能只憑
    `signInWithPassword` 是否報錯來判斷。
  - MFA 挑戰步驟驗證通過後，直接複用既有的 `router.replace("/admin")`／
    `router.refresh()` 導向邏輯，不需要額外邏輯。
  - 依 feature-spec 已核准的安全性決策，本卡**不**在 RLS policy 層新增 `aal2` 強制
    要求，MFA 檢查是應用層（本卡的登入頁 UI 流程）判斷；`is_admin()` 頁面層檢查在
    帳密驗證通過的當下就會通過（因為身分已確認），MFA 挑戰步驟是本卡在導向 `/admin`
    之前額外加的 UI 層關卡。
- 未知事項：無。
- 允許變更的檔案：
  - `app/login/login-form.tsx`
  - 【實作期新增，見完成證據】`tests/components/login-form.test.tsx`：情境包誤判斷
    「無對應既有測試檔案」，實際上該檔案已存在，本卡的 AAL 呼叫使其中 2 個既有案例
    回歸失敗，為符合 Definition of Done 已一併修正 mock 並新增 MFA 案例。
- 不得觸碰：
  - `app/login/page.tsx`（伺服器端邏輯不變）。
  - `supabase/migrations/`（不涉及資料庫變更，AAL 機制完全由 Supabase Auth 管理）。
  - RLS policy（不新增 `aal2` 層級的資料庫端強制要求，見上方假設與 feature-spec 已
    核准的安全性決策）。

## 需求

- WHEN 使用者在登入頁輸入正確帳密送出且 `signInWithPassword` 成功 THE SYSTEM SHALL
  呼叫 `getAuthenticatorAssuranceLevel()` 判斷是否需要 MFA 挑戰。
- WHEN `nextLevel === "aal2"` 且 `currentLevel !== nextLevel` THE SYSTEM SHALL 顯示
  TOTP 驗證碼輸入步驟（`OtpInput`），不立即導向 `/admin`。
- WHEN 使用者在 MFA 挑戰步驟輸入正確驗證碼 THE SYSTEM SHALL 呼叫
  `mfa.challenge()`／`mfa.verify()` 驗證成功，導向 `/admin` 並 `router.refresh()`。
- WHEN 使用者輸入錯誤驗證碼 THE SYSTEM SHALL 顯示錯誤提示，允許重新輸入，不導向
  `/admin`。
- WHEN `nextLevel !== "aal2"`（帳號未啟用 MFA） THE SYSTEM SHALL 維持既有行為，帳密
  驗證成功後直接導向 `/admin`（無回歸）。

## 驗收標準

- 未啟用 MFA 的帳號登入行為與 TASK-039 完成時完全一致（無回歸）。
- 已啟用 MFA 的帳號，帳密正確後進入 TOTP 驗證步驟，驗證碼正確才真正登入。
- 驗證碼錯誤時顯示錯誤提示且不進入後台，允許重新輸入。
- 未新增任何 RLS policy 層的 `aal2` 強制要求（沿用 feature-spec 已核准的應用層判斷
  決策）。

## 實作備註

- 建議實作完成後，比照既有高風險卡片的既有作法，先用 TASK-043 建立的測試帳號 MFA
  factor 人工核對完整登入流程（未啟用/已啟用兩種情境），不要只依賴自動化測試。

## 驗證契約

- 單元測試：不適用（邏輯高度依賴 Supabase Auth SDK 的即時互動）。
- 整合測試：不易在自動化整合測試中完整模擬真實 TOTP 驗證碼產生，實作階段可用已知
  secret 手動計算 TOTP 碼進行驗證（Supabase Auth 的 TOTP 實作為標準演算法，可用
  `otplib` 等函式庫在測試環境計算，若引入需評估是否只作為 devDependency）；併入
  TASK-045。
- E2E 測試：Browser 工具走查未啟用 MFA 的登入（無回歸）；已啟用 MFA 的登入需要真實
  Authenticator App 或測試環境計算的 TOTP 碼，留給 TASK-045 的手動走查。
- 型別檢查：`npx tsc --noEmit`
- Lint：`npm run lint`
- Build：`npm run build`
- 螢幕截圖：MFA 驗證步驟（含錯誤）、未啟用 MFA 的既有登入流程無回歸對照。
- 安全性檢查：確認 `getAuthenticatorAssuranceLevel()` 判斷邏輯無法被前端繞過跳過
  MFA 步驟直接導向 `/admin`（例如直接改網址列或竄改前端狀態）——雖然本卡未在 RLS
  層強制 `aal2`，但 `is_admin()` 頁面層檢查本身仍會通過（帳密已驗證），這是已核准
  的已知限制，需在完成證據中重新確認並記錄，不視為本卡新增的缺陷。

## 完成證據

- 變更的檔案：
  - `app/login/login-form.tsx`（`handleSubmit` 新增 AAL 判斷分支、新增
    `handleMfaSubmit`／`handleCancelMfa`、新增 MFA 驗證碼輸入畫面 JSX）
  - `tests/components/login-form.test.tsx`（**實作期偏離任務卡「允許變更的檔案」清單**，
    見下方「已知限制」第一項）
- 執行過的指令：
  - `npx tsc --noEmit`：通過
  - `npm run lint`：通過
  - `npm run build`：通過（production build 成功）
  - `npx vitest run tests/components/login-form.test.tsx`：14/14 通過（8 個既有案例 + 6
    個本卡新增的 MFA 案例：顯示驗證碼步驟、AAL 讀取異常 fail closed、找不到已驗證
    factor fail closed、驗證碼錯誤清空與提示、驗證碼正確導向、取消 MFA 以 local scope
    登出）
  - `npx vitest run --pool=forks --poolOptions.forks.singleFork`（全專案）：309/310
    通過，唯一失敗案例 `tests/components/select.test.tsx`（服務項目下拉選單，與本卡
    完全無關）單獨重跑可通過，屬於全套件平行執行時的既有不穩定測試，非本卡回歸
  - Browser 工具對真實 Supabase 專案（`designer001@gmail.com` 測試帳號）完整走查：
    1. 未啟用 MFA：正確密碼登入 → 直接導向 `/admin`（無回歸）
    2. 未啟用 MFA：錯誤密碼登入 → 顯示既有「帳號或密碼錯誤，請再試一次。」（無回歸）
    3. 臨時用帳號設定頁既有 MFA 註冊流程啟用 MFA（測試用手寫 TOTP 演算法計算驗證碼，
       Node.js 內建 `crypto` 模組實作 RFC 6238／HMAC-SHA1，未新增任何 npm 依賴，純
       本地一次性腳本、不在版控內）
    4. 已啟用 MFA：帳密正確後進入「輸入驗證碼」步驟畫面（畫面文案與
       `mockups/auth-flow-variant-a.html` 狀態 4 一致）
    5. 輸入錯誤 6 位數碼 → 顯示「驗證碼錯誤，請重新輸入。」、輸入框清空、標紅
    6. 輸入用密鑰重新計算的正確驗證碼 → 成功導向 `/admin`
    7. 測試完成後於帳號設定頁停用 MFA，測試帳號已恢復回實作前的「未啟用」狀態
- 螢幕截圖：Browser 工具即時走查（見上方步驟 1-6），未另存為獨立檔案——與
  TASK-043 完成證據記錄的已知限制相同（螢幕截圖未存檔可供獨立覆核），非本卡新增的
  流程缺口。
- 三方子代理審查（比照 TASK-043 既有作法）：
  - **architect**：發現既有測試 `tests/components/login-form.test.tsx` 被本卡打壞（mock
    缺 `auth.mfa`，2 案例回歸失敗）、`handleSubmit`／`handleMfaSubmit` 全程無
    try/catch（例外會讓表單永久卡在 loading）、`aalError`／`factorsError` 失敗分支未
    `signOut()` 留下懸空 aal1 session、challenge 失敗誤用「驗證碼錯誤」文案、
    `handleCancelMfa` 缺 loading 狀態與錯誤處理。皆已修正。
  - **security-reviewer**：
    - Critical C1：MFA 步驟顯示後若重新整理頁面，`app/login/page.tsx` 的 `is_admin()`
      檢查不看 aal，會直接把尚未完成 MFA 挑戰的 aal1 session 導向 `/admin`——這正是
      任務卡「安全性檢查」段落已預先核准並要求記錄的已知限制（「確認
      getAuthenticatorAssuranceLevel() 判斷邏輯無法被前端繞過跳過 MFA 步驟直接導向
      /admin」），本卡範圍不含 RLS／`is_admin()` 層級的 aal2 強制檢查，見下方「已知
      限制」與「後續任務」。
    - Critical C2：`aalError`／找不到已驗證 factor 兩條失敗分支原本未登出，已修正為
      顯示錯誤前先 `signOut({ scope: "local" })`，避免懸空 aal1 session。
    - High H1：`handleCancelMfa` 原本用預設 global scope 的 `signOut()`，會撤銷該帳號
      所有裝置的 session，已修正為 `{ scope: "local" }`。
    - Medium M2：`getAuthenticatorAssuranceLevel()` 只讀本地 session，若
      `currentLevel`／`nextLevel` 皆為 `null` 且不報錯，原本的判斷式會被誤判為「未啟用
      MFA」直接放行，已修正為視為異常狀態、fail closed（登出＋顯示錯誤）。
    - 其餘 Low 項目（取消連結送出中應停用、成功後清空密碼欄位等）已一併修正。
  - **test-engineer**：發現 `npm run test` 從未實際執行，既有測試回歸未被察覺；發現
    「單元測試不適用」的判斷不成立，AAL 判斷的 fail-safe 分支可用 mock 完全覆蓋。已
    依建議補上 6 個單元測試案例（見上方「執行過的指令」）。
- 已知限制：
  - **實作期偏離「允許變更的檔案」清單**：任務卡原先只列 `app/login/login-form.tsx`，
    但情境包誤判斷「無對應既有測試檔案」——`tests/components/login-form.test.tsx`
    其實已存在（推測為更早的任務卡建立），本卡新增的 AAL 呼叫使其中 2 個既有案例
    回歸失敗。為符合 Definition of Done「不算完成」條款（測試被打壞不得標記完成），
    已一併修正該測試檔案的 mock（補上 `auth.mfa`／`auth.signOut`）並新增 MFA 相關
    案例，非核准範圍外的功能變更，僅為維持既有測試綠燈與補足新邏輯的測試覆蓋。
  - **Critical（C1，security-reviewer 重新確認，任務卡已預先核准的已知限制，非本卡
    新增缺陷）**：MFA 判斷完全在應用層（登入頁 UI 流程），`is_admin()` 頁面層／RLS
    皆不檢查 aal。除了任務卡原先設想的「攻擊者直接改網址列或竄改前端狀態」，
    security-reviewer 審查進一步指出一個門檻更低的觸發路徑：**使用者在 MFA 驗證碼
    畫面單純重新整理頁面（或關掉分頁重開），`app/login/page.tsx` 的 `is_admin()`
    判斷就會通過並直接導向 `/admin`**，不需要任何攻擊意圖。也就是說，只要密碼正確，
    無論是否通過 MFA 驗證碼，只要在對的時機重新整理頁面就能進入後台——「已啟用
    MFA」目前只保證「正常操作路徑下」會被要求驗證碼，不構成後台存取的實質防護。
    真正修法需要在 `app/login/page.tsx`／`lib/supabase/middleware.ts`／
    `app/admin/layout.tsx` 解析 JWT 的 `aal` claim 才能放行，這些檔案皆不在本卡允許
    變更清單內，且任務卡「假設」段落已明確核准本卡不做 RLS 層 aal2 強制。
  - `mfa.challenge()` 目前每次送出都會建立新 challenge，前端沒有連續失敗次數上限，
    僅依賴 Supabase 伺服器端的 `over_request_rate_limit`（延續 TASK-043 已知限制，
    security-reviewer 指出登入頁是未認證邊界、風險略高於帳號設定頁，建議後續任務卡
    評估前端節流）。
  - 未做真實 Authenticator App 的手動走查（本次用手寫 TOTP 演算法計算，見上方「執行
    過的指令」步驟 3），依任務卡驗證契約留給 TASK-045；建議 TASK-045 額外用第二個
    獨立來源（如 `otplib` 或真實 App）交叉核對同一組 secret 算出同一組碼，不要只信任
    單一手寫腳本。
- 後續任務：
  - TASK-045（整合驗證，含真實 Authenticator App 手動走查完整登入流程）
  - 新任務卡（高優先）：`is_admin()`／RLS 層級的 aal2 強制檢查，讓 MFA 在重新整理頁面
    或直接呼叫 API 的情境下也能真正生效（TASK-043 已知限制 H1 與本卡 C1 皆指向同一
    張後續任務卡，建議合併規劃、盡快排入）
  - 新任務卡（可選）：登入頁 MFA 驗證碼前端節流（連續失敗達到門檻後強制登出並要求
    重新輸入帳密）
