# AI-Ready 任務卡

## Metadata

- 任務：營業時間與可預約時段管理 `get_available_slots` RPC 與後台改期表單加入公休日／緩衝時間邏輯
- 上層規格：[`feature-spec.md`](../feature-spec.md)（第二批次）
- 上層 Epic：營業時間與可預約時段管理
- 上層 User Story：設定公休日／特殊假期、設定服務間的緩衝時間（兩個 story 對「可預約時段
  計算」的異動綁在同一支函式／同一張卡處理，避免兩張卡各自修改同一支 RPC 產生職責重疊）
- 分軌：後端
- 前置任務（dependsOn）：TASK-022
- 狀態：完成（2026-08-07 人工核准）
- 風險等級：高（修改 `get_available_slots`——顧客端唯一的可預約時段來源，全站最關鍵的
  RPC；任何邏輯錯誤會直接影響顧客能不能正常預約，需要架構、安全性、測試三方審查）

## 目標

修改 `supabase/migrations` 新增一支 migration，`create or replace` `get_available_slots`
RPC，加入：(1) `closed_dates` 命中即回傳空陣列（優先於 `business_hours`）；(2) 緩衝時間
感知的時段過濾（候選時段與既有預約之間，扣掉各自服務的 `buffer_minutes` 後仍不可重疊）。
同步修改後台改期表單（`lib/admin/reschedule-slots.ts`）套用同一套規則，確保顧客端與後台
改期兩處的可預約時段定義一致（沿用既有「兩處查同一套邏輯」的既有决策）。

## 情境包（Context Pack）

- 相關檔案：
  - `supabase/migrations/0002_booking_flow.sql` 第 69-148 行：`get_available_slots` 現行
    完整定義，本卡要修改的目標函式。
  - `lib/admin/reschedule-slots.ts`：`computeAvailableSlots`（純函式）、
    `getOccupiedRangesForDate`、`getBusinessHoursForWeekday`——本卡要擴充的三個既有匯出。
  - `lib/admin/appointments.ts` 第 12-109 行：`WeekAppointment`／`AppointmentDetail`
    型別、`RawService`、`flattenService`、`getAppointmentsForWeek`、
    `getAppointmentDetail`——`duration_minutes` 目前透過 `services(name, duration_minutes)`
    embedded select 取得，本卡要在同樣的 select 與型別里加上 `buffer_minutes`。
  - `app/admin/_components/AppointmentDetailDialog.tsx` 第 25、115-145 行：改期表單呼叫
    `computeAvailableSlots`／`getBusinessHoursForWeekday`／`getOccupiedRangesForDate` 的
    現行邏輯，本卡要在這裡加上 `closed_dates` 檢查與 `bufferMinutes` 參數傳遞。
  - `lib/admin/closed-dates.ts`（TASK-022 產出）：`isDateClosed(supabase, date)` 供改期
    表單使用。
- 既有模式：`get_available_slots` 與 `computeAvailableSlots` 是「同一套邏輯的兩份實作」
  （資料庫 SQL 版給顧客端 RPC 用、TypeScript 版給後台改期表單用，因為改期表單是
  `authenticated` 角色呼叫，該 RPC 只 grant execute 給 `anon`，見既有註解），本卡必須
  兩處都改、且語意保持一致，不能只改其中一處。
- 假設：
  - 緩衝時間的「效力區間」定義為 `[start_at, end_at + buffer_minutes)`——每筆預約用它
    自己所屬服務的 `buffer_minutes` 延伸自己的佔用區間，候選時段同樣用「即將預約的服務」
    的 `buffer_minutes` 延伸自己的佔用區間，兩個效力區間做標準區間重疊判斷（`start_a <
    end_b and start_b < end_a`）。這個對稱設計同時處理「候選時段排在既有預約之後，要留出
    既有預約的緩衝」與「候選時段排在既有預約之前，候選本身的緩衝不能延伸進既有預約」兩種
    方向，見下方「實作備註」的完整 SQL 邏輯。
  - `closed_dates` 的檢查優先於 `business_hours`（見 feature-spec 功能需求），實作順序上
    放在查 `business_hours` 之前或之後皆可（兩者殿都導向回傳空陣列，順序不影響正確性），
    但為了程式碼可讀性、對應「優先權」的語意，本卡統一放在查 `business_hours` 之前。
  - `create_appointment` RPC（顧客端實際建立預約）**不需要修改**——它本來就只依賴
    `get_available_slots` 呈現的時段清單讓顧客挑選，實際寫入時只受 `appointments_no_overlap`
    exclusion constraint 保護（原始起訖時間不重疊），不需要知道緩衝時間或公休日的存在，
    這是 feature-spec 非目標已記錄的既知取捨（緩衝時間不做資料庫層級約束）。
- 未知事項：無。
- 允許變更的檔案：
  - `supabase/migrations/0004_slots_closures_buffer.sql`（新增）
  - `supabase/migrations/0004_slots_closures_buffer_down.sql`（新增）
  - `lib/admin/reschedule-slots.ts`（擴充）
  - `lib/admin/appointments.ts`（`RawService`／`WeekAppointment`／兩個 select 語句加
    `buffer_minutes`）
  - `app/admin/_components/AppointmentDetailDialog.tsx`（傳遞 `closed_dates`／
    `bufferMinutes` 給 `computeAvailableSlots`）
  - `tests/admin/reschedule-slots.test.ts`（擴充既有測試檔）
- 不得觸碰：`closed_dates`／`services.buffer_minutes` 的 schema（TASK-022 已建立，本卡只
  讀取使用）、`create_appointment` RPC（見上方假設，不需要修改）、
  `app/admin/business-hours/`（設定頁 UI 是 TASK-025 範圍）、`WeekCalendar.tsx`／
  `AdminDashboard.tsx`（TASK-026 範圍）。

## 需求

- `supabase/migrations/0004_slots_closures_buffer.sql`：`create or replace function
  public.get_available_slots(p_service_id uuid, p_date date) returns jsonb ...`，在現行
  定義基礎上：
  - `declare` 區塊新增 `v_buffer_minutes int;`。
  - 查詢服務時一併取得 buffer：`select duration_minutes, is_active, buffer_minutes into
    v_duration_minutes, v_is_active, v_buffer_minutes from public.services where id =
    p_service_id;`
  - 在查詢 `business_hours` **之前**新增：
    ```sql
    if exists (select 1 from public.closed_dates where date = p_date) then
      return jsonb_build_object('ok', true, 'data', '[]'::jsonb);
    end if;
    ```
  - 迴圈內的重疊判斷子查詢改為（join `services` 取得每筆既有預約自己的 buffer，兩邊都用
    `make_interval(mins => ...)` 延伸各自的區間再比較）：
    ```sql
    if v_slot_start > now() + interval '1 hour'
       and not exists (
         select 1
         from public.appointments a
         join public.services s2 on s2.id = a.service_id
         where a.status in ('pending', 'confirmed', 'completed')
           and tstzrange(a.start_at, a.end_at + make_interval(mins => s2.buffer_minutes), '[)')
               && tstzrange(v_slot_start, v_slot_end + make_interval(mins => v_buffer_minutes), '[)')
       )
    then
      ...（原本組 v_slots 的邏輯不變）
    end if;
    ```
  - 其餘（90 天視野、提前 1 小時、30 分鐘步進、`exception when others`）維持不變。
  - 對應 down migration：`create or replace function` 還原成 0002 版本的原始定義（把
    `closed_dates` 檢查與 buffer join 拿掉），或最簡單直接 `drop function` 讓下一次
    forward migration 重建——比照既有 down migration 風格判斷取捨，寫檔頭註解說明選擇。
- `lib/admin/reschedule-slots.ts`：
  - `OccupiedRange` 型別新增 `buffer_minutes: number` 欄位。
  - `getOccupiedRangesForDate` 的 `.select(...)` 改成
    `"start_at, end_at, services(buffer_minutes)"`，回傳時攤平 `services.buffer_minutes`
    到 `buffer_minutes`（`services` 可能是物件或陣列，比照 `lib/admin/appointments.ts` 的
    `flattenService` 既有攤平模式處理，或內聯處理皆可，取決於是否要重用該函式——若要重用，
    需要從 `appointments.ts` export 出來，import 進來；若覺得為了一個小工具函式增加跨檔案
    耦合不划算，也可以在本檔案內寫一個等價的最小版本，兩種做法皆可接受，由實作時判斷）。
  - `computeAvailableSlots` 新增兩個必填參數：`bufferMinutes: number`（即將預約的服務自己
    的緩衝）、`isClosedDate: boolean`。函式開頭 `if (isClosedDate) return [];`（放在既有
    `businessHours` 檢查之前）。迴圈內：
    - `occupied` 的 `end` 計算改為 `new Date(range.end_at).getTime() + range.buffer_minutes
      * 60_000`。
    - candidate 的 `effectiveEnd = end + bufferMinutes * 60_000`，重疊判斷改用
      `start < range.end && effectiveEnd > range.start`（`range.end` 已經是加上緩衝後的
      值）。
- `lib/admin/appointments.ts`：
  - `RawService` 型別新增 `buffer_minutes: number`。
  - `flattenService` 的預設值物件新增 `buffer_minutes: 0`。
  - `WeekAppointment` 型別新增 `buffer_minutes: number`。
  - `getAppointmentsForWeek`／`getAppointmentDetail` 的 `.select(...)` 都改成
    `"...services(name, duration_minutes, buffer_minutes)"`，回傳物件都補上
    `buffer_minutes: service.buffer_minutes`。
- `app/admin/_components/AppointmentDetailDialog.tsx`：
  - 改期表單的 `useEffect`（第 119-145 行附近）新增呼叫 `isDateClosed(supabase,
    rescheduleDate)`（`isDateClosed` 從 `@/lib/admin/closed-dates` import），與既有的
    `getBusinessHoursForWeekday`／`getOccupiedRangesForDate` 一起 `Promise.all`。
  - 呼叫 `computeAvailableSlots` 時多傳 `bufferMinutes: detail?.buffer_minutes ??
    appointment?.buffer_minutes ?? 0` 與 `isClosedDate: closedRes.data`（比照現有
    `durationMinutes` 的既有 fallback 寫法）。

## 驗收標準

- `get_available_slots` 對已標記 `closed_dates` 的日期回傳空陣列，不論該日期原本的
  `business_hours` 設定為何。
- `get_available_slots` 對有 `buffer_minutes` 設定的服務，正確排除「與既有預約間隔小於
  緩衝時間」的候選時段；`buffer_minutes` 為 0 的服務行為與修改前完全一致（回歸安全網）。
- 後台改期表單（`computeAvailableSlots`）與 RPC 對同一組輸入產生一致的可預約時段判斷
  （由 TASK-027 的整合測試交叉驗證）。
- 既有測試（`test:booking`／`test:admin-booking`／`test:business-hours`）重跑無回歸
  （`buffer_minutes` 預設 0 時，既有測試建立的服務行為不變）。
- `npx tsc --noEmit`／`npm run lint`／`npm run build`／`npm test` 皆通過。

## 實作備註

- 這是本批次風險最高的一張卡，任何 SQL 邏輯錯誤都可能讓顧客端完全看不到可預約時段、或
  誤判本該衝突的時段為可預約。實作完成後除了本卡自己的驗證契約，**強烈建議**在
  TASK-027 之前先手動用一組簡單案例（`buffer_minutes = 30` 的服務、兩筆間隔剛好 30 分鐘的
  既有預約）人工核對 RPC 回傳結果，不要只依賴自動化測試。
- `tstzrange` 的重疊運算子 `&&` 已經是 `appointments_no_overlap` exclusion constraint
  與既有 `get_available_slots` 都在用的既有寫法（見 `ai/context/decisions.md`
  「TASK-010：時段衝突用 exclusion constraint」決策），本卡延續同一套語意工具，不要另外
  發明新的重疊判斷方式。
- `make_interval(mins => 0)` 會產生零長度 interval，`buffer_minutes = 0` 時
  `a.end_at + make_interval(mins => 0)` 等於 `a.end_at`，行為自動退化成修改前的原始邏輯，
  不需要額外的 `if buffer_minutes > 0` 分支判斷——這是驗收標準「buffer_minutes 為 0 時行為
  完全一致」成立的關鍵，實作時不要畫蛇添足加條件分支。

## 驗證契約

- 單元測試：`tests/admin/reschedule-slots.test.ts` 擴充：`computeAvailableSlots` 新增
  `bufferMinutes > 0` 時正確排除間隔不足時段的案例、`isClosedDate: true` 時回傳空陣列的
  案例、`bufferMinutes: 0` 與修改前行為一致的既有案例需全數保留通過（回歸安全網）。
- 整合測試：不適用（本卡不新增整合測試檔案，`get_available_slots` RPC 的公休日／緩衝時間
  行為由 TASK-027 在 `tests/business-hours.integration.test.ts` 統一擴充驗證，理由：需要
  `closed_dates`／`services.buffer_minutes` 皆已存在且與 TASK-022 的測試慣例一致，集中在
  一張卡處理，避免測試檔案分散）。
- E2E 測試：不適用（無 UI 變更，改期表單既有 UI 不變，只有背後的可預約時段計算邏輯不同）。
- 型別檢查：`tsc --noEmit` 成功。
- Lint：`npm run lint` 成功。
- Build：`npm run build` 成功。
- 螢幕截圖：不適用。
- 安全性檢查：`get_available_slots` 維持 `security definer`／`set search_path = ''`／只
  `grant execute` 給 `anon` 的既有邊界不變；回傳值形狀不變（`AvailableSlot[]`，只有
  `start_at`/`end_at`，不外洩服務或預約的其他欄位）。

## 完成證據

- 變更的檔案：
  - `supabase/migrations/0004_slots_closures_buffer.sql`（新增）
  - `supabase/migrations/0004_slots_closures_buffer_down.sql`（新增）
  - `lib/admin/reschedule-slots.ts`（擴充）
  - `lib/admin/appointments.ts`（擴充）
  - `app/admin/_components/AppointmentDetailDialog.tsx`（擴充）
  - `tests/admin/reschedule-slots.test.ts`（擴充）
- 執行過的指令：`npx tsc --noEmit`、`npm run lint`、`npm test`、`npm run build`；`npm run
  test:booking`、`npm run test:admin-booking`、`npm run test:business-hours`（真實
  Supabase 專案整合測試，人工已將 0003／0004 兩支 migration 貼到 SQL Editor 執行後重跑）。
- 測試輸出：
  - 本機單元測試：12 個測試檔、88 個測試全數通過（含 `tests/admin/reschedule-slots.test.ts`
    擴充後的 11 個案例）。
  - 真實 Supabase 整合測試：`test:booking` 19/19、`test:admin-booking` 13/13、
    `test:business-hours` 7/7，皆通過，無回歸。
  - 人工核對 `get_available_slots` RPC（比照實作備註的強烈建議）：一次性腳本（未提交進
    repo，存放於 session scratchpad）用 service_role 建立暫時服務（duration=60,
    buffer=30）與一筆既有預約（12:00–13:00），呼叫 RPC 驗證 6 個邊界時段（10:00／10:30
    保留、11:00／12:00／13:00 排除、13:30 剛好卡在緩衝邊界上保留）與 `closed_dates` 命中
    後回傳空陣列，全部通過；測試資料已清除。
- 螢幕截圖：不適用（無 UI 變更）。
- 子代理審查：architect／security-reviewer／test-engineer 三方皆審查過（風險等級高，任務卡
  明訂需要三方審查）。發現並已修正：
  - 改期表單選到公休日時，`buildSlotGrid` 不知道 `closed_dates` 的存在，會渲染出一整排
    disabled 但無說明的按鈕；已改成 `closedRes.data` 為 true 時直接給空格點陣列，落回既有
    「當日公休或已無可預約時段」提示（architect 發現）。
  - RPC 與後台 TS 版 `computeAvailableSlots` 在緩衝時間跨日的查詢範圍不一致
    （`getOccupiedRangesForDate` 原本只查當天，RPC 沒有日期上限）；已將查詢下界往前擴大
    一天（buffer_minutes 上限 120 分鐘遠小於一天）（architect 與 security-reviewer 各自
    獨立發現同一問題）。
  - 緩衝時間感知的重疊比對子查詢加了 `join services` 後不再匹配
    `appointments_no_overlap` 索引運算式，且沒有任何 `start_at` 範圍限定，導致這支
    anon 可呼叫、無 rate limit 的 RPC 從可用索引退化成全表掃描（security-reviewer 發現，
    列為中等嚴重度）；已補上 `a.start_at` 的 ±1 天範圍限定，讓 planner 能改用
    `appointments_start_at_idx`。
  - migration 套用順序沒有保護：若 0004 在 0003 之前套用，函式會建立成功但每次呼叫都在
    執行期出錯（被吞成籠統 INTERNAL_ERROR）；已在 0004 開頭加上部署期前置檢查，順序錯誤
    會在套用當下就失敗（architect 與 security-reviewer 各自獨立發現同一問題）。
  - `closed_dates.date = p_date` 的欄位參照未限定 schema/table，已改為
    `closed_dates.date = p_date` 明確限定（security-reviewer 發現，資訊性）。
  - 測試缺口：`tests/admin/reschedule-slots.test.ts` 原本沒有涵蓋「效力區間恰好相等於
    邊界」「既有預約與候選時段緩衝時間皆非 0 且數值不同」「多筆既有預約各自帶不同
    buffer_minutes」三種情況；已各補一個測試案例（architect 與 test-engineer 分別發現
    邊界測試缺口，test-engineer 額外發現後兩項）。
  - test-engineer 指出一次性人工核對腳本跑完即刪除，不是可重複檢查的產物；已在上方「測試
    輸出」段落完整記錄執行結果與驗證方法，腳本本身保留在 session scratchpad（未提交進
    repo，因任務卡「允許變更的檔案」清單未列出新增整合測試檔案，正式的可重複整合測試
    覆蓋留給 TASK-027，已記錄為已知限制）。
  - security-reviewer 指出 `create_appointment` 完全不檢查 `closed_dates`，公休日目前只在
    `get_available_slots` 的顯示層被擋下，繞過前端直接呼叫 API 理論上仍可在公休日訂到位；
    任務卡明確排除修改 `create_appointment`（見上方「假設」段落），修正超出本卡範圍。已與
    人工核准者確認，開立 TASK-028 處理（見下方「後續任務」）。
- 已知限制：
  - `create_appointment` 尚未檢查 `closed_dates`（見上方，TASK-028 處理）。
  - 一次性人工核對 RPC 邊界行為的腳本未提交進 repo（見上方「測試輸出」），正式可重複的
    整合測試覆蓋（`closed_dates`／`buffer_minutes` 對 `get_available_slots` 的行為）留給
    TASK-027 統一擴充 `tests/business-hours.integration.test.ts`。
  - `feature-spec.md` 第 115 行「間隔不小於前一筆預約所屬服務的緩衝時間」的措辭只描述單向
    情境，實作是對稱設計（候選時段自己的緩衝也會擋住排在既有預約之前的格子），任務卡本身
    已論證此設計的正確性；TASK-027 撰寫交叉驗證斷言時應以任務卡的對稱設計為準，不要照
    feature-spec 較舊的單向措辭編寫較寬鬆的預期值（architect 發現，資訊性）。
- 後續任務：TASK-027（整合驗證）依賴本卡；TASK-028（`create_appointment` 加入
  `closed_dates` 檢查，已核准開立，見上方 security-reviewer 發現）。
