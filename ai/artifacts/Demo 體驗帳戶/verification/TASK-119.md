# 驗證報告

## 摘要

- 任務：TASK-119 忘記密碼流程對體驗帳號的提示（前端）
- 結果：**通過**（`login-form` 35 項全過＝既有 30 項未改斷言＋新增 5 項；`tsc`、`lint`、`build` 通過；桌面亮色與 375 手機以預覽頁驗證）
- 方案：使用者於 2026-11-01 選定**方案 A**（不比對信箱、失敗時加引導），文案用任務卡建議原句。
- 驗證者：實作 agent（Claude Code）。風險低（單一元件、純前端、無端點／資料庫），依任務卡只需 UI 與測試審查；未另跑子代理。人工驗收待使用者。

## 變更的檔案

| 檔案 | 內容 |
|---|---|
| `app/login/login-form.tsx` | 忘記密碼區塊：`forgotResult === "error" && demoEnabled` 時，在原通用錯誤 Alert 之下新增一行引導（「若您是要體驗，請回登入頁使用「進入體驗帳號」。」）與「回登入頁」按鈕（呼叫既有 `backToLogin`）。`demoEnabled` 為假、成功路徑、`handleSubmit`、MFA、一鍵進入皆未動 |
| `tests/components/login-form.test.tsx` | 在 TASK-104 的 describe 末端新增 5 項案例；既有斷言未改 |
| `ai/artifacts/Demo 體驗帳戶/screen-spec-登入頁體驗入口.md` | 「忘記密碼」兩列改成與方案 A 一致（不再寫「前端攔下、不呼叫 Supabase」） |
| `tools/kanban/cards/TASK-119.json`、任務卡 md、本報表 | 流程文件 |

## 指令

| 指令 | 結果 | 備註 |
|---|---|---|
| `npx vitest run tests/components/login-form.test.tsx` | **35 項通過** | 新增 5 項；共跑多次皆全過 |
| 變異檢查：把 `demoEnabled` 條件換成 `false`（等於沒有引導） | **3 項失敗**（真時有引導、信箱無差異、回登入頁） | 證明新增測試有鑑別力；之後已還原（`git diff` 確認 +13 行仍在） |
| `npx tsc --noEmit` | 通過 | 0 錯誤 |
| `npm run lint` | 通過 | 0 error |
| `npm run build` | 通過 | |
| `grep -rl "hair_demo" .next/static` | 無命中 | client bundle 不含 Demo Email（真正的 `DEMO_EMAIL` 來自伺服器環境變數、非 `NEXT_PUBLIC_`） |

## 涵蓋範圍（新增的 5 項）

- `demoEnabled` 真、送出失敗：保留通用錯誤，多出引導句與「回登入頁」按鈕。
- `demoEnabled` 假、送出失敗：失敗畫面與現況一致，沒有引導與按鈕。
- 成功（`demoEnabled` 真）：只顯示固定成功文案，不顯示引導。
- 輸入一般信箱與 `hair_demo@example.com` 兩種失敗畫面的可見文字完全相同（不洩漏是否為體驗帳號信箱）。
- 點「回登入頁」：回到「設計師登入」、「進入體驗帳號」入口可見、錯誤與引導消失。

## UI 證據

以暫時預覽頁（`/tmp-task119`，渲染真實 `LoginForm demoEnabled`，已刪除、不在 commit 內）搭配內建瀏覽器驗證；瀏覽器端把 `window.fetch` 改成拒絕，使 `resetPasswordForEmail` 回傳錯誤，**沒有對 Supabase 發出任何請求、沒有寄信**。

| 情境 | 結果 |
|---|---|
| 桌面亮色，忘記密碼失敗 | 通用錯誤 Alert 下方出現引導句與「回登入頁」小按鈕，其下為 Email 欄位與「寄送重設信」。版面正常 |
| 桌面暗色（預覽頁預設） | 同上，文字與按鈕可讀 |
| 點「回登入頁」 | 回到「設計師登入」，「進入體驗帳號」入口可見 |
| 手機 375 寬 | `scrollWidth` = 375 = `innerWidth`（**無橫向捲動**）；引導句單行顯示、未被截斷 |
| 預覽頁 HTML | 不含 `hair_demo` |

任務卡要求的截圖：專案沒有存放截圖的慣例，本報表以描述與 DOM 檢查為證，未存成檔案。

## 審查發現

| 發現 | 嚴重程度 | 狀態 |
|---|---|---|
| 1. 方案 A 的已知取捨：Demo 入口開啟時，**任何**忘記密碼失敗（網路、限流、體驗信箱被擋）都會看到同一行引導，不是精準攔截；也不符合原畫面規格「前端攔下、不呼叫 Supabase」。已同步修訂畫面規格 | 低（已知取捨） | 使用者選定方案 A，已記錄 |
| 2. 引導按鈕緊接在 Email 欄位上方（Stack 間距 16px），視覺上略擠但不重疊、不影響操作 | 資訊 | 接受 |
| 3. 引導文案寫死在 `login-form.tsx`（與該檔其他文案一致），未放進 `lib/demo/notice-copy.ts`；任務卡允許的檔案不含後者 | 資訊 | 接受 |

## 安全性檢查

- 前端不比對任何信箱、不含 Demo Email（bundle 與預覽頁 HTML 檢查）；失敗畫面不因輸入內容而不同（測試證明）。
- 不依賴錯誤碼或錯誤文字（TASK-098 (f)：前端認不出鎖定錯誤），只依 `forgotResult === "error"` 與 `demoEnabled`。
- 引導只是 UX。**不寄信的保證在資料庫觸發器（TASK-100）**，本卡未增加、也不依賴任何安全保證。
- 未新增端點、環境變數、儲存或密鑰；未觸碰 `lib/supabase/*`、migration、`handleForgotSubmit` 成功路徑。

## 殘留風險

- 方案 A 不精準（見審查發現 1）。
- 全套單元測試在高並行下的 5 秒逾時問題維持先前「另立任務」建議（本卡 `login-form` 單獨執行全過）。

## 後續任務

- 無新增。端到端驗證（真實 Demo 帳戶、真實 Supabase）串接於 TASK-112。
