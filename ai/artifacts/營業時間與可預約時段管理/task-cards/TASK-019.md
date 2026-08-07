# AI-Ready 任務卡

## Metadata

- 任務：營業時間與可預約時段管理 編輯、驗證與儲存（含受影響預約警告）
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：營業時間與可預約時段管理
- 上層 User Story：設定每週固定營業時間
- 分軌：前端
- 前置任務（dependsOn）：TASK-018
- 狀態：完成。security-reviewer 與 architect 審查皆已核准（含審查後修正）
- 風險等級：中（涉及 `business_hours` 的實際資料寫入，且會影響顧客端可預約時段判定；
  沿用既有 `is_admin()` RLS 邊界，不新增 anon 可觸及的寫入介面，但屬於本 Epic 第一次讓
  authenticated 角色寫入 `business_hours`，需要重新確認邊界未被意外放寬）
- Agent owner：Claude Code
- 人工核准者：使用者，2026-08-06（指名要求「繼續做 TASK-019」，視為核准開始實作）

## 目標

把 TASK-018 建立的唯讀表格接上實際編輯能力：公休切換、開店/打烊時間編輯、前端驗證、送出
儲存，並在送出前偵測受影響的既有預約、顯示警告清單，需二次確認才真正寫入。

## 情境包（Context Pack）

- 相關檔案：
  - `lib/admin/business-hours.ts`（TASK-018 已建立 `getAllBusinessHours`／
    `BusinessHoursRow`，本卡擴充 `updateBusinessHours`／`findAffectedAppointments`／驗證
    純函式）
  - `app/admin/_components/BusinessHoursForm.tsx`（TASK-018 已建立唯讀版本，本卡移除
    `disabled`、接上 state 管理與送出邏輯）
  - `components/ui/ConfirmDialog.tsx`（既有二次確認元件，目前只接受純文字
    `description`；本卡需要顯示一份可捲動的受影響預約清單，優先嘗試在 `ConfirmDialog`
    加一個可選的 `children?: React.ReactNode` prop，在 `description` 下方渲染——沿用同一個
    元件比另建一個幾乎一樣的 Dialog 更省維護成本。若擴充後既有呼叫方（`components/ui/`
    以外目前唯一用到 `ConfirmDialog` 的地方是 `AppointmentDetailDialog.tsx` 的取消預約
    流程）的型別/行為受到非預期影響，允許改為新建一個小型元件，但要在完成證據裡記錄為何
    不重用）
  - `lib/admin/appointments.ts` 的 `rescheduleAppointment()`（`RescheduleErrorCode`／
    `RescheduleResult` 的錯誤處理「形狀」慣例：資料庫層錯誤一律轉成前端好用的錯誤碼，
    不外洩原始 Postgres 錯誤內容，本卡的 `updateBusinessHours` 沿用同樣的風格）
  - `lib/admin/reschedule-slots.ts` 的 `computeAvailableSlots()`（純函式設計慣例：資料查詢
    與純邏輯分離，方便單元測試，本卡的「判斷某筆預約是否落在新營業時間之外」邏輯採用同樣
    的拆法）
  - `supabase/migrations/0002_booking_flow.sql` 的 `business_hours_valid_range` check
    constraint（`is_closed` 或 `open_time`／`close_time` 皆非空且 `close_time > open_time`，
    前端驗證要先擋下違反這個 constraint 的送出，讓使用者不會看到原始 Postgres 錯誤）
  - [`business-hours-variant-a.html`](../mockups/business-hours-variant-a.html)（已核准的
    版型參考，畫面 2「送出→受影響預約警告」）
- 既有模式：`rescheduleAppointment` 的錯誤碼轉換模式（`{code, message}` 形狀）；
  `AppointmentDetailDialog.tsx` 的取消預約二次確認流程（開啟 `ConfirmDialog`→使用者確認→
  才真正呼叫寫入函式→成功關閉並 Toast、失敗顯示錯誤且不關閉）。
- 假設：
  - 受影響預約的判定範圍是「所有 `status in (pending, confirmed, completed)` 且
    `start_at` 在未來（`> now()`）的預約」，不額外加日期上限——本專案是單一設計師的小型
    系統，資料量不會大到需要分頁或限制查詢範圍（比照 `getOccupiedRangesForDate` 沒有加
    分頁的既有取捨）。
  - `updateBusinessHours` 一次送出全部 7 列（`upsert` by `weekday`，比照
    `scripts/seed-booking-data.mjs` 的既有 upsert 寫法），不做「只送出有變更的列」的差異化
    最佳化——7 列的寫入成本可忽略，做差異化只會增加程式碼複雜度。
  - 「再想想」關閉警告 Modal 後，表單欄位維持使用者目前編輯的內容，不重置回原始值（沿用
    `AppointmentDetailDialog.tsx` 改期表單「送出失敗不清空表單」的既有體驗）。
- 未知事項：無。
- 允許變更的檔案：`lib/admin/business-hours.ts`（擴充）、
  `app/admin/_components/BusinessHoursForm.tsx`（擴充，移除唯讀限制、接上編輯與送出）、
  `components/ui/ConfirmDialog.tsx`（視情況擴充 `children` prop，見上方情境包說明；若改走
  新建元件則改為新增 `components/ui/` 底下的檔案）、`tests/admin/business-hours.test.ts`
  （擴充）。
- 不得觸碰：`lib/admin/week-range.ts`／`app/admin/_components/WeekCalendar.tsx`（TASK-020
  範圍）；`app/admin/business-hours/page.tsx` 的 Server Component 認證邏輯（TASK-018 已完成，
  本卡不需要也不應該修改）。

## 需求

- `lib/admin/business-hours.ts` 新增：
  - `validateBusinessHoursRow(row): string | null`：純函式，`is_closed=true` 時一律合法
    （回傳 `null`）；`is_closed=false` 時要求 `open_time`／`close_time` 皆非空且
    `close_time > open_time`，否則回傳對應的錯誤文案。
  - `updateBusinessHours(supabase, rows: BusinessHoursRow[]): Promise<Result<void>>`：
    authenticated 直接對 `business_hours` 做 `upsert`（`onConflict: "weekday"`），沿用
    `Result<T>` 形狀，失敗回傳泛用 `INTERNAL_ERROR`（不外洩 constraint 名稱等原始錯誤）。
  - `type AffectedAppointment = { id: string; customer_name: string; start_at: string }`。
  - `isAppointmentOutsideHours(startAt: string, endAt: string, hours: BusinessHoursRow |
    undefined): boolean`：純函式，`hours` 不存在或 `is_closed=true` 或
    `open_time`／`close_time` 為空一律回傳 `true`（落在營業時間外）；否則比較
    `[startAt, endAt)` 是否完整落在 `[open_time, close_time)` 內，不在則回傳 `true`。
  - `findAffectedAppointments(supabase, newRows: BusinessHoursRow[]): Promise<Result<
    AffectedAppointment[]>>`：查詢所有 `status in (pending,confirmed,completed)` 且
    `start_at > now()` 的預約，依 `start_at` 換算 Asia/Taipei weekday 後，用
    `isAppointmentOutsideHours` 對照 `newRows` 裡對應 weekday 的新設定，回傳落在新設定外的
    預約清單（含 `id`／`customer_name`／`start_at`，不含電話等其他個資，資料最小化，
    比照 `getAppointmentsForWeek` 不下載非必要欄位的既有慣例）。
- `BusinessHoursForm.tsx`：
  - 移除 TASK-018 的 `disabled`，`Switch` 與時間欄位改為可編輯的 controlled state。
  - 切換公休開啟：清空並鎖定該列的時間欄位；切換公休關閉：解鎖時間欄位（維持上次的值或
    留空，由使用者重新填寫）。
  - 即時前端驗證：欄位失焦或送出時用 `validateBusinessHoursRow` 檢查，不合法的列顯示行內
    錯誤文案（比照 mockup 的 `row-error` 樣式）。
  - 送出「儲存變更」：先逐列跑 `validateBusinessHoursRow`，任何一列不合法就擋下送出並捲動
    /聚焦到第一個錯誤列；全部合法才呼叫 `findAffectedAppointments`。
    - 若回傳空陣列：直接呼叫 `updateBusinessHours`，成功後顯示成功 Toast 並重新讀取畫面。
    - 若回傳非空：開啟警告 Dialog，列出受影響預約（日期／時段／顧客姓名，日期時段需格式化
      成使用者看得懂的顯示格式，比照既有 `formatTimeRange`／週次相關的格式化慣例）；
      「仍要儲存」才真正呼叫 `updateBusinessHours`；「再想想」關閉 Dialog、不送出。
  - 呼叫 `updateBusinessHours` 失敗：顯示通用錯誤 Toast，不外洩原始錯誤內容，表單維持使用者
    輸入內容。

## 驗收標準

- 可以編輯任一天的開店/打烊時間，打烊時間未晚於開店時間時前端擋下送出並顯示錯誤，不會
  產生違反資料庫 constraint 的請求。
- 可以把某天切換為公休（時間欄位清空鎖定）、或把公休切回營業（需重新填入合法時間才能
  送出）。
- 送出的變更若會讓未來已存在的預約（`pending`/`confirmed`/`completed`）落在新營業時間之外
  （含新設為公休整天），顯示警告清單並需二次確認；沒有受影響預約時直接儲存成功。
- 「再想想」不會送出任何變更；「仍要儲存」會真正寫入並在成功後顯示 Toast、畫面反映新資料。
- anon 無法直接寫入 `business_hours`（RLS 拒絕，沿用既有 policy）。
- `npx tsc --noEmit`／`npm run lint`／`npm run build`／`npm test` 皆通過。

## 實作備註

- `findAffectedAppointments` 傳入的是「使用者尚未送出的新設定」（表單目前的 state），不是
  資料庫裡已經儲存的值——判斷「會不會受影響」要用使用者正在儲存的新值去比對既有預約，不是
  比對舊值。
- `isAppointmentOutsideHours` 的時間比較要轉成同一個時區（Asia/Taipei）的 time-of-day 再
  比較，不要直接比較 UTC ISO 字串的時分——比照專案既有的 Taipei 時區處理慣例
  （`lib/admin/week-range.ts`／`lib/admin/reschedule-slots.ts` 已有类似轉換邏輯可參考）。

## 驗證契約

- 單元測試：`validateBusinessHoursRow`（合法/不合法各種組合）、`isAppointmentOutsideHours`
  （公休/開店時間外/打烊時間外/合法時段各案例）、`updateBusinessHours`／
  `findAffectedAppointments` 的 RLS 阻擋判定與資料轉換（mock Supabase client，比照
  `tests/admin/appointments.test.ts` 既有寫法）。
- 整合測試：不適用（正式的 authenticated 寫入／anon 拒絕整合驗證留給 TASK-021）。
- E2E 測試：不適用（涵蓋在 TASK-021）。
- 型別檢查：`tsc --noEmit` 成功。
- Lint：`npm run lint` 成功。
- Build：`npm run build` 成功。
- 螢幕截圖：桌面尺寸截圖編輯中、驗證錯誤、送出中、受影響預約警告、儲存成功。
- 安全性檢查：確認 `updateBusinessHours` 只能由 `is_admin()` 角色執行；確認錯誤訊息不洩漏
  原始 Postgres 錯誤內容（constraint 名稱等內部細節）；確認受影響預約清單不包含電話等
  非必要個資。

## 完成證據

- 變更的檔案：
  - 修改：`lib/admin/business-hours.ts`（新增 `BusinessHoursInput`、
    `validateBusinessHoursRow`、`updateBusinessHours`、`isAppointmentOutsideHours`、
    `findAffectedAppointments`）、`app/admin/_components/BusinessHoursForm.tsx`（接上
    編輯、驗證、送出、受影響預約警告）、`components/ui/ConfirmDialog.tsx`（新增可選
    `children` prop）、`ai/context/design-system.md`（Modal/Dialog 元件列補充
    `children` 插槽說明）、`tests/admin/business-hours.test.ts`（擴充）。
- 執行過的指令（皆為審查修正後的最終結果）：
  - `npx tsc --noEmit` → 無錯誤。
  - `npm run lint` → 0 problems。
  - `npx vitest run` → 11 files / 75 tests passed（`tests/admin/business-hours.test.ts`
    擴充至 19 tests）。
  - `npm run build` → 編譯成功。
  - 瀏覽器（Browser 工具）對真實 Supabase 專案手動走查：
    1. 打烊時間未晚於開店時間 → 行內錯誤顯示、送出被擋、focus 正確跳到第一個錯誤列。
    2. 修正後送出、無受影響預約 → 直接寫入成功，重新整理頁面確認資料已持久化。
    3. 透過顧客前台建立一筆測試預約（8/12 週三 10:00），把週三開店時間改成 12:00 送出
       → 正確顯示受影響預約警告（含姓名、日期時段）；「再想想」關閉 Dialog 後重新整理
       確認資料庫完全未變動；重新編輯、改按「仍要儲存」後重新整理確認資料已正確寫入。
    4. 把週五切換為公休（無關聯預約）送出 → 因為既有的週三衝突預約仍存在，警告 Dialog
       仍會出現（驗證邏輯正確：每次送出都用「新設定」重新掃描全部未來預約，不只看
       這次變更的欄位），確認送出後週五公休狀態正確持久化。
    5. 公休切換：開啟時時間欄位清空並鎖定；關閉時解鎖但不預填、需重新輸入。
    6. 觸控性驗證審查修正後的行為：把公休切回營業的當下不會立即顯示錯誤，欄位失焦後
       才顯示（驗證「touched」邏輯生效）；未點擊「儲存變更」直接重新整理頁面，未儲存的
       編輯確實被捨棄，不會意外寫入。
    7. 驗證完成後清除所有測試預約、把 `business_hours` 還原成 seed 預設值（週一至週六
       10:00–19:00、週日公休）。
- 審查發現（比照 TASK-016/018 的審查模式，對本卡新增的寫入路徑跑 architect／
  security-reviewer 審查）：
  - **architect 審查：核准（1 項必要修復＋數項次要建議，已全部處理）**：必要修復：
    `handleSubmit` 原本在「查詢受影響預約」結束後就把 `submitting` 設回 `false`，實際
    `updateBusinessHours` 寫入期間按鈕已恢復可點擊、欄位恢復可編輯，可能被連點觸發第二次
    並行寫入，或使用者在寫入進行中繼續編輯卻被隨後的 `loadRows()` 悄悄蓋掉——已改用
    `try/finally` 讓 `submitting` 涵蓋整個送出流程直到寫入完成。次要建議已處理：
    `handleConfirmSaveWithWarning` 原本無條件關閉警告 Dialog，與
    `AdminDashboard.tsx` 既有的「失敗不關閉 Dialog」慣例不一致——已改成只有
    `doSave` 回傳成功才關閉；行內錯誤原本一改就立即顯示（例如公休切回營業的當下，
    時間欄位還沒填就先跳錯誤）——已加上「欄位失焦過或已嘗試送出過」的 `touched` 狀態
    才顯示；`updateRow` 對缺列的 weekday 靜默 no-op——已在 `toEditableRows` 保底把
    `DISPLAY_WEEKDAYS` 七天都建成列（缺列時預設公休）；比照 TASK-010 記錄的「RLS 阻擋
    UPDATE 回傳成功但空結果」既知行為，`updateBusinessHours` 原本只看 `error` 是否為
    `null`——已加上 `.select("weekday")` 並檢查受影響列數是否等於送出列數，避免權限
    設定若有誤時畫面誤報「已更新」。核准 upsert-all-7、無逐列 diff、
    `findAffectedAppointments` 每次都重新掃描全部未來預約（不只看本次變更的欄位）這幾項
    簡化設計，判定為符合本網域（單一設計師、7 列設定表）的合理取捨，不需要比照
    `rescheduleAppointment` 的樂觀鎖模式（那是因為預約有多方寫入者，`business_hours`
    沒有）。確認 `ConfirmDialog` 的 `children` 擴充向下相容，`AdminDashboard.tsx` 既有的
    取消預約確認流程不受影響。
  - **security-reviewer 審查：核准（2 項低嚴重度建議，已處理）**：確認
    `business_hours` 寫入 RLS 邊界正確（`"admin full access to business hours"`
    policy，anon 無寫入 policy）、`is_admin()` 的 layout 檢查只是 UI 層防呆而非唯一防線、
    `findAffectedAppointments` 沿用與其他預約讀取相同的 RLS、`AffectedAppointment` 只含
    `id`／`customer_name`／`start_at`（無電話等額外個資）、錯誤處理不外洩原始 Postgres
    錯誤、無注入面、`ConfirmDialog` 的 `children` 由 React 正常轉義無 XSS 風險。已處理的
    建議：`findAffectedAppointments` 原本查詢無上界，理論上會把所有未來預約（含姓名）
    整批下載到瀏覽器——已加上 90 天視野上限（比照顧客端 `create_appointment` RPC 的既有
    上限）與 200 筆數上限；`isAppointmentOutsideHours` 的時間比較用 `hour12:false` 在部分
    ICU 實作上午夜可能被算成 `"24:00"` 而非 `"00:00"`——已改用 `hourCycle:"h23"` 明確指定
    0-23 小時制。
- 已知限制：
  1. `findAffectedAppointments` 每次送出都會列出「所有」仍落在新設定外的未來預約，
     不只是本次變更直接造成的——這是刻意設計（警告文案「將落在新的營業時間之外」本來就
     是描述最終狀態，不是描述本次差異），但若先前已經有預約因為某次編輯變成受影響、
     一直沒被設計師處理，之後任何一次儲存都會重複看到同一筆警告，直到該預約被改期/取消
     或營業時間改回涵蓋它為止。
  2. `business_hours` 沒有樂觀鎖或版本欄位；架構審查判定為此網域（單一設計師、7 列設定
     表）的合理取捨，若未來這個 Epic 擴充成多人協作後台，需要重新評估。
  3. 螢幕截圖：沿用既有 Browser pane 限制，改以 accessibility tree／`get_page_text`／
     `javascript_tool` 讀取（僅用於讀取驗證，未用於實作互動）取得驗證證據。
- 後續任務：TASK-021（整合驗證）。
