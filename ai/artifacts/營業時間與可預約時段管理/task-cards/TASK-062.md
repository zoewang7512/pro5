# AI-Ready 任務卡

## Metadata

- 任務：`create_appointment` RPC 加入 `business_hours`（每週固定公休／營業時間）檢查
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：營業時間與可預約時段管理
- 上層 User Story：設定每週固定營業時間
- 分軌：後端
- 前置任務（dependsOn）：TASK-028
- 狀態：草稿（architect／security-reviewer 於 TASK-028 總覽審查一致提出的殘留風險，尚未
  走過人工核准；**不算 AI-ready**，見「未知事項」）
- 風險等級：高（比照 TASK-028，修改 `create_appointment` 這條顧客端唯一寫入路徑）

## 目標

`create_appointment` 目前只檢查 `closed_dates`（TASK-028，特殊公休日），完全不檢查
`business_hours`（每週固定公休、每天營業起訖時間）——顧客繞過前端直接呼叫 API，理論上
仍能在週固定公休日（例如週日）或凌晨等非營業時段成功建立預約。這與 TASK-028 修補的是
同一類攻擊面（`get_available_slots` 有感知、`create_appointment` 沒有），本卡補齊。

## 情境包（Context Pack）

- 相關檔案：
  - `supabase/migrations/0013_create_appointment_closed_dates.sql`：TASK-028 剛完成的
    `closed_dates` 檢查，本卡的直接前例——新增檢查的位置（服務驗證後、提前量檢查前）、
    部署順序防呆寫法、重用 `SLOT_CONFLICT` 錯誤碼的姿態，皆應比照辦理。
  - `supabase/migrations/0004_slots_closures_buffer.sql`：`get_available_slots` 對
    `business_hours` 的既有檢查邏輯（`v_weekday := extract(dow from p_date)`、查
    `open_time`／`close_time`／`is_closed`、`p_date` 落在營業時間之外回傳空陣列）。
- 既有模式：比照 TASK-028 的既有模式（見 0013 檔頭），不新增錯誤碼、不改前端、部署順序
  防呆、`security definer`／`search_path=''` 邊界不變。
- 未知事項（需要先由人工／`spec-interrogation` 決定，開始實作前不建議直接動手）：
  1. **檢查範圍**：只擋「當天完全公休」（`is_closed = true`），還是連「時段落在
     `open_time`～`close_time` 之外」也一併擋？後者需要額外處理 `p_start_at`／`v_end_at`
     是否完整落在營業時間窗內（服務時長可能跨過打烊時間），複雜度比 TASK-028 高。
  2. **30 分鐘時段對齊**：`get_available_slots` 只產生每 30 分鐘對齊的候選時段，顧客若
     直接呼叫 API 傳入非對齊的時間（例如 10:07），要不要一併拒絕？這是本卡範圍要不要
     擴大的產品決策，TASK-028 沒有處理過這個問題（因為公休日檢查與時段對齊無關）。
  3. **`force row level security` 隱性約束**：若採用與 TASK-028 相同的 `exists` 查詢
     模式，`business_hours` 表同樣要註記「不得啟用 force row level security」（見
     TASK-028 完成證據記錄的同一類風險）。
- 允許變更的檔案：尚未定案，需等上述決策確定後在 `implementation-plan` 階段列出（預期
  類似 TASK-028：新增一個 migration 檔案 + 對應 down + 整合測試擴充）。
- 不得觸碰：`get_available_slots` RPC（不修改，只讀取同一批表）、前端任何檔案。

## 需求

- 待補（走完 spec-interrogation 釐清「未知事項」段落後填寫）。

## 驗收標準

- 待補。

## 實作備註

- 開始寫程式碼前，建議依序：`spec-interrogation` 釐清範圍（是否含時段對齊）→
  `implementation-plan` 定案允許變更清單與驗證契約 → 依高風險工作規則走 architect／
  security-reviewer／test-engineer 三方審查與人工核准，比照 TASK-028 的完整流程。

## 驗證契約

- 待補（預期比照 TASK-028：整合測試擴充 `tests/business-hours.integration.test.ts`，
  涵蓋固定公休日拒絕、非固定公休日行為不變、與 `get_available_slots` 判斷一致三種情境）。

## 完成證據

- 變更的檔案：待實作後填寫。
- 執行過的指令：待實作後填寫。
- 測試輸出：待實作後填寫。
- 螢幕截圖：待實作後填寫。
- 已知限制：待實作後填寫。
- 後續任務：待補。
