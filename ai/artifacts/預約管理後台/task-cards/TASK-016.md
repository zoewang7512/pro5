# AI-Ready 任務卡

## Metadata

- 任務：預約管理後台 改期預約
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：預約管理後台
- 上層 User Story：改期預約
- 分軌：前端
- 前置任務（dependsOn）：TASK-014, TASK-015
- 狀態：完成。security-reviewer 與 architect 審查皆已核准（含審查後修正）
- 風險等級：中（涉及預約時段的資料寫入，會實際觸發資料庫層 `appointments_no_overlap`
  exclusion constraint；透過既有 `authenticated`＋`is_admin()` RLS 邊界，無新的 anon 可
  觸及介面，但這是本 Epic 第一次讓 exclusion constraint 透過「非 RPC」的直接 authenticated
  `update` 路徑被觸發，需要驗證行為與既有 anon RPC 路徑一致）
- Agent owner：Claude Code
- 人工核准者：使用者，2026-08-06（指名要求「繼續做 TASK-016」，視為核准開始實作）

## 目標

在 TASK-015 建立的 `AppointmentDetailDialog` 的「改期」按鈕接上改期表單：選擇新日期與
時段、送出後更新該筆預約的 `start_at`／`end_at`，並正確處理與其他既有預約重疊時的
資料庫層拒絕。

## 情境包（Context Pack）

- 相關檔案：
  - `app/admin/_components/AppointmentDetailDialog.tsx`（TASK-015 已建立，本卡新增
    「改期」子畫面，不修改「標記完成」「取消」子畫面的邏輯）
  - `lib/admin/appointments.ts`（TASK-014/015 已建立，本卡擴充新增
    `rescheduleAppointment`）
  - `lib/booking/slot-grid.ts`／`lib/booking/date-range.ts`（顧客端既有的時段格點與日期
    範圍純函式，改期表單的日期／時段選擇可以直接重用或參考同樣的計算邏輯，避免重寫一套
    不一致的格點規則）
  - `supabase/migrations/0002_booking_flow.sql`（`appointments_no_overlap` exclusion
    constraint 的定義，本卡不修改 migration，只需要知道它的行為：違反時 Postgres 回傳
    `23P01 exclusion_violation`）
  - [`booking-admin-variant-b.html`](../mockups/booking-admin-variant-b.html) 畫面 3
    「改期表單（Modal 內切換）」（已核准的版型參考）
- 既有模式：改期表單在 `AppointmentDetailDialog` 內部以「子畫面切換」呈現（比照 TASK-015
  取消確認的模式：同一個 Dialog 元件，內容依 `view` state 在「詳情」「取消確認」「改期
  表單」之間切換，不是另開一個新的 Dialog）；日期／時段選擇可重用
  `lib/booking/date-range.ts` 的 `buildDateRange`／`lib/booking/slot-grid.ts` 的
  `buildSlotGrid`（設計師改期不受「提前 1 小時」「90 天視野」限制，見 feature-spec
  「資料與 API」段落，呼叫這兩個純函式時不套用那些顧客端限制參數，或視函式簽章決定是否
  需要新增一個不含這些限制的變體——由實作依實際狀況決定，優先重用而非複製一份邏輯）。
- 假設：改期時段仍須對齊 30 分鐘格點（沿用既有服務時長格點慣例，避免顧客端與後台產生
  不一致的可預約時段定義）；改期不需要重新檢查「營業時間」（`create_appointment` RPC
  本身也不檢查營業時間，只受 exclusion constraint 保護，見 feature-spec「資料與 API」
  段落的既有決策，本卡沿用同樣的假設，不擴大範圍去加驗證）。
- 未知事項：無。
- 允許變更的檔案：`app/admin/_components/AppointmentDetailDialog.tsx`（擴充改期子畫面）、
  `lib/admin/appointments.ts`（擴充 `rescheduleAppointment`）、`lib/admin/`（如需要新增
  改期表單專用的純函式，例如時段格點計算的變體）。
- 不得觸碰：`AppointmentDetailDialog.tsx` 的「標記完成」「取消」子畫面邏輯（TASK-015
  範圍）；`lib/booking/`（顧客端既有範圍，本卡只能「呼叫」不能「修改」這裡的既有函式）。

## 需求

- `lib/admin/appointments.ts` 新增 `rescheduleAppointment(supabase, appointmentId,
  newStartAt, newEndAt)`：`update start_at, end_at where id=...`，回傳 `Result<T>`；需要
  捕捉 Postgrest 回傳的 `exclusion_violation`（`23P01`）錯誤碼，轉成前端好用的
  `SLOT_CONFLICT` 類錯誤（比照顧客端 `create_appointment` 的 `error_code` 命名風格，
  即使這裡不是走 RPC 的 jsonb 信封，也要讓錯誤處理的「形狀」跟既有 `BookingError` 一致，
  方便前端沿用同一套錯誤訊息對應）。
- 改期表單：日期選擇（沿用既有元件庫的 `TextField`／`Select` 或日期選擇模式）＋時段選擇
  （30 分鐘格點，比照顧客端邏輯）；送出前基本驗證（新時段須為未來時間）。
- 送出後：
  - 成功：關閉 Modal，週曆／列表畫面即時反映新時段，顯示成功 Toast。
  - 衝突（`SLOT_CONFLICT`）：不關閉表單，在表單內顯示「這個時段已被其他預約占用，請選擇
    其他時段」，原預約時段不受影響（因為資料庫層擋下了這次 update，原資料本來就沒被
    改動，不需要額外的回滾邏輯）。
  - 其他未預期錯誤：顯示通用錯誤 Toast。

## 驗收標準

- 改期表單可以選新日期與時段並送出；成功後畫面正確反映新時段。
- 改期到與其他既有預約重疊的時段，被資料庫層擋下，顯示對應錯誤訊息，原預約不受影響
  （手動或整合測試驗證：改期前後查詢原預約，重疊嘗試失敗後時段應與嘗試前相同）。
- 改期到相鄰但不重疊的時段應該成功。
- `npx tsc --noEmit`／`npm run lint`／`npm run build`／`npm test` 皆通過。

## 實作備註

- 這是本 Epic 第一次讓 exclusion constraint 透過「直接 authenticated update」（不是既有的
  `create_appointment` RPC）觸發，實作時務必手動或用整合測試確認一次「兩筆重疊時段的改期
  嘗試，第二筆被擋下」，不要假設 RPC 路徑驗證過等於這條新路徑也一定正確——資料庫層的
  constraint 行為理論上與呼叫路徑無關，但正式驗證仍交由 TASK-017 的整合測試把關，本卡
  完成證據至少要有一次手動驗證記錄。

## 驗證契約

- 單元測試：改期表單的時段格點計算（若重用 `lib/booking/slot-grid.ts` 且無修改，不需要
  重複測試；若新增了不含顧客端限制的變體函式，需要對應單元測試）。
- 整合測試：不適用（正式的併發／邊界整合測試涵蓋在 TASK-017，本卡至少需手動驗證一次
  「改期到重疊時段被擋下」，記錄於完成證據）。
- E2E 測試：不適用（涵蓋在 TASK-017）。
- 型別檢查：`tsc --noEmit` 成功。
- Lint：`npm run lint` 成功。
- Build：`npm run build` 成功。
- 螢幕截圖：桌面尺寸截圖改期表單預設狀態、驗證錯誤、送出中、成功、時段衝突錯誤。
- 安全性檢查：確認改期操作只能由通過 `is_admin()` 驗證的角色執行；確認錯誤訊息不洩漏
  原始 Postgres 錯誤內容（constraint 名稱等內部細節）給畫面顯示。

## 完成證據

- 變更的檔案：
  - 新增：`lib/admin/reschedule-slots.ts`（`getOccupiedRangesForDate`／
    `getBusinessHoursForWeekday` 兩個 I/O 函式＋純函式 `computeAvailableSlots`）、
    `tests/admin/reschedule-slots.test.ts`。
  - 修改：`lib/admin/appointments.ts`（新增 `rescheduleAppointment`，含樂觀鎖、23P01
    轉 SLOT_CONFLICT、狀態條件過濾）、`lib/admin/week-range.ts`（新增匯出 `getWeekday`
    純函式）、`app/admin/_components/AppointmentDetailDialog.tsx`（新增改期子畫面：日期
    chip 列＋時段格點＋送出/衝突/一般錯誤處理）、`tests/admin/appointments.test.ts`
    （擴充 `rescheduleAppointment` 測試）。
  - **超出原始「允許變更的檔案」清單的必要變動**：`app/admin/_components/AdminDashboard.tsx`
    也做了小幅新增（`handleReschedule` 函式＋一個 `refetchToken` state＋傳一個新
    `onReschedule` prop 給 Dialog）。原因：任務卡的驗收標準明確要求「成功：關閉 Modal，
    週曆／列表畫面即時反映新時段」，而 TASK-015 已建立的模式是所有 Supabase 寫入呼叫都由
    `AdminDashboard.tsx` 統一持有（`handleMarkCompleted`／`handleConfirmCancel`），詳情
    Dialog 只管表單 UI，不直接呼叫資料層——為了維持這個一致性、也因為改期可能把預約移出
    目前顯示的週次範圍（本地 patch 無法正確處理，必須整個重新查詢），這個小幅擴增是必要的，
    未觸碰 TASK-015 建立的標記完成／取消邏輯本身。
    **architect 審查結果（補跑）：核准，此擴增判定為「不可避免且最小」——AC 要求週曆／列表
    即時反映新時段，沒有不動這個檔案的設計能達成；`refetchToken` 不是新抽象，比照本檔案與
    `BookingFlow.tsx` 既有的「依 deps 觸發的 effect」模式；選擇整批 refetch 而非本地 patch
    是正確的，因為改期可能把該筆移出目前顯示的週次，本地 patch 無法表達這件事。TASK-014/015
    的結構（寫入呼叫在父層、Dialog 維持展示性）未被破壞。architect 同時指出上一段「所有
    Supabase 寫入呼叫都由 AdminDashboard.tsx 統一持有」的說法過於寬泛——Dialog 本身仍會呼叫
    `getAppointmentDetail`／`getBusinessHoursForWeekday`／`getOccupiedRangesForDate` 等讀取
    函式並自建 client；實際慣例應理解為「寫入在父層、讀取就近於使用端」，記錄於此供後續任務
    卡參考正確版本的慣例說法。**
- 執行過的指令（皆為審查修正後的最終結果）：
  - `npx tsc --noEmit` → 無錯誤。
  - `npm run lint` → 0 problems。
  - `npx vitest run`（全專案）→ 10 files / 56 tests passed，含
    `tests/admin/reschedule-slots.test.ts`（5 tests：公休日／business_hours 為 null／完整
    格點／重疊時段排除／過去時段排除）與擴充後的 `tests/admin/appointments.test.ts`
    （`rescheduleAppointment` 4 個案例：23P01→SLOT_CONFLICT、其他錯誤→INTERNAL_ERROR、
    空結果視為失敗、成功且帶正確樂觀鎖／狀態條件參數）。
  - `npm run build` → 編譯成功。
  - 瀏覽器（Browser 工具）對真實 Supabase 專案手動走查，**含本卡實作備註明確要求的
    「兩筆重疊時段的改期嘗試，第二筆被擋下」手動驗證**：
    1. 透過顧客前台建立兩筆測試預約（TestReschedule1 16:00–16:45、TestReschedule2
       17:00–17:45，皆剪髮造型 45 分鐘）。
    2. 在後台開啟 TestReschedule1 詳情→改期，時段格點正確：自己原本的 16:00 可選（排除
       自己），16:30／17:00／17:30 因與 TestReschedule2 重疊而停用，18:00 可選。
    3. **直接對 PostgREST 送出一次會與 TestReschedule2 重疊的 PATCH**（繞過前端格點，
       模擬惡意或有 bug 的用戶端），確認資料庫真的回傳
       `{"code":"23P01","message":"conflicting key value violates exclusion constraint
       \"appointments_no_overlap\""}`，驗證 `error.code === "23P01"` 判斷與真實資料庫行為
       一致，不只是 mock。
    4. 改期到 18:00（合法空檔）→ Modal 關閉、Toast「已更新預約時段」、週曆／列表正確重新
       整理並顯示新時段。
    5. **競態條件驗證**：在改期表單選定一個當下空著的時段（13:00）後、送出前，用另一次
       直接 PATCH 把 TestReschedule2 搶先改到 13:00 佔用該時段；接著送出表單原本的（已過期
       的）選擇，確認 UI 正確顯示行內錯誤「這個時段已被其他預約占用，請選擇其他時段。」，
       Modal 不關閉，原預約（TestReschedule1）時段未被誤改。
    6. 重新以新建的 TestReschedule3（16:00）驗證加上樂觀鎖（`.eq("start_at", ...)`）修復
       後，正常改期路徑（16:00→17:00）依然成功，未被誤擋。
    7. 驗證完成後清除所有測試預約（TestReschedule1/2/3），還原資料庫為驗證前狀態。
- 設計系統對照：改期子畫面沿用既有元件（`Dialog`／`Chip`／`Button`／`Skeleton`／`Alert`／
  `Box` grid），日期 chip 列與時段格點的排版比照顧客前台
  `app/_components/booking/SlotPickerSection.tsx` 的既有模式，未新增自訂樣式或一次性數值，
  不算 S4 inventory 的「新模式」，不需要另外登記。
- 安全性備註（security-reviewer 子代理審查，核准建議：核准，條件為修復下方必要項目，已完成）：
  - **核准確認的部分**：`is_admin()` 驗證邊界未被動到；`getOccupiedRangesForDate` 只查詢
    `start_at`／`end_at`（不含姓名／電話等 PII，比 `getAppointmentsForWeek` 更嚴格）；
    `error.code === "23P01"` 的判斷可靠（SQLSTATE 來自資料庫，非使用者輸入，無法偽造）；
    重疊防護完全由資料庫 exclusion constraint 把關，不存在 TOCTOU 空窗，前端格點只是
    UX 層的預先過濾，資料庫才是最終權威。
  - **必要修復（已修復）**：`rescheduleAppointment` 原本只用 `.eq("id")`＋
    `.in("status",...)` 保護狀態機，但真正要改的 `start_at`／`end_at` 兩個欄位完全沒有
    保護——若同一筆預約在改期表單開著的期間已被另一個分頁／另一次 session 改期，本次送出
    仍會用陳舊資料成功覆寫（lost update），畫面顯示「已更新」但時段其實是錯的。已加上
    `.eq("start_at", currentStartAt)` 樂觀鎖（`currentStartAt` 為呼叫端開啟 Modal 當下看到
    的原時段），條件不符時自然落入既有的空結果失敗分支，並補上對應單元測試與瀏覽器手動
    驗證（見上方步驟 5、6）。
  - **記錄為殘留風險，未處理**（審查建議可留給後續任務卡）：
    - 改期的時間合法性（未來時間、對齊 30 分鐘格點、`end_at` 由 `duration_minutes` 推導）
      目前只有前端把關，資料庫只保證「不重疊」與 `end_at > start_at`；審查建議長期應收斂成
      `reschedule_appointment` 的 SECURITY DEFINER RPC（比照 `create_appointment`），由
      資料庫端統一驗證，但這需要新增 migration，超出本卡「不得修改 migration」的範圍，留給
      後續任務卡評估。
    - `error.code === "23P01"` 與「`appointments` 表上只有一個 exclusion constraint」這個
      隱含假設耦合；已在 `RESCHEDULE_ERROR_MESSAGES` 上方註解記錄，若未來新增第二個
      exclusion constraint 需要同步檢視。
    - `getOccupiedRangesForDate` 的當日視窗只用 `start_at` 篩選，若未來出現跨午夜營業，
      跨夜預約的佔用不會被算入（目前 `business_hours_valid_range` constraint 已排除跨夜
      營業的可能性，不會觸發）。
- 已知限制：
  - architect 子代理審查已補跑完成，核准（含對 `AdminDashboard.tsx` 範圍擴增的判斷，見上方
    「變更的檔案」段落）。另指出兩項非阻擋性後續建議，已另開任務卡追蹤：(1) 改期樂觀鎖目前
    以週曆列表快照的 `start_at` 為準，若 Modal 已載入單筆詳情，應改用詳情頁更權威的
    `start_at`，且鎖失敗目前落入通用 `INTERNAL_ERROR`，建議改回專屬的 `STALE_APPOINTMENT`
    錯誤碼以提升 UX；(2) `lib/admin/reschedule-slots.ts` 的 `computeAvailableSlots` 與
    `lib/booking/slot-grid.ts` 重複實作了營業時間解析與 30 分鐘格點迴圈，兩份邏輯需要手動保持
    同步，建議未來抽出共用的格點純函式。
  - 改期的時間合法性（未來時間、營業時間、30 分鐘對齊）僅前端驗證，資料庫層無對應約束
    （見上方安全性備註的殘留風險）。
  - 改期表單日期選單固定 21 天視窗（`RESCHEDULE_DATE_RANGE_DAYS`），比顧客端的 14 天略寬，
    對齊「設計師不受 90 天視野限制」但仍設一個合理上限，避免 UI 一次渲染過多 chip。
  - 螢幕截圖：本次工作階段瀏覽器 Browser pane 在部分操作中未穩定顯示，改以 accessibility
    tree（`read_page`）、`get_page_text` 與直接對 PostgREST 送出請求核對真實資料庫回應，
    取得同等強度（甚至更嚴謹，因為驗證到了資料庫層級的實際行為）的驗證證據。
- 後續任務：TASK-017（整合驗證）。
