# AI-Ready 任務卡

## Metadata

- 任務：設計師登入與帳號安全 登入頁錯誤訊息 a11y 修正（穩定 aria-live 播報）
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：設計師登入與帳號安全
- 上層 User Story：設計師登入／登出
- 分軌：前端
- 前置任務（dependsOn）：TASK-039
- 狀態：完成（使用者於對話中核准，2026-08-18）
- 風險等級：低（純 a11y 屬性調整，不涉及驗證邏輯或跨頁共用元件）
- Agent owner：
- 人工核准者：使用者（2026-08-18）

## 目標

讓 `app/login/login-form.tsx` 登入失敗時的錯誤文案能穩定被螢幕閱讀器播報，不依賴「元素
從無到有才被賦予 `role="alert"`」這種偵測方式。

## 情境包（Context Pack）

- 相關檔案：
  - `app/login/login-form.tsx`：密碼欄位目前用 `helperText={error ?? " "}` 讓
    `TextField` 的 helper text 容器恆常存在，只透過
    `slotProps={{ formHelperText: { role: error ? "alert" : undefined } }}` 動態切換
    `role` 屬性（見 TASK-039 實作）。部分螢幕閱讀器對「已存在元素才被賦予
    `role="alert"`」的情境播報不穩定，這是本卡要修正的對象。
- 既有模式：
  - 無其他頁面有相同的錯誤訊息 a11y pattern（登入頁是唯一入口），本卡可視為此 pattern
    的第一個實作，之後若其他表單有類似需求可回頭參考。
- 假設：
  - 只調整錯誤訊息容器的 aria 屬性／渲染方式（例如把 `role="alert"` 改成恆常存在、或改用
    `aria-live="polite"` 的固定容器只切換內容），不改變 `handleSubmit` 內
    `signInWithPassword`／導向等既有邏輯，也不改變現有視覺樣式（顏色、文字位置、字級）。
  - 允許小幅調整 helperText 的渲染方式（例如固定渲染 `aria-live="polite"` 而非依賴
    `role` 屬性的有無切換），只要視覺輸出與 TASK-039 完全一致。
- 未知事項：無。
- 允許變更的檔案：
  - `app/login/login-form.tsx`
- 不得觸碰：
  - `handleSubmit` 內對 Supabase Auth 的呼叫邏輯與導向邏輯。
  - Email／密碼欄位以外的其他 UI 元素。

## 需求

- WHEN 使用者送出帳密且登入失敗 THE SYSTEM SHALL 讓密碼欄位下方的錯誤文案透過穩定的
  `aria-live`（或等效恆常存在的 `role="alert"` 容器）機制被螢幕閱讀器播報，不論該容器在
  送出前是否已存在於 DOM。
- WHEN 登入頁處於預設狀態（尚未送出、無錯誤）THE SYSTEM SHALL 不會播報空白內容或造成
  螢幕閱讀器誤判有錯誤發生。

## 驗收標準

- 使用 Browser 工具的 accessibility tree／`read_page` 確認錯誤訊息容器帶有穩定的
  `aria-live="polite"`（或等效機制），登入失敗後錯誤文案可被偵測到。
- 視覺樣式（顏色、位置、文案「帳號或密碼錯誤，請再試一次。」）與 TASK-039 完全一致，無
  回歸。
- `signInWithPassword`／`router.replace`／`router.refresh` 等既有行為不受影響。

## 實作備註

- 可參考 MUI `TextField` 的 `slotProps.formHelperText` 用法（TASK-039 已使用），或視需要
  改用固定渲染的 `<span aria-live="polite">` 包裹錯誤文案。實作時選擇對現有 JSX 改動最小
  的方式即可，不需要引入新元件庫或跨頁共用抽象。

## 驗證契約

- 單元測試：不適用（純 a11y 屬性調整）。
- 整合測試：不適用。
- E2E 測試：Browser 工具走查登入失敗情境，確認 accessibility tree 中錯誤容器的
  `aria-live`／`role` 屬性符合預期。
- 型別檢查：`npx tsc --noEmit`
- Lint：`npm run lint`
- Build：`npm run build`
- 螢幕截圖：登入失敗狀態（確認視覺與 TASK-039 一致，無回歸）。
- 安全性檢查：不適用（無驗證邏輯變更）。

## 完成證據

- 變更的檔案：`app/login/login-form.tsx`（密碼欄位 `TextField` 的
  `slotProps.formHelperText` 由 `{ role: error ? "alert" : undefined }` 改為固定
  `{ role: "alert", "aria-live": "polite" }`；其餘 JSX／邏輯未動）。
- 執行過的指令：
  - `npx tsc --noEmit`（通過）
  - `npm run lint`（通過）
  - `npm run build`（通過，`/login` 路由成功產出）
  - Browser 工具走查：清除 session cookie 回到未登入狀態，先在登入表單預設狀態讀取
    helperText 容器的 `role`／`aria-live`／`id`，再輸入錯誤帳密送出後重新讀取同一批
    屬性比對。
- 測試輸出：無新增自動化測試（本卡範疇為 a11y 屬性調整；元件測試由 TASK-057 涵蓋）。
- 螢幕截圖：登入失敗狀態已截圖，視覺與 TASK-039 完全一致（顏色、位置、文案不變）。
- 已知限制：
  - 預設狀態與登入失敗狀態下讀取到的 helperText 容器 `id`（例如
    `_R_alaklritmllb_-helper-text`）相同，`role="alert"`／`aria-live="polite"` 兩種狀態
    下皆存在，僅 `textContent` 改變，確認容器本身在整個互動過程中沒有被重新掛載，修正
    方向正確。
  - 未使用實際螢幕閱讀器（NVDA／VoiceOver）人工聽覺驗證播報效果，僅以 DOM 屬性檢查佐證；
    如需更嚴謹驗證可留待後續任務。
- 後續任務：無。
