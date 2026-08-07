# 畫面規格

## Metadata

- 功能：預約管理後台
- 畫面：預約週曆／列表（含標記完成／取消／改期三個操作）
- 狀態：mockup 已核准（2026-08-05；選定變體 B「展開事件卡＋Modal 操作」，見
  [`mockup-decision-預約週曆列表.md`](mockup-decision-預約週曆列表.md)）

## 目的

讓設計師登入後台後，能一眼看出本週忙閒分佈，並針對任一筆預約快速執行「標記完成」「取消」
「改期」三個操作，不用切到 Supabase dashboard。

## 版面配置

- 主要區域：預約週曆（預設）／預約列表（可切換），每筆預約顯示顧客姓名、服務、時段、狀態
- 次要區域：左側 Sidebar 導覽（預約／服務設定／營業時間／登出，本 Epic 只實作「預約」項）
- 導覽：Sidebar 固定顯示三個區塊入口＋登出；頂部週次切換（上一週／本週／下一週）與
  週曆／列表檢視切換
- 動作：切換週次、切換檢視、點選預約標記完成、點選預約取消（二次確認）、點選預約改期
  （表單選新時段）

## 狀態

| 狀態 | 必要行為 | 空狀態／錯誤文案 | 驗證方式 |
|---|---|---|---|
| 預設（週曆） | 顯示本週 7 天，每天顯示當天預約事件 | 不適用 | 螢幕截圖 |
| 載入中 | 週曆／列表區塊顯示 skeleton 佔位 | 不適用 | 螢幕截圖 |
| 空狀態 | 該週或該檢視無任何預約 | 「本週沒有預約」 | 螢幕截圖 |
| 錯誤 | 標記完成／取消／改期送出失敗 | Toast：「操作失敗，請稍後再試」；改期衝突顯示「這個時段已被其他預約占用」 | 螢幕截圖 |
| 停用 | 已 `cancelled`／`completed` 的預約不提供標記完成／取消／改期操作入口 | 不適用（操作入口直接不顯示，不是顯示後才報錯） | 螢幕截圖 |
| 權限不足 | 非管理者或未登入 | 沿用 TASK-003 既有機制導回登入頁 | 不適用（沿用既有實作） |
| 行動裝置版 | 非本階段設計重點（沿用 Epic 0 S5 假設：後台以桌面／平板為主） | 不適用 | 不適用 |

## 互動

| 動作 | 觸發條件 | 結果 | 失敗情境 |
|---|---|---|---|
| 切換週次 | 點擊上一週／下一週／本週 | 重新查詢並顯示對應週次資料，區塊內 loading，不整頁重新整理 | 查詢失敗顯示 Toast 錯誤 |
| 切換檢視 | 點擊「週曆」／「列表」 | 主內容區切換呈現方式，資料相同 | 不適用 |
| 開啟預約詳情 | 點選週曆上的事件卡（或列表上的一列） | 開啟置中 Modal，顯示顧客／服務／時段／狀態，並提供「標記完成」「改期」「取消預約」「關閉」四個動作（依狀態決定顯示哪些，見「停用」狀態列） | 不適用 |
| 標記完成 | 在詳情 Modal 中，`pending`／`confirmed` 預約點「標記完成」 | 狀態變 `completed`，Modal 關閉，畫面即時反映，Toast 成功提示 | 更新失敗顯示 Toast 錯誤，狀態不變，Modal 停留 |
| 取消預約 | 在詳情 Modal 中，非 `cancelled`／`completed` 預約點「取消預約」 | Modal 內容切換為二次確認文案（沿用 `ConfirmDialog` 樣式），確認後狀態變 `cancelled`，Modal 關閉，Toast 成功提示 | 更新失敗顯示 Toast 錯誤，狀態不變；可返回不執行 |
| 改期預約 | 在詳情 Modal 中，非 `cancelled`／`completed` 預約點「改期」 | Modal 內容切換為改期表單（新日期／新時段），送出後更新 `start_at`／`end_at`，Modal 關閉，畫面即時反映新時段，Toast 成功提示 | 新時段與既有預約重疊：資料庫 exclusion constraint 擋下，Modal 內顯示「這個時段已被其他預約占用」，原時段不變，表單停留可重新選擇 |

## 設計系統對照

- 用到的既有 design token：primary（強調色／CTA、選取狀態）、grey 色階（文字階層、
  背景、分隔線）、success／warning／danger（預約狀態色：`completed`＝success、
  `pending`＝warning、`cancelled`＝danger 系但降低視覺權重）、type scale、spacing scale、
  radius.sm/md、elevation1/2 陰影。
- 用到的既有元件：Table（列表檢視）、Card（事件卡片變體）、Button、Chip（狀態標籤／週次
  切換）、TextField／Select（改期表單的日期時段選擇）、ConfirmDialog（取消二次確認）、
  Toast/Alert（操作結果）、Skeleton（載入中）。
- 本畫面新做的元件：
  - **Sidebar 導覽**：MUI 沒有對應單一元件，比照 `components/ui/Nav.tsx`（既有頂欄 AppBar
    組合模式）新增 `components/ui/Sidebar.tsx`，用既有 grey／primary token 與
    typography.subtitle2，完成後登記回 S4 inventory。
  - **週曆格狀檢視（WeekCalendar）**：MUI 沒有現成日曆格狀元件，新增
    `components/ui/WeekCalendar.tsx`（或依實際任務卡拆分至 `app/admin/_components/`，視是
    否具跨頁通用性於任務卡階段決定），依選定的變體 B：7 欄日期格，每格內是「展開事件卡」
    （時間／姓名／服務／狀態徽章，用既有 Card／Chip 樣式語言），單日事件過多時格內可捲動；
    點選事件卡開啟置中 Modal（用 MUI `Dialog`，比照 `ConfirmDialog` 的實作模式但內容依
    「詳情／取消確認／改期表單」三種子畫面切換），完成後登記回 S4 inventory。

## 視覺驗收標準

- 文字在桌面（1200px 上下）與平板（768px 上下）都不會被截斷。
- 主要動作（切換週次、標記完成、取消、改期）清楚明確，符合舒適密度（S2 選定變體 A）。
- 錯誤與空狀態明確呈現；停用狀態（已取消／已完成的預約）不提供操作入口，不是顯示後才擋。
- 色彩、字體、間距、圓角、陰影一律取自 `design-system.md` 的 design token，沒有硬寫的一次性數值。
- 重複使用元件庫 inventory 裡的既有元件；本畫面新做的 Sidebar／WeekCalendar 依既有 token 與
  風格製作，且已登記回 inventory。
