# AI-Ready 任務卡

## Metadata

- 任務：多位設計師 前後端串接驗證、端到端走查與文件同步
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：多位設計師
- 上層 User Story：全部（整合驗證）
- 分軌：前後端串接
- 前置任務（dependsOn）：TASK-067, TASK-068, TASK-069, TASK-070, TASK-071, TASK-072, TASK-073, TASK-074, TASK-075, TASK-076
- 狀態：就緒前審查中（人工已於 2026-10-21 核准；動工前先完成 architect／security-reviewer 架構審查）
- 風險等級：中（不新增功能；確認整個 Epic 合在一起後，沒有規格缺口或回歸）
- Agent owner：Claude Code
- 人工核准者：使用者

## 目標

比照既有各 Epic 的「整合驗證」卡（例如 TASK-050、TASK-055）：逐條對照 feature-spec 的驗收標準走一遍，
跑完所有測試套件，補齊文件，並請人工驗收後合併 `feat/multi-designer` 到 master。

## 情境包（Context Pack）

- 相關檔案：`ai/artifacts/多位設計師/` 全部文件；`ai/context/project-map.md`、`decisions.md`、`design-system.md`；
  `ai/artifacts/預約規則與政策設定/task-cards/TASK-050.md`（整合驗證卡範例）。
- 既有模式：驗證報告以 `ai/templates/verification-report.md` 為範本，存到 `ai/artifacts/多位設計師/verification/TASK-077.md`。
- 假設：`0017`、`0018` 都已套用。
- 未知事項：無。
- 允許變更的檔案：
  - `ai/artifacts/多位設計師/verification/TASK-077.md`（新增）
  - `ai/context/project-map.md`（新資料表、RPC 簽名、目錄、測試指令）
  - `ai/context/decisions.md`（補齊本 Epic 期間未記錄的決策）
  - `ai/context/design-system.md`（確認 4 個新元件都已登記）
  - `README.md`（功能清單加上多位設計師）
  - 驗證過程中發現的小型修正（只限本 Epic 的檔案，修正前先回報）
- 不得觸碰：本 Epic 範圍外的功能。

## 需求

- feature-spec「驗收標準」逐條附證據（測試名稱或截圖）。
- 〔審查〕合併 master 前用 SQL 檢查並附輸出：(1) 沒有殘留的 `__TEST__` 設計師、服務、預約與 Storage 檔案；
  (2) 沒有「上架中但沒有任何啟用中設計師」的服務（`0017` 套用後由舊後台新增的服務要人工開給設計師）；
  (3) 兩支 RPC 的 `proacl` 與 `0018` 套用前記錄的一致。
- 〔審查〕確認 TASK-079（`is_admin()` 強制 aal2）已完成，security-reviewer 建議作為合併前置條件。
- 跑全部單元測試與整合測試套件，附輸出。
- 完整走查：新增設計師 → 開服務 → 上傳作品 → 前台指定與不指定各預約一次 → 收確認信 → 後台多選篩選 → 標記請假 → 前台該日時段消失 → 停用設計師 → 前台不再顯示。
- 行動裝置（375px）與暗色模式截圖。

## 驗收標準

- 所有測試通過，或失敗已記錄並取得人工決定。
- 驗證報告完成；文件同步完成。
- 人工驗收通過後才合併 master（Vercel 隨之部署），合併後在正式網址再走查一次前台預約。

## 實作備註

- 合併 master 前再次確認 `0017`／`0018` 已套用，否則新前端呼叫不存在的欄位會失敗。

## 驗證契約

- 單元測試：`npm test`
- 整合測試：`test:designers`、`test:booking`、`test:admin-booking`、`test:business-hours`、`test:rls`、`test:booking-policy`、`test:services`、`test:notifications`、`test:store-settings`、`test:account`
- E2E 測試：Browser 完整走查（見需求）。
- 型別檢查／Lint／Build：`npx tsc --noEmit`、`npm run lint`、`npm run build`
- 螢幕截圖：前台三個畫面、後台三個畫面、確認信、行動裝置與暗色模式。
- 安全性檢查：security-reviewer 對整個 Epic diff 做一次總覽審查。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：
- 已知限制：
- 後續任務：Demo 體驗帳戶 Epic（seed 要涵蓋本 Epic 的資料表）
