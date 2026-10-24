# AI-Ready 任務卡

## Metadata

- 任務：稽核紀錄 列表畫面與驗收（`/admin/audit-log`：screen spec＋mockup 決策＋元件、頁面、Sidebar、串接與人工驗收）
- 上層規格：[`feature-spec.md`](../feature-spec.md)（「列表」）、[`architecture-notes.md`](../architecture-notes.md)（§4）
- 上層 Epic：稽核紀錄
- 上層 User Story：查看稽核紀錄列表
- 分軌：前後端串接
- 前置任務（dependsOn）：TASK-085
- 狀態：草稿。**含 Phase 3 關卡：必須先產出畫面規格書與 2～3 個 mockup 變體並由使用者選定，才可標記就緒。**
- 風險等級：中
- Agent owner：Claude Code
- 人工核准者：使用者（2026-10-24 確認簡版規格書）

## 目標

先走完 Phase 3，再做出稽核紀錄列表（類別篩選、載入更多、各狀態），串接 TASK-084 的 `listAuditLog` 與真實資料，更新文件，經人工驗收。

## 情境包（Context Pack）

- 相關檔案：`ai/context/design-system.md`、`ai/skills/ui-mockup-gate.md`、`ai/skills/design-craft.md`、`ai/checklists/design-review-checklist.md`、`ai/templates/screen-spec.md`、`ai/templates/mockup-decision.md`、`app/admin/_components/AdminShell.tsx`（`NAV_ITEMS`）、`app/admin/_components/AppointmentListView.tsx`、`app/admin/_components/ServicesTable.tsx`、`app/admin/layout.tsx`、`lib/admin/audit-log.ts`（TASK-084）、`ai/context/project-map.md`、`ai/context/decisions.md`。
- 既有模式：後台桌面為主；MUI＋design token；Server Component 頁面骨架＋Client 元件讀資料；列表純文字渲染。
- 假設：資料層（`listAuditLog`／`describeAuditEntry`）已就緒；TASK-085 的接線已讓真實資料產生。
- 未知事項（screen spec 階段定案）：「載入更多」失敗時的行為（保留既有列並顯示重試，或整頁錯誤）；差異欄位在窄視窗的呈現。
- 允許變更的檔案：
  - `ai/artifacts/稽核紀錄/screen-spec-稽核紀錄列表.md`、`mockup-decision-稽核紀錄列表.md`、`mockups/`（新增）
  - `app/admin/audit-log/page.tsx`、`app/admin/_components/AuditLogView.tsx`（及必要子元件）
  - `app/admin/_components/AdminShell.tsx`（Sidebar 新增「稽核紀錄」，**放在最後一項**）
  - `ai/context/design-system.md`（若新做元件，登記回 inventory）
  - `tests/components/audit-log-view.test.tsx`、`tests/components/admin-shell.test.tsx`（只新增斷言）
  - `ai/context/project-map.md`（`audit_log` 段落、`test:audit-log` 指令列、整合測試雜訊說明、`lib/admin/audit-log.ts` 目錄列）、`ai/context/decisions.md`（定稿）
  - `ai/artifacts/稽核紀錄/verification/TASK-086.md`
- 不得觸碰：`lib/admin/audit-log.ts` 的對外介面（有問題回 TASK-084 修）、migration、其他頁面。

## 需求

- 欄位：發生時間（Asia/Taipei）、事件（中文）、對象摘要、前後差異（白話）；底部「載入更多」。
- 類別篩選：全部／預約／設定；篩選變更重置游標；在資料庫端執行。
- 狀態：載入中、載入更多中、載入更多失敗、空（尚無紀錄／此類別無紀錄）、錯誤＋重試（不顯示部分資料）。
- 較慢的舊請求不得覆蓋較新的結果（競態）。
- 非店長看不到任何資料（既有 layout 導向與 RLS 空結果）。
- 一律純文字渲染，不使用 `dangerouslySetInnerHTML`。

## 驗收標準

- Phase 3：畫面規格書、2～3 個變體（皆以既有 token／元件組成）、取捨比較、使用者選定，皆有紀錄。
- 元件測試涵蓋全部狀態、競態、篩選重置游標；Sidebar 新項目在最後且不破壞既有相鄰斷言。
- 淺色與深色桌面版截圖各一，對照設計審查清單。
- 瀏覽器走查：在後台做一輪「取消、改期、改最短提前時間、停用設計師」，列表逐筆正確、差異白話正確；類別篩選與載入更多運作。
- `project-map.md`、`decisions.md` 已更新，保證邊界與殘留風險如實記載（見規格書「風險」）。
- 人工驗收通過後卡片才轉 Done（agent 自我驗證不等於人工核准）。

## 實作備註

- 缺的元件依 `ui-mockup-gate` 的「查庫→照風格補做→登記回庫」處理。
- 部署：`0019` 已套用 → 部署前端 → 人工驗收。
- 後續建議（不在本 Epic）：日期區間與預約編號篩選、設定異動通知、升級成防竄改的完整版（見 `完整版備案/`）、為 `services.name` 補長度限制。

## 驗證契約

- 單元測試：`npm test`（元件測試）。
- 整合測試：`npm run test:audit-log` 重跑。
- E2E 測試：不適用（專案無 E2E 套件），以瀏覽器走查取代。
- 型別檢查：`npx tsc --noEmit`；Lint：`npm run lint`；Build：`npm run build`。
- 螢幕截圖：列表（有資料／空／錯誤／篩選中）淺色與深色。
- 安全性檢查：確認純文字渲染；security-reviewer 對整個 Epic 做簡短總覽審查。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：
- 已知限制：
- 後續任務：
