# 專案地圖

狀態：依 TASK-001～TASK-003 完成的部分填寫，隨後續 Epic 持續更新。

## 產品

- 名稱：理髮廳線上預約系統
- 使用者：顧客（前台，行動裝置為主，未登入自助預約）／設計師（後台，桌面為主，唯一帳號登入管理）
- 核心工作流程：顧客瀏覽服務項目並預約 → 設計師在後台管理服務項目、預約與顧客資料

## 技術棧

- 前端：Next.js 16（App Router + TypeScript）
- 後端：Next.js Server Components／Server Actions + Supabase（BaaS）
- 資料庫：Supabase Postgres，啟用 RLS；schema 定義於 `supabase/migrations/`。核心表：
  `services`（含 `buffer_minutes` 欄位，TASK-022，0～120 分鐘，預設 0）／`customers`／
  `appointments`／`admins`（TASK-003）、`business_hours`（TASK-010）、`closed_dates`
  （TASK-022，特定日期整天公休標記，`date` 為 primary key，RLS 邊界比照 `business_hours`：
  anon／authenticated 皆可讀，只有 `is_admin()` 可寫）、`store_settings`（TASK-029，店家基本
  資訊與品牌圖片 URL，單例表，`id` 恆為 1，migration 內 seed 保證恆有 1 列，不需要處理零列
  情境；RLS 邊界比照 `business_hours`；後台 `/admin/store-settings`（TASK-030／031）可編輯／
  上傳，顧客前台首頁品牌顯示區塊（TASK-032）anon 讀取後同步顯示，未設定或讀取失敗時回退純
  文字標題）。Supabase Storage 另有 `store-assets` public bucket（TASK-029，存放 Logo／
  封面圖，公開讀取、只有 `is_admin()` 可寫入/更新/刪除，本專案首次引入檔案上傳；顧客前台
  只信任這個 bucket 底下的網址才會渲染成 `<img>`，見 `lib/store-settings.ts`
  `resolveStoreDisplay` 的網址白名單，TASK-032 security-reviewer 審查發現）。顧客端（anon）對
  `appointments`／`customers` 沒有任何直接讀寫 policy，唯一存取路徑是兩個
  `SECURITY DEFINER` RPC：`get_available_slots`（查可預約時段，TASK-024 起同時感知
  `closed_dates` 與 `services.buffer_minutes`）、`create_appointment`（建立預約，含時段
  衝突防護與顧客去重，見 `ai/context/decisions.md` 2026-08-05 決策）
- 身分驗證：Supabase Auth（email/password），僅一個設計師帳號；管理者身分用 `admins`
  表 + `is_admin()` function 判斷，不用 `authenticated` 角色（原因見
  `ai/context/decisions.md` TASK-003 決策）
- 測試：Vitest。`npm test` 為預設單元/煙霧測試（不連線真實服務）；
  `npm run test:rls`／`npm run test:booking`／`npm run test:admin-booking`／
  `npm run test:business-hours`／`npm run test:store-settings` 是另外對真實 Supabase 專案跑
  的整合測試，各自獨立（見 `vitest.integration.config.ts`／`vitest.booking.config.ts`／
  `vitest.admin-booking.config.ts`／`vitest.business-hours.config.ts`／
  `vitest.store-settings.config.ts`，刻意不用萬用字元互相撿到對方的測試檔），需要
  `.env.local` 的 Supabase 設定；`test:rls`／`test:admin-booking`／`test:business-hours`／
  `test:store-settings` 額外需要已 seed 的設計師帳密，`test:booking`
  涵蓋顧客預約流程整條路徑（含併發衝突、顧客去重、RLS 邊界，見
  `tests/booking.integration.test.ts`），`test:admin-booking` 涵蓋預約管理後台整條路徑
  （讀取權限邊界、標記完成/取消、改期 exclusion constraint、anon 直接寫入被拒，見
  `tests/admin-booking.integration.test.ts`），`test:business-hours` 涵蓋營業時間設定整條
  路徑（designer 讀寫 business_hours、anon 只能讀、受影響預約判定、`get_available_slots`
  RPC 對新設定的回應，見 `tests/business-hours.integration.test.ts`；`business_hours` 只有
  7 列固定資料，測試採「記錄原始快照、測試後還原」模式，不要對正式環境高頻率重複執行）
- 部署：Vercel

## 重要目錄

| 路徑 | 用途 | 備註 |
|---|---|---|
| `lib/supabase/` | Supabase client 封裝 | `client.ts`（瀏覽器）、`server.ts`（Server Component/Action）、`middleware.ts`（proxy 用） |
| `lib/booking/` | 顧客預約流程的 RPC／資料存取封裝 | 型別＋薄呼叫函式（`types.ts`／`api.ts`），純函式邏輯拆到 `date-range.ts`／`slot-grid.ts`／`validation.ts`／`error-messages.ts` 方便單元測試 |
| `app/_components/booking/` | 顧客前台單頁捲動流程的區塊元件 | `BookingFlow.tsx`（頁面層 state）＋品牌顯示區塊 `BrandHeaderSection.tsx`（TASK-032，讀取 `store_settings`，獨立 fetch／loading，與下方預約流程互不阻塞）＋四個區塊元件（服務列表／選時段／填寫資訊／成功頁），掛載於 `app/page.tsx` |
| `supabase/migrations/` | 版本化 schema migration（up/down 成對） | 目前無 Supabase CLI／DB 連線字串，需人工貼到 Supabase SQL Editor 執行；檔案本身寫成可重複執行 |
| `scripts/` | 一次性維運腳本 | `seed-designer-account.mjs`（建立唯一設計師帳號）、`seed-booking-data.mjs`（`business_hours`／`services` 最小可行種子資料，冪等） |
| `proxy.ts`（根目錄） | 路由層驗證第一道門 | Next.js 16 用 `proxy.ts` 取代舊的 `middleware.ts` 慣例；只判斷「有沒有登入」，真正授權交給頁面內 `is_admin()` 與 RLS |
| `app/admin/` | 受保護的設計師後台 | 頁面本身也呼叫 `is_admin()` 二次確認，不只靠 `proxy.ts`；`_components/`（`AdminDashboard.tsx`／`WeekCalendar.tsx`／`AppointmentListView.tsx`／`AppointmentDetailDialog.tsx`／`BusinessHoursForm.tsx`／`ClosedDatesSection.tsx`／`StoreSettingsForm.tsx`）為週曆/列表顯示、標記完成/取消/改期、營業時間設定表單、特殊公休日設定、商店基本資料設定（`StoreSettingsForm.tsx`：TASK-030 接上「基本資訊」編輯／驗證／儲存，TASK-031 接上「品牌圖片」`ImageUploadField` 上傳／更換／移除）的互動元件；`business-hours/`（`page.tsx`）為 `/admin/business-hours` 頁面骨架，掛載 `BusinessHoursForm.tsx`（內含 `ClosedDatesSection.tsx`）；`store-settings/`（`page.tsx`）為 `/admin/store-settings` 頁面骨架，掛載 `StoreSettingsForm.tsx` |
| `lib/admin/` | 後台預約管理與營業時間設定的資料存取與純函式邏輯 | `appointments.ts`（週次查詢／單筆詳情／標記完成/取消/改期，含樂觀鎖與 23P01→SLOT_CONFLICT 轉換）、`reschedule-slots.ts`（改期表單可預約時段計算）、`week-range.ts`（週次範圍純函式，不再含公休判斷）、`business-hours.ts`（七天設定讀寫、受影響預約判定 `findAffectedAppointments`）、`closed-dates.ts`（特殊公休日讀寫、單日受影響預約判定 `findAffectedAppointmentsForClosedDate`）、`month-range.ts`（`MonthPicker` 用的月曆日期純函式）、`format.ts` |
| `lib/store-settings.ts` | 商店基本資料（`store_settings`）的資料存取 | 放在 `lib/` 頂層而非 `lib/admin/`——顧客前台（`getStoreSettings`／`resolveStoreDisplay`，TASK-032）與後台（`updateStoreSettingsBasicInfo`／`uploadStoreImage`／`removeStoreImage`，TASK-030／031）皆會讀取，比照既有「`app/admin/*` 可 import `lib/booking/*`，但顧客前台不會 import `lib/admin/*`」的既有分層方向，避免顧客前台反向依賴後台模組；`resolveStoreDisplay` 額外把 `logo_url`／`cover_image_url` 限制為只信任 `store-assets` bucket 底下的網址才顯示，避免 RLS 只限制寫入者身分、未限制網址內容本身而讓匿名頁面被導向任意外部圖片網址（TASK-032 security-reviewer 審查發現） |
| `components/ui/ImageUploadField.tsx` | 商店品牌圖片上傳元件 | TASK-031 新做，涵蓋預設（拖放區）／上傳中／預覽（縮圖＋更換／移除）／錯誤四態，已登記回 `design-system.md` S4 inventory；`StoreSettingsForm.tsx` 的「品牌圖片」卡片掛載兩個實例（Logo／封面圖） |
| `app/login/` | 設計師登入頁 | |
| `app/page.tsx` | 顧客前台預約首頁 | 單頁捲動版型（S5 變體 B），見 `app/_components/booking/` |
| `ai/` | 治理流程、任務卡、審查紀錄 | 見根目錄 `AGENTS.md` |
| `tools/kanban/` | 治理看板 | `npm run kanban` |

## 常用指令

| 指令 | 用途 | 備註 |
|---|---|---|
| `npm run dev` | 啟動本機開發伺服器 | <http://localhost:3000> |
| `npm run build` / `npm start` | 建置／啟動正式環境版本 | |
| `npm run lint` | ESLint | |
| `npx tsc --noEmit` | TypeScript 型別檢查 | |
| `npm test` | 單元/煙霧測試（Vitest） | 不連線真實 Supabase |
| `npm run test:rls` | RLS 整合測試 | 對真實 Supabase 專案跑，需要 `.env.local` 齊備 |
| `npm run test:booking` | 顧客預約流程整合測試 | 對真實 Supabase 專案跑，涵蓋 `get_available_slots`／`create_appointment` 兩個 RPC 的正確性、併發衝突防護（多輪）、顧客去重、RLS 邊界；測試資料執行後自動清除。**注意**：`appointments_no_overlap` 是不分服務的全域 exclusion constraint，測試期間會暫時佔用真實時段（已選接近 90 天視野上限的日期降低風險，見 `tests/booking.integration.test.ts` 註解）——不要對正式環境高頻率重複執行 |
| `npm run test:admin-booking` | 預約管理後台整合測試 | 對真實 Supabase 專案跑，涵蓋 designer 讀取權限邊界（含 anon 被拒）、`markAppointmentCompleted`／`cancelAppointment`／`rescheduleAppointment` 對真實資料的行為（含 `appointments_no_overlap` exclusion constraint 透過 authenticated 直接 update 路徑的邊界）、anon 直接寫入 appointments 皆被拒；測試資料執行後自動清除。同樣需注意全域 exclusion constraint，測試日期已選離今天 40 天以上降低與正式資料衝突風險 |
| `npm run test:business-hours` | 營業時間與可預約時段管理整合測試 | 對真實 Supabase 專案跑，涵蓋 designer 讀寫 `business_hours`／`closed_dates`（含 anon／已登入非管理員的 authenticated 使用者皆被拒，重新確認寫入邊界）、`findAffectedAppointments`／`findAffectedAppointmentsForClosedDate` 對真實預約資料的受影響判定、`get_available_slots` RPC 於公休（`business_hours`／`closed_dates` 兩種來源）/緩衝時間（`services.buffer_minutes`）設定變更/還原後的正確回應、後台改期表單 `computeAvailableSlots` 與該 RPC 對同一組輸入產生一致判斷（TASK-027）。`business_hours` 只有 7 列固定資料（`weekday` 為 primary key），測試採「記錄原始快照（並印到終端機/CI log 供程序被強制中斷時人工還原）、測試中短暫改動、afterAll 還原」模式；`closed_dates` 沒有固定列數也沒有可掛 `TEST_MARKER` 的文字欄位，改用「記錄本次測試新增過的日期、afterAll 逐一刪除，不動測試前已存在的列」模式。**不要對正式環境高頻率重複執行**（測試期間會暫時影響顧客端可預約時段判定） |
| `npm run test:store-settings` | 商店基本資料設定整合測試 | 對真實 Supabase 專案跑，涵蓋 `store_settings` 讀寫權限邊界（anon／已登入非管理員的 authenticated 使用者皆被拒、designer 可寫、非管理員無法 insert 第二列）、`store-assets` Storage bucket 權限邊界（anon／非管理員上傳被拒、designer 可上傳且公開可讀、`allowed_mime_types` 與路徑前綴限制皆由 bucket 層強制擋下，非只靠前端驗證）。`store_settings` 只有 1 列固定資料，測試採「記錄原始快照、測試中短暫改動、afterAll 還原」模式（同 `test:business-hours`）；前台讀取降級行為（`resolveStoreDisplay` 的「哪些欄位視為未設定」判斷）改由 `tests/store-settings.test.ts` 的單元測試涵蓋，不重複放進本整合測試。**不要對正式環境高頻率重複執行** |

各整合測試檔案的測試日期都用「離今天 N 天以上」的 offset 找不同星期幾，刻意錯開彼此的日期範圍避免互相干擾（`test:business-hours` 第一批次用 55 天起、第二批次（`closed_dates`／`buffer_minutes`，TASK-027）用 58／65 天起、`test:admin-booking` 用 40 天起、`test:booking` 用接近 90 天視野上限）；同一個 offset 下也要用不同星期幾（同一天內的不同時段錯開亦可，見 `tests/business-hours.integration.test.ts` 對 `SLOTS_DATE` 的既有教訓：兩個不同 describe 共用同一天時，appointments_no_overlap 是不分服務的全域 exclusion constraint，插入的既有預約時段必須手動錯開，不能想當然爾各自用 11:00 起始）。新增下一個以真實 Supabase 資料為基礎的整合測試檔案或案例時，選 offset／時段前先看一下這幾個既有檔案目前用的範圍，避免撞期。`test:store-settings` 不涉及日期時段（`store_settings`／`store-assets` 皆與日期無關），不需要 offset。
| `npm run seed:designer` | 建立唯一設計師帳號 | 讀 `.env.local` 的 `DESIGNER_EMAIL`／`DESIGNER_PASSWORD`，具幂等性 |
| `npm run seed:booking` | seed `business_hours`／`services` 最小可行資料 | 冪等，對真實 Supabase 專案寫入 |
| `npm run kanban` | 啟動治理看板 | <http://127.0.0.1:4420> |
