# 設計系統（Design System）

由 Epic 0「專案設置」的「UI 設計系統」User Story 分五階段（框架 → 風格 → design token → 元件庫 → 版面）逐步填寫。**這份文件是後續所有功能 Epic 做 UI 時的單一事實來源**：任何前端任務開工前都要先讀它，能用既有 token／元件就必須用；缺的元件要照既有風格補做並登記回這裡（見 `ai/skills/project-kickoff.md` 步驟 6 與 `ai/skills/ui-mockup-gate.md`）。

狀態：S1、S2、S3 已核准；S4-S5 仍是範本佔位符，待後續任務卡逐階展開。

## S1 底層框架

- UI 框架：React（Next.js 16，App Router + TypeScript；已由 TASK-001 確立，本階段不重新討論）
- 元件庫策略：採用現成——MUI（Material UI）v9
- 樣式方案：MUI 內建的 Emotion（CSS-in-JS），透過 `@mui/material-nextjs` 的
  `AppRouterCacheProvider` 處理 App Router 的 SSR 樣式插入
- 考慮過的選項：
  | 選項 | 優點 | 缺點 |
  |---|---|---|
  | **MUI（選定）** | 現成元件最齊全（尤其 DataGrid、複雜表單），後台（表格、表單、Modal）開發速度快；App Router 官方有 `@mui/material-nextjs` 整合套件 | Material Design 既定美術風格，客製成顧客前台的品牌感較費工；CSS-in-JS 在 App Router 需要額外的 SSR cache provider 設定；多數元件得標記為 Client Component，較難完全發揮 RSC 的效能優勢；bundle 較重 |
  | shadcn/ui + Tailwind CSS | 元件原始碼直接複製進 repo，基於 Radix UI 無障礙 primitive，可逐一標記 Server/Client Component，對 App Router/RSC 最友善，無 SSR CSS-in-JS 額外設定；Tailwind theme 設定天然銜接 S3 design token 階段；客製彈性高 | 元件庫是「複製進來自己維護」，不是裝了就有，S4 階段仍需逐一組裝/登記；生態系偏向由團隊自行把關一致性 |
  | Ant Design | 後台管理介面元件非常齊全（表格、表單、篩選器皆強），對「設計師後台」這塊很合適 | 預設風格企業感較重，顧客前台要做出行動裝置友善、有品牌感的體驗需要大量客製；v5 的 CSS-in-JS 在 App Router 同樣需要額外設定；顧客端與後台風格要調和成一致的視覺語言，工程量較大 |
- 選定理由：人工核准選擇 MUI，優先考量後台（服務項目、預約、顧客管理）大量會用到表格、
  表單、Modal 等元件，MUI 現成元件齊全可加快這塊的開發速度；顧客前台的品牌客製化與行動裝置
  體驗留待 S2（風格方向）與 S3（design token）階段透過 MUI 的 `ThemeProvider` 客製化處理，
  而不是重新選型。
- 已完成的最小可行安裝驗證（不含視覺實作，視覺留給 S2 之後）：
  - 安裝 `@mui/material@9.2.0`、`@emotion/react@11.14.0`、`@emotion/styled@11.14.1`、
    `@mui/material-nextjs@9.1.1`（版本鎖定，與既有 Supabase 套件的做法一致）。
  - 在 `app/layout.tsx` 用 `@mui/material-nextjs/v16-appRouter` 的 `AppRouterCacheProvider`
    包住 `children`——這是 MUI 在 App Router 下 SSR 樣式插入的必要基礎設施，不屬於視覺實作。
  - `npx tsc --noEmit`、`npm run lint`、`npm run build` 皆通過；瀏覽器手動確認首頁載入無
    hydration 警告或 console 錯誤。
  - 尚未加入 `ThemeProvider`／自訂主題／任何 MUI 元件用法，留給 S2（風格方向）與 S3
    （design token）階段決定主題內容後再串接。
- 人工核准：使用者，2026-08-05

## S2 風格方向

- 選定的 style tile：變體 A「質感沉靜」（`ai/artifacts/專案設置/mockups/style-tile-a.html`）
- 色彩情緒：溫暖大地色系（ink #2B2622／bg #F6F3EE／border #E4DDD1）＋低調金屬金強調色（accent #A9812F），輔以灰綠 success（#7A8B76）
- 字體個性：標題用襯線字體（Noto Serif TC 700），內文用無襯線（Noto Sans TC 400/500）；中文字距 0；PingFang TC／微軟正黑體 fallback；標題行高 1.25、內文行高 1.7
- 圓角／陰影傾向：圓角 8–12px（按鈕 8px、卡片 12px）；Depth 採柔和陰影（shadow-only，不疊邊框），模擬自然光源
- 密度：舒適（間距自 20–24px 起跳，卡片內距 24px 起）
- 亮／暗模式：兩者皆已於 style tile 實作並在瀏覽器驗證；暗色模式維持相同色相，僅調整明度／飽和度，金色強調色在深色底上提亮
- 參考產品：Fresha（預約流程的沉穩留白與資訊層次）、Aesop 官網（大地色系與襯線標題的品牌質感）
- 選定理由：人工核准變體 A，相較 B（現代簡約，效率感強但顧客前台品牌辨識度較弱）與 C（溫暖放鬆，親和力強但後台密度效率較低），A 的專業質感與舒適密度較符合顧客前台建立信任感的需求；後台（表格/表單密集場景）留待 S3 token／S4 元件階段視需要為密度做細部調整，不另立第二套風格
- 決策紀錄：`ai/artifacts/專案設置/mockup-decision-style-direction.md`
- 人工核准：使用者，2026-08-05

## S3 Design Token 清單

延續 S2 選定的變體 A「質感沉靜」。完整原始值見 `lib/theme/tokens.ts`（單一事實來源，
異動請與本節同步更新）；視覺預覽見
`ai/artifacts/專案設置/mockups/design-token-showcase-s3.html`。

### Primitive Token

| 類別 | Token | 值 | 備註 |
|---|---|---|---|
| 色彩：grey | grey.50–grey.900 | #FBF9F6 → #2B2622（10 階） | 暖灰階，取自 S2 tile A 的 ink/bg/border |
| 色彩：primary | primary.50–primary.900 | #FBF4E2 → #38290F（10 階，500=#A9812F 為 main） | 低調金屬金 |
| 色彩：success | light #E4EBE1／main #7A8B76／dark #57644F | contrastText #FFFFFF | |
| 色彩：warning | light #F6E8D6／main #C97A3D／dark #9C5C29 | contrastText #FFFFFF | |
| 色彩：danger | light #F3DEDA／main #B3462E／dark #8A3320 | contrastText #FFFFFF | |
| 色彩：info | light #E1E8ED／main #5B7C99／dark #43617A | contrastText #FFFFFF | |
| 字級 | xs 11／sm 12／sm+ 13／base 14／md 16／lg 18／xl 20／2xl 24／3xl 30／4xl 36／5xl 48 | px | type scale，只用這 11 階 |
| 字重 | regular 400／medium 500／semibold 600／bold 700 | | |
| 行高 | heading 1.25／subheading 1.3／body 1.7／dense 1.5 | | 中文字距一律 0 |
| 間距 | 4／8／12／16／20／24／32／40／48／64 | px | 4 的倍數 scale；MUI `theme.spacing(1)` = 4px |
| 圓角 | sm 8（按鈕／輸入框）／md 12（卡片／Modal） | px | 對齊 S2 選定範圍 |
| 陰影 | elevation1 `0 8px 24px rgba(43,38,34,.10),0 2px 6px rgba(43,38,34,.06)`／elevation2 `0 16px 40px rgba(43,38,34,.16),0 4px 10px rgba(43,38,34,.08)` | 暗色模式對應值見 `tokens.ts` | shadow-only，不疊邊框 |
| z-index | appBar 1100／drawer 1200／modal 1300／snackbar 1400／tooltip 1500 | | 沿用 MUI 預設，不另立一套 |
| 動效 | duration short 150ms／base 200ms／long 300ms；easing standard/decelerate/accelerate 沿用 MUI 預設曲線 | | |

### Semantic Token

| Token | 對應 primitive | 用途 |
|---|---|---|
| color.primary | primary.500（main）／primary.300（light）／primary.700（dark） | 主要互動色（按鈕、連結、強調） |
| color.surface | background.default = grey.100／background.paper = #FFFFFF | 頁面底色／卡片底色 |
| color.danger | danger（error） | 錯誤狀態、危險操作 |
| color.text.primary/secondary/disabled | grey.900／grey.700／grey.500 | 文字階層 |
| color.divider | grey.300 | 邊框、分隔線 |
| space.page | 24（行動裝置）／40（桌面） | 頁面外距 |
| space.card | 24 | 卡片內距 |

### 暗色模式 Primitive Token

延續同一份色相語彙，暗色模式的 `grey`／`success`／`warning`／`danger`（error）／`info` 另外
在 `lib/theme/index.ts` 的 dark colorScheme 定義（不是重用亮色模式的 hex 值，因為暗色底需要
反過來的明暗方向）；完整原始值與設計理由見該檔案的行內註解。摘要：

| 類別 | 值 | 備註 |
|---|---|---|
| 色彩：grey | grey.50 #17140F → grey.900 #F3EEE6（10 階） | 50/100 貼近暗色 background（深）、900 貼近暗色 text.primary（近白），與亮色模式相反方向；100=background.default、300=divider、500=text.disabled、700=text.secondary |
| 色彩：success | light #232A1E／main #9DB393／dark #6F8567 | contrastText #201C18 |
| 色彩：warning | light #3A2A1C／main #E0A868／dark #B37C42 | contrastText #201C18 |
| 色彩：danger | light #35201A／main #E37A5C／dark #A85138 | contrastText #201C18 |
| 色彩：info | light #202A32／main #7FA3BE／dark #5B7C99 | contrastText #201C18 |

light↔main 與 main↔contrastText 皆量測 WCAG 對比 ≥ 4.5:1（AA），修正 TASK-023 review 發現的
MonthPicker 已標記日期徽章（`warning.light`+`warning.main`）在暗色模式 fallback 回 MUI 預設
橙色、對比僅約 1.12:1 的問題；同批修正涵蓋 WeekCalendar 公休格背景（`grey.200`）等其他既有
用到這些色槽的暗色模式元件。

### 實際 token 檔位置

- Primitive token 原始值：[`lib/theme/tokens.ts`](../../lib/theme/tokens.ts)（亮色模式）
- MUI theme（primitive → semantic 映射，含 light/dark colorSchemes；暗色模式的 grey/success/
  warning/danger/info/primary/background/text/divider 直接定義於此檔）：
  [`lib/theme/index.ts`](../../lib/theme/index.ts)
- Provider 掛載（client boundary，避免 theme 物件跨 RSC 邊界序列化錯誤）：[`lib/theme/ThemeRegistry.tsx`](../../lib/theme/ThemeRegistry.tsx)，於 `app/layout.tsx` 套用
- 中文字體：`next/font/google` 的 Noto Sans TC（內文）／Noto Serif TC（h1/h2 標題），
  PingFang TC／微軟正黑體 fallback；`html lang="zh-Hant"`
- 已知限制：MUI `theme.shadows`（0–24 完整 elevation tuple）尚未展開，目前只定義 S2 已核准的
  elevation1/2；若 S4 元件確實需要更多階，屆時再依實際需求擴充，避免現在過度設計。
- 人工核准：使用者，2026-08-05

## S4 元件庫 Inventory

每做一個核心元件就登記一列。後續 Epic 缺元件、照風格補做後也要回來補登。

視覺展示頁：[`app/design-system`](../../app/design-system/page.tsx)（本機 `npm run dev` 後訪問
`/design-system`）。策略：直接使用 MUI 元件＋`lib/theme` 主題設定即可涵蓋樣式的項目不另建
wrapper（避免不必要抽象）；MUI 沒有對應單一元件的組合模式（Nav／Modal 確認流程／Form 版面／
Toast 佇列）才在 `components/ui/` 新增客製元件。

| 元件 | 狀態 | 涵蓋狀態 | 用到的 token | 檔案位置 | 截圖 | 來源階段 |
|---|---|---|---|---|---|---|
| Button | 已完成 | 預設/outlined/text/danger/停用/載入（`loading` prop） | primary/error 色、radius.sm、typography.button | 直接用 `@mui/material/Button`；樣式來自 `lib/theme/index.ts` 的 `MuiButton` override | `app/design-system` Button 區塊 | S4 |
| Input | 已完成 | 預設/停用/錯誤（`error`+`helperText`） | grey/primary 色、radius.sm、typography | 直接用 `@mui/material/TextField`；樣式來自 theme | `app/design-system` Input 區塊 | S4 |
| Select | 已完成 | 預設/開啟選單/選取切換（單元測試涵蓋） | grey/primary 色、radius.sm | 直接用 `@mui/material/Select`＋`MenuItem`；樣式來自 theme | `app/design-system` Select 區塊；測試見 `tests/components/select.test.tsx` | S4 |
| Checkbox/Radio | 已完成 | 勾選/未勾選/停用（Checkbox 與 Radio 皆涵蓋） | primary 色 | 直接用 `@mui/material/Checkbox`／`Radio`；樣式來自 theme | `app/design-system` Checkbox/Radio 區塊 | S4 |
| Switch | 已完成 | 開啟/關閉/停用 | primary 色 | 直接用 `@mui/material/Switch`；不需要額外 theme override（沿用 `Checkbox`／`Radio` 當初做法，MUI 元件預設讀取 `theme.palette.primary`） | `/admin/business-hours`（營業時間設定頁的公休切換） | TASK-018 |
| Card | 已完成 | 預設（含 hover 由 theme 陰影統一處理）；`CardActionArea` 可點擊選取狀態（顧客前台服務卡片） | radius.md、elevation1 陰影 | 直接用 `@mui/material/Card`／`CardActionArea`；樣式來自 `MuiCard` override | `app/design-system` Card 區塊；`CardActionArea` 選取態見 `/`（顧客前台服務列表） | S4 |
| Nav | 已完成 | 預設（含連結 hover/active 狀態） | grey.divider、primary 色、typography.subtitle2 | `components/ui/Nav.tsx`（MUI 未提供單一 Nav 元件，客製 AppBar+Toolbar 組合） | `app/design-system` 頁首 | S4 |
| Modal/Dialog | 已完成 | 開啟/關閉/loading（單元測試涵蓋）；可選 `children` 插槽渲染於 description 下方，供結構化內容（例如清單）使用，純文字仍用 `description` | radius.md、elevation2 陰影 | `components/ui/ConfirmDialog.tsx`（客製確認對話框 pattern，內部用 MUI Dialog） | `app/design-system` Modal/Dialog 區塊；測試見 `tests/components/confirm-dialog.test.tsx`；`children` 插槽用法見 `/admin/business-hours` 的受影響預約警告 | S4（`children` 插槽：TASK-019） |
| Table | 已完成 | 預設 | grey 色、typography | 直接用 `@mui/material/Table` 系列元件；樣式來自 theme | `app/design-system` Table 區塊 | S4 |
| Form | 已完成 | 預設欄位間距／標籤慣例 | spacing scale（4 的倍數） | `components/ui/FormSection.tsx`（客製表單版面間距 pattern） | `app/design-system` Form 區塊 | S4 |
| Toast/Alert | 已完成 | success/warning/error/info 四種 severity；全域佇列（一次顯示一則） | semantic 色（success/warning/danger/info） | `components/ui/ToastProvider.tsx`（客製全域 toast 佇列，內部用 MUI Snackbar+Alert），掛載於 `lib/theme/ThemeRegistry.tsx` | `app/design-system` Toast/Alert 區塊 | S4 |
| Chip | 已完成 | 預設/選取（filled+primary）/未選取（outlined） | primary 色、radius.sm | 直接用 `@mui/material/Chip`；樣式來自 theme | `/`（顧客前台選時段日期 chip 列） | TASK-011 |
| Skeleton | 已完成 | rounded 變體，用於資料載入中的區塊佔位 | radius.sm/md | 直接用 `@mui/material/Skeleton` | `/`（顧客前台服務列表／選時段載入中狀態） | TASK-011 |
| Sidebar | 已完成 | 預設（使用中／停用／hover 狀態），登出項目渲染既有 `LogoutButton`；底部個人資料區塊（大頭貼＋顯示名稱，`profileName`／`profileAvatarUrl` 選填 props，未傳入時不渲染）；導覽項目圖示＋文字並排（`icon` 選填 prop，呼叫端傳入，未傳入時純文字渲染），文字 16px（`typeScale.fontSize.md`）、圖示 20px、垂直內距 12px（`py:3`），標題文字 18px（`typeScale.fontSize.lg`） | grey/primary 色、`typeScale.fontSize.md`/`lg`、`spacingScale`；個人資料區塊另用 MUI `Avatar` | MUI 沒有對應單一元件，比照 `components/ui/Nav.tsx` 用 `Box`／`List`／`ListItemButton` 拼出：`components/ui/Sidebar.tsx`；個人資料區塊直接用 MUI `Avatar`；6 個導覽圖示（手繪 SVG，比照 `ColorModeToggle.tsx` 慣例，不安裝 `@mui/icons-material`）定義在呼叫端 `app/admin/_components/AdminShell.tsx` | `/admin` 後台頁面 | TASK-014；個人資料區塊 TASK-038；圖示化＋字級調整 TASK-064 |
| WeekCalendar | 已完成 | 預設（今天標示、公休日弱化）、載入中（Skeleton）、空狀態（該週無預約） | grey/primary 色、success/warning/danger 狀態色（透過 Chip）、radius.sm/md、elevation1 陰影 | MUI 沒有現成週曆格狀元件，用既有 `Card`／`CardActionArea`／`Chip` 組合：`app/admin/_components/WeekCalendar.tsx`（本頁面專用，非跨頁共用，未放入 `components/ui/`） | `/admin` 後台頁面（週曆檢視） | TASK-014 |
| MonthPicker | 已完成 | 預設/今天標示/已標記/過去日期停用/跨月導覽（含跨年邊界） | grey/primary/warning 色、radius.sm | MUI 沒有現成月曆格狀選取元件，比照 `WeekCalendar.tsx` 的 Box grid 拼版面模式客製：`components/ui/MonthPicker.tsx`（跨頁共用，放入 `components/ui/`）；日期運算純函式見 `lib/admin/month-range.ts` | `app/design-system` MonthPicker 區塊 | TASK-023 |
| ImageUploadField | 已完成 | 預設（虛線邊框拖放區）／上傳中（遮罩＋`CircularProgress`）／預覽（縮圖＋更換／移除按鈕）／錯誤（邊框變色＋行內錯誤文字） | grey/error 色、radius.sm | MUI 沒有現成檔案上傳元件，本專案首次檔案上傳功能，依既有 token 客製：`components/ui/ImageUploadField.tsx`（跨頁共用，放入 `components/ui/`；目前唯一使用場景是商店設定頁的 Logo／封面圖，元件本身不寫死 store_settings 以外的假設）；驗證與上傳／移除純函式見 `lib/store-settings.ts` | `/admin/store-settings`（商店設定頁「品牌圖片」卡片） | TASK-031 |
| PasswordStrengthMeter | 已完成 | 弱／中／強三階（依密碼長度與字元種類數計算，`password` 為空字串時不渲染） | success/warning/danger 色、radius（bar 用 999 圓角） | MUI 沒有現成密碼強度元件，依既有 token 客製：`components/ui/PasswordStrengthMeter.tsx`（跨頁共用，放入 `components/ui/`；供重設密碼頁與 TASK-042 帳號設定頁修改密碼共用）；強度計算純函式見 `lib/auth/password-strength.ts`，單元測試見 `tests/lib/password-strength.test.ts` | `app/design-system` PasswordStrengthMeter 區塊；`/reset-password`（設定新密碼頁） | TASK-040 |
| OtpInput | 已完成 | 6 格獨立輸入框：預設／錯誤（`error`）／停用（`disabled`）；支援貼上完整驗證碼自動分配到各格、輸入後自動跳下一格、Backspace 於空格時跳回上一格 | grey/primary/error 色（沿用既有 Input 的 `MuiTextField`／`MuiOutlinedInput` theme override，未另建客製邊框） | MUI 沒有現成多格 OTP 輸入元件，用既有 `TextField` 逐格拼裝：`components/ui/OtpInput.tsx`（跨頁共用，放入 `components/ui/`；供 TASK-043 帳號設定頁 MFA 註冊確認與停用二次確認、TASK-044 登入 MFA 挑戰步驟共用）；貼上分配邏輯抽成純函式 `distributeOtpPaste`，單元測試見 `tests/components/otp-input.test.tsx` | `app/design-system` OtpInput 區塊；`/admin/account`（帳號設定頁 MFA 註冊中／停用二次確認畫面） | TASK-043 |
| ColorModeToggle | 已完成 | 亮色（顯示月亮圖示＝可切暗）／暗色（顯示太陽圖示＝可切亮）；掛載前（SSR／尚未讀到 localStorage 偏好）不渲染，避免 hydration mismatch | grey/text.secondary 色、radius.sm | MUI 沒有現成明暗模式切換元件，Variant A（純圖示按鈕）mockup 核准後客製：`components/ui/ColorModeToggle.tsx`（跨頁共用，放入 `components/ui/`；內部直接呼叫 MUI `useColorScheme()`，不自建 Context／不手動讀寫 localStorage，狀態自包含，使用處不需傳入額外 props） | `app/design-system` ColorModeToggle 區塊；`/admin`（Sidebar 底部個人資料區塊）；顧客前台首頁（BrandHeaderSection 品牌列右側） | TASK-063 |

（「來源階段」記錄這個元件是 S4 初建，還是後續某個功能 Epic 補做並回登的。）

人工核准：使用者，2026-08-05

## S5 各介面版面

| 介面／使用者端 | 選定版型 | Mockup 決策紀錄 | 人工核准 |
|---|---|---|---|
| 顧客前台（服務列表→選時段→填寫資訊→預約成功） | B 單頁捲動（Single-page Accordion）：所有步驟同一頁，選好上一步自動展開下一區塊，已完成區塊收合為摘要列（可點「修改」回頭調整） | [`mockup-decision-顧客前台.md`](mockup-decision-顧客前台.md)；mockup 檔案：[`customer-flow-variant-a/b/c.html`](mockups/) | 使用者，2026-08-05 |
| 設計師後台（登入、預約列表／日曆、服務與營業時間設定） | C 側邊欄＋日曆優先（Sidebar + Calendar-first）：左側固定 sidebar 導覽，預約主視覺為週曆網格（可切換列表檢視），服務/營業時間為列表+表單 | [`mockup-decision-設計師後台.md`](mockup-decision-設計師後台.md)；mockup 檔案：[`admin-variant-a/b/c.html`](mockups/) | 使用者，2026-08-05 |
| 預約管理後台 · 預約週曆／列表（「預約管理後台」Epic，S5 shell 的實際落地畫面） | B 展開事件卡＋Modal 操作：週曆格內是完整資訊事件卡（時間／姓名／服務／狀態徽章），點選開啟置中 Modal 完成標記完成／改期／取消 | [`../預約管理後台/mockup-decision-預約週曆列表.md`](../預約管理後台/mockup-decision-預約週曆列表.md)；mockup 檔案：[`../預約管理後台/mockups/booking-admin-variant-a/b/c.html`](../預約管理後台/mockups/) | 使用者，2026-08-05 |
| 商店基本資料設定 · 後台商店設定頁（「商店基本資料設定」Epic） | B 分卡片，各自獨立動作：「基本資訊」文字欄位自己儲存，「品牌圖片」選檔即自動上傳 | [`../商店基本資料設定/mockup-decision-商店設定.md`](../商店基本資料設定/mockup-decision-商店設定.md)；mockup 檔案：[`../商店基本資料設定/mockups/store-settings-variant-a/b.html`](../商店基本資料設定/mockups/) | 使用者，2026-08-07 |
| 商店基本資料設定 · 顧客前台品牌顯示區塊 | B 精簡頁首列＋矮版封面圖：小 Logo＋店名取代原「預約」標題，不明顯增加既有預約流程的版面深度 | [`../商店基本資料設定/mockup-decision-前台品牌顯示.md`](../商店基本資料設定/mockup-decision-前台品牌顯示.md)；mockup 檔案：[`../商店基本資料設定/mockups/customer-brand-variant-a/b.html`](../商店基本資料設定/mockups/) | 使用者，2026-08-07 |
| 服務項目管理 · 後台服務項目管理頁 | A 表格列表＋置中 Modal：新增/編輯用 Modal，操作欄直接下架/重新上架，下架有二次確認 | [`../服務項目管理/mockup-decision-服務項目管理.md`](../服務項目管理/mockup-decision-服務項目管理.md)；mockup 檔案：[`../服務項目管理/mockups/admin-services-variant-a/b.html`](../服務項目管理/mockups/) | 使用者，2026-08-18 |
| 設計師登入與帳號安全 · 登入與驗證流程 | A 置中單卡片：忘記密碼／MFA／重設密碼皆在同一版型內切換內容 | [`../設計師登入與帳號安全/mockup-decision-登入與驗證流程.md`](../設計師登入與帳號安全/mockup-decision-登入與驗證流程.md)；mockup 檔案：[`../設計師登入與帳號安全/mockups/auth-flow-variant-a/b.html`](../設計師登入與帳號安全/mockups/) | 使用者，2026-08-18 |
| 設計師登入與帳號安全 · 後台帳號設定頁 | A 單頁捲動五卡片：個人資料／密碼／登入 Email／MFA 各自獨立儲存 | [`../設計師登入與帳號安全/mockup-decision-帳號設定頁.md`](../設計師登入與帳號安全/mockup-decision-帳號設定頁.md)；mockup 檔案：[`../設計師登入與帳號安全/mockups/account-settings-variant-a/b.html`](../設計師登入與帳號安全/mockups/) | 使用者，2026-08-18 |
| 預約規則與政策設定 · 後台預約規則頁 | A 單一表單卡片：兩欄位＋底部儲存 | [`../預約規則與政策設定/mockup-decision-預約規則頁.md`](../預約規則與政策設定/mockup-decision-預約規則頁.md)；mockup 檔案：[`../預約規則與政策設定/mockups/booking-policy-variant-a/b.html`](../預約規則與政策設定/mockups/) | 使用者，2026-08-18 |
| 預約規則與政策設定 · 顧客前台政策說明 | B 資訊卡片：置於聯絡表單內部、送出按鈕正上方 | [`../預約規則與政策設定/mockup-decision-顧客前台政策說明.md`](../預約規則與政策設定/mockup-decision-顧客前台政策說明.md)；mockup 檔案：[`../預約規則與政策設定/mockups/customer-policy-variant-a/b.html`](../預約規則與政策設定/mockups/) | 使用者，2026-08-18 |
