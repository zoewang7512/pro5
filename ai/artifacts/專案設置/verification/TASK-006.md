# 驗證報告

## 摘要

- 任務：TASK-006 UI 設計系統 S3：Design Token
- 結果：通過
- 驗證者：實作 agent（Claude Code）；人工核准者：使用者（2026-08-05）

## 指令

| 指令 | 結果 | 備註 |
|---|---|---|
| `npx tsc --noEmit` | 通過 | |
| `npm run lint` | 通過 | |
| `npm run build`（第一次） | 失敗 | `theme` 物件（含 `breakpoints.up` 等函式）從 Server Component（`app/layout.tsx`）直接傳給 client `ThemeProvider` 觸發 RSC 序列化錯誤 |
| 修復：新增 `lib/theme/ThemeRegistry.tsx`（`"use client"`，內部直接 import theme） | — | 移除 layout.tsx 對 `theme` 的 prop 傳遞 |
| `npm run build`（第二次） | 通過 | 6 個靜態頁成功產出 |
| 瀏覽器手動驗證首頁（暗色，依系統 `prefers-color-scheme`） | 通過 | 背景 `#201C18`、文字 `#F3EEE6`、Noto Sans TC 字體正確套用，console 無錯誤 |
| 瀏覽器手動驗證首頁（強制亮色） | 通過 | 背景 `#F6F3EE`、文字 `#2B2622` 正確套用，console 無錯誤 |
| 瀏覽器開啟 `design-token-showcase-s3.html` | 通過 | grey/primary 10 階色票、semantic 色、type scale（11–48px）、spacing（4–64px）、圓角、
  兩階陰影皆正確渲染 |

## 決策證據

- Primitive/semantic token 定義於 `lib/theme/tokens.ts`，MUI theme 映射於 `lib/theme/index.ts`。
- `ai/context/design-system.md` 的 S3 章節已填入完整 token 表、真實檔案路徑、已知限制與人工
  核准紀錄（使用者，2026-08-05）。
- 色彩／字級／圓角／陰影數值皆延續 S2 已核准的變體 A「質感沉靜」，未新增未經核准的視覺方向。

## 審查發現

| 發現 | 嚴重程度 | 狀態 |
|---|---|---|
| 初版直接在 `app/layout.tsx`（Server Component）建立並傳遞 `theme` 給 `ThemeProvider`，`npm run build` 因 RSC 無法序列化函式而失敗 | Medium（建置阻擋） | 已修復：改用 `ThemeRegistry` client component 在自身模組內 import theme，layout.tsx 不再傳遞 theme 物件 |

## 殘留風險

- MUI `theme.shadows` 完整 0–24 elevation tuple 與暗色模式完整 `grey` 色階尚未展開，僅定義
  S2 已核准範圍內的 elevation1/2 與暗色 background/text/divider/primary；避免現在過度設計，
  待 S4 元件確實需要時再擴充。
- `app/page.tsx`／`app/admin`／`app/login` 尚未改用 MUI 元件重新設計，S3 僅處理 token
  基礎設施，實際畫面套用留給 S4（核心元件庫）／S5（版面）。

## 人工核准

- 核准者：使用者
- 日期：2026-08-05
- 決定：驗證證據確認無誤，核准推進到「完成」。
