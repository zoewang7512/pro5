# AI-Ready 任務卡

## Metadata

- 任務：設計師登入與帳號安全 補上登入表單測試（失敗／成功／送出中防重複）
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：設計師登入與帳號安全
- 上層 User Story：設計師登入／登出
- 分軌：前端
- 前置任務（dependsOn）：TASK-039
- 狀態：完成（使用者於對話中核准，2026-08-18）
- 風險等級：低（新增測試，不變更既有實作邏輯）
- Agent owner：
- 人工核准者：使用者（2026-08-18）

## 目標

為 `app/login/login-form.tsx` 補上元件測試，涵蓋登入失敗、登入成功、送出中防重複送出三種
情境，避免這個全站唯一的驗證入口未來重構時只能靠人工目視確認（TASK-039
security-reviewer 審查發現目前 `tests/` 底下沒有任何 login 相關測試）。

## 情境包（Context Pack）

- 相關檔案：
  - `app/login/login-form.tsx`：受測對象。`handleSubmit` 呼叫
    `supabase.auth.signInWithPassword`，失敗顯示「帳號或密碼錯誤，請再試一次。」，成功則
    `router.replace("/admin")` 並 `router.refresh()`；送出中 `submitting` state 讓
    `Button` 呈現 `loading`（連帶 `disabled`）。
  - `tests/components/image-upload-field.test.tsx`：RTL + vitest 的元件測試寫法可直接
    參考（`vi.mock` 替換模組、`renderWithTheme` 包 MUI theme、`afterEach(cleanup)`）。
  - `tests/test-utils`（`renderWithTheme`）：既有測試共用的 render helper，本卡沿用。
- 既有模式：
  - 專案內既有元件測試都是用 `vi.mock` 直接替換被測元件依賴的模組（例如
    `image-upload-field.test.tsx` mock `@/lib/store-settings`）。本卡比照此模式 mock
    `@/lib/supabase/client` 的 `createClient`，讓 `signInWithPassword` 回傳可控制的
    成功／失敗結果。
  - `next/navigation` 的 `useRouter` 目前專案測試裡沒有先例，本卡需要建立
    `vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }))`
    這類新 mock pattern；若之後其他測試也需要，可再考慮抽成共用 helper，但本卡不用
    先做這個抽象（YAGNI，等真的有第二個使用場景再抽）。
- 假設：
  - 測試應驗證「現狀行為」，不是拿來驅動 `login-form.tsx` 的實作變更；如果撰寫測試過程中
    發現任何行為不如預期（例如 bug），應回報而非直接動手修正既有邏輯（除非使用者另外
    核准）。
  - MUI `TextField` 的 `label` 本身就是 accessible name，測試可用
    `screen.getByLabelText("Email")`／`getByLabelText("密碼")` 選取欄位，不需要額外加
    `data-testid`。
- 未知事項：無。
- 允許變更的檔案：
  - `tests/components/login-form.test.tsx`（新檔案）
- 不得觸碰：
  - `app/login/login-form.tsx`（測試不應要求修改受測元件；若測試技術上卡住必須改動
    受測元件才能測，先回報而非直接改）。

## 需求

- WHEN 使用者輸入帳密並送出，且 `signInWithPassword` 回傳 error THE SYSTEM SHALL
  顯示「帳號或密碼錯誤，請再試一次。」錯誤文案，且不呼叫 `router.replace`。
- WHEN 使用者輸入帳密並送出，且 `signInWithPassword` 成功 THE SYSTEM SHALL 呼叫
  `router.replace("/admin")` 與 `router.refresh()`。
- WHEN 表單送出中 THE SYSTEM SHALL 讓登入按鈕呈現 disabled／loading 狀態，防止重複送出
  觸發第二次 `signInWithPassword` 呼叫。

## 驗收標準

- 新增至少 3 個測試案例（登入失敗、登入成功、送出中防重複），全數通過。
- `npx vitest run` 執行既有測試套件無回歸（新增檔案不影響其他測試）。
- 測試不依賴真實 Supabase 連線（比照既有 mock 模式）。

## 實作備註

- 直接建立 `tests/components/login-form.test.tsx`，比照
  `tests/components/image-upload-field.test.tsx` 的檔案結構（`@vitest-environment jsdom`
  註解、`afterEach(cleanup)`、`vi.hoisted` 建立可控 mock 函式）。

## 驗證契約

- 單元測試：`npx vitest run tests/components/login-form.test.tsx`
- 整合測試：不適用（不連線真實 Supabase）。
- E2E 測試：不適用（本卡範疇是元件測試，既有 Browser 工具走查已在 TASK-039 完成）。
- 型別檢查：`npx tsc --noEmit`
- Lint：`npm run lint`
- Build：不適用（未變更 production 程式碼）。
- 螢幕截圖：不適用。
- 安全性檢查：不適用。

## 完成證據

- 變更的檔案：`tests/components/login-form.test.tsx`（新檔案）。`app/login/login-form.tsx`
  未變更。
- 執行過的指令：
  - `npx vitest run tests/components/login-form.test.tsx`（3 passed）
  - `npx vitest run`（全套 20 files／173 tests passed，含新增 3 案例，既有測試無回歸）
  - `npx tsc --noEmit`（通過）
  - `npm run lint`（通過）
- 測試輸出：新增 3 個測試案例皆通過：
  1. 登入失敗時顯示「帳號或密碼錯誤，請再試一次。」，`router.replace`／`router.refresh`
     皆未被呼叫。
  2. 登入成功時 `signInWithPassword` 收到正確的 `{ email, password }` 參數，且觸發
     `router.replace("/admin")`／`router.refresh()`。
  3. 送出中登入按鈕呈現 disabled，第二次點擊（改用 `fireEvent.click`，因為
     `userEvent.click` 會因按鈕 `pointer-events: none` 直接拒絕互動，測不到 React 層級
     的 `disabled` 是否真的擋下）不會觸發第二次 `signInWithPassword` 呼叫。
- 螢幕截圖：不適用（純測試新增，無 UI 變更）。
- 已知限制：
  - 測試不連線真實 Supabase，比照專案既有 mock 模式（`vi.mock` 替換
    `@/lib/supabase/client` 與 `next/navigation`）。
  - 未涵蓋 TASK-056 新增的 `aria-live`／`role` 屬性驗證，該部分已由 TASK-056 自身的
    Browser 工具走查佐證，屬於不同驗證手法，本卡不重複覆蓋。
  - 除錯過程中發現一個測試撰寫陷阱並已修正：`vi.hoisted` 建立的 mock 函式跨測試共用同一
    實例，未加 `beforeEach(() => vi.clearAllMocks())` 會導致呼叫次數累加、誤判防重複送出
    失敗；已修正並在測試檔內加註解說明原因，避免後續維護者重踩。
- 後續任務：無。
