# 驗證報告

## 摘要

- 任務：TASK-115 Demo 寄信說明視窗：改期／取消確認後顯示通知信示意圖（前端）
- 結果：**實作與自動化驗證完成，待使用者人工驗收。**相關測試 95 項全過；`tsc`、`lint`、`build` 通過；亮色、暗色、手機 375 的視窗畫面以暫時預覽頁實際看過（預覽頁已刪除）。
- 驗證者：實作 agent（Claude Code）。**本卡未啟動架構、安全、測試三個子代理審查**（低風險、純前端、單一畫面），審查關卡留待人工決定；agent 自我檢查**不等於人工核准**。
- 日期：2026-10-31。mockup 於同日由使用者逐項確認（見 `mockup-decision-Demo寄信說明視窗.md`）。
- 本卡**沒有**用 Demo 帳號實際登入走過整條流程：Demo 帳戶尚未在正式庫建立（TASK-112 才做首次 seed），端到端走查串接在 TASK-112。

## 變更的檔案

| 檔案 | 說明 |
|---|---|
| `app/admin/_components/DemoMailNoticeDialog.tsx` | 新增：說明視窗（Dialog＋示意圖＋一句說明＋兩個按鈕）。不認識 Demo，由呼叫端決定是否開啟 |
| `app/admin/_components/AdminDashboard.tsx` | `isDemo` 時，取消確認後與「確認改期」後先 `await` 說明視窗；非 Demo 路徑不 `await`、不掛載視窗 |
| `app/admin/_components/AppointmentDetailDialog.tsx` | **任務卡原未列出，實作時補登記**：新增選填 prop `beforeReschedule`。改期的最終確認按鈕在這個元件內，沒有它就無法在送出前攔截；未傳時行為逐字不變 |
| `lib/demo/notice-copy.ts` | 追加視窗文案與圖片尺寸，不改既有常數 |
| `public/demo/mail-notice-reschedule.png`、`mail-notice-cancel.png` | 新增：示意圖。**任務卡原為單一檔名，改為改期、取消各一張**（與畫面規格兩種狀態一致）。由 `lib/email/templates/` 的實際樣板渲染（含真實主旨格式），2x 解析度；示範資料為「王小明／剪髮／Eric／王牌理髮廳」，不含任何真實個資 |
| `tests/components/demo-mail-notice-dialog.test.tsx` | 新增：元件 10 項 |
| `tests/components/admin-dashboard.test.tsx` | 新增（**任務卡寫「補案例」，但此檔原本不存在**）：Demo／非 Demo 的取消與改期共 10 項 |
| `tests/components/appointment-detail-dialog.test.tsx` | 新增 3 項 `beforeReschedule` 案例；另加 `vi.setConfig({ testTimeout: 30000 })`（比照 `reports-view.test.tsx`），未改既有斷言 |
| `ai/context/design-system.md` | 登記 `DemoMailNoticeDialog` 到元件庫 inventory |
| 任務卡、mockup 決策、看板卡 | 記錄使用者核准與範圍補充 |

## 設計重點

- **攔截點**：取消＝既有取消確認框的「取消預約」按下後；改期＝改期表單的「確認改期」按下後。兩者都是「最終確認之後、呼叫資料層之前」，與使用者確認的出現時機一致。
- **返回的語意**：返回、Esc、點遮罩都 `resolve(false)`：不呼叫任何資料層函式。取消流程回到取消確認框原狀；改期流程停在改期表單，**已選的時段保留**、按鈕不會卡在送出中。
- **一般管理員**：`isDemo` 為假時 `isDemo && !(await …)` 短路，沒有多等 microtask；視窗元件不掛載、圖片不載入（測試以 `document.querySelector('img[src^="/demo/"]')` 為 null 斷言）。
- **文案**：只說明正式環境的行為，不宣稱「已寄出」（測試斷言沒有「已寄出」字樣）。
- **圖片載入失敗**：以圖片網址為 key 記錄失敗，改顯示主旨與內容摘要的文字替代，不顯示錯誤訊息；換成另一種信件時自動恢復。
- **暗色模式**：示意圖本身是固定的淺色信件，以淺色卡片呈現（卡片底色與邊框為固定值，不隨主題反轉）。

## 指令與輸出

| 指令 | 結果 |
|---|---|
| `npx vitest run tests/components/demo-mail-notice-dialog.test.tsx tests/components/admin-dashboard.test.tsx tests/components/appointment-detail-dialog.test.tsx tests/components/demo-notice.test.tsx tests/components/admin-shell.test.tsx tests/lib/demo-config.test.ts` | 6 檔 95 項全過 |
| `npx tsc --noEmit` | 0 錯誤 |
| `npm run lint` | 0 錯誤 |
| `npm run build` | 成功 |
| `npx vitest run`（全套件） | 見下方「已知限制」 |

## 驗收標準對照

| 驗收標準 | 證據 |
|---|---|
| Demo：改期與取消確認後都先看到視窗；按繼續才執行；按返回不寫入（以資料層呼叫次數驗證） | `admin-dashboard.test.tsx`：視窗出現時 `cancelAppointment`／`rescheduleAppointment` 呼叫 0 次；繼續後各 1 次；返回與 Esc 後 0 次 |
| 一般管理員：既有測試全數通過、未改既有斷言、不會看到視窗 | `appointment-detail-dialog.test.tsx` 既有 7 項照過；`admin-dashboard.test.tsx` 非 Demo 案例斷言直接送出且無視窗、無圖片請求 |
| 示意圖有替代文字；視窗可純鍵盤操作 | 元件測試：`getByRole("img", { name })`、Esc 視同返回、Tab 可到達兩個按鈕、`role="dialog"` 以標題命名 |
| 亮色、暗色、手機各一張螢幕截圖 | `verification/TASK-115-screenshots/`：`desktop-light-reschedule.jpg`、`desktop-dark-reschedule.jpg`、`mobile375-light-reschedule.jpg`、`mobile375-light-cancel.jpg` |
| 手機 375：按鈕堆疊、高度 ≥ 44px、圖片不溢出、無橫向捲動 | 預覽頁量測：兩顆按鈕高 44、寬 287；`scrollWidth` 375 = `innerWidth` 375；主要動作在上 |

截圖是用**暫時的預覽頁**（直接渲染元件，已刪除）在開發伺服器的瀏覽器窗格取得，不是 Demo 登入後的真實後台畫面。

## 安全性檢查

- 前端視窗**不是安全邊界**：關掉它、繞過它都不會讓 Demo 真的寄信；真正的守門在 TASK-114（資料庫觸發器）。視窗文案不宣稱任何已發生的事。
- 示意圖是靜態資源，放在 `public/demo/`，`proxy.ts` 的 matcher 只涵蓋 `/admin`，所以不經過登入檢查；內容只有示範資料，無個資、無密鑰。
- 沒有新增任何網路請求、環境變數或 `dangerouslySetInnerHTML`；圖片 `src` 為常數，不含使用者輸入。

## 已知限制與殘留風險

1. **TASK-114 尚未完成**：視窗寫著「體驗帳號不會真的寄出」，在 TASK-114 的資料庫守門上線前這句話在後端並不成立。`TASK-115` 的 `dependsOn` 只列 TASK-097，所以看板不會擋；**兩卡必須在同一次部署前都完成**（TASK-112 的相依清單已同時包含兩者）。
2. **全套件 `npx vitest run` 在本機有既有的逾時失敗**（本次執行 7 個檔案 45 項，涵蓋 `account-settings-view`、`login-form`、`designer-*` 等與本卡無關的檔案；失敗名單每次不同，皆為 5 秒預設逾時，單獨執行 5 個無關檔案時只剩 2 項失敗）。與本次變更無關，但讓全套件無法作為乾淨的綠燈證據；本卡相關的 6 個檔案單獨執行全過。建議另立卡處理測試逾時。
3. 示意圖的店名、電話、地址為示範值；日後若店家信件版型改版，圖片需重新產生（產生方式：以 `lib/email/templates/` 輸出 HTML、用 Edge headless 以 2x 截圖）。
4. 開發伺服器曾因舊的快取在 SSR 讀到過期的 `notice-copy` 模組而回 500（重啟後正常，`build` 成功），屬 dev server 快取，非程式問題。

## 後續任務

- TASK-112：以 Demo 帳號在真實後台走完整條流程（含此視窗的實際畫面）。
- 另立卡（建議）：處理全套件單元測試在本機的 5 秒逾時。
