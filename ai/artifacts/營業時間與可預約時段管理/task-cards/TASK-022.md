# AI-Ready 任務卡

## Metadata

- 任務：營業時間與可預約時段管理 架構基礎（`closed_dates` 資料表、`services.buffer_minutes` 欄位）
- 上層規格：[`feature-spec.md`](../feature-spec.md)（第二批次）
- 上層 Epic：營業時間與可預約時段管理
- 上層 User Story：設定公休日／特殊假期、設定服務間的緩衝時間（資料層基礎，兩個 story 共用）
- 分軌：後端
- 前置任務（dependsOn）：TASK-021
- 狀態：完成（2026-08-07 人工核准）
- 風險等級：中（新增資料庫 migration 與 RLS policy，屬於 definition-of-ready 列出的高風險
  類別「資料庫遷移」，需要架構與安全性審查；緊密比照 `business_hours` 已核准的既有 RLS 模式，
  不是全新設計，降低實際風險）
- Agent owner：待指定
- 人工核准者：待指定

## 目標

新增這一批次兩個 story 共用的資料層基礎：`closed_dates` 資料表（特定單一日期的整天公休
標記）與 `services.buffer_minutes` 欄位（服務結束後的緩衝分鐘數），並提供對應的
`lib/admin/closed-dates.ts` 讀寫函式，供後續任務卡（TASK-023～TASK-026）串接使用。本卡不
修改 `get_available_slots` RPC、不修改任何既有元件、不做任何 UI。

## 情境包（Context Pack）

- 相關檔案：
  - `supabase/migrations/0002_booking_flow.sql`（`business_hours` 表與其 RLS policy 是本卡
    `closed_dates` 的直接範本；`services` 表定義在 `supabase/migrations/0001_core_schema.sql`）
  - `lib/admin/business-hours.ts`（`getAllBusinessHours`／`updateBusinessHours`／
    `findAffectedAppointments`／`AffectedAppointment` 型別是本卡新函式的既有模式範本；
    `AffectedAppointment` 型別直接從這個檔案 import 重用，不要重新定義一份）
  - `is_admin()` function 定義在 `supabase/migrations/0001_core_schema.sql`（`admins` 表 +
    `SECURITY DEFINER` function），本卡直接沿用，不新增任何身分判斷邏輯
- 既有模式：
  - RLS policy 命名與結構比照 `business_hours`：`"public read <table>"`（`for select` to
    `anon, authenticated` using `true`）+ `"admin full access to <table>"`（`for all` to
    `authenticated` using/with check `public.is_admin()`）。
  - migration 檔案風格比照 `0002_booking_flow.sql`：`begin`/`commit` 包住、`create table if
    not exists`／`drop policy if exists` + `create policy`／`add column if not exists`
    確保可重複執行；檔頭註解說明本卡任務、對應回滾腳本、相關決策連結（若有）。
  - `findAffectedAppointments`（`lib/admin/business-hours.ts` 第 110-139 行）是本卡
    `findAffectedAppointmentsForClosedDate` 的邏輯範本：查詢 `pending`/`confirmed`/
    `completed` 且 `start_at` 在未來的預約、90 天視野上限＋200 筆數上限、回傳最小化欄位
    （`id`／`customer_name`／`start_at`，不含電話）。差異：本卡的版本只需要比對「單一日期」
    （不需要依 weekday 比對新舊營業時間），邏輯更單純——查詢當天（Asia/Taipei 時區）範圍內
    的預約，全部視為受影響（因為該日期即將變成整天公休，沒有「落在時段內/外」的細分）。
- 假設：
  - `closed_dates` 只有 `date` 一個必要欄位（primary key），不含理由/備註欄位（見
    feature-spec.md 非目標）。
  - `services.buffer_minutes` 預設 0，check constraint `0～120`。既有服務資料補上這個欄位
    後自動是 0（無緩衝），不需要資料回填、不影響既有預約或既有測試。
  - `closed_dates.date` 只能是今天或未來——這個防呆本卡不做資料庫層級 check constraint（因為
    「今天」會隨時間變動，check constraint 無法動態比較 `current_date`），改由呼叫端
    （TASK-025 的前端／`addClosedDate` 函式本身）在寫入前檢查，本卡的 `addClosedDate`
    直接依賴呼叫端已驗證，不在函式內重複擋（避免非同步時區判斷邏輯分散兩處）。
- 未知事項：無。
- 允許變更的檔案：
  - `supabase/migrations/0003_closures_and_buffer.sql`（新增）
  - `supabase/migrations/0003_closures_and_buffer_down.sql`（新增）
  - `lib/admin/closed-dates.ts`（新增）
  - `tests/admin/closed-dates.test.ts`（新增，若有可獨立測試的純函式邏輯）
- 不得觸碰：`lib/admin/business-hours.ts`（只 import 其 `AffectedAppointment` 型別，不修改
  該檔案本身）、`get_available_slots` RPC（留給 TASK-024）、`lib/admin/reschedule-slots.ts`
  （留給 TASK-024）、任何 `app/` 底下的元件（本卡不做 UI）。

## 需求

- 新增 `supabase/migrations/0003_closures_and_buffer.sql`：
  - `create table if not exists public.closed_dates (date date primary key);`
  - `alter table public.closed_dates enable row level security;`
  - policy `"public read closed dates"`（`for select` to `anon, authenticated` using `true`）
  - policy `"admin full access to closed dates"`（`for all` to `authenticated` using/with
    check `public.is_admin()`）
  - `alter table public.services add column if not exists buffer_minutes int not null default 0;`
  - `alter table public.services drop constraint if exists services_buffer_minutes_range;`
    後 `add constraint services_buffer_minutes_range check (buffer_minutes >= 0 and
    buffer_minutes <= 120);`（`drop...if exists` 後 `add` 而非 `add constraint if not
    exists`，因為 Postgres 的 `add constraint` 不支援 `if not exists`，這個模式確保
    migration 可重複執行）
  - 對應 `0003_closures_and_buffer_down.sql`：`drop table if exists public.closed_dates
    cascade;`、`alter table public.services drop constraint if exists
    services_buffer_minutes_range;`、`alter table public.services drop column if exists
    buffer_minutes;`
- 新增 `lib/admin/closed-dates.ts`，比照 `lib/admin/business-hours.ts` 的寫法風格
  （`Result<T>`／`AdminError` 從 `./appointments` import，`INTERNAL_ERROR` 通用錯誤訊息不
  外洩原始 Postgres 錯誤）：
  - `export type ClosedDate = { date: string };`
  - `getAllClosedDates(supabase): Promise<Result<ClosedDate[]>>`——查全部列，依 `date`
    升冪排序。
  - `addClosedDate(supabase, date: string): Promise<Result<void>>`——`upsert({date},
    {onConflict: "date", ignoreDuplicates: false})`，確保重複新增同一天是安全的 no-op
    而非報錯（呼叫端的月曆點選「已標記的日期」在 UI 層會走移除而非新增路徑，這裡是
    最後一層防呆，不是主要防重複機制）。實作審查（architect／security-reviewer）發現
    原始草稿寫 `ignoreDuplicates: true`（`ON CONFLICT DO NOTHING`）會在衝突時完全不回傳
    列，跟下面「至少 1 筆」的寫入驗證互相矛盾，重複新增反而必定報錯；改用
    `ignoreDuplicates: false`（`ON CONFLICT DO UPDATE`，單欄位主鍵表上是無害的覆寫
    no-op）才能同時滿足冪等與驗證兩個需求，且仍受 RLS 的 `UPDATE using` 檢查保護。
    寫入結果驗證比照 `updateBusinessHours` 的既有教訓：只看 `error` 是否為 `null` 不夠，
    RLS 阻擋寫入時可能回傳成功但空結果，upsert 呼叫要加 `.select("date")` 並確認至少有
    1 筆回傳，沒有則視為失敗（`ok: false`）。
  - `removeClosedDate(supabase, date: string): Promise<Result<void>>`——`delete().eq("date",
    date)`，刪除 0 筆或 1 筆都視為成功（冪等，移除一個不存在的日期不是錯誤）。同樣比照
    `updateBusinessHours` 的教訓，RLS 阻擋 DELETE 一樣是回傳成功但空結果，只看 `error`
    不夠：加 `.select("date")`，0 筆回傳時用 `isDateClosed` 複查，該日期確實已不存在才視為
    成功，仍存在則代表被 RLS 擋下，視為失敗。
  - `isDateClosed(supabase, date: string): Promise<Result<boolean>>`——查詢單一日期是否存在
    於 `closed_dates`，回傳布林值；供 TASK-024 的改期表單使用。
  - `getClosedDatesInRange(supabase, startDate: string, endDate: string): Promise<Result<Set<string>>>`
    ——查詢 `date >= startDate and date <= endDate`（皆為 `YYYY-MM-DD` 字串，直接字典序比較，
    比照 `lib/admin/reschedule-slots.ts` 對 `date` 欄位查詢的既有寫法），回傳 `Set<string>`；
    供 TASK-026 的後台週曆使用（週次範圍查詢）。
  - `findAffectedAppointmentsForClosedDate(supabase, date: string): Promise<Result<AffectedAppointment[]>>`
    ——`AffectedAppointment` 型別從 `./business-hours` import 重用。查詢
    `status in (pending,confirmed,completed)`、`start_at` 落在該日期（Asia/Taipei 時區）
    範圍內、且 `start_at` 在未來（`> now()`）的預約，回傳最小化欄位（`id`／`customer_name`／
    `start_at`）。比照 `findAffectedAppointments` 的既有寫法，用
    `.gte("start_at", \`${date}T00:00:00+08:00\`)`／`.lt("start_at", \`${addDays(date,
    1)}T00:00:00+08:00\`)`（`addDays` 從 `./week-range` import）圈定當天範圍，不需要 90 天
    視野上限（單一日期本來就有界，不會像週次查詢那樣抓到大量資料）。

## 驗收標準

- `npx tsc --noEmit`／`npm run lint`／`npm run build`／`npm test` 皆通過。
- migration 檔案可重複執行（本機或測試環境重跑第二次不報錯）。
- `closed_dates` 的 RLS policy 與 `services.buffer_minutes` 的 check constraint 存在且生效
  （由 TASK-027 的整合測試驗證，本卡不需要新增整合測試，但函式本身要能被整合測試正確呼叫）。
- `getAllClosedDates`／`addClosedDate`／`removeClosedDate`／`isDateClosed`／
  `getClosedDatesInRange`／`findAffectedAppointmentsForClosedDate` 六個函式皆存在且型別正確，
  可被 TASK-024／025／026 直接 import 使用。

## 實作備註

- migration 檔頭註解要說明本卡任務編號、對應回滾腳本、以及「本卡不修改
  `get_available_slots` RPC，該 RPC 的公休日／緩衝時間感知邏輯留給 TASK-024 的另一個
  migration 檔案處理」，避免後續讀 migration 的人誤以為本卡漏做了 RPC 異動。
- `services_buffer_minutes_range` 的 120 分鐘上限是任務卡假設的合理防呆值（feature-spec.md
  已記錄），不是使用者明確要求的數字；若後續發現不夠用，是任務卡範圍外的產品決策，不在本卡
  重新討論。
- 本卡刻意不做「已有預約時段因為新增公休日而受影響」的即時通知或連動——`closed_dates` 本身
  的寫入（`addClosedDate`）與「受影響預約警告」的呼叫順序（先查 `findAffectedAppointmentsForClosedDate`
  再視情況呼叫 `addClosedDate`）由 TASK-025 的前端流程控制，本卡的 `addClosedDate` 只是
  單純寫入，不在函式內部耦合警告邏輯。

## 驗證契約

- 單元測試：若 `getClosedDatesInRange` 或其他函式內有可抽出的純邏輯（例如日期範圍比對），
  補上對應測試；資料存取函式本身（呼叫 Supabase）不強制要求純函式測試，整合測試
  （TASK-027）會涵蓋真實行為。
- 整合測試：不適用（本卡不新增整合測試，留給 TASK-027 統一擴充
  `tests/business-hours.integration.test.ts`）。
- E2E 測試：不適用（本卡無 UI）。
- 型別檢查：`tsc --noEmit` 成功。
- Lint：`npm run lint` 成功。
- Build：`npm run build` 成功。
- 螢幕截圖：不適用。
- 安全性檢查：`closed_dates` 的 RLS policy 需與 `business_hours` 同等嚴謹（anon 只能讀、
  只有 `is_admin()` 可寫）；`services.buffer_minutes` 沿用 `services` 表既有 RLS 邊界，
  不需要新 policy。`findAffectedAppointmentsForClosedDate` 回傳欄位比照既有
  `findAffectedAppointments` 的最小化原則，不含電話等非必要個資。

## 完成證據

- 狀態：完成（2026-08-07 人工核准）。
- 變更的檔案：
  - `supabase/migrations/0003_closures_and_buffer.sql`（新增）
  - `supabase/migrations/0003_closures_and_buffer_down.sql`（新增）
  - `lib/admin/closed-dates.ts`（新增）
- 執行過的指令：`npx tsc --noEmit`、`npm run lint`、`npm test`、`npm run build`，皆通過。
- 測試輸出：既有 11 個測試檔、75 個測試全數通過（本卡未新增測試檔——六個函式皆為直接
  包裝 Supabase 呼叫的資料存取，沒有可獨立抽出的純邏輯，符合驗證契約「若有可抽出的純
  邏輯才補測試」的條件；行為正確性留給 TASK-027 的整合測試涵蓋）。
- 螢幕截圖：不適用（無 UI 變更）。
- 子代理審查：architect 與 security-reviewer 皆審查過，兩者獨立發現同一個功能性缺陷
  （`addClosedDate` 的 `ignoreDuplicates: true` 與「至少 1 筆」驗證互相矛盾，重複新增會
  誤報失敗）與同一個安全語意缺口（`removeClosedDate` 對 RLS 阻擋的 DELETE 是 fail-open，
  只看 `error` 無法分辨「本來就不存在」與「被擋下」）；皆已修正，修正後重跑
  `tsc`／`lint`／`test`／`build` 全數通過。
- 已知限制：
  - migration 未經實際 Supabase 專案套用驗證（本機無 Supabase CLI／migration ledger，
    套用與可重複執行需在 TASK-027 整合測試或人工於 SQL Editor 驗證）。
  - `findAffectedAppointmentsForClosedDate` 對格式異常的 `date` 字串加了 try/catch 防禦
    （避免 `addDays` 內部拋出未攔截的 `RangeError`），但沒有做完整的日期格式驗證；
    「今天或未來」的業務規則驗證依任務卡假設留給呼叫端（TASK-025）。
  - 回滾腳本具破壞性且不可逆（詳見腳本內警告註解），且若晚於 TASK-024 規劃中會依賴
    `closed_dates`／`buffer_minutes` 的 migration 才回滾，`get_available_slots` RPC 會在
    執行期失敗；已在 down script 加註警告。
  - `ai/context/project-map.md` 尚未列出 `lib/admin/closed-dates.ts` 與
    `supabase/migrations/0003_*`（不在本卡允許變更檔案清單內，留待下一次文件更新或
    TASK-027 一併處理）。
- 後續任務：TASK-023（月曆選取器元件）、TASK-024（RPC 與改期表單邏輯）、TASK-025（設定頁
  串接）、TASK-026（後台週曆同步）皆依賴本卡。
