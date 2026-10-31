# AI-Ready 任務卡

## Metadata

- 任務：Email 寄信上限改為「建立時間」滾動視窗，堵住 Demo 靜默取消解除上限（TASK-114 審查 R1）
- 上層規格：[`feature-spec.md`](../feature-spec.md)；架構筆記：[`architecture-notes.md`](../architecture-notes.md) D13；來源：[`verification/TASK-114.md`](../verification/TASK-114.md)「未關閉的殘留風險」
- 上層 Epic：Demo 體驗帳戶
- 上層 User Story：濫用防護與緊急開關
- 分軌：後端
- 前置任務（dependsOn）：TASK-114
- 狀態：草稿（**待使用者決定修法與核准**）
- 風險等級：高（改寫公開預約入口 `create_appointment`，影響所有真實顧客）
- Agent owner：Claude Code
- 人工核准者：待使用者核准

## 目標

堵住「借寄件網域對任意 Email 無限次寄確認信」：`create_appointment` 開放給匿名使用者，同一個 Email 的上限只計 `pending／confirmed` 且尚未開始的預約。Demo（管理員）可把預約改成 `cancelled`（TASK-114 之後不寄信）來釋放額度，攻擊者再用同一個受害者 Email 重新預約，確認信（0011，D13 刻意保留）每輪都會寄出。顧客姓名由攻擊者填寫，店名、服務名、設計師名可由 Demo 修改，信件內容可控（模板已 escape，無 HTML／header injection，但純文字釣魚可行）。

0026 之前同一迴圈就存在，TASK-114 沒有引入也沒有關閉它。

## 需要使用者先決定的事（動工前）

| 選項 | 做法 | 影響 | 備註 |
|---|---|---|---|
| **A（建議）** | Email 與電話上限改為「過去 24 小時內**建立**的預約，不分狀態，最多 N 筆」 | 取消不再釋放額度。**會影響真實顧客**：24 小時內取消後重新預約的次數也會計入 | 只改 `create_appointment` 的兩個計數條件，不新增觸發器；N 預設沿用 3，是否要放寬待決定 |
| B | 對確認信做頻率節流：同一個 Email dedupe key 每日最多寄 N 封 | 預約照建，只是不寄信 | 需要紀錄表或在 webhook route 端查詢；改動面較大，且動到確認信路徑 |
| C | 禁止 Demo 把「未來預約」改成 cancelled | 最小影響真實顧客 | 與「Demo 可體驗取消」的產品決定衝突，需改 D13／TASK-115 文案 |
| D | 接受為殘留風險 | 無 | 依據：每個 Email 每次最多 3 筆、每日還原；但這個前提在 Demo 存在時不成立 |

## 情境包（Context Pack）

- 相關檔案：
  - `supabase/migrations/0018_designer_aware_booking.sql:511-534`（電話與 Email 上限、`_email_dedupe_key`）；`create_appointment` 在 0009、0013、0014、0018 都被整份重定義，**之後若還有更新版本（例如 0020），必須以編號最大者為底，逐字沿用、只改計數條件**
  - `supabase/migrations/0011_appointments_insert_webhook.sql`（確認信觸發器，不得動）
  - `supabase/migrations/0024_demo_reset.sql`（還原函式有觸發器白名單；本卡若不新增觸發器則不受影響）
  - `lib/booking/` 與前台對 `BOOKING_LIMIT_EXCEEDED` 的處理與文案
  - 既有 `test:booking`、`test:booking-policy` 整合測試
- 既有模式：`create or replace function`，檔頭寫明套用順序、回滾與「只改計數條件、其餘逐字不變」；以逐字比對單元測試把關（比照 `tests/lib/demo-mail-suppress-migration.test.ts`）。
- 假設：選 A。
- 未知事項：
  - 選 A 時 N 與視窗長度（24 小時？）是否要調整，才不誤傷真實顧客。
  - `create_appointment` 目前最新版本是哪一個 migration（動工時確認）。
  - 取消後釋放額度是否為既有產品期待（需確認 feature-spec 原意）。
- 允許變更的檔案（選 A 的預估，動工時以使用者決定為準）：
  - `supabase/migrations/00NN_booking_limit_rolling_window.sql` 與 `_down.sql`（新增；編號以動工當時最大編號為準，檔頭加依賴檢查）
  - `tests/lib/booking-limit-migration.test.ts`、對應整合測試與 vitest 設定、`package.json`（新增）
  - 前台限額文案（僅在需要時）
  - `ai/context/decisions.md`
- 不得觸碰：既有 migration 檔案、`notify_appointment_insert` 與其觸發器、webhook route。

## 需求

- 選 A：Email 與電話的計數改為 `created_at > now() - interval '24 hours'`、不分狀態；其餘邏輯逐字沿用。
- 保留既有 advisory lock 與計數順序（先電話、後 Email），避免並行繞過與死結。
- 超過上限的回應維持既有 `BOOKING_LIMIT_EXCEEDED`，前台文案不外洩內部規則。
- `_down.sql` 還原成套用前的函式本文（逐字）。

## 驗收標準

- 拋棄式資料：同一 Email 建立 N 筆後，把其中一筆改成 cancelled，**再建立第 N+1 筆仍被拒絕**（視窗內）；視窗外（以拋棄式資料調整 `created_at`）可再建立。
- 一般顧客在 N 筆內的正常預約、同日取消後重新預約（未超過 N）不受影響。
- 未填 Email 的預約不受 Email 上限影響；電話上限行為同步驗證。
- 並行請求（同 Email）不能繞過上限。
- `_down.sql` 後函式與套用前逐字一致；`test:booking`、`test:booking-policy` 套用前後都通過（**這次要補上套用前基準**）。
- 測試與驗證腳本不寄真實信件（INSERT 時 `customer_email` 先 null 再補，或使用 `@resend.dev` 測試位址並先確認會觸發的路徑）。

## 驗證契約

- 單元測試：逐字比對舊版與新版函式（只差計數條件）。
- 整合測試：新增 `test:booking-limit`；`test:booking`、`test:booking-policy` 回歸（套用前後）。
- E2E 測試：不適用（串接於 TASK-112）。
- 型別檢查：`npx tsc --noEmit`；Lint：`npm run lint`；Build：`npm run build`
- 安全性檢查：攻擊情境（Demo 靜默取消後重複預約）改版前後對照，附原始輸出。

## 審查關卡

架構、安全性、驗證（測試工程）；高風險，動工前須人工核准。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：
- 已知限制：
- 後續任務：
