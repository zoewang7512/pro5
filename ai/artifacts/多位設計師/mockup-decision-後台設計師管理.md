# Mockup 決策

## Metadata

- 功能：多位設計師
- 畫面：後台設計師管理列表＋編輯頁（`screen-spec-後台設計師管理.md`）
- 決策負責人：使用者
- 狀態：已選定

## 變體

| 變體 | 說明 | 優點 | 風險 |
|---|---|---|---|
| A | 表格列表（順序箭頭、設計師、專長、提供服務數、狀態、操作），編輯頁用四個頁籤「基本資料／提供服務／作品集／請假」。基本資料按底部「儲存」，其他三個頁籤即時生效。檔案：[`mockups/admin-designers-variant-a.html`](mockups/admin-designers-variant-a.html) | 和已核准的「服務項目管理」表格風格一致，資訊密度高、方便比較；頁籤把四種性質不同的操作分開，每次只看一塊，不會混淆「哪些要按儲存、哪些即時生效」；順序用上下箭頭，不需要新增拖曳套件 | 要切頁籤才看得到全部設定；列表看不到作品集預覽 |
| B | 卡片牆列表（大頭像、專長、前 3 張作品預覽、拖曳排序），編輯頁比照已核准的「帳號設定頁」，單頁捲動四張卡片加右側錨點；新增設計師先用 Modal 只填名稱。檔案：[`mockups/admin-designers-variant-b.html`](mockups/admin-designers-variant-b.html) | 列表最接近顧客在前台看到的樣子，作品集一眼可見；編輯頁一頁看完全部設定；新增流程先建立再補資料，避免長表單一次填完的負擔 | 拖曳排序需要新增套件（或自己實作拖放），增加依賴與無障礙處理成本；單頁裡同時有「按儲存」和「即時生效」兩種卡片，店長容易誤以為服務開關也要按儲存；卡片牆在設計師多時比表格佔空間 |

## 設計系統對照

- 重用的 token／元件：grey／primary／success／warning／danger／info token、radius.sm／md、
  elevation1／2；Sidebar、Table（A）／Card（B）、Button、Input、Switch、Chip、ConfirmDialog
  （`children` 插槽）、ImageUploadField、MonthPicker、Toast/Alert、Skeleton、FormSection。
- 新做並登記回 inventory 的元件（實作時登記）：`TagInput`（用 MUI `Autocomplete` 的 multiple
  加 freeSolo，不另做 wrapper）、`PortfolioManager`（作品集後台格狀管理）；B 另需拖曳排序。

## 建議

建議 **Variant A**。和既有服務項目管理頁一致，店長不需要學新的操作方式；頁籤清楚區隔「要按
儲存」與「即時生效」的區塊；不需要新增拖曳套件。如果你喜歡 B 列表上的作品預覽，可以在 A 的
表格加一欄「作品 N 張」，或者在列表用 B 的卡片牆，搭配 A 的頁籤編輯頁。

## 選定的變體

- 變體：**A（表格列表＋分頁籤編輯頁）**
- 為何選這個：與既有服務項目管理頁一致；頁籤清楚區隔「按儲存」與「即時生效」的區塊；順序用
  上下箭頭，不需要新增拖曳套件。
- 實作前要求的修改：無。

## 人工核准

- 核准者：使用者
- 日期：2026-10-21
- 備註：無。
