# 驗證報告

## 摘要

- 任務：TASK-105 體驗帳號橫幅、說明視窗與 Demo 本地登出（前端）
- 結果：**通過**（新增 `demo-notice` 12 項＋`logout-button` 新增 2 項；全套 94 檔 1798 項全過（`--maxWorkers=2`）；`tsc`、`lint`、`build` 通過；瀏覽器走查橫幅與視窗）
- 驗證者：實作 agent（Claude Code）。風險低（純前端、無資料庫、無端點），依任務卡只需 UI 與測試審查；未另跑子代理。人工驗收：使用者 2026-10-31 通過。
- 一般管理員：`DemoNotice` 回傳 `null`、登出維持預設 global；本卡不改任何資料庫或端點。

## 變更的檔案

| 檔案 | 內容 |
|---|---|
| `app/admin/_components/DemoNotice.tsx` | 把 TASK-097 的空殼填成：`isDemo` 才渲染；info 橫幅（粗體標題＋其餘文字＋行內「了解更多」＋✕，✕ 觸控區 40×40，`role="status"`、底色 `info.light`）；說明視窗（MUI `Dialog`，`aria-labelledby`，「可以體驗」✓ 清單與「不開放」🔒 清單，「開始體驗」，無副標）；兩個 `sessionStorage` 旗標全包 `try/catch`；缺還原時間降級為簡短版 |
| `app/admin/logout-button.tsx` | 讀 `useAdminProfile().isDemo`：Demo 用 `signOut({ scope: "local" })`，其餘維持 `signOut()` |
| `tests/components/demo-notice.test.tsx`（新增） | 12 項 |
| `tests/components/logout-button.test.tsx` | 加 `AdminProfileContext` 的 mock（預設 `isDemo=false`）與 2 項登出案例；**既有斷言未改** |
| `tools/kanban/cards/TASK-105.json`、任務卡、本報表 | 流程文件 |

`lib/demo/notice-copy.ts` 未動（既有文案已與任務卡完全一致）。`AdminShell.tsx`、`Sidebar.tsx`、`layout.tsx` 未動。

## 偏離任務卡之處（請確認）

1. **登出案例放在 `logout-button.test.tsx`，而非任務卡寫的 `admin-shell.test.tsx`**：`LogoutButton` 現在呼叫 `useAdminProfile()`（缺 Provider 會拋錯），既有 `logout-button.test.tsx` 沒有包 Provider，必須加 mock 才不會壞；`admin-shell.test.tsx` 本來就 mock 了 `useAdminProfile`，不需修改，且該檔 18 項照常通過。`logout-button.test.tsx` 不在任務卡的允許清單，但只新增 mock 與 2 個案例，沒動既有斷言。
2. **橫幅「了解更多」放在文字後面（行內），不是桌面 mockup 的獨立右側欄**：與手機 mockup 一致，桌面也採同一種排法，避免同一個動作渲染兩個元素。

## 指令

| 指令 | 結果 | 備註 |
|---|---|---|
| `npx vitest run tests/components/demo-notice.test.tsx tests/components/logout-button.test.tsx tests/components/admin-shell.test.tsx` | **36 項通過** | |
| `npx tsc --noEmit` | 通過 | 0 錯誤 |
| `npm run lint` | 通過 | 0 error。第一版在 effect 內同步 `setState` 被 `react-hooks/set-state-in-effect` 擋下，改為 effect → `queueMicrotask`（附 cancelled，Strict Mode 重跑安全） |
| `npm run build` | 通過 | |
| `npx vitest run --maxWorkers=2`（全套） | **94 檔 1798 項全過** | 輸出中的 `SEND_FAILED` 是既有測試刻意觸發的錯誤記錄 |

## 涵蓋範圍

`demo-notice.test.tsx`（12 項）：
- 非 Demo：容器為空、沒有橫幅與視窗、**不碰** `demo-welcome-pending`。
- Demo 無旗標：橫幅三件事文字完整、標題為粗體、有「了解更多」與「關閉提示」、不彈視窗；橫幅不是 `role="alert"`。
- 有 `demo-welcome-pending`：彈出視窗、旗標被清除、重新掛載不再彈。
- 視窗內容：兩份清單、各項文字、「開始體驗」、兩個 `list`、沒有已移除的副標。
- 「開始體驗」與 Esc 皆可關閉；「了解更多」開啟同一份視窗且焦點進入視窗，Esc 關閉後焦點回到「了解更多」。
- ✕：橫幅消失、`demo-banner-dismissed="1"`；同分頁重新掛載不再顯示；清空旗標（新分頁）會再顯示。
- 橫幅已關閉時仍能因 `demo-welcome-pending` 彈出視窗。
- 缺還原時間（`DEMO_RESET_LABEL` 為空）：只剩「您正在使用體驗帳號。」，不顯示還原與不開放字句。
- `sessionStorage` 讀取拋例外：橫幅照常顯示並彈出視窗；寫入拋例外：✕ 仍能在目前畫面隱藏。

`logout-button.test.tsx`（新增 2 項）：一般管理員 `signOut` 不帶參數；Demo 為 `{ scope: "local" }`，並照常 `replace("/login")`＋`refresh()`。

## 瀏覽器走查

正式後台需要真實 Demo session（本機沒有 Demo 帳戶），所以以暫時的 dev 頁面（`AdminProfileProvider isDemo` ＋ `DemoNotice`，驗完已刪除）檢視：

| 項目 | 結果 |
|---|---|
| 桌面暗色（窄窗）：視窗與橫幅 | 內容與 mockup F5 一致；視窗彈出後 `sessionStorage` 旗標為 null、焦點在「開始體驗」 |
| 按「開始體驗」 | 視窗關閉 |
| ✕ 觸控區 | 40×40 |
| 手機 375 亮色：橫幅 | 文字換行不截斷、`scrollWidth` 等於視窗寬（無橫向捲動）；底色 `info.light` |
| 手機 375 亮色：視窗 | 按鈕滿寬，內容完整（對應 mockup F6） |
| 「了解更多」→ 視窗 → Esc | 開啟與關閉正常 |

截圖是在對話中的 Browser pane 檢視，未另存檔案。

## 已知限制與殘留風險

1. **尚未在真實 Demo session 下走過**：isDemo 來源（`app_metadata.is_demo`）已由 TASK-097 驗證，本卡以 mock 與暫時頁面驗證。端對端（一鍵進入→後台出現視窗）在 TASK-112。
2. **Demo 登出只清本機 session**：有人從 console 直接呼叫 global `signOut` 仍會踢掉其他面試官（架構筆記第 8 節，已列殘留風險）。
3. 橫幅在 SSR 就渲染；先前已關閉橫幅的人在整頁重新載入時，橫幅會在水合後才消失（一瞬間閃現）。換來的是多數訪客不會因橫幅晚出現而版面下推。
4. 視窗以旗標開啟時沒有「觸發元素」，關閉後焦點回到 `body`（瀏覽器預設），屬預期。
5. 暗色手機版、桌面亮色寬螢幕未另截圖；`sessionStorage` 不可用時，每次整頁載入都會彈出視窗（依任務卡規定）。

## 審查關卡

- UI、測試：實作 agent 自評，**待人工確認**；未自行勾選看板的 gates。
