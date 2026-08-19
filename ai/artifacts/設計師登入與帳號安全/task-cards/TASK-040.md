# AI-Ready 任務卡

## Metadata

- 任務：設計師登入與帳號安全 忘記密碼／重設密碼（含密碼強度計量條元件）
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：設計師登入與帳號安全
- 上層 User Story：忘記密碼／重設密碼
- 分軌：前端
- 前置任務（dependsOn）：TASK-039
- 狀態：已核准（2026-08-18），待前置任務 TASK-039 完成後轉就緒
- 風險等級：高（身分驗證相關：密碼重設是繞過既有密碼登入的合法後門，任何實作缺陷
  （例如錯誤訊息洩漏帳號是否存在、重設連結驗證不完整）都直接影響帳號安全，需架構、
  安全性、測試三方審查）

## 目標

在登入頁接上「忘記密碼？」連結的實際行為（輸入 email 觸發 `resetPasswordForEmail`），
新增 `/reset-password` 頁供使用者透過信件連結設定新密碼；新做密碼強度計量條元件（本卡
建立，供本卡與 TASK-042 帳號設定頁的密碼修改共用）。

## 情境包（Context Pack）

- 相關檔案：
  - `app/login/login-form.tsx`（TASK-039 已改版）：本卡接上「忘記密碼？」連結，點擊後
    在同一張卡片內切換顯示忘記密碼表單（比照 mockup 變體 A 狀態 3）。
  - `ai/artifacts/設計師登入與帳號安全/mockups/auth-flow-variant-a.html`：狀態 3「忘記
    密碼表單」、狀態 5「重設密碼頁」為本卡對應畫面。
  - `lib/supabase/client.ts`：既有瀏覽器端 Supabase client 封裝，`resetPasswordForEmail`／
    `updateUser` 皆透過此 client 呼叫。
  - `.env.example` 的 `NEXT_PUBLIC_SITE_URL`：`resetPasswordForEmail` 的 `redirectTo`
    參數組成 `${NEXT_PUBLIC_SITE_URL}/reset-password`。
- 既有模式：
  - `Result<T>` 錯誤處理模式，Supabase Auth 錯誤轉換為中文提示，不外洩原始錯誤內容。
- 假設：
  - 忘記密碼表單送出後，不論 Supabase 回傳成功或「查無此 email」類型的結果，前端一律
    顯示相同成功文案（`resetPasswordForEmail` 本身在 Supabase 預設設定下對不存在的
    email 也不會回傳可區分的錯誤，只有網路／服務層級錯誤才需要另外處理為失敗狀態）。
  - `/reset-password` 頁面：使用者透過信件連結造訪時，Supabase 用 URL 中的 token 建立
    一個臨時 session（`onAuthStateChange` 監聽 `PASSWORD_RECOVERY` 事件，或依 Supabase
    JS SDK 版本的既有慣例處理，實作階段依實際安裝的 `@supabase/supabase-js` 版本
    API 為準）；連結有效時允許呼叫 `updateUser({ password })`；連結無效（逾時／已使用）
    時，`onAuthStateChange` 不會觸發 `PASSWORD_RECOVERY` 或呼叫 `updateUser` 會回傳
    錯誤，前端依此判斷顯示「連結已逾時或已使用」。
  - 密碼強度計量條為純前端視覺提示（依長度、是否混合大小寫／數字／符號計算三階強度），
    不阻擋通過 Supabase 本身密碼規則的送出，只是額外的使用者體驗提示。
- 未知事項：無。
- 允許變更的檔案：
  - `app/login/login-form.tsx`（接上忘記密碼表單切換邏輯）
  - `app/reset-password/page.tsx`（新增）
  - `app/reset-password/reset-password-form.tsx`（新增）
  - `components/ui/PasswordStrengthMeter.tsx`（新增，密碼強度計量條，供本卡與 TASK-042
    共用，登記回 `design-system.md` 元件庫 inventory）
  - `lib/auth/password-strength.ts`（新增，強度計算純函式）
  - `tests/lib/password-strength.test.ts`（新增）
- 不得觸碰：
  - `app/login/page.tsx`（伺服器端邏輯不變）。
  - `supabase/migrations/`（本卡不涉及資料庫變更）。

## 需求

- WHEN 使用者在登入頁點擊「忘記密碼？」 THE SYSTEM SHALL 切換顯示忘記密碼表單（email
  輸入欄位＋「寄送重設信」按鈕＋「返回登入」連結）。
- WHEN 使用者在忘記密碼表單輸入 email 並送出 THE SYSTEM SHALL 呼叫
  `resetPasswordForEmail(email, { redirectTo: \`${NEXT_PUBLIC_SITE_URL}/reset-password\` })`，
  不論結果為何皆顯示相同成功文案「若此 email 對應既有帳號，重設密碼信已寄出，請至信箱
  查收。」；僅在明確的網路／服務層級錯誤（非「帳號不存在」類型）時才顯示通用錯誤提示。
- WHEN 使用者透過信件連結造訪 `/reset-password` 且連結有效 THE SYSTEM SHALL 顯示新密碼
  輸入表單（新密碼＋確認新密碼），新密碼欄位下方即時顯示 `PasswordStrengthMeter`。
- WHEN 使用者在 `/reset-password` 輸入新密碼並確認一致、通過基本格式檢查後送出
  THE SYSTEM SHALL 呼叫 `updateUser({ password })`，成功後顯示成功提示並導回登入頁；
  兩次密碼不一致時阻擋送出並標示錯誤。
- WHEN 連結已逾時或已使用 THE SYSTEM SHALL 顯示明確錯誤提示與「重新申請」連結（導回
  登入頁忘記密碼流程）。

## 驗收標準

- 忘記密碼流程對任何 email 輸入皆顯示相同成功文案，不洩漏帳號是否存在。
- 設計師可透過信件連結、輸入新密碼、看到即時強度提示、設定成功並用新密碼登入。
- 兩次新密碼不一致時無法送出，顯示行內錯誤。
- 連結已逾時或已使用時顯示明確錯誤提示，不誤導使用者以為已成功。
- `PasswordStrengthMeter` 元件已登記回 `design-system.md` 元件庫 inventory。

## 實作備註

- `PasswordStrengthMeter` 依既有 `success`／`warning`／`danger` 語意色呈現弱/中/強三階，
  比照 mockup 的三格長條視覺；強度計算邏輯抽成純函式（`lib/auth/password-strength.ts`）
  方便單元測試與 TASK-042 共用。
- 忘記密碼表單與登入表單共用同一張卡片容器，只是內容切換（比照 mockup 變體 A 的設計），
  避免在 `login-form.tsx` 內建立過度複雜的狀態機，可考慮拆成 `LoginCard` 內部的簡單
  `mode: "login" | "forgot-password"` 狀態切換。

## 驗證契約

- 單元測試：密碼強度計算純函式（`lib/auth/password-strength.ts`）、兩次密碼一致性驗證。
- 整合測試：`resetPasswordForEmail`／`updateUser` 呼叫本身的權限與行為驗證不易在自動化
  整合測試中完整模擬真實收信，實作階段至少驗證「呼叫本身不報錯」；併入 TASK-045。
- E2E 測試：Browser 工具走查忘記密碼表單送出→顯示成功文案；`/reset-password` 頁對
  「連結參數缺失/無效」情境的錯誤提示（可用直接造訪無 token 的 `/reset-password` 模擬）。
- 型別檢查：`npx tsc --noEmit`
- Lint：`npm run lint`
- Build：`npm run build`
- 螢幕截圖：忘記密碼表單、送出成功、重設密碼頁（含強度計量條各三階）、連結逾時/已使用。
- 安全性檢查：忘記密碼流程不得因回應差異洩漏帳號是否存在；重設密碼連結沿用 Supabase
  內建一次性使用與逾時機制，不自行延長或縮短。

## 完成證據

- 狀態：完成（使用者於對話中核准，2026-08-18）——已完成 architect／security-reviewer／
  test-engineer 三方審查並依結果修正一個嚴重的認證繞過漏洞；PKCE 跨裝置問題已與使用者
  確認、另開 TASK-058 追蹤，忘記密碼流程的帳號列舉／CAPTCHA／密碼長度等 Supabase
  Dashboard 設定項目經使用者確認留待其自行處理，記錄為殘留風險。
- 變更的檔案：`app/login/login-form.tsx`、`app/reset-password/page.tsx`、
  `app/reset-password/reset-password-form.tsx`、`components/ui/PasswordStrengthMeter.tsx`、
  `lib/auth/password-strength.ts`、`ai/context/design-system.md`、`app/design-system/page.tsx`、
  `tests/lib/password-strength.test.ts`、`tests/components/login-form.test.tsx`、
  `tests/components/reset-password-form.test.tsx`、`tests/components/password-strength-meter.test.tsx`。
- 執行過的指令：`npx tsc --noEmit`、`npm run lint`、`npm run build`、
  `npx vitest run`（23 files／204 tests passed）。
- 測試輸出：新增 34 個測試案例（password-strength 14、login-form 8、
  reset-password-form 8、PasswordStrengthMeter 4），含針對「認證繞過」漏洞的專門迴歸測試。
- 螢幕截圖：登入頁忘記密碼表單（預設／成功／失敗）、`/reset-password` 逾時後的無效連結畫面、
  `/design-system` 的 PasswordStrengthMeter 弱／中／強三階皆已截圖確認；`/reset-password`
  「連結有效」狀態（新密碼表單本身）因無法在瀏覽器內安全走查真實 recovery 連結而未截圖，
  改以元件測試（mock PASSWORD_RECOVERY 事件）佐證。
- 已知限制（詳見下方「審查發現與修正」）：
  1. **已修正**：`/reset-password` 原本把「有任何既有 session」當成「連結有效」，是嚴重的
     認證繞過漏洞（已登入者或偷到 session 的人可略過忘記密碼直接改密碼）；已修正為只信任
     `PASSWORD_RECOVERY` 事件，並補上迴歸測試。
  2. **已加 UX 緩解，架構根治另開 TASK-058**：`resetPasswordForEmail` 在目前的 PKCE flow
     下，信件連結若在申請時的瀏覽器以外開啟會失敗（例如電腦申請、手機開信），會被誤判為
     「已逾時或已使用」。已與使用者確認先接受此限制，並在忘記密碼成功文案加上「請在這台
     裝置、這個瀏覽器開啟信件中的連結」提示；徹底修法（伺服器端 `verifyOtp` route handler
     + 修改 Supabase Email Template）已另開 TASK-058（backlog）追蹤，執行時需人工到
     Supabase Dashboard 操作 Email Template。
  3. **使用者選擇自行處理，不開任務卡**：忘記密碼流程存在帳號列舉 oracle（重複請求同一
     email 會因寄信配額而洩漏帳號是否存在）且無 CAPTCHA／節流；需在 Supabase Dashboard
     開啟 CAPTCHA 保護並設定自訂 SMTP，使用者已確認會自行找時間到 Dashboard 設定。
  4. **使用者選擇自行處理，不開任務卡**：`MIN_PASSWORD_LENGTH=6` 對唯一管理者帳號偏弱，
     使用者已確認會自行同步調整 Supabase Dashboard 的 Minimum password length。
- 後續任務：TASK-042（帳號設定頁密碼修改重用 `PasswordStrengthMeter`）、TASK-045
  （整合驗證，含至少一次真實 email 收發手動驗證，執行時需留意上述帳號列舉／寄信配額限制）、
  TASK-058（伺服器端 verifyOtp 重構，解決 PKCE 跨裝置重設失效）；
  是否為上述殘留項目另開任務卡，待使用者於對話中決定。
