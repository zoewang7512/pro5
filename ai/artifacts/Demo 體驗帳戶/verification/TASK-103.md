# 驗證報告

## 摘要

- 任務：TASK-103 一鍵進入端點 `POST /api/demo/enter`
- 結果：**實作與自動化驗證完成，使用者已於 2026-10-31 人工驗收通過。**單元 64 項、整合 22 項全過；`tsc`、`lint`、`build` 通過。
- 驗證者：實作 agent（Claude Code）。架構、安全、測試三個子代理審查已執行並處理，其意見是 agent 意見，**不等於人工核准**。
- 日期：2026-10-31。整合測試由 agent 對正式 Supabase 專案執行（拋棄式帳號，結束後已刪除並驗證無殘留）。
- **本卡只提供端點，尚未有任何前端呼叫它；`DEMO_ENABLED` 在正式環境仍未設定，端點一律回 403。**

## 變更的檔案

| 檔案 | 說明 |
|---|---|
| `app/api/demo/enter/route.ts` | 新增：`POST` 與其餘方法 405；失敗回應與 cookie 過期 |
| `lib/demo/enter.ts` | 新增：核心流程（設定→同源→限流→暫存 cookie 登入→`is_demo`／aal 驗證→回傳暫存 cookie） |
| `tests/api/demo-enter.test.ts` | 新增：64 項單元測試 |
| `tests/demo-enter.integration.test.ts`、`vitest.demo-enter.config.ts` | 新增：22 項整合測試（含 `is_admin()` 寫入面實測） |
| `package.json` | 新增 `test:demo-enter` |
| `ai/artifacts/Demo 體驗帳戶/verification/TASK-103-admin-surface.md` | 新增：`is_admin()` 寫入面盤點 |
| `ai/context/decisions.md` | 新增 TASK-103 條目 |

> 工作區另有 `AccountSettingsView.tsx`、`account-settings-view.test.tsx`、`TASK-101.json`、`TASK-118` 相關檔案的變更，屬 TASK-101／118，與本卡無關，commit 時請分開。

## 指令與輸出

| 指令 | 結果 |
|---|---|
| `npx vitest run tests/api/demo-enter.test.ts` | 64 passed |
| `npm run test:demo-enter`（對正式 Supabase） | 22 passed（1 檔） |
| `npx tsc --noEmit` | 0 錯誤 |
| `npm run lint` | 0 error |
| `npm run build` | 成功（`/api/demo/enter` 為動態路由） |
| `npx vitest run tests/api tests/lib` | 21 檔、433 passed |
| 完整 `npx vitest run`（審查前） | 1744 passed、11 failed：全為 React 元件測試 `Test timed out`（5 秒，機器負載高），與本卡檔案無關；失敗的檔案單獨重跑皆通過（與 TASK-102 報告所記相同現象） |

## 驗收標準對照

| 驗收標準 | 結果 | 證據 |
|---|---|---|
| 每道防線各有單元測試 | 通過 | 未啟用、缺帳密、DEMO_EMAIL＝設計師帳號、方法錯（405）、缺／`null`／跨站／不同協定／port／子網域／無法解析的 Origin、被限流、限流出錯、限流丟例外、登入失敗、登入丟例外、非 Demo（6 種 `is_demo` 形態）、需要 aal2（nextLevel、已驗證 TOTP）、讀不到 aal |
| 非 Demo 帳戶保證 | 通過 | 單元（fake）＋**整合（真實）**：`DEMO_EMAIL` 指向非 Demo 的管理員 → log 類別 `not_demo`（不是 `sign_in_failed`）、回應沒有任何 session cookie |
| `signOut` 丟例外時回應仍無 session cookie 且 `sb-*` 過期 | 通過 | 單元：fake 的 signOut 丟例外**且清不掉暫存區**（暫存區仍含 session），涵蓋非 Demo、aal2、讀不到 aal、讀 aal 丟例外四種 |
| `signOut` 真的撤銷 session | 通過（整合） | 以 `@supabase/ssr` 包裝記錄失敗前建立的 session：非 Demo 與 aal2 兩條路徑，之後 `getUser(access_token)` 失敗、`refreshSession` 失敗 |
| 成功與失敗回應都帶 `no-store` | 通過 | 單元與整合；405 也帶 |
| `is_admin()` 寫入面盤點報告 | 通過 | `verification/TASK-103-admin-surface.md`；含 12 項實測 |
| 成功時帶 session cookie，之後以該 cookie 存取 `/admin` 成功 | 通過（不含瀏覽器 E2E） | 整合：把回應的 `Set-Cookie`（屬性 `Path=/`、`SameSite=lax`、`Max-Age`）原樣當 `Cookie` 標頭，送給**真實 middleware `updateSession`** → 不重導 `/login`；無 cookie 對照組被導向 `/login`；另驗 `getUser()`、`isAalSatisfied`、`is_admin()` 為 true。瀏覽器端到端由 TASK-112 負責 |
| 所有失敗回應本文完全相同 | 通過 | 單元：7 種情境的狀態、本文、標頭、Set-Cookie 完全相同；**session 分成 3 塊且 signOut 失敗時 Set-Cookie 順序與基準一致**；整合（真實）：密碼錯誤、非 Demo、aal2 三者的狀態、本文、標頭、**Set-Cookie 原始順序**完全相同 |
| 回應、log、錯誤堆疊找不到 Email 與密碼 | 通過 | 單元：底層錯誤訊息與例外訊息夾帶密碼與 Email，log 與回應皆不含；例外只記類別名稱；整合：成功回應不含 |
| 使用者輸入不影響被登入的帳號 | 通過 | 單元：body、query、Authorization、Cookie 皆不影響 `signInWithPassword` 的參數；暫存區一開始與判斷 aal 時都不含請求帶來的 session |

## 審查處理

**已修正**
- （架構）失敗回應的 Set-Cookie 順序與名稱會因 session 分塊數而洩漏「帳密正確但非 Demo」：改為固定名稱清單（請求帶來的 `sb-*`＋預設名稱含 `.0`～`.4`，排序）。
- （架構）新增的 `server-only` stub 與 alias 不在任務卡範圍：已刪除，改在測試檔內 `vi.mock("server-only")`。
- （架構、安全）aal 判斷在讀不到 session 時會放行：改為 `currentLevel` 必須是 `aal1` 且 `nextLevel` 存在；成功前再確認暫存區有非空 `sb-*` cookie。
- （架構、安全）log：例外記類別名稱、限流記原因（`ip_limit`／`global_limit`／`error`）、aal 讀取失敗另記 `aal_error`。
- （測試）整合測試的負向案例改為斷言失敗類別（避免因別的原因湊巧通過）；補「session 真的被撤銷」「完整標頭比對」「Set-Cookie 往返加真實 middleware」「請求帶同名舊 cookie」「分塊」；單元測試的 fake 不再自動清空暫存區，使「無 live cookie」的斷言有鑑別力。
- （安全）盤點報告更正：Storage 的 update／delete／list 涵蓋整個 bucket（已實測）；補「正式庫無真實顧客」前提、取消也會寄信、Auth 面向、遺漏的函式、service_role 路徑、觸發器函式授權的精確說法。

**未處理，需使用者決定（第 1 項已於 2026-10-31 決定）**
1. ~~**登出式 CSRF（架構、安全審查皆建議）**~~ **已決定並實作（使用者 2026-10-31）：跨站失敗（`cross_origin`）不寫任何 cookie，其餘失敗照規格過期；同源檢查改放在 `DEMO_ENABLED` 檢查之前，使跨站請求在任何情況都不寫 cookie。單元（含「Demo 未啟用時跨站仍不寫」「缺 Origin」「同源對照組仍過期」）與整合皆有斷言。**原問題如下：**：規格要求「任何失敗都讓 `sb-*` 過期」，所以惡意網站可自動送出跨站 POST，讓店長或正在體驗的面試官在本機被登出（伺服器端 session 不受影響，無權限外洩，屬騷擾）。代價是非瀏覽器端能分辨「是否通過同源檢查」（瀏覽器端因 CORS 讀不到，非瀏覽器端本來就知道自己送了什麼 Origin）。
2. **盤點報告 §3-H：Demo 可刪除／覆寫三個 Storage bucket 內任何既有物件，含 `designer001` 的頭像，且每日還原不會恢復。**TASK-113 完成前正式環境不得開啟 `DEMO_ENABLED`（TASK-112 已依賴 113）。
3. **盤點報告 §3-I：Demo 可取消／改期真實顧客的預約，TASK-114 後不寄信。**目前前提是正式庫沒有真實預約；請明確接受或另開卡。
4. **盤點報告 §3-D：網址欄位（Logo、封面、頭像）資料庫無來源限制，Demo 直接打 REST 可填任意外部網址。**
5. **盤點報告 §3-J：請到 Supabase Dashboard 確認 passkey 未啟用。**

**未處理、列為殘留風險（審查認為可接受）**
- 時間差可分辨「登入前失敗」與「登入後失敗」，只能推知設定錯誤或限流已滿，無實質價值。
- 限流殘留：IPv6 以 /64 計數、Vercel 前若再有代理則所有訪客共用 bucket（使用者已接受全站上限是阻斷服務槓桿）。
- 同源檢查允許請求自身的 origin 與 `NEXT_PUBLIC_SITE_URL`；Vercel 上改只認後者會擋掉 preview 部署且對 CSRF 無實質增益，未採用。
- TOTP 判斷與 `lib/auth/aal.ts` 重複（本卡不得修改該檔）；兩處以註解互指。建議日後抽出共用函式。
- `@supabase/ssr` 預設 cookie 沒有 `Secure`、`httpOnly: false`，為既有全站慣例。
- 整合測試期間正式庫會暫時有 3 個 `is_demo` 拋棄式帳號；中斷未清會使 `demo:disable` 失敗（盤點報告 §3-K，檔頭已寫清除步驟，TASK-111 手冊要補一句）。
- 單元測試以模組層 mock 呼叫 Route Handler，`enterDemo` 的依賴注入縫沒有被直接使用（兩套替身並存的疑慮）；`isSameOrigin`、`createCookieStage` 皆透過路由間接覆蓋。
- 405 測試直接呼叫 handler，沒有經過 Next 路由層；`HEAD`、`OPTIONS` 依 Next 框架行為（本路由有匯出 `GET`，`HEAD` 由框架衍生；`OPTIONS` 預設回 204，不洩漏資訊），未另測。
- `maxDuration = 30`：與 cron 寫法一致。

**給後續卡片**
- TASK-104：用 `fetch` POST；不要設 `referrerPolicy: "no-referrer"`（會讓 Origin 變成 `"null"` 被擋）；成功後整頁導向或 `router.refresh()`，讓伺服器元件讀到新 cookie；成功／失敗文案固定；評估點擊劫持（`next.config.ts` 沒有 frame-ancestors／X-Frame-Options）。
- TASK-111：緊急關閉手冊要寫「改 `DEMO_ENABLED` ＋ Redeploy」；異常時先確認沒有殘留的 `demoenter` 測試帳號。
- TASK-112：開啟 `DEMO_ENABLED` 前須 113、114 完成，並確認 §3-H、§3-I 的決定。
- 日後每張新增資料表或 Storage policy 的卡：驗收清單加「Demo 管理員能對它做什麼」。
