# AI-Ready 任務卡

## Metadata

- 任務：預約規則與政策設定 顧客前台政策說明區塊
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：預約規則與政策設定
- 上層 User Story：顧客端顯示預約政策說明
- 分軌：前端
- 前置任務（dependsOn）：TASK-046
- 狀態：完成（人工已於 2026-08-23 驗收通過）
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
  - `lib/booking-policy.ts`：TASK-046 已建立 `getBookingPolicy(supabase)` 讀取函式並放在
    `lib/` 頂層（而非 `lib/admin/`），正是為了讓本卡直接 import 同一支函式，不需要在
    `lib/booking/api.ts` 另寫一份重複的讀取邏輯（兩邊查詢形狀完全相同，不像
    `business_hours` 有批次／單一 weekday 的既有差異）。
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

詳見 `tools/kanban/cards/TASK-049.json` 的 `evidence` 欄位（commands／findings／residual）。
摘要：

- 變更的檔案：`lib/booking/policy-text.ts`（新增，`formatBookingPolicyText` 純函式）、
  `tests/lib/policy-text.test.ts`（新增，3 個單元測試）、
  `app/_components/booking/BookingFlow.tsx`（修改，新增獨立 `getBookingPolicy` effect，
  `.catch` 靜默降級為不顯示卡片）、`app/_components/booking/ContactFormSection.tsx`
  （修改，新增 `policyText` prop，用既有 `Alert severity="info"` 元件呈現於送出按鈕
  正上方——mockup-decision 明訂「不新增元件」，比照 `SlotPickerSection.tsx` 已使用的
  `Alert severity="info"` 既有慣例，未使用 mockup HTML 手刻的一次性樣式）。
- 執行過的指令：`npx tsc --noEmit`／`npm run lint`／`npm run build` 皆通過；
  `npx vitest run`（337 tests，含新增 3 個文案組成測試，無回歸）。
- 審查：本卡風險等級低、純顯示區塊、沿用 TASK-046 已審查通過的 `booking_policy` anon
  可讀 RLS 邊界，未新增權限模型或寫入邏輯，比照 TASK-030／TASK-047 的既有判定，未派遣
  architect／security-reviewer 正式審查。
- 測試輸出：`formatBookingPolicyText` 涵蓋兩項皆設定／僅提前時間（`cancel_window_hours`
  為 `null`）／`cancel_window_hours` 為 `0`（刻意設定「隨時可取消」，非未設定，用 `==
  null` 而非真值判斷正確區分）三種情境，3/3 通過。
- 螢幕截圖：Browser 工具走查顧客前台預約流程（選服務→選時段→聯絡表單），透過
  `javascript_tool` 讀取 DOM 內容驗證：(1) 預設值（`min_lead_time_hours=1`、
  `cancel_window_hours=null`）僅顯示「請於預約時段前 1 小時完成預約。」；(2) 暫時調整
  為 `3`／`24` 後正確顯示「請於預約時段前 3 小時完成預約。預約時段前 24 小時內可免費
  取消或改期。」，驗證後已還原為原值；(3) 行動裝置尺寸（375×812）下兩種情境的「送出
  預約」按鈕皆完整落在單一螢幕內（`bottom` 分別為 627px／651px，皆小於 812px 視窗
  高度），不需捲動即可見，未出現 mockup-decision 擔心的擠壓問題。本次 Browser 面板
  未顯示，`computer` 的 screenshot 動作持續逾時失敗，未能取得像素螢幕截圖，以上述
  DOM／版面座標驗證作為替代證據。
- 已知限制：與 TASK-047 相同的螢幕截圖缺口（Browser 面板未顯示）；未測試三個以上服務
  同時存在、或聯絡表單欄位驗證錯誤同時顯示時的版面互動（超出本卡「僅新增政策說明卡片」
  的範圍）。
- 後續任務：TASK-050（整合驗證，可視需要補拍像素螢幕截圖）。

**TASK-050 追記**：上方「取消或改期」句子的文案（「N 小時內可免費取消或改期」）經
security-reviewer 於 TASK-050 Epic 總覽性審查發現與後台說明文字語意相反（見
`lib/booking/policy-text.ts` 檔頭說明），已依人工核准修正為「請於預約時段前 N 小時
以前完成取消或改期」，`feature-spec.md` 與本卡上方引用的文案範例已是修正前的歷史記錄，
現行程式碼與測試以修正後版本為準。
