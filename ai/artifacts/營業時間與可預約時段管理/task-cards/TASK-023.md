# AI-Ready 任務卡

## Metadata

- 任務：營業時間與可預約時段管理 月曆選取器元件（MonthPicker，S4 新元件，純前端）
- 上層規格：[`screen-spec-營業時間設定.md`](../screen-spec-營業時間設定.md)、
  [`mockup-decision-特殊公休日.md`](../mockup-decision-特殊公休日.md)（已核准變體 B）
- 上層 Epic：營業時間與可預約時段管理
- 上層 User Story：設定公休日／特殊假期
- 分軌：前端
- 前置任務（dependsOn）：TASK-021
- 狀態：完成（2026-08-07 人工核准）
- 風險等級：低（純展示型元件，props 驅動，不呼叫 Supabase、不涉及資料寫入；不影響任何
  既有畫面）
- Agent owner：待指定
- 人工核准者：待指定

## 目標

依 `mockup-decision-特殊公休日.md` 選定的變體 B，新做一個月曆選取器元件（月檢視、可點選
標記日期、跨月導覽、今天標示、過去日期停用），登記回 `design-system.md` 的 S4 元件庫
inventory。本卡是純前端展示元件，不串接 `closed_dates` 資料、不處理受影響預約警告，這些
留給 TASK-025。

## 情境包（Context Pack）

- 相關檔案：
  - `lib/admin/week-range.ts`（`buildWeekDays`／`addDays`／`getWeekday`／`getTaipeiToday`
    等純函式是本卡 `lib/admin/month-range.ts` 的直接範本：同樣的「解析 YYYY-MM-DD 當 UTC
    午夜做日期運算」寫法，避開時區位移問題）
  - `app/admin/_components/WeekCalendar.tsx`（今天標示 `outline: primary.main` 的既有做法、
    公休日視覺弱化的既有配色邏輯，是本卡「今天」「已標記」兩種狀態視覺的參考）
  - `ai/artifacts/營業時間與可預約時段管理/mockups/business-hours-closures-variant-b.html`
    （已核准的視覺規格：CSS class `cal-day`／`cal-day.today`／`cal-day.closed`／
    `cal-day.muted`，色彩用 `--warning`/`--warning-light`（已標記）、`--primary-500`
    outline（今天）、`--grey-500`（過去日期/月份外的補位格））
  - `app/design-system/page.tsx`（既有元件展示頁，本卡完成後要在這裡加一個 MonthPicker
    展示區塊，格式比照既有 Table／Card 等區塊的既有寫法）
  - `ai/context/design-system.md` 的 S4 元件庫 inventory 表格（本卡完成後在表格新增一列，
    格式比照既有列，例如 `Sidebar`／`WeekCalendar` 那兩列的欄位填寫方式）
- 既有模式：`lib/theme/tokens.ts`（design token 原始值）、`lib/theme/index.ts`（MUI theme
  映射）——所有色彩／間距／圓角／陰影一律從 `theme.palette`／`theme.spacing`／
  `theme.shape.borderRadius` 等既有 theme 物件取值，不寫死 hex／px（比照 `WeekCalendar.tsx`
  用 `sx={{ bgcolor: "grey.200", outlineColor: "primary.main" }}` 這種寫法，不直接寫
  `#EFEAE2` 這類字面值）。
- 假設：
  - 月曆一次只顯示一個月（不支援同時顯示多月），跨月導覽用「‹」「›」箭頭切換，比照 mockup。
  - 「今天以前的日期」一律停用（不可點選、視覺弱化），不需要額外的 `minDate` 參數彈性——
    這個元件目前只有「特殊公休日」一種用途，YAGNI，若未來有其他用途需要不同的
    最小可選日期，屆時再擴充 props。
  - 星期標題順序「日一二三四五六」（比照 mockup，與 `WEEKDAY_LABELS`
    `["日","一","二","三","四","五","六"]` 一致，`WEEKDAY_LABELS` 從 `lib/admin/week-range.ts`
    import 重用，不重新定義一份）。
  - 元件本身是受控元件（controlled component）：目前顯示的年月由父層透過 props 控制
    （`year`／`month`），點擊導覽箭頭時透過 `onMonthChange` 回呼通知父層，不在元件內部
    自行管理年月 state——比照 `AdminDashboard.tsx` 的 `weekStart` 由頁面層 state 控制、
    `WeekCalendar` 純展示的既有架構慣例。
- 未知事項：無。
- 允許變更的檔案：
  - `lib/admin/month-range.ts`（新增）
  - `components/ui/MonthPicker.tsx`（新增）
  - `tests/admin/month-range.test.ts`（新增）
  - `app/design-system/page.tsx`（新增 MonthPicker 展示區塊）
  - `ai/context/design-system.md`（S4 inventory 新增一列）
- 不得觸碰：`app/admin/business-hours/`／`BusinessHoursForm.tsx`（串接留給 TASK-025）、
  `lib/admin/closed-dates.ts`（TASK-022 範圍，本卡不呼叫，元件是 props 驅動的純展示）、
  `app/admin/_components/WeekCalendar.tsx`（本卡只參考其視覺模式，不修改該檔案）。

## 需求

- `lib/admin/month-range.ts`：
  - `export type MonthDay = { date: string; day: number; weekday: number };`
  - `buildMonthDays(year: number, month: number): MonthDay[]`——回傳該年月「1 號到月底」
    每一天，`month` 為 1-12（非 JS Date 的 0-11，避免呼叫端心智負擔）。
  - `getPreviousMonth(year: number, month: number): { year: number; month: number }`／
    `getNextMonth(...)`——處理跨年邊界（1 月的上個月是去年 12 月，12 月的下個月是明年 1
    月）。
  - `formatMonthLabel(year: number, month: number): string`——回傳 `"2026 年 8 月"` 格式
    （比照 mockup）。
- `components/ui/MonthPicker.tsx`：
  ```ts
  export type MonthPickerProps = {
    year: number;
    month: number; // 1-12
    todayDate: string; // "YYYY-MM-DD"，由呼叫端傳入（比照 getTaipeiToday() 的既有呼叫模式，
                        // 元件本身不呼叫 new Date()，維持可測試、可控）
    markedDates: Set<string>; // 已標記（例如已設定特殊公休日）的日期
    onDayClick: (date: string) => void; // 點擊「今天或未來」的日期時觸發；過去日期不觸發
    onMonthChange: (year: number, month: number) => void;
  };
  export function MonthPicker(props: MonthPickerProps): JSX.Element;
  ```
  - 月首前的空白格（例如該月 1 號是週三，週日/一/二三個空格）用不可點選的 muted 格填滿，
    比照 mockup 的 `cal-day muted` 視覺（不需要顯示上個月的實際日期數字，維持最簡單版面，
    這是本卡的合理簡化，若未來需要顯示相鄰月日期可再擴充）。
  - 日期格三種視覺狀態（互斥，依優先序）：「今天」（`outline: 2px solid`,
    `theme.palette.primary.main`，比照 `WeekCalendar.tsx` 既有寫法）、「已標記」
    （`bgcolor: warning.light`, `color: warning.main`, 字重 700，右下角小圓點，比照
    mockup 的 `cal-day.closed`）、「過去日期」（`color: grey.500`, 不可點選，`cursor:
    default`）。今天且已標記時，兩種視覺同時套用（outline + warning 底色）。
  - 使用 MUI `Box`／`Typography` 等基礎元件拼版面（比照 `WeekCalendar.tsx`／`Sidebar.tsx`
    的既有做法，不引入新的 UI 套件），`display: grid; grid-template-columns: repeat(7,
    1fr)`。
- `app/design-system/page.tsx`：新增一個「MonthPicker」展示區塊，帶 2-3 個已標記日期的
  範例資料，示範今天標示、已標記、過去日期三種視覺。
- `ai/context/design-system.md`：S4 元件庫 inventory 表格新增一列 `MonthPicker`，欄位填寫
  比照既有列（狀態：已完成；涵蓋狀態：預設/今天標示/已標記/過去日期停用/跨月導覽；用到的
  token；檔案位置；截圖位置填 `app/design-system` MonthPicker 區塊；來源階段填
  `TASK-023`）。

## 驗收標準

- `MonthPicker` 元件可正確渲染任意年月的完整日期格（含跨年邊界，例如 2026 年 1 月、12
  月）。
- 今天、已標記、過去日期三種視覺狀態正確且可同時疊加（今天且已標記）。
- 點擊過去日期不觸發 `onDayClick`；點擊今天或未來日期正確觸發並回傳正確的 `date` 字串。
- 點擊「‹」「›」正確觸發 `onMonthChange` 並處理跨年邊界。
- `/design-system` 頁面正確顯示 MonthPicker 展示區塊，無 console 錯誤。
- `npx tsc --noEmit`／`npm run lint`／`npm run build`／`npm test` 皆通過。

## 實作備註

- `buildMonthDays`／`getPreviousMonth`／`getNextMonth` 是本卡validation 重點：日期運算
  一律用 `Date.UTC(year, month - 1, day)` 的既有寫法（比照 `week-range.ts` 的
  `parseDateUTC`/`formatDateUTC`），不要用 `new Date(year, month, day)`（本地時區建構子）
  或字串拼接後直接 `new Date(str)`，避免夏令時間／時區位移風險（雖然 Asia/Taipei 全年無
  DST，但維持與既有純函式一致的寫法習慣，降低未來複製貼上到有 DST 地區時出錯的風險）。
- 這是本卡唯一會被 TASK-025 直接消費的產出，介面設計要以 TASK-025 的實際使用情境為準：
  TASK-025 會把 `markedDates` 綁定到 `closed_dates` 讀出的 `Set<string>`、`onDayClick`
  綁定到「點擊已標記的日期＝移除，點擊未標記的日期＝新增」的切換邏輯（元件本身不知道
  「標記」對呼叫端代表什麼語意，只負責回報使用者點了哪一天，語意判斷留給呼叫端）。

## 驗證契約

- 單元測試：`tests/admin/month-range.test.ts` 涵蓋 `buildMonthDays`（一般月份、2 月平年/
  閏年、月首非週日的补位邏輯由元件層處理不在此測，這裡只測純日期清單）、
  `getPreviousMonth`／`getNextMonth`（含跨年邊界）、`formatMonthLabel`。
- 整合測試：不適用（純前端、不呼叫 Supabase）。
- E2E 測試：不適用（本卡無實際頁面串接，串接後的 E2E 走查留給 TASK-025／TASK-027）。
- 型別檢查：`tsc --noEmit` 成功。
- Lint：`npm run lint` 成功。
- Build：`npm run build` 成功。
- 螢幕截圖：`/design-system` 頁面 MonthPicker 展示區塊桌面尺寸截圖（今天/已標記/過去日期
  三種視覺皆可見）。
- 安全性檢查：不適用（純展示元件，無資料存取）。

## 完成證據

- 變更的檔案：
  - `lib/admin/month-range.ts`（新增）
  - `components/ui/MonthPicker.tsx`（新增）
  - `tests/admin/month-range.test.ts`（新增）
  - `app/design-system/page.tsx`（新增 MonthPicker 展示區塊）
  - `ai/context/design-system.md`（S4 inventory 新增 MonthPicker 一列）
- 執行過的指令：`npx tsc --noEmit`、`npm run lint`、`npm test`、`npm run build`，皆通過。
- 測試輸出：既有 12 個測試檔（含新增 `tests/admin/month-range.test.ts` 7 個測試）、共 82 個
  測試全數通過。
- 瀏覽器走查：本機 `npm run dev` 開啟 `/design-system`，MonthPicker 區塊：
  - 無 console 錯誤。
  - light mode 下用 `getComputedStyle` 逐一比對今天（outline 2px solid `primary.main`
    `rgb(169,129,47)`）、已標記（`bgcolor: warning.light` `rgb(246,232,214)`、
    `color: warning.main` `rgb(201,122,61)`、字重 700、右下角小圓點）、過去日期
    （不可點選）、一般日期，四種視覺狀態的實際渲染色值與 `lib/theme/tokens.ts` 的 design
    token 逐項相符，也與已核准 mockup（`business-hours-closures-variant-b.html`）的
    `.cal-day` 系列 class 一致。
  - **人工驗收回饋修正**（使用者回報「月曆裡面的數字顏色太淺不太清楚」）：初版一般日期／
    過去日期用 `bgcolor: grey.100`／`color: grey.500`，這兩個 token slot 在
    `lib/theme/index.ts` 的暗色 `colorScheme` 沒有覆寫（design-system.md 記錄的既知限制），
    暗色模式下會 fallback 回 MUI 預設灰階，跟本專案暗色模式近白的 `text.primary`
    （`#F3EEE6`）配色不搭——數字幾乎融入背景，這正是使用者回報的「太淺看不清楚」。改用
    `bgcolor: background.paper`／`color: text.disabled`（過去日期）：這兩個 slot 在
    light／dark 都有明確定義，且語意上也更正確（過去日期本來就是停用狀態）。修正後用
    `getComputedStyle` 分別在 light／dark 兩種 `prefers-color-scheme` 下重新量測：
    - dark：一般/今天日期 `bg rgb(42,36,31)`（`background.paper` 暗色值）、
      `color rgb(243,238,230)`（`text.primary` 暗色值，高對比）；過去日期
      `color rgb(138,128,116)`（`text.disabled` 暗色值，清楚可辨識但視覺弱化）。
    - light：`bg rgb(255,255,255)`（`background.paper`），比修正前的 `grey.100`
      （跟頁面背景色幾乎同色、卡片本身難以與頁面背景區分）更清楚地與頁面背景
      `rgb(246,243,238)` 區隔；文字色不變。
  - 互動驗證：點擊過去日期不觸發 `onDayClick`（背景色無變化）；點擊今天或未來日期正確
    觸發並切換標記狀態；點擊「‹」「›」正確觸發 `onMonthChange`，連續切換 8→9→10 月，
    10 月正確顯示 31 天。
  - 鍵盤可及性：`role="button"`／`tabIndex`／`onKeyDown`（Enter/Space）；focus-visible 樣式
    透過瀏覽器 CSSOM 檢查確認正確解析為 `box-shadow: rgb(169,129,47) 0 0 0 2px`
    （`primary.main`）——這是本卡實作時依 `ai/checklists/design-review-checklist.md`
    「互動五態」項目主動補上的（mockup 本身的純 HTML/CSS 版本沒有涵蓋鍵盤操作，任務卡
    需求也未明列，但既有可點擊日期格屬於本元件的主要互動介面，比照該檢查清單的一般要求
    補齊）。
  - 自我審查依 `ai/checklists/design-review-checklist.md` 逐項對照時，發現並修正一個與
    mockup 的間距落差：初版 `cal-grid` 的 `gap` 誤用 `0.5`（= 2px），已修正為 `1`
    （= 4px），與 mockup 的 `.cal-grid { gap: 4px }` 一致。
  - 未能取得實際螢幕截圖（本次環境瀏覽器分頁 compositing 逾時失敗，`computer screenshot`
    工具本身不可用），改以 `getComputedStyle`／CSSOM 逐項比對取代視覺截圖佐證；建議下次
    有可用截圖環境時補拍存證。
- 已知限制：
  - 一般／過去日期的暗色模式對比已修正（見上），但「已標記」狀態仍用 `warning.light`／
    `warning.main`（比照 mockup 的配色語意），這兩個 slot 在暗色模式一樣沒有覆寫，
    fallback 回 MUI 預設 warning 色階時，經計算對比度僅約 1.12:1（幾乎不可辨識，遠低於
    WCAG AA 的 4.5:1）。這屬於同一個「`lib/theme/index.ts` 的 `dark` colorScheme 未覆寫
    `grey`／`warning`」既知限制（`ai/context/design-system.md` 第 91-93 行），影響範圍是
    既有所有用到這兩個色階的 S4 元件（含 `WeekCalendar`），不只 MonthPicker。本卡刻意不
    直接改標記狀態的顏色語意（會偏離已核准 mockup 的配色決策），也不修改共用的
    `lib/theme/index.ts`（超出本卡允許變更檔案清單，且暗色 grey/warning 色階需要獨立的
    設計決策，不是本卡能單方面決定的顏色值）；若要徹底解決，需要另立任務卡擴充
    `lib/theme/index.ts` 暗色 `colorScheme` 的 `grey`／`warning` 覆寫。
  - 月首前的補位空白格（`leadingBlanks`）刻意不顯示上個月的日期數字，是任務卡明載的合理
    簡化（YAGNI），非缺陷。
- 後續任務：TASK-025（設定頁串接）依賴本卡。
