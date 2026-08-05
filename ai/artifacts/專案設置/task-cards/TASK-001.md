# AI-Ready 任務卡

## Metadata

- 任務：技術骨架初始化
- 上層規格：無（Epic 0 基礎工程，技術棧已由使用者確認：Next.js + Supabase + GitHub，部署於 Vercel）
- 上層 Epic：專案設置
- 上層 User Story：技術骨架初始化
- 分軌：不適用
- 前置任務（dependsOn）：無
- 狀態：就緒
- 風險等級：中
- Agent owner：待指定
- 人工核准者：待指定

## 目標

建立可執行、可建置、可部署到 Vercel 的 Next.js（App Router + TypeScript）專案骨架，作為後續所有功能開發的基礎。

## 情境包（Context Pack）

- 相關檔案：
  - repo 根目錄現有的 `package.json`、`scripts/`、`tools/`、`.github/`（開工前先確認現況，避免覆蓋既有設定）
  - 待新增：`app/`、`components/`、`lib/`、`next.config.*`、`tsconfig.json`
- 既有模式：
  - repo 已有 `AGENTS.md`／`CLAUDE.md` 定義的治理流程與 `ai/`、`tools/kanban/` 結構，需保留。
- 假設：
  - 使用 Next.js App Router + TypeScript。
  - 套件管理器：npm（沿用現有 `package.json`）。
- 未知事項：
  - 尚未決定測試框架（建議 Vitest + Playwright，可在此任務內定案）。
- 允許變更的檔案：
  - 專案根目錄設定檔（`package.json`、`tsconfig.json`、`next.config.*`、`.eslintrc*`）、新建的 `app/`／`components`／`lib` 骨架、`vercel.json`（如需要）、README 啟動說明。
- 不得觸碰：
  - `ai/`、`tools/kanban/` 既有治理內容、`.claude/`、`.codex/`。

## 需求

- 初始化 Next.js App Router + TypeScript 專案。
- 建立基本目錄結構（`app/`、`components/`、`lib/`）。
- 設定 ESLint 與格式化規則。
- 設定測試框架（單元測試 + E2E，建議 Vitest + Playwright）並可執行（即使目前無測試案例）。
- 設定 Vercel 部署所需的 build 設定與說明。
- 更新 README，補上本機啟動、build、test 指令說明。

## 驗收標準

- `npm run build` 成功。
- `npm run lint` 成功。
- `npm test`（或對應測試指令）可執行且不報錯。
- 本機 `npm run dev` 可開啟首頁（可為預設頁面）。
- README 有清楚的啟動／建置／測試／部署指令說明。

## 實作備註

- 探索是否有現成的 Next.js + Vercel 官方範本可用，避免手刻設定檔。
- 保留現有 repo 根目錄下的治理檔案與資料夾不動。

## 驗證契約

- 單元測試：測試框架可執行（無案例亦可）。
- 整合測試：不適用。
- E2E 測試：測試框架可執行（無案例亦可）。
- 型別檢查：`tsc --noEmit` 成功。
- Lint：`npm run lint` 成功。
- Build：`npm run build` 成功。
- 螢幕截圖：本機 `npm run dev` 首頁截圖。
- 安全性檢查：不適用（無業務邏輯）。

## 完成證據

- 變更的檔案：待實作後填寫。
- 執行過的指令：待實作後填寫。
- 測試輸出：待實作後填寫。
- 螢幕截圖：待實作後填寫。
- 已知限制：待實作後填寫。
- 後續任務：TASK-002、TASK-003、TASK-004。
