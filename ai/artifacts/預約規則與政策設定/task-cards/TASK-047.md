# AI-Ready 任務卡

## Metadata

- 任務：預約規則與政策設定 後台預約規則表單編輯與儲存
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：預約規則與政策設定
- 上層 User Story：設定最短提前預約時間、設定可取消／改期時限
- 分軌：前端
- 前置任務（dependsOn）：TASK-046
- 狀態：已核准（2026-08-18），待前置任務 TASK-046 完成後轉就緒
- 風險等級：低（沿用 TASK-046 已建立的 `booking_policy` RLS 邊界，寫入僅呼叫既有
  `is_admin()` policy 保護的 `update`，不修改任何預約寫入路徑的 RPC，比照 TASK-030
  的低風險判定）

## 目標

在 TASK-046 建立的預約規則頁骨架上，接上表單編輯能力：最短提前預約時間（必填，
1～720 小時）與可取消／改期時限（選填，≥ 0 小時）可編輯並儲存。

## 情境包（Context Pack）

- 相關檔案：
  - `app/admin/_components/BookingPolicyForm.tsx`（TASK-046 建立的唯讀骨架，本卡接上
    編輯能力）
  - `lib/admin/booking-policy.ts`（TASK-046 建立的讀取函式，本卡新增
    `updateBookingPolicy(minLeadTimeHours, cancelWindowHours)`）
  - `lib/admin/business-hours.ts` 的「驗證函式＋`updateBusinessHours`」模式可直接參考。
- 既有模式：
  - `Result<T>` 錯誤處理模式，寫入失敗顯示通用 Toast，不外洩原始錯誤內容。
- 假設：
  - 最短提前預約時間為必填整數，範圍 1～720（對應資料庫 `check` constraint）。
  - 可取消／改期時限為選填整數，≥ 0（對應資料庫 `check` constraint），留空代表
    `null`（未設定）。
- 未知事項：無。
- 允許變更的檔案：
  - `app/admin/_components/BookingPolicyForm.tsx`
  - `lib/admin/booking-policy.ts`
  - `tests/admin/booking-policy.test.ts`（新增，欄位驗證純函式的單元測試）
- 不得觸碰：
  - `supabase/migrations/`（不新增遷移，`booking_policy` 表已由 TASK-046 建立）。
  - `create_appointment`／`get_available_slots`（TASK-048 的範圍）。

## 需求

- WHEN 設計師編輯最短提前預約時間並送出 THE SYSTEM SHALL 驗證數值為 1～720 之間的整數，
  通過後寫入 `booking_policy`，成功後顯示成功 Toast。
- WHEN 設計師編輯可取消／改期時限並送出 THE SYSTEM SHALL 驗證數值為 ≥ 0 的整數或空值，
  通過後寫入 `booking_policy`，成功後顯示成功 Toast。
- WHEN 驗證失敗 THE SYSTEM SHALL 阻擋送出並標示錯誤欄位。
- WHEN 寫入失敗 THE SYSTEM SHALL 顯示通用錯誤 Toast，不外洩原始錯誤內容。

## 驗收標準

- 設計師可編輯並儲存最短提前預約時間（1～720 小時）與可取消／改期時限（≥ 0 或留空）。
- 數值超出範圍時無法送出，顯示行內錯誤。
- 非管理員無法寫入，沿用 TASK-046 已建立的邊界。

## 實作備註

- 沿用 mockup 變體 A 的單一卡片版型，兩欄位＋底部單一「儲存」按鈕。

## 驗證契約

- 單元測試：最短提前預約時間／可取消時限欄位的驗證純函式。
- 整合測試：對真實 Supabase 專案驗證管理員可成功寫入、非管理員被拒；併入 TASK-050。
- E2E 測試：Browser 工具走查編輯兩欄位→驗證錯誤→修正→儲存成功；併入 TASK-050 或本卡
  自行走查皆可。
- 型別檢查：`npx tsc --noEmit`
- Lint：`npm run lint`
- Build：`npm run build`
- 螢幕截圖：編輯中、驗證錯誤、儲存中、儲存成功。
- 安全性檢查：確認寫入路徑沿用既有 `is_admin()` RLS 邊界，前端驗證不是唯一防線。

## 完成證據

- 變更的檔案：待實作後填寫。
- 執行過的指令：待實作後填寫。
- 測試輸出：待實作後填寫。
- 螢幕截圖：待實作後填寫。
- 已知限制：待實作後填寫。
- 後續任務：TASK-050（整合驗證）。
