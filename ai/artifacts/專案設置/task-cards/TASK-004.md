# AI-Ready 任務卡

## Metadata

- 任務：UI 設計系統 S1：底層框架與元件庫策略
- 上層規格：無（Epic 0 UI 設計系統，五階段流程第 1 階）
- 上層 Epic：專案設置
- 上層 User Story：UI 設計系統
- 分軌：不適用
- 前置任務（dependsOn）：無
- 狀態：就緒
- 風險等級：低
- Agent owner：待指定
- 人工核准者：待指定

## 目標

依已確認的技術棧（Next.js），決定元件庫策略（採用現成如 shadcn/ui、MUI、Ant Design，或自建）與樣式方案（如 Tailwind CSS、CSS-in-JS、CSS Modules），供人工核准後寫入 `ai/context/design-system.md` 的「S1 底層框架」。

## 情境包（Context Pack）

- 相關檔案：`ai/context/design-system.md`（待填寫的目標檔案）。
- 既有模式：無（Epic 0 首個 UI 決策）。
- 假設：專案為顧客前台（行動裝置為主）＋設計師後台（桌面為主）兩種使用情境，元件庫需同時適合兩者。
- 未知事項：無。
- 允許變更的檔案：`ai/context/design-system.md`；若涉及專案內安裝套件，`package.json`。
- 不得觸碰：尚未定案的 S2-S5 內容（先留待補）。

## 需求

- 列出 2-3 個合理的元件庫／樣式方案選項，附優劣比較與建議。
- 呈現給人工核准，選定後寫入 `design-system.md` 的「S1 底層框架」章節（框架、元件庫策略、樣式方案、選定理由、人工核准者與日期）。

## 驗收標準

- `design-system.md` 的 S1 章節不再是「待補」，已填入實際選定內容與核准紀錄。
- 決策有附上比較的選項與理由。

## 實作備註

- 這是純決策型任務，不產生大量程式碼；若選定方案需要安裝套件，僅做最小可行安裝驗證（不做視覺實作，視覺留給 S2 之後）。

## 驗證契約

- 單元測試：不適用。
- 整合測試：不適用。
- E2E 測試：不適用。
- 型別檢查：不適用。
- Lint：不適用。
- Build：若安裝套件則需 `npm run build` 仍成功。
- 螢幕截圖：不適用。
- 安全性檢查：不適用。

## 完成證據

- 變更的檔案：
  - `ai/context/design-system.md`（填入 S1 章節：框架、元件庫策略、樣式方案、三個選項的
    優缺點比較、選定理由、人工核准紀錄）
  - `package.json`／`package-lock.json`（新增 `@mui/material@9.2.0`、
    `@emotion/react@11.14.0`、`@emotion/styled@11.14.1`、`@mui/material-nextjs@9.1.1`，
    版本鎖定）
  - `app/layout.tsx`（加入 `AppRouterCacheProvider` 包住 `children`——App Router 下 MUI
    SSR 樣式插入的必要基礎設施，非視覺實作）
- 執行過的指令：
  - 用 `AskUserQuestion` 呈現 shadcn/ui+Tailwind／MUI／Ant Design 三個選項供人工核准，
    使用者選定 MUI。
  - `npm install @mui/material @emotion/react @emotion/styled @mui/material-nextjs`
  - `npx tsc --noEmit` — 通過
  - `npm run lint` — 通過
  - `npm run build` — 通過
  - 瀏覽器手動載入首頁，確認 console 無 hydration 警告或錯誤
- 測試輸出：不適用（無自動化測試，本任務驗證契約僅要求 build 成功）。
- 螢幕截圖：不適用（本任務不含視覺實作）。
- 已知限制：尚未加入 `ThemeProvider`／自訂主題／任何實際 MUI 元件用法，留待 S2（風格方向）
  與 S3（design token）階段決定主題內容後再串接；元件庫 inventory（S4）仍是全空範本。
- 後續任務：TASK-005（S2 視覺風格方向）。
