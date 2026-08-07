# AI-Ready 任務卡

## Metadata

- 任務：商店基本資料設定 架構基礎（`store_settings` 資料表、RLS、Supabase Storage bucket、後台頁面骨架與 Sidebar 連結、唯讀顯示現況）
- 上層規格：`ai/artifacts/商店基本資料設定/feature-spec.md`
- 上層 Epic：商店基本資料設定
- 上層 User Story：設定店名、地址、電話、簡介（架構基礎，同時是「上傳／更換 Logo 或封面圖」故事共用的資料層與頁面骨架）
- 分軌：不適用（資料庫遷移＋Storage bucket 設定＋前端頁面骨架，橫跨後端與前端）
- 前置任務（dependsOn）：TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006, TASK-007, TASK-008, TASK-009
- 狀態：完成（architect／security-reviewer 首輪 request changes 皆已修正並補上整合測試重新
  驗證，人工已於 2026-08-07 驗收通過）
- 風險等級：高（本專案首次引入 Supabase Storage 檔案上傳與 public bucket 寫入邊界；新增資料表與對應 RLS policy，若邊界設錯會直接造成非管理員可竄改店家公開資訊或上傳任意檔案）
- Agent owner：Claude Code
- 人工核准者：待補（開始實作已獲人工核准，最終驗收待補）

## 目標

建立 `store_settings` 單例資料表與對應 RLS policy、建立 Supabase Storage public bucket
（`store-assets`）與對應存取政策，並在 `/admin/store-settings` 建立受保護頁面骨架（Sidebar
新增「商店設定」連結），唯讀顯示目前的 `store_settings` 內容。不含任何編輯／儲存／上傳邏輯
（留給 TASK-030／TASK-031）。

## 情境包（Context Pack）

- 相關檔案：
  - `supabase/migrations/0004_slots_closures_buffer.sql`（最新既有 migration，比照其寫法與
    down migration 慣例）
  - `app/admin/business-hours/page.tsx`、`app/admin/_components/BusinessHoursForm.tsx`
    （既有「頁面骨架＋Sidebar 連結啟用＋唯讀顯示」的完成範例，見 TASK-018 完成證據）
  - `app/admin/_components/AdminShell.tsx`（Sidebar 導覽項目定義處，新增「商店設定」項目）
  - `app/admin/layout.tsx`（既有 `is_admin()` 驗證關卡，本頁沿用不新增邏輯）
  - `lib/admin/business-hours.ts`（既有「單一設定表」資料存取封裝的參考範例，含
    `Result<T>` 錯誤處理模式）
  - `lib/supabase/client.ts`／`lib/supabase/server.ts`（既有 Supabase client 封裝）
- 既有模式：
  - 單一設計師網域下的「小型設定表」模式（`business_hours` 固定 7 列）；本表是固定 1 列的
    單例，比照相同精神但透過 migration seed 保證恆有 1 列（見下方「實作備註」的簡化決策）。
  - RLS 邊界比照 `business_hours`／`closed_dates`：anon／authenticated 皆可讀，只有
    `is_admin()` 可寫。
  - `Result<T>` 錯誤處理模式（`lib/admin/appointments.ts` 的 `AdminError`／`Result`
    型別），資料存取函式回傳 `{ ok: true, data }` 或 `{ ok: false, error }`，不外洩原始
    Postgres 錯誤內容。
- 假設：
  - `store_settings` 採單例 pattern：`id int primary key default 1`＋
    `check (id = 1)` constraint，migration 內直接 `insert ... on conflict (id) do nothing`
    seed 一列（`name` 預設空字串），保證應用層永遠查得到剛好 1 列，不需要處理「零列」的
    特殊情境（比 feature-spec 原先設想的「可能零列」實作更簡單，觀察到的行為一致：
    `name` 為空字串時前台／後台皆視為「尚未設定」，非目標／驗收標準不受影響）。
  - Storage bucket 命名 `store-assets`，`public: true`（讀取直接用 public URL，不需要簽章）。
  - Storage 路徑慣例：`logo/<uuid>.<ext>`、`cover/<uuid>.<ext>`（不使用使用者原始檔名，避免
    路徑穿越與檔名衝突；更換圖片時使用新的 uuid 檔名，天然達成瀏覽器快取破除效果，不需要額外
    的雜湊或時間戳記參數）。
  - Migration 編號使用 `0006`（`0005` 已由 TASK-028 的 refs 預先保留給
    `create_appointment` 的 `closed_dates` 檢查，即使 TASK-028 尚未實作，本卡不搶用該編號，
    避免未來兩者都要落地時衝突）。
- 未知事項：
  - Supabase Storage 的 RLS policy 語法（`storage.objects` 表的 policy）本專案尚無先例，
    需在實作階段查閱 Supabase 官方文件確認 `bucket_id` 條件寫法，架構規劃階段先假設可行。
- 允許變更的檔案：
  - `supabase/migrations/0006_store_settings.sql`（新增）
  - `supabase/migrations/0006_store_settings_down.sql`（新增）
  - `lib/store-settings.ts`（新增，僅讀取函式，寫入／上傳函式留給 TASK-030／031；放在
    `lib/` 頂層而非 `lib/admin/`，因為顧客前台 TASK-032 也要讀取，比照既有 `lib/booking/`
    ↔ `lib/admin/` 的分層方向，避免顧客前台反向依賴後台模組，architect TASK-029 審查要求）
  - `app/admin/store-settings/page.tsx`（新增）
  - `app/admin/_components/StoreSettingsForm.tsx`（新增，本卡僅唯讀顯示骨架）
  - `app/admin/_components/AdminShell.tsx`（新增 Sidebar 項目）
  - `ai/context/project-map.md`（更新重要目錄／資料表清單）
- 不得觸碰：
  - 既有 `business_hours`／`closed_dates`／`services`／`appointments` 相關的 migration、RPC、
    RLS policy。
  - `app/page.tsx`／`BookingFlow.tsx`（顧客前台品牌顯示留給 TASK-032）。

## 需求

- 新增 `store_settings` 資料表：`id`（固定為 1 的單例 primary key）、
  `name text not null default ''`、`address text`、`phone text`、`description text`、
  `logo_url text`、`cover_image_url text`、`updated_at timestamptz not null default now()`。
- 啟用 RLS，新增 policy：anon／authenticated 可 `select`；只有 `is_admin()` 可
  `insert`／`update`／`delete`（沿用既有 `is_admin()` function，不重新定義）。
- Migration 內 seed 恰好 1 列（`id = 1`），確保應用層讀取恆有資料。
- 新增 Supabase Storage public bucket `store-assets`；新增 `storage.objects` RLS policy：
  該 bucket 下 anon／authenticated 可 `select`（公開讀取圖片），只有 `is_admin()` 可
  `insert`／`update`／`delete`。
- `/admin/store-settings` 頁面骨架：沿用 `app/admin/layout.tsx` 既有保護；Sidebar 新增
  「商店設定」連結（`AdminShell.tsx` 的 `NAV_ITEMS`）。
- 頁面唯讀顯示目前 `store_settings` 的四個文字欄位內容（不可編輯，無上傳區塊互動），供
  TASK-030／TASK-031 銜接。

## 驗收標準

- `store_settings` 表建立成功，恰有 1 列，`name` 預設空字串。
- 未登入或非管理員無法寫入 `store_settings`（RLS 拒絕），anon／authenticated 可讀。
- Storage bucket `store-assets` 建立成功且為 public；未登入或非管理員無法上傳至該 bucket，
  已上傳的物件可被公開讀取（不需驗證的 GET）。
- 登入管理員可看到 Sidebar「商店設定」連結並進入 `/admin/store-settings`，頁面正確顯示目前
  `store_settings` 的四個文字欄位（seed 後皆為空值時顯示空白，不報錯）。
- 未登入或非 `is_admin()` 直接訪問 `/admin/store-settings` 依既有 `layout.tsx` 邏輯導回
  `/login`。

## 實作備註

- `store_settings` 採 migration seed 保證恆有 1 列的單例設計（見情境包「假設」），比
  feature-spec 原先描述的「可能零列，前端需處理零列情境」更簡單；下游 TASK-030／
  TASK-032 的「未設定」判斷一律以「該欄位值為空字串／null」為準，不需要另外判斷「查無列」。
- Storage bucket policy 若 Supabase SQL 語法與既有 `is_admin()` function 呼叫方式不同
  （例如需要透過 `storage.foldername()` 或特定 schema 前綴），依 Supabase 官方文件调整，
  不影響本卡驗收標準的行為契約。
- 本卡不做任何上傳／編輯 UI，`StoreSettingsForm.tsx` 只是唯讀顯示骨架，避免與 TASK-030／031
  的表單欄位/上傳元件互踩。

## 驗證契約

- 單元測試：無（本卡無純函式邏輯，資料存取函式為薄封裝）。
- 整合測試：對真實 Supabase 專案驗證 `store_settings` 與 Storage bucket 的 RLS 邊界
  （anon／非管理員 authenticated 讀寫皆依預期被拒或允許），可先寫在 TASK-033 一併涵蓋，或本卡
  先补最小驗證再由 TASK-033 擴充（實作階段決定）。
- E2E 測試：不適用（無互動可測，留給 TASK-030／031／032 涵蓋）。
- 型別檢查：`npx tsc --noEmit`
- Lint：`npm run lint`
- Build：`npm run build`
- 螢幕截圖：後台「商店設定」頁面唯讀顯示狀態。
- 安全性檢查：確認 RLS policy 邊界（anon／非管理員 authenticated 皆無法寫入資料表或上傳
  Storage）；確認 Storage bucket 沒有意外開放 `update`／`delete` 給非管理員。

## 完成證據

- 變更的檔案：`supabase/migrations/0006_store_settings.sql`／`0006_store_settings_down.sql`（新增）、
  `lib/store-settings.ts`（新增，架構審查要求放在 `lib/` 頂層而非 `lib/admin/`）、
  `app/admin/store-settings/page.tsx`（新增）、`app/admin/_components/StoreSettingsForm.tsx`
  （新增）、`app/admin/_components/AdminShell.tsx`（新增 Sidebar 連結）、
  `tests/store-settings.integration.test.ts`／`vitest.store-settings.config.ts`（新增，
  architect 要求高風險卡片現在就要有 RLS 邊界驗證證據）、`package.json`（新增
  `test:store-settings` script）、`ai/context/project-map.md`（更新）
- 執行過的指令：`npx tsc --noEmit`、`npm run lint`、`npm run build`、`npx vitest run`
  （102 tests）、`npm run test:store-settings`（新增，11 tests，對真實 Supabase 專案）、
  `npm run test:rls`／`test:booking`／`test:admin-booking`／`test:business-hours`（皆重跑
  確認無回歸）
- 測試輸出：詳見 `tools/kanban/cards/TASK-029.json` 的 `evidence.commands`／
  `evidence.findings`
- 螢幕截圖：Browser 工具走查 `/admin/store-settings`，migration 套用前後的錯誤降級態／
  空白表單態皆已確認（部分透過 accessibility tree／`get_page_text` 驗證，環境截圖工具
  短暫故障，詳見 residual）
- 已知限制：見 `tools/kanban/cards/TASK-029.json` 的 `evidence.residual`（店名無法在資料庫
  層強制非空白、移除圖片不刪除 Storage 物件的既有已知風險、migration 套用權限的環境差異、
  截圖工具暫時性故障）
- 後續任務：TASK-030（基本資訊編輯／儲存）、TASK-031（品牌圖片上傳）、TASK-032（前台品牌
  顯示）——三張卡的檔案清單皆已同步更新為 `lib/store-settings.ts`
