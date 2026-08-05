# AI-Ready 任務卡

## Metadata

- 任務：顧客預約流程 架構基礎（資料庫層）
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：顧客預約流程
- 上層 User Story：不適用（跨三個 User Story 的共用架構基礎，套用 `implementation-plan` 的
  「Epic 架構優先規則」——三個 User Story 共用同一個資料模型、同一組 RPC）
- 分軌：後端
- 前置任務（dependsOn）：TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006,
  TASK-007, TASK-008, TASK-009（「專案設置」Epic 全部卡片，依 `project-kickoff` 步驟 2
  的強制規則）
- 狀態：完成（2026-08-05 核准）
- 風險等級：高
- Agent owner：待指定
- 人工核准者：待指定

## 目標

建立顧客預約流程共用的資料庫層基礎：新增 `business_hours` 表、撤銷 TASK-003 的 anon 直接
INSERT policy、新增 `get_available_slots`／`create_appointment` 兩個 `SECURITY DEFINER`
RPC（含資料庫層併發防護），並提供最小可行的種子資料腳本。**本卡不含前端頁面／`lib/booking/`
封裝**（移到 TASK-011，避免介面在唯一消費者出現前就被鎖死——見 2026-08-05 architect
審查發現）。

## 情境包（Context Pack）

- 相關檔案：
  - `supabase/migrations/0001_core_schema.sql`（既有 schema；本卡新增
    `0002_booking_flow.sql`，不修改此檔案本身）
  - `tests/rls.integration.test.ts`（第 101-126 行左右，斷言「anon 可以新增預約」的
    既有測試，本卡需同步修改為斷言「anon 直接 insert 被拒絕」）
  - `ai/context/decisions.md`（TASK-003 的既有決策，以及本次計畫審查後新增的兩則決策：
    撤銷 anon INSERT policy、exclusion constraint 設計）
  - `ai/artifacts/顧客預約流程/feature-spec.md`（「資料與 API」「安全性與隱私」「功能
    需求」章節，已依三方審查發現修正，是本卡最新的權威規格）
  - `scripts/seed-designer-account.mjs`（既有 seed 腳本模式，冪等、讀 `.env.local`）
- 既有模式：
  - 沿用 TASK-003 的安全邊界收斂原則：anon 不直接 SELECT/INSERT `appointments`／
    `customers`，一律透過 `SECURITY DEFINER` + `set search_path = ''` 的 RPC。
  - migration 寫成可重複執行（`if not exists`／`drop ... if exists`），並產出對應
    down script，比照 `0001_core_schema_down.sql`。
  - 種子資料**不**寫進 migration（`services`／`business_hours` 沒有天然的 upsert key
    能讓 migration 重跑保持冪等，且未來「服務項目管理」Epic 若刪除種子服務，migration
    重跑會讓它復活），改用獨立腳本 `scripts/seed-booking-data.mjs`，比照
    `seed-designer-account.mjs` 的冪等寫法（用 `upsert` 或先查後寫）。
- 假設：預設營業時間為週一至週六 10:00–19:00、週日公休；`services` 種子至少 3 筆
  （「剪髮造型」「染髮設計」「頭皮護理」，沿用 S2/S3/S4 mockup 中出現過的服務名稱與
  價格，避免與已展示內容不一致）；所有時間運算以 `Asia/Taipei` 時區為準；時段格點為
  30 分鐘。
- 未知事項：無。
- 允許變更的檔案：`supabase/migrations/0002_booking_flow.sql`（新增）及對應 down script、
  `scripts/seed-booking-data.mjs`（新增）、`tests/rls.integration.test.ts`（更新舊斷言）、
  `package.json`（新增 `seed:booking` script）、`ai/context/design-system.md`（若過程中
  發現需要登記新元件，本卡不涉及 UI 故通常不需要）、`ai/context/decisions.md`（若有新的
  持久性決策）、`ai/context/project-map.md`（更新重要目錄／常用指令表）。
- 不得觸碰：`0001_core_schema.sql`（既有 migration 不可修改，只能新增後續 migration）、
  `app/page.tsx`、`lib/booking/`（TASK-011 範圍）、`app/admin/`／`app/login/`。

## 需求

- 新增 `business_hours` 表：`weekday int primary key`（0-6，`unique` 天然由 primary key
  保證）、`open_time time`、`close_time time`、`is_closed boolean not null default false`，
  RLS 啟用，anon 可 SELECT，只有 `is_admin()` 可寫。
- `0002_booking_flow.sql` **只包含 schema 變更**（表、RPC、policy、constraint），不包含
  種子資料 INSERT；種子資料由 `scripts/seed-booking-data.mjs` 負責，讀 `.env.local` 的
  Supabase 連線資訊，用 `upsert`（`business_hours` 以 `weekday` 為 conflict target；
  `services` 若無天然唯一鍵，用「依 name 查詢，不存在才 insert」的方式維持冪等）。
- **撤銷既有 anon 直接寫入路徑**：`drop policy if exists "anyone can create pending
  appointment" on public.appointments;` 並 `revoke insert (service_id, customer_name,
  customer_phone, customer_email, start_at, end_at) on public.appointments from anon;`。
  同步修改 `tests/rls.integration.test.ts` 對應案例，斷言 anon 直接 insert 會被拒絕
  （而非目前斷言「可以新增預約」成功）。
- `appointments` 新增併發防護：`create extension if not exists btree_gist;` 後加
  `constraint appointments_no_overlap exclude using gist (tstzrange(start_at, end_at,
  '[)') with &&) where (status in ('pending','confirmed','completed'))`——**不**以
  `service_id` 分割（單一設計師同時只能服務一位顧客，不同服務也不能同時段重疊）。
- 新增 RPC `get_available_slots(p_service_id uuid, p_date date) returns jsonb`：
  `SECURITY DEFINER`、`set search_path = ''`；先確認 `p_service_id` 對應服務
  `is_active=true` 且 `p_date` 在「今天～今天+90 天」範圍內（否則回傳空陣列，不報錯）；
  依 `business_hours`（`weekday = extract(dow from p_date)`，`Asia/Taipei` 時區）與該
  服務時長，扣除已有 `appointments`（`pending`/`confirmed`/`completed`）佔用的區間，
  以 30 分鐘為格點回傳可預約時段陣列（起點＋服務時長須落在營業時間內）；只回傳時間
  資訊，不回傳任何顧客／預約 ID。內部用 `exception when others` 包裝，統一回傳
  `{ok:false, error_code:'INTERNAL_ERROR'}` 格式，不洩漏底層錯誤細節。
- 新增 RPC `create_appointment(p_service_id uuid, p_start_at timestamptz, p_customer_name
  text, p_customer_phone text, p_customer_email text) returns jsonb`：`SECURITY DEFINER`、
  `set search_path = ''`；交易內依序：(1) 驗證服務啟用中；(2) 驗證 `p_start_at` 晚於
  `now() + interval '1 hour'` 且早於 `now() + interval '90 days'`；(3) 驗證
  `p_customer_phone` 正規化後尚未有 3 筆以上未過期的 `pending`/`confirmed` 預約；
  (4) 依 phone 優先、email 次之找既有 `customers` 或新建（找到衝突命中不同顧客時，
  以 phone 命中者為準，不覆寫既有欄位，見 feature-spec「功能需求」）；(5) 寫入
  `appointments`（`status='pending'`），交由 exclusion constraint 擋下時段衝突；
  (6) 回傳 `{ok:true, data:{service_name, start_at, end_at, customer_name,
  customer_phone}}`，其中 `customer_name`／`customer_phone` 回顯**本次請求送出的值**，
  不是資料庫既有顧客記錄的值。用 `exception when unique_violation or
  exclusion_violation then return jsonb_build_object('ok', false, 'error_code',
  'SLOT_CONFLICT', ...)` 等區分錯誤類型，未預期例外一律歸類 `INTERNAL_ERROR`。
- `revoke execute on function ... from public;` ＋ `grant execute on function ... to
  anon;`，兩個 RPC 皆比照辦理，明確不依賴 Postgres 預設的 `PUBLIC` 執行權。
- `drop function if exists` 兩個 RPC 名稱（若簽章變更導致 `create or replace` 失敗）。

## 驗收標準

- `business_hours` 表存在且 RLS 正確；`scripts/seed-booking-data.mjs` 可重複執行，
  跑兩次不會產生重複資料（6 個工作日 + 1 個公休日、至少 3 筆 `services`）。
- 舊的 `"anyone can create pending appointment"` policy 已撤銷；anon 直接對
  `appointments` 下 `insert` 會被 RLS 拒絕；`tests/rls.integration.test.ts` 對應案例
  已更新且通過。
- `get_available_slots` 對「已有預約佔用」「非營業時間」「營業時間內且空閒」「超出
  90 天視野」四種情況回傳正確結果（本卡至少手動用 SQL/Supabase dashboard 驗證一輪，
  正式自動化整合測試由 TASK-013 負責——見「驗證契約」的範圍說明）。
- `create_appointment` 成功建立預約並正確關聯 `customer_id`；`appointments_no_overlap`
  constraint 存在且能擋下重疊時段（手動驗證：兩筆重疊時段的 insert，第二筆失敗）；
  相鄰時段（不重疊）兩筆皆能成功。
- `revoke execute ... from public` 已套用，可用 `\df+` 或查詢
  `information_schema.routine_privileges` 確認 `PUBLIC` 沒有 EXECUTE 權限。
- `npx tsc --noEmit`／`npm run lint`／`npm run build` 皆通過（本卡不含前端變更，這三個
  指令主要確認 `scripts/seed-booking-data.mjs` 沒有型別/lint 問題、且沒有意外影響既有
  建置）。

## 實作備註

- 種子資料腳本可參考 `scripts/seed-designer-account.mjs` 的結構（讀 `.env.local`、
  用 service role key、印出結果但不印出敏感資訊）。
- migration 內的 RPC 函式本體用 `plpgsql`（需要交易內多步驟邏輯與例外處理），不是
  `sql` language（`is_admin()`／`set_updated_at()` 用 `sql`／`plpgsql` 是因為邏輯單純，
  這兩個新 RPC 邏輯較複雜，plpgsql 較適合）。

## 驗證契約

- 單元測試：不適用（本卡邏輯集中在 SQL/plpgsql，無獨立可測的 TS 純函式）。
- 整合測試：本卡**不**負責建立/執行 `npm run test:booking`（該自動化整合測試套件的
  建立與執行歸屬 TASK-013，避免如 test-engineer 審查指出的「TASK-010 允許變更檔案
  不含測試檔，卻要求它自建並跑整合測試」的範圍矛盾）；本卡改用手動驗證（SQL client
  或 Supabase dashboard 直接呼叫兩個 RPC 與嘗試直接 insert），驗證結果記錄於「完成
  證據」。
- E2E 測試：不適用。
- 型別檢查：`tsc --noEmit` 成功。
- Lint：`npm run lint` 成功。
- Build：`npm run build` 成功。
- 螢幕截圖：不適用（無 UI 變更）。
- 安全性檢查：
  - 確認兩個新 RPC 皆 `SECURITY DEFINER` + `set search_path = ''`。
  - 確認 `grant execute` 只給 `anon`，且已 `revoke ... from public`。
  - 確認 anon 仍無法繞過 RPC 直接讀寫 `appointments`／`customers`（含撤銷後的舊 policy）。
  - 確認 `create_appointment` 回傳的 `customer_name`／`customer_phone` 是回顯輸入值，
    不是查詢到的既有顧客記錄值。
  - 手動驗證「兩筆重疊時段的 insert，第二筆被 exclusion constraint 擋下」。

## 完成證據

- 變更的檔案：
  - `supabase/migrations/0002_booking_flow.sql`（新增：`business_hours` 表、撤銷 anon
    直接 INSERT policy、`appointments_no_overlap` exclusion constraint、
    `get_available_slots`／`create_appointment` 兩個 RPC）
  - `supabase/migrations/0002_booking_flow_down.sql`（新增：對應回滾）
  - `scripts/seed-booking-data.mjs`（新增：`business_hours`／`services` 種子資料，冪等）
  - `package.json`（新增 `seed:booking` script）
  - `tests/rls.integration.test.ts`（更新：移除已失效的「anon 可以新增預約」相關 3 個
    測試，改為 1 個「anon 無法直接 insert appointments」測試；`beforeAll` 改用 service
    role 建立 fixture 預約供「設計師可讀取」測試使用）
- 執行過的指令：
  - migration 由使用者手動貼到 Supabase SQL Editor 執行，回報成功（專案無 CLI／DB
    連線字串可自動套用，沿用 TASK-003 的既有限制）
  - `npm run seed:booking` — 執行兩次，第二次全部略過重複資料，確認冪等
  - `npx tsc --noEmit` — 通過
  - `npm run lint` — 通過
  - `npm run build` — 通過
  - 手動驗證腳本（暫存於 scripts/ 執行後即刪除，不進版控）對真實 Supabase 專案驗證：
    - anon 直接 `insert` appointments → `permission denied for table appointments`（正確拒絕）
    - `get_available_slots` 對未來日期回傳正確的 30 分鐘格點時段陣列（17 個時段，
      對應週五 10:00–19:00 扣掉不足 45 分鐘服務時長的尾端）
    - `create_appointment` 第一次呼叫成功建立預約
    - 同一時段第二次呼叫回傳 `SLOT_CONFLICT`（exclusion constraint 正確擋下）
    - 同電話不同時段第二次呼叫成功，且 `customers` 表對該電話只有 1 筆記錄（去重正確）
    - anon `select business_hours` 成功（7 筆，含週日 `is_closed=true`）
    - anon `update business_hours` 呼叫不報錯但實際影響 0 筆（RLS 阻擋；用 service role
      前後讀取比對確認資料未被更動——此為 Supabase/PostgREST 對 RLS 阻擋 UPDATE 的已知
      行為：回傳成功但空結果，不是拋錯，驗證時特別注意不能只看有無 error）
- 測試輸出：`tests/rls.integration.test.ts` 已同步更新斷言（正式重跑與 `npm run
  test:booking` 整合測試由 TASK-013 負責，該卡尚未開始，故本卡不宣稱這兩項已跑過）。
- 螢幕截圖：不適用（無 UI 變更）。
- 已知限制：
  - 未針對本次修改重新跑 `npm run test:rls`（需要 TASK-013 建立/重跑，本卡僅用暫時性
    手動腳本驗證核心路徑，未涵蓋 `test:rls` 既有全部案例）；已在 TASK-013 的任務卡中
    明確要求重跑並記錄結果，避免遺漏。
  - `create_appointment` 對「customers 表 phone/email unique constraint 併發撞號」的
    處理是回傳 `INTERNAL_ERROR` 讓前端重試整個請求，不是精準重試/合併，這是刻意的簡化
    取捨（見 migration 內註解），機率極低（需兩個全新顧客同時用同一手機號碼搶第一次
    建檔）。
  - 併發（多請求同時搶同一時段）尚未在本卡實測，只驗證了循序呼叫的衝突擋下；正式的
    3-5 併發＋多輪測試由 TASK-013 的 `test:booking` 負責。
- 後續任務：TASK-011（前端：服務列表與選時段，含 `lib/booking/` 封裝與頁面骨架）、
  TASK-012（前端：填寫資訊與預約成功）、TASK-013（整合驗證，含正式的 `test:booking`
  自動化測試與 `test:rls` 回歸測試）。
