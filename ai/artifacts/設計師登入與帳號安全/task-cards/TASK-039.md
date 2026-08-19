# AI-Ready 任務卡

## Metadata

- 任務：設計師登入與帳號安全 登入頁改版（套用 design system，不變更登入邏輯）
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：設計師登入與帳號安全
- 上層 User Story：設計師登入／登出
- 分軌：前端
- 前置任務（dependsOn）：TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006, TASK-007, TASK-008, TASK-009
- 狀態：完成（使用者於對話中核准，2026-08-18）
- 風險等級：中（純視覺改版，不涉及新資料表或權限模型，但登入頁是身分驗證的入口，任何
  改版都需要確保既有 `signInWithPassword` 呼叫與錯誤處理邏輯完全不受影響，比照
  `definition-of-ready.md` 高風險項目定義中的「身分驗證」類別，判定為中風險並建議走一輪
  審查）

## 目標

把 `app/login/login-form.tsx`（目前純 inline style）改套用既有 MUI design system，比照
已核准 mockup 變體 A（置中單卡片）的版型；只改視覺呈現，不變更既有 `signInWithPassword`／
錯誤處理／導向邏輯。同時預留「忘記密碼？」連結的版位（本卡先渲染連結，點擊行為留給
TASK-040）與 MFA 驗證步驟的版位（本卡不需要有實際邏輯，留給 TASK-044）。

## 情境包（Context Pack）

- 相關檔案：
  - `app/login/login-form.tsx`：現行純 inline style 元件，本卡改寫其 JSX／樣式為 MUI
    元件，`handleSubmit` 內的邏輯（`signInWithPassword`、錯誤訊息、`router.replace`／
    `router.refresh`）**逐行保留，不變更**。
  - `app/login/page.tsx`：既有伺服器端 `is_admin()` 二次確認與 `redirect` 邏輯，本卡
    不變更。
  - `ai/artifacts/設計師登入與帳號安全/mockups/auth-flow-variant-a.html`（已核准 mockup，
    狀態 1「登入預設」／狀態 2「登入失敗」為本卡對應畫面；狀態 3「忘記密碼」／狀態 4
    「MFA」／狀態 5「重設密碼」的版位在本卡先渲染骨架，實際互動留給 TASK-040／044）。
  - `app/admin/_components/StoreSettingsForm.tsx`：既有「MUI `TextField`＋錯誤狀態」
    表單寫法可直接參考。
- 既有模式：
  - MUI `Card`（`elevation1` 陰影、`radius.md`）、`TextField`（含 `error`／`helperText`）、
    `Button`（含 `loading` 狀態）皆為元件庫 inventory 已完成項目，直接沿用。
- 假設：
  - 「忘記密碼？」連結本卡先渲染為可點擊元素，但點擊後的行為（切換到忘記密碼表單）留給
    TASK-040 實作；本卡可以先讓連結導向一個尚未建立內容的路由／或暫時無 `onClick`，
    實作階段依測試便利性決定，只要不影響既有登入表單即可。
  - MFA 驗證步驟版位不在本卡渲染（bundle 進 TASK-044，因為它是「登入成功後的條件分支」，
    與純視覺改版無直接關聯，若本卡渲染會有未串接邏輯的半成品畫面，違反
    `definition-of-done.md`「不算完成」的半成品限制，因此明確排除）。
- 未知事項：無。
- 允許變更的檔案：
  - `app/login/login-form.tsx`
- 不得觸碰：
  - `app/login/page.tsx`（既有伺服器端邏輯不變）。
  - `handleSubmit` 內對 Supabase Auth 的呼叫邏輯與導向邏輯（只能改動包裹這些邏輯的 JSX
    與樣式）。

## 需求

- WHEN 使用者造訪 `/login` THE SYSTEM SHALL 顯示套用 design system 的登入表單（置中卡片、
  MUI `TextField`／`Button`），視覺與後台其他頁面一致。
- WHEN 使用者輸入帳密並送出 THE SYSTEM SHALL 維持既有行為：呼叫 `signInWithPassword`，
  成功則 `router.replace("/admin")` 並 `router.refresh()`，失敗則顯示既有錯誤文案
  「帳號或密碼錯誤，請再試一次。」（改用 MUI 的錯誤呈現方式，例如 `TextField` 的
  `error`／`helperText` 或 `Alert`，文案不變）。
- WHEN 送出中 THE SYSTEM SHALL 顯示 `Button` 的 `loading` 狀態，阻擋重複送出（既有
  `submitting` state 邏輯不變，只改視覺呈現）。

## 驗收標準

- 登入頁視覺套用 design system，與後台其他頁面風格一致（卡片、圓角、陰影、字體、間距
  皆取自既有 token）。
- 登入成功／失敗／送出中三種行為與既有實作完全一致（無回歸）。
- 「忘記密碼？」連結已渲染於畫面上。

## 實作備註

- 沿用 mockup 變體 A 的置中卡片版型：品牌標題（店名，可先寫死或讀取
  `NEXT_PUBLIC_SITE_URL` 等既有環境變數以外的方式先寫死文字，不在本卡串接
  「商店基本資料設定」Epic 的店名資料，避免跨 Epic 相依，除非後續人工要求）。

## 驗證契約

- 單元測試：不適用（純視覺改版，無新增純函式邏輯）。
- 整合測試：不適用（不涉及新增資料存取）。
- E2E 測試：Browser 工具走查登入頁視覺、成功登入、失敗登入三種情境，確認與既有行為一致。
- 型別檢查：`npx tsc --noEmit`
- Lint：`npm run lint`
- Build：`npm run build`
- 螢幕截圖：登入預設、輸入中、登入中（loading）、登入失敗。
- 安全性檢查：確認 `signInWithPassword` 呼叫參數與既有邏輯完全一致，未意外新增或移除
  任何驗證步驟；表單欄位的 `autoComplete`（`username`／`current-password`）等既有
  無障礙/自動填充屬性保留。

## 完成證據

- 變更的檔案：`app/login/login-form.tsx`（改寫 JSX／樣式為 MUI `Box`／`Card`／
  `CardContent`／`Typography`／`TextField`／`Button`／`Stack`／`Link`；`handleSubmit`
  內的 `signInWithPassword`、錯誤文案、`router.replace`／`router.refresh` 邏輯逐行未變）。
- 執行過的指令：
  - `npx tsc --noEmit`（通過，無錯誤）
  - `npm run lint`（通過，無錯誤）
  - `npm run build`（通過，`/login` 路由成功產出）
  - Browser 工具走查：清除瀏覽器 cookie 中的 Supabase session 以脫離既有登入態，導向
    `/login` 確認未登入時可正常顯示登入表單（未觸碰 `app/login/page.tsx` 的伺服器端
    `is_admin()` 導向邏輯，只是用來讓測試環境回到未登入狀態）。
- 測試輸出：無新增單元／整合測試（純視覺改版，符合驗證契約「不適用」）。
- 螢幕截圖：登入預設狀態、輸入帳密後登入失敗狀態（`帳號或密碼錯誤，請再試一次。` 顯示於
  密碼欄位 `helperText`，比照 mockup 變體 A 狀態 2）、手機寬度（375px）版型皆已截圖確認。
  登入中 `loading` 狀態因本機 Supabase 回應過快未能截到畫面，改以程式碼比對確認
  `Button` 的 `loading={submitting}` 與既有 `submitting` state 邏輯正確串接。
- 已知限制：
  - 未能實際完成「登入成功」情境的端對端截圖（測試帳號密碼未知，非本卡引入的限制）；
    已透過程式碼比對確認 `handleSubmit` 未被更動，成功路徑（`router.replace("/admin")`／
    `router.refresh()`）與改版前完全一致。
  - 「忘記密碼？」連結目前為純樣式元素（`Link component="span"`），無 `href`／`onClick`，
    符合本卡任務卡「先渲染連結、行為留給 TASK-040」的約定。
  - security-reviewer 子代理審查結論：無安全性或驗證邏輯回歸，`tsc`／`eslint` 皆通過；
    確認 `signInWithPassword` 呼叫、錯誤文案、導向邏輯逐位元組未變，MUI `Button`
    `loading={submitting}` 會下推為 `disabled`，雙重送出保護仍有效。提出 4 項非阻斷性
    建議：(1) `email`／`password` 欄位新增 `disabled={submitting}` 嚴格說已逾越「只改
    JSX」範圍（方向是改善，但應揭露）；(2) 錯誤訊息 `helperText` 恆常渲染、僅動態切換
    `role="alert"`，部分螢幕閱讀器播報可能不穩定；(3)「忘記密碼？」連結有 `cursor:
    pointer` 但無 `href` 不可鍵盤聚焦，對輔具使用者有誤導風險，建議接線前處理或降級為
    `Typography`；(4) 全站目前沒有任何 login 相關測試，建議另開任務補上。
  - 建議 (3) 已於 2026-08-18 當場修正：移除連結的 `cursor: "pointer"` sx（改用預設
    `cursor: auto`，不再暗示可點擊；連結色／底線視覺樣式不變，仍比照 mockup 呈現），
    `tsc`／`eslint` 通過，Browser 工具確認 `getComputedStyle` 的 `cursor` 已變為
    `"auto"`。建議 (1)(2)(4)（`disabled` 範圍揭露、錯誤訊息 a11y、缺少 login 測試）
    非阻擋本卡驗收的缺陷，留待使用者決定是否另開任務卡處理。
- 後續任務：TASK-040（忘記密碼／重設密碼接上「忘記密碼？」連結）、TASK-044（登入 MFA
  挑戰步驟）、TASK-056（security-reviewer 建議 (2)：錯誤訊息 a11y 播報穩定性修正）、
  TASK-057（security-reviewer 建議 (4)：補上登入表單測試）。建議 (1)（`disabled=
  {submitting}` 新增於 email/password 欄位、逾越「只改 JSX」範圍）已在上方完成證據中
  揭露，方向為改善非缺陷，使用者核准不需另開任務卡處理。
