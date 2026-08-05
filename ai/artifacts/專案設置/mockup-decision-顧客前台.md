# Mockup 決策

## Metadata

- 功能：Epic 0 UI 設計系統 S5（顧客前台版面）
- 畫面：顧客預約流程（服務列表 → 選時段 → 填寫資訊 → 預約成功）
- 決策負責人：使用者
- 狀態：已選定

## 變體

| 變體 | 說明 | 優點 | 風險 |
|---|---|---|---|
| A 分步精靈（Step Wizard） | 每步一頁，頂部固定進度列（1-2-3-4），底部固定 CTA，一次只看一件事 | 認知負擔最低，適合手機小螢幕逐步完成；流程狀態（成功/錯誤）最容易獨立設計；最容易做「上一步」返回 | 步驟間需要頁面切換，步數多時感覺較長；需要新增 Stepper 元件（S4 inventory 目前沒有） |
| B 單頁捲動（Single-page Accordion） | 所有步驟同一頁，選好上一步自動展開下一區塊，已完成的區塊收合成摘要列（可點「修改」回頭調整） | 全程只有一個頁面，捲動比跳轉更流暢；隨時可看到已選內容，修改不用整個流程重來 | 頁面隨進度變長，最後一步要滑較遠；同頁塞 3-4 個區塊，行動裝置上仍需仔細控制密度避免壅擠 |
| C 列表優先＋底部彈出（List-first + Bottom Sheet） | 服務列表是主頁面常駐背景，點服務後用同一個 bottom sheet 疊加顯示選時段／填資訊，完成後 sheet 收合、列表頁用 toast 提示成功 | 最貼近原生 App 的沉浸式體驗，服務列表隨時可見可比較；sheet 收合比整頁跳轉更輕量 | 兩個子步驟（選時段／填資訊）擠在同一個 sheet 裡切換，資訊架構比 A/B 稍隱晦；需要额外處理 sheet 高度與捲動 |

## 設計系統對照

- 重用的 token／元件：primary/grey/semantic 色階、type scale、spacing scale、radius.sm/md、
  elevation1/2 陰影（S3）；視覺上對應 Card／Button／TextField／Alert 的既有樣式語言（S4）。
- 新做並登記回 inventory 的元件：無（mockup 階段不新增真實元件）。若選定變體 A，需要在
  「顧客預約流程」Epic 實作時新增 Stepper／進度指示元件並登記回 S4 inventory（已知缺口，
  詳見 `screen-spec-顧客前台預約流程.md` 的「設計系統對照」）；變體 B／C 皆可完全用既有
  Card/Button/TextField/Alert 組成，不需要新元件。

## 選定的變體

- 變體：B 單頁捲動（Single-page Accordion）
- 為何選這個：相較 A（需要新增 Stepper 元件、頁面切換較多）與 C（兩個子步驟擠在同一個
  bottom sheet 裡，資訊架構較隱晦），B 完全用既有元件庫組成、不需要新元件；單頁捲動讓顧客
  隨時看得到已選內容並能就地修改，流程感覺最連貫。
- 實作前要求的修改：無立即修改。實作「顧客預約流程」Epic 時需注意：已完成區塊收合為摘要列
  （含「修改」連結）的互動細節、以及行動裝置上長頁捲動的效能與捲動定位（例如展開新區塊後
  是否要自動捲動聚焦）。

## 人工核准

- 核准者：使用者
- 日期：2026-08-05
- 備註：三個變體已存放於 `ai/artifacts/專案設置/mockups/customer-flow-variant-a.html`、
  `customer-flow-variant-b.html`、`customer-flow-variant-c.html`，皆為行動裝置尺寸
  （375×720），已在瀏覽器驗證渲染正常。選定結果已寫入 `ai/context/design-system.md` 的
  S5 章節。
