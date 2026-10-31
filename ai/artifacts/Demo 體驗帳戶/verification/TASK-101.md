# 驗證報告

## 摘要

- 任務：TASK-101 帳號設定頁 Demo 鎖定狀態（前端）
- 結果：**通過**（`account-settings-view` 50 項全過＝既有 43 項未改斷言＋新增 7 項 Demo 案例；`tsc`、`lint`、`build` 通過；全套 91 檔 1648 項全過（`--maxWorkers=2`；`--maxWorkers=3` 兩次各有逾時失敗，見「指令」）
- 驗證者：實作 agent（Claude Code）。風險低（純前端、無資料庫、無端點），依任務卡只需 UI 與測試審查；未另跑子代理。人工驗收待使用者。

## 變更的檔案

| 檔案 | 內容 |
|---|---|
| `app/admin/_components/AccountSettingsView.tsx` | 讀 `useAdminProfile().isDemo`；密碼、登入 Email、MFA 三張卡片在 `isDemo` 時欄位與按鈕全部 `disabled`、標題旁加 Chip「🔒 體驗帳號不開放」、依需求文案顯示說明；MFA 在 Demo 下不呼叫 `listMfaFactors`（`mfaLoading` 初始為 `!isDemo`，effect 提早 return）；三個送出入口（密碼表單、Email 表單、啟用 MFA）另加 `if (isDemo) return` 作防禦；新增檔內小元件 `AccountCardTitle` 供密碼與 Email 卡片共用。個人資料卡片與非 Demo 路徑未動 |
| `tests/components/account-settings-view.test.tsx` | 檔尾新增 `renderDemoView` 與 7 項 Demo 案例；既有斷言未改 |
| `tools/kanban/cards/TASK-101.json`、本報表 | 流程文件 |

任務卡允許的第三個檔案（`mockups/demo-account-locked-variants.html`）規劃階段已修正文案，本卡未再動。

## 指令

| 指令 | 結果 | 備註 |
|---|---|---|
| `npx vitest run tests/components/account-settings-view.test.tsx` | **50 項通過** | 新增 7 項；共跑三次（開發中、全套之後各一次）皆全過 |
| `npx tsc --noEmit` | 通過 | 0 錯誤 |
| `npm run lint` | 通過 | 0 error |
| `npm run build` | 通過 | |
| `npx vitest run --maxWorkers=3`（全套）第 1 次 | 1647／1648，1 項失敗 | 失敗的是既有 MFA 測試，單獨重跑通過 |
| `npx vitest run --maxWorkers=3`（全套）第 2 次 | 1645／1648，3 項失敗 | 2 項在 `account-settings-view`（既有的密碼不一致、MFA 停用成功）、1 項在 `designer-portfolio-tab`（本卡沒碰），輸出皆為「Test timed out in 5000ms」；單獨重跑 `account-settings-view` 全過 |
| `npx vitest run --maxWorkers=2`（全套）第 3 次 | **91 檔 1648 項全過** | 降低並行度後無逾時，確認前兩次失敗為負載造成 |

## 涵蓋範圍（新增的 7 項）

- 三張卡片各出現「🔒 體驗帳號不開放」標籤共 3 個，且三句說明文案逐字符合任務卡。
- 密碼卡片：目前密碼、新密碼、確認新密碼與「更新密碼」皆 disabled。
- 登入 Email 卡片：目前 Email、目前密碼與「更新 Email」皆 disabled。
- MFA 卡片：顯示「未啟用」、「啟用雙重驗證」disabled，`listMfaFactors` 未被呼叫，沒有「無法讀取雙重驗證狀態」錯誤。
- 直接對兩張表單觸發 `submit`（模擬繞過 disabled）：`updateAdminPassword`、`updateAdminEmail`、`enrollMfa` 皆未被呼叫，也沒有驗證錯誤訊息跑出來。
- 個人資料卡片：顯示名稱與「更換頭像」可用，修改後「儲存」可按並呼叫 `update_admin_profile`。
- 一般管理員（非 Demo）：沒有任何鎖定標籤與文案，欄位可操作，`listMfaFactors` 照常呼叫一次、「啟用雙重驗證」在載入後可按。

## UI 證據

以暫時預覽頁（`/tmp-task101`，已刪除，不在 commit 內）渲染真實 `AccountSettingsView` 與 `AdminProfileProvider isDemo`，用內建瀏覽器截圖與 DOM 檢查：

| 情境 | 結果 |
|---|---|
| 桌面（約 1100 寬）亮色，Demo | 三張卡片標題旁有鎖定標籤、下方有說明、欄位與按鈕灰化；個人資料卡片正常。版面與選定的 mockup 變體 A 一致 |
| 手機（375 寬）亮色，Demo | 單欄、`scrollWidth` = 375 = `innerWidth`（**無橫向捲動**）；標籤與說明未被截斷 |
| 桌面暗色，Demo | 標籤、說明與停用欄位皆可讀；標籤文字維持正常對比 |
| 一般管理員（無 `demo=1`） | `.MuiChip-label` 只有「未啟用」；頁面文字不含「體驗帳號」；所有欄位 enabled。MFA 卡在預覽頁顯示「重試」是因預覽頁沒有真實登入 session，`listMfaFactors` 失敗，反而證明非 Demo 仍照常讀取 |
| DOM 檢查（Demo） | 密碼 3 欄、Email 2 欄皆 disabled；按鈕：更新密碼、更新 Email、啟用雙重驗證 disabled；顯示名稱與「更換頭像」enabled |

預覽頁期間的 console 錯誤只有一個 hydration 警告，來自預覽頁自己用 `window` 分支，已改成掛載後讀 query 解決，與元件無關。

## 審查發現

| 發現 | 嚴重程度 | 狀態 |
|---|---|---|
| 1. 全套單元測試在高負載下會有 5 秒逾時的既有測試（本次出現在 `account-settings-view`、`designer-portfolio-tab`，後者與本卡無關）。與 TASK-087／088／097 報告記錄的並行不穩定為同一議題；本卡新增 7 項測試讓該檔測試數增加，單檔執行時間約 25 秒，仍建議另立任務處理 | 低 | 非本卡造成，維持先前「另立任務」建議 |
| 2. 鎖定標籤只有 Chip 文字與說明文字，輸入欄位沒有 `aria-describedby` 指向鎖定說明；被 disabled 的控制項本身不進入 Tab 順序，讀屏使用者讀到卡片標題與標籤即可得知原因，符合任務卡「Chip 文字或 `aria-describedby`」二擇一，故未加 | 資訊 | 接受 |
| 3. 預覽頁截圖未存成檔案：專案沒有存放截圖的慣例（既有驗證報告皆以文字描述），本報表依慣例描述 | 資訊 | 接受 |

## 安全性檢查

- **畫面停用不是安全邊界。** `isDemo` 來自伺服器端讀 `app_metadata.is_demo`（TASK-097），僅作前端提示；繞過前端直接呼叫 Supabase Auth API 時，真正的鎖是 TASK-100 的資料庫觸發器。本卡未增加、也不依賴任何安全保證。
- `isDemo` 讀不到時預設 `false`，一般管理員行為與現況完全一致（單元測試與預覽頁 DOM 檢查證明）。
- 未新增任何環境變數、端點、儲存或密鑰；未觸碰 `lib/admin/account.ts`、`Sidebar.tsx`。
- 三個送出入口加了 `if (isDemo) return` 防禦，避免有人移除 `disabled` 屬性後從前端觸發到 `updateAdminPassword`／`updateAdminEmail`／`enrollMfa`（仍會被資料庫擋，這只是少打一次多餘請求）。

## 殘留風險

- **規劃缺口（需使用者決定）：** 畫面規格「錯誤」列要求「繞過前端被資料庫擋下時，統一顯示『體驗帳號不開放這項操作』、不顯示資料庫原始錯誤」，驗證方式寫「單元測試」。但 TASK-101 的需求與允許範圍沒有包含它（且 `lib/admin/account.ts` 不得觸碰），經搜尋 TASK-100、TASK-112 與其他卡也**沒有任何一張卡負責**。本卡按已核准的範圍不處理。
  - **更正（2026-10-30，驗收後）：** 此處原寫「繞過前端時會看到各 handler 的通用失敗文案」並不正確。本卡加的 `if (isDemo) return` 會讓移除 `disabled` 後的點擊**靜默無反應**，不會走到任何失敗文案；且 TASK-098 (f) 已證明前端無法辨識資料庫的鎖定錯誤（supabase-js 呈現為 `message = {}`），所以「辨識資料庫錯誤再轉文案」本來就做不到。
  - **處置：** 使用者決定另立卡處理，已建 **TASK-118**（由 `isDemo` 判斷，在三個入口顯示固定提示，不做錯誤對應）。
- 前端停用可被瀏覽器開發者工具移除；此時請求會被 TASK-100 的觸發器擋下（資料層安全不受影響，只是文案）。
- 本卡以元件測試與預覽頁證明畫面；真實 Demo 帳戶登入後的完整畫面要等 TASK-103（一鍵進入）與 TASK-112（串接）才能端到端驗證。

## 後續任務

- TASK-118：Demo 觸發被鎖操作時的統一提示文案（見殘留風險第 1 項）。
- TASK-112 驗收時：以真實 Demo 帳戶開 `/admin/account` 對照本報表截圖。
