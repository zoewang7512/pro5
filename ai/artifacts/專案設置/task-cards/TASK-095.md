# AI-Ready 任務卡

## Metadata

- 任務：升級 `next`（及 `eslint-config-next`）修補 `npm audit` 的 critical，並處理其餘 high 項目（`nanoid`、`sharp`、`source-map-js`）
- 來源：「儀表板與報表」Epic 完成後 security-reviewer 總覽審查（2026-10-25）的建議後續任務；`npm audit --omit=dev` 目前 4 項，均為既有、與該 Epic 新增套件無關。
- 上層規格：無（維運／相依套件維護）
- 上層 Epic：專案設置
- 上層 User Story：（無，維護性任務）
- 分軌：基礎設施（相依套件）
- 前置任務（dependsOn）：無（與 TASK-094 無檔案重疊，可獨立進行；建議在 TASK-094 之後做，避免回歸測試時混入其他變動）
- 狀態：草稿
- 風險等級：高（升級框架次版本，影響所有頁面、建置與部署）
- Agent owner：Claude Code
- 人工核准者：待使用者核准計畫

## 目標

把 `next` 升級到已修補的版本，使 `npm audit --omit=dev` 不再有 critical，並確認升級沒有造成任何頁面、建置或測試的回歸。

## 情境包（Context Pack）

- 目前版本與公告（`npm audit --omit=dev`，2026-10-25）：
  - `next@16.3.0`（critical）：公告範圍涵蓋 16.0.0–16.4.0，修正版 **16.4.3**（`npm view next` 的 latest 也是 16.4.3）。公告類型包含 Windows 主機上的未驗證 RCE、Image Optimization（AVIF／SVG）RCE、`next/og` RCE、`use cache` 相關洩漏與 RCE、SSG／ISR 快取污染、SSRF、Server Actions DoS 等。
  - `sharp@0.35.3`（high，透過 next）、`nanoid@3.3.17`（high，透過 next 的 postcss）、`source-map-js@1.2.1`（high，透過 postcss／jsdom）。
- 本專案實際暴露面（security-reviewer 判斷）：專案**未使用** `next/image`、`next/og`、`use cache`、Server Actions，所以多數公告目前觸發不到；仍應升級，因為日後新增功能就可能碰到。
- 相關檔案：`package.json`（`next` 與 `eslint-config-next` 皆為精確版本 `16.3.0`）、`package-lock.json`、`next.config.ts`、`proxy.ts`（middleware）、`app/` 全部路由。
- 相容性事實（已查）：`eslint-config-next@16.4.3` 存在；`@mui/material-nextjs@9.1.1` 的 peerDependencies 接受 `next ^16.0.0`；`react@19.2.8` 不變。
- 既有模式：dependency 一律精確版本鎖定（`package.json` 無 `^`）。
- 未知事項：16.3.0 → 16.4.3 之間的行為變更（以官方 release notes 為準）；`npm audit` 的 `nanoid`／`sharp`／`source-map-js` 是否會隨 next 升級一併解決，或需要 `overrides`。
- 允許變更的檔案：
  - `package.json`、`package-lock.json`（`next`、`eslint-config-next`，必要時加 `overrides` 處理殘留的傳遞相依，需在 decisions 說明）
  - `next.config.ts`、`proxy.ts`（**僅在升級後有 breaking change 或警告時**，需先回報再改）
  - `ai/context/decisions.md`、`project-map.md`（記錄版本與升級結果）
  - `ai/artifacts/專案設置/verification/TASK-095.md`（新增）
- 不得觸碰：任何功能程式碼與測試（除非升級造成必須的最小修正，且須先停下來回報）；不得使用 `npm audit fix --force`（會任意跨主版本升級）。

## 需求

- 先讀 `next` 16.3.0 → 16.4.3 的 release notes／升級指引，列出與本專案相關的變更，再動手。
- 以精確版本升級 `next` 與 `eslint-config-next`（兩者同版本）：`npm install --save-exact next@16.4.3 eslint-config-next@16.4.3`（版本以屆時 `npm view` 的最新修補版為準）。
- 重跑 `npm audit --omit=dev`，逐項說明結果：解決了哪些、哪些殘留與原因；殘留的 high 若可由安全的次要版本更新或 `overrides` 解決，需在 decisions 記錄並確認不影響建置；不可解的列為已知限制。
- 完整回歸：型別、lint、build、全套單元測試、`npm run test:reports` 與其他唯讀整合測試（沿用專案現行慣例，注意整合測試會打正式庫與留下稽核雜訊，見 `project-map.md`）。
- 手動走查：本機以 `npm run dev` 與 `npm run build && npm start` 各走查主要頁面（顧客前台預約流程、`/login` 含 MFA、`/admin` 各頁、`/admin/reports` 含匯出、`/design-system`）；確認 middleware（`proxy.ts`）的存取控制仍有效：未登入存取 `/admin/*` 會導向登入。
- **部署不在本卡自動進行**：本卡完成後，是否部署由使用者決定；部署時依專案慣例（見 memory：審查修正後要重新部署，本機驗證不等於正式環境是最新版）。

## 驗收標準

- `package.json` 為精確版本且 `next` 與 `eslint-config-next` 版本一致；`npm ls next` 只有一份。
- `npm audit --omit=dev` 無 critical；high 項目有逐項處理說明。
- `npx tsc --noEmit`、`npm run lint`、`npm run build` 通過，且 build 無新增警告（若有，逐項說明）。
- `npm test` 全套結果與升級前相同（既有並行逾時的檔案須單獨重跑確認，記錄比對）；`npm run test:reports` 通過。
- 手動走查清單全部通過，含未登入導向、MFA 登入、預約流程成功頁、`/admin/reports` 匯出。
- security-reviewer 快速複審通過（確認升級範圍、`overrides`（若有）、沒有引入新的 install script 或可疑相依）。

## 實作備註

- 先在乾淨工作目錄（所有變更已 commit）開始，使升級的 diff 只含相依套件變動，易於回滾。
- 回滾：`git revert` 該 commit 並 `npm ci`；因為 lockfile 一併回滾，不需要手動降版。
- 不順便升級其他套件（`@mui/*`、`react`、`@supabase/*` 等），避免回歸來源混雜。

## 驗證契約

- 單元測試：`npm test`（並行逾時的既有失敗檔須單獨重跑）。
- 整合測試：`npm run test:reports` 等既有唯讀套件（回歸，不新增）。
- E2E 測試：不適用（以手動走查替代）。
- 型別檢查：`npx tsc --noEmit`；Lint：`npm run lint`；Build：`npm run build`。
- 螢幕截圖：主要頁面升級後正常（淺色即可，異常才補深色）。
- 安全性檢查：`npm audit --omit=dev` 前後對照；security-reviewer 快速複審。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：
- 已知限制：
- 後續任務：
