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

- 變更的檔案：待實作後填寫。
- 執行過的指令：待實作後填寫。
- 測試輸出：待實作後填寫。
- 螢幕截圖：待實作後填寫。
- 已知限制：待實作後填寫。
- 後續任務：無（本 Epic 四個 User Story 至此皆完整涵蓋）。
