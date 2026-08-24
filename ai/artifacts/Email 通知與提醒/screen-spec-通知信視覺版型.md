# 畫面規格

## Metadata

- 功能：Email 通知與提醒（TASK-060 追加：確認信／取消信／改期信／提醒信視覺優化）
- 畫面：四種通知信共用的 HTML 版型（Header：Logo／masthead；Footer：店家簽章）
- 狀態：mockup 已核准（Header 採變體 C／Footer 採變體 B 混搭，見
  `mockup-decision-確認信版型.md`）

## 目的

顧客收到的四種交易型通知信（確認、取消、改期、提醒），目前是純文字排版，讓顧客能
一眼認出寄件店家、留下品牌印象，並在信末留下完整聯絡方式（店名／電話／地址）。這不
是可互動的網頁，是單向、寄出即定型的 HTML 內容，不支援任何動作。

## 版面配置

- 主要區域：Header（Logo／店名 masthead）＋內文（既有的服務／時段資訊，四種信件各自
  不同，本次不改動文字內容邏輯）＋Footer（店家簽章：店名／電話／地址）。
- 次要區域：無（信件無側欄、無導覽）。
- 導覽：不適用（Email 無站內導覽）。
- 動作：不適用（本批次不含任何連結／按鈕，比照 feature-spec 既有「非目標：顧客自助
  查詢連結」的既有決策）。

## 狀態

Email 沒有互動性，下表把範本原本的「操作狀態」改成「資料狀態」與「顯示環境」，如實
標記哪些既有欄位不適用：

| 狀態 | 必要行為 | 空狀態／錯誤文案 | 驗證方式 |
|---|---|---|---|
| 預設（有 Logo） | `store_settings.logo_url` 有值時，Header 顯示 Logo 圖片（`alt` 為店名） | 不適用 | 螢幕截圖／mockup 檔案 |
| 空狀態（無 Logo） | `store_settings.logo_url` 為 `null` 時，省略圖片區塊，Header 改以純文字店名呈現（不留空白佔位、不顯示破圖） | Header 純文字店名 | 螢幕截圖／mockup 檔案 |
| 載入中 | 不適用（Email 為寄出當下就渲染完成的靜態 HTML，無非同步載入狀態） | 不適用 | 不適用 |
| 錯誤 | 不適用（沒有互動就沒有操作錯誤；Logo 圖片載入失敗屬於收件端顯示環境問題，由 `alt` 文字兜底，見「互動」表） | 不適用 | 不適用 |
| 停用 | 不適用 | 不適用 | 不適用 |
| 權限不足 | 不適用（收件人身分已由寄送對象決定，非本畫面關注範圍） | 不適用 | 不適用 |
| 行動裝置版 | 版面用 fluid table（`max-width:480px` 置中，無固定寬度斷點），窄螢幕（多數手機信箱 App）下自動縮至可視寬度，內距不塌陷 | 不適用 | 螢幕截圖（見各變體 mockup 檔案的行動裝置寬度預覽） |

## 互動

Email 本身不含任何可互動元素（連結／按鈕），下表改列「顯示環境差異」取代「操作」：

| 情境 | 觸發條件 | 結果 | 失敗情境 |
|---|---|---|---|
| 圖片預設不顯示（Gmail／Outlook 等客戶端常見行為） | 收件人的 email 客戶端預設封鎖外部圖片 | 顯示 `alt` 文字（店名），版面不因圖片缺席而跑版（`width`／`height` 皆已明確指定，不留不確定高度的空洞） | 若收件人手動允許顯示圖片，Logo 正常顯示，版面不重排 |
| 深色模式信箱（部分行動裝置信箱 App 會自動反轉背景色） | 收件人開啟系統深色模式 | 已知限制：本次版型未特別針對信箱 App 的自動深色模式做二次配色（多數 email 客戶端的深色模式是「自動反轉」而非讀取信件內建的 dark token，效果不可控），維持單一淺色版型，與業界交易型信件的常見做法一致 | 不適用 |

## 設計系統對照

- 用到的既有 design token：
  - 色彩：`grey.50` #FBF9F6（外層背景，B/C 用 `grey.200`／`primary.50` 作為頁面底／
    banner 底）、`grey.300` #E4DDD1（卡片邊框，取代網頁慣用的陰影——email 客戶端
    對 `box-shadow` 支援極不一致，改用邊框是本次唯一偏離 design-craft 規則 8「Depth
    三選一：陰影/背景/邊框不疊用」中「網頁優先用陰影」慣例的地方，屬於 email 這個
    媒介的技術限制，非隨意選擇，已於下方「設計系統對照」備註記錄）、`grey.700`
    #6B6259（次要文字／簽章文字）、`grey.900` #2B2622（內文主要文字）、`primary.500`
    #A9812F（強調色，用於狀態標籤等 mockup 說明文字，不進入實際信件內容）、
    `primary.700` #6F531E（店名強調文字，較 primary.500 對比更高，適合小字級）、
    `primary.50` #FBF4E2（變體 C banner／footer 卡片底色）。
  - 圓角：`radius.md` 12px（卡片外框）、`radius.sm` 8px（變體 B Logo 縮圖、變體 C
    footer 卡片）。
  - 間距：卡片內距 32px（近似 `space.card` 24 的下一階，email 卡片比網頁卡片留白
    更寬鬆，因為信件沒有其他版面元素分散注意力）、內部段落間距 16px／24px（皆為 4
    的倍數）。
  - 字級：14px（內文，對應 type scale `base`）、12px（簽章／次要文字，對應
    `sm`）、16-22px（店名強調，對應 `md`／`xl`，依變體而異）。
  - 字重：700（店名／標題）、600（簽章店名）、400（內文），符合 design-craft
    「至少三種字重」紀律。
- 新做並登記回 inventory 的元件：無（Email HTML 版型是獨立於 `components/ui/`
  的輸出媒介，不透過 React／MUI 元件渲染，不適用「元件庫 inventory」的登記機制；
  本次選定的版型會落地成 `lib/email/templates/` 底下的純函式，供四支信件共用）。
- **偏離網頁字體 token 的已知限制**：`design-system.md` S3 選定的中文字體是
  `next/font/google` 載入的 Noto Serif TC／Noto Sans TC，但多數 email 客戶端
  （尤其 Outlook 桌機版）不支援 `@font-face`／Google Fonts 外部字型，會直接回退到
  系統預設字體，即使信件內寫了字型名稱也不生效。三個變體皆改用「系統字體優先、
  中文襯線／黑體 fallback」的字型堆疊（標題：`Georgia, 'Noto Serif TC', 'PingFang
  TC', 'Microsoft JhengHei', serif`；內文：`-apple-system, BlinkMacSystemFont,
  'PingFang TC', 'Microsoft JhengHei', Helvetica, Arial, sans-serif`），只有極少數
  支援 Google Fonts 的客戶端（例如部分版本的 Apple Mail／Gmail 網頁版）才會顯示到
  Noto 字體本身，其餘一律回退到 Georgia／系統無襯線字體——這是 email 這個媒介的
  已知技術限制，非本次任務的疏漏。

## 視覺驗收標準

- 文字在手機版與桌面版都不會被截斷（已用 fluid table 驗證，見上方「狀態」表）。
- 有 Logo／無 Logo 兩種狀態皆版面完整、無破版或跑版。
- 色彩、字體、間距、圓角一律取自 `design-system.md` 的 design token（字型堆疊因
  email 客戶端限制而調整 fallback，色彩／間距／圓角數值本身仍對齊 token，見上方
  「已知限制」說明）。
- Logo 圖片皆有 `alt` 文字（店名），圖片被信箱封鎖時不影響版面完整性。
- 顧客姓名等使用者輸入內容延續 `lib/email/format.ts` 的 `escapeHtml` 紀律（mockup
  階段用固定範例資料展示，非本規格書驗收範圍，於實作階段的驗證契約把關）。
