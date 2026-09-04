# 畫面規格

## Metadata

- 功能：UI 設計系統 — Sidebar 導覽圖示化
- 畫面：設計師後台 `components/ui/Sidebar.tsx` 導覽項目（`/admin` 系列頁面共用）
- 狀態：mockup 已核准（Variant A 延續現況＋前綴圖示，文字 18px／圖示 22px／項目間距加大／標題 20px，2026-09-05）

## 目的

目前後台 Sidebar 導覽項目（預約／服務設定／營業時間／預約規則／商店設定／帳號設定）只有文字，字級偏小（`subtitle2` = 14px），純文字列表在快速掃視時辨識度較低。本次調整：1) 每個導覽項目加上前綴圖示，圖示＋文字搭配；2) 文字字級加大；3) 圖示與文字顏色需隨明暗模式（[[TASK-063]] 建立的 `useColorScheme` 機制）自動切換，沿用既有 token 而非寫死顏色。

## 版面配置

- 主要區域：無（本次是既有 Sidebar 元件內導覽列表的樣式調整，不是新頁面）
- 次要區域：`components/ui/Sidebar.tsx` 的 `<List>` 導覽項目（不含底部個人資料區塊與登出按鈕，兩者維持現況）
- 導覽：導覽項目數量、順序、對應路由皆不變（`app/admin/_components/AdminShell.tsx` 的 `NAV_ITEMS`），僅視覺調整
- 動作：點擊項目導覽至對應後台頁面（既有行為不變）

## 狀態

| 狀態 | 必要行為 | 空狀態／錯誤文案 | 驗證方式 |
|---|---|---|---|
| 預設（未選取，亮色） | 圖示＋文字皆用 `text.secondary` | 無 | 螢幕截圖 |
| 預設（未選取，暗色） | 圖示＋文字皆用 `text.secondary`（暗色 token 值） | 無 | 螢幕截圖 |
| Hover | 底色轉為 `grey.200`（既有行為延續） | 不適用 | 螢幕截圖 |
| Focus（鍵盤） | MUI `ListItemButton` 內建 focus ring，不因加圖示而改變 | 不適用 | 螢幕截圖／鍵盤 Tab 操作 |
| 使用中（active） | 圖示＋文字轉為 `primary` 色系（依選定變體，可能另加底色／邊框強調），字重加粗 | 不適用 | 螢幕截圖 |
| 停用（disabled） | 圖示＋文字皆用 `text.disabled`，不可點擊（既有行為延續） | 不適用 | 螢幕截圖 |
| 載入中 | 不適用（純前端路由高亮，非非同步資料） | 不適用 | 不適用 |
| 行動裝置版 | 不適用——後台為桌面限定（[[專案地圖]] 定義：設計師後台以桌面為主），Sidebar 無響應式版型，維持既有慣例 | 不適用 | 不適用 |

## 互動

| 動作 | 觸發條件 | 結果 | 失敗情境 |
|---|---|---|---|
| 點擊／Enter 導覽項目 | 使用者點擊或鍵盤觸發未停用的項目 | Next.js `Link` 導覽至對應路由，該項目轉為 active 樣式 | 不適用（純前端路由，無 API 呼叫） |

## 設計系統對照

- 用到的既有 design token：`grey`/`primary` 10 階（含 dark colorScheme）、`typography.subtitle1`（16px，取代現行 `subtitle2` 14px）、既有間距 scale、既有 `radius.sm`
- 用到的既有元件：`components/ui/Sidebar.tsx`（本次調整對象本身）、圖示手繪 SVG 比照 `components/ui/ColorModeToggle.tsx` 既有慣例（`stroke="currentColor"`，不安裝 `@mui/icons-material`，避免新增相依套件只為 6 個圖示）
- 本畫面新做的元件：導覽圖示（6 個，預約／服務設定／營業時間／預約規則／商店設定／帳號設定各一），非獨立元件、內嵌於 `Sidebar.tsx`；比照 `ColorModeToggle.tsx` 的手繪 SVG 風格製作，完成後登記回 `ai/context/design-system.md` 的 S4 元件庫 inventory（更新既有 Sidebar 列的說明，不需新增列）

## 視覺驗收標準

- 文字在手機版與桌面版都不會被截斷。
- 主要動作清楚明確。
- 錯誤與空狀態明確呈現。
- **色彩、字體、間距、圓角、陰影一律取自 `design-system.md` 的 design token，沒有硬寫的一次性數值。**
- **重複使用元件庫 inventory 裡的既有元件；任何新做的元件都依既有 token 與風格製作，且已登記回 inventory。**
