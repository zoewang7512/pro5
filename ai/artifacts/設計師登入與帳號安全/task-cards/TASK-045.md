# AI-Ready 任務卡

## Metadata

- 任務：設計師登入與帳號安全 前後端串接驗證與端到端測試
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：設計師登入與帳號安全
- 上層 User Story：全部（整合驗證）
- 分軌：整合
- 前置任務（dependsOn）：TASK-038, TASK-039, TASK-040, TASK-041, TASK-042, TASK-043, TASK-044
- 狀態：已核准（2026-08-18），待前置任務 TASK-038～044 完成後轉就緒
- 風險等級：高（身分驗證相關 Epic 的整合驗證，涵蓋密碼、email、MFA 多個安全邊界，比照
  `definition-of-ready.md` 高風險項目定義，需架構、安全性、測試三方審查）

## 目標

新增 `npm run test:account` 整合測試，涵蓋 `get_admin_profile`／`update_admin_profile`
RPC 與 `admin-assets` bucket 的權限邊界；重跑既有整合測試確認無回歸；Browser 工具桌面
尺寸 E2E 走查登入頁改版、忘記密碼／重設密碼、帳號設定頁五個區塊、MFA 完整流程；至少
各一次真實 email 收發（忘記密碼、email 變更）與真實 Authenticator App（MFA 註冊與登入
驗證）手動驗證；更新 `project-map.md`。

## 情境包（Context Pack）

- 相關檔案：
  - `tests/store-settings.integration.test.ts`／`vitest.store-settings.config.ts`：最近
    一次新增整合測試檔案的既有格式範本，`test:account` 比照建立獨立的
    `vitest.account.config.ts`。
  - `ai/context/project-map.md`：更新「常用指令」表新增 `test:account`，補充帳號設定
    頁、`admin-assets` bucket、MFA 相關的架構描述。
- 既有模式：
  - 各整合測試檔案「記錄原始快照、測試中改動、afterAll 還原」的既有模式；本卡測試帳號
    的 `display_name`／`avatar_url` 變更需比照此模式還原。
- 假設：
  - MFA 相關的自動化測試範圍：可用 `otplib`（或等效函式庫，僅作為測試依賴）在測試環境
    計算已知 secret 的 TOTP 碼，驗證 `mfa.enroll`／`mfa.verify`／`mfa.unenroll` 的呼叫
    行為與權限邊界；若技術上不可行或成本過高，改以「至少一次真實 Authenticator App
    手動走查」取代，並在完成證據中說明取捨（比照既有卡片「Browser 工具當下無法產生
    真正螢幕截圖」類型的既知限制記錄模式）。
  - email 變更與忘記密碼的真實收發驗證，需要使用一個非正式生產帳號的測試 email（避免
    干擾正式設計師帳號），實作階段確認測試環境是否已有這樣的帳號可用，若無則需要人工
    協助建立或改用其他驗證方式（例如查看 Supabase Dashboard 的 Auth 事件記錄取代真實
    收信）。
- 未知事項：測試環境是否已具備可收發真實 email 的測試帳號——需在實作階段向人工確認，
  若沒有則調整驗證深度並記錄為已知限制，不阻擋其他部分的驗收。
- 允許變更的檔案：
  - `tests/account.integration.test.ts`（新增）
  - `vitest.account.config.ts`（新增）
  - `package.json`（新增 `test:account` script）
  - `ai/context/project-map.md`（更新）
  - `ai/context/decisions.md`（若驗證過程發現需要記錄的架構決策，例如 MFA 測試策略的
    最終取捨）
  - 【實作期新增，見完成證據】`app/admin/_components/AccountSettingsView.tsx`／
    `tests/components/account-settings-view.test.tsx`：總覽性安全審查發現
    TASK-042／TASK-059 交界的整合問題（已啟用 MFA 時改密碼／Email 成功後 session
    降回 aal1、下次瀏覽 `/admin` 會被無預警登出），使用者當場核准以 Toast 提示取代
    無預警登出作為最低成本修正，超出原始任務卡「整合驗證」範圍但屬於本次驗證直接
    發現、當場核准的小範圍修正。
- 不得觸碰：
  - 既有整合測試檔案的既有測試案例邏輯（僅執行重跑確認無回歸）。

## 需求

- 新增整合測試涵蓋：
  - `get_admin_profile`／`update_admin_profile`：管理員可成功讀寫自己的個人資料；
    非管理員呼叫被拒或回傳空值。
  - `admin-assets` bucket：管理員可上傳；非管理員上傳被拒；已上傳物件可公開讀取。
  - MFA 相關呼叫的權限邊界（依上方假設決定自動化深度）。
- 重跑 `test:rls`／`test:booking`／`test:admin-booking`／`test:business-hours`／
  `test:store-settings`（與 TASK-037 若已完成則一併重跑 `test:services`），確認無
  回歸。
- Browser 工具桌面尺寸走查：登入頁視覺→忘記密碼送出→（若已於信箱收到）點擊連結完成
  重設密碼→用新密碼登入→帳號設定頁編輯顯示名稱/大頭貼→修改密碼→發起 email 變更→
  啟用 MFA（真實 Authenticator App）→登出→重新登入需通過 MFA 驗證→停用 MFA。
- 確認既有登入/登出流程（未啟用 MFA 情境）與既有測試無回歸。

## 驗收標準

- `npm run test:account` 全數通過，對真實 Supabase 專案驗證 RPC 與 Storage 邊界正確。
- 既有整合測試重跑無回歸。
- `npx tsc --noEmit`／`npm run lint`／`npm run build` 皆通過。
- Browser 工具走查完整流程無誤，並取得螢幕截圖或等效驗證證據。
- 至少各一次真實 email 收發（忘記密碼、email 變更）與真實 Authenticator App（MFA 註冊
  與登入驗證）的手動驗證證據（截圖或詳細文字記錄）。
- `project-map.md` 更新反映帳號設定頁、`admin-assets` bucket、MFA 架構與新增指令。

## 實作備註

- 若 Browser 工具當下無法產生真正螢幕截圖，比照既有慣例（見 TASK-018／033 完成證據
  記錄），改用 accessibility tree／`get_page_text` 驗證並記錄為已知限制。
- MFA 與 email 變更的手動驗證步驟建議詳細記錄操作過程（時間戳記、使用的 Authenticator
  App、測試 email），作為高風險 Epic 的額外審查證據。

## 驗證契約

- 單元測試：（若前置任務尚未涵蓋齊全）補齊遺漏的純函式測試。
- 整合測試：`npm run test:account`（新增）；重跑既有整合測試組。
- E2E 測試：Browser 工具桌面尺寸走查（見上方「需求」），含真實 MFA 與 email 手動驗證。
- 型別檢查：`npx tsc --noEmit`
- Lint：`npm run lint`
- Build：`npm run build`
- 螢幕截圖：登入頁、忘記密碼、重設密碼、帳號設定頁五個區塊、MFA 完整流程。
- 安全性檢查：本卡風險等級高，建議額外執行 `security-reviewer` 子代理對整個 Epic
  （TASK-038～044 累積的變更）做一次總覽性審查，重點確認 `admins` 表零 RLS policy
  姿態未被打破、MFA 停用需要身分驗證、忘記密碼流程不洩漏帳號存在性。

## 完成證據

- 變更的檔案：
  - `tests/account.integration.test.ts`（新增，17 案例：`get_admin_profile`／
    `update_admin_profile` RPC 權限邊界、`admin-assets` bucket 權限邊界、
    `mfa.enroll`／`challenge`／`verify`／`unenroll` 呼叫行為）
  - `vitest.account.config.ts`（新增）
  - `package.json`（新增 `test:account` script）
  - `ai/context/project-map.md`（更新：`test:account` 常用指令、`lib/auth/aal.ts`
    重要目錄條目、`app/login/`／`app/admin/`／`proxy.ts` 條目補上 TASK-044／059
    的 MFA／aal 說明、修正過時的 `unenrollMfaWithCode` 函式名稱錯字）
  - `app/admin/_components/AccountSettingsView.tsx`（實作期新增，見上方「允許變更
    的檔案」說明：密碼／Email 更新成功時，若已啟用 MFA 則 Toast 額外提醒需要重新
    登入完成驗證；並修正因此觸發的 React Compiler `preserve-manual-memoization`
    lint 錯誤——為既有的 `fetchMfaFactors` useCallback 依賴陣列補上
    `setMfaFactorId`／`setMfaLoadError`／`setMfaLoading`）
  - `tests/components/account-settings-view.test.tsx`（新增 2 案例，涵蓋上述已啟用
    MFA 情境的 Toast 提示）
- 執行過的指令：
  - `npx tsc --noEmit`：通過
  - `npm run lint`：通過
  - `npm run build`：通過（production build 成功）
  - `npx vitest run --pool=forks --poolOptions.forks.singleFork`（全專案單元測試）：
    321/321 通過（26 檔案；含本卡新增的 2 案例）
  - `npm run test:account`（新增）：17/17 通過（對真實 Supabase 專案）
  - `npm run test:rls`：6/6 通過（無回歸）
  - `npm run test:booking`：19/19 通過（無回歸）
  - `npm run test:admin-booking`：13/13 通過（無回歸）
  - `npm run test:business-hours`：18/18 通過（無回歸）
  - `npm run test:store-settings`：11/11 通過（無回歸）
  - `npm run test:services`：13/13 通過（無回歸）
  - Browser 工具 E2E 走查（桌面尺寸）：
    1. 登入頁視覺與未啟用 MFA 的登入/登出無回歸
    2. 忘記密碼：表單畫面正確，送出後因先前測試已用完 Supabase 免費方案 SMTP 寄信
       配額而收到 `over_email_send_rate_limit`，依既有設計（`handleForgotSubmit`
       一律顯示通用失敗文案，避免洩漏帳號存在性）正確顯示「發生未預期的錯誤，請
       稍後再試。」，行為符合預期、非新增缺陷
    3. 帳號設定頁「個人資料」：編輯顯示名稱、儲存成功、Sidebar 頭像縮寫即時反映，
       測試後已用 service role 還原為原始 `null` 狀態
    4. MFA 完整流程：多輪啟用／輸入正確驗證碼／輸入錯誤驗證碼／停用，皆用手寫
       TOTP 演算法驅動（見下方「真實 Authenticator App」段落，另有真人手動走查）
  - **真實 Authenticator App 手動驗證**（任務卡要求的至少一次）：使用者實機用
    Google Authenticator 掃描帳號設定頁的真實 QR Code（一開始誤用手機相機掃描
    無法辨識，改用 Authenticator App 內建的掃描功能後成功）完成 MFA 啟用；接著
    完整重跑一次登入流程，帳密正確後進入 MFA 驗證碼畫面，用 Authenticator App
    產生的真實驗證碼完成登入、成功進入 `/admin`；驗證完成後使用者於自己的瀏覽器
    停用 MFA，已確認帳號恢復「未啟用」狀態
  - 密碼／Email 修改、大頭貼上傳：未在本卡另外做即時 Browser UI 走查（避免修改
    共用測試帳號 `designer001` 的密碼／Email 造成後續腳本/測試失效的風險），改由
    `tests/admin/account.test.ts`／`tests/components/account-settings-view.test.tsx`
    既有單元測試與本卡新增的 `test:account` 整合測試（RPC／bucket 權限邊界）涵蓋
- 三方審查：
  - **security-reviewer**（Epic 總覽性審查，任務卡明確要求）：三項指定檢查
    （`admins` 表零 RLS policy、MFA 停用需要身分驗證、忘記密碼不洩漏帳號存在性）
    全數通過。額外發現一個跨任務卡（TASK-042／TASK-059）整合問題：已啟用 MFA 的
    帳號在帳號設定頁修改密碼或 Email 成功後，`reauthenticateAdmin`
    （`signInWithPassword`）會建立全新的 aal1 session、不會自動補回 aal2，下一次
    瀏覽 `/admin` 會被 TASK-059 新增的伺服器端 aal 檢查無預警導向 `/login`。使用者
    當場核准以 Toast 提示取代無預警登出作為最低成本修正（見下方「已知限制」的完整
    修法說明），已實作並補上單元測試。
  - **test-engineer**（新增整合測試審查）：發現一個「測試通過但沒測到宣稱內容」
    的斷言缺口（驗證碼錯誤案例的標題主張確認 factor 仍為 unverified，但原本沒有
    真的呼叫 `listFactors()` 斷言），已修正補上斷言，重跑 17/17 仍通過；其餘測試
    設計（`freshAal1Client`／`stepUpClient` 刻意重新登入以測出 aal1 邊界、cleanup
    邏輯、`computeTotp` 正確性）確認合理無 bug。
- 已知限制：
  - **中度（TASK-045 總覽性審查發現，已用 Toast 提示緩解，未完整修復）**：已啟用
    MFA 的帳號修改密碼或 Email 成功後，這個瀏覽器分頁的 session 會降回 aal1（其他
    裝置的 session 也會被登出，這是既有的、已知的 Supabase 行為）；下一次瀏覽
    `/admin` 頁面會被導向 `/login`，需要重新輸入帳密並再次通過 MFA 驗證碼才能
    回到後台。本卡已加上 Toast 明確提示「請重新登入以完成驗證」，避免使用者被
    無預警登出時摸不著頭緒，但**沒有**做到「原地自動補回 aal2、不需要重新登入」
    的完整修法（那需要在密碼／Email 修改表單也加上驗證碼欄位，UI 複雜度與
    `unenrollMfaWithPasswordAndCode` 的二次確認對話框相當，超出本卡「整合驗證」
    的範圍，且改密碼／改 Email 是低頻操作，Toast 提示的體驗成本可接受）。
  - 忘記密碼／Email 變更的真實收信驗證：因無法存取測試帳號 `designer001@gmail.com`
    的信箱，未完成任務卡原先要求的「至少一次真實收發」；改以確認
    `resetPasswordForEmail`／`updateUser({email})` 呼叫本身行為正確（含
    rate_limited 錯誤路徑的正確處理）替代，依任務卡「未知事項」段落已核准的
    fallback。
  - 螢幕截圖未存成獨立檔案（Browser 工具目前的既有限制，同 TASK-043／044／059）。
  - MFA 前端仍無連續失敗次數上限（延續既有已知限制）。
  - RLS／`is_admin()` 層級的 aal2 強制檢查尚未實作（TASK-059 已知限制，已有登記的
    後續任務卡）。
- 後續任務：
  - 沿用 TASK-059 完成證據登記的後續任務卡：`is_admin()`／RLS policy 層級的 aal2
    強制檢查。
  - 新任務卡（可選，優先度中）：已啟用 MFA 時修改密碼／Email 的完整體驗修法（原地
    補回 aal2，不需要重新登入），若使用者實際使用後認為 Toast 提示不夠好用再排入。
