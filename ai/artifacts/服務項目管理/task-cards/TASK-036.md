# AI-Ready 任務卡

## Metadata

- 任務：服務項目管理 下架/重新上架服務項目
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：服務項目管理
- 上層 User Story：刪除或下架服務項目
- 分軌：前端
- 前置任務（dependsOn）：TASK-034
- 狀態：草稿（待核准後轉就緒）
- 風險等級：低（僅切換既有 `is_active` 布林欄位，沿用既有 `admin full access to services`
  RLS，不新增資料表或權限模型；下架後對顧客端與 `create_appointment`／`get_available_slots`
  的行為已由既有 `is_active = true` 過濾邏輯保證，本卡不修改任何 RPC）

## 目標

在服務項目管理頁的操作欄接上「下架」／「重新上架」按鈕的實際行為：下架前二次確認，通過後
切換該服務項目的 `is_active`，列表即時反映新狀態，顧客前台服務清單同步更新。

## 情境包（Context Pack）

- 相關檔案：
  - `app/admin/_components/ServicesTable.tsx`（TASK-034 建立、TASK-035 已接上新增/編輯的
    列表元件，本卡接上操作欄的下架/重新上架按鈕）
  - `lib/admin/services.ts`（TASK-034/035 已有 `listServices()`／`createService()`／
    `updateService()`，本卡新增 `setServiceActive(id, isActive)`）
  - `components/ui/ConfirmDialog.tsx`（既有確認對話框元件，用於下架前二次確認，比照
    `ai/artifacts/服務項目管理/mockups/admin-services-variant-a.html` 狀態 3 的文案）
  - `supabase/migrations/0001_core_schema.sql`：`get_available_slots`／`create_appointment`
    既有邏輯已只認可 `is_active = true` 的服務（見 `0002_booking_flow.sql`／
    `0004_slots_closures_buffer.sql` 對 `services.is_active` 的既有查詢條件），本卡不需要
    修改任何 RPC，只需驗證既有行為符合預期。
- 既有模式：
  - `ConfirmDialog.tsx` 的 loading／確認/取消雙按鈕 pattern，比照 `WeekCalendar.tsx` 標記
    完成／取消預約時的既有用法。
- 假設：
  - 下架與重新上架皆需要二次確認（比照 mockup 變體 A 的下架確認文案；重新上架風險低於
    下架，但為介面一致性，本卡兩種操作皆走同一個 `ConfirmDialog` 元件，文案依動作類型
    調整）。
  - 下架操作只更新 `services.is_active`，不觸碰 `sort_order`／`name`／`price`／
    `duration_minutes`／`description` 等其他欄位。
  - 已存在的 `appointments` 資料（含使用該服務且已成立的預約）不受下架影響，本卡不需要
    對 `appointments` 表做任何查詢或寫入。
- 未知事項：無。
- 允許變更的檔案：
  - `app/admin/_components/ServicesTable.tsx`
  - `lib/admin/services.ts`
  - `tests/admin/services.test.ts`（若 TASK-035 已建立則擴充，否則新增）
- 不得觸碰：
  - `supabase/migrations/`（`get_available_slots`／`create_appointment` 既有的 `is_active`
    過濾邏輯已足夠，不新增遷移，也不修改既有 RPC 定義）。
  - `ServiceFormDialog.tsx`（TASK-035 負責的新增/編輯表單，本卡不修改）。

## 需求

- WHEN 設計師點擊上架中項目的「下架」 THE SYSTEM SHALL 顯示二次確認對話框（文案說明下架
  後顧客前台不再顯示、無法用於新預約，但既有預約不受影響），確認後將該筆 `services.is_active`
  設為 `false`，列表即時反映為「已下架」狀態、顯示成功 Toast。
- WHEN 設計師點擊已下架項目的「重新上架」 THE SYSTEM SHALL 顯示二次確認對話框，確認後將該
  筆 `services.is_active` 設為 `true`，列表即時反映為「上架中」狀態、顯示成功 Toast。
- WHEN 設計師在確認對話框點擊「再想想」／取消 THE SYSTEM SHALL 關閉對話框，不變更任何資料。
- WHEN 下架或重新上架的寫入失敗 THE SYSTEM SHALL 顯示通用錯誤 Toast，不外洩原始錯誤內容，
  該服務項目狀態維持操作前的值。

## 驗收標準

- 設計師可將上架中的服務項目下架，下架後該項目狀態徽章變為「已下架」。
- 設計師可將已下架的服務項目重新上架，狀態徽章變為「上架中」。
- 下架/重新上架前皆有二次確認步驟，取消後不變更資料。
- 下架後顧客前台服務清單（`ServiceListSection.tsx`）不再顯示該項目，且無法透過
  `create_appointment` 建立針對該服務的新預約（沿用既有 RPC 邏輯，本卡驗證而非新增）。
- 下架不影響該服務項目過去已成立的預約紀錄。
- 非管理員無法變更上下架狀態，沿用既有邊界。

## 實作備註

- 二次確認對話框文案依動作區分：下架強調「顧客端不再顯示、無法建立新預約」；重新上架
  可用較簡短的確認文案（例如「確定要重新上架『{name}』？」），不需要重複下架的完整警語。

## 驗證契約

- 單元測試：不適用（本卡邏輯單純為布林切換，若有可獨立測試的純函式再視情況補上）。
- 整合測試：對真實 Supabase 專案驗證管理員可成功切換 `is_active`、非管理員寫入被拒；下架
  後 `get_available_slots` 對該服務回傳空時段、`create_appointment` 對該服務的預約請求被
  拒絕（沿用既有 `SERVICE_INACTIVE` 或既有錯誤碼，需先查證既有 RPC 實際回傳的錯誤碼，不
  假設新增）；併入 TASK-037 的整合測試檔案。
- E2E 測試：Browser 工具走查下架→切到顧客前台確認不再顯示→重新上架→前台恢復顯示；併入
  TASK-037 或本卡自行走查皆可。
- 型別檢查：`npx tsc --noEmit`
- Lint：`npm run lint`
- Build：`npm run build`
- 螢幕截圖：下架二次確認、下架後狀態、重新上架後狀態、成功 Toast。
- 安全性檢查：確認狀態切換沿用既有 `is_admin()` RLS 邊界；確認下架不會意外觸發對
  `appointments` 的任何串聯變更。

## 完成證據

- 變更的檔案：待實作後填寫。
- 執行過的指令：待實作後填寫。
- 測試輸出：待實作後填寫。
- 螢幕截圖：待實作後填寫。
- 已知限制：待實作後填寫。
- 後續任務：TASK-037（整合驗證）。
