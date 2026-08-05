# AI-Ready 任務卡

## Metadata

- 任務：UI 設計系統 S5：設計師後台版面 mockup
- 上層規格：無（Epic 0 UI 設計系統，五階段流程第 5 階）
- 上層 Epic：專案設置
- 上層 User Story：UI 設計系統
- 分軌：前端
- 前置任務（dependsOn）：TASK-007
- 狀態：完成（2026-08-05 核准，選定變體 C）
- 風險等級：低
- Agent owner：Claude Code
- 人工核准者：使用者

## 目標

用已定案的 token 與元件庫，拼出設計師後台核心畫面（登入、預約列表／日曆、服務與營業時間設定）的 2-3 個版面變體，供人工選定一個版型並記錄於 `design-system.md`。

## 情境包（Context Pack）

- 相關檔案：`ai/context/design-system.md`、`ai/artifacts/專案設置/mockups/`、`ai/artifacts/專案設置/mockup-decision-設計師後台.md`。
- 既有模式：套用 `ui-mockup-gate` 與 `ai/skills/design-craft.md`；只用 S4 已入庫的元件與 S3 token 拼版面。
- 假設：設計師後台主要使用情境為桌面／平板。
- 未知事項：無。
- 允許變更的檔案：mockup 檔案、`design-system.md` 的 S5 章節。
- 不得觸碰：實際頁面程式碼實作（此階段只做版面 mockup）。

## 需求

- 產出 2-3 個設計師後台版面變體，涵蓋整體版型、導覽（如側邊欄或頂欄）、內容區配置。
- 依 `ui-mockup-gate` 呈現給人工選擇，記錄決策於 `mockup-decision-設計師後台.md`。

## 驗收標準

- `design-system.md` 的 S5 表格「設計師後台」列填入選定版型與核准紀錄。
- Mockup 決策文件存在且連結正確。

## 實作備註

- 這是版面骨架決策，聚焦版型與資訊架構，非最終資料串接。

## 驗證契約

- 單元測試：不適用。
- 整合測試：不適用。
- E2E 測試：不適用。
- 型別檢查：不適用。
- Lint：不適用。
- Build：不適用。
- 螢幕截圖：每個版面變體（含桌面尺寸）。
- 安全性檢查：不適用。

## 完成證據

- 變更的檔案：
  - `ai/artifacts/專案設置/screen-spec-設計師後台核心畫面.md`（畫面規格：版面配置、狀態、
    互動、設計系統對照）
  - `ai/artifacts/專案設置/mockups/admin-variant-a.html`／`-b.html`／`-c.html`（3 個版面
    變體，桌面尺寸 720×460 frame，各含登入/預約列表(或週曆)/服務與營業時間設定 3 個畫面）
  - `ai/artifacts/專案設置/mockup-decision-設計師後台.md`（變體比較、選定紀錄）
  - `ai/context/design-system.md`（S5 章節：設計師後台列填入選定版型、決策連結、人工核准）
- 執行過的指令：
  - 以 Browser 工具開啟三個變體 HTML，確認渲染正常（登入表單、sidebar/topbar 導覽、
    table/週曆網格、服務與營業時間設定皆正確呈現）
  - 以 `AskUserQuestion` 呈現三個變體供人工比較，使用者選定變體 C「側邊欄＋日曆優先」
- 測試輸出：不適用（本任務驗證契約僅要求版面變體視覺呈現）。
- 螢幕截圖：三個變體皆已於 Browser 工具截圖確認（見驗證報告）。
- 已知限制：
  - 這是版面骨架決策，不含最終資料串接，留給對應功能 Epic（預約管理後台等）實作時落地。
  - 變體 C 需要新增兩個目前 S4 inventory 沒有的元件：Sidebar 導覽、週曆格狀檢視，將在對應
    Epic 實作時依既有風格新做並登記回 inventory（本階段僅在 mockup 標記缺口，未提前實作）。
  - 平板直向尺寸下週曆網格的縮排/捲動處理尚未細究，留待實作時依實際裝置測試調整。
- 後續任務：「預約管理後台」等 Epic 的實作任務卡（含 Sidebar／週曆元件的新增與登記）。
