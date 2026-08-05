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
  `services`／`customers`／`appointments`／`admins`（TASK-003）、`business_hours`
  （TASK-010）。顧客端（anon）對 `appointments`／`customers` 沒有任何直接讀寫 policy，
  唯一存取路徑是兩個 `SECURITY DEFINER` RPC：`get_available_slots`（查可預約時段）、
  `create_appointment`（建立預約，含時段衝突防護與顧客去重，見
  `ai/context/decisions.md` 2026-08-05 決策）
- 身分驗證：Supabase Auth（email/password），僅一個設計師帳號；管理者身分用 `admins`
  表 + `is_admin()` function 判斷，不用 `authenticated` 角色（原因見
  `ai/context/decisions.md` TASK-003 決策）
- 測試：Vitest。`npm test` 為預設單元/煙霧測試（不連線真實服務）；
  `npm run test:rls`／`npm run test:booking` 是另外對真實 Supabase 專案跑的整合測試，
  各自獨立（見 `vitest.integration.config.ts`／`vitest.booking.config.ts`，刻意不用
  萬用字元互相撿到對方的測試檔），需要 `.env.local` 的 Supabase 設定；`test:rls` 額外
  需要已 seed 的設計師帳密，`test:booking` 涵蓋顧客預約流程整條路徑（含併發衝突、
  顧客去重、RLS 邊界，見 `tests/booking.integration.test.ts`）
- 部署：Vercel

## 重要目錄

| 路徑 | 用途 | 備註 |
|---|---|---|
| `lib/supabase/` | Supabase client 封裝 | `client.ts`（瀏覽器）、`server.ts`（Server Component/Action）、`middleware.ts`（proxy 用） |
| `lib/booking/` | 顧客預約流程的 RPC／資料存取封裝 | 型別＋薄呼叫函式（`types.ts`／`api.ts`），純函式邏輯拆到 `date-range.ts`／`slot-grid.ts`／`validation.ts`／`error-messages.ts` 方便單元測試 |
| `app/_components/booking/` | 顧客前台單頁捲動流程的區塊元件 | `BookingFlow.tsx`（頁面層 state）＋四個區塊元件（服務列表／選時段／填寫資訊／成功頁），掛載於 `app/page.tsx` |
| `supabase/migrations/` | 版本化 schema migration（up/down 成對） | 目前無 Supabase CLI／DB 連線字串，需人工貼到 Supabase SQL Editor 執行；檔案本身寫成可重複執行 |
| `scripts/` | 一次性維運腳本 | `seed-designer-account.mjs`（建立唯一設計師帳號）、`seed-booking-data.mjs`（`business_hours`／`services` 最小可行種子資料，冪等） |
| `proxy.ts`（根目錄） | 路由層驗證第一道門 | Next.js 16 用 `proxy.ts` 取代舊的 `middleware.ts` 慣例；只判斷「有沒有登入」，真正授權交給頁面內 `is_admin()` 與 RLS |
| `app/admin/` | 受保護的設計師後台 | 頁面本身也呼叫 `is_admin()` 二次確認，不只靠 `proxy.ts` |
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
| `npm run seed:designer` | 建立唯一設計師帳號 | 讀 `.env.local` 的 `DESIGNER_EMAIL`／`DESIGNER_PASSWORD`，具幂等性 |
| `npm run seed:booking` | seed `business_hours`／`services` 最小可行資料 | 冪等，對真實 Supabase 專案寫入 |
| `npm run kanban` | 啟動治理看板 | <http://127.0.0.1:4420> |
