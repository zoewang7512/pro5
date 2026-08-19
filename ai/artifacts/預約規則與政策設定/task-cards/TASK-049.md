# AI-Ready 任務卡

## Metadata

- 任務：預約規則與政策設定 顧客前台政策說明區塊
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：預約規則與政策設定
- 上層 User Story：顧客端顯示預約政策說明
- 分軌：前端
- 前置任務（dependsOn）：TASK-046
- 狀態：已核准（2026-08-18），待前置任務 TASK-046 完成後轉就緒
- 風險等級：低（純顯示區塊，讀取既有 `booking_policy` 的既有讀取權限（anon 可讀），
  不涉及新增權限模型或寫入邏輯，比照既有前台顯示類任務的低風險判定）

## 目標

在顧客前台預約流程（`BookingFlow.tsx` → `ContactFormSection.tsx`）新增政策說明資訊
卡片（依已核准 mockup 變體 B，置於聯絡表單內部、送出按鈕正上方），文字依
`booking_policy` 目前設定值動態組成。

## 情境包（Context Pack）

- 相關檔案：
  - `app/_components/booking/ContactFormSection.tsx`：既有聯絡表單元件，本卡在送出
    按鈕正上方新增政策說明資訊卡片。
  - `app/_components/booking/BookingFlow.tsx`：需新增讀取 `booking_policy` 的
    effect（比照既有 `getStoreSettings` 獨立 fetch、互不阻塞既有預約流程的既有模式），
    將讀取結果往下傳給 `ContactFormSection`。
  - `lib/booking/api.ts`：本卡新增 `getBookingPolicy(supabase)` 讀取函式（顧客端用，
    比照既有 `getBusinessHours`／`getServices` 的薄封裝寫法）。
  - `ai/artifacts/預約規則與政策設定/mockups/customer-policy-variant-b.html`（已核准
    mockup，資訊卡片樣式）。
- 既有模式：
  - `BrandHeaderSection.tsx` 的「獨立 fetch、載入慢或失敗不阻塞既有預約流程」既有模式
    （TASK-032 security-reviewer 審查發現的既有慣例），本卡的政策說明讀取比照同樣的
    `.catch` 降級處理，讀取失敗時不顯示政策卡片（不影響既有預約流程），不顯示錯誤訊息。
- 假設：
  - 文案組成規則：
    - 兩項政策皆已設定：「請於預約時段前 {min_lead_time_hours} 小時完成預約。預約
      時段前 {cancel_window_hours} 小時內可免費取消或改期。」
    - 僅設定提前時間（`cancel_window_hours` 為 `null`）：「請於預約時段前
      {min_lead_time_hours} 小時完成預約。」（不顯示取消/改期句子）
  - 文案組成邏輯抽成純函式（例如 `lib/booking/policy-text.ts` 的
    `formatBookingPolicyText(policy)`），方便單元測試。
- 未知事項：無。
- 允許變更的檔案：
  - `app/_components/booking/BookingFlow.tsx`
  - `app/_components/booking/ContactFormSection.tsx`
  - `lib/booking/api.ts`
  - `lib/booking/policy-text.ts`（新增，文案組成純函式）
  - `tests/lib/policy-text.test.ts`（新增）
- 不得觸碰：
  - 既有服務選擇／時段選擇／表單填寫的既有互動流程與版面深度（僅新增政策說明卡片，
    不變更既有欄位或按鈕行為）。
  - `app/admin/`（後台範圍是 TASK-046／047 的範圍）。

## 需求

- WHEN 顧客瀏覽預約流程進入聯絡表單區塊 THE SYSTEM SHALL 顯示依目前 `booking_policy`
  設定值組成的政策說明資訊卡片，置於「確認預約」按鈕正上方。
- WHEN `booking_policy.cancel_window_hours` 為 `null`（未設定） THE SYSTEM SHALL 只
  顯示提前預約時間的說明句子，不顯示取消／改期句子，不出現空白或錯誤文字片段。
- WHEN 讀取 `booking_policy` 失敗 THE SYSTEM SHALL 靜默降級（不顯示政策卡片），不阻擋
  或干擾既有預約流程的其餘互動。

## 驗收標準

- 顧客端聯絡表單區塊正確顯示政策說明卡片，文案依設定值動態組成。
- 僅設定提前時間時，取消/改期句子不顯示，不出現空白或錯誤數值。
- 政策說明讀取失敗時不影響既有預約流程（無回歸）。
- 不干擾既有服務選擇／時段選擇／表單填寫互動流程與版面深度。

## 實作備註

- 沿用 mockup 變體 B 的資訊卡片樣式（`info` 語意色淺底、icon）。
- `ContactFormSection.tsx` 版面調整後，需在行動裝置尺寸（375px）確認「確認預約」按鈕
  仍在合理捲動範圍內可見，不被政策卡片過度擠壓。

## 驗證契約

- 單元測試：`formatBookingPolicyText` 純函式（兩項皆設定／僅提前時間兩種情境）。
- 整合測試：不適用於本卡（`booking_policy` 讀取 RLS 邊界已由 TASK-046/050 覆蓋）。
- E2E 測試：Browser 工具走查顧客前台預約流程，確認政策說明卡片正確顯示於聯絡表單區塊。
- 型別檢查：`npx tsc --noEmit`
- Lint：`npm run lint`
- Build：`npm run build`
- 螢幕截圖：政策說明卡片（兩項皆設定／僅提前時間兩種情境）、行動裝置尺寸版面確認。
- 安全性檢查：讀取 `booking_policy` 沿用既有 anon 可讀 RLS policy，不需要額外驗證；
  文案為系統組成（非使用者輸入），無 XSS 疑慮。

## 完成證據

- 變更的檔案：待實作後填寫。
- 執行過的指令：待實作後填寫。
- 測試輸出：待實作後填寫。
- 螢幕截圖：待實作後填寫。
- 已知限制：待實作後填寫。
- 後續任務：TASK-050（整合驗證）。
