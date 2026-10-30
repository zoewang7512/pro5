# AI-Ready 任務卡

## Metadata

- 任務：Demo seed 資料定義（純函式）與現況匯出工具
- 上層規格：[`feature-spec.md`](../feature-spec.md)；架構筆記：[`architecture-notes.md`](../architecture-notes.md)
- 上層 Epic：Demo 體驗帳戶
- 上層 User Story：Demo seed 資料
- 分軌：後端
- 前置任務（dependsOn）：TASK-097
- 狀態：草稿（待人工核准）
- 風險等級：中
- Agent owner：Claude Code
- 人工核准者：待使用者核准

## 目標

定義 Demo 還原要回到的資料：用一份人工審閱過的基底資料（`seed-base.json`）加上程式產生的相對日期預約與顧客，輸出給 `reset_demo_data` 的 payload；並提供唯讀的匯出工具，可以把目前正式資料當作基底的起點。

## 情境包（Context Pack）

- 相關檔案：
  - `supabase/migrations/0001`、`0006`、`0008`、`0017`、`0018`、`0020`（各表欄位、constraint、觸發器）
  - `scripts/seed-booking-data.mjs`（既有最小 seed）
  - `tests/helpers/`（既有測試輔助）
- 既有模式：純函式、可單元測試；日期以傳入的 `now` 為基準，不讀系統時間。
- 假設：
  - **基底資料的來源由使用者決定（見未知事項）。** 建議從目前正式資料匯出再人工調整，因為使用者已經建立並補齊了服務、設計師、作品集與店家資訊。
  - seed 預約的 `customer_email` 一律 `null`（避免觸發寄信）；電話與姓名使用明顯的虛構值。
- 未知事項：
  - **需要使用者決定：** 基底資料（服務、設計師姓名與簡介與專長、店家資訊文案）(A) 由 Claude 起草後使用者審閱，或 (B) 用本卡的匯出工具從目前正式資料產生、再由使用者刪改。建議 B。
  - 要保留幾位設計師、幾項服務、預約筆數與狀態分布（建議：約 6 週歷史加 3 週未來，狀態含待服務、已完成、已取消）。
- 允許變更的檔案：
  - `lib/demo/seed-types.ts`（新增：payload 型別）
  - `lib/demo/seed-base.json`（新增：人工審閱後的基底資料；內容不含任何個資）
  - `lib/demo/seed-data.ts`（新增：`buildDemoSeed(now, base)`，純函式）
  - `scripts/export-demo-base.mjs`（新增：**唯讀**，用 service role 讀取目前資料並寫成 `seed-base.json` 草稿）
  - `tests/lib/demo-seed-data.test.ts`（新增）
  - `package.json`（新增 `demo:export-base`）
- 不得觸碰：
  - 任何 migration
  - 資料庫內容（匯出工具只讀）
  - `lib/demo/seed-base.json` 以外的使用者資料

## 需求

- `buildDemoSeed(now, base)` 回傳 `reset_demo_data` 所需的完整 payload（含 `confirm: "RESET_DEMO"` 與全部必要鍵，各必要陣列有最低筆數）。
- **id 策略：** 設計師、服務、作品集的 `id` 與 `storage_path` 一律沿用 `seed-base.json` 裡的固定值（作品集路徑格式檢查綁了 `designer_id`，id 變了路徑就對不上，TASK-107 的「demo-seed 路徑與公開 bucket 相同」假設也會失效）；只有預約與顧客以 uuid v5 產生。
- 設計師列帶**明確的 `created_at`**（既有「預設設計師」以 `order by created_at, id` 辨識，還原不得改變順序）。
- 預約橫跨過去與未來，日期以 `now` 相對計算；起訖落在營業時間內、避開公休日與設計師請假日；同一設計師不重疊（遵守資料庫 exclusion constraint）；服務時長與緩衝符合設定；設計師必須有提供該服務。
- 每位設計師作品張數 ≤ 12；**預約的 `customer_email` 全為 `null`、不帶 `access_token`**（讓資料庫預設值產生）；不產生任何真實個資。
- 匯出工具：**白名單**只匯出服務、設計師與其三張子表、營業時間、公休日、預約規則、店家設定；**不匯出 `appointments`、`customers`、`audit_log`、`admins`**；只用 select；寫檔前提示將覆寫。
- 基底資料審閱：產生後交使用者逐項確認（服務名稱與價格、設計師簡介、店家資訊），核准前不得推進下游卡。
- payload 的 `admins` 列顯示名稱固定為「Demo帳號」（使用者指定）；完成 seed 後，列出各表筆數並提出 TASK-116 的上限建議表（約 2～3 倍；設計師固定 ≤5）供使用者核准。

## 驗收標準

- 對固定的 `now` 與基底，產出的 payload 完全可重現（snapshot 測試）。
- 不變量測試全部通過：無重疊、營業時間內、非公休日、非請假日、設計師有該服務、作品 ≤ 12、`customer_email` 全為 null、沒有 `access_token`、狀態分布符合設定、設計師 `created_at` 順序與基底一致。
- 換不同的 `now`（例如加 30 天）仍通過上述不變量；設計師、服務、作品集的 id 與路徑不隨 `now` 改變。
- 匯出工具對資料庫零寫入（只用 select 的檢查與一次實跑的前後筆數比對），且輸出檔不含預約與顧客。
- 使用者已審閱並核准 `seed-base.json` 內容。
- `seed-base.json` 與 payload 的顯示名稱為「Demo帳號」；各表筆數清單已交使用者。

## 實作備註

- 日期與時區：營業時間以台北時間計算，注意 UTC 轉換與跨日。
- `appointments_set_price_snapshot` 觸發器會在 insert 時寫入價格快照，seed 服務價格要先於預約。

## 驗證契約

- 單元測試：`tests/lib/demo-seed-data.test.ts`（snapshot＋不變量）。
- 整合測試：匯出工具對真實庫唯讀實跑，貼前後筆數。
- E2E 測試：不適用。
- 型別檢查：`npx tsc --noEmit` 無錯誤
- Lint：`npm run lint` 無錯誤
- Build：`npm run build` 成功
- 螢幕截圖：不適用。
- 安全性檢查：匯出檔不含顧客個資與 Email；基底資料不含任何真實電話。

## 審查關卡

驗證（測試工程）。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：
- 已知限制：
- 後續任務：
