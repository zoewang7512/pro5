# AI-Ready 任務卡

## Metadata

- 任務：稽核紀錄 串接與驗收（列表串接資料層、篩選與分頁、部署 runbook、文件更新、人工驗收）
- 上層規格：[`feature-spec.md`](../feature-spec.md)、[`architecture-notes.md`](../architecture-notes.md)（§5、§8、§9、§10）
- 上層 Epic：稽核紀錄
- 上層 User Story：篩選稽核紀錄
- 分軌：前後端串接
- 前置任務（dependsOn）：TASK-087、TASK-088、TASK-089、TASK-091
- 狀態：草稿（前置任務完成後才可就緒）
- 風險等級：中
- Agent owner：Claude Code
- 人工核准者：使用者（2026-10-23）

## 目標

把 TASK-091 的畫面接上 TASK-090 的資料層與真實資料，完成篩選、分頁、錯誤／空狀態的端到端行為；完成部署 runbook 與文件更新；經人工以規格書的使用者旅程驗收。

## 情境包（Context Pack）

- 相關檔案：`app/admin/audit-log/page.tsx`、`app/admin/_components/AuditLogView.tsx`、`lib/audit-log/*`、`app/admin/layout.tsx`（既有三層檢查）、`tests/audit-log.integration.test.ts`、`ai/context/project-map.md`、`ai/context/decisions.md`。
- 既有模式：Server Component 頁面骨架＋Client 元件讀資料；後台頁面以 `lib/supabase` 的 client 直接查詢，RLS 把關。
- 假設：TASK-087／088／089 的 migration 已套用；稽核表已有真實資料。
- 未知事項：無。
- 允許變更的檔案：
  - `app/admin/audit-log/page.tsx`、`app/admin/_components/AuditLogView.tsx`（串接）
  - `tests/audit-log.integration.test.ts`（分頁與篩選的資料層案例：以測試實體產生數筆稽核列，`limit=2` 走完三頁；篩選三種單獨與組合）
  - `tests/audit-log/migration-drift.test.ts`（啟用反向檢查：目錄中每個事件代碼都有 trigger 對應）
  - `ai/context/project-map.md`（`audit_log` 架構段落、`test:audit-log` 指令列、日期 offset 登記、整合測試污染與標記機制說明、`lib/audit-log/` 目錄列）、`ai/context/decisions.md`（定稿所有決策）
  - `ai/artifacts/稽核紀錄/runbook.md`（新增：Vault 密鑰建立、`AUDIT_TEST_SECRET` 不得進 Vercel、`AUD01` 在 Supabase Logs 設查詢／告警、套用與回滾順序、緊急止血 `0021_down`、遺失標記的殘留掃除、對稽核表做個資遮蔽需暫時 disable trigger）
  - `ai/artifacts/稽核紀錄/verification/`（驗證報告）
- 不得觸碰：migration、`lib/audit-log/*` 的對外介面（有問題回 TASK-090 修）。

## 需求

- 頁面載入第一頁（每頁 50）、可載入更多、篩選三種可單獨或組合、清除篩選回全部；篩選在資料庫端執行。
- 非店長（未登入、非管理員、MFA aal1）看不到任何資料：既有 layout 導向與 RLS 回空陣列。
- 確認 `audit_log` 不在 `supabase_realtime` publication；`audit_log` 對 `anon` 在 PostgREST 為 42501。
- 人工走查規格書兩段使用者旅程，逐筆比對；顧客端實際建立一筆預約確認顯示為「顧客」。

## 驗收標準

- 資料層整合案例通過；分頁不重複、不漏筆；篩選結果正確；錯誤與空狀態可重現。
- 瀏覽器走查（淺色／深色）：一輪「取消、改期、改最短提前時間、停用設計師」後，列表逐筆正確、差異白話正確。
- 全套回歸：`npm test`、`test:audit-log` 與所有寫入被稽核表的整合套件通過，稽核殘留為 0；`tsc`、lint、build 通過。
- `project-map.md`、`decisions.md`、`runbook.md` 已更新；殘留風險（owner／Studio impersonate／`system` 混合來源／服務名稱無長度限制建議／稽核不通知）如實記載。
- 人工驗收通過後卡片才轉 Done（agent 自我驗證不等於人工核准）。

## 實作備註

- 部署順序：migration 已逐卡套用完成 → 部署前端 → 人工驗收。
- 後續建議（不在本 Epic，另開卡）：為 `services.name` 補長度 constraint、設定異動通知、獨立測試用 Supabase 專案。

## 驗證契約

- 單元測試：`npm test`。
- 整合測試：`npm run test:audit-log` 及所有相關舊套件重跑。
- E2E 測試：不適用（專案無 E2E 套件）；以瀏覽器走查取代，附螢幕截圖。
- 型別檢查：`npx tsc --noEmit`；Lint：`npm run lint`；Build：`npm run build`。
- 螢幕截圖：列表（有資料／空／錯誤／篩選中）淺色與深色。
- 安全性檢查：security-reviewer 對整個 Epic 做總覽審查；test-engineer 複審整體測試證據。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：
- 已知限制：
- 後續任務：
