# 畫面規格

## Metadata

- 功能：UI 設計系統 — 明暗模式手動切換
- 畫面：設計師後台 Sidebar 底部個人資料區塊、顧客前台 BrandHeaderSection 品牌列
- 狀態：mockup 已核准（Variant A 純圖示按鈕，2026-09-05）

## 目的

目前 `lib/theme/index.ts` 的 `colorSchemeSelector: "media"` 讓明暗模式完全跟隨作業系統設定，使用者無法在網站內手動切換、也無法記住自己的選擇。此畫面新增一個全站共用的切換圖示，讓使用者可手動在亮／暗色之間切換並記住偏好，不需依賴系統設定。

## 版面配置

- 主要區域：無（本次是既有版面裡插入一個小型互動元件，不是新頁面）
- 次要區域：
  - 設計師後台：`components/ui/Sidebar.tsx` 底部個人資料區塊（大頭貼＋顯示名稱那一列）
  - 顧客前台：`app/_components/booking/BrandHeaderSection.tsx` 品牌列（Logo＋店名那一行）右側
- 導覽：不影響既有導覽結構
- 動作：點擊圖示切換亮／暗色模式，選擇立即生效並存入 `localStorage`

## 狀態

| 狀態 | 必要行為 | 空狀態／錯誤文案 | 驗證方式 |
|---|---|---|---|
| 預設（亮色，未手動選過） | 首次造訪跟隨系統設定顯示亮色，圖示呈現「可切到暗色」的視覺 | 無 | 螢幕截圖 |
| 預設（暗色，未手動選過） | 首次造訪跟隨系統設定顯示暗色，圖示呈現「可切到亮色」的視覺 | 無 | 螢幕截圖 |
| 已手動選擇 | 之後造訪直接套用 localStorage 存的偏好，不再跟系統設定變動 | 無 | 手動切換系統設定後重新整理，確認網站顏色不受影響 |
| 切換中 | 點擊立即切換，無需等待（純前端狀態，不呼叫 API） | 不適用 | 螢幕截圖／互動測試 |
| hover/focus | 圖示有 hover 底色與鍵盤 focus outline | 不適用 | 螢幕截圖 |
| 行動裝置版 | Sidebar／品牌列本身既有響應式行為維持不變，圖示比例不變 | 不適用 | 螢幕截圖 |

## 互動

| 動作 | 觸發條件 | 結果 | 失敗情境 |
|---|---|---|---|
| 點擊切換圖示 | 使用者點擊或以鍵盤 Enter/Space 觸發 | 立即切換亮／暗色，寫入 localStorage | localStorage 不可用（無痕模式限制等）時，切換仍在當次瀏覽階段生效，僅不持久化，不阻斷操作 |

## 設計系統對照

- 用到的既有 design token：`grey`/`primary` 10 階（含 dark colorScheme）、`radius.sm`（8px，按鈕）、既有 `elevation1` 陰影、既有間距 scale
- 用到的既有元件：`components/ui/Sidebar.tsx`（個人資料區塊）、`app/_components/booking/BrandHeaderSection.tsx`（品牌列）；Variant C 沿用已登記的 Switch 元件比例
- 本畫面新做的元件：明暗模式切換控制項（依選定變體為 IconButton／Segmented Pill／Switch 三選一），完成後需登記回 `ai/context/design-system.md` 的 S4 元件庫 inventory

## 視覺驗收標準

- 文字在手機版與桌面版都不會被截斷。
- 主要動作清楚明確。
- 錯誤與空狀態明確呈現。
- **色彩、字體、間距、圓角、陰影一律取自 `design-system.md` 的 design token，沒有硬寫的一次性數值。**
- **重複使用元件庫 inventory 裡的既有元件；任何新做的元件都依既有 token 與風格製作，且已登記回 inventory。**
