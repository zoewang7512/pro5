# Mockup 決策

## Metadata

- 功能：Epic 0 UI 設計系統 S5（設計師後台版面）
- 畫面：設計師後台核心畫面（登入、預約列表／日曆、服務與營業時間設定）
- 決策負責人：使用者
- 狀態：已選定

## 變體

| 變體 | 說明 | 優點 | 風險 |
|---|---|---|---|
| A 側邊欄導覽（Sidebar Nav） | 左側固定 sidebar（Logo/預約/服務設定/營業時間/登出），右側內容區；預約用 Table 呈現 | 經典後台版型，導覽項目一目瞭然，擴充新區塊（未來 Epic）容易；Table 適合掃視大量預約 | 桌面寬度較窄（如平板）時 sidebar 會壓縮內容區；需要新增 Sidebar 元件（S4 目前只有頂欄 Nav） |
| B 頂部導覽＋頁籤（Top Nav + Tabs） | 無 sidebar，頂欄＋頁籤切換，內容區滿版寬度 | 完全沿用既有 `components/ui/Nav.tsx`（頂欄），不需新元件；畫面少時最輕量、內容區最寬 | 區塊變多時頁籤會擁擠；不利於未來擴充成多層導覽（例如「預約管理」Epic 若要加子選單） |
| C 側邊欄＋日曆優先（Sidebar + Calendar-first） | 側邊欄同 A，但預約主視覺是週曆網格（可切換列表檢視），服務/營業時間仍是列表+表單 | 週曆視覺化直接看出忙閒時段分佈，適合大量預約管理情境；提供列表/週曆切換兼顧兩種瀏覽習慣 | 同時需要新增 Sidebar 與週曆網格兩個新元件，複雜度最高；週曆在小尺寸（平板直向）容易擠壓 |

## 設計系統對照

- 重用的 token／元件：primary/grey/semantic 色階、type scale、spacing scale、radius.sm/md、
  elevation1/2 陰影（S3）；視覺上對應 Table／Card／Button／TextField 的既有樣式語言（S4）。
- 新做並登記回 inventory 的元件：無（mockup 階段不新增真實元件）。若選 A 或 C，需在對應
  Epic 實作時新增 Sidebar 導覽元件並登記回 S4 inventory；若選 C，另需新增週曆格狀檢視元件。
  若選 B，可完全沿用既有 `components/ui/Nav.tsx`（頂欄樣式），不需要新元件。

## 選定的變體

- 變體：C 側邊欄＋日曆優先（Sidebar + Calendar-first）
- 為何選這個：相較 A（表格式列表，忙閒時段不直觀）與 B（無 sidebar，未來擴充多層導覽較受限），
  C 的週曆視覺化能直接看出忙閒時段分佈，最貼合「大量預約管理」的實際工作情境；列表/週曆
  切換也保留了表格瀏覽的彈性。
- 實作前要求的修改：無立即修改。實作對應 Epic 時需要：(1) 新增 Sidebar 導覽元件並登記回
  S4 inventory；(2) 新增週曆格狀檢視元件（含事件卡片、忙/待確認狀態色）並登記回 S4
  inventory；(3) 評估平板直向尺寸下週曆網格的縮排/捲動處理。

## 人工核准

- 核准者：使用者
- 日期：2026-08-05
- 備註：三個變體已存放於 `ai/artifacts/專案設置/mockups/admin-variant-a.html`、
  `admin-variant-b.html`、`admin-variant-c.html`，皆為桌面尺寸（720×460 frame，代表
  桌面/平板版型），已在瀏覽器驗證渲染正常。選定結果已寫入 `ai/context/design-system.md`
  的 S5 章節。
