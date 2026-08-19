# AI-Ready 任務卡

## Metadata

- 任務：設計師登入與帳號安全 伺服器端關鍵入口點強制已啟用 MFA 帳號需達 aal2（修正
  TASK-044 C1）
- 上層規格：[`feature-spec.md`](../feature-spec.md)（「安全性與隱私」段落 2026-08-19
  修正記錄）
- 上層 Epic：設計師登入與帳號安全
- 上層 User Story：設計師登入／登出
- 分軌：後端
- 前置任務（dependsOn）：TASK-044
- 狀態：已核准（2026-08-19）
- 風險等級：高（身分驗證核心關卡，邏輯寫錯有兩種相反方向的風險：判斷過嚴會把唯一
  管理員鎖在後台外面（break-glass），判斷過鬆則 MFA 繼續形同虛設，需架構、安全性、
  測試三方審查）

## 目標

在三個伺服器端關鍵入口點（`app/login/page.tsx` 登入後重導向、`lib/supabase/
middleware.ts` 的 `/admin/:path*` 路由守門、`app/admin/layout.tsx` 頁面層檢查）
一致比對 `getAuthenticatorAssuranceLevel()`，讓已啟用 MFA 的帳號在完成 TOTP 驗證
（`aal2`）前無法進入 `/admin`——修正 TASK-044 security-reviewer 發現的 C1：使用者在
登入頁 MFA 驗證碼畫面單純重新整理頁面，就會被 `app/login/page.tsx` 的 `is_admin()`
判斷直接導向 `/admin`，完全繞過尚未完成的 TOTP 驗證。

## 情境包（Context Pack）

- 相關檔案：
  - `app/login/page.tsx`：目前 `user && isAdmin` 就 `redirect("/admin")`，未檢查
    aal，是 C1 的直接成因。
  - `lib/supabase/middleware.ts`（`updateSession`，由 `proxy.ts` 以
    `matcher: ["/admin/:path*"]` 掛載於每個 `/admin/*` 請求）：目前只檢查
    `isAdminRoute && !user`，未呼叫 `is_admin()` 也未檢查 aal。
  - `app/admin/layout.tsx`：目前檢查 `!user` 與 `!isAdmin` 兩者皆
    `redirect("/login")`，是頁面層的第二道防線（與 middleware 各自獨立檢查，屬本專案
    既有的縱深防禦慣例，見該檔案第 12-13 行註解）。
  - `lib/auth/password-strength.ts`／`tests/lib/password-strength.test.ts`：
    `lib/auth/` 目錄與對應 `tests/lib/` 單元測試的既有慣例，本卡新增的 aal 判斷純
    函式比照此處放置。
  - `app/login/login-form.tsx`（TASK-044 已實作）：`handleSubmit` 內已有一份
    fail-closed 的 aal 判斷邏輯（`aalError || !aal || !aal.currentLevel ||
    !aal.nextLevel` 視為異常），本卡新增的伺服器端判斷邏輯需與其保持一致的
    fail-closed 原則，但這是用戶端 SDK 呼叫、無法直接 import 到伺服器端共用，需
    在伺服器端重新實作一份（使用 `@/lib/supabase/server` 或
    `@supabase/ssr` 建立的 server client 呼叫同一支 `auth.mfa.
    getAuthenticatorAssuranceLevel()`）。
- 既有模式：
  - `is_admin()` 頁面層檢查在 middleware 與 layout 各自獨立呼叫一次（縱深防禦，見
    `app/admin/layout.tsx` 第 12-13 行既有註解），本卡的 aal 檢查沿用同一模式，在
    三個入口點各自呼叫，不共用同一次請求結果。
  - `getAuthenticatorAssuranceLevel()` 只讀本地 session（不打伺服器網路請求）——
    TASK-044 security-reviewer 審查已確認（M2 發現），本卡在 middleware 內對每個
    `/admin/*` 請求呼叫不會新增額外的網路延遲或失敗面。
- 假設：
  - 只有「已啟用 MFA」的帳號受本卡影響：`aal.nextLevel === "aal2" &&
    aal.currentLevel !== aal.nextLevel` 才視為「未通過」；未啟用 MFA 的帳號
    `currentLevel === nextLevel`（皆為 `"aal1"`），判斷式視為「已滿足」，登入行為
    不變（已與人工確認）。
  - `currentLevel`／`nextLevel` 任一為 `null`（或呼叫本身報錯）視為異常狀態，
    fail closed（視為「未滿足」，導向 `/login`）——與 TASK-044 `login-form.tsx`
    的既有處理原則一致（見上方「相關檔案」）。
  - 本卡**不**修改個別 RLS policy 或 `admins` 表相關的 SECURITY DEFINER RPC（見
    feature-spec 2026-08-19 修正段落已核准的範圍決策）：後台功能皆透過頁面層 gate
    或 SECURITY DEFINER RPC 存取，範圍僅止於「能不能進入 `/admin` 底下的頁面」，
    不含資料庫層 `auth.jwt()->>'aal'` 檢查。若攻擊者能繞過這三個入口點直接呼叫
    Supabase REST/RPC（不經過 Next.js 應用層），仍不受本卡保護——這是已核准的範圍
    邊界，非本卡缺陷，可視需要另開任務卡評估。
  - `app/login/page.tsx` 在 aal 未滿足時**不**自動接續顯示 MFA 驗證碼輸入步驟，而是
    停留在一般登入表單（`<LoginForm />` 初始狀態），使用者需要重新輸入帳密才能再次
    觸發 `login-form.tsx` 既有的 MFA 挑戰流程——這是已知的 UX 退讓（多打一次密碼），
    換取伺服器端判斷邏輯單純、不需要额外在頁面層還原「使用者上次卡在哪個步驟」的
    狀態，已與人工確認為可接受的最小範圍（不在本卡另做「記住 MFA 進度」的加強）。
- 未知事項：無。
- 允許變更的檔案：
  - `lib/auth/aal.ts`（新增，共用的 aal 判斷純函式）
  - `lib/supabase/middleware.ts`
  - `app/admin/layout.tsx`
  - `app/login/page.tsx`
  - `tests/lib/aal.test.ts`（新增）
- 不得觸碰：
  - `app/login/login-form.tsx`（TASK-044 已完成、已核准，登入頁用戶端的 MFA 挑戰
    UI 流程不在本卡範圍）。
  - `supabase/migrations/`／任何 RLS policy（本卡不做資料庫層變更，見上方「假設」）。
  - `lib/admin/account.ts`（帳號設定頁的 MFA 註冊／停用邏輯不變）。

## 需求

- WHEN 已啟用 MFA 的帳號完成帳密登入但尚未通過 TOTP 驗證（`aal.currentLevel !==
  aal.nextLevel` 且 `aal.nextLevel === "aal2"`）AND 該 session 嘗試存取
  `/admin/:path*` 任一頁面 THE SYSTEM SHALL 在 middleware 層攔截並重導向至
  `/login`，不渲染任何 `/admin` 頁面內容。
- WHEN 已啟用 MFA 但尚未通過 TOTP 驗證的 session 因故繞過 middleware（例如未來
  matcher 設定變動）直接觸發 `app/admin/layout.tsx` 渲染 THE SYSTEM SHALL 在
  layout 層同樣攔截並重導向至 `/login`（與 middleware 各自獨立檢查，縱深防禦）。
- WHEN 已啟用 MFA 但尚未通過 TOTP 驗證的 session 造訪 `/login` THE SYSTEM SHALL
  不自動重導向至 `/admin`（維持顯示登入表單），即使 `is_admin()` 判斷為真。
- WHEN 已啟用 MFA 且已通過 TOTP 驗證（`aal.currentLevel === aal.nextLevel ===
  "aal2"`）的帳號造訪 `/admin/:path*` 或 `/login` THE SYSTEM SHALL 維持既有行為
  （分別正常渲染 `/admin` 頁面、或從 `/login` 自動重導向至 `/admin`），無回歸。
- WHEN 未啟用 MFA 的帳號（`aal.currentLevel === aal.nextLevel === "aal1"`）造訪
  `/admin/:path*` 或 `/login` THE SYSTEM SHALL 維持既有行為，無回歸。
- WHEN `getAuthenticatorAssuranceLevel()` 呼叫本身報錯，或回傳的
  `currentLevel`／`nextLevel` 任一為 `null` THE SYSTEM SHALL 視為異常狀態、
  fail closed（視為「未滿足」，導向 `/login`），不得因為判斷失敗而意外放行。

## 驗收標準

- 重現 TASK-044 C1 的步驟（已啟用 MFA 帳號、帳密登入後在驗證碼畫面重新整理頁面）
  不再導向 `/admin`，而是回到登入表單。
- 已啟用 MFA 且完成 TOTP 驗證的帳號，登入與後續瀏覽 `/admin` 各頁面行為與
  TASK-044 完成時完全一致，無回歸。
- 未啟用 MFA 的帳號，登入與瀏覽 `/admin` 各頁面行為與 TASK-039／TASK-044 完成時
  完全一致，無回歸。
- 未修改任何 RLS policy 或 `admins` 表相關 SECURITY DEFINER RPC（沿用 feature-spec
  已核准的範圍決策）。
- 未把已完成 TOTP 驗證的合法管理員意外鎖在 `/admin` 外面（break-glass 檢查）。

## 實作備註

- 建議先實作 `lib/auth/aal.ts` 的純函式並補齊單元測試，確認三種情境（未啟用 MFA、
  已啟用且已通過、已啟用但未通過、異常狀態 fail closed）的回傳值正確，再接上三個
  呼叫端，降低三處各自重複實作判斷邏輯時出現不一致的風險。
- 建議實作完成後，比照 TASK-044 既有作法，用可即時計算 TOTP 驗證碼的測試帳號
  （沿用 TASK-044 完成證據記錄的走查方式）人工完整走查一次「登入 → MFA 驗證碼畫面
  → 重新整理頁面 → 確認回到登入表單而非 /admin → 重新登入並完成驗證 → 確認可正常
  進入 /admin」，不要只依賴單元測試。
- 務必額外走查一次「未啟用 MFA 的既有帳號」完整登入與後台瀏覽流程，確認無回歸
  （break-glass 檢查的一部分：先確認唯一的實際管理員帳號目前是否已啟用 MFA，若已
  啟用需特別小心測試順序，避免測試過程中意外把自己鎖在外面）。

## 驗證契約

- 單元測試：`tests/lib/aal.test.ts` 涵蓋 `lib/auth/aal.ts` 的純函式，mock
  `supabase.auth.mfa.getAuthenticatorAssuranceLevel()` 各種回傳情境（未啟用 MFA、
  已啟用且已通過 aal2、已啟用但未通過、`error` 非空、`currentLevel`／
  `nextLevel` 任一為 `null`）。
- 整合測試：不易在自動化整合測試中模擬完整的 Next.js middleware／server component
  重導向鏈路（專案目前對 `is_admin()` 既有 gate 邏輯也沒有此類測試，見
  `app/admin/layout.tsx`／`lib/supabase/middleware.ts` 現況），依專案既有慣例改以
  下方 E2E／手動走查覆蓋。
- E2E／手動測試：Browser 工具走查「實作備註」列出的兩個情境（已啟用 MFA 的重現
  C1 步驟＋完整正常登入、未啟用 MFA 的無回歸）。
- 型別檢查：`npx tsc --noEmit`
- Lint：`npm run lint`
- Build：`npm run build`
- 螢幕截圖：MFA 驗證碼畫面重新整理後回到登入表單（而非誤入 `/admin`）、已完成
  TOTP 驗證後正常進入 `/admin`、未啟用 MFA 帳號登入無回歸對照。
- 安全性檢查：確認三個入口點的判斷邏輯一致、皆為 fail closed；確認
  `app/login/login-form.tsx` 既有的用戶端 MFA 挑戰流程與本卡新增的伺服器端判斷
  邏輯搭配後，使用者體驗上仍能完整走完「登入 → MFA 驗證碼 → 進入 /admin」的正常
  路徑（不會因為伺服器端判斷過嚴而把完成驗證的合法使用者也擋下來）。

## 完成證據

- 變更的檔案：
  - `lib/auth/aal.ts`（新增，`isAalSatisfied(supabase, user)` 共用純函式）
  - `lib/supabase/middleware.ts`（`/admin/:path*` 路由守門新增 aal 檢查，並抽出
    `redirectToLogin()` 內部函式統一處理重導向時的 cookie 複製）
  - `app/admin/layout.tsx`（`is_admin()` RPC 之前新增 aal 檢查）
  - `app/login/page.tsx`（登入後自動重導向邏輯新增 aal 檢查）
  - `tests/lib/aal.test.ts`（新增，9 個單元測試案例）
- 執行過的指令：
  - `npx tsc --noEmit`：通過
  - `npm run lint`：通過
  - `npm run build`：通過（production build 成功）
  - `npx vitest run tests/lib/aal.test.ts tests/components/login-form.test.tsx`：
    23/23 通過（`aal.test.ts` 9 案例 + `login-form.test.tsx` 14 案例，後者確認
    TASK-044 既有的用戶端 MFA 挑戰流程未受影響）
  - Browser 工具對真實 Supabase 專案（`designer001@gmail.com` 測試帳號）完整走查：
    1. 未啟用 MFA：正確密碼登入成功進入 `/admin`（無回歸）
    2. 臨時啟用 MFA（帳號設定頁既有註冊流程，手寫 TOTP 演算法算驗證碼）
    3. 登出重新登入，帳密正確後進入 MFA 驗證碼畫面，**重新整理頁面**（重現
       TASK-044 C1 的步驟）→ 停留在 `/login`，未被導向 `/admin`
    4. 在 aal1-pending 狀態下直接網址列輸入 `/admin` → 同樣被 middleware 擋下導向
       `/login`
    5. 重新登入，輸入正確驗證碼完成 MFA → 成功進入 `/admin`，並可正常瀏覽
       `/admin/account` 子頁面（layout 層沒有誤擋合法 session）
  - **PoC 攻擊驗證**（因 security-reviewer 第一輪審查發現原始實作可被繞過，額外
    執行）：登入已啟用 MFA 帳號取得 aal1 session（尚未完成 TOTP 驗證），用瀏覽器
    JS 讀出、解碼 `sb-*-auth-token` cookie（格式為 `base64-` + base64 JSON），將
    `user.factors` 竄改為空陣列後寫回 cookie，導航至 `/admin`——修正後的實作正確
    導向 `/login`，證明不再信任本地可竄改的 cookie 快取資料。
  - 測試完成後已停用 MFA，測試帳號恢復原「未啟用」狀態。
- 螢幕截圖：Browser 工具即時走查（見上方步驟 1-5 與 PoC 驗證），未另存為獨立檔案
  ——與 TASK-043／TASK-044 完成證據記錄的已知限制相同（目前使用的 Browser 工具
  無法把截圖存成獨立檔案供事後覆核），非本卡新增的流程缺口。已請 test-engineer
  於複審時確認此限制不構成本卡完成的阻斷項（見下方三方審查記錄）。
- 三方子代理審查（比照 TASK-043／TASK-044 既有作法，因發現嚴重問題共進行兩輪）：
  - **architect**（第一輪）：發現 `isAalSatisfied` 全程無 try/catch（例外會讓
    middleware 對 `/admin` 的每個請求變成 500，而非預期的 fail closed 導向
    `/login`）、`middleware.ts` 的重導向遺失刷新後的 cookie、`app/admin/layout.tsx`
    應把本地判斷放在 `is_admin()` RPC 之前以節省不必要的網路往返。皆已修正。
  - **security-reviewer**（第一輪，Critical）：發現原始實作用
    `getAuthenticatorAssuranceLevel()` 不帶 jwt 版本的 `nextLevel`——該值從本地
    未經伺服器驗證的 cookie 快取（`session.user.factors`）算出，攻擊者竄改 cookie
    即可繞過，C1 **實際上並未修好**。已重新設計為用呼叫端本來就會呼叫的
    `getUser()`（伺服器驗證過的權威資料）判斷是否需要 aal2，不再信任本地快取。
  - **test-engineer**：發現螢幕截圖未存成獨立檔案（見上方「螢幕截圖」段落說明）；
    其餘（單元測試、tsc/lint/build、E2E 兩情境）符合驗證契約。
  - **security-reviewer**（第二輪複審）：確認修正後的邏輯確實解決 C1（三個入口點
    的 `user` 皆來自呼叫端已驗證過的 `getUser()`，無繞過路徑；`currentLevel` 的
    本地解碼安全性建立在「同一個 access_token 已被 `getUser()` 驗證過」之上，
    順序不可調換）；F1／F2 修正正確；結論：**通過，可進入 verify 階段**。另指出
    一項殘留風險（見下方已知限制）。
- 已知限制：
  - **[High，已核准的範圍邊界，非本卡缺陷]**：本卡的 aal 檢查只在應用層的三個
    路由／頁面入口點生效，`is_admin()` 與所有 RLS policy 皆未檢查 `aal`。持有
    aal1 access_token（合法登入但尚未完成 MFA）的攻擊者，若不經過這三個入口點、
    直接呼叫 Supabase PostgREST/RPC/Storage API，仍可讀寫全部後台資料——這與
    TASK-043 完成證據記錄的已知限制 H1 是同一個問題，任務卡「假設」段落已明確
    核准本卡不處理這塊（見「後續任務」）。
  - MFA 驗證碼前端仍無連續失敗次數上限（延續 TASK-043／TASK-044 已知限制）。
  - `middleware.ts` 的 `isAdminRoute` 判斷用 `pathname.startsWith("/admin")`，若
    未來新增以 `/admin` 開頭但語意不同的路徑（例如 `/administrators`）會被誤判
    為受保護路由——目前專案沒有這類路徑，暫不處理，architect 複審時建議記錄。
- 後續任務：
  - 【高優先，合併 TASK-043 H1 與本卡殘留風險】新任務卡：評估並實作
    `is_admin()`／RLS policy 層級的 `auth.jwt()->>'aal' = 'aal2'` 強制檢查，讓
    已啟用 MFA 的帳號在直接呼叫 Supabase API（不經過 Next.js 應用層）時也真正
    受到保護。
  - 沿用 TASK-045：整合驗證，含真實 Authenticator App 手動走查完整登入流程。
