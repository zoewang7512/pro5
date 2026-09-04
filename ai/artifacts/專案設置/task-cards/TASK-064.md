# AI-Ready 任務卡

## Metadata

- 任務：UI 設計系統 Sidebar 導覽圖示化（icon＋文字並排、字級加大、明暗模式自動切換）
- 上層規格：ai/artifacts/專案設置/screen-spec-sidebar導覽圖示化.md
- 上層 Epic：專案設置
- 上層 User Story：UI 設計系統
- 分軌：前端
- 前置任務（dependsOn）：TASK-014（Sidebar 元件建立）、TASK-063（明暗模式手動切換機制）
- 狀態：完成
- 風險等級：低
- Agent owner：Claude Code
- 人工核准者：使用者，2026-09-05（mockup-decision-sidebar導覽圖示化.md 選定 Variant A 並核准尺寸調整）

## 目標

設計師後台 Sidebar（`components/ui/Sidebar.tsx`）的 6 個導覽項目（預約／服務設定／營業時間／預約規則／商店設定／帳號設定）改為圖示＋文字並排，文字字級加大、圖示與文字顏色皆隨明暗模式自動切換；Sidebar 標題「理髮廳後台」字級同步加大。

## 情境包（Context Pack）

- 相關檔案：
  - `components/ui/Sidebar.tsx`（`SidebarItem` 型別定義第 15-20 行；導覽項目渲染邏輯第 57-92 行；標題 Typography 第 53-55 行）
  - `app/admin/_components/AdminShell.tsx`（`NAV_ITEMS` 陣列第 16-23 行，是導覽項目 label/href 的唯一來源，圖示需在此處對應加入）
  - `components/ui/ColorModeToggle.tsx`（手繪 SVG 圖示的既有慣例：`stroke="currentColor"`、無 `@mui/icons-material` 依賴）
  - `lib/theme/tokens.ts`（`typeScale.fontSize`：`lg`=18、`xl`=20；`spacingScale`：4/8/12/16/20/24…）
  - `ai/context/design-system.md`（S4 元件庫 inventory，Sidebar 列需更新說明）
  - `tests/components/sidebar.test.tsx`（既有測試，新增圖示渲染斷言）
- 既有模式：
  - `Sidebar.tsx` 是純展示元件，不假設業務內容——導覽項目的 label/href/圖示都由呼叫端（`AdminShell.tsx`）傳入，本次新增的圖示同樣應以 props 傳入，不得在 `Sidebar.tsx` 內寫死「預約用什麼圖示」這種業務對應。
  - 顏色切換靠既有 semantic token（`text.secondary`／`primary.dark`／`text.disabled`）自動響應 `useColorScheme()`，不需要另外判斷明暗模式；圖示 SVG 用 `stroke="currentColor"`、外層容器不設 `color`（讓其自然繼承 `ListItemButton` 的 `color` sx），即可讓圖示跟文字同步套用同一個顏色來源，比照 `ColorModeToggle.tsx` 的做法。
  - 字級／間距一律取自 `typeScale`／`spacingScale`，不得寫孤立數值：18px＝`typeScale.fontSize.lg`、20px＝`typeScale.fontSize.xl`、16px 間距＝`spacingScale` 的 16（MUI `sx` 寫法為 `spacing(4)`，即 `py: 4`，因為 `theme.spacing(1) = 4px`）。圖示 22px 為圖示元件自身尺寸（非文字），不受 type scale 限制，比照既有 `ColorModeToggle` 18px icon／`Avatar` 28px 等圖示類尺寸皆為元件自訂數值的既有慣例。
- 假設：
  - 導覽項目數量、順序、對應路由不變，純視覺調整。
  - 底部個人資料區塊（大頭貼＋顯示名稱＋`ColorModeToggle`）與登出按鈕維持現況，不在本卡範圍。
- 未知事項：無。
- 允許變更的檔案：
  - `components/ui/Sidebar.tsx`
  - `app/admin/_components/AdminShell.tsx`
  - `ai/context/design-system.md`（更新 S4 inventory Sidebar 列）
  - `tests/components/sidebar.test.tsx`（新增／調整測試）
- 不得觸碰：
  - `lib/theme/tokens.ts`／`lib/theme/index.ts`（不新增或修改既有 design token，本卡只取用既有值）
  - Sidebar 底部個人資料區塊、登出按鈕、`AdminShell.tsx` 以外的路由邏輯

## 需求

- `components/ui/Sidebar.tsx`：`SidebarItem` 型別新增 `icon?: React.ReactNode` 選填欄位；渲染時圖示（22×22）與文字（18px，即 `typeScale.fontSize.lg`）同列並排，圖示置左、與文字間距取 `spacingScale` 值（12px）；未傳入 `icon` 的項目維持純文字渲染（型別選填，向下相容）。
- 導覽項目垂直內距（`py`）由現行 `1.25`（5px）加大到 `4`（16px），讓項目間視覺間距加大；水平內距（`px`）維持現行 `2.5`（10px）不變。
- 使用中（active）／停用（disabled）／預設狀態的圖示顏色需與文字顏色同步（沿用既有 `primary.dark`／`text.disabled`／`text.secondary` 邏輯），圖示不得寫死顏色值。
- Sidebar 標題「理髮廳後台」文字字級加大到 20px（`typeScale.fontSize.xl`），字重維持既有 700（bold，不變）。
- `app/admin/_components/AdminShell.tsx`：`NAV_ITEMS` 的 6 個項目各自加上對應圖示（手繪 SVG，比照 `ColorModeToggle.tsx` 慣例：`stroke="currentColor"`、`fill="none"`、`stroke-width` 統一取 1.75，viewBox `0 0 24 24`）：
  - 預約 → 日曆圖示
  - 服務設定 → 剪刀圖示
  - 營業時間 → 時鐘圖示
  - 預約規則 → 附勾選核取的清單圖示
  - 商店設定 → 店面圖示
  - 帳號設定 → 使用者圖示
- 完成後更新 `ai/context/design-system.md` 的 S4 元件庫 inventory「Sidebar」列，補充圖示＋文字並排、字級調整的說明與來源階段（TASK-064）。

## 驗收標準

- `/admin` 系列頁面 Sidebar 的 6 個導覽項目皆顯示圖示＋文字，文字 18px、圖示 22px，項目間垂直間距比現行明顯加大。
- 亮色與暗色模式下，圖示與文字顏色皆正確切換（使用中／停用／預設三種狀態皆需在兩種模式下對比清晰可辨識）。
- Sidebar 標題「理髮廳後台」字級明顯大於導覽項目文字（20px vs 18px），維持既有粗體。
- 鍵盤 Tab／Enter 操作行為不受影響（既有 focus／點擊導覽邏輯不變）。
- 停用（disabled）項目的圖示與文字皆呈現停用樣式，不可點擊（目前 `NAV_ITEMS` 無實際 disabled 項目，以型別層級的 disabled 分支＋既有測試涵蓋即可，不需新增假資料）。
- `ai/context/design-system.md` 的 S4 inventory Sidebar 列已更新。

## 實作備註

- 圖示放在 `AdminShell.tsx`（呼叫端），不要放進 `Sidebar.tsx`——`Sidebar` 是跨頁共用的通用元件，不應該知道「服務設定該用剪刀圖示」這種業務對應，這是 `NAV_ITEMS` 該決定的事，比照 `SidebarItem.label`／`href` 已經是呼叫端決定的既有模式。
- 不要安裝 `@mui/icons-material`——mockup-decision 已核准圖示來源為手繪 SVG，比照 `ColorModeToggle.tsx`，避免為 6 個圖示新增一個相依套件。
- 圖示顏色不要在 SVG 或圖示容器上另外設定 `color`／`stroke` 的 sx 覆蓋——讓它自然繼承 `ListItemButton` 的 `color`（CSS `color` 屬性預設會被子元素繼承），跟文字共用同一個顏色來源，避免兩處分別維護顏色邏輯導致不同步。

## 驗證契約

- 單元測試：更新 `tests/components/sidebar.test.tsx`，新增案例確認傳入 `icon` 的項目會渲染該圖示（例如用 `container.querySelector("svg")` 或幫圖示加 `data-testid`），並確認未傳入 `icon` 時不報錯、仍正常渲染文字。
- 整合測試：不適用（純前端視覺調整，無 API／DB）。
- E2E 測試：不適用（本專案目前無 E2E 測試工具鏈）。
- 型別檢查：`npx tsc --noEmit`
- Lint：`npm run lint`
- Build：`npm run build`
- 螢幕截圖：`/admin` Sidebar（亮色＋暗色各一張，需人工登入後台後由使用者或 Claude Code 以瀏覽器工具截圖確認；若 Claude Code 無登入帳密，比照 TASK-063 前例改以元件測試覆蓋，並記錄殘留風險待使用者人工登入確認）。
- 安全性檢查：不適用（無新增資料存取面／無使用者輸入處理），比照 TASK-063 前例不另外派遣 security-reviewer 子代理。

## 完成證據

- 變更的檔案：
  - `components/ui/Sidebar.tsx`（`SidebarItem` 新增選填 `icon` 欄位；導覽項目改為圖示＋文字並排，`py:1.25`→`py:4`、文字改為固定 `fontSize:18`、圖示容器 22×22；使用中／預設的 `color` 上移到 `ListItemButton` 由子元素 `color:"inherit"` 繼承，圖示與文字因此共用同一色源；標題 `fontSize` 加到 20）
  - `app/admin/_components/AdminShell.tsx`（新增 6 個手繪 SVG 圖示元件與 `ICON_PROPS` 共用設定，`NAV_ITEMS` 各項加上對應 `icon`）
  - `ai/context/design-system.md`（S4 inventory Sidebar 列更新，補充圖示化／字級調整說明與 TASK-064 來源）
  - `tests/components/sidebar.test.tsx`（新增 2 個測試：傳入 `icon` 會渲染、未傳入 `icon` 仍正常渲染文字）
  - 新增／更新 mockup 產出物：`ai/artifacts/專案設置/screen-spec-sidebar導覽圖示化.md`、`ai/artifacts/專案設置/mockup-decision-sidebar導覽圖示化.md`、`ai/artifacts/專案設置/mockups/sidebar-nav-variant-{a,b,c}.html`
- 執行過的指令：
  - `npx tsc --noEmit`（通過）
  - `npm run lint`（0 problems）
  - `npm run build`（成功）
  - `npx vitest run tests/components/sidebar.test.tsx`（4/4 通過）
  - `npx vitest run tests/components`（13 個測試檔、108/108 全數通過，確認未破壞其他元件）
  - Browser 工具實際登入 `/admin`（沿用既有 session）：確認亮色／暗色模式下 6 個導覽項目皆正確顯示圖示＋文字、使用中狀態（預約）圖示與文字同步轉為 primary 色＋右側邊框、字級明顯加大、項目間距加大、標題「理髮廳後台」明顯大於導覽文字且維持粗體；點擊 `ColorModeToggle` 在兩種模式間切換皆正常
- 測試輸出：見上「執行過的指令」
- 螢幕截圖：Browser 工具截圖確認 `/admin` 亮色與暗色模式（過程存於對話記錄）
- 已知限制／殘留風險：無（已直接以真實登入 session 於瀏覽器驗證兩種模式，非僅靠元件測試推論）
- 後續任務：無

### 追加修訂（v2，同日，使用者驗收後提出）

人工於 `/admin` 看過實作後，覺得字級與間距偏大，要求再縮小一版；依 `ui-mockup-gate` 精神，先產出對照圖（`sidebar-nav-variant-a-v2.html`，現況 vs 調整後並列）並取得核准後才動工，詳見 `mockup-decision-sidebar導覽圖示化.md` 的「後續修訂（v2）」一節。

- 變更內容：
  - `components/ui/Sidebar.tsx`：文字 18px→16px、圖示 22×22→20×20、項目垂直間距 `py:4`（16px）→`py:3`（12px）、圖示與文字間距 `gap:3`（12px）→`gap:2`（8px，修正為 4 的倍數）、標題 `fontSize` 20→18
  - `ai/context/design-system.md`（S4 inventory Sidebar 列同步更新為新尺寸）
  - `ai/artifacts/專案設置/mockups/sidebar-nav-variant-a-v2.html`（新增，現況／調整後對照圖，已傳送給使用者確認）
- 執行過的指令：
  - `npx tsc --noEmit`（通過）
  - `npm run lint`（0 problems）
  - `npm run build`（成功）
  - `npx vitest run tests/components/sidebar.test.tsx`（4/4 通過）
  - Browser 工具實際登入 `/admin`：確認亮色／暗色模式下字級、圖示、間距、標題皆已縮小為調整後的數值，切換明暗模式正常
- 殘留風險：無
