# AI-Ready 任務卡

## Metadata

- 任務：預約規則與政策設定 架構基礎（booking_policy 資料表、RLS、後台頁面骨架、Sidebar 連結）
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：預約規則與政策設定
- 上層 User Story：設定最短提前預約時間
- 分軌：不適用（同時涉及資料庫遷移與頁面骨架，比照 TASK-018／TASK-029 的「架構基礎」
  不強套三分法）
- 前置任務（dependsOn）：TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006, TASK-007, TASK-008, TASK-009, TASK-014
- 狀態：就緒（使用者於對話中核准，2026-08-18）
- 風險等級：中（新增資料表與頁面骨架，沿用既有 `business_hours`／`store_settings` 的
  單例表模式，本卡不修改 `create_appointment`／`get_available_slots`，風險低於 TASK-048；
  但仍是本 Epic 後續高風險 RPC 修改的資料基礎，比照 TASK-018 判定為中風險）

## 目標

新增 `booking_policy` 單例資料表與 RLS policy，建立 `/admin/booking-policy` 受保護頁面
骨架（唯讀顯示目前設定），Sidebar 新增「預約規則」導覽項目。不含編輯/儲存邏輯，留給
TASK-047；不修改任何既有 RPC，留給 TASK-048。

## 情境包（Context Pack）

- 相關檔案：
  - `supabase/migrations/0006_store_settings.sql`：最近一次新增「單例設定表」的既有
    寫法（`id` 恆為固定值、seed 保證恆有 1 列、RLS policy 比照 `business_hours` 的
    anon/authenticated 可讀、僅 `is_admin()` 可寫），`booking_policy` 直接比照此模式。
  - `app/admin/business-hours/page.tsx`：既有「受保護頁面骨架」寫法可直接參考。
  - `app/admin/_components/AdminShell.tsx`：`NAV_ITEMS` 目前沒有「預約規則」項目，本卡
    新增 `{ label: "預約規則", href: "/admin/booking-policy" }`。
  - `ai/artifacts/預約規則與政策設定/screen-spec-預約規則頁.md`（已核准畫面規格，
    變體 A：單一表單卡片，本卡只做骨架與唯讀顯示）。
- 既有模式：
  - `lib/store-settings.ts`／`lib/admin/business-hours.ts` 的「讀取＋更新」薄封裝函式
    寫法，`lib/admin/booking-policy.ts`（本卡新增）比照同樣的 `Result<T>` 錯誤處理模式，
    本卡先只做讀取函式。
- 假設：
  - `booking_policy` 比照 `store_settings` 的單例表設計（`id boolean primary key default
    true` 搭配 check constraint 限制只能有一列，或等效做法，細節依既有慣例決定）：
    - `min_lead_time_hours int not null default 1 check (min_lead_time_hours > 0 and
      min_lead_time_hours <= 720)`
    - `cancel_window_hours int check (cancel_window_hours >= 0)`（選填）
    - `updated_at timestamptz not null default now()`
  - migration 需 seed 保證恆有 1 列（`min_lead_time_hours = 1`，對齊現行 `create_appointment`
    寫死的既有行為，`cancel_window_hours` 為 `null`）。
- 未知事項：無。
- 允許變更的檔案：
  - `supabase/migrations/0008_booking_policy.sql`（新增；接續目前實際存在的最大編號
    `0006`，`0007` 已被「設計師登入與帳號安全」Epic 的 TASK-038 使用，本卡用 `0008`
    避免衝突——實作階段需先確認 `0007` 是否已實際套用/存在，若編號有變動需同步調整）
  - `supabase/migrations/0008_booking_policy_down.sql`（新增）
  - `lib/admin/booking-policy.ts`（新增，讀取函式）
  - `app/admin/booking-policy/page.tsx`（新增）
  - `app/admin/_components/BookingPolicyForm.tsx`（新增，唯讀骨架，實際命名可依實作
    階段調整）
  - `app/admin/_components/AdminShell.tsx`（新增 Sidebar 導覽項目）
- 不得觸碰：
  - `supabase/migrations/0002_booking_flow.sql`／`0004_slots_closures_buffer.sql`（
    `create_appointment`／`get_available_slots` 的修改是 TASK-048 的範圍，本卡不動）。
  - `app/_components/booking/`（顧客前台顯示是 TASK-049 的範圍）。

## 需求

- 新增 `supabase/migrations/0008_booking_policy.sql`：建立 `booking_policy` 表、RLS
  policy（anon/authenticated 可讀，僅 `is_admin()` 可寫）、seed 1 列預設值。
- WHEN 已登入管理員造訪 `/admin/booking-policy` THE SYSTEM SHALL 顯示預約規則頁骨架，
  唯讀顯示目前的最短提前預約時間與可取消／改期時限。
- WHEN 顧客端或後台呼叫讀取 `booking_policy` THE SYSTEM SHALL 回傳目前設定值（表恆有
  1 列，不需要處理零列情境，比照 `store_settings`／`business_hours` 的既有假設）。

## 驗收標準

- Sidebar「預約規則」連結可點擊並正確導覽至 `/admin/booking-policy`。
- 預約規則頁正確唯讀顯示目前設定值。
- `booking_policy` 未新增任何超出既有模式的 RLS policy；非管理員無法寫入。
- 未登入或非管理員無法看到頁面內容，沿用既有 `app/admin/layout.tsx` 保護機制。

## 實作備註

- 沿用 mockup 變體 A 的卡片版型，本卡先渲染骨架與唯讀內容，「儲存」按鈕可先無實際行為。

## 驗證契約

- 單元測試：不適用（純 SQL migration 與唯讀頁面骨架）。
- 整合測試：對真實 Supabase 專案驗證 `booking_policy` 的 RLS 邊界（anon/非管理員
  authenticated 只能讀、寫入被拒；`is_admin()` 可讀寫）；併入 TASK-050。
- E2E 測試：Browser 工具走查登入後台→點擊「預約規則」→確認頁面骨架正確顯示。
- 型別檢查：`npx tsc --noEmit`
- Lint：`npm run lint`
- Build：`npm run build`
- 螢幕截圖：預約規則頁骨架（預設）。
- 安全性檢查：`booking_policy` RLS policy 比照既有 `business_hours`／`store_settings`
  模式，僅 `is_admin()` 可寫。

## 完成證據

- 變更的檔案：待實作後填寫。
- 執行過的指令：待實作後填寫。
- 測試輸出：待實作後填寫。
- 螢幕截圖：待實作後填寫。
- 已知限制：待實作後填寫。
- 後續任務：TASK-047（後台表單編輯與儲存）、TASK-048（RPC 讀取設定值）、TASK-049
  （顧客前台政策說明）。
