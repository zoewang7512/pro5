# AI-Ready 任務卡

## Metadata

- 任務：設計師登入與帳號安全 帳號設定：MFA 註冊與停用（含 OTP 驗證碼輸入元件）
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：設計師登入與帳號安全
- 上層 User Story：設定雙重驗證（MFA）
- 分軌：前端
- 前置任務（dependsOn）：TASK-038
- 狀態：待人工驗收（Verify）——實作、自我驗證（tsc/lint/test/build、Browser 工具對真實
  Supabase 走查）、architect／security-reviewer／test-engineer 三方審查與審查發現的修正
  皆已完成
- 風險等級：高（MFA 是帳號的第二層保護，註冊/停用流程的任何邏輯缺陷（例如停用不需要
  身分驗證、註冊流程留下未驗證但已啟用的 factor）都直接影響帳號安全，需架構、安全性、
  測試三方審查）

## 目標

在帳號設定頁接上「雙重驗證（MFA）」卡片的實際行為：未啟用時可啟動 TOTP 註冊流程（QR
Code＋驗證碼確認），已啟用時可停用（需再次身分驗證）。新做 OTP 驗證碼輸入元件（本卡
建立，供本卡與 TASK-044 登入 MFA 挑戰步驟共用）。

## 情境包（Context Pack）

- 相關檔案：
  - `app/admin/_components/AccountSettingsView.tsx`（TASK-038 骨架，本卡接上 MFA 卡片）
  - `lib/admin/account.ts`（本卡新增 `enrollMfa()`／`verifyMfaEnrollment(factorId, code)`／
    `cancelMfaEnrollment(factorId)`／`unenrollMfaWithPasswordAndCode(password, factorId,
    code)`／`listMfaFactors()`，皆為 Supabase Auth `mfa.*` API 的薄封裝；`unenrollMfaWith
    PasswordAndCode` 的簽名與原先規劃的「密碼或驗證碼二選一」不同，見下方「假設」段落
    與完成證據的實作期偏離紀錄）
  - `ai/artifacts/設計師登入與帳號安全/mockups/account-settings-variant-a.html`：狀態 3
    「MFA 註冊中（QR Code）」、狀態 4「MFA 已啟用／停用二次確認」為本卡對應畫面。
- 既有模式：
  - `components/ui/ConfirmDialog.tsx`：MFA 停用二次確認直接重用，`children` 插槽放入
    「輸入目前密碼或驗證碼」的表單欄位（比照 `BusinessHoursForm.tsx` 受影響預約警告的
    `children` 插槽既有用法）。
- 假設：
  - `mfa.enroll({ factorType: "totp" })` 回傳 QR Code（`totp.qr_code`，SVG 格式）與
    密鑰文字（`totp.secret`）；本卡直接渲染 SDK 回傳的 QR Code，不自行產生 QR Code
    圖像。
  - 驗證碼確認流程：`mfa.challenge({ factorId })` 取得 `challengeId`，再
    `mfa.verify({ factorId, challengeId, code })` 驗證使用者輸入的 6 位數碼；驗證成功
    該 factor 狀態轉為 `verified`。
  - 使用者在註冊過程中點擊「取消」時，若已呼叫 `mfa.enroll()` 但尚未完成 `verify`，
    THE SYSTEM SHALL 呼叫 `mfa.unenroll({ factorId })` 移除該未完成驗證的 factor，
    避免殘留半成品 factor（`unverified` 狀態的 factor 若殘留，可能造成使用者困惑或
    未來重複註冊時的邊界案例）。
  - 【實作期已修正，見完成證據】原假設：停用 MFA 需要求輸入「目前密碼」（重用 TASK-042
    建立的密碼驗證方式）**或**輸入當前有效的 TOTP 驗證碼二選一，若時間有限可先只做密碼
    驗證。實測發現純密碼驗證在真實 Supabase 環境下因 aal2 要求會 100% 失敗（功能性錯誤，
    非取捨），且 security-reviewer 審查建議只用驗證碼會讓「持有裝置的人」單獨即可停用、
    防護不足，因此最終實作為「目前密碼」**與**「目前驗證碼」兩者皆須通過（缺一不可），
    詳見 `lib/admin/account.ts` `unenrollMfaWithPasswordAndCode` 的完整說明。
- 未知事項：無。
- 允許變更的檔案：
  - `app/admin/_components/AccountSettingsView.tsx`
  - `lib/admin/account.ts`
  - `components/ui/OtpInput.tsx`（新增，6 格 OTP 驗證碼輸入元件，供本卡與 TASK-044
    共用，登記回 `design-system.md` 元件庫 inventory）
  - `tests/admin/account.test.ts`（擴充或新增）
- 不得觸碰：
  - `AccountSettingsView.tsx` 裡 TASK-041（個人資料）與 TASK-042（密碼／Email）負責的
    卡片區塊（MFA 停用驗證需要呼叫 TASK-042 建立的密碼驗證邏輯，透過匯入函式重用，
    不複製貼上）。
  - `app/login/`（登入頁的 MFA 挑戰步驟是 TASK-044 的範圍，本卡只做帳號設定端的
    註冊/停用）。

## 需求

- WHEN 設計師在 MFA 卡片點擊「啟用雙重驗證」 THE SYSTEM SHALL 呼叫 `mfa.enroll()`，
  顯示 QR Code、可手動輸入的密鑰文字，以及 `OtpInput` 驗證碼輸入欄位。
- WHEN 設計師輸入 Authenticator App 產生的驗證碼確認 THE SYSTEM SHALL 呼叫
  `mfa.challenge()`／`mfa.verify()`，成功後該 factor 轉為已驗證，MFA 卡片顯示「已
  啟用」狀態徽章；驗證碼錯誤時顯示錯誤提示，允許重新輸入。
- WHEN 設計師在註冊流程中點擊「取消」 THE SYSTEM SHALL 呼叫 `mfa.unenroll()` 移除
  尚未驗證的 factor，卡片恢復「未啟用」狀態。
- WHEN 已啟用 MFA 的設計師點擊「停用雙重驗證」 THE SYSTEM SHALL 顯示二次確認對話框，
  要求同時輸入目前密碼與目前驗證碼確認身分（見「假設」段落的實作期修正），通過後依序
  重新驗證密碼、以驗證碼將 session 升級至 aal2、呼叫 `mfa.unenroll()` 移除該 factor，
  卡片恢復「未啟用」狀態；密碼或驗證碼任一錯誤時阻擋停用，維持已啟用狀態。

## 驗收標準

- 設計師可完成 MFA 註冊（QR Code 掃描＋驗證碼確認），註冊完成後卡片顯示「已啟用」。
- 註冊流程中取消不會殘留未驗證的 factor。
- 設計師可停用已啟用的 MFA（需同時輸入目前密碼與目前驗證碼確認），停用後卡片顯示
  「未啟用」。
- 密碼錯誤或驗證碼錯誤時皆無法停用 MFA。
- `OtpInput` 元件已登記回 `design-system.md` 元件庫 inventory。

## 實作備註

- `OtpInput` 依既有 `Input` 邊框樣式做 6 格獨立輸入框，支援貼上完整 6 碼自動分配到
  各格（比照常見 OTP 輸入互動慣例），錯誤狀態比照既有 `error` 語意色。

## 驗證契約

- 單元測試：不適用（MFA 邏輯高度依賴 Supabase Auth SDK 的即時互動，不易抽出可獨立
  測試的純函式；若 `OtpInput` 的貼上分配邏輯可抽成純函式，則補上測試）。
- 整合測試：對真實 Supabase 專案（或測試帳號）驗證 MFA 註冊/驗證/停用呼叫的行為與
  權限邊界（只能操作自己的 factor，這是 Supabase Auth 內建保證，測試層級驗證呼叫本身
  正常運作）；併入 TASK-045。
- E2E 測試：Browser 工具走查 MFA 註冊流程 UI（QR Code 顯示、驗證碼輸入、取消行為）；
  真實 TOTP 驗證碼的產生與輸入需要真實 Authenticator App，留給 TASK-045 的手動走查。
- 型別檢查：`npx tsc --noEmit`
- Lint：`npm run lint`
- Build：`npm run build`
- 螢幕截圖：MFA 未啟用、註冊中（QR Code）、已啟用、停用二次確認。
- 安全性檢查：停用 MFA 前必須驗證身分；註冊流程取消時正確清除未驗證 factor，不留下
  可被利用的殘留狀態；QR Code／密鑰內容不記錄在任何日誌或錯誤訊息中。

## 完成證據

- 變更的檔案：
  - `components/ui/OtpInput.tsx`（新增，6 格 OTP 驗證碼輸入元件，貼上分配邏輯抽成純函式
    `distributeOtpPaste`）
  - `lib/admin/account.ts`（新增 `listMfaFactors`／`enrollMfa`／`verifyMfaEnrollment`／
    `cancelMfaEnrollment`／`unenrollMfaWithCode`，共用私有 `challengeAndVerifyMfaCode`）
  - `app/admin/_components/AccountSettingsView.tsx`（接上 MFA 卡片四態：未啟用／註冊中
    （QR Code）／已啟用／停用二次確認）
  - `app/design-system/page.tsx`（新增 OtpInput 展示區塊）
  - `ai/context/design-system.md`（S4 inventory 登記 OtpInput）
  - `ai/context/project-map.md`（更新 `app/admin/account/`／`lib/admin/account.ts` 說明）
  - `ai/artifacts/設計師登入與帳號安全/mockup-decision-帳號設定頁.md`（新增 TASK-043
    實作期偏離紀錄）
  - `ai/artifacts/設計師登入與帳號安全/screen-spec-帳號設定頁.md`（同步偏離內容到狀態表／
    互動表）
  - `tests/admin/account.test.ts`（新增 MFA 五支函式的單元測試）
  - `tests/components/account-settings-view.test.tsx`（新增「雙重驗證（MFA）」describe
    區塊，8 個案例）
  - `tests/components/otp-input.test.tsx`（新增，純函式與元件互動測試）
- 執行過的指令：
  - `npx tsc --noEmit`（通過）
  - `npm run lint`（通過）
  - `npm test`（304 個測試全數通過；曾在高平行負載下出現與本卡無關檔案（`login-form`／
    `select` 等）的逾時假警報，已用 `--pool=forks --poolOptions.forks.singleFork` 單一
    process 模式重跑確認為環境資源競爭、非邏輯缺陷，全數 304 個測試穩定通過）
  - `npm run build`（通過，`/admin/account` 正常編譯；曾遇到 Windows 上 Turbopack build
    worker 因系統資源忙碌偶發當機（exit code 3221226505／`spawn UNKNOWN`），重跑後穩定
    成功，與程式碼無關）
- 測試輸出：`npx vitest run --pool=forks --poolOptions.forks.singleFork` →
  `Test Files 25 passed (25)`、`Tests 304 passed (304)`。
- 審查關卡：architect／security-reviewer／test-engineer 三方審查（見下方「三方審查與修正」），
  皆已針對發現的問題完成程式碼修正並重新驗證。
- 螢幕截圖／Browser 工具實測（兩輪，皆對真實 Supabase 專案走查，非僅前端 mock；第二輪為
  三方審查修正後的複驗）：
  - 第一輪：MFA 未啟用／註冊中（QR Code＋手動密鑰＋OtpInput）／驗證碼錯誤（真實 Supabase
    回傳 `mfa_verification_failed`）／註冊取消／已啟用（真實 TOTP 演算法算出驗證碼完成
    啟用）／停用二次確認／停用成功（重新整理頁面向 Supabase 再次查證狀態）。
  - 第二輪（修正後複驗）：OtpInput 清空中間格不再造成後方碼位移（填 6 碼、清空第 3 格，
    確認第 4-6 格正確被截斷清空、不是錯位補到第 3 格）；`enrollMfa()` 清理殘留 unverified
    factor 後正常建立新 factor；`cancelMfaEnrollment()` 狀態檢查後正常取消；停用對話框
    改為同時要求「目前密碼」與「目前驗證碼」，兩者皆正確時才呼叫
    `unenrollMfaWithPasswordAndCode()`，真實走完密碼驗證→驗證碼升級 aal2→unenroll 三步驟
    並成功停用，重新整理頁面確認伺服器端狀態確實變回「未啟用」。
- 三方審查與修正：
  - **architect**：發現 `OtpInput` 清空中間格會使後方碼位移（`commit()` 用 `join("")`
    塌陷字串中間的空值）、`listMfaFactors()` 讀取失敗時 UI 靜默顯示「未啟用」可能誤導
    使用者。兩項皆已修正（`OtpInput.tsx` 改為清空即截斷；`AccountSettingsView.tsx` 新增
    `mfaLoadError` 狀態＋「重試」按鈕，讀取失敗時不顯示任何可操作按鈕）。另提出多項非
    阻擋建議（`lib/admin/account.ts` 可視情況拆檔、`AccountSettingsView.tsx` 可拆子元件、
    `OtpInput` 未來供 TASK-044 使用時建議補 `onComplete`／可變長度支援），列為後續任務
    參考，未在本卡處理。
  - **security-reviewer**：發現一項 Critical（H1，見下方「已知限制」）與多項 Medium/Low。
    已修正：`cancelMfaEnrollment()` 呼叫前先確認目標 factor 真的是 unverified，不再單純
    信任呼叫端傳入的 factorId（M2）；停用 MFA 改為「目前密碼」＋「目前驗證碼」兩者皆須
    通過，不是驗證碼單一途徑（M3，`unenrollMfaWithPasswordAndCode`，呼叫順序：先密碼
    重新驗證，再驗證碼升級 aal2，最後才 unenroll，順序寫反會被 insufficient_aal 擋下）；
    `enrollMfa()` 建立新 factor 前先清除殘留的 unverified factor，避免累積撞上裝置數量
    上限（M4）；`challenge()`／`verify()` 對 `over_request_rate_limit` 獨立回傳
    `rate_limited`，不再與其他錯誤一起塌成通用文案（L7）；驗證失敗後清空已輸入的驗證碼
    （L8）；`unenrollMfaWithPasswordAndCode` 失敗（非密碼/驗證碼錯誤）時背景重新讀取一次
    真實狀態，避免畫面卡在過期的徽章（L11a）；停用進行中時 `ConfirmDialog` 的
    背景點擊／Esc 不再能關閉對話框（L11b）。M5（無備援碼／救援程序）、M6（啟用/停用無
    通知或稽核紀錄）、L9（QR/密鑰預設不遮蔽）、L10（`autoComplete` 只需掛在第一格）評估
    後列為後續任務或已知限制，未在本卡處理（詳見下方）。
  - **test-engineer**：確認 `lib/admin/account.ts` 五支 MFA 函式與 UI 8 個案例（後擴充為
    涵蓋新流程的 11 個案例）的測試覆蓋度足夠、關鍵路徑齊全；指出 `listMfaFactors()` 讀取
    失敗情境缺測試、完成證據宣稱的截圖沒有實際圖片檔案可覆核。已修正：補上讀取失敗＋
    重試成功的測試案例（`account-settings-view.test.tsx`）；截圖檔案的落差說明見下方
    「已知限制」。
- 已知限制：
  - **Critical（H1，security-reviewer 發現，epic 層級，本卡範圍外）**：MFA 目前在伺服器端
    完全沒有強制力。`app/admin/layout.tsx`、`lib/supabase/middleware.ts`、`is_admin()`
    皆只檢查「有沒有登入」與「是不是管理員」，不檢查 authenticator assurance level
    （aal）。也就是說，即使帳號設定頁顯示 MFA「已啟用」，攻擊者只要拿到密碼、用
    `signInWithPassword` 取得 aal1 session，仍可直接存取 `/admin` 或直接呼叫 Supabase
    REST/RPC，完全不需要通過 MFA 驗證——「已啟用」徽章目前只代表「已註冊」，不代表
    「登入時真的會被要求驗證碼」。這是因為 TASK-044（登入頁 MFA 挑戰步驟）尚未實作，
    且即使 TASK-044 完成，若只在登入頁 UI 流程做判斷、RLS／`is_admin()` 沒有同步檢查
    aal，攻擊者不經過登入頁 UI（直接打 API）仍可繞過。**在 TASK-044 與 RLS 層級的 aal
    檢查一併上線前，不應該讓使用者誤以為啟用 MFA 後帳號已受到實質保護**。建議：(1)
    TASK-044 必須與本卡一起視為同一個「可對外宣稱有 MFA 保護」的最小可行集合，不要
    分開驗收上線；(2) 更徹底的防護需要在 `is_admin()`／關鍵 RLS 政策比對
    `auth.jwt()->>'aal' = 'aal2'`，這需要一張新的任務卡評估，不在本卡範圍內；(3) 若
    TASK-044 短期內不會接續實作，建議在 MFA 卡片文案加註「登入頁整合尚未完成」，避免
    誤導使用者。
  - `unenrollMfaWithPasswordAndCode()` 與 `cancelMfaEnrollment()`／`enrollMfa()` 皆未加上
    前端重試次數限制，依賴 Supabase 既有的 rate limit 機制（已對 `over_request_rate_limit`
    顯示專屬文案，但沒有前端節流）。
  - 沒有 MFA 備援碼（recovery code）或救援程序：Supabase TOTP 不內建備援碼，若設計師遺失
    裝置，唯一救援方式是透過 Supabase Dashboard 或 service role key 手動移除 factor。
    建議另立任務卡評估是否需要備援碼機制，並在啟用成功時提示使用者妥善備份密鑰。
  - MFA 啟用／停用目前只有前端 Toast，沒有寄送通知信或寫入稽核紀錄；停用第二道防線是
    值得告警的動作，建議未來比照密碼變更的重要性補上通知。
  - QR Code／密鑰在整個註冊過程無條件顯示（不會外洩到 log／錯誤訊息，已確認），螢幕
    分享或背後偷看情境下可能外洩；未來可考慮預設遮蔽、加「顯示密鑰」切換。
  - 本次 Browser 工具走查的螢幕截圖以對話形式留存於本次任務執行紀錄中，未另外輸出圖片
    檔案存放於 `ai/artifacts/` 目錄（test-engineer 審查發現：完成證據宣稱的截圖沒有可
    獨立覆核的檔案）。人工驗收者如需重新核對畫面，需要重跑一次 Browser 工具走查（步驟
    已詳列於上方）；後續任務卡若延續類似驗證方式，建議改用截圖存檔工具留下實際檔案。
  - 整合測試（對真實 Supabase 專案的自動化測試）尚未併入測試腳本，本卡以 Browser 工具
    人工走查真實環境替代（含兩輪、共約 15 次真實 Supabase 呼叫），完整整合測試（含
    RLS／權限邊界、rate limit 情境的自動化驗證）依任務卡規劃併入 TASK-045。
- 後續任務：TASK-044（登入 MFA 挑戰步驟，重用 `OtpInput`；**應與本卡一併視為 MFA 保護
  生效的最小集合，見上方 H1**）、TASK-045（整合驗證，含真實 Authenticator App 手動走查、
  rate limit 情境驗證）、新任務卡（評估 RLS／`is_admin()` 層級的 aal2 強制檢查）、新任務卡
  （評估 MFA 備援碼／救援程序）、新任務卡（MFA 啟用/停用通知或稽核紀錄，可能併入既有
  「Email 通知與提醒」相關 Epic）。
