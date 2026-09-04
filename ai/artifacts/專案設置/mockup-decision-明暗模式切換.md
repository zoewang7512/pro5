# Mockup 決策

## Metadata

- 功能：UI 設計系統 — 明暗模式手動切換
- 畫面：設計師後台 Sidebar 底部個人資料區塊、顧客前台 BrandHeaderSection 品牌列
- 決策負責人：使用者
- 狀態：已選定

## 變體

| 變體 | 說明 | 優點 | 風險 |
|---|---|---|---|
| A | 32×32 純圖示按鈕（IconButton），單一 icon 依當下模式顯示對應圖示（亮色顯示月亮＝可切暗，暗色顯示太陽＝可切亮） | 最省版面，Sidebar 個人資料列不擠；實作最簡單 | 不點擊看不出「目前是使用者手動選的還是跟系統」；狀態單一，資訊量較少 |
| B | 太陽／月亮雙圖示並列於 Segmented Pill 容器，當前模式該顆有底色＋陰影高亮 | 不點擊也能看出目前狀態；沿用既有 `admin-variant-c.html` view-toggle 的視覺語言，風格一致 | 比 A 寬，Sidebar 個人資料列略擠；是新做元件（Pill 容器），需登記回 inventory |
| C | 沿用 S4 已登記 Switch 元件比例，thumb 左右滑動、疊放太陽／月亮圖示 | 與既有 Switch（營業時間公休切換）視覺語言完全一致，使用者已熟悉這個互動模式 | 圖示縮在 12px thumb 內偏小；三者中最寬，Sidebar 個人資料列最擠 |

## 設計系統對照

- 重用的 token／元件：`grey`/`primary` 色階（含 dark colorScheme）、`radius.sm`、既有 elevation 陰影、間距 scale；C 案額外重用已登記的 Switch 元件比例
- 新做並登記回 inventory 的元件：三個變體皆為新做「明暗模式切換控制項」，選定後依核准變體登記回 `design-system.md` S4

## 選定的變體

- 變體：A（純圖示按鈕 IconButton）
- 為何選這個：使用者核准，最省版面、實作最簡單，Sidebar 個人資料列與品牌列都不會因為新增控制項而變擠。
- 實作前要求的修改：無。

## 人工核准

- 核准者：使用者
- 日期：2026-09-05
- 備註：對話中核准，於三個變體比較後選定 Variant A。
