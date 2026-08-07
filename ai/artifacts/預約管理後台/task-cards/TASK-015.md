# AI-Ready 任務卡

## Metadata

- 任務：預約管理後台 事件詳情 Modal、標記完成與取消預約
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：預約管理後台
- 上層 User Story：標記預約完成、取消預約
- 分軌：前端
- 前置任務（dependsOn）：TASK-014
- 狀態：完成（人工驗收：使用者，2026-08-06，「沒問題」）
- 風險等級：中（涉及預約狀態的資料寫入，透過既有 `authenticated`＋`is_admin()` RLS 邊界，
  無新的 anon 可觸及介面）
- Agent owner：Claude Code
- 人工核准者：使用者，2026-08-06（指名要求「繼續做 TASK-015」，視為核准開始實作）

## 目標

在 TASK-014 建立的 `WeekCalendar`／`AppointmentListView` 上接上「點選預約 → 開啟詳情
Modal」的互動，並在 Modal 內實作「標記完成」與「取消預約」（含二次確認）兩個操作。
「改期」按鈕本卡先顯示但不實作內容，留給 TASK-016 接續（避免兩張卡同時改同一個 Modal
元件的核心結構，見 MECE 邊界說明）。

## 情境包（Context Pack）

- 相關檔案：
  - `app/admin/_components/WeekCalendar.tsx`／`AppointmentListView.tsx`（TASK-014 已建立，
    本卡在父層元件接上 `onEventClick`，不修改這兩個檔案的核心渲染邏輯）
  - `components/ui/ConfirmDialog.tsx`（既有確認對話框元件，取消預約的二次確認直接複用）
  - `components/ui/ToastProvider.tsx`（既有全域 toast，操作結果提示直接複用）
  - `lib/admin/appointments.ts`（TASK-014 已建立，本卡擴充新增
    `markAppointmentCompleted`／`cancelAppointment` 兩個函式）
  - [`booking-admin-variant-b.html`](../mockups/booking-admin-variant-b.html) 畫面 2
    「點選事件卡開啟 Modal」（已核准的版型參考）
- 既有模式：直接用 MUI `Dialog` 拼出詳情 Modal（比照 `ConfirmDialog.tsx` 內部用法），內容
  依「詳情」「取消確認」兩種子畫面切換；取消預約的二次確認**不是**在詳情 Modal 裡重新刻一份
  確認 UI，而是關閉詳情 Modal、開啟既有的 `ConfirmDialog` 元件（兩個平行的 Dialog，不是
  Dialog 裡嵌 Dialog），確認後才呼叫更新函式並顯示 Toast。
- 假設：只有狀態為 `pending`／`confirmed` 的預約能標記完成；只有非 `cancelled`／
  `completed` 的預約能取消；這些規則在畫面上直接控制按鈕是否顯示（見「不得觸碰」以外的
  情境，按鈕邏輯屬本卡範圍），不是顯示後才在送出時擋。
- 未知事項：無。
- 允許變更的檔案：`app/admin/_components/`（新增 `AppointmentDetailDialog.tsx`；修改
  `WeekCalendar.tsx`／`AppointmentListView.tsx`／`app/admin/page.tsx` 或其父層元件，僅限
  接上 `onEventClick`／Modal 開關的 state，不重寫其資料查詢或渲染核心邏輯）、
  `lib/admin/appointments.ts`（擴充新增函式，不修改 TASK-014 已完成的
  `getAppointmentsForWeek`）。
- 不得觸碰：`WeekCalendar.tsx`／`AppointmentListView.tsx` 的資料查詢與週次切換邏輯（TASK-014
  範圍）；改期表單的實作內容（TASK-016 範圍，本卡只需確保「改期」按鈕存在且點擊後有一個
  明確的介面可以讓 TASK-016 接上表單，例如一個 Modal 子畫面的 slot 或 callback）。

## 需求

- `lib/admin/appointments.ts` 新增：
  - `markAppointmentCompleted(supabase, appointmentId)`：`update status='completed' where
    id=...`，回傳 `Result<void>`（比照既有 `Result<T>` 設計）。
  - `cancelAppointment(supabase, appointmentId)`：`update status='cancelled' where id=...`，
    回傳 `Result<void>`。
  - 兩者都需處理 Postgrest 回傳的錯誤（含 RLS 阻擋導致「成功但 0 筆受影響」的既有已知
    行為——需要用 `.select()` 搭配回傳筆數確認實際有更新到，不能只看 `error` 是否為
    `null`，比照 TASK-010 完成證據記錄的「RLS 阻擋 UPDATE 回傳成功但空結果」注意事項）。
- `AppointmentDetailDialog.tsx`：接收一筆預約資料，顯示顧客姓名／電話／服務／時段／狀態；
  依狀態顯示對應的操作按鈕（`pending`/`confirmed`：標記完成＋改期＋取消；`completed`／
  `cancelled`：不顯示任何操作按鈕，只顯示唯讀詳情＋關閉）。
- 點選「標記完成」：呼叫 `markAppointmentCompleted`，成功後關閉 Modal、更新週曆／列表畫面
  上對應事件的狀態（不需要重新整個查詢，直接更新本地 state 或觸發父層重新查詢皆可，由實作
  決定較簡單的方式）、顯示成功 Toast；送出中按鈕顯示 `loading`。
- 點選「取消預約」：關閉詳情 Modal，開啟 `ConfirmDialog`（標題「確認取消預約？」，說明文字
  含顧客姓名與時段，確認按鈕 `confirmColor="error"`）；確認後呼叫 `cancelAppointment`，
  成功後更新畫面對應事件狀態、顯示成功 Toast；取消確認框可以「再想想」關閉不執行。
- 失敗情境（更新失敗）：顯示錯誤 Toast，不清空/不誤更新畫面上的狀態，Modal／確認框依情境
  決定是否停留（標記完成失敗停留在詳情 Modal；取消失敗停留在確認框或退回詳情 Modal 皆可，
  由實作決定，但不能悄悄關閉卻沒有任何提示）。

## 驗收標準

- 點選週曆事件卡或列表列，正確開啟詳情 Modal，顯示正確的預約資訊。
- `pending`／`confirmed` 預約才顯示「標記完成」「取消」「改期」三個按鈕；`completed`／
  `cancelled` 預約不顯示任何操作按鈕。
- 標記完成、取消（含二次確認）皆可從畫面完成，成功後畫面即時反映新狀態且有 Toast 提示；
  送出中按鈕正確顯示 loading。
- 更新失敗時顯示錯誤 Toast，畫面狀態不會被錯誤地更新成看似成功。
- `npx tsc --noEmit`／`npm run lint`／`npm run build`／`npm test`（含新增單元測試）皆通過。

## 實作備註

- 「改期」按鈕本卡先渲染但只需接一個 placeholder（例如點擊後顯示「改期功能即將推出」或
  單純先不做任何事），實際表單邏輯留給 TASK-016 直接擴充 `AppointmentDetailDialog.tsx`
  的「改期」子畫面，不要求 TASK-016 修改本卡建立的標記完成／取消核心邏輯。

## 驗證契約

- 單元測試：預約狀態決定「顯示哪些操作按鈕」的判斷純函式（若拆得出來，例如
  `getAvailableActions(status)`），比照 `lib/booking/slot-grid.ts` 的可測試純函式風格。
- 整合測試：不適用（涵蓋在 TASK-017）。
- E2E 測試：不適用（涵蓋在 TASK-017）。
- 型別檢查：`tsc --noEmit` 成功。
- Lint：`npm run lint` 成功。
- Build：`npm run build` 成功。
- 螢幕截圖：桌面尺寸截圖詳情 Modal（`pending` 狀態含三按鈕／`completed` 狀態無按鈕）、
  取消二次確認、標記完成送出中、成功 Toast、失敗 Toast。
- 安全性檢查：確認更新操作只能由通過 `is_admin()` 驗證的角色執行（沿用既有 RLS，不新增
  任何放寬）；確認顧客個資（姓名／電話／email）不出現在 console log 或 URL。

## 完成證據

- 變更的檔案：
  - 新增：`app/admin/_components/AppointmentDetailDialog.tsx`（詳情 Modal，含標記完成／
    改期 placeholder／取消／關閉四個動作，依 `getAvailableActions()` 決定顯示哪些按鈕）、
    `tests/admin/appointments.test.ts` 擴充（原本只測 `getAvailableActions`，本卡加測
    `markAppointmentCompleted`／`cancelAppointment`）。
  - 修改：`lib/admin/appointments.ts`（新增 `getAppointmentDetail`／`markAppointmentCompleted`／
    `cancelAppointment`／`getAvailableActions`）、`lib/admin/format.ts`（新增
    `formatAppointmentDateLabel`，`AppointmentListView.tsx` 同步改用這個共用函式取代原本
    的本地重複實作）、`app/admin/_components/AdminDashboard.tsx`（接上 `onEventClick`／
    `onRowClick`，管理詳情 Modal／取消確認框的開關與 loading 狀態，成功後直接 patch 本地
    `appointments` state，不整個重新查詢）、`app/admin/_components/AppointmentListView.tsx`
    （改用共用的 `formatAppointmentDateLabel`）。
  - 未變更：`app/admin/_components/WeekCalendar.tsx`（依 TASK-014 預留的 `onEventClick` 介面
    直接使用，不需要修改核心渲染邏輯）、`components/ui/ConfirmDialog.tsx`（既有元件直接
    複用，取消預約的二次確認不重刻）。
- 執行過的指令（皆為審查修正後的最終結果）：
  - `npx tsc --noEmit` → 無錯誤。
  - `npm run lint` → 0 problems。
  - `npx vitest run`（全專案）→ 9 files / 47 tests passed，含 `tests/admin/appointments.test.ts`
    7 tests（`getAvailableActions` 2 個狀態分組 + `markAppointmentCompleted`／
    `cancelAppointment` 的 PostgrestError／空結果／成功／狀態條件與目標值斷言 5 個案例）。
  - `npm run build` → 編譯成功。
  - 瀏覽器（Browser 工具）對真實 Supabase 專案手動走查：點選週曆事件卡開啟詳情 Modal，
    確認顯示顧客姓名／電話（依 id 單筆取回）／服務／時段／狀態；點「改期」顯示
    placeholder Toast「改期功能即將推出，敬請期待」；點「取消預約」關閉詳情 Modal、開啟
    `ConfirmDialog`（描述文字含顧客姓名與時段）；「再想想」正確關閉不執行；確認取消後
    Modal 關閉、週曆與列表檢視同步顯示「已取消」、成功 Toast「已取消預約」；重新點開已取消
    的預約，Modal 僅顯示唯讀詳情＋「關閉」，三個操作按鈕皆不顯示；另一筆「標記完成」流程
    同樣驗證：送出後狀態變 `completed`、Modal 關閉、Toast「已標記完成」，週曆與列表同步更新。
- 測試輸出摘要：見上；`markAppointmentCompleted`／`cancelAppointment` 的單元測試涵蓋
  PostgrestError 轉換、RLS 阻擋或狀態條件不符時的空結果判定為失敗、成功時的正確回傳，以及
  `update()`／`eq()`／`in()` 呼叫參數斷言（目標狀態、狀態條件過濾清單）。
- 設計系統對照：`AppointmentDetailDialog` 直接用 MUI `Dialog`／`DialogTitle`／
  `DialogContent`／`DialogActions`／`Button`／`Stack`／`Typography`／`Skeleton`／`Alert`
  拼出，比照 `ConfirmDialog.tsx` 的既有組合模式，未新增自訂樣式或一次性數值，因此不算
  S4 inventory 定義的「新模式」，不需要另外登記（沿用既有 Modal/Dialog 條目）；取消二次
  確認直接複用既有 `ConfirmDialog` 元件，未重新刻一份確認 UI。
- 安全性備註（security-reviewer 子代理審查，核准建議：要求修改，已全部處理必要項目）：
  - **核准確認的部分**：`customer_phone` 只在開啟 Modal 時依 id 單筆取回，全程未進
    console/URL/router state，以 React text node 渲染（自動轉義）；授權完全靠既有 RLS
    （`appointments` 無 anon SELECT policy，`authenticated` 需過 `is_admin()`），未新增／
    放寬任何 policy、RPC 或 migration；`getAppointmentDetail` 對「不存在」與「無權限」回傳
    相同錯誤，無 id 枚舉 oracle；無 SQL 拼接、無 XSS 面、無新依賴。
  - **必要修復 1（中）**：`AppointmentDetailDialog` 原本用 TASK-014 整週查詢當下的舊快照
    `appointment.status` 判斷可操作按鈕，但 `updateAppointmentStatus` 本身對狀態轉換完全
    無條件（純 `eq("id", ...)` 覆寫）——若同一筆預約已在另一個分頁／另一次 session 被改成
    `cancelled`，本分頁仍會顯示舊狀態並允許「標記完成」成功，讓已取消的預約被復活重新落入
    `appointments_no_overlap` 排除集合佔用時段。已修復：(a) 改用 `getAppointmentDetail`
    單筆取回的權威 `detail.status` 計算 `effectiveStatus`／`getAvailableActions()`／狀態
    文字；(b) `updateAppointmentStatus` 加上 `.in("status", ["pending", "confirmed"])`
    伺服器端狀態條件，即使 UI 判斷有落差，這裡是最終防線，狀態已變動時更新自然落入
    「空結果」分支回傳失敗，不會誤更新。
  - **必要修復 2（中）**：`markAppointmentCompleted`／`cancelAppointment`
    這個關鍵安全機制（RLS 阻擋 UPDATE 回傳成功但空結果的判定）先前完全沒有單元測試。已補上
    （見上方測試輸出摘要）。
  - **已處理的低嚴重度項目**：`ConfirmDialog` 取消確認框在送出中（`cancelLoading`）時，
    `onClose`（ESC／backdrop）原本仍可直接關閉，讓 in-flight 請求「悄悄」在背景結束——已改成
    loading 中忽略 close 嘗試。
  - **記錄為殘留風險，未處理**：`AppointmentDetailDialog` 關閉後，已取回的 `detailResult`
    （含電話）不會從元件 state 清除，會在記憶體中多留存一段時間才被下次開啟另一筆預約時的
    新結果覆蓋掉；嘗試用 `useEffect` 在 `!open` 時 `setDetailResult(null)` 清除，但此寫法
    直接觸發本專案的 `react-hooks/set-state-in-effect` 規則錯誤（純函式 effect body 內同步
    setState），且此殘留風險本身嚴重度低（未進 console／URL／localStorage，只是元件記憶體
    內多留一段時間），故不強行繞過 lint 規則實作，記錄為已知限制。
  - 錯誤處理泛化：所有更新失敗（RLS 阻擋、狀態條件不符、網路錯誤）皆收斂成同一個不含底層
    細節的泛用 Toast「操作失敗，請稍後再試」，刻意不細分原因，避免對外洩漏「這筆預約目前是
    什麼狀態」這類可被列舉的資訊；代價是沒有伺服端可觀測性（無稽核軌跡記錄誰在何時改了
    哪筆預約的狀態），單一設計師情境下影響有限，記錄為已知限制。
- 已知限制：
  - `AppointmentDetailDialog` 關閉後 `detailResult`（含電話）未從元件 state 清除，見上方
    安全性備註；若未來要處理，建議改用 key-remount（例如父層在關閉時把 `key` 換掉）而不是
    在 effect 內同步 setState。
  - 狀態變更（標記完成／取消）沒有稽核軌跡，`set_updated_at` trigger 只記時間不記操作者與
    舊值；單一設計師情境下影響有限，多設計師或需要追溯時應評估新增
    `appointment_status_log` 表。
  - 更新失敗一律顯示泛用錯誤 Toast，未區分「RLS 阻擋」「狀態已變動」「網路錯誤」等原因
    （刻意設計，避免資訊洩漏，見上）。
  - `getAppointmentDetail`／`markAppointmentCompleted`／`cancelAppointment` 對
    `appointmentId` 參數無 uuid 格式驗證；目前僅由頁面內部呼叫、輸入皆來自已知資料，無風險，
    Postgres 的 uuid 型別與參數化 filter 已在資料庫層擋下格式錯誤的輸入。
  - 「改期」按鈕僅為 placeholder（顯示提示 Toast，不做任何事），實際表單邏輯留給 TASK-016。
  - 失敗情境（更新失敗）的錯誤 Toast 未能在本機環境實測觸發（需要人為模擬 RLS 阻擋或網路
    錯誤，本機環境未特別建置此情境）；已透過單元測試涵蓋對應的錯誤分支邏輯。
- 後續任務：TASK-016（改期）、TASK-017（整合驗證）。
