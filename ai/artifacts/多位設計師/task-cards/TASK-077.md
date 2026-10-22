# AI-Ready 任務卡

## Metadata

- 任務：多位設計師 前後端串接驗證、端到端走查與文件同步
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：多位設計師
- 上層 User Story：全部（整合驗證）
- 分軌：前後端串接
- 前置任務（dependsOn）：TASK-067, TASK-068, TASK-069, TASK-070, TASK-071, TASK-072, TASK-073, TASK-074, TASK-075, TASK-076
- 狀態：已驗證，待人工驗收與處理合併前事項（人工已於 2026-10-21 核准；動工前 architect／security-reviewer 審查已於 2026-10-22 完成並採納，見「動工前審查定案」）
- 風險等級：中（不新增功能；確認整個 Epic 合在一起後，沒有規格缺口或回歸）
- Agent owner：Claude Code
- 人工核准者：使用者

## 目標

比照既有各 Epic 的「整合驗證」卡（例如 TASK-050、TASK-055）：逐條對照 feature-spec 的驗收標準走一遍，
跑完所有測試套件，補齊文件，並請人工驗收後合併 `feat/multi-designer` 到 master。

## 情境包（Context Pack）

- 相關檔案：`ai/artifacts/多位設計師/` 全部文件；`ai/context/project-map.md`、`decisions.md`、`design-system.md`；
  `ai/artifacts/預約規則與政策設定/task-cards/TASK-050.md`（整合驗證卡範例）。
- 既有模式：驗證報告以 `ai/templates/verification-report.md` 為範本，存到 `ai/artifacts/多位設計師/verification/TASK-077.md`。
- 假設：`0017`、`0018` 都已套用。
- 未知事項：無。
- 允許變更的檔案：
  - `ai/artifacts/多位設計師/verification/TASK-077.md`（新增）
  - `ai/context/project-map.md`（新資料表、RPC 簽名、目錄、測試指令）
  - `ai/context/decisions.md`（補齊本 Epic 期間未記錄的決策）
  - `ai/context/design-system.md`（確認 4 個新元件都已登記）
  - `README.md`（功能清單加上多位設計師）
  - 驗證過程中發現的小型修正（只限本 Epic 的檔案，修正前先回報）
- 不得觸碰：本 Epic 範圍外的功能。

## 需求

- feature-spec「驗收標準」逐條附證據（測試名稱或截圖）。
- 〔審查〕合併 master 前用 SQL 檢查並附輸出：(1) 沒有殘留的 `__TEST__` 設計師、服務、預約與 Storage 檔案；
  (2) 沒有「上架中但沒有任何啟用中設計師」的服務（`0017` 套用後由舊後台新增的服務要人工開給設計師）；
  (3) 兩支 RPC 的 `proacl` 與 `0018` 套用前記錄的一致。
- 〔審查〕確認 TASK-079（`is_admin()` 強制 aal2）已完成：**已完成**（master `234e6f7`、`13d9970`、`b450c2b`，且本分支已包含 master）。
  但它只對「已啟用 MFA」的帳號生效，正式管理員 designer001 目前未啟用 MFA，需人工決定（見驗證報告「合併前待人工決定」）。
- 跑全部單元測試與整合測試套件，附輸出。
- 完整走查：新增設計師 → 開服務 → 上傳作品 → 前台指定與不指定各預約一次 → 收確認信 → 後台多選篩選 → 標記請假 → 前台該日時段消失 → 停用設計師 → 前台不再顯示。
- 行動裝置（375px）與暗色模式截圖。

## 動工前審查定案（2026-10-22，architect＋security-reviewer，**不等同人工核准**）

- **執行順序**：tsc／lint／`npm test` → 殘留與設定表基準快照 → test:rls → designers → booking → admin-booking → services → booking-policy → business-hours →
  store-settings → account → **mfa-rls（必跑，本分支唯一的 aal2 回歸證據）** → notifications（避開台北 09:00 前後，正式 cron 在 UTC 01:00）→ 結束後再比對快照。
  **所有整合測試跑完才開始瀏覽器走查，不交錯**（套件結束會 global `signOut()`、business-hours 會暫時改營業時間）。
- **快照**：`business_hours`、`booking_policy`、`closed_dates`、`store_settings`、`admins` 的筆數與雜湊，測前測後比對；`closed_dates` 沒有測試標記，只能靠這個發現還原失敗。
- **殘留檢查補齊**：`__TEST__` 的設計師／服務／預約／顧客、`.invalid` email 預約、auth 測試帳號、`admins` 筆數、`designer_services` 雙向混接、
  `designer-assets` 孤兒檔（bucket 物件扣掉 `designers.avatar_url`／`designer_portfolio_images.storage_path`）、`admin-assets` 測試頭像、
  「測試設計師名下非 `__TEST__` 預約」。唯讀、只輸出計數與 id；LIKE 的 `_` 在程式端再用 `startsWith` 精確比對。
- **proacl 等需要 SQL 的項目**（沒有 SQL 通道）：備好 SQL 請使用者在 SQL Editor 唯讀執行並貼回；含兩支 RPC 與 5 支內部函式、`is_admin()` 含 aal2、四張表 RLS 旗標、`storage.objects` 全部 policy。
- **「既有服務都對預設設計師開啟」沒有現成測試**：以唯讀查詢補證據。
- **驗收標準第 2 條有兩個已知偏差，對照表標為偏差、不直接打勾**：簡介控制字元與方向字元只有前端擋；請假日「今天以後」只有函式層擋。
- **走查守則（正式資料庫）**：測試設計師只開給 `__TEST__` 服務；`__TEST__` 服務一上架就會在正式前台出現，時間窗要短、名稱可辨識；請假、停用只操作 `__TEST__` 設計師；
  走查電話先確認不在 `customers`；預約 email 只用店長自己的信箱；作品圖用無敏感內容的圖；清除前先確認測試設計師名下沒有非 `__TEST__` 預約，**不直接套用整批刪設計師預約的 `cleanupTestDesigners`**。
- **個資**：SQL 只輸出計數或 id；週曆截圖只拍只有測試資料的週次，否則遮蔽。
- **正式 Vercel 目前是 master 舊程式**：舊前端不傳 `p_designer_id`，確認信也沒有「設計師」一行；TASK-076 的實收證據只能在合併後取得，之前以單元與整合測試為準。
- **合併前待人工決定**：designer001 未啟用 MFA（TASK-079 對它無效）；Supabase 公開註冊仍開著（`disable_signup: false`）。
- 文件同步另含：`project-map.md` 過時處（唯一設計師用詞、`DesignersTable` 唯讀、全域 exclusion、`p_designer_id` 簽名、四張新表與 bucket、`test:mfa-rls`）、
  `README.md` 功能清單與用詞、`decisions.md` 的「單一設計師」理由加註；`design-system.md` 實際登記 5 個新元件（任務卡寫 4 個）。

## 驗收標準

- 所有測試通過，或失敗已記錄並取得人工決定。
- 驗證報告完成；文件同步完成。
- 人工驗收通過後才合併 master（Vercel 隨之部署），合併後在正式網址再走查一次前台預約。

## 實作備註

- 合併 master 前再次確認 `0017`／`0018` 已套用，否則新前端呼叫不存在的欄位會失敗。

## 驗證契約

- 單元測試：`npm test`
- 整合測試：`test:designers`、`test:booking`、`test:admin-booking`、`test:business-hours`、`test:rls`、`test:booking-policy`、`test:services`、`test:notifications`、`test:store-settings`、`test:account`
- E2E 測試：Browser 完整走查（見需求）。
- 型別檢查／Lint／Build：`npx tsc --noEmit`、`npm run lint`、`npm run build`
- 螢幕截圖：前台三個畫面、後台三個畫面、確認信、行動裝置與暗色模式。
- 安全性檢查：security-reviewer 對整個 Epic diff 做一次總覽審查。

## 完成證據

- 變更的檔案：`ai/artifacts/多位設計師/verification/TASK-077.md`（新增）、`ai/context/project-map.md`、`ai/context/decisions.md`、`README.md`、本任務卡、
  `tests/designers.integration.test.ts`（修正兩個既有測試缺陷，已回報並經使用者同意）、`tools/kanban/cards/TASK-077.json`。
- 執行過的指令、測試輸出：見 [`verification/TASK-077.md`](../verification/TASK-077.md)（單元 1070／1072，另 2 項為環境逾時；11 個整合套件 304 項全過；tsc、lint、build 通過）。
- 螢幕截圖：Browser 工具擷取，未存成專案檔案（含真實顧客資料風險）。確認信實收截圖待合併部署後。
- 已知限制：見驗證報告「已知限制與後續」；驗收標準 #2 有兩個資料庫層缺口（簡介控制字元、請假日今天以後）。
- 待人工處理：附錄 SQL（proacl 等）、designer001 啟用 MFA 的決定、Supabase 公開註冊、合併 master 與合併後正式網址走查。
- 後續任務：Demo 體驗帳戶 Epic（seed 要涵蓋本 Epic 的資料表）
