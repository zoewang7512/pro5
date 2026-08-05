# AI-Ready 任務卡

## Metadata

- 任務：UI 設計系統 S4：核心元件庫
- 上層規格：無（Epic 0 UI 設計系統，五階段流程第 4 階）
- 上層 Epic：專案設置
- 上層 User Story：UI 設計系統
- 分軌：前端
- 前置任務（dependsOn）：TASK-006
- 狀態：完成（2026-08-05 核准）
- 風險等級：低
- Agent owner：Claude Code
- 人工核准者：待指定

## 目標

只用 S3 核准的 token，做出基礎元件庫（button、input、select、checkbox/radio、card、nav、modal/dialog、table、form、toast/alert），每個涵蓋必要狀態，並登記進 `design-system.md` 的元件庫 inventory。

## 情境包（Context Pack）

- 相關檔案：`ai/context/design-system.md`、`components/ui/*`（依 S1 元件庫策略調整路徑）。
- 既有模式：套用 `ai/skills/design-craft.md`；若 S1 選定現成元件庫（如 shadcn/ui），以其為基礎客製化，而非從零刻。
- 假設：無。
- 未知事項：無。
- 允許變更的檔案：`components/ui/*`、`ai/context/design-system.md`。
- 不得觸碰：S5 版面組裝、業務邏輯元件。

## 需求

- 實作 button、input、select、checkbox/radio、card、nav、modal/dialog、table、form、toast/alert 等基礎元件。
- 每個元件涵蓋必要狀態：預設、hover、focus、停用、載入（如適用）、錯誤（如適用）。
- 每做一個元件登記進 `design-system.md` 的「S4 元件庫 Inventory」（元件名／狀態／用到的 token／檔案位置／截圖）。

## 驗收標準

- inventory 表格所有列不再是「待補」。
- 每個元件的視覺都只使用 S3 核准的 token，未新增自訂色彩／間距。
- 元件庫可在本機以簡單展示頁預覽所有狀態。

## 實作備註

- 若使用現成元件庫，優先透過其主題設定機制套用 S3 token，而非覆寫每個元件的樣式細節。

## 驗證契約

- 單元測試：關鍵互動元件（如 modal 開關、select 選取）的基本行為測試。
- 整合測試：不適用。
- E2E 測試：不適用。
- 型別檢查：`tsc --noEmit` 成功。
- Lint：`npm run lint` 成功。
- Build：`npm run build` 成功。
- 螢幕截圖：每個元件各狀態的截圖。
- 安全性檢查：不適用。

## 完成證據

- 變更的檔案：
  - `components/ui/Nav.tsx`（AppBar+Toolbar 客製導覽列）
  - `components/ui/ConfirmDialog.tsx`（確認對話框 pattern，內部用 MUI Dialog）
  - `components/ui/FormSection.tsx`（表單版面間距 pattern）
  - `components/ui/ToastProvider.tsx`（全域 toast 佇列，內部用 MUI Snackbar+Alert）
  - `lib/theme/ThemeRegistry.tsx`（掛載 `ToastProvider`，讓 toast 全域可用）
  - `app/design-system/page.tsx`（新增元件展示頁，涵蓋全部 10 種必要元件與各狀態）
  - `tests/components/confirm-dialog.test.tsx`、`tests/components/select.test.tsx`（互動行為單元測試）
  - `tests/test-utils.tsx`（測試用 render helper，關閉 ripple／dialog transition 避免計時器
    在 jsdom teardown 後才觸發的 unhandled error）
  - `tests/setup.ts`（載入 `@testing-library/jest-dom/vitest` matcher）
  - `vitest.config.ts`（新增 `@` path alias、`.tsx` 測試檔 include、`setupFiles`）
  - `package.json`／`package-lock.json`（新增 devDependencies：`@testing-library/react`、
    `@testing-library/jest-dom`、`@testing-library/user-event`、`jsdom`）
  - `ai/context/design-system.md`（S4 章節：inventory 表全部填完，含策略說明——直接用 MUI
    元件的項目不建 wrapper，僅 Nav/Modal/Form/Toast 四項因 MUI 無對應單一元件而客製）
- 執行過的指令：
  - `npx tsc --noEmit` — 通過（過程中修正 `Stack` 的 `flexWrap` 需放進 `sx` 而非直接 prop）
  - `npm run lint` — 通過（過程中修正 `ToastProvider` 原本在 `useEffect` 內 setState 觸發
    `react-hooks/set-state-in-effect`，改為佇列 `queue[0]` 直接衍生 + `key` 觸發重新動畫）
  - `npm test` — 通過（6/6，含新增的 2 個互動測試）
  - `npm run build` — 通過（`/design-system` 產出為靜態頁）
  - 瀏覽器手動驗證（`npm run dev` 訪問 `/design-system`）：console 無錯誤；以互動操作驗證
    Select 開啟選單並選取後正確切換顯示值、ConfirmDialog 開啟顯示標題/說明/按鈕且點取消後
    正確關閉、觸發成功 Toast 後正確顯示「預約已建立」
- 測試輸出：`npm test` 3 個測試檔、6 個測試全數通過（`tests/smoke.test.ts`、
  `tests/components/confirm-dialog.test.tsx` 4 項、`tests/components/select.test.tsx` 1 項）。
- 螢幕截圖：本次 Browser 工具的螢幕截圖功能逾時（pane 未顯示，與 TASK-001/TASK-003 相同的
  已知限制），改用 `read_console_messages`（確認無錯誤）＋`get_page_text`（確認全部元件與
  文字內容渲染）＋互動點擊＋`read_page` 取得的可及性樹作為佐證，見驗證報告。
- 已知限制：
  - Button 的 hover/focus 狀態未逐一截圖，靠瀏覽器原生行為與 MUI 內建樣式保證，未來若要嚴格
    視覺回歸建議加入 Chromatic／Playwright 視覺測試。
  - Toast 佇列一次僅顯示一則，多則排隊時訊息切換沒有先收合再展開的轉場（用 `key` 直接重掛
    達成簡化實作），已足夠目前需求，未來如需要更精緻的排隊動畫可再優化。
  - `app/page.tsx`／`app/admin`／`app/login` 尚未改用這批元件重新設計，S4 僅建立元件庫本身，
    實際套用到各畫面留給 S5（版面）與後續功能 Epic。
- 後續任務：TASK-008、TASK-009（S5 各介面版面 mockup）。
