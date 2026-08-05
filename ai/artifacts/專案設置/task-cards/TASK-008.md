# AI-Ready 任務卡

## Metadata

- 任務：UI 設計系統 S5：顧客前台版面 mockup
- 上層規格：無（Epic 0 UI 設計系統，五階段流程第 5 階）
- 上層 Epic：專案設置
- 上層 User Story：UI 設計系統
- 分軌：前端
- 前置任務（dependsOn）：TASK-007
- 狀態：完成（2026-08-05 核准，選定變體 B）
- 風險等級：低
- Agent owner：Claude Code
- 人工核准者：使用者

## 目標

用已定案的 token 與元件庫，拼出顧客前台核心畫面（服務列表／選時段／填寫資訊／預約成功）的 2-3 個版面變體，供人工選定一個版型並記錄於 `design-system.md`。

## 情境包（Context Pack）

- 相關檔案：`ai/context/design-system.md`、`ai/artifacts/專案設置/mockups/`、`ai/artifacts/專案設置/mockup-decision-顧客前台.md`。
- 既有模式：套用 `ui-mockup-gate` 與 `ai/skills/design-craft.md`；必須只用 S4 已入庫的元件與 S3 token 拼版面，不得另創新元件。
- 假設：顧客前台主要使用情境為行動裝置。
- 未知事項：無。
- 允許變更的檔案：mockup 檔案、`design-system.md` 的 S5 章節。
- 不得觸碰：實際頁面程式碼實作（此階段只做版面 mockup，非最終程式碼，待「顧客預約流程」Epic 實作時才落地）。

## 需求

- 產出 2-3 個顧客前台版面變體，涵蓋整體版型、資訊架構、導覽與內容區配置。
- 依 `ui-mockup-gate` 呈現給人工選擇，記錄決策於 `mockup-decision-顧客前台.md`。

## 驗收標準

- `design-system.md` 的 S5 表格「顧客前台」列填入選定版型與核准紀錄。
- Mockup 決策文件存在且連結正確。

## 實作備註

- 這是版面骨架決策，不含最終文案與真實資料，聚焦在版型與資訊架構。

## 驗證契約

- 單元測試：不適用。
- 整合測試：不適用。
- E2E 測試：不適用。
- 型別檢查：不適用。
- Lint：不適用。
- Build：不適用。
- 螢幕截圖：每個版面變體（含行動裝置尺寸）。
- 安全性檢查：不適用。

## 完成證據

- 變更的檔案：
  - `ai/artifacts/專案設置/screen-spec-顧客前台預約流程.md`（畫面規格：版面配置、狀態、
    互動、設計系統對照）
  - `ai/artifacts/專案設置/mockups/customer-flow-variant-a.html`／`-b.html`／`-c.html`
    （3 個版面變體，行動裝置尺寸 375×720，各含服務列表/選時段/填寫資訊/預約成功 4 個畫面）
  - `ai/artifacts/專案設置/mockup-decision-顧客前台.md`（變體比較、選定紀錄）
  - `ai/context/design-system.md`（S5 章節：顧客前台列填入選定版型、決策連結、人工核准）
- 執行過的指令：
  - 以 Browser 工具開啟三個變體 HTML，確認渲染正常（含 selected/active/error/disabled 等
    狀態呈現）
  - 以 `AskUserQuestion` 呈現三個變體供人工比較，使用者選定變體 B「單頁捲動」
- 測試輸出：不適用（本任務驗證契約僅要求版面變體視覺呈現）。
- 螢幕截圖：三個變體皆已於 Browser 工具截圖確認（見驗證報告）。
- 已知限制：
  - 這是版面骨架決策，不含最終文案與真實資料串接，留給「顧客預約流程」Epic 實作時落地。
  - 變體 B 已完全用既有元件庫組成，不需要新元件；但實作時要留意已完成區塊收合為摘要列的
    互動細節，以及行動裝置長頁捲動的效能與捲動定位。
  - 變體 A（若未來改弦更張）需要額外新增 Stepper 元件並登記回 S4 inventory，本次未選用故
    未實作。
- 後續任務：「顧客預約流程」Epic 的實作任務卡；TASK-009（S5 設計師後台版面 mockup）。
