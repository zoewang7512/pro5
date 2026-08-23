# AI-Ready 任務卡

## Metadata

- 任務：預約規則與政策設定 create_appointment／get_available_slots 讀取最短提前預約時間設定值
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：預約規則與政策設定
- 上層 User Story：設定最短提前預約時間
- 分軌：後端
- 前置任務（dependsOn）：TASK-046
- 狀態：完成（人工已於 2026-08-23 驗收通過）
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
  - `tests/booking.integration.test.ts`（修改；原規劃未列入，test-engineer 於實作階段
    審查認定 MUST FIX——本卡驗證契約原允許整合測試延到 TASK-050，但判定不足以涵蓋
    高風險變更，要求現在就補上，已記錄在完成證據；此處補齊允許清單使卡片自洽，
    security-reviewer 於 TASK-050 Epic 總覽性審查發現此帳面落差）
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
- 整合測試：擴充 `tests/booking.integration.test.ts` 新增案例（test-engineer 於實作
  階段審查認定 MUST FIX：原規劃允許延到 TASK-050，但這是修改顧客端唯一預約路徑的高風險
  變更，且既有「提前量／視野上限」案例其實從未真正控制過 `booking_policy` 的值，只是
  巧合通過，必須現在就補上明確案例，理由與 TASK-046 的先例一致）：
  - 外層 `beforeAll` 明確記錄快照並把 `min_lead_time_hours` 設回 1，讓既有回歸案例
    真正驗證「未調整設定值時行為與修改前完全一致」，而非依賴環境當下剛好是預設值。
  - `min_lead_time_hours` 設為上限 720 小時 → 近期營業日的 `get_available_slots`
    全部清空（先在預設值下確認該日期本來就有時段，避免恆真斷言）。
  - `min_lead_time_hours` 設為非預設值（3 小時）→ `create_appointment` 差 10 分鐘
    未達門檻應拒絕、超過門檻應成功（邊界案例）。
  - 組合案例：公休日早退判斷不受提前量讀取影響；緩衝時間排除與提前量放行同時正確生效、
    互不遮蔽（AND 關係）。
  - 驗證後還原設定值為 1，`afterAll` 失敗要 throw，不吞掉。
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

詳見 `tools/kanban/cards/TASK-048.json` 的 `evidence` 欄位（commands／findings／residual）。
摘要：

- 變更的檔案：`supabase/migrations/0009_booking_policy_lead_time.sql`／`_down.sql`
  （新增）、`tests/booking.integration.test.ts`（修改，新增 booking_policy 快照/還原
  與 4 個 TASK-048 新案例）。
- 執行過的指令：`npx tsc --noEmit`／`npm run lint`／`npm run build` 皆通過；
  `npm run test:booking`（23/23，含新增 4 案例）、`npm run test:admin-booking`
  （13/13）、`npm run test:business-hours`（18/18）、`npm run test:booking-policy`
  （6/6）皆通過、無回歸。
- 審查：本卡風險等級高，依既有慣例派遣 architect／security-reviewer／test-engineer
  三個子代理審查。architect／security-reviewer 判定 SQL 邏輯本身無需修改（忠實重現
  既有邏輯、防呆與回滾正確），但各提出數項 NICE TO HAVE 已一併處理：`limit 1` 改為
  `where id = 1`（語意自足）；回滾腳本補回被精簡掉的原始註解（含 architect 認定「全
  專案唯一解釋 ±1 天範圍限定為何存在」的關鍵說明）並加上回滾順序警告（若要一併回滾
  0008，必須先回滾 0009，否則 `drop table restrict` 偵測不到 plpgsql 函式體的隱性
  依賴）；針對 security-reviewer 指出「查無資料時 fallback 為 1 小時」與 TASK-046
  `lib/booking-policy.ts`「查無資料視為錯誤」方向相反的疑慮，已在 migration 註解明確
  登記這是刻意的不對稱取捨（可用性優先於一致性）與隱性約束（`booking_policy` 不得啟用
  `force row level security`）。test-engineer 判定驗證契約 MUST FIX（見上方「驗證
  契約」段落），已依其具體案例設計實作測試，實測時另外發現一個真實測試臭蟲：測試用
  顧客姓名（`TEST_MARKER` 前綴＋案例描述）超過資料庫 50 字元上限，導致「提前量太早」
  案例其實是巧合通過姓名驗證錯誤，已修正並補上更精確的 `message` 斷言防止同類問題
  再次被掩蓋。
- 測試輸出：`tests/booking.integration.test.ts` 新增 4 案例（720 小時上限清空近期
  時段、3 小時邊界差 10 分鐘判斷、公休日早退不受影響、緩衝時間與提前量互不遮蔽），皆
  通過；既有 19 案例（含「提前量／視野上限」）改為在明確控制的 `min_lead_time_hours=1`
  下執行，不再是巧合通過。
- 螢幕截圖：不適用（無 UI 變更）。
- 已知限制：`booking_policy` 表不得啟用 `force row level security`（否則 fallback
  邏輯會靜默放寬提前量設定，已於 migration 註解登記）；未依實作備註另外走一輪手動
  瀏覽器/RPC 人工核對（6 小時案例）——自動化整合測試已用 720 小時／3 小時兩組數值更
  precise 地涵蓋同一驗證目的，判定重複執行手動核對非必要。
- 後續任務：TASK-050（整合驗證，可視需要擴充涵蓋更多提前量與其他規則的組合情境）。
