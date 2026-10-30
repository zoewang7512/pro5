# 驗證報告

## 摘要

- 任務：TASK-104 登入頁體驗入口與說明視窗旗標（前端）
- 結果：**通過**（`login-form` 30 項全過＝既有 14 項未改斷言＋新增 16 項；`tsc`、`lint`、`build` 通過；瀏覽器走查 F1／F2／F3 與手機、亮色／暗色）
- 驗證者：實作 agent（Claude Code）。風險低（純前端、無資料庫、無新端點），依任務卡只需 UI 與測試審查；未另跑子代理。人工驗收：使用者 2026-10-31 通過。
- **本卡只提供前端入口；`DEMO_ENABLED` 在正式環境仍未設定，入口不會渲染。** 真正串接與開啟在 TASK-112（其 dependsOn 含 113、114）。

## 變更的檔案

| 檔案 | 內容 |
|---|---|
| `app/login/page.tsx` | 伺服器元件把 `isDemoEntryEnabled()`（只回布林，密碼不經過）以 `demoEnabled` prop 傳給 `LoginForm` |
| `app/login/login-form.tsx` | 新增 `demoEnabled`（預設 false）、`demoEntering`／`demoError` 狀態、`handleDemoEnter`、`setDemoNoticeFlags`，以及 login 模式下「或」分隔線與體驗入口區塊；Email、密碼、登入、忘記密碼加上 `demoEntering` 停用條件。`handleSubmit`、MFA、忘記密碼既有邏輯未動 |
| `tests/components/login-form.test.tsx` | 檔尾新增 16 項 Demo 案例；既有斷言未改 |
| `tools/kanban/cards/TASK-104.json`、任務卡、本報表 | 流程文件 |

## 指令

| 指令 | 結果 | 備註 |
|---|---|---|
| `npx vitest run tests/components/login-form.test.tsx` | **30 項通過** | 新增 16 項；調整 Alert 字級後再跑一次仍全過 |
| `npx tsc --noEmit` | 通過 | 0 錯誤 |
| `npm run lint` | 通過 | 0 error |
| `npm run build` | 通過 | `/login` 仍為動態路由 |
| `grep` `.next/static` 搜尋 `DEMO_PASSWORD`／`DEMO_EMAIL` | 無命中 | bundle 內沒有 Demo 帳密 |

**未跑全套 vitest**：本卡只動登入頁與其測試；沒有共用元件或 helper 變更。

## 涵蓋範圍（新增的 16 項）

- `demoEnabled` 未提供／為假：不渲染入口與「或」，不呼叫端點；為真：顯示說明文字與按鈕，按鈕 `type="button"`，登入仍是唯一 submit。
- 只在 login 模式出現：切忘記密碼消失、返回後出現；`?mode=forgot-password` 進入不顯示。
- 載入中：按鈕文字「正在進入體驗帳號…」且停用；Email、密碼、登入、忘記密碼同時停用；`fireEvent.click` 重複點擊仍只呼叫一次 `fetch`。
- 成功：`POST /api/demo/enter`，init 只有 `method` 與 `cache`，不帶 body／credentials，也不含使用者在欄位輸入的值；`demo-welcome-pending="1"`、`demo-banner-dismissed` 被移除；`router.replace("/admin")`＋`refresh()`；不呼叫 `signInWithPassword`；導向期間按鈕維持停用。
- 失敗（403）、網路錯誤、HTTP 200 但本文非 `{ ok: true }`（三種）、429、500：皆顯示同一句通用文案、按鈕變「重新嘗試進入體驗帳號」且可再按、其餘表單恢復、不設旗標、不導向。
- 失敗後重試成功：錯誤消失並導向。
- `sessionStorage.setItem` 拋例外：仍導向 `/admin`，沒有錯誤。
- 入口失敗後一般 Email／密碼登入照常。

## 瀏覽器走查（dev server，暫時以假值開啟 `DEMO_ENABLED`，`fetch` 以 JS 攔截，未打真實後端）

| 狀態 | 結果 |
|---|---|
| F1 預設（桌面亮色、桌面暗色） | 入口區塊、「或」分隔線、outlined 按鈕符合 mockup |
| F2 載入中（桌面暗色） | 按鈕「正在進入體驗帳號…」；`document` 內 email、password、登入、忘記密碼、入口按鈕皆 `disabled`；攔截到的請求為 `{ method: "POST", cache: "no-store" }` |
| F3 失敗（手機 375 亮色） | Alert「目前無法進入體驗帳號，請稍後再試。」、按鈕「重新嘗試進入體驗帳號」；`scrollWidth` 375＝視窗寬（無橫向捲動）；按鈕高度 40px |
| F4 | 屬後台說明視窗（TASK-105／115 範圍），不在本卡 |

截圖是在對話中的 Browser pane 檢視，未另存檔案。調整：手機上錯誤文字出現孤字換行，已把 Alert 字級改為 mockup 的 12px 並重新確認單行顯示。

## 已知限制與殘留風險

1. **畫面規格「忘記密碼輸入體驗帳號信箱」的前端攔截未實作**：任務卡未列入允許範圍，且卡片明訂「前端不得出現 Demo 的 Email」，前端無從比對。該列在規格中標示為第二道防線；第一道（資料庫觸發器擋 recovery）已在 TASK-100。建議確認是否由其他卡負責，或接受規格這一列作廢。
2. 成功後刻意保持載入／停用狀態直到頁面離開；若導向被外力中斷（極少見），使用者需重新整理頁面。
3. 後台說明視窗讀取旗標由 TASK-105／115 實作；本卡只寫旗標。
4. F4 與暗色手機版未截圖。
5. 真正端對端（點按鈕→真實 session→後台）在 TASK-112 驗證。

## 審查關卡

- UI、測試：實作 agent 自評，**待人工確認**；未自行勾選看板的 gates。
