# Mockup 決策

## Metadata

- 功能：Email 通知與提醒（TASK-060：確認信／取消信／改期信／提醒信視覺優化）
- 畫面：四種通知信共用的 HTML 版型（Header：Logo／masthead；Footer：店家簽章）
- 決策負責人：使用者
- 狀態：已選定

## 變體

| 變體 | 說明 | 優點 | 風險 |
|---|---|---|---|
| A | Logo 置頂置中＋店名 masthead，分隔線切開 Header／內文／Footer；Footer 簽章（店名／電話／地址）置中三行 | 資訊層級最清楚，Header／內文／Footer 三段分明；正式、穩重，符合「質感沉靜」風格方向的品牌調性 | 版面略長（多兩條分隔線＋置中 masthead 的高度），四種信件疊起來看可能稍顯重複；置中排版在極窄螢幕仍安全，但視覺上比 B 稍占版面 |
| B | 小 Logo 與店名並排同一行（比照顧客前台品牌顯示區塊「小 Logo＋店名」的既有慣例），無分隔線；Footer 簽章弱化成一行小字，緊接內文 | 版面最精簡、最不干擾閱讀主要資訊（服務／時段）；與顧客前台既有的品牌顯示模式一致，降低使用者認知負擔、也降低未來維護心智負擔（同一套「小 Logo＋店名」邏輯只維護一份設計語言） | 品牌識感最弱，Logo 縮得很小，店家形象不夠突出；Footer 一行小字容易被忽略，若顧客需要電話/地址反而不容易一眼找到 |
| C | 淺金色（primary.50）banner 大 Logo；Footer 簽章改用淺灰底卡片，像隨信附上的小名片 | 品牌識感最強、最有設計感，與 Aesop／Fresha 這類參考產品的「留白＋品牌質感」調性最接近；Footer 卡片化讓聯絡資訊最好找、最不會被忽略 | 版面最重（banner＋footer 卡片兩個額外色塊），四種信件的視覺份量最大；無 Logo 時 banner 退化成純文字大字（22px），雖有處理但仍是三者中「無 Logo 狀態」與「有 Logo 狀態」視覺落差最大的 |

三個變體皆已建立 mockup 檔案並在瀏覽器實際驗證（含有 Logo／無 Logo 兩種狀態、桌面與
行動裝置寬度）：
- [`mockups/confirmation-email-variant-a.html`](mockups/confirmation-email-variant-a.html)
- [`mockups/confirmation-email-variant-b.html`](mockups/confirmation-email-variant-b.html)
- [`mockups/confirmation-email-variant-c.html`](mockups/confirmation-email-variant-c.html)

## 設計系統對照

- 重用的 token：`grey.50`／`grey.300`／`grey.700`／`grey.900`／`primary.50`／
  `primary.500`／`primary.700`、`radius.sm`／`radius.md`、4 的倍數間距 scale、type
  scale 字級、三種以上字重。詳細對照見
  [`screen-spec-通知信視覺版型.md`](screen-spec-通知信視覺版型.md)「設計系統對照」
  段落，含 email 客戶端字體 fallback 的已知限制說明。
- 新做並登記回 inventory 的元件：無（Email HTML 版型不透過 React／MUI 元件渲染，
  不適用元件庫 inventory 登記機制，理由同上）。

## 選定的變體

- 變體：**混搭**——Header 採變體 C（淺金色 banner＋置中放大 Logo，無 Logo 時 banner
  改顯示大字店名）；Footer 採變體 B（不做卡片化，簽章一行小字緊接內文最後一段，不
  額外佔用版面）。已建立對應 mockup 檔案：
  [`mockups/confirmation-email-selected.html`](mockups/confirmation-email-selected.html)
  （含有 Logo／無 Logo 兩種狀態，已在瀏覽器實際驗證）。
- 為何選這個：Header 想要 C 的品牌識感（大 Logo banner，四種信件第一眼就能認出是
  哪家店），但不想要 C 的 footer 卡片化造成的版面份量——B 的極簡一行簽章更輕量，
  兩者結合後 Header 突出品牌、Footer 不喧賓奪主，是三個原始變體之外更符合需求的
  組合。
- 實作前要求的修改：無（mockup 已完整涵蓋有/無 Logo 兩種狀態，可直接依此進入
  `implementation-plan` 階段）。

## 人工核准

- 核准者：使用者
- 日期：2026-08-24
- 備註：核准 Header（變體 C）＋Footer（變體 B）的混搭版型，套用到四種通知信
  （確認／取消／改期／提醒）。
