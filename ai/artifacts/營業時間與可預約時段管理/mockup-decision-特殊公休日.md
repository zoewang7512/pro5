# Mockup 決策

## Metadata

- 功能：營業時間與可預約時段管理（第二批次「設定公休日／特殊假期」story，只支援整天公休）
- 畫面：營業時間設定（`/admin/business-hours`）新增的「特殊公休日」區塊
- 決策負責人：使用者
- 狀態：已選定

## 變體

| 變體 | 說明 | 優點 | 風險 |
|---|---|---|---|
| A 清單＋新增列 | 區塊上方一個日期輸入框＋「新增公休日」按鈕，下方是已設定日期的清單（每筆一行，右側移除按鈕） | 全部重用既有元件（`TextField type="date"`／`Button`），實作成本最低、風險最小；跟上方每週固定營業時間的表格視覺語言一致（清單式、資訊密度均衡）；新增/移除的互動路徑最短，容易理解 | 沒有月曆視覺，設計師無法「一眼看到整月哪些天已標記」，需要逐筆讀清單；輸入日期只能用瀏覽器原生 date picker，體驗普通 |
| B 小型月曆選取器＋清單 | 左側一個小型月曆（月檢視，可翻頁），點選日期直接標記／取消標記；右側清單彙總已設定日期，可個別移除 | 視覺上「這個月有哪幾天公休」一目了然，符合本 Epic 已建立的行事曆語言（`WeekCalendar` 週檢視）；點選互動比輸入日期更直覺，減少打字 | 需要新做一個月曆格狀元件（S4 inventory 目前沒有月檢視元件，只有週檢視的 `WeekCalendar`），開發與測試成本較高；月曆本身要處理跨月導覽、今天標示、過去日期停用等狀態，複雜度明顯高於變體 A；區塊需要更寬的版面（兩欄），桌面尺寸下需要確認與上方週表格對齊不擁擠 |

兩個變體皆包含「新增→受影響預約警告」的二次確認 Modal（沿用既有 `ConfirmDialog` 的
「主要操作／再想想」按鈕配置與 children 插槽模式，內容改成公休日情境文案），這部分兩個
變體共用同一套互動與視覺，不是變體間的差異點。

## 設計系統對照

- 重用的 token／元件：`grey`／`primary`／`warning`／`info` 色階、`radius.sm`/`md`、
  `elevation1`/`elevation2` 陰影、4 的倍數間距、type scale（皆取自 `design-system.md` S3）；
  `ConfirmDialog`（受影響預約警告 Modal）、`Button`。變體 A 額外重用 `TextField`
  （`type="date"`）；變體 B 額外重用 `Card`／`Box` 拼版面容器。
- 新做並登記回 inventory 的元件：僅變體 B 需要——**月曆格狀選取器（Month Picker）**，S4
  inventory 目前只有週檢視的 `WeekCalendar`（`app/admin/_components/WeekCalendar.tsx`，
  頁面專用非跨頁共用），沒有月檢視、可點選標記的元件。若選變體 B，需要依既有色彩/圓角/
  陰影風格新做（今天標示比照 `WeekCalendar` 的 `outline: primary.main` 做法、已標記日期用
  `warning.light` 背景＋`warning` 文字色，比照受影響預約警告列的既有配色慣例），完成後登記
  回 `design-system.md` 的 S4 元件庫 inventory。變體 A 不需要新做元件。

## 選定的變體

- 變體：B 小型月曆選取器＋清單
- 為何選這個：使用者核准。「特殊公休日」屬於一年沒幾次的低頻操作，但比起變體 A 的清單，
  月曆視覺能讓設計師一眼看到整月的公休分佈，貼近本 Epic 已建立的行事曆語言（`WeekCalendar`
  週檢視），互動也更直覺（點選日期，不必打字輸入）。
- 實作前要求的修改：需要先完成「新做並登記回 inventory」的月曆選取器元件（月檢視、可點選
  標記、跨月導覽、今天標示、過去日期停用）才能進入任務卡實作；比照 mockup 的視覺規則
  （今天 = primary outline，已標記 = warning.light 背景＋warning 文字色＋小圓點）。

## 人工核准

- 核准者：使用者
- 日期：2026-08-06
- 備註：兩個變體已存放於本目錄
  `mockups/business-hours-closures-variant-a.html`／
  `mockups/business-hours-closures-variant-b.html`（皆為桌面尺寸 980px 寬 frame，各 3 個
  狀態：預設／空狀態／受影響預約警告）。已用 Browser 工具開啟兩個檔案確認結構正確渲染、
  無 console 錯誤（變體 B 初版月曆日期排列有誤已修正），並已將檔案發送給使用者直接開啟
  確認視覺細節。使用者核准選定變體 B。
