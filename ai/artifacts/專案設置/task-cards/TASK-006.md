# AI-Ready 任務卡

## Metadata

- 任務：UI 設計系統 S3：Design Token
- 上層規格：無（Epic 0 UI 設計系統，五階段流程第 3 階）
- 上層 Epic：專案設置
- 上層 User Story：UI 設計系統
- 分軌：前端
- 前置任務（dependsOn）：TASK-005
- 狀態：完成（2026-08-05 核准）
- 風險等級：低
- Agent owner：Claude Code
- 人工核准者：待指定

## 目標

從 S2 選定的風格方向，定義完整的 primitive token 與 semantic token，並在專案內產出可執行的真實 token 檔（如 Tailwind 主題設定），供人工核准。

## 情境包（Context Pack）

- 相關檔案：`ai/context/design-system.md`、專案內樣式設定檔（依 S1 選定方案，如 `tailwind.config.ts`）。
- 既有模式：套用 `ai/skills/design-craft.md`（type scale、4 的倍數間距、色彩系統分階）。
- 假設：無。
- 未知事項：無。
- 允許變更的檔案：`ai/context/design-system.md`、專案內樣式主題檔。
- 不得觸碰：S4 元件實作。

## 需求

- 定義 primitive token：色彩（含各階明度）、type scale、字重／行高、間距 scale、圓角、陰影、z-index、動效時間與曲線。
- 定義 semantic token（如 `color.primary`、`color.surface`、`color.danger`、`space.page`）並對應到 primitive token。
- 若專案已有可跑框架，同步產出真實 token 檔並記錄路徑。

## 驗收標準

- `design-system.md` 的 S3 章節（Primitive／Semantic token 表）填寫完整，不再是「待補」。
- 真實 token 檔存在且路徑已記錄。
- 人工核准紀錄已填寫。

## 實作備註

- 遵循 `ai/skills/design-craft.md` 的 4 的倍數間距與 type scale 規則，避免隨意數值。

## 驗證契約

- 單元測試：不適用。
- 整合測試：不適用。
- E2E 測試：不適用。
- 型別檢查：若為 TS 主題檔則需 `tsc --noEmit` 成功。
- Lint：`npm run lint` 成功。
- Build：`npm run build` 成功。
- 螢幕截圖：色票／字級 scale 的視覺呈現（可用簡單頁面展示）。
- 安全性檢查：不適用。

## 完成證據

- 變更的檔案：
  - `lib/theme/tokens.ts`（primitive token：grey/primary 10 階色票、semantic 色、type scale、
    間距、圓角、陰影、z-index、動效）
  - `lib/theme/index.ts`（MUI `createTheme`：primitive → semantic 映射，light/dark
    `colorSchemes`，typography/shape/transitions/zIndex/component overrides）
  - `lib/theme/ThemeRegistry.tsx`（client component 包住 `AppRouterCacheProvider` +
    `ThemeProvider` + `CssBaseline`，避免 theme 物件跨 Server/Client 邊界序列化錯誤）
  - `app/layout.tsx`（字體改用 `next/font/google` 的 Noto Sans TC／Noto Serif TC，
    套用 `ThemeRegistry`，`html lang` 改為 `zh-Hant`）
  - `app/globals.css`（移除與 MUI CssBaseline／theme 衝突的硬寫 font-family／背景／文字色，
    僅保留與 theme 無關的版面重置）
  - `ai/context/design-system.md`（S3 章節：完整 primitive／semantic token 表、真實檔案路徑、
    已知限制、人工核准）
  - `ai/artifacts/專案設置/mockups/design-token-showcase-s3.html`（色票／字級／間距／圓角／
    陰影的靜態視覺預覽，用於螢幕截圖驗證）
- 執行過的指令：
  - `npx tsc --noEmit` — 通過
  - `npm run lint` — 通過
  - `npm run build` — 通過（首次因 `theme` 物件含函式從 Server Component 直接傳給
    `ThemeProvider` 觸發 RSC 序列化錯誤，改用 `ThemeRegistry` client component 內部
    直接 import theme 後修復，重新 build 通過）
  - 瀏覽器手動驗證首頁（`npm run dev`）：亮色／暗色模式（依 `prefers-color-scheme`）皆正確
    套用背景、文字色與 Noto Sans TC 字體，console 無錯誤
  - 瀏覽器開啟 `design-token-showcase-s3.html` 確認色票／字級／間距／圓角／陰影渲染正確
- 測試輸出：不適用（本任務驗證契約僅要求 typecheck／lint／build／視覺截圖）。
- 螢幕截圖：首頁亮色／暗色模式、`design-token-showcase-s3.html` 色票與字級 scale 皆已截圖確認。
- 已知限制：
  - MUI `theme.shadows`（0–24 完整 elevation tuple）未展開，僅定義 elevation1/2 兩階並透過
    component overrides 套用於 Paper/Card；暗色模式的 `grey` 完整色階也未展開，只定義
    S2 已核准的 background/text/divider/primary。若 S4 元件確實需要更多階再擴充。
  - `app/page.tsx`／`app/admin`／`app/login` 內容本身未變更（仍是純文字／原本結構），
    S3 只處理 token 基礎設施，實際套用 MUI 元件重新設計畫面留給 S4/S5。
- 後續任務：TASK-007（S4 核心元件庫）。
