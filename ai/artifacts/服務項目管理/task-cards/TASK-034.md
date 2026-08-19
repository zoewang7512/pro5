# AI-Ready 任務卡

## Metadata

- 任務：服務項目管理 架構基礎（頁面骨架、Sidebar 啟用、服務項目列表唯讀顯示）
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：服務項目管理
- 上層 User Story：新增/編輯服務項目
- 分軌：前端
- 前置任務（dependsOn）：TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006, TASK-007, TASK-008, TASK-009, TASK-014
- 狀態：完成（人工已於 2026-08-18 驗收通過）
- 風險等級：中（新的受保護後台路由，唯讀顯示包含下架中項目的完整服務清單；沿用既有
  `AdminShell`／`is_admin()` 保護模式，不新增 RLS 或資料表，比照 TASK-018 的架構基礎卡風險
  等級）

## 目標

在 `/admin/services` 建立受保護頁面骨架，唯讀顯示目前所有服務項目（含上架與下架中，比照已
核准 mockup 變體 A 的表格版型），Sidebar「服務設定」連結從停用（`AdminShell.tsx` 目前
`disabled: true`）改為可點擊。不含新增／編輯／下架／上架的任何寫入邏輯，留給 TASK-035／
TASK-036。

## 情境包（Context Pack）

- 相關檔案：
  - `app/admin/_components/AdminShell.tsx`：`NAV_ITEMS` 目前已有
    `{ label: "服務設定", href: "/admin/services", disabled: true }` 佔位項目，本卡移除
    `disabled: true`。
  - `app/admin/business-hours/page.tsx`：既有「受保護頁面骨架」寫法可直接參考（頁面層呼叫
    `is_admin()` 二次確認、`export const dynamic = "force-dynamic"`）。
  - `app/admin/_components/BusinessHoursForm.tsx`：既有「頁面骨架＋唯讀資料表格」的元件
    寫法參考（本卡對應要做的是服務項目版本，暫定命名 `app/admin/_components/ServicesTable.tsx`，
    實作階段可依既有命名慣例調整）。
  - `lib/admin/business-hours.ts`：既有「純讀取函式＋型別」的 `lib/admin/` 模組寫法參考，本卡
    新增 `lib/admin/services.ts` 的唯讀 `listServices()`（回傳全部服務項目，不受
    `is_active` 過濾，需 `is_admin()` 權限）。
  - `ai/artifacts/服務項目管理/screen-spec-服務項目管理.md`（已核准畫面規格，變體 A）。
  - `ai/artifacts/服務項目管理/mockups/admin-services-variant-a.html`（已核准 mockup，狀態
    1「預設列表」為本卡對應畫面）。
  - `supabase/migrations/0001_core_schema.sql`：`services` 表既有欄位與 RLS policy
    （`admin full access to services`，`authenticated` + `is_admin()`），本卡不新增遷移。
- 既有模式：
  - `WeekCalendar.tsx`／`AppointmentListView.tsx` 等既有後台頁面元件皆為「本頁面專用，非跨頁
    共用」時放在 `app/admin/_components/`，非跨頁共用元件不強制放入 `components/ui/`。
  - `Skeleton`（載入中）、`Chip`（狀態徽章，比照既有 `success`／`grey` 語意色用法）、`Table`
    （MUI 直接使用）皆為元件庫 inventory 已完成項目，直接沿用，不需新做。
- 假設：
  - 頁面層讀取 `services` 全部列（不加 `is_active` 過濾），因為設計師需要同時看到上架與
    下架中的項目；顧客端既有查詢（`lib/booking/api.ts`）維持不變，仍只讀 `is_active = true`。
  - 狀態徽章：`is_active = true` 顯示「上架中」（`success` 語意色），`is_active = false`
    顯示「已下架」（`grey` 語意色），比照 mockup 變體 A 的 `chip on`／`chip off` 樣式。
  - 列表排序沿用 `sort_order`、`created_at` 或資料庫預設順序（本卡不新增排序 UI，見
    feature-spec 非目標），實作階段選擇一個穩定排序即可，不需要額外規格。
- 未知事項：無。
- 允許變更的檔案：
  - `app/admin/_components/AdminShell.tsx`（移除服務設定 `disabled: true`）
  - `app/admin/services/page.tsx`（新增）
  - `app/admin/_components/ServicesTable.tsx`（新增，唯讀列表元件，實際檔名可依實作階段調整）
  - `lib/admin/services.ts`（新增，唯讀 `listServices()` 與型別定義）
- 不得觸碰：
  - `supabase/migrations/`（`services` 表與 RLS 已存在，本卡不新增遷移）。
  - `app/_components/booking/ServiceListSection.tsx`／`lib/booking/`（顧客端既有實作，本 Epic
    不重新開發，見 feature-spec 非目標）。
  - `app/admin/layout.tsx`（既有 `is_admin()` 保護與 `AdminShell` 掛載邏輯，本卡新頁面沿用
    現有 layout，不需修改）。

## 需求

- WHEN 已登入的管理員造訪 `/admin/services` THE SYSTEM SHALL 顯示服務項目管理頁，列出目前
  資料庫內所有服務項目（含上架與下架中），每列顯示名稱、價格、時長、狀態徽章。
- WHEN 頁面資料載入中 THE SYSTEM SHALL 顯示 Skeleton 佔位。
- WHEN 尚無任何服務項目 THE SYSTEM SHALL 顯示空狀態文案與「新增服務項目」按鈕（按鈕本卡先
  渲染，點擊行為留給 TASK-035）。
- WHEN 未登入或非管理員造訪 `/admin/services` THE SYSTEM SHALL 依既有 `app/admin/layout.tsx`
  保護機制導回登入頁，沿用既有邊界，不需本卡新增邏輯。

## 驗收標準

- Sidebar「服務設定」連結可點擊並正確導覽至 `/admin/services`，`active` 狀態正確反映當前路由。
- 頁面正確列出所有服務項目（含上架與下架中），狀態徽章清楚區分兩種狀態。
- 資料載入中顯示 Skeleton；無任何服務項目時顯示空狀態。
- 「新增服務項目」與各列「編輯」「下架／重新上架」按鈕皆已渲染於畫面上，但本卡不需要有
  實際寫入行為（可先無 `onClick` 或呼叫留白函式，TASK-035／TASK-036 接上）。
- 未登入或非管理員無法看到頁面內容，沿用既有邊界。

## 實作備註

- 沿用 `screen-spec-服務項目管理.md` 與 mockup 變體 A 的表格版型，欄位順序：名稱／價格／
  時長／狀態／操作。
- 描述欄位在列表中截斷顯示（比照 mockup 的 `text-overflow: ellipsis`），完整內容於
  TASK-035 的編輯表單中顯示。

## 驗證契約

- 單元測試：不適用（本卡為唯讀頁面骨架，無可獨立抽出的複雜純函式邏輯；若
  `listServices()` 含有資料轉換邏輯，視實作情況補上）。
- 整合測試：不適用於本卡（`services` RLS 邊界已由既有測試覆蓋，寫入相關的整合測試留給
  TASK-037 統一涵蓋）。
- E2E 測試：Browser 工具走查登入後台→點擊「服務設定」導覽→確認列表正確顯示上架/下架
  項目與空狀態（可用暫時清空/還原測試資料驗證，或以既有資料觀察即可，實作階段判斷）。
- 型別檢查：`npx tsc --noEmit`
- Lint：`npm run lint`
- Build：`npm run build`
- 螢幕截圖：服務項目管理頁預設列表（含上架/下架混合）、載入中、空狀態。
- 安全性檢查：確認 `/admin/services` 沿用既有 `app/admin/layout.tsx` 的 `is_admin()` 保護，
  未登入/非管理員無法看到頁面內容；`listServices()` 呼叫走既有 `admin full access to
  services` RLS policy，不繞過。

## 完成證據

詳見 `tools/kanban/cards/TASK-034.json` 的 `evidence` 欄位（commands／findings／residual）。
摘要：

- 變更的檔案：`lib/admin/services.ts`（新增）、`lib/admin/format.ts`（新增 `formatPrice`）、
  `app/admin/services/page.tsx`（新增）、`app/admin/_components/ServicesTable.tsx`（新增）、
  `app/admin/_components/AdminShell.tsx`（移除服務設定 `disabled: true`）。
- 執行過的指令：`npx tsc --noEmit`（乾淨）、`npm run lint`（0 problems）、`npm run build`
  （成功，`/admin/services` 為 dynamic route）、`npx vitest run`（17 files / 137 tests
  passed，無回歸）。
- 測試輸出：既有單元測試套件全數通過，本卡未新增新的可獨立測試純函式邏輯。
- 螢幕截圖：Browser 工具對真實 Supabase 專案手動走查，確認 Sidebar 連結、頁面標題、
  三筆既有服務列表（含價格/時長/狀態徽章）、新增/編輯/下架按鈕皆正確渲染，深色主題
  正確套用。
- 已知限制：空狀態與載入中 Skeleton 未在真實環境實際觸發截圖（現有資料庫已有服務資料，
  未執行破壞性清空操作），程式碼邏輯與 mockup 皆已涵蓋，非阻擋驗收的缺陷。
- 後續任務：TASK-035（新增/編輯服務項目）、TASK-036（下架/重新上架服務項目）。
