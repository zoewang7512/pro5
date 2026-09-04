# AI-Ready 任務卡

## Metadata

- 任務：UI 設計系統 明暗模式手動切換（ColorMode 機制＋切換圖示元件＋套用至 Sidebar／顧客前台品牌列）
- 上層規格：ai/artifacts/專案設置/screen-spec-明暗模式切換.md
- 上層 Epic：專案設置
- 上層 User Story：UI 設計系統
- 分軌：前端
- 前置任務（dependsOn）：TASK-006（S3 Design Token，含既有 dark colorScheme 定義）、TASK-014（Sidebar 元件建立）、TASK-032（BrandHeaderSection 建立）
- 狀態：完成
- 風險等級：低
- Agent owner：Claude Code
- 人工核准者：使用者，2026-09-05

## 目標

全站（設計師後台＋顧客前台）都能手動切換亮／暗色模式並記住使用者的選擇，不再只跟隨作業系統設定；套用已核准的 Variant A（純圖示按鈕）視覺，圖示分別放在 Sidebar 底部個人資料區塊與 BrandHeaderSection 品牌列右側。

## 情境包（Context Pack）

- 相關檔案：
  - `lib/theme/index.ts`（`colorSchemes.light`／`dark` 已完整定義，見第 13-72 行；`cssVariables.colorSchemeSelector` 目前為 `"media"`）
  - `lib/theme/ThemeRegistry.tsx`（`ThemeProvider defaultMode="light"`，包住全站）
  - `app/layout.tsx`（root layout，`<body>` 內只有 `ThemeRegistry`）
  - `components/ui/Sidebar.tsx`（第 93-114 行的 `profileName` 區塊，是後台切換圖示要放入的位置）
  - `app/_components/booking/BrandHeaderSection.tsx`（第 50-77 行的品牌列 `Stack`，是顧客前台切換圖示要放入的位置）
  - `ai/context/design-system.md`（S4 元件庫 inventory，完成後需登記新元件）
- 既有模式：
  - MUI `ThemeProvider`（CSS Variables 模式）內建 `useColorScheme()` hook 與自動 localStorage 持久化（預設 key `mui-mode`），**不需要自己刻 React Context 或手動讀寫 localStorage**——只要把 `colorSchemeSelector` 從 `"media"` 改成 class-based（例如 `"class"`），並把 `ThemeProvider` 的 `defaultMode` 從 `"light"` 改成 `"system"`（讓首次造訪沿用作業系統設定，符合既有行為與使用者「手動為主、預設跟系統」的決策），即可讓 `useColorScheme().setMode("light" | "dark")` 生效並自動持久化。
  - 為避免 SSR/首次渲染閃爍（FOUC：伺服器渲染出的顏色跟使用者上次選擇的偏好不一致，畫面短暫閃一下），MUI 官方模式是在 `<body>` 最前面插入 `InitColorSchemeScript`（`@mui/material/InitColorSchemeScript` 或 `@mui/material-nextjs` 對應匯出，需查證本專案 MUI 版本下正確匯入路徑），在 hydration 前先讀 localStorage 套用 class，這是本卡必須處理的項目，不是可省略的細節。
  - 既有元件（`Switch`、`Sidebar`、`BrandHeaderSection`）皆已用 `sx` 搭配 semantic token（`primary`、`grey`、`text.secondary` 等）取色，不寫死 hex；新元件比照辦理。
  - mockup 已用 SVG inline 手繪 sun/moon 圖示（無 `@mui/icons-material` 套件，本專案目前沒有 icon library），見 `ai/artifacts/專案設置/mockups/theme-toggle-variant-a.html`；正式元件直接沿用同一組 SVG path，不要另外安裝 icon 套件。
- 假設：
  - 不需要把使用者的明暗模式偏好存進資料庫（設計師帳號或顧客都不需要跨裝置同步），純前端 localStorage 已符合驗收標準。
  - 顧客前台與後台共用同一份 `theme`／`ThemeRegistry`，不需要為兩端分別建立切換狀態。
- 未知事項：
  - 本專案安裝的 `@mui/material` 版本（package.json 鎖 9.2.0）下，`InitColorSchemeScript` 的正確匯入路徑與用法，實作時需先查證官方文件或原始碼再套用，不要憑記憶猜。
- 允許變更的檔案：
  - `lib/theme/index.ts`
  - `lib/theme/ThemeRegistry.tsx`
  - `app/layout.tsx`
  - `components/ui/Sidebar.tsx`
  - `app/_components/booking/BrandHeaderSection.tsx`
  - 新增：`components/ui/ColorModeToggle.tsx`
  - `ai/context/design-system.md`（登記新元件）
  - 對應的新增／更新測試檔（`tests/components/` 底下）
- 不得觸碰：
  - `lib/theme/tokens.ts` 的既有 primitive 數值（暗色模式色票已在 TASK-023 核准，不重新設計顏色）
  - 與明暗模式無關的其他頁面／元件邏輯

## 需求

- 新增 `components/ui/ColorModeToggle.tsx`：32×32 `IconButton`，依當下 `useColorScheme().mode`（system 時以實際 resolved mode 判斷）顯示對應 SVG（亮色顯示月亮圖示＝點擊切到暗色；暗色顯示太陽圖示＝點擊切回亮色），`aria-label` 需清楚描述「切換為暗色模式」／「切換為亮色模式」，並有 `title` tooltip；hover 有底色（沿用 Sidebar 既有 icon button hover 慣例：`grey.200`）。
- `lib/theme/index.ts`：`cssVariables.colorSchemeSelector` 改為 class-based；`lib/theme/ThemeRegistry.tsx` 的 `defaultMode` 改為 `"system"`。
- `app/layout.tsx`：加入 `InitColorSchemeScript`，避免首次渲染閃爍。
- `components/ui/Sidebar.tsx`：`profileName` 區塊（第 93-114 行）內加入 `<ColorModeToggle />`，與大頭貼、顯示名稱同一行、靠右對齊（`justify-content: space-between` 或等效寫法）；`profileName` 未傳入時（未載入完成）比照既有慣例，整個區塊仍不渲染，含切換圖示，避免行為不一致。
- `app/_components/booking/BrandHeaderSection.tsx`：品牌列 `Stack`（第 51-77 行）內加入 `<ColorModeToggle />`，靠右對齊，不影響現有 Logo／店名/簡介的省略號截斷行為。
- 完成後將 `ColorModeToggle` 登記回 `ai/context/design-system.md` 的 S4 元件庫 inventory 表格（狀態、涵蓋狀態、用到的 token、檔案位置、截圖位置、來源階段 TASK-063）。

## 驗收標準

- 首次造訪（無 localStorage 紀錄）畫面顏色跟隨作業系統的明暗設定，與目前行為一致。
- 點擊 Sidebar 或品牌列的切換圖示，畫面立即切換亮／暗色，且切換後的選擇會被記住（重新整理頁面後仍維持使用者選過的模式，即使把作業系統設定改成相反的模式）。
- 切換圖示在 Sidebar 底部個人資料區塊與 BrandHeaderSection 品牌列都正確渲染在核准的 mockup 位置（靠右對齊），不擠壓既有大頭貼／文字內容，長店名／長顯示名稱仍會正確省略號截斷不換行。
- 兩個位置的圖示在亮色與暗色模式下皆清晰可辨識、對比足夠（比照既有 WCAG AA 慣例）。
- 鍵盤可操作（Tab 可聚焦、Enter/Space 可觸發），有正確的 `aria-label`。
- 首次渲染無 SSR/CSR 顏色不一致造成的畫面閃爍（FOUC）。
- `ai/context/design-system.md` 的 S4 inventory 已補登 `ColorModeToggle` 這一列。

## 實作備註

- 不要自己刻 Context／手動 `localStorage.getItem`／`setItem`——用 MUI `useColorScheme()` 內建機制，避免與 MUI 自身的 CSS variables 機制打架（例如各自寫入不同 key 導致不同步）。
- Sidebar／BrandHeaderSection 不需要新增 props 把切換狀態往下傳——`ColorModeToggle` 內部直接呼叫 `useColorScheme()`，是自包含元件，兩處只是「放置」而非「注入資料」。

## 驗證契約

- 單元測試：`tests/components/color-mode-toggle.test.tsx`（渲染、點擊切換、aria-label 隨模式變化）；更新 `tests/components/sidebar.test.tsx`／`tests/components/brand-header-section.test.tsx`（若存在）確認新增的切換圖示不破壞既有渲染斷言。
- 整合測試：不適用（純前端狀態，無 API／DB）。
- E2E 測試：不適用（本專案目前無 E2E 測試工具鏈）。
- 型別檢查：`npx tsc --noEmit`
- Lint：`npm run lint`
- Build：`npm run build`
- 螢幕截圖：`/admin`（Sidebar 底部，亮色＋暗色各一張）、顧客前台首頁（BrandHeaderSection，亮色＋暗色各一張），共至少 4 張，比照 mockup 核准的版面。
- 安全性檢查：不適用（無新增資料存取面／無使用者輸入處理），比照 TASK-034 前例不另外派遣 security-reviewer 子代理，以既有安全檢查清單自我核對即可。

## 完成證據

- 變更的檔案：
  - `lib/theme/index.ts`（`colorSchemeSelector: "media"` → `"class"`）
  - `lib/theme/ThemeRegistry.tsx`（`defaultMode="light"` → `"system"`）
  - `app/layout.tsx`（加入 `InitColorSchemeScript`；`<html>` 加 `suppressHydrationWarning`，因為該腳本會在 hydrate 前直接改寫 `<html>` class，屬預期行為）
  - 新增 `components/ui/ColorModeToggle.tsx`
  - `components/ui/Sidebar.tsx`（個人資料區塊加入 `<ColorModeToggle />`，`profileName` Typography 加 `flex:1` 讓圖示靠右）
  - `app/_components/booking/BrandHeaderSection.tsx`（品牌列加入 `<ColorModeToggle />`，名稱/簡介 Box 加 `flex:1` 讓圖示靠右）
  - `app/design-system/page.tsx`（新增 ColorModeToggle 展示區塊）
  - `ai/context/design-system.md`（S4 inventory 登記新元件）
  - 新增測試：`tests/components/color-mode-toggle.test.tsx`、`tests/components/sidebar.test.tsx`、`tests/components/brand-header-section.test.tsx`
- 執行過的指令：
  - `npx tsc --noEmit`（通過）
  - `npm run lint`（0 problems；過程中發現 `useEffect` 內同步 `setState` 的 mounted-guard 寫法違反 `react-hooks/set-state-in-effect`，改用 `useSyncExternalStore` 取得掛載狀態後解決）
  - `npm run build`（成功）
  - `npx vitest run tests/components/color-mode-toggle.test.tsx tests/components/sidebar.test.tsx tests/components/brand-header-section.test.tsx`（8/8 通過）
  - `npm test`（全量套件執行兩次：481/488 與 478/485，皆僅既有已知間歇性逾時測試檔（`login-form.test.tsx`／`reset-password-form.test.tsx`／`account-settings-view.test.tsx`，與本卡改動無關）在全量平行執行時逾時；個別單獨執行皆 100% 通過，確認非本卡回歸）
  - Browser 工具手動驗證顧客前台首頁（`/`）：預設跟系統偏好顯示暗色、圖示為太陽（可切亮）；點擊切換為亮色、圖示變月亮；重新整理頁面後亮色偏好持續生效（`localStorage` key `mui-mode` 正確寫入 `light`/`dark`）
- 測試輸出：見上「執行過的指令」
- 螢幕截圖：顧客前台首頁亮色／暗色各一張（Browser 工具截圖，過程存於對話記錄）；`/admin` Sidebar 底部因需要設計師登入密碼、Claude Code 無帳密、依安全規則不得嘗試取得或猜測，未能截圖，改以 `tests/components/sidebar.test.tsx` 兩個案例（profileName 有/無傳入時切換圖示的渲染行為）驗證；使用者已人工登入 `/admin` 目視確認 Sidebar 底部版面正常
- 已知限制：驗證過程曾誤刪 `.next` build cache 導致 Turbopack 字型解析短暫出錯，重啟 dev server 後恢復正常，非程式碼問題
- 後續任務：無
- 追加變更（同一卡片內，使用者驗收時提出）：`app/admin/logout-button.tsx` 的登出按鈕加上 `style={{ width: "100%" }}`，在 Sidebar 既有 `px:2.5` 內距下撐滿至與其他導覽項目對齊的寬度；`tsc`/`lint` 皆通過
