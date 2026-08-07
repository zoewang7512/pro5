# AI-Ready 任務卡

## Metadata

- 任務：營業時間與可預約時段管理 架構基礎（頁面骨架、Switch 元件、七天現況唯讀顯示）
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：營業時間與可預約時段管理
- 上層 User Story：設定每週固定營業時間
- 分軌：前端
- 前置任務（dependsOn）：TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006,
  TASK-007, TASK-008, TASK-009, TASK-010, TASK-014
- 狀態：就緒，實作中
- 風險等級：中（新增受保護頁面，讀取既有 `business_hours` 表；沿用既有
  `is_admin()`／`authenticated` RLS 邊界，不新增 anon 可觸及的介面，不涉及任何寫入，
  風險主要來自「這是本 Epic 第一張卡，後續三張卡都建立在這張卡的頁面骨架與資料層之上」）
- Agent owner：Claude Code
- 人工核准者：使用者，2026-08-06（指名要求「繼續做 TASK-018」，視為核准開始實作）

## 目標

在 `/admin/business-hours` 建立受保護的新頁面骨架，唯讀顯示七天目前的 `business_hours`
設定（表格式，比照已核准的 mockup 變體 A），並把 Sidebar 的「營業時間」連結從停用改為
可點擊。新增 `Switch` 元件並登記回 S4 元件庫 inventory。本卡不含任何編輯/儲存邏輯——那是
TASK-019 的範圍。

## 情境包（Context Pack）

- 相關檔案：
  - `app/admin/page.tsx`（既有 `/admin` 頁面的 Server Component 認證檢查模式：呼叫
    `is_admin()` 驗證，未通過導回 `/login`，本卡的新頁面比照同一套模式）
  - `app/admin/_components/AdminDashboard.tsx`（`SIDEBAR_ITEMS` 陣列，`{ label: "營業時間",
    href: "/admin/business-hours", disabled: true }` 這一列要改成 `disabled: false`）
  - `components/ui/Sidebar.tsx`（既有 Sidebar 元件，直接重用，不需要修改）
  - `lib/admin/reschedule-slots.ts` 的 `getBusinessHoursForWeekday()`（既有查詢單一 weekday
    的 `business_hours` 列的既有寫法，本卡新增的 `getAllBusinessHours()` 是同一張表的批次
    版本，查詢邏輯與錯誤處理風格直接沿用，不要另外發明一套）
  - `lib/admin/appointments.ts` 的 `Result<T>`／`AdminError` 型別與 `INTERNAL_ERROR` 泛用
    錯誤常數（沿用同一套錯誤處理慣例）
  - `supabase/migrations/0002_booking_flow.sql` 的 `business_hours` 表定義（`weekday`
    0-6／`open_time`／`close_time`／`is_closed`／`business_hours_valid_range` check
    constraint／`"public read business hours"`＋`"admin full access to business hours"`
    兩個既有 RLS policy，本卡不修改 migration，只需要知道這些既有約束）
  - [`business-hours-variant-a.html`](../mockups/business-hours-variant-a.html)（已核准的
    版型參考，畫面 1「預設」）
  - `ai/context/design-system.md` S4 元件庫 inventory（`Checkbox`／`Radio` 的既有登記方式，
    本卡新增 `Switch` 要比照同樣的表格格式登記回去）
- 既有模式：受保護頁面比照 `app/admin/page.tsx`（Server Component 做 `is_admin()` 檢查，
  通過才 render Client Component）；資料查詢函式比照 `lib/admin/appointments.ts`／
  `lib/admin/reschedule-slots.ts` 的 `Result<T>` 回傳型別與「查詢失敗回傳泛用
  `INTERNAL_ERROR`，不外洩原始 Postgres 錯誤」慣例；載入中用既有 `Skeleton`、錯誤用既有
  `Alert severity="error"`（比照 `WeekCalendar.tsx` 的既有寫法）。
- 假設：`business_hours` 表在正式環境已經被 `npm run seed:booking` seed 過，恆有 7 列資料
  （`weekday` 0-6 各一列），不會是空表；本卡不處理「表是空的」這種空狀態（若真的發生，視為
  錯誤狀態處理，畫面顯示與查詢失敗相同的錯誤訊息即可，不用特別設計空狀態 UI）。
- 未知事項：無。
- 允許變更的檔案：`app/admin/business-hours/page.tsx`（新增）、
  `app/admin/_components/BusinessHoursForm.tsx`（新增，本卡只實作唯讀顯示部分，命名先定下來
  給 TASK-019 擴充編輯功能）、`lib/admin/business-hours.ts`（新增，`getAllBusinessHours()`
  與型別定義）、`app/admin/_components/AdminDashboard.tsx`（僅修改 `SIDEBAR_ITEMS` 那一列的
  `disabled` 值）、`ai/context/design-system.md`（登記 `Switch` 元件到 S4 inventory）、
  `tests/admin/business-hours.test.ts`（新增）。
- 不得觸碰：`lib/admin/week-range.ts`（`isClosedWeekday()` 的技術債修正屬於 TASK-020 範圍，
  本卡不動）；`app/admin/_components/WeekCalendar.tsx`／`AppointmentListView.tsx`（同樣屬於
  TASK-020）；任何寫入 `business_hours` 的邏輯（屬於 TASK-019）。

## 需求

- 新增 `lib/admin/business-hours.ts`：
  - `export type BusinessHoursRow = { weekday: number; open_time: string | null;
    close_time: string | null; is_closed: boolean }`。
  - `getAllBusinessHours(supabase): Promise<Result<BusinessHoursRow[]>>`：查詢
    `business_hours` 表全部 7 列，依 `weekday` 升冪排序，回傳統一的 `Result<T>` 形狀；
    查詢失敗回傳泛用 `INTERNAL_ERROR`。
- 新增 `/admin/business-hours` 頁面：Server Component 做 `is_admin()` 檢查（比照
  `app/admin/page.tsx`），通過後渲染 `BusinessHoursForm`（Client Component）。
- `BusinessHoursForm.tsx`（本卡範圍：唯讀顯示）：
  - 掛載時呼叫 `getAllBusinessHours` 取得七天設定。
  - 表格呈現（比照 mockup 變體 A）：星期／公休（`Switch`，本卡先設為 `disabled` 唯讀，
    僅反映目前值，不可切換）／開店時間／打烊時間（`TextField type="time"`，本卡同樣
    `disabled` 唯讀）。
  - 载入中：`Skeleton` 佔位（7 列）。
  - 錯誤：`Alert severity="error"` 顯示「無法載入營業時間設定，請重新整理再試一次」。
- `AdminDashboard.tsx` 的 `SIDEBAR_ITEMS`：「營業時間」項目 `disabled` 改為 `false`。
- 新做元件登記：於 `design-system.md` S4 元件庫 inventory 新增一列 `Switch`，狀態欄位填
  「開啟/關閉/停用」，來源階段填「TASK-018」，比照既有列格式（型別／用到的 token／檔案
  位置／截圖／來源階段）。

## 驗收標準

- 從 Sidebar 點擊「營業時間」可進入 `/admin/business-hours`，不再顯示為停用連結。
- 頁面正確顯示目前資料庫裡七天的 `business_hours` 設定（開店/打烊時間或「公休」狀態），
  與 `scripts/seed-booking-data.mjs` 的既有種子資料或資料庫實際內容一致。
- 載入中顯示骨架屏；查詢失敗顯示錯誤訊息，不會讓整頁白畫面或拋出未捕捉例外。
- 未登入或非 `is_admin()` 帳號直接訪問 `/admin/business-hours` 會被導回 `/login`（比照既有
  `/admin` 頁面行為）。
- `Switch` 元件已登記回 `design-system.md` 的 S4 元件庫 inventory。
- `npx tsc --noEmit`／`npm run lint`／`npm run build`／`npm test` 皆通過。

## 實作備註

- 本卡的 `Switch`／時間欄位刻意做成 `disabled`（唯讀），不是因為技術限制，而是為了讓
  TASK-018／TASK-019 的範圍界線清楚：本卡只驗證「讀取與畫面骨架正確」，TASK-019 再把
  `disabled` 移除、接上實際的編輯與送出邏輯。不要在本卡順手把互動做完。
- `getAllBusinessHours` 的排序（依 `weekday` 升冪）決定了表格列的顯示順序，但畫面上的
  星期標籤要是「週一至週日」（`weekday` 1-6 接著 0），不是資料庫的「週日至週六」
  （`weekday` 0-6）——沿用 `lib/admin/week-range.ts` 的 `WEEKDAY_LABELS` 陣列或類似對照表
  來做這個顯示順序轉換，不要直接照 `weekday` 數值排序顯示。

## 驗證契約

- 單元測試：`getAllBusinessHours` 的資料轉換與錯誤處理（成功回傳排序後的 7 列、查詢失敗
  回傳 `INTERNAL_ERROR`）；「週一至週日」顯示順序轉換的純函式（若抽成獨立函式）。
- 整合測試：不適用（本卡不涉及寫入，讀取邊界的整合驗證留給 TASK-021）。
- E2E 測試：不適用（涵蓋在 TASK-021）。
- 型別檢查：`tsc --noEmit` 成功。
- Lint：`npm run lint` 成功。
- Build：`npm run build` 成功。
- 螢幕截圖：桌面尺寸截圖預設狀態（七天現況）、載入中骨架屏、錯誤狀態。
- 安全性檢查：確認非 `is_admin()` 角色無法進入頁面（沿用既有 `/admin` 頁面的保護機制）；
  確認查詢錯誤訊息不外洩原始 Postgres 錯誤內容。

## 完成證據

- 變更的檔案：
  - 新增：`lib/admin/business-hours.ts`（`BusinessHoursRow` 型別＋`getAllBusinessHours()`）、
    `app/admin/business-hours/page.tsx`、`app/admin/_components/BusinessHoursForm.tsx`
    （唯讀顯示七天現況，含 `formatTimeInput()` 把 Postgres `time` 欄位的
    `"HH:mm:ss"` 截斷成 `<input type="time">` 期望的 `"HH:mm"`）、
    `tests/admin/business-hours.test.ts`。
  - 修改：`app/admin/_components/AdminDashboard.tsx`（原本 `SIDEBAR_ITEMS` 的「營業時間」
    disabled 改為 false——但實際做法比原始計畫更進一步，見下方「超出原始允許變更的檔案
    清單的必要變動」）、`ai/context/design-system.md`（登記 `Switch` 元件到 S4
    inventory）。
  - **超出原始「允許變更的檔案」清單的必要變動**：新增 `app/admin/layout.tsx`（Server
    Component，`is_admin()` 驗證從 `app/admin/page.tsx` 上移到這裡，涵蓋 `/admin` 底下
    所有頁面）與 `app/admin/_components/AdminShell.tsx`（Client Component，用
    `usePathname()` 推導 Sidebar 的 `active` 狀態，取代原本寫死在 `AdminDashboard.tsx`
    裡的 `active: true`）；連帶簡化了 `app/admin/page.tsx`（移除自己的驗證檢查，只回傳
    `<AdminDashboard />`）與 `app/admin/_components/AdminDashboard.tsx`（移除自己渲染的
    `Sidebar`／外層 flex `Box`／`LogoutButton` import，改成回傳 fragment，仰賴
    `AdminShell` 提供外層版面）。原因：這是 TASK-014 完成證據已記錄的既知殘留風險
    （「Sidebar 導覽項目與 SIDEBAR_ITEMS 目前寫在頁面層，第二個後台頁面出現時應上移到
    `app/admin/layout.tsx` 並用 `usePathname()` 推導 active 狀態，避免複製貼上」）——
    `/admin/business-hours` 正是那個「第二個後台頁面」，若照原計畫在新頁面另外複製一份
    Sidebar／驗證檢查，會直接重現那個已經被記錄、預期要修的技術債，而不是修掉它。已送
    architect／security-reviewer 審查此範圍擴增的決策（見下方）。
- 執行過的指令（皆為審查修正後的最終結果）：
  - `npx tsc --noEmit` → 無錯誤。
  - `npm run lint` → 0 problems。
  - `npx vitest run` → 11 files / 59 tests passed（新增 `tests/admin/business-hours.test.ts`
    3 tests）。
  - `npm run build` → 編譯成功，`/admin` 與 `/admin/business-hours` 皆為 dynamic route。
  - 瀏覽器（Browser 工具）對真實 Supabase 專案手動走查：
    1. 登入 designer001 帳號，Sidebar「營業時間」連結從停用文字變成可點擊連結。
    2. 點擊進入 `/admin/business-hours`，正確顯示七天現況（週一至週六
       10:00–19:00、週日公休），與 `scripts/seed-booking-data.mjs` 種子資料一致；
       時間欄位顯示 `"10:00"`／`"19:00"`（無秒數），公休 Switch 僅週日為開啟狀態，皆為
       `disabled` 唯讀。
    3. Sidebar active 狀態正確切換：`/admin` 顯示「預約」使用中，`/admin/business-hours`
       顯示「營業時間」使用中，並確認 `/admin` 頁面切換週次、標記完成／取消等既有功能
       未受影響（沿用既有 state 邏輯，只是外層版面移到 `AdminShell`）。
    4. 未登入直接訪問 `/admin/business-hours` 正確導回 `/login`（驗證 `layout.tsx` 的
       `is_admin()` 檢查涵蓋新頁面）。
    5. 修正 padding／scroll（見下方 findings）後重新驗證：畫面內距正確（`p:3` = 12px，
       對齊本專案 `theme.spacing(1)=4px` 的間距 scale）、內容可捲動、不再貼齊 Sidebar。
- 審查發現（比照 TASK-016 的審查模式，對超出原始檔案清單的範圍擴增跑 architect／
  security-reviewer 審查）：
  - **architect 審查：核准（2 項必要修正已處理，其餘為記錄性建議）**：(1)
    `BusinessHoursForm.tsx` 原本沒有 padding 也沒有 scroll，在 `AdminShell` 的
    `overflow:hidden` 容器下內容會被裁切、貼齊 Sidebar——已在該元件自己的根 `Box` 補上
    `p:3, overflow:"auto", minHeight:0`（選擇修在頁面元件本身而非改動共用的
    `AdminShell`，避免影響已驗證過的 `/admin` 週曆頁面的既有捲動行為）；(2)
    `open_time`／`close_time` 經 PostgREST 回傳含秒數（`"10:00:00"`），但
    `<TextField type="time">` 期望 `"HH:mm"`，雖然本卡是唯讀不影響顯示，但會在 TASK-019
    接上可編輯狀態時造成資料格式不一致——已新增 `formatTimeInput()` 截斷秒數，提前解決。
    範圍擴增本身判定為「TASK-014 已預先核准的必要修正」，唯一的程序性提醒是應該在任務卡
    上記錄範圍修正並走一次人工核准（已於本節記錄，見下方使用者留言）。其餘記錄性建議：
    `is_admin()` 邊界未動、`proxy.ts` 涵蓋 `/admin/:path*` 未變、`AdminDashboard.tsx` 回傳
    fragment 後的版面鏈（`flex:1, minHeight:0` 對齊 `AdminShell` 的 `main`）正確；
    `AdminError`／`Result` 從 `./appointments` 匯入沿用既有慣例，待第四個模組出現時再考慮
    抽成獨立 `types.ts`；`design-system.md` diff 也順帶把 Sidebar／WeekCalendar 回填標記為
    TASK-014 來源（既有登記的補充說明，非本卡新增內容）。
  - **security-reviewer 審查：核准（2 項非阻擋性建議，已處理 1 項）**：確認
    `app/admin/layout.tsx` 的 `redirect()` 會讓子路由的 RSC 渲染完全中止，無法繞過；沒有
    `route.ts`／parallel routes／route group 能繞過 `/admin` 的 layout；`getAllBusinessHours`
    查詢欄位明確、無 `*`、無 PII、無注入面。**重要澄清**：`business_hours` 的讀取 RLS
    policy 是 `to anon, authenticated using (true)`（供顧客端 `get_available_slots` RPC
    使用），不是 `is_admin()`——`layout.tsx` 的驗證只是 UI 層的存取控制，不是這張表讀取的
    真正資料邊界；真正的權限邊界是既有的「admin full access to business hours」policy，
    只在 TASK-019 接上寫入時才會真正發揮作用，已記錄於此避免後續任務卡誤解。已處理的建議：
    加上 `export const dynamic = "force-dynamic"` 明確宣告動態渲染，作為未來重構
    `createClient()` 不小心變成靜態渲染的攔截網。記錄為殘留風險未處理：目前
    `tests/admin/` 只涵蓋 `lib/` 純函式，沒有針對 `AdminLayout` 這個唯一的驗證關卡本身的
    測試（`!user`／`!isAdmin` 兩種情況各自導向 `/login`），留給後續任務評估是否要建立
    Server Component 測試機制；Next.js layout 在同一 layout 下的 client-side 軟導航
    （例如從 `/admin` 點連結到 `/admin/business-hours`）不會重新執行 `is_admin()`
    檢查，真正的權限邊界仍是 RLS，此處只是 UI 層防呆，記錄為已知限制。
- 已知限制：
  1. `business_hours` 讀取對 anon／authenticated 皆開放（既有 policy，非本卡變更），
     `layout.tsx` 的 `is_admin()` 只是 UI 存取控制；TASK-019 接上寫入時才會真正依賴
     `is_admin()` 的 RLS 邊界，需要在該卡的驗證契約重新確認。
  2. `AdminLayout` 的 client-side 軟導航不會重新檢查 `is_admin()`（同一 layout 下切換
     路由沿用已渲染的結果），真正權限邊界是 RLS，不受影響；記錄供未來參考。
  3. 缺少針對 `AdminLayout` 本身（`!user`／`!isAdmin` 兩種導向 `/login` 的情況）的自動化
     測試，目前僅靠瀏覽器手動走查驗證，留給後續評估是否值得建立 Server Component 測試
     機制。
  4. 螢幕截圖：本次工作階段 Browser pane 的 `screenshot` 工具持續回報 pane not displayed，
     改以 accessibility tree（`read_page`）、`get_page_text`、`javascript_tool`
     讀取實際 DOM 屬性（僅用於讀取驗證，未用於實作互動）取得驗證證據，比照
     TASK-014/015/016/017 的既有做法。
- 後續任務：TASK-019（編輯、驗證與儲存）、TASK-020（技術債修正：後台週曆串接
  `business_hours`）。
