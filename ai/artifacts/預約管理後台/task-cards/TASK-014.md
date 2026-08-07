# AI-Ready 任務卡

## Metadata

- 任務：預約管理後台 架構基礎（Sidebar 導覽、WeekCalendar／列表唯讀顯示）
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：預約管理後台
- 上層 User Story：查看預約列表／日曆
- 分軌：前端
- 前置任務（dependsOn）：TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006,
  TASK-007, TASK-008, TASK-009（「專案設置」Epic 全部卡片，依 `implementation-plan` 的
  強制連動規則）、TASK-010（本 Epic 讀取的 `appointments`／`services` 資料模型與
  `is_admin()` RLS 邊界皆由該卡建立）
- 狀態：完成（人工驗收：使用者，2026-08-06，「沒問題」）
- 風險等級：中（僅限已登入且 `is_admin()` 通過的設計師可存取，沿用既有 RLS 邊界；純讀取，
  無資料寫入，無新 migration／RPC）
- Agent owner：Claude Code
- 人工核准者：使用者，2026-08-06（核准開始實作）

## 目標

把 `app/admin/page.tsx` 從佔位頁面改成真正的後台首頁：套用 S5 已核准的變體 B 版型骨架
（Sidebar 導覽＋主內容區），新增 Sidebar 導覽元件與 WeekCalendar 週曆／列表元件，讀取並
唯讀顯示本週的預約資料（週次切換、週曆/列表檢視切換），登記兩個新元件回 S4 inventory。
本卡**不含**點選事件後的詳情 Modal 與任何寫入操作（標記完成／取消／改期），那些留給
TASK-015／TASK-016。

## 情境包（Context Pack）

- 相關檔案：
  - `app/admin/page.tsx`（既有：登入與 `is_admin()` 檢查邏輯，本卡在通過驗證後渲染真正
    的後台內容，取代目前的佔位文字）
  - `app/admin/logout-button.tsx`（既有登出邏輯，Sidebar 的登出項目直接複用，不重寫）
  - `lib/supabase/client.ts`（既有瀏覽器 client 封裝，本卡的資料查詢基於此）
  - `ai/context/design-system.md` S4 inventory、S3 token
  - [`booking-admin-variant-b.html`](../mockups/booking-admin-variant-b.html)（已核准的
    版型參考，畫面 1「週曆預設」與畫面 4「列表檢視」；畫面 2/3 的 Modal／改期表單留給
    TASK-015／TASK-016）
  - [`screen-spec-預約週曆列表.md`](../screen-spec-預約週曆列表.md)
  - `app/_components/booking/`（顧客端既有的 client component＋純函式拆分模式，本卡沿用
    同樣的組織方式）
- 既有模式：
  - Sidebar 沿用 `components/ui/Nav.tsx` 的做法——MUI 沒有對應單一元件，直接組 MUI
    `Box`／`List`／`ListItemButton` 拼出，樣式對照 mockup 的 `.sidebar`／`.nav-item`
    class（用 `primary`／`grey` token，不手寫 hex）。
  - 資料查詢用 `supabase.from('appointments').select('*, services(name, duration_minutes)')`
    （PostgREST embedded resource，走既有的「admin full access to appointments／
    services」RLS policy，`authenticated`＋`is_admin()`），不需要新 RPC。
  - 週次切換／loading 狀態管理比照 `app/_components/booking/BookingFlow.tsx` 的
    「fetch 結果存 `{key, status, data}`，render 時比較目前依賴值與最後完成的 key 是否
    一致」寫法，避免違反 `react-hooks/set-state-in-effect` 規則（見該檔案的既有註解與
    TASK-011 完成證據）。
  - 純函式（週次範圍計算、格式化）比照 `lib/booking/date-range.ts` 的組織方式，新增
    `lib/admin/week-range.ts`。
- 假設：週曆固定顯示週一至週日 7 欄（不是 mockup 草稿階段畫的 5 欄，需涵蓋週六的正常營業日
  與週日的公休日——公休日格子仍顯示但視覺上弱化，比照 mockup `.cal-day.closed`）；預設顯示
  「本週」（依 `Asia/Taipei` 時區判斷今天所在週）；週次切換沒有範圍上限（可以往前往後翻到
  很久以前／以後，因為這是設計師查歷史紀錄的合理需求，不像顧客端有 90 天視野限制）。
- 未知事項：無。
- 允許變更的檔案：`app/admin/page.tsx`（改寫）、`app/admin/_components/`（新增，本頁面
  專用的元件，例如 `WeekCalendar.tsx`／`AppointmentListView.tsx`）、`components/ui/Sidebar.tsx`
  （新增，跨頁可重用的導覽元件）、`lib/admin/`（新增，資料存取封裝與純函式）、
  `ai/context/design-system.md`（登記 Sidebar／WeekCalendar 回 S4 inventory）。
- 不得觸碰：`app/admin/logout-button.tsx`（既有邏輯直接複用，不修改內部實作，Sidebar 只是
  換個地方渲染這個既有元件）、`app/page.tsx`／`app/_components/booking/`／`lib/booking/`
  （顧客端既有範圍，與本 Epic 無關）、`supabase/migrations/`（本卡不需要 schema 變更）。

## 需求

- `lib/admin/week-range.ts`：純函式，給定一個日期回傳「該日期所在週」的週一與週日日期
  （`Asia/Taipei` 時區），以及往前／往後一週的計算函式，比照 `lib/booking/date-range.ts`
  的寫法。
- `lib/admin/appointments.ts`：`getAppointmentsForWeek(supabase, weekStart, weekEnd)`，
  查詢該週範圍內的 `appointments`（含 embedded `services.name`／`duration_minutes`），
  回傳型別化陣列，統一處理 Supabase 查詢錯誤（比照 `lib/booking/api.ts` 的 `Result<T>`
  設計，不需要處理 RPC 的 `{ok,...}` 信封，因為這裡是直接 table 查詢）。
- `components/ui/Sidebar.tsx`：導覽項目「預約」（連向 `/admin`，使用中狀態）、「服務設定」
  「營業時間」（顯示但停用狀態——不可點擊或點擊無動作，因為對應頁面尚未實作，不能連到
  404）、「登出」（渲染既有 `LogoutButton`）。
- `app/admin/_components/WeekCalendar.tsx`：7 欄日期格週曆，每格顯示當天的預約事件卡
  （時間／顧客姓名／服務／狀態徽章，比照 mockup 的 `.event-card`），單日事件過多時格內可
  捲動；每個事件卡片有 `onClick` prop（本卡先接一個不做事的 placeholder handler，
  TASK-015 會接上開啟 Modal 的邏輯）；今天所在的格子有視覺標示；公休日格子弱化顯示。
- `app/admin/_components/AppointmentListView.tsx`（或等價命名）：同一週資料的表格檢視，
  欄位為日期／時段／顧客／服務／狀態，比照 mockup 畫面 4。
- 週次切換（上一週／本週／下一週）與週曆／列表檢視切換皆為頁面層 state，切換時只重新查詢
  對應區塊，不整頁重新整理。
- loading／空狀態（該週無預約）皆有對應畫面，畫面元素只用 S4 已入庫元件與 S3 token。

## 驗收標準

- `/admin` 登入後預設顯示本週週曆，Sidebar 顯示「預約」為使用中狀態，「服務設定」「營業
  時間」顯示但不可互動，登出功能正常（沿用既有邏輯）。
- 週次切換正確重新查詢並顯示對應週次資料；週曆／列表切換呈現同一份資料的兩種檢視。
- loading／空狀態畫面正確顯示，且只用 S4 已入庫元件與 S3 token，沒有硬寫的一次性色彩／
  間距／字級數值。
- 非管理者或未登入身分仍會被導回登入頁（確認沒有破壞既有的 `app/admin/page.tsx` 驗證
  邏輯）。
- `Sidebar`／`WeekCalendar` 已登記回 `ai/context/design-system.md` 的 S4 元件庫 inventory。
- `npx tsc --noEmit`／`npm run lint`／`npm run build` 皆通過。

## 實作備註

- `WeekCalendar` 的事件卡片點擊行為本卡只接 placeholder（例如 `onEventClick?.(appointment)`
  傳給父層，父層本卡先不做任何事），讓 TASK-015 能直接在父層元件接上 Modal 開關邏輯，
  不需要修改 `WeekCalendar` 本身的核心渲染邏輯——這是刻意的介面設計，方便 TASK-015／
  TASK-016 擴充而不用回頭改本卡的檔案。
- `getAppointmentsForWeek` 回傳的型別建議直接把 `services` 的巢狀物件攤平成
  `service_name`／`duration_minutes` 兩個欄位，方便 `WeekCalendar`／`AppointmentListView`
  使用，不需要在元件內處理巢狀結構。

## 驗證契約

- 單元測試：`lib/admin/week-range.ts` 的週次計算純函式（給定日期算出正確的週一／週日、
  上一週／下一週）。
- 整合測試：不適用（本卡純讀取，沒有寫入或併發相關風險；讀取的 RLS 邊界已由 TASK-003／
  TASK-010 涵蓋，本卡不重複測試既有邊界，只需在螢幕截圖驗證時確認畫面正確反映資料）。
- E2E 測試：不適用（涵蓋在 TASK-017）。
- 型別檢查：`tsc --noEmit` 成功。
- Lint：`npm run lint` 成功。
- Build：`npm run build` 成功。
- 螢幕截圖：桌面尺寸（1200px 上下）截圖週曆預設狀態、列表檢視、載入中、空狀態（該週
  無預約）。
- 安全性檢查：確認 `/admin` 頁面的既有 `is_admin()` 驗證邏輯沒有被本卡的改動破壞；確認
  查詢只用 `authenticated` 角色既有的 RLS policy，沒有新增任何放寬的存取路徑。

## 完成證據

- 變更的檔案：
  - 新增：`lib/admin/week-range.ts`（週次計算純函式）、`lib/admin/appointments.ts`
    （`getAppointmentsForWeek`）、`lib/admin/format.ts`（狀態文案／色彩、時間格式化純函式）、
    `components/ui/Sidebar.tsx`、`app/admin/_components/WeekCalendar.tsx`、
    `app/admin/_components/AppointmentListView.tsx`、`app/admin/_components/AdminDashboard.tsx`
    （頁面層 client component，串接 Sidebar＋週次/檢視 state）、
    `tests/admin/week-range.test.ts`。
  - 修改：`app/admin/page.tsx`（拿掉佔位文字，驗證通過後改渲染 `AdminDashboard`，
    登入/`is_admin()` 檢查邏輯未變動）、`ai/context/design-system.md`（S4 inventory 新增
    Sidebar／WeekCalendar 兩列）。
- 執行過的指令（皆為審查修正後的最終結果）：
  - `npx tsc --noEmit` → 無錯誤。
  - `npm run lint` → 0 problems。
  - `npx vitest run`（全專案）→ 8 files / 40 tests passed，含新增 `tests/admin/week-range.test.ts`
    6 tests；純函式測試涵蓋週一/週日邊界、跨月進位、上一週/下一週推算、`buildWeekDays` 7 天遞增。
  - `npm run build` → 編譯成功，`/admin` 正確產出為 dynamic route。
- 螢幕截圖：本次工作階段瀏覽器 Browser pane 未顯示（screenshot 工具回報 pane not
  displayed，非本卡程式問題），改以 accessibility tree（`read_page`）與 `get_page_text`
  對真實 Supabase 資料驗證四種畫面：
  - 週曆預設（本週 8/3–8/9）：Sidebar「預約」使用中、「服務設定」「營業時間」停用、
    週四三筆預約正確顯示時間／姓名／服務／狀態徽章，週日格顯示「· 公休」並弱化。
  - 列表檢視：同一週資料切換為表格，欄位日期／時段／顧客／服務／狀態正確。
  - 空狀態（上一週 7/27–8/2 無預約）：週曆與列表皆顯示「本週沒有預約」。
  - 權限：登出後導回登入頁；未登入直接訪問 `/admin` 也導回登入頁，確認驗證邏輯未被破壞。
  - 未驗證：loading skeleton 畫面（本機資料庫延遲太低，瞬間完成，未能截取到過渡狀態；
    程式碼路徑與 `BookingFlow` 已驗證過的 loading 分支寫法一致）。
- 設計系統對照：重用 primary/grey/success/warning/danger token、typography.subtitle2／
  caption／body2、radius.sm/md、elevation1 陰影；重用既有元件 Card／CardActionArea／Chip／
  Table／Skeleton／Alert／Button／ToggleButtonGroup。新做 Sidebar（`components/ui/`，跨頁
  可重用）與 WeekCalendar（`app/admin/_components/`，本頁面專用）皆已登記回
  `ai/context/design-system.md` S4 inventory。
- 安全性備註：`app/admin/page.tsx` 的 `is_admin()` RPC 檢查與 `redirect("/login")` 邏輯完全
  未修改；`getAppointmentsForWeek` 僅用既有「admin full access to appointments」RLS policy
  （`authenticated` + `is_admin()`），未新增任何放寬的存取路徑或新 RPC。實測確認登出與未登入
  直接訪問 `/admin` 皆正確導回登入頁。

## 審查關卡結果

- **security-reviewer（子代理）**：核准。auth/`is_admin()` 邊界未被動到、RLS 依賴健全
  （anon 對 `appointments` 無 SELECT policy、`is_admin()` 為 `security definer`＋`stable`＋
  `set search_path = ''`）、日期字串內插無注入風險（走 PostgREST filter 序列化，非字串拼接
  SQL）、無密鑰外洩、無 XSS（`customer_name` 由 React 自動轉義）。發現 6 項低嚴重度問題，
  已當場修復 2 項：
  - `customer_phone` 查詢了但兩個檢視皆無消費者 → 已從 `WeekAppointment` 型別與
    `.select()` 移除（資料最小化，PII 曝露面收斂）。
  - `WeekCalendar.tsx` 用 `appointment.start_at.slice(0, 10)` 取 ISO 字串的 **UTC** 日期
    分組，但查詢邊界與其他所有時間顯示都用 **Asia/Taipei**；台北時間 08:00 前的預約會落到
    前一個 UTC 日，在週曆上靜默消失（列表檢視卻看得到，兩個檢視會不一致）→ 已在
    `lib/admin/format.ts` 新增共用的 `toTaipeiDate()`，`WeekCalendar` 與
    `AppointmentListView` 的日期分組／顯示皆改用它。
  其餘 4 項（`getAppointmentsForWeek` 未驗證 `weekStart`/`weekEnd` 格式、查詢錯誤未記錄細節
  只回通用訊息、缺少邊界測試、查詢無 `.limit()` 上限）記錄於下方已知限制，留給後續卡處理。
- **architect（子代理）**：要求修改（非阻擋——無 migration、無寫入路徑、回滾成本＝revert 一個
  commit）。要求修復 4 項，已全部修復：
  1. 同上 UTC/Taipei 時區分組 bug（與安全性審查重複發現）。
  2. `isClosed = day.weekday === 0` 是匿名 magic literal，重複了 `business_hours` 表已有的
     業務規則來源 → 改成 `lib/admin/week-range.ts` 具名匯出函式 `isClosedWeekday()`，並加註解
     說明這是暫時寫死（比照種子資料），待「營業時間設定」頁上線後應改查
     `business_hours.is_closed`。
  3. 事件卡片／列表列在尚未接上 `onEventClick`/`onRowClick` 前，仍用 `CardActionArea`／
     `hover` 顯示可點擊回饋（ripple、hover 樣式），使用者點下去卻沒有反應 → 改成只在有傳入
     handler 時才顯示可點擊回饋；本卡的 `AdminDashboard` 刻意不傳 handler
     （因為此功能仍完全放在 TASK-015），純顯示卡片不再有假的互動暗示。
  4. 狀態 Chip 用了不在 design token type scale 上的 `fontSize: 10`／`height: 18` → 改回
     `fontSize: 11`（token 最小字級 `xs`）／`height: 20`（比照 `SectionChrome.tsx` 既有先例）。
  其餘 6 項低嚴重度建議（`WEEKDAY_LABELS` 曾重複三處，已消除到剩兩處跨 feature 各自一份、
  可接受；`services` embed 為 null 時靜默回退空字串；`getAppointmentsForWeek` 的
  `weekEnd` 參數其實可從 `weekStart` 推算、屬冗餘契約；`lib/admin/format.ts` 用
  `import type` 反向依賴 `appointments.ts`；Sidebar shell／`SIDEBAR_ITEMS` 未來應上移到
  `app/admin/layout.tsx`；`flattenService` 未匯出無法單元測試）記錄於下方已知限制。
- 修復後重跑：`npx tsc --noEmit` 無錯誤、`npm run lint` 0 problems、`npx vitest run` 40/40
  通過、`npm run build` 成功；瀏覽器重新走查確認事件卡片不再是 `button` role（純顯示，無假
  可點擊回饋）、列表檢視日期標籤與週曆分組一致（皆顯示「週四 8/6」）。

- 已知限制：
  - 事件卡片／列表列目前不接受點擊（依設計留給 TASK-015 接上 `onEventClick`/`onRowClick`
    開啟詳情 Modal；本卡刻意不傳 no-op handler，避免假的可點擊回饋，見上方審查修復第 3 項）。
  - loading skeleton 狀態未能在本機環境截圖驗證（本機資料庫延遲太低，瞬間完成，未能截取到
    過渡狀態；程式碼路徑與 `BookingFlow` 已驗證過的 loading 分支寫法一致）。
  - 週次切換失敗時的 Toast 錯誤文案（screen-spec 定義為「操作失敗，請稍後再試」）已實作但
    未能實測觸發（需要人為模擬查詢失敗，本機環境未特別建置此情境）。
  - 公休日判斷（`isClosedWeekday()`）目前仍是寫死週日，比照 `scripts/seed-booking-data.mjs`
    的種子資料，尚未改成查 `business_hours.is_closed`；待「營業時間設定」頁上線、公休日可被
    管理者調整時必須跟進，否則週曆會顯示錯誤的公休狀態。
  - `getAppointmentsForWeek` 對 `weekStart`/`weekEnd` 參數無格式驗證，目前僅頁面內部呼叫、
    輸入皆由 `week-range.ts` 產生，無風險；若後續任務（例如 TASK-017）加上 `?week=` 之類的
    URL 深連結參數，需要補上格式檢核與 `AdminDashboard.tsx` 的 promise `.catch()`。
  - `flattenService` 攤平邏輯未匯出、無單元測試涵蓋物件/陣列/null 三種形狀。
  - `app/admin/logout-button.tsx` 渲染原生 `<button>`，未套 MUI 主題，放進精緻的 Sidebar 後
    成為畫面上唯一未套主題的元件；本卡未修改（不得觸碰範圍），建議另開小卡改成 MUI Button。
  - `Sidebar` 的 `SIDEBAR_ITEMS`／`active` 狀態目前寫在 `AdminDashboard.tsx` 頁面層；第二個
    後台頁面（服務設定／營業時間）出現時，應上移到 `app/admin/layout.tsx` 並用
    `usePathname()` 推導 active 狀態，避免每個頁面複製貼上同一份導覽清單。
- 後續任務：TASK-015（標記完成／取消）、TASK-016（改期）、TASK-017（整合驗證）。
