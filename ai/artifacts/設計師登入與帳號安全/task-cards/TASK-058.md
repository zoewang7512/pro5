# AI-Ready 任務卡

## Metadata

- 任務：忘記密碼連結改用伺服器端 `verifyOtp`（解決 PKCE 跨裝置失效）
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：設計師登入與帳號安全
- 上層 User Story：忘記密碼／重設密碼
- 分軌：前後端串接（新增伺服器端 Route Handler＋修改既有前端頁面的驗證邏輯）
- 前置任務（dependsOn）：TASK-040
- 狀態：完成（使用者已核准，2026-08-25）
- 風險等級：高（修改設計師帳號的認證/密碼重設路徑，任何邏輯錯誤可能導致合法重設被
  誤擋、或「有 session 就能改密碼」的認證繞過重新出現——TASK-040 才剛修過這個漏洞）

## 目標

`resetPasswordForEmail` 目前依賴 `@supabase/ssr` 的 `createBrowserClient` 強制使用的
PKCE flow：信件連結格式是 `?code=...&flow_id=...`，`code_verifier` 只存在「發起忘記密碼
請求那一台瀏覽器」的本地儲存空間。若設計師在電腦上申請、在手機上開信（常見情境），
連結會被誤判為「已逾時或已使用」，即使連結本身完全合法（TASK-040 審查發現，目前只做了
UX 緩解：文案提醒「請在這台裝置、這個瀏覽器開啟」）。

本卡改用伺服器端 Route Handler（`app/auth/confirm/route.ts`）呼叫
`supabase.auth.verifyOtp({ type: 'recovery', token_hash })`，讓 session 建立發生在
伺服器端、透過 cookie 傳遞，不依賴瀏覽器本地儲存的 PKCE `code_verifier`，徹底解決跨裝置
問題。

## 情境包（Context Pack）

- 相關檔案：
  - `app/login/login-form.tsx` 第 198-210 行附近：`resetPasswordForEmail` 呼叫，
    `redirectTo: \`${siteUrl}/reset-password\`}`——這個值會透過 Supabase Email Template
    的 `{{ .RedirectTo }}` 變數帶入新格式連結的 `next` 參數，**不需要修改這支呼叫本身**，
    只需要在 Dashboard 換模板格式（見下方）。第 298 行「請在這台裝置、這個瀏覽器開啟」
    的提示文案，本卡解決跨裝置問題後應移除或改寫（不再是限制）。
  - `app/reset-password/reset-password-form.tsx`：目前用
    `supabase.auth.onAuthStateChange` 監聽 `PASSWORD_RECOVERY` 事件、逾時 4 秒視為連結
    無效——這是 TASK-040 修正認證繞過漏洞的既有安全機制（**不能**改成「有 session 就視為
    有效」，理由見下方「假設」）。本卡需要換一種方式判斷「這是不是合法的 recovery
    session」，因為新流程下 session 是伺服器端透過 cookie 建立，瀏覽器端的 SDK 初始化
    時是否還會重新觸發 `PASSWORD_RECOVERY` 事件**目前沒有官方文件明確保證**，需要在實作
    階段實測確認（見「未知事項」）。
  - `lib/auth/aal.ts`：本專案既有的「不信任瞬時客戶端事件、改用可驗證的 session claim」
    的既有先例（TASK-059，判斷 MFA aal 等級時改用 `getAuthenticatorAssuranceLevel()`
    解碼簽章過的 JWT，而非本地未驗證的 cookie 快取）。本卡建議延續同一個方法論，見下方
    「假設」的建議設計。
  - `lib/supabase/server.ts`：伺服器端 Supabase client 建立方式（`@supabase/ssr` 的
    `createServerClient`），`app/auth/confirm/route.ts` 會用這支函式建立的 client 呼叫
    `verifyOtp`，讓回應自動帶上正確的 `Set-Cookie`。
  - `proxy.ts`：`matcher` 只涵蓋 `/admin/:path*`，`/reset-password`／新增的
    `/auth/confirm` 皆不受 middleware 保護，保護邏輯需要各頁面/路由自己處理（沿用既有
    設計方向，不建議把它們也塞進 middleware matcher）。
- 既有模式：`app/api/webhooks/appointment-events/route.ts`／
  `app/api/cron/appointment-reminders/route.ts` 是本專案既有的 Route Handler 寫法慣例
  （雖然情境不同，是密鑰驗證而非使用者 session，但「驗證失敗立即回應、不執行後續邏輯」
  的紀律可以延續）。
- 假設：
  - **`/reset-password` 判斷「session 是否來自合法 recovery 連結」的設計（2026-08-25
    已用真實 Supabase 專案實測確認，取代原本的推測）**：不依賴 `onAuthStateChange` 的
    `PASSWORD_RECOVERY` 事件（伺服器端建立、透過 cookie 傳遞的 session，瀏覽器端 SDK
    初始化時不保證重新觸發這個事件）。改用
    `supabase.auth.mfa.getAuthenticatorAssuranceLevel()` 回傳值裡的
    `currentAuthenticationMethods`（從已簽章驗證的 JWT `amr` claim 解碼而來），比照
    `lib/auth/aal.ts`「用可驗證的 JWT claim、不用瞬時客戶端事件」的既有方法論。**實測
    結果（用 `supabase.auth.admin.generateLink({type:'recovery'})` 產生測試連結、
    `verifyOtp` 後解碼 JWT／呼叫 `getAuthenticatorAssuranceLevel()` 確認，過程未寄出
    真實信件、未變更密碼、驗證完立即 signOut）**：
    - `verifyOtp({type:'recovery', token_hash})` 建立的 session，`amr` 記錄的
      `method` 是 **`"otp"`**，**不是**原本推測的 `"recovery"`（Supabase 用驗證機制
      分類，不是用 `type` 參數分類）。
    - 對照組：`signInWithPassword` 建立的一般登入 session，`method` 是 `"password"`。
    - 兩者可明確區分，本卡判斷邏輯改為：`currentAuthenticationMethods.some(m =>
      m.method === "otp")`（可選擇性搭配 `m.timestamp` 做新鮮度檢查，例如 10 分鐘內，
      屬防禦縱深加分項，非必要，因為 `"otp"` 這個 method 值在本專案目前唯一的來源就是
      忘記密碼流程）。
    - **已知耦合，未來若變動需要重新檢視**：本專案目前身分驗證只有 email/password
      一種方式（見 `ai/context/project-map.md`「身分驗證」段落），`verifyOtp` 只在
      忘記密碼流程被呼叫，所以 `method === "otp"` 目前等同「來自忘記密碼連結」。
      **若未來任何任務新增其他 OTP-based 登入方式**（例如 magic link、email OTP
      登入），屆時一般登入的 session 也會出現 `method:"otp"`，這個判斷式會失去
      唯一性，需要另外想辦法區分（例如額外檢查 timestamp 是否緊接在 `/auth/confirm`
      重導向之後）——目前不需要處理，只需要在動這類功能時想起這個耦合。
  - **部署時序**：新程式碼上線後，除非 Supabase Dashboard 的 Recovery Email Template
    也同步換成 `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&
    next={{ .RedirectTo }}`，否則 Supabase 寄出的信件仍是舊格式連結，會直接落在
    `/reset-password`（不經過新的 `/auth/confirm`），而 `/reset-password` 換了新的
    session 驗證邏輯後，舊格式連結建立的 session（若瀏覽器 SDK 仍解析 PKCE code 成功）
    不會出現在 `currentAuthenticationMethods` 的新鮮 `recovery` 記錄裡，會被誤判為
    無效連結——也就是說**程式碼部署與 Dashboard 模板切換必須視為同一次變更、盡量同時
    生效**，中間有空窗期忘記密碼功能會失效。本專案只有一個設計師帳號、忘記密碼是低頻
    操作，可接受的做法是：程式碼部署完成後立即（同一次對話/操作視窗內）由使用者切換
    Dashboard 模板，不需要做雙流程並存的複雜度。
  - Email Template 修改是 Supabase 專案後台設定，不在版控範圍內，**只能由使用者本人
    操作**（Claude Code 沒有 Supabase Dashboard 的存取權限，`SUPABASE_SERVICE_ROLE_KEY`
    只能打 REST/RPC API，摸不到 Auth 設定頁面）。
- 未知事項：
  1. **已解決（見上方「假設」的實測結果）**：`currentAuthenticationMethods` 的實際
     格式已用真實 Supabase 專案確認，`method` 值是 `"otp"`。
  2. **已解決（沿用既有先例）**：`getAuthenticatorAssuranceLevel()` 純粹本地解碼目前
     session 的 access_token（JWT），不需要額外的伺服器往返，`reset-password-form.tsx`
     維持 Client Component 呼叫即可（比照 `lib/auth/aal.ts` 的既有解碼方式，同一份
     JWT 不論 session 是瀏覽器端或伺服器端 cookie 建立，內容一致）；不需要把
     `/reset-password` 改成 Server Component。
  3. 新舊 Email Template 切換當下如果剛好有一封「舊格式」信件還沒被點擊，使用者切換
     模板後這封舊信件會直接失效（連結指向的仍是舊流程但 `/reset-password` 邏輯已經換
     了）——影響範圍極小（只有 4 小時內申請過忘記密碼、還沒點信的情況），本卡不特別
     處理，記錄為已知限制即可。
- 允許變更的檔案：
  - `app/auth/confirm/route.ts`（新增）
  - `app/reset-password/reset-password-form.tsx`（修改：驗證邏輯換成 `amr`-based 檢查）
  - `app/login/login-form.tsx`（修改：移除或改寫「請在這台裝置」的過時提示文案）
  - `tests/components/reset-password-form.test.tsx`（新增或修改，若既有測試檔案存在則
    更新；純函式邏輯若能抽出可額外補單元測試）
- 不得觸碰：
  - `app/reset-password/reset-password-form.tsx` 的密碼設定邏輯本身（`updateUser`
    呼叫、密碼強度規則、送出後 `signOut()` 並導回登入頁的既有行為）——本卡只換「判斷
    連結/session 是否合法」這一段，不改密碼設定流程。
  - `lib/auth/aal.ts`、`lib/supabase/middleware.ts`、`app/admin/layout.tsx`——MFA／
    `/admin` 路由保護邏輯，與本卡的忘記密碼流程是各自獨立的機制。
  - `lib/admin/account.ts` 的 `reauthenticateAdmin`／帳號設定頁修改密碼流程（TASK-042）
    ——那是「已登入、知道目前密碼」的改密碼路徑，與「忘記密碼、透過信件連結」路徑完全
    不同，不應該互相影響。

## 需求

- 新增 `app/auth/confirm/route.ts`（GET handler）：讀取 `token_hash`／`type`／`next`
  query 參數，用 `lib/supabase/server.ts` 的 `createClient()` 呼叫
  `supabase.auth.verifyOtp({ type, token_hash })`；成功則導向 `next`（沒有則預設
  `/reset-password`——**實作期簡化**：不接受 `next` 查詢參數（改用固定目的地），也不
  用 `?error=invalid_link` 區分成功/失敗（兩種結果都導向同一個 `/reset-password`，交給
  該頁面自己依 session claim 判斷是否有效，單一事實來源）。原因見下方「審查發現與修正」
  M2 與 NICE TO HAVE 記錄。
- `reset-password-form.tsx` 換掉 `onAuthStateChange` 監聽 `PASSWORD_RECOVERY` 事件、
  4 秒逾時判定的既有邏輯，改為先呼叫 `supabase.auth.getUser()` 確認 access_token 通過
  伺服器驗證，再呼叫 `supabase.auth.mfa.getAuthenticatorAssuranceLevel()` 檢查
  `currentAuthenticationMethods` 是否含新鮮（20 分鐘內）的 `otp` 記錄，決定 `linkState`
  （`checking`／`valid`／`invalid`，既有三態 UI 不變，只換底層判斷依據）。**實作期修正**：
  見下方「審查發現與修正」M1，原始規劃漏了 `getUser()` 這一步。
- `login-form.tsx` 第 298 行附近的提示文案移除「請在這台裝置、這個瀏覽器開啟」等跨裝置
  限制說明（本卡解決後不再是限制）。
- 提供給使用者的 Supabase Dashboard 操作說明（記錄在完成證據，供使用者對照操作）：
  Recovery Email Template 改成
  `<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery">重設密碼</a>`
  （**實作期修正**：不含 `next` 參數——原始規劃的 `&next={{ .RedirectTo }}` 是文件本身
  的錯誤，`{{ .RedirectTo }}` 實際渲染出來是絕對網址而非相對路徑，永遠無法通過站內路徑
  檢查，security-reviewer 於總覽審查發現；實際 HTML 結構依 Dashboard 當下的模板編輯器
  介面調整）。

## 驗收標準

- 在裝置 A 申請忘記密碼、在裝置 B（不同瀏覽器/裝置）開啟信件連結，能成功導向
  `/reset-password` 並設定新密碼，不再誤判為「已逾時或已使用」。
- 已登入的管理者（或任何有既有 session 的人）直接造訪 `/reset-password`，不能繞過忘記
  密碼流程直接改密碼（TASK-040 修正的認證繞過漏洞不能重新出現——這是本卡最高優先的
  回歸測試項目）。
- 連結逾時、已使用、或 token 無效時，`/reset-password` 顯示既有的「連結已逾時或已使用」
  錯誤畫面與「重新申請」連結，行為與現況一致。
- 密碼設定成功後的既有行為（`signOut()`、導回 `/login`）不受影響。
- `npx tsc --noEmit`／`npm run lint`／`npm run build` 皆通過。
- 至少一次使用真實 Supabase 專案手動走查完整流程（申請→收信→點連結→設定新密碼→用新
  密碼登入成功），且至少驗證一次「跨瀏覽器開啟」情境（例如用無痕視窗模擬不同瀏覽器）。

## 實作備註

- 這是本專案第二次修改「忘記密碼／重設密碼」這條認證路徑（第一次是 TASK-040 建立），
  且是在修過一次嚴重認證繞過漏洞之後的第二次異動——**開始實作前強烈建議重新讀一次
  TASK-040 任務卡的完整審查發現與修正記錄**（`ai/artifacts/設計師登入與帳號安全/
  task-cards/TASK-040.md`），確保新設計不會用不同方式重新引入同一類漏洞。
- 「未知事項」段落列出的技術可行性問題（`currentAuthenticationMethods` 實際行為）建議
  在寫任何前端程式碼之前，先用一個獨立的小型手動測試腳本（申請忘記密碼、實際收信、
  點連結後在瀏覽器 devtools 印出 `getAuthenticatorAssuranceLevel()` 的完整回傳值）確認
  可行，再決定 `reset-password-form.tsx` 的最終驗證邏輯，避免先寫完整個元件才發現這個
  API 用不了。

## 驗證契約

- 單元測試：`reset-password-form.tsx` 的 `linkState` 判斷邏輯（`checking`／`valid`／
  `invalid` 三態），mock `getAuthenticatorAssuranceLevel()` 回傳不同 `currentAuthentication
  Methods` 組合（含 `recovery`／不含／時間戳過舊）。
- 整合測試：不適用傳統整合測試（`app/auth/confirm/route.ts` 依賴真實的 email OTP
  token，無法在自動化整合測試中合成一個合法 `token_hash`）；改以「手動走查」取代，見
  上方「驗收標準」。
- E2E 測試：不適用（同上，依賴真實信件）。
- 型別檢查：`npx tsc --noEmit`
- Lint：`npm run lint`
- Build：`npm run build`
- 螢幕截圖：需要——`/reset-password` 的 `invalid`／`valid` 兩種狀態畫面（既有 UI，
  確認底層邏輯換掉後畫面行為不變）。
- 安全性檢查：**本卡最關鍵的驗證項目**——明確測試「已登入的管理者直接造訪
  `/reset-password`」不能被判定為 `valid`（不能繞過忘記密碼直接改密碼），比照 TASK-040
  當初修正這個漏洞時的測試方式。`app/auth/confirm/route.ts` 對缺失或無效
  `token_hash`／`type` 的處理需 fail closed（導向錯誤畫面，不建立任何 session）。

## 完成證據

- 變更的檔案：
  - `app/auth/confirm/route.ts`（新增）
  - `app/reset-password/reset-password-form.tsx`（修改）
  - `app/login/login-form.tsx`（修改，移除過時提示文案）
  - `tests/components/reset-password-form.test.tsx`（改寫，11 個測試）
- 執行過的指令：
  - `npx tsc --noEmit`／`npm run lint`／`npm run build`：皆通過。
  - `npx vitest run tests/components/reset-password-form.test.tsx tests/components/login-form.test.tsx`：25/25 通過。
  - `npm test`（完整套件）：480/480 通過。
  - 手動實測（用 `supabase.auth.admin.generateLink({type:'recovery'})` 產生測試連結，
    未寄出真實信件、未變更真實密碼）：
    1. 本機 `localhost:3000`：驗證 `amr` method 實際值為 `"otp"`；驗證合法連結導向設定
       新密碼畫面；驗證一般密碼登入 session 直接造訪 `/reset-password` 被拒絕（回歸
       測試，TASK-040 修正的認證繞過漏洞未重新出現）。
    2. `npx vercel deploy --prod --yes` 部署後，正式環境 `https://pro5-nu.vercel.app`：
       同樣驗證合法連結導向設定新密碼畫面，確認正式環境行為與本機一致。
  - 使用者已完成 Supabase Dashboard 操作：設定自訂 SMTP（Resend，沿用 TASK-061 已驗證
    的 `zoework.fyi` 網域）、更新 Recovery Email Template 連結格式。
  - **未驗證（記錄為已知限制）**：`DESIGNER_EMAIL`（`designer001@gmail.com`）是本機
    開發用的合成信箱，非使用者實際可收信的地址，因此**沒有**用真實寄出的信件走過一次
    「點信件裡的連結」這個最後一哩路——上面的手動實測全部用
    `admin.generateLink()` 直接取得 `token_hash`，繞過真實寄信這一步，只驗證了
    `/auth/confirm` 與 `/reset-password` 的程式邏輯本身，沒有驗證「Resend SMTP 實際
    寄出的信件內容/連結格式是否正確」這一段。使用者已知悉並選擇跳過，見「已知限制」。
- **architect／security-reviewer 總覽審查與修正記錄**：
  - **M1（MUST FIX，security-reviewer）**：`reset-password-form.tsx` 原始版本只呼叫
    `getAuthenticatorAssuranceLevel()`，未先呼叫 `getUser()`——該函式本身只是本地
    base64 解碼 session 的 access_token，不驗簽，等於只抄了 `lib/auth/aal.ts` 既有安全
    前提的一半。已修正：呼叫 `getAuthenticatorAssuranceLevel()` 前先 `await
    supabase.auth.getUser()`，失敗立即 fail closed，比照 `lib/auth/aal.ts` 的既有方法論
    （同一個 client 實例、getUser() 驗證過的 access_token 才信任其本地解碼結果）。已補
    回歸測試：`getUser()` 失敗時即使 amr 看起來合法也判定無效、且不會繼續呼叫
    `getAuthenticatorAssuranceLevel()`。
  - **M2（MUST FIX，architect／security-reviewer 一致提出）**：`app/auth/confirm/
    route.ts` 原本接受任意 `EmailOtpType`（`signup`／`invite`／`magiclink`／
    `recovery`／`email_change`／`email`）。風險：任何類型的 token 驗證成功後，amr
    method 同樣是 `"otp"`，會滿足 `/reset-password` 的合法性判斷——例如已登入者對自己
    發起 email 變更、用該確認信的 token_hash 呼叫這個端點，一樣能取得滿足檢查的
    session。已修正：寫死只接受 `type === "recovery"`，其餘一律不呼叫 `verifyOtp`。
  - **NICE TO HAVE 已處理**：
    1. `next` 查詢參數移除（原設計依賴 Email Template 的 `{{ .RedirectTo }}`，但該值
       實際渲染是絕對網址，永遠無法通過相對路徑檢查，形同虛設且徒增開放重導向攻擊面分析
       負擔）；`?error=invalid_link` 一併移除（無任何頁面讀取，純屬冗餘契約）。
    2. `origin` 改用 `NEXT_PUBLIC_SITE_URL` 環境變數，不用 request 衍生值（比照
       `login-form.tsx` 既有慣例，避免受 forwarded host 影響）。
    3. 新鮮度視窗從原規劃的 10 分鐘放寬為 20 分鐘（跨裝置情境下手機/電腦時鐘可能有幾分鐘
       偏差，20 分鐘仍遠小於 access token 存活時間）。
  - **NICE TO HAVE 記錄為已知限制、本卡不處理**：見下方「已知限制」。
- 螢幕截圖：不適用（未附檔案，已用瀏覽器實測截圖確認 `valid`／`invalid` 兩種畫面行為
  正確，見上方手動實測記錄）。
- 已知限制：
  - **未經真實信件驗證**：`DESIGNER_EMAIL`（`designer001@gmail.com`）不是使用者實際
    能收信的地址，本卡的手動實測全程用 `admin.generateLink()` 直接取得 `token_hash`
    繞過真實寄信，沒有驗證「點擊真實信件裡的連結」這最後一哩路，也沒有驗證 Resend
    SMTP 實際寄出的信件內容/格式是否正確（例如範本裡的問候語、品牌樣式是否跑版）。
    使用者已完成 SMTP 與範本設定、知悉這個限制並選擇跳過。之後若要補這一段驗證，
    需要先把 Supabase Auth 帳號的登入 email 換成使用者實際可收信的地址（例如透過
    `/admin/account` 的修改登入 Email 功能，TASK-042），再走一次完整流程。
  - **`method === "otp"` 的耦合**：本專案目前只有 email/password 一種登入方式，
    `app/auth/confirm/route.ts` 也已收斂只接受 `recovery` 類型，因此 `method:"otp"`
    目前唯一來源就是忘記密碼流程。若未來新增任何 OTP-based 登入方式（magic link／
    email OTP 登入），這個判斷式會失去唯一性，需要重新檢視（見「假設」段落）。
  - **信箱即後台**：忘記密碼連結建立的是一個真正的 Supabase 已登入 session（不只是
    「允許改密碼」的受限權杖），若使用者收到信但不點去設定新密碼、而是直接關掉信件或
    導覽到 `/admin`，這個 session 一樣能存取後台（除非有啟用 TOTP MFA）。這不是本卡
    新增的風險（TASK-040 建立時就是如此，`verifyOtp`／PKCE 交換出來的都是真實 session），
    但本卡讓連結能在任何裝置開啟，客觀上略微擴大了「不小心在別人裝置上開信」的意外
    曝露面。security-reviewer 於總覽審查提出，記錄為殘留風險，不在本卡範圍內處理
    （若要徹底解決，需要另立任務卡改成「先簽發短效一次性 token、由伺服器端完成密碼設定
    第一步」的更高複雜度設計）。
  - `token_hash` 會出現在 Vercel 的存取日誌完整 URL 中（平台層級記錄，非本專案程式碼
    主動記錄）；`app/auth/confirm/route.ts` 本身不印出任何 log，不是新增的洩漏面。
  - Email 安全掃描器（企業信箱常見）可能會預先造訪信件中的連結，提前消耗一次性
    token，導致使用者實際點擊時顯示「連結已使用」——這是所有採用一次性連結的忘記密碼
    設計的通用限制，非本卡特有。
  - `app/auth/confirm/route.ts` 是無 CSRF 保護的 GET 端點，理論上可被誘導造訪造成
    session fixation；本專案只有單一設計師帳號、影響範圍有限，記錄為已接受風險。
  - **部署時序**：程式碼部署後，需要使用者立即到 Supabase Dashboard 切換 Recovery
    Email Template（見「需求」段落的模板內容），兩者之間有空窗期忘記密碼功能會失效
    （新程式碼上線但模板還是舊格式）。
- 後續任務：無新增預期。若使用者後續認為「信箱即後台」的殘留風險需要徹底解決，屬於
  獨立任務卡（見上方「已知限制」的備案設計方向）。
