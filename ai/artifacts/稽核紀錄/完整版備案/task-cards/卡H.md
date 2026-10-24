# AI-Ready 任務卡

## Metadata

- 任務：稽核紀錄 列表畫面（`/admin/audit-log`：screen spec＋mockup 決策＋元件與 Sidebar 項目）
- 上層規格：[`feature-spec.md`](../feature-spec.md)、[`architecture-notes.md`](../architecture-notes.md)（§9）
- 上層 Epic：稽核紀錄
- 上層 User Story：查看稽核紀錄列表
- 分軌：前端
- 前置任務（dependsOn）：TASK-090
- 狀態：草稿。**本卡有 Phase 3 關卡：必須先產出畫面規格書與 2～3 個 mockup 變體，並由使用者選定後，才可標記就緒**。
- 風險等級：中
- Agent owner：Claude Code
- 人工核准者：使用者（UI 變體選定後記錄）

## 目標

做出稽核紀錄列表畫面與各狀態（預設、載入中、載入更多、空狀態兩種、錯誤、篩選中），先走完 Phase 3，再以既有設計系統元件實作；列表元件接收資料與回呼，不直接碰 Supabase。

## 情境包（Context Pack）

- 相關檔案：`ai/context/design-system.md`（token 與元件庫 inventory）、`ai/skills/ui-mockup-gate.md`、`ai/skills/design-craft.md`、`ai/checklists/design-review-checklist.md`、`ai/templates/screen-spec.md`、`ai/templates/mockup-decision.md`、`app/admin/_components/AdminShell.tsx`（`NAV_ITEMS`）、`app/admin/_components/AppointmentListView.tsx`（表格列表既有樣式）、`app/admin/_components/ServicesTable.tsx`。
- 既有模式：後台桌面為主；MUI＋design token；ConfirmDialog／Alert 等既有元件；列表一律以純文字渲染。
- 假設：資料由 TASK-090 的 `listAuditLog` 提供；元件以 props 接收，不直接 fetch。
- 未知事項（screen spec 階段定案）：「載入更多」失敗時的行為（保留既有列並顯示重試，或整頁錯誤）；差異欄位在窄視窗的呈現；預約編號複製的回饋方式。
- 允許變更的檔案：
  - `ai/artifacts/稽核紀錄/screen-spec-稽核紀錄列表.md`、`mockup-decision-稽核紀錄列表.md`、`mockups/`（新增）
  - `app/admin/_components/AuditLogView.tsx`（及必要的子元件）、`app/admin/audit-log/page.tsx`（頁面骨架）
  - `app/admin/_components/AdminShell.tsx`（Sidebar 新增「稽核紀錄」，**放在最後一項**）
  - `ai/context/design-system.md`（若新做元件，登記回 inventory）
  - `tests/components/audit-log-view.test.tsx`、`tests/components/admin-shell.test.tsx`（只新增斷言）
- 不得觸碰：`lib/audit-log/*`（TASK-090）、migration、其他頁面。

## 需求

- 欄位：發生時間（Asia/Taipei）、操作者（店長／顧客／系統／未知）、事件（中文）、對象摘要、前後差異（白話）；預約編號顯示為可複製文字；顯示「已載入 N 筆」；底部「載入更多」。
- 篩選控制項：事件類別（全部／預約／設定）、日期區間、預約編號（非 uuid 顯示提示且不發查詢）。
- 狀態：載入中、錯誤＋重試（**不顯示部分資料**）、空狀態兩種（尚無任何紀錄／沒有符合篩選條件）、載入更多中、載入更多失敗、篩選變更重置游標。
- 較慢的舊請求不得覆蓋較新的結果（競態）。
- 列表一律以純文字渲染並顯示 `entity_id`。

## 驗收標準

- Phase 3：畫面規格書、2～3 個變體（皆以既有 token／元件組成）、取捨比較、使用者選定，皆有紀錄。
- 元件測試涵蓋上列全部狀態與競態、複製成功／失敗回退、非法預約編號；Sidebar 新項目在最後且不破壞既有相鄰斷言。
- 淺色與深色模式桌面版截圖各一，對照設計審查清單；視覺走查通過。

## 實作備註

- 缺的元件依 `ui-mockup-gate` 的「查庫→照風格補做→登記回庫」處理。
- 本卡不串接資料（TASK-092）；以 props／假資料驅動元件測試。

## 驗證契約

- 單元測試：`npm test`（元件測試）。
- 整合測試：不適用。
- E2E 測試：不適用。
- 型別檢查：`npx tsc --noEmit`；Lint：`npm run lint`；Build：`npm run build`。
- 螢幕截圖：淺色／深色桌面版各一，附於驗證報告。
- 安全性檢查：確認不使用 `dangerouslySetInnerHTML`，所有欄位純文字渲染。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：
- 已知限制：
- 後續任務：TASK-092
