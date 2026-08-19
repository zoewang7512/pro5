# AI-Ready 任務卡

## Metadata

- 任務：設計師登入與帳號安全 帳號設定：密碼與登入 Email 修改
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：設計師登入與帳號安全
- 上層 User Story：修改密碼／個人資料
- 分軌：前端
- 前置任務（dependsOn）：TASK-038, TASK-040
- 狀態：完成（使用者於對話中核准，2026-08-19）——已完成 architect／security-reviewer／
  test-engineer 三方審查（各兩輪），第一輪 security-reviewer 發現的嚴重問題（Email 修改
  無需驗證密碼、密碼錯誤判斷脆弱耦合等）與第二輪 architect／test-engineer 發現的問題
  （pendingEmail 在 refresh() 網路錯誤時被悄悄清空、email 未同步為 context state、
  測試套套邏輯等）皆已修正
- 風險等級：高（密碼與登入 email 是帳號存取的核心憑證，任何實作缺陷可能導致帳號被鎖死
  或身分驗證被繞過，需架構、安全性、測試三方審查）

## 目標

在帳號設定頁接上「密碼」與「登入 Email」兩張卡片的實際編輯能力：密碼修改需驗證目前密碼
並顯示新密碼強度（重用 TASK-040 的 `PasswordStrengthMeter`）；Email 修改需顯示待確認
狀態，變更在完成確認前不生效。

## 情境包（Context Pack）

- 相關檔案：
  - `app/admin/_components/AccountSettingsView.tsx`（TASK-038 骨架、TASK-041 已接上
    個人資料卡片，本卡接上密碼與 Email 卡片）
  - `components/ui/PasswordStrengthMeter.tsx`（TASK-040 建立，本卡重用）
  - `lib/admin/account.ts`（本卡新增 `updateAdminPassword(currentPassword, newPassword)`／
    `updateAdminEmail(newEmail)`）
- 既有模式：
  - Supabase Auth 沒有提供「驗證目前密碼」的獨立 API；本卡的作法是先用目前登入者的
    email＋輸入的「目前密碼」呼叫一次 `signInWithPassword` 重新驗證身分（不影響現有
    session，只是確認密碼正確），驗證通過才呼叫 `updateUser({ password: newPassword })`。
    這是本卡需要在架構層面確認的做法，若 `signInWithPassword` 的重複呼叫在 Supabase
    SDK 行為上有副作用（例如刷新 session token 導致頁面需要重新整理），需在實作階段
    測試確認並記錄在完成證據。
  - `Result<T>` 錯誤處理模式，Supabase Auth 錯誤轉換為中文提示。
- 假設：
  - `updateUser({ email: newEmail })` 沿用 Supabase 專案既有的 email 變更確認機制；本卡
    不查詢或客製化 Supabase 專案的 email 確認設定（單重或雙重確認），前端只需要正確處理
    「送出後進入待確認狀態」這個通用流程，不寫死假設某一種確認機制的文案（文案措辭保持
    通用，例如「請至新信箱完成確認」，不特別聲明「新舊信箱都要」或「只需新信箱」，避免
    與實際 Supabase 專案設定不符）。
  - 新密碼格式規則沿用 Supabase Auth 預設密碼原則，前端不重新定義比 Supabase 更嚴格的
    規則，只是額外疊加 `PasswordStrengthMeter` 的視覺提示。
- 未知事項：Supabase 專案的 email 變更確認機制（單重／雙重確認）實際設定值——不影響
  本卡實作（見上方假設），但建議實作階段查證一次並記錄在 `ai/context/project-map.md`，
  避免未來有人誤判此行為。
- 允許變更的檔案：
  - `app/admin/_components/AccountSettingsView.tsx`
  - `lib/admin/account.ts`
  - `tests/admin/account.test.ts`（擴充 TASK-041 建立的檔案，或新增，實作階段判斷）
- 不得觸碰：
  - `AccountSettingsView.tsx` 裡 TASK-041（個人資料）與 TASK-043（MFA）負責的卡片區塊。
  - `supabase/migrations/`（本卡不涉及資料庫變更，密碼與 email 完全由 Supabase Auth
    管理）。

## 需求

- WHEN 設計師輸入目前密碼、新密碼與確認新密碼並送出 THE SYSTEM SHALL 先驗證目前密碼
  正確（見情境包的驗證方式），驗證新密碼與確認密碼一致，通過後呼叫
  `updateUser({ password: newPassword })`，成功後顯示成功 Toast；目前密碼錯誤或兩次
  新密碼不一致時顯示對應錯誤，不更新密碼。新密碼欄位下方即時顯示 `PasswordStrengthMeter`。
- WHEN 設計師輸入新 email 並送出 THE SYSTEM SHALL 呼叫 `updateUser({ email: newEmail })`，
  送出後顯示待確認狀態提示，登入 email 顯示維持原值直到確認完成。
- WHEN 寫入失敗（網路或 Supabase 錯誤） THE SYSTEM SHALL 顯示通用錯誤 Toast，不外洩
  原始錯誤內容。

## 驗收標準

- 設計師可修改密碼（需驗證目前密碼），新密碼與確認密碼不一致時無法送出。
- 密碼修改表單即時顯示新密碼強度計量。
- 設計師可送出登入 email 變更請求，送出後看到待確認狀態提示，變更在確認前不生效。
- 目前密碼錯誤時顯示明確錯誤，不更新密碼。

## 實作備註

- 「驗證目前密碼」的 `signInWithPassword` 重複呼叫方式若在實作階段發現有更適合的
  Supabase Auth API（例如未來 SDK 版本提供的專用「re-authenticate」方法），可改用該
  方法，只要驗證效果等價（確認使用者知道目前密碼）即可，不需要拘泥於本卡假設的實作
  細節，但需在完成證據中說明實際採用的方式與理由。

## 驗證契約

- 單元測試：密碼一致性驗證純函式（若與 TASK-040 重複則直接重用，不重寫）。
- 整合測試：`updateUser` 密碼變更的行為驗證（例如用測試帳號實際變更密碼後確認可用新
  密碼登入，測試後還原為原密碼）；email 變更因涉及真實收信，不易完整自動化，至少驗證
  「呼叫本身不報錯、正確進入待確認狀態」；併入 TASK-045。
- E2E 測試：Browser 工具走查密碼修改（含目前密碼錯誤、兩次新密碼不一致、成功）、email
  修改送出後的待確認狀態顯示。
- 型別檢查：`npx tsc --noEmit`
- Lint：`npm run lint`
- Build：`npm run build`
- 螢幕截圖：密碼修改表單（含強度計量條、驗證錯誤）、email 修改待確認狀態。
- 安全性檢查：密碼修改需驗證目前密碼才能變更，避免已登入裝置被他人趁隙修改密碼後
  鎖死原帳號；email 變更沿用 Supabase 既有確認機制，不繞過或簡化。

## 完成證據

- 變更的檔案：`app/admin/_components/AccountSettingsView.tsx`（密碼／登入 Email 卡片接上
  編輯能力）、`app/admin/_components/AdminProfileContext.tsx`（新增 `pendingEmail`
  state、`email` 改為可變 state）、`app/admin/layout.tsx`（新增 `initialPendingEmail`
  prop）、`lib/admin/account.ts`（新增 `reauthenticateAdmin`／`updateAdminPassword`／
  `updateAdminEmail`／`validateAdminEmail`）、`lib/auth/password-strength.ts`（新增
  `MAX_PASSWORD_LENGTH`）、`tests/admin/account.test.ts`／
  `tests/components/account-settings-view.test.tsx`（新增測試）、
  `screen-spec-帳號設定頁.md`／`mockup-decision-帳號設定頁.md`／`project-map.md`
  （同步文件）。
- 執行過的指令：
  - `npx tsc --noEmit`（通過）
  - `npm run lint`（通過）
  - `npm run build`（通過）
  - `npx vitest run`（24 files／252 tests passed，含新增 44 case，既有測試無回歸）
  - Browser 工具對真實 Supabase 專案手動走查（兩輪：初版實作、三方審查修正後）
  - curl 直接呼叫 Supabase Auth API 交叉驗證程式碼行為
- 測試輸出：`tests/admin/account.test.ts` 新增 27 案例（`reauthenticateAdmin` 共用邏輯、
  錯誤碼分類、`updateAdminEmail`／`updateAdminPassword` 的完整分支），
  `tests/components/account-settings-view.test.tsx` 新增 17 案例（含雙重送出防護、
  pendingEmail 非套套邏輯驗證），全數通過。
- 螢幕截圖：密碼修改表單（含強度計量條、兩次不一致／目前密碼錯誤驗證錯誤，修正版面後
  重新截圖）、Email 修改表單（含新增的「目前密碼」欄位、目前密碼錯誤狀態），已於 Browser
  走查過程截圖確認。
- 已知限制：
  1. **架構限制，已接受**：`reauthenticateAdmin` 對「目前密碼」的驗證完全在瀏覽器端
     執行，Supabase 專案預設設定下不會在伺服器端強制檢查是否剛完成 re-auth，持有有效
     session token 的攻擊者理論上可繞過此關卡直接呼叫 API。單一管理員、非公開對外服務
     情境下影響有限，已在 `lib/admin/account.ts` 的 `reauthenticateAdmin` 註解誠實記錄，
     未執行更重的伺服器端強制方案（Route Handler + service role key）。
  2. Email 變更流程因 TASK-040 已記錄的 Supabase 專案環境限制（`designer001@gmail.com`
     本身的寄信/驗證問題）無法在此環境完整走查「成功進入待確認狀態」的真實路徑，改以
     curl 交叉驗證根因＋元件測試覆蓋該分支邏輯。
  3. Supabase 專案的 Email 變更確認機制（單重／雙重確認）尚未在 Dashboard 人工查證，已
     記錄於 `project-map.md`；UI 文案刻意寫得通用以相容兩種設定。
  4. 密碼修改成功後 Supabase 會登出其他裝置的既有 session（既定行為），目前只在成功
     Toast 文案提醒，未主動偵測或列出受影響的裝置清單。
- 後續任務：TASK-043（MFA，架構審查建議屆時把 `reauthenticateAdmin` 等 step-up 驗證
  邏輯搬到 `lib/auth/` 底下，enroll/unenroll 預期需要同一套機制）、TASK-045（整合驗證，
  含至少一次真實 email 收發手動驗證 email 變更流程）。
