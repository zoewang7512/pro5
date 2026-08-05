# AI-Ready 任務卡

## Metadata

- 任務：UI 設計系統 S2：視覺風格方向
- 上層規格：無（Epic 0 UI 設計系統，五階段流程第 2 階）
- 上層 Epic：專案設置
- 上層 User Story：UI 設計系統
- 分軌：前端
- 前置任務（dependsOn）：TASK-004
- 狀態：完成（人工已選定變體 A「質感沉靜」，2026-08-05 核准）
- 風險等級：低
- Agent owner：Claude Code
- 人工核准者：待指定

## 目標

依 S1 選定的框架與元件庫策略，產出 2-3 個 style tile（風格方向變體），供人工比較整體氣質後選定一個方向，寫入 `design-system.md` 的「S2 風格方向」。

## 情境包（Context Pack）

- 相關檔案：`ai/context/design-system.md`。
- 既有模式：套用 `ai/skills/design-craft.md` 的設計工藝紀律。
- 假設：理髮廳品牌調性可能傾向質感、專業、放鬆；實際色彩情緒由 style tile 呈現多個方向讓人工選擇，不預設單一答案。
- 未知事項：無。
- 允許變更的檔案：`ai/context/design-system.md`、`ai/artifacts/專案設置/mockups/`（style tile 檔案）。
- 不得觸碰：S3 以後的 token／元件實作。

## 需求

- 產出 2-3 個 style tile，每個呈現：色彩情緒、字體個性、圓角／陰影傾向、密度（緊湊/舒適）、亮／暗模式、1-2 個參考產品。
- 依 `ui-mockup-gate` 流程呈現給人工比較，選定後記錄核准。

## 驗收標準

- `design-system.md` 的 S2 章節填入選定的風格方向、理由與核准紀錄。
- 至少產出 2 個以上風格方向供比較（不可只做一個直接定案）。

## 實作備註

- 這階段只做風格方向 tile，不是完整版面，避免提前跳到 S5。

## 驗證契約

- 單元測試：不適用。
- 整合測試：不適用。
- E2E 測試：不適用。
- 型別檢查：不適用。
- Lint：不適用。
- Build：不適用。
- 螢幕截圖：每個 style tile 的視覺呈現。
- 安全性檢查：不適用。

## 完成證據

- 變更的檔案：
  - `ai/artifacts/專案設置/mockups/style-tile-a.html`／`style-tile-b.html`／`style-tile-c.html`
    （3 個 style tile 變體：質感沉靜／現代簡約／溫暖放鬆）
  - `ai/artifacts/專案設置/mockup-decision-style-direction.md`（變體比較、選定紀錄）
  - `ai/context/design-system.md`（S2 章節：填入選定的 style tile、色彩情緒、字體個性、
    圓角／陰影傾向、密度、亮暗模式、參考產品、選定理由與人工核准紀錄）
- 執行過的指令：
  - 以 Browser 工具開啟三個 style tile HTML，確認渲染正常並實測亮／暗模式切換
  - 以 `AskUserQuestion` 呈現三個變體供人工比較，使用者選定變體 A「質感沉靜」
- 測試輸出：不適用（本任務驗證契約僅要求 style tile 視覺呈現）。
- 螢幕截圖：三個 style tile 皆已於 Browser 工具截圖確認（亮色／暗色皆驗證，見驗證報告）。
- 已知限制：後台（表格/表單密集場景）是否需要不同密度設定，留待 S3 design token／S4 元件庫
  階段視實際畫面需要再調整，S2 階段不另立第二套風格。
- 後續任務：TASK-006（S3 Design Token）。
