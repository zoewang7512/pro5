# 驗證報告

## 摘要

- 任務：TASK-118 帳號設定頁 Demo 鎖定操作的統一提示文案（前端）
- 結果：**通過**（`account-settings-view` 55 項全過＝TASK-101 之前既有的斷言未改＋新增／擴充 Demo 案例；`tsc`、`lint`、`build` 通過）
- 驗證者：實作 agent（Claude Code）。風險低（純前端單一元件＋一個文案常數），依任務卡只需測試審查；未另跑子代理。人工驗收待使用者。

## 變更的檔案

| 檔案 | 內容 |
|---|---|
| `lib/demo/notice-copy.ts` | 追加 `DEMO_ACTION_BLOCKED_MESSAGE = "體驗帳號不開放這項操作。"`；既有常數未動 |
| `app/admin/_components/AccountSettingsView.tsx` | `handleUpdatePassword`、`handleUpdateEmail`、`handleStartMfaEnrollment` 三處 TASK-101 的靜默 `if (isDemo) return` 改為 `showToast(DEMO_ACTION_BLOCKED_MESSAGE, "error")` 後 `return`；頂部說明註解補一段；新增一行 import。其餘不動 |
| `tests/components/account-settings-view.test.tsx` | 擴充 TASK-101 的「鎖定的表單即使被直接送出…」案例（加斷言提示出現）；新增 4 項 Demo 案例與 1 項一般管理員案例；一般管理員既有案例加一行「無提示」斷言。TASK-101 之前的既有斷言未改 |
| `ai/artifacts/Demo 體驗帳戶/screen-spec-帳號設定頁鎖定狀態.md` | 「錯誤」列與「嘗試操作被鎖項目」列改成與實作一致（由 `isDemo` 提示、前端不辨識資料庫錯誤、僅 UX） |
| `tools/kanban/cards/TASK-118.json`、本報表 | 流程文件 |

## 指令

| 指令 | 結果 | 備註 |
|---|---|---|
| `npx vitest run tests/components/account-settings-view.test.tsx` | **55 項通過** | 單獨執行；共跑多次皆全過 |
| 變異檢查：暫時把三處 `showToast(...)` 換成 no-op | **5 項失敗**（擴充的 TASK-101 案例、密碼、Email、MFA、文案純度） | 證明新增測試有鑑別力；之後已還原（`git diff` 確認三處提示仍在） |
| `npx tsc --noEmit` | 通過 | 0 錯誤 |
| `npm run lint` | 通過 | 0 error |
| `npm run build` | 通過 | |
| `npx vitest run tests/components tests/lib`（與 build 同時執行） | 1209／1244，35 項失敗 | 全是 5 秒逾時（耗時 3.4～12 秒），分布在 `login-form`、`reset-password-form`、`designer-*`、`account-settings-view` 等；同時有 build 在跑 |
| 上述 5 個失敗檔案一起重跑 | 150／153，3 項逾時 | 仍是並行負載 |
| `account-settings-view`、`login-form` 各自單獨重跑 | **55／55、30／30 全過** | 確認為負載造成，與 TASK-087／088／097／101 報告記錄的並行不穩定為同一議題；`login-form` 等檔案本卡未碰 |

## 涵蓋範圍

- 密碼表單被直接送出（Demo）：出現「體驗帳號不開放這項操作。」、`updateAdminPassword` 未被呼叫、沒有「請輸入目前密碼。」「新密碼為必填。」等表單驗證錯誤。
- Email 表單被直接送出（Demo）：同上，`updateAdminEmail` 未被呼叫。
- 啟用 MFA 入口被觸發（Demo）：出現提示、`enrollMfa` 未被呼叫、沒有進入 QR Code 註冊畫面。
- 提示內容為固定文案，不含任何資料庫或 Supabase 原始錯誤文字（所在 Alert 的文字恰為該句）。
- 一般管理員：送出空白密碼表單仍走原本驗證（出現「請輸入目前密碼。」），不出現 Demo 提示；既有鎖定標籤與欄位狀態斷言不變。
- Toast 一次只顯示佇列最前面一則，所以三個入口各自獨立一個案例。

## 實作期發現（與任務卡假設不同）

任務卡「實作備註」假設 MFA 入口可用「移除 `disabled` 後點擊」覆蓋。實測**行不通**：React 依 `disabled` prop 擋停用按鈕的點擊，且 MUI `ButtonBase` 的 `onClick` 包裝在 `disabled` 時也直接 `return`，所以移除 DOM 屬性後點擊到不了 `handleStartMfaEnrollment`。含意：

- **MFA 入口的提示在真實瀏覽器中，只用「開發者工具移除 `disabled`」是看不到的**；密碼、Email 兩個表單因為 `submit` 不是滑鼠事件、`<form>` 本身沒有停用，移除送出鈕的 `disabled` 後 Enter／點擊即可走到 handler，提示可見。MFA 的 handler 防護因此屬於縱深防禦（需改動 React props 才觸發）。
- 測試改為沿 React fiber 取出元件傳給 Button 的原始 `onClick`（`handleStartMfaEnrollment`）直接呼叫，驗證 handler 本身的 `isDemo` 防護。此寫法依賴 React 內部結構（`__reactFiber`、MUI Button props 形狀），若日後升級 React／MUI 導致測試壞掉，應改寫取得 handler 的方式，而不是刪除這項測試。

## 安全性檢查

- 提示只是 UX，**不是安全邊界**。真正的鎖在 TASK-100 的資料庫觸發器；本卡未增加、也不依賴任何安全保證。
- 不顯示任何資料庫或 Supabase 原始錯誤；前端不做錯誤對應（TASK-098 (f)：supabase-js 呈現為 `message = {}`，無法可靠辨識）。
- Demo 路徑不呼叫任何更新函式（測試證明）；`isDemo` 為假時行為逐字不變（既有案例全過）。
- 未新增環境變數、端點、儲存或密鑰；未觸碰 `lib/admin/account.ts`、個人資料卡片與非 Demo 流程。

## 殘留風險

- 在 console 直接呼叫 Supabase 的請求不經過畫面，沒有畫面可顯示文案，不在本卡範圍（資料庫仍會擋）。
- 提示每次觸發都顯示，不做節流（任務卡已說明；入口只有開發者工具才能觸發）。
- MFA 提示的測試依賴 React／MUI 內部結構（見上）。
- 螢幕截圖：任務卡註明不適用（只多一個既有 Toast 元件顯示的文字），本報表以測試輸出為證。

## 後續任務

- 無新增。全套單元測試在高並行下的 5 秒逾時問題維持先前「另立任務」建議。
