# AI-Ready 任務卡

## Metadata

- 任務：`create_appointment` RPC 加入 `closed_dates` 檢查（公休日是硬規則，不能只在畫面層擋）
- 上層規格：[`feature-spec.md`](../feature-spec.md)（第二批次）
- 上層 Epic：營業時間與可預約時段管理
- 上層 User Story：設定公休日／特殊假期
- 分軌：後端
- 前置任務（dependsOn）：TASK-024
- 狀態：完成（使用者已核准，2026-08-25）
- 風險等級：高（修改 `create_appointment`——顧客端唯一的預約寫入路徑，任何邏輯錯誤可能
  導致合法預約被誤擋，或錯誤訊息設計不當洩漏「這天是公休」以外的內部狀態；需要架構、
  安全性、測試三方審查）

**實作期版本基準更正記錄（2026-08-25）**：本卡撰寫於 2026-08-07，當時 `create_appointment`
最新版本在 `0002_booking_flow.sql`，計畫新增檔案叫 `0005_create_appointment_closed_
dates.sql`。實際開始實作時（2026-08-25），資料庫已歷經 `0006`～`0012` 共 7 個後續
migration，其中 `0009_booking_policy_lead_time.sql`（TASK-048）已用 `create or replace`
重寫過 `create_appointment`（提前量檢查改讀 `booking_policy.min_lead_time_hours`），是
當下正式環境實際跑的版本。若仍照本卡原始計畫以 0002 版本、`0005` 編號新增，會讓
`create_appointment` 退回沒有 `booking_policy` 邏輯的舊版本（實質回歸），且編號 `0005`
會誤導成排在 `0004`／`0006` 之間、與真實部署順序不符。**已與使用者確認並改為**：檔案
編號 `0013_create_appointment_closed_dates.sql`（下一個真正未使用的編號，正確反映實際
部署順序），函式內容以 `0009` 版本為底插入公休日檢查。下方「情境包」「需求」段落已
更新反映這個修正後的基準；未特別加註的部分（檢查邏輯本身、錯誤碼重用、時區判定）與
原始計畫完全一致，不受此修正影響。

## 目標

`create_appointment` RPC 目前完全不檢查 `closed_dates`，唯一的公休日防線是
`get_available_slots` 在畫面上不顯示公休日的時段——顧客若繞過前端畫面直接呼叫
`create_appointment`（例如自行組 API 請求），仍能在已標記公休的日期成功建立預約。
`buffer_minutes` 不做資料庫層約束是 TASK-024 已核准、feature-spec 也記錄在案的可接受取捨
（緩衝時間是排程偏好，不是硬規則，見 feature-spec.md「非目標」段落的競態風險說明），但
「整天公休」是硬規則，理應跟 `appointments_no_overlap` exclusion constraint 一樣，在資料庫
寫入路徑本身就擋下，不能只靠前端不顯示時段。本卡補上這道防線。

## 情境包（Context Pack）

- 相關檔案：
  - `supabase/migrations/0009_booking_policy_lead_time.sql` 第 155-271 行：
    `create_appointment` 現行（2026-08-25 實作當下）完整定義，本卡要修改的目標函式（服務
    驗證、電話/信箱驗證、讀取 `booking_policy.min_lead_time_hours` 的提前量與視野上限
    檢查、顧客去重、寫入 `appointments`、`exception` 區塊分類 `unique_violation`／
    `exclusion_violation` 的既有寫法）。**不是** `0002_booking_flow.sql` 的原始版本——見
    上方「實作期版本基準更正記錄」。
  - `supabase/migrations/0004_slots_closures_buffer.sql`：`get_available_slots` 加入
    `closed_dates` 檢查的既有寫法（`if exists (select 1 from public.closed_dates where
    closed_dates.date = p_date) then ...`）與部署期前置檢查（`do $$ ... raise exception`
    確認 `closed_dates` 表存在才繼續）是本卡的直接範本，兩支函式的 `closed_dates` 檢查應該
    長得一樣。
  - `lib/booking/types.ts`／`lib/booking/api.ts` 的 `createAppointment`：前端呼叫
    `create_appointment` RPC 與解析 `{ok, error_code, message}` 信封的既有寫法；`SLOT_CONFLICT`
    錯誤碼目前對應「這個時段已被其他預約占用，請選擇其他時段。」的既有文案（見
    `lib/booking/api.ts` 或前端呼叫端的錯誤訊息對照表，實際檔案以搜尋為準）。
- 既有模式：
  - `create_appointment` 的 `exception when unique_violation or exclusion_violation` 區塊
    已經在依 constraint name 分類錯誤（`appointments_no_overlap` → `SLOT_CONFLICT`，其餘
    → `INTERNAL_ERROR`，見 0002 第 256-263 行）；本卡的公休日檢查不是靠 constraint 觸發
    exception，而是在寫入前主動 `if exists` 擋下，用同樣的 `jsonb_build_object('ok', false,
    'error_code', ..., 'message', ...)` 回傳格式直接 return，不進 exception 區塊。
  - 錯誤碼刻意重用既有 `SLOT_CONFLICT`（而非新增例如 `DATE_CLOSED`）：`get_available_slots`
    已經把公休日、已被預約、超出視野三種「沒有時段」的原因統一回傳同一種空陣列（不細分
    原因，見 0002/0004 的既有設計意圖），`create_appointment` 的公休日拒絕比照同一個
    「不對外細分原因」的資安/隱私姿態——避免顧客端能用「錯誤碼不同」反向推敲出「這天到底
    是公休還是已被訂滿」這種對業務沒有幫助的內部狀態區分，也讓前端完全不需要新增任何錯誤
    文案分支，直接沿用既有 `SLOT_CONFLICT` 的顯示邏輯。
  - 部署順序防呆比照 0004 的既有寫法：`create or replace` 前先 `do $$ ... raise exception`
    確認 `closed_dates` 表存在，避免本機無 Supabase CLI／migration ledger（人工貼 SQL
    Editor 執行）的既有限制下，套用順序錯誤只在顧客端執行期才顯現。
- 假設：
  - 公休日判定用 `(p_start_at at time zone 'Asia/Taipei')::date`（比照 `find
    AffectedAppointmentsForClosedDate` 在 `lib/admin/closed-dates.ts` 用 Asia/Taipei 時區
    圈定「這筆預約屬於哪一天」的既有邏輯，日期比對一律以台北時間為準，不是 UTC）。
  - 只檢查 `p_start_at` 所屬的那一天；預約本身不會跨日（`get_available_slots` 的候選時段
    生成邏輯已保證 `v_slot_start`／`v_slot_end` 同一天內，`create_appointment` 沿用同一批
    候選時段，不需要額外檢查 `end_at` 所屬日期）。
  - 不新增錯誤碼、不新增前端文案（見上方「既有模式」的理由）；若後續產品面認為「公休日」
    值得對顧客顯示更明確的原因（而非籠統的『時段已被占用』），是另一個產品決策，不在本卡
    範圍內處理。
- 未知事項：無。
- 允許變更的檔案：
  - `supabase/migrations/0013_create_appointment_closed_dates.sql`（新增；編號更正見
    上方「實作期版本基準更正記錄」）
  - `supabase/migrations/0013_create_appointment_closed_dates_down.sql`（新增）
  - `tests/business-hours.integration.test.ts`（新增 `create_appointment` 對
    `closed_dates` 回應的整合測試案例；新增 `customers` 表清除步驟到既有 `afterAll`，
    因為新測試會透過真正的 RPC 呼叫寫入該表——既有測試檔案先前沒有這個清理步驟）
  - `ai/context/project-map.md`（`closed_dates` 說明段落更新，記錄 `create_appointment`
    自本卡起也會檢查該表，以及對應的 force RLS 已知限制）
- 不得觸碰：`get_available_slots` RPC（TASK-024 範圍，本卡不修改，只讀取同一張
  `closed_dates` 表）、前端任何檔案（`lib/booking/api.ts`／`app/_components/booking/`）——
  重用既有 `SLOT_CONFLICT` 錯誤碼與既有文案，前端不需要異動、也不應該異動、`services`／
  `business_hours`／`closed_dates` 的 schema（TASK-022 已建立，本卡只讀取使用）。

## 需求

- 新增 `supabase/migrations/0005_create_appointment_closed_dates.sql`：
  - 檔頭比照 0004 的既有慣例：說明本卡任務、對應回滾腳本、依賴 0003 的 `closed_dates` 表、
    部署順序防呆的理由。
  - `create or replace function` 前先 `do $$ begin if to_regclass('public.closed_dates')
    is null then raise exception ...; end if; end $$;`（比照 0004 既有寫法）。
  - `create or replace function public.create_appointment(...)`：在現行定義基礎上，於
    「服務驗證」之後、「提前量與視野上限」檢查之前（或之後皆可，兩者是獨立的驗證步驟，
    順序不影響正確性，但比照 `get_available_slots` 讓公休日檢查在其他業務規則檢查之前的
    既有慣例，放在服務驗證後、提前量檢查前）新增：
    ```sql
    if exists (
      select 1 from public.closed_dates
      where closed_dates.date = (p_start_at at time zone 'Asia/Taipei')::date
    ) then
      return jsonb_build_object('ok', false, 'error_code', 'SLOT_CONFLICT', 'message', 'slot already booked');
    end if;
    ```
  - 函式簽名（參數/回傳型別）、`security definer`／`set search_path = ''`、
    `grant execute ... to anon` 邊界、其餘既有驗證與寫入邏輯全部不變。
  - 對應 `0005_create_appointment_closed_dates_down.sql`：`create or replace function`
    還原成 0002 版本的原始定義（比照 0004 down migration 的既有選擇：用 `create or
    replace` 換回舊版本，不用 `drop function`，避免顧客端建立預約的唯一寫入路徑出現空窗）。

## 驗收標準

- `create_appointment` 對已標記 `closed_dates` 的日期，回傳 `{ok: false, error_code:
  "SLOT_CONFLICT", ...}`，不寫入任何 `appointments`／`customers` 資料列（含不建立新顧客，
  比照既有驗證失敗路徑「先驗證失敗就不觸碰顧客去重邏輯」的既有順序）。
- `create_appointment` 對未標記公休的日期，行為與修改前完全一致（回歸安全網）。
- `get_available_slots` 與 `create_appointment` 對同一組輸入（服務、公休日期）的判斷一致：
  前者回傳空陣列、後者拒絕寫入。
- 既有測試（`test:booking`／`test:admin-booking`）重跑無回歸。
- `npx tsc --noEmit`／`npm run lint`／`npm run build`／`npm test` 皆通過（本卡純 SQL
  migration，這幾項預期不受影響，仍照既有慣例執行確認）。

## 實作備註

- 這是 `create_appointment`——顧客端建立預約的唯一寫入路徑——本批次第二次修改
  （第一次是 TASK-010 建立時的原始版本，本卡是套用後首次 `create or replace`）。**強烈建議**
  實作完成後，比照 TASK-024 的既有作法，先用一組簡單案例（標記某天公休、嘗試對該天呼叫
  `create_appointment`、確認被拒絕；同一天呼叫 `get_available_slots` 確認回傳空陣列；解除
  公休標記後重試 `create_appointment` 應成功）人工核對 RPC 實際行為，不要只依賴自動化測試。
- 公休日檢查刻意放在服務驗證「之後」：若 `p_service_id` 本身無效或服務已停用，應該回報
  `SERVICE_INACTIVE`（既有行為），而不是被公休日檢查搶先攔截、回報語意不精確的
  `SLOT_CONFLICT`。

## 驗證契約

- 單元測試：不適用（本卡純 SQL migration，無可抽出的 TypeScript 純函式邏輯）。
- 整合測試：建議擴充 `tests/booking.integration.test.ts`（或 TASK-027 統一擴充的
  `tests/business-hours.integration.test.ts`，兩者皆為既有整合測試檔案，實際歸屬由實作時
  依測試檔案既有分工判斷）新增案例：標記公休日後呼叫 `create_appointment` 被拒絕、資料庫
  無新增列；解除標記後同樣輸入成功建立。
- E2E 測試：不適用（無 UI 變更，`SlotPickerSection.tsx` 等前端元件本來就不會讓顧客選到
  `get_available_slots` 沒有回傳的時段，本卡是加強資料庫層防線，不是新增可見流程）。
- 型別檢查：`tsc --noEmit` 成功。
- Lint：`npm run lint` 成功。
- Build：`npm run build` 成功。
- 螢幕截圖：不適用。
- 安全性檢查：`create_appointment` 維持 `security definer`／`set search_path = ''`／只
  `grant execute` 給 `anon` 的既有邊界不變；新增的公休日檢查重用既有 `SLOT_CONFLICT`
  錯誤碼，不新增對外可區分的錯誤原因，不擴大回傳值形狀。

## 完成證據

- 變更的檔案：
  - `supabase/migrations/0013_create_appointment_closed_dates.sql`（新增；已人工貼
    Supabase SQL Editor 套用到正式環境）
  - `supabase/migrations/0013_create_appointment_closed_dates_down.sql`（新增）
  - `tests/business-hours.integration.test.ts`（新增「create_appointment RPC 對
    closed_dates 的回應」describe 區塊，4 個測試案例；新增 `escapeLikePattern` 輔助
    函式與 `afterAll` 的 `customers` 表清除步驟；新增 `CREATE_APPOINTMENT_CLOSED_
    WEEKDAY`／`_DATE` 常數）
  - `ai/context/project-map.md`（`closed_dates` 說明段落更新）
- 執行過的指令：
  - `npx tsc --noEmit`／`npm run lint`／`npm run build`：皆通過。
  - `npm run test:business-hours`：22/22 通過（含本卡新增的 4 個案例）。
  - `npm run test:booking`：23/23 通過，無回歸（TASK-048 的 `booking_policy` 提前量
    邏輯仍正確運作，證明本卡以 0009 版本為底、未意外退回 0002 版本）。
  - `npm run test:admin-booking`：13/13 通過，無回歸。
  - `npm test`（完整套件）：478/478 通過。
  - 正式環境手動走查（比照任務卡「實作備註」要求）：標記某天公休 → 呼叫真正的
    `create_appointment` RPC 被拒絕（`SLOT_CONFLICT`）→ 同日呼叫 `get_available_slots`
    回傳空陣列 → 解除公休標記 → 重新呼叫 `create_appointment` 成功建立 → 清除測試資料。
    五步皆符合預期。
  - `architect`／`security-reviewer` 對本次變更的審查：兩者皆 **Approve／無 MUST FIX**。
    逐行 diff 確認 0013 除新增的公休日檢查外與 0009 版本完全一致，down migration 與
    0009 逐字相同（未誤植回 0002）。
- MUST FIX 修正記錄：無（兩方審查皆無阻斷項）。
- NICE TO HAVE 處理記錄（兩方審查提出，重疊部分合併列出）：
  1. 部署順序防呆原本只檢查 `closed_dates` 表存在，遺漏本函式同時依賴的
     `booking_policy` 表——已補上第二個 `to_regclass` 檢查（`0013:56-59`）。
  2. `closed_dates` 若未來被誤啟用 `force row level security` 會讓公休日檢查靜默
     fail-open——已在 migration 檔頭與 `project-map.md` 補上「不得啟用」的明確記錄，
     比照 `booking_policy` 既有的同類警語。
  3. down migration 補上「不可跨級回滾」警語，避免未來若有 0014+ 再次重寫
     `create_appointment` 時，誤套用本檔案把新版本蓋回這裡寫死的舊版本。
  4. 新增台北時間跨 UTC 日界（00:30）的測試案例，證明時區判定邏輯本身真的被測到
     （原本三個案例都用 11:00，UTC 與台北剛好同一天，測不出時區轉換是否正確）。
  5. 任務卡（本檔案）情境包／需求／允許變更的檔案段落原本仍寫著過時的 `0005`／0002
     版本基準——已同步更正（見上方「實作期版本基準更正記錄」）。
  6. `create_appointment` 仍未檢查 `business_hours`（每週固定公休／營業時間）——**不在
     本卡範圍內修正**，已開新任務卡 TASK-062 追蹤，見「後續任務」。
- 螢幕截圖：不適用（無 UI）。
- 已知限制：`create_appointment` 仍未檢查 `business_hours`，繞過前端仍可能在週固定
  公休日或非營業時段訂到位——TASK-062 追蹤。
- 後續任務：[TASK-062](TASK-062.md)（`create_appointment` 加入 `business_hours` 檢查，
  architect／security-reviewer 於本卡總覽審查一致提出，草稿狀態，需先走
  spec-interrogation 決定範圍才算 AI-ready）。
