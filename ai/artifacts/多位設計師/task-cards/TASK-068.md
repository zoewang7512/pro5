# AI-Ready 任務卡

## Metadata

- 任務：多位設計師 依設計師計算時段與建立預約（`0018`：exclusion constraint 改為依設計師、`get_available_slots`／`create_appointment` 加 `p_designer_id` 與自動指派）
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：多位設計師
- 上層 User Story：依設計師計算時段與建立預約
- 分軌：後端
- 前置任務（dependsOn）：TASK-067
- 狀態：待驗證／待人工驗收（人工已於 2026-10-21 核准；套用前 architect／security-reviewer 與套用後 test-engineer 審查皆已完成並採納，見完成證據；有數項證據尚未取得，見驗證報告「尚未驗證」）
- 風險等級：高（改寫顧客端唯一的預約讀寫路徑、更換資料庫層級的防雙重預約約束、新增併發下的自動指派）
- Agent owner：Claude Code
- 人工核准者：使用者

## 目標

依 TASK-067 架構筆記 E 實作 `0018`，讓可預約時段與預約建立改成依設計師計算，並更新前端 API 薄封裝的
型別與參數（**不改任何畫面**）。套用後，在只有預設設計師的情況下，行為與升級前一致。

## 情境包（Context Pack）

- 相關檔案：
  - `supabase/migrations/0014_create_appointment_business_hours.sql`（`create_appointment` 現行版本，含公休、
    固定營業時間、提前量、防灌爆、顧客去重與錯誤對應）
  - `supabase/migrations/0009_booking_policy_lead_time.sql`（`get_available_slots` 現行版本，含 buffer-aware 重疊判斷）
  - `supabase/migrations/0002_booking_flow.sql`（原始 exclusion constraint 與「不分服務」的註解）
  - `lib/booking/api.ts`、`lib/booking/types.ts`、`lib/booking/error-messages.ts`
  - `lib/admin/appointments.ts`（後台改期的 `23P01 → SLOT_CONFLICT` 對應，constraint 名稱不變所以不用改）
  - `ai/context/decisions.md` 2026-08-05「時段衝突用 exclusion constraint，不分服務」
- 既有模式：每支 RPC migration 開頭做依賴檢查；〔審查〕execute 權限改為明寫 `revoke ... from public, anon, authenticated;
  grant ... to anon, authenticated`（見架構筆記 E，不再依賴 default privileges）；
  函式本體附中文註解說明每段檢查的理由與邊界語意。
- 假設：TASK-067 的 `0017` 已套用。
- 人工決定（2026-10-21）：`create_appointment` 指定與不指定兩條路徑**都檢查 buffer**（TASK-067 架構筆記「人工決定」2）。
- 未知事項：
  - Supabase 的 `btree_gist` 對 `uuid` 的 gist operator class 是否可用（預期可用），實作第一步先在 SQL Editor 驗證。
  - 「不指定」查詢對每個 30 分鐘格點要檢查每位設計師，資料量小（數位設計師 × 每日約 20 格），預期無效能問題；
    實作後用 `explain analyze` 留一筆證據。
- 允許變更的檔案：
  - `supabase/migrations/0018_designer_aware_booking.sql`、`0018_designer_aware_booking_down.sql`（新增）
  - `lib/booking/api.ts`（只改 `getAvailableSlots`／`createAppointment`；`getServices` 留給 TASK-073）
  - `lib/booking/types.ts`（`CreateAppointmentInput.designerId?: string | null`、`AppointmentConfirmation`
    追加 `designerId`／`designerName`）
  - `tests/booking/api.test.ts`（參數對應單元測試）
  - `tests/booking.integration.test.ts`、`tests/admin-booking.integration.test.ts`、`tests/rls.integration.test.ts`、
    `tests/business-hours.integration.test.ts`、`tests/booking-policy.integration.test.ts`、
    `tests/notifications.integration.test.ts`、`tests/services.integration.test.ts`〔審查〕（直接 insert `appointments`
    的測試要補 `designer_id`；當場建立 `__TEST__` 服務再呼叫 RPC 的測試，改用下方共用 fixture，否則新服務沒有
    任何設計師，時段會變成空陣列、建立預約回 `SLOT_CONFLICT`，例如 `tests/services.integration.test.ts:288-294`）
  - `tests/helpers/designer-fixture.ts`（新增〔審查〕：每個套件建立專屬 `__TEST__` 設計師，只開 `__TEST__` 服務，
    `afterAll` 用 service_role 先刪預約再刪設計師；遵守 TASK-067 架構筆記 A 的單一資料庫隔離規則）
  - `scripts/seed-booking-data.mjs`（〔審查〕seed 建立的服務要對預設設計師開啟，否則全新環境跑完 seed 後前台無法預約）
  - `lib/admin/closed-dates.ts`（〔審查〕只更新第 108 行附近「appointments_no_overlap 保證同一天不重疊」的過時註解）
  - `tests/designers.integration.test.ts`（擴充時段與指派的整合測試）
  - `ai/context/decisions.md`（新增決策：exclusion constraint 改為依設計師，取代 2026-08-05 的「不分服務」前提）
- 不得觸碰：`app/` 底下任何畫面元件（TASK-073～075）、通知信（TASK-076）。

## 需求

- 依架構筆記 E：補回填 `designer_id` 的 `null` → `set not null` → 換 exclusion constraint（名稱不變）→
  建立兩支內部判斷函式 → `drop` 舊簽名並建立新簽名的兩支 RPC → 明寫 execute 權限給 anon 與 authenticated
  （〔審查〕套用前後用 `pg_proc.proacl` 比對授權一致）。檢查順序、共用 insert 迴圈、`lock table`、`notify pgrst`
  依架構筆記 E。
- WHEN 只有預設設計師 THE SYSTEM SHALL 讓 `get_available_slots` 與 `create_appointment` 的結果與升級前一致。
- WHEN 兩位合格設計師的同一時段 THE SYSTEM SHALL 允許各自成立一筆預約。
- WHEN 指定的設計師停用、沒開該服務或當天請假 THE SYSTEM SHALL 讓 `get_available_slots` 回空陣列、
  `create_appointment` 回 `SLOT_CONFLICT`。
- WHEN 不指定 THE SYSTEM SHALL 依 `(當天有效預約數, sort_order, id)` 指派，第一順位因併發衝突時改派下一位。
- WHEN 全部候選都失敗 THE SYSTEM SHALL 回 `SLOT_CONFLICT`，而且不留下新建的 `customers` 列。
- WHEN 同一個 email（去頭尾空白、不分大小寫）已有 3 筆未過期的 `pending`／`confirmed` 預約 THE SYSTEM SHALL 回
  `BOOKING_LIMIT_EXCEEDED`（人工 2026-10-21 決定併入本卡，取代延後的 TASK-080 限流，擋下「用別人 email 大量預約、
  借本站網域寄確認信」的濫用）。比照既有電話上限的寫法與位置（設計師候選清單之後、顧客去重之前），全店合計、不分
  設計師；未填 email 的預約不受此限。沿用既有錯誤碼與前台文案，不新增錯誤碼。
- WHEN 指定或不指定的預約會擠進任一方的 buffer THE SYSTEM SHALL 回 `SLOT_CONFLICT`（人工決定的有意收緊）。

## 驗收標準

- `0018` 可重複執行；`_down` 可回滾到 `0017` 狀態（`_down` 檔頭註明：若已存在跨設計師同時段的預約，
  恢復全店 exclusion constraint 會失敗，必須先人工處理）。
- 既有全部整合測試套件（`test:booking`／`test:admin-booking`／`test:business-hours`／`test:rls`／
  `test:booking-policy`／`test:services`／`test:notifications`）回歸通過。〔審查〕證據分兩段：`0018` 套用後，
  只允許修改 fixture 的設定部分（改用 `designer-fixture.ts`、補 `designer_id`），測試斷言本身不改。
- 〔審查〕`_down` 檔頭寫明回滾順序：先在 Vercel 回滾前端 → `0018_down` → `0017_down`。
- 新增整合測試全部通過（見驗證契約）。
- `decisions.md` 已記錄新決策（exclusion 依設計師；BOOKING_LIMIT 維持全店以電話計算，並新增以 email 計算的同等上限；
  TASK-080 延後的理由與重新啟動條件；buffer 檢查的人工決定；
  exclusion 不含 buffer 的既有殘留）。

## 實作備註

- 巢狀 `begin ... exception` 每次進入都會建立 savepoint，候選人數少，成本可接受。
- 「當天有效預約數」用 `status in ('pending','confirmed')` 且 `start_at` 落在該 Asia/Taipei 日期內計算。
- 錯誤碼不新增；前端 `error-messages.ts` 的 `SLOT_CONFLICT` 文案沿用。

## 驗證契約

- 單元測試：`lib/booking/api.ts` 正確傳遞 `p_designer_id`（null 與有值兩種）、正確解析 `designer_name`。
- 整合測試（真實 Supabase，`npm run test:designers` 等）：
  - 兩位設計師同時段各一筆成功；同一設計師同時段第二筆 `SLOT_CONFLICT`。
  - 指定設計師：停用／未開服務／請假 → 時段空陣列且建立預約失敗。
  - 不指定：時段為聯集；指派規則（預約數 → sort_order → id）三種情境各一個案例。
  - 併發：`Promise.all` 同時送兩筆「不指定」同一時段、兩位候選 → 兩筆都成功且分屬不同設計師；三筆送給
    兩位候選 → 第三筆 `SLOT_CONFLICT` 且 `customers` 沒有多出孤兒列。
  - 與既有規則交叉：公休日、固定公休、營業時間邊界、buffer、提前量在指定與不指定兩種模式下都仍然生效。
  - buffer 收緊：直接呼叫 `create_appointment` 擠進既有預約的 buffer，指定與不指定都回 `SLOT_CONFLICT`；
    只有預設設計師時，`get_available_slots` 列出的每個時段都能成功建立（證明兩支 RPC 判斷一致）。
  - anon 不能直接呼叫兩支內部函式（42501）。
  - 〔審查〕指定設計師「不存在／停用／沒開服務／請假」四種情況，`create_appointment` 回傳的 JSON 完全相同；
    用 90 天外的時間呼叫時，合格與不合格設計師都回 `VALIDATION_ERROR`（不能當成探測管道）。
  - 〔審查〕authenticated（店長 session）呼叫兩支 RPC 成功；套用前後 `proacl` 一致。
  - 〔審查〕`BOOKING_LIMIT` 跨設計師以電話合計（同電話對三位設計師各約一筆後，第四筆被拒）。
  - email 上限：同 email、不同電話預約 3 筆後第 4 筆回 `BOOKING_LIMIT_EXCEEDED`；大小寫與前後空白不同視為同一個
    email；未填 email 不受影響；已取消或已過期的預約不計入。測試用的 email 一律用 `@example.invalid`，不寄到真實信箱。
- E2E 測試：不適用（無畫面變更；前台既有流程不傳設計師參數，以既有前台走查一次確認仍可預約）。
- 型別檢查：`npx tsc --noEmit`
- Lint：`npm run lint`
- Build：`npm run build`
- 螢幕截圖：不適用。
- 安全性檢查：architect＋security-reviewer＋test-engineer 三方審查（高風險）；確認內部函式不可被 anon 呼叫、
  RPC 回應不洩漏設計師資訊（時段查詢）、`search_path = ''`。
- 注意：`appointments` 的 INSERT/UPDATE 有 Database Webhook trigger（`0011`／`0012`）會真的打到寄信端點，
  `vi.mock` 擋不住資料庫自己發出的請求。新增的整合測試建立預約時，`customer_email` 一律留空或使用既有測試
  採用的做法，實作前先讀既有整合測試確認，不得對真實信箱寄信。

## 完成證據

完整內容見 [`../verification/TASK-068.md`](../verification/TASK-068.md)。

- 變更的檔案：`supabase/migrations/0018_designer_aware_booking.sql`、`0018_designer_aware_booking_down.sql`；`lib/booking/api.ts`、`lib/booking/types.ts`；`lib/admin/closed-dates.ts`（過時註解）；`scripts/seed-booking-data.mjs`；`tests/helpers/designer-fixture.ts`（新）；`tests/designers.integration.test.ts`、`tests/booking/api.test.ts`；既有整合測試只改 fixture：`booking`、`rls`、`admin-booking`、`business-hours`、`notifications`、`services`，以及**不在原允許清單內的 `mfa-rls`**（它直接 insert `appointments`，`designer_id` 改 not null 後必須補）；`booking-policy` 不需要修改；`vitest.designers.config.ts`（沿用 TASK-067）；`ai/context/decisions.md`、`project-map.md`。
- 執行過的指令：`tsc --noEmit`、`npm run lint`、`npm run build`、`npm test`（552 項）、`npm run test:designers`（75 項）、10 套既有整合測試回歸（套用 0018 前後數量完全相同）、併發案例重複 10 次、正式資料庫唯讀查詢。
- 測試輸出：全數通過，詳見驗證報告。
- 螢幕截圖：不適用（無畫面變更）。
- 已知限制：見驗證報告「尚未驗證」——`0018_down` 未實跑、`explain analyze`、併發競爭路徑的確定性證據、`seed-booking-data.mjs` 未實跑、Resend 對 `.invalid` 的處理未確認（前台既有流程人工走查已於 2026-10-22 完成）；以及既有已知限制（第 90 天邊界、exclusion 不含 buffer、`BOOKING_LIMIT` 與 `SLOT_CONFLICT` 的檢查順序、email 全表掃描）。
- 實作期偏離原設計（已寫入 `decisions.md`）：巢狀 handler 也接 `deadlock_detected`；一開始就取 access exclusive＋`lock_timeout`；email 上限加 advisory lock 與正規化；套用前檢查上架中服務都有啟用中設計師；兩支 RPC 明寫三個角色的 execute 權限；`when others` 記錄 sqlstate。
- 部署順序：**先套用 0018，再合併 master**（新前端一定送出 `p_designer_id`）；套用 0018 到合併之間不要在後台新增服務。
- 後續任務：TASK-073（前台串接，含 `BOOKING_LIMIT_EXCEEDED` 文案）、TASK-075（後台改期依原設計師）、TASK-076（通知信）
