# AI-Ready 任務卡

## Metadata

- 任務：預約規則與政策設定 create_appointment／get_available_slots 讀取最短提前預約時間設定值
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：預約規則與政策設定
- 上層 User Story：設定最短提前預約時間
- 分軌：後端
- 前置任務（dependsOn）：TASK-046
- 狀態：就緒（前置任務 TASK-046 已於 2026-08-23 完成）
- 風險等級：高（修改 `create_appointment`／`get_available_slots`——顧客端唯一的預約
  寫入路徑與可預約時段查詢路徑——把寫死的 1 小時提前量改為從 `booking_policy` 讀取，
  任何邏輯錯誤可能導致合法預約被誤擋，或非法預約被放行；需與既有公休日、緩衝時間檢查
  正確共存，需架構、安全性、測試三方審查）

## 目標

把 `create_appointment`（`supabase/migrations/0002_booking_flow.sql` 第 209 行）與
`get_available_slots` 目前寫死的「最短提前 1 小時」改為讀取 `booking_policy.
min_lead_time_hours`；最遠視野上限（90 天）維持寫死不變。

## 情境包（Context Pack）

- 相關檔案：
  - `supabase/migrations/0002_booking_flow.sql` 第 205-211 行：`create_appointment`
    現行「提前量與視野上限」檢查區塊，本卡只改提前量部分（`interval '1 hour'` →
    讀取設定值），視野上限（`interval '90 days'`）保持不變。
  - `supabase/migrations/0004_slots_closures_buffer.sql`：`get_available_slots` 現行
    產生候選時段的邏輯，需要找到對應的提前量過濾條件（可能是候選時段生成迴圈裡的起始
    時間下限判斷）並比照同樣方式改為讀取設定值。
  - `supabase/migrations/0005_create_appointment_closed_dates.sql`（若「服務項目管理」
    或其他 Epic 的 TASK-028 已先實作公休日檢查）／既有緩衝時間（TASK-022）檢查邏輯：
    本卡新增的提前量讀取，必須確認不會與這些既有檢查互相覆蓋或短路，各自獨立生效。
  - `ai/skills/`（若有既有「修改核心 RPC」的檢查清單）：比照 TASK-024／TASK-028 的既有
    模式，`create_or replace function` 前先用 `do $$ ... raise exception` 確認
    `booking_policy` 表存在才繼續（部署順序防呆，比照既有慣例）。
- 既有模式：
  - `create_appointment` 與 `get_available_slots` 對「沒有時段」統一不細分原因回傳
    （比照既有公休日檢查的既有設計意圖），本卡的提前量檢查沿用既有
    `VALIDATION_ERROR`／既有錯誤格式，不新增錯誤碼。
- 假設：
  - 提前量檢查改為：`select min_lead_time_hours into v_min_lead_hours from
    public.booking_policy limit 1;`，再用
    `p_start_at < now() + make_interval(hours => v_min_lead_hours)` 取代現行寫死的
    `interval '1 hour'`。
  - `booking_policy` 表恆有 1 列（TASK-046 migration seed 保證），不需要處理零列情境；
    若查詢意外回傳空結果（理論上不會發生），比照既有防禦性寫法可 fallback 為 1 小時
    （現行既有預設值），避免因設定表意外清空導致整個預約功能中斷。
  - `get_available_slots` 的候選時段生成邏輯若原本用固定的 `interval '1 hour'` 做為
    起始時間下限，需要找到確切位置後比照同樣的讀取方式替換；若該函式的提前量判斷邏輯
    與 `create_appointment` 不同（例如透過呼叫端 SQL 參數而非函式內寫死），需在實作
    階段先確認實際程式碼結構，情境包的假設以 `create_appointment` 已確認的第 209 行
    為準，`get_available_slots` 的確切位置需實作時查證。
- 未知事項：`get_available_slots` 內提前量判斷的確切程式碼位置與寫法，需在實作階段
  查證（`0004_slots_closures_buffer.sql` 全文），若與本卡假設不符需調整寫法但不改變
  「改讀取 `booking_policy` 設定值」這個目標本身。
- 允許變更的檔案：
  - `supabase/migrations/0009_booking_policy_lead_time.sql`（新增；接續 TASK-046 使用
    的 `0008`）
  - `supabase/migrations/0009_booking_policy_lead_time_down.sql`（新增，還原成
    `create or replace function` 換回寫死 1 小時的原始版本，比照既有 down migration
    慣例，不用 `drop function`，避免顧客端預約功能出現空窗）
- 不得觸碰：
  - `booking_policy` 表結構（TASK-046 已建立，本卡只讀取）。
  - 前端任何檔案（`lib/booking/api.ts`／`app/_components/booking/`）——不新增錯誤碼、
    不改前端，比照既有公休日檢查的決策模式。
  - 既有公休日、緩衝時間、視野上限檢查邏輯（只能新增提前量讀取，不能修改或移除既有
    檢查）。

## 需求

- 新增 `supabase/migrations/0009_booking_policy_lead_time.sql`：
  - `create or replace function` 前先確認 `booking_policy` 表存在（部署順序防呆）。
  - `create_appointment`：提前量檢查改為讀取 `booking_policy.min_lead_time_hours`，
    視野上限維持寫死 90 天不變，其餘既有邏輯（服務驗證、電話/信箱驗證、顧客去重、寫入
    `appointments`、`exception` 分類）不變。
  - `get_available_slots`：候選時段生成邏輯的提前量下限比照同樣方式改為讀取設定值。
  - 對應 down migration：兩支函式皆還原為寫死 1 小時的原始版本。
- WHEN 顧客端呼叫 `get_available_slots` THE SYSTEM SHALL 依 `booking_policy.
  min_lead_time_hours` 計算可選時段，不顯示低於此時間門檻的時段。
- WHEN 顧客端呼叫 `create_appointment` 且 `p_start_at` 低於目前設定的最短提前預約時間
  THE SYSTEM SHALL 拒絕該請求，回傳既有 `VALIDATION_ERROR` 錯誤碼。
- WHEN `booking_policy.min_lead_time_hours` 為預設值 1（未經設計師調整） THE SYSTEM
  SHALL 與修改前的既有行為完全一致（無回歸）。

## 驗收標準

- 未調整設定值時，`create_appointment`／`get_available_slots` 行為與修改前完全一致
  （回歸安全網）。
- 調整設定值後，兩支 RPC 正確反映新的最短提前預約時間。
- 既有公休日、緩衝時間、視野上限檢查邏輯不受影響，與新的提前量檢查同時正確生效。
- 既有測試（`test:booking`／`test:admin-booking`／`test:business-hours`）重跑無回歸。

## 實作備註

- 這是 `create_appointment`／`get_available_slots`——顧客端預約流程的兩支核心 RPC——
  本批次的又一次 `create or replace`。**強烈建議**實作完成後，比照 TASK-024／028 的
  既有作法，先用簡單案例人工核對：調整最短提前預約時間為較長數值（例如 6 小時）、確認
  6 小時內的時段從 `get_available_slots` 消失、確認直接呼叫 `create_appointment` 對
  6 小時內的時段被拒絕；調回較短數值後確認恢復正常。

## 驗證契約

- 單元測試：不適用（本卡純 SQL migration，無可抽出的 TypeScript 純函式邏輯）。
- 整合測試：擴充 `tests/booking.integration.test.ts`（或 TASK-050 統一擴充的整合測試
  檔案）新增案例：調整 `min_lead_time_hours` 後 `get_available_slots`／
  `create_appointment` 的正確回應；與既有公休日／緩衝時間規則同時生效的組合案例；驗證
  後還原設定值為預設 1 小時，避免污染其他測試。
- E2E 測試：不適用（無 UI 變更，前端沿用既有 `get_available_slots` 回傳結果渲染，見
  「情境包」不得觸碰前端的決策）。
- 型別檢查：`tsc --noEmit` 成功。
- Lint：`npm run lint` 成功。
- Build：`npm run build` 成功。
- 螢幕截圖：不適用。
- 安全性檢查：`create_appointment`／`get_available_slots` 維持 `security definer`／
  `set search_path = ''`／既有 `grant execute` 邊界不變；新增的讀取不引入 SQL injection
  風險（讀取值為整數，用於 `make_interval` 參數，非字串拼接）。

## 完成證據

- 變更的檔案：待實作後填寫。
- 執行過的指令：待實作後填寫。
- 測試輸出：待實作後填寫。
- 螢幕截圖：待實作後填寫。
- 已知限制：待實作後填寫。
- 後續任務：TASK-050（整合驗證）。
