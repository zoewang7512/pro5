# AI-Ready 任務卡

## Metadata

- 任務：預約規則與政策設定 後台預約規則表單編輯與儲存
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：預約規則與政策設定
- 上層 User Story：設定最短提前預約時間、設定可取消／改期時限
- 分軌：前端
- 前置任務（dependsOn）：TASK-046
- 狀態：完成（人工已於 2026-08-23 驗收通過）
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
  - `lib/booking-policy.ts`（TASK-046 建立的讀取函式，放在 `lib/` 頂層而非 `lib/admin/`
    ——`booking_policy` 是雙邊共享的網域資料，TASK-049 顧客前台直接 import 同一支
    `getBookingPolicy`，理由見該檔案檔頭；本卡新增
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
  - `lib/booking-policy.ts`
  - `tests/booking-policy.test.ts`（新增，欄位驗證純函式的單元測試）
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

詳見 `tools/kanban/cards/TASK-047.json` 的 `evidence` 欄位（commands／findings／residual）。
摘要：

- 變更的檔案：`lib/booking-policy.ts`（修改，新增 `BookingPolicyInput`／
  `validateMinLeadTimeHours`／`validateCancelWindowHours`／`updateBookingPolicy`）、
  `app/admin/_components/BookingPolicyForm.tsx`（修改，唯讀骨架接上編輯／驗證／儲存，
  拆出獨立管理編輯狀態的 `PolicyCard` 子元件，比照 `StoreSettingsForm.tsx` 的
  `BasicInfoCard` 既有寫法）、`tests/booking-policy.test.ts`（新增，13 個單元測試）。
- 執行過的指令：`npx tsc --noEmit`／`npm run lint`／`npm run build` 皆通過；
  `npx vitest run`（334 tests，含新增 13 個驗證/寫入函式測試；4 個測試檔案在滿載並行
  執行時因 5000ms timeout 出現既有的間歇性逾時，與本卡改動的檔案無關，逐一重跑該 4 個
  檔案皆 100% 通過，非本卡引入的回歸）。
- 審查：本卡風險等級低、沿用 TASK-046 已建立並經 architect／security-reviewer 審查通過的
  `booking_policy` RLS 邊界，未新增任何安全性表面（寫入路徑就是同一張表的 `update`，
  邊界已由 `tests/booking-policy.integration.test.ts` 涵蓋），比照 TASK-030 的既有判定，
  未派遣 architect／security-reviewer 正式審查。
- 測試輸出：`tests/booking-policy.test.ts` 涵蓋兩個驗證函式的邊界情況（必填／範圍／
  非整數／留空）與 `updateBookingPolicy` 的成功／失敗／RLS 悄悄擋下寫入三種情境，
  13/13 通過。
- 螢幕截圖：Browser 工具走查編輯→驗證錯誤→修正→儲存成功→重新整理持久化全流程，
  透過 DOM 內容（`get_page_text`／`javascript_tool` 讀取欄位值與按鈕狀態）逐步驗證，
  結果符合預期（超出範圍顯示「請輸入 1～720 小時之間的整數」且未送出；修正後送出成功、
  按鈕回到停用狀態；重新整理後資料庫確實已寫入新值）。本次 Browser 面板未顯示，
  `computer` 的 screenshot 動作持續逾時失敗，未能取得像素螢幕截圖，以上述 DOM 驗證
  作為替代證據；走查完成後已透過 UI 把資料改回原值（1／留空），未留下測試髒資料。
- 已知限制：螢幕截圖缺口（見上）；`min_lead_time_hours`／`cancel_window_hours` 的
  `TextField` 使用瀏覽器原生 `type="number"`，未特別處理小數點/科學記號等原生 number
  input 的邊界輸入行為（`Number()` 轉換 + `Number.isInteger` 已擋下非整數，風險低）。
- 後續任務：TASK-050（整合驗證，可視需要為本卡的寫入流程補充像素螢幕截圖）。
