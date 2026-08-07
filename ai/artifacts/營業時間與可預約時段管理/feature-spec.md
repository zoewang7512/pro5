# 功能規格書

## Metadata

- 功能：營業時間與可預約時段管理（對應 `tools/kanban/epics.json` 已登記的同名 Epic）
- 負責人：待指定
- 狀態：草稿（第二批次，待人工核准）
- 風險等級：中（新增 `closed_dates` 資料表與對應 RLS policy；`services` 新增
  `buffer_minutes` 欄位；修改 `get_available_slots` RPC 與後台改期表單
  （`lib/admin/reschedule-slots.ts`）的時段計算邏輯，須確認不影響既有預約流程與既有測試；
  不涉及新的 anon 可觸及寫入介面，沿用既有 `is_admin()` 邊界，不修改
  `appointments_no_overlap` exclusion constraint 或 `appointments.end_at` 語意）
- 本次涵蓋範圍：此 Epic 在 `epics.json` 登記了 4 個 User Story。**第一批次**「設定每週固定
  營業時間」（含連帶的 `isClosedWeekday()` 技術債修正）已於 2026-08-06 人工核准並完成
  實作／驗證（TASK-018～TASK-021，見 `ai/artifacts/營業時間與可預約時段管理/task-cards/`），
  該批次建立的模式（`business_hours` 表、受影響預約警告流程、後台週曆改查資料庫）本批次
  會直接沿用，不重複說明。**本規格書（第二批次）涵蓋剩下兩個 story**：
  - 設定公休日／特殊假期
  - 設定服務間的緩衝時間

  第 4 個 story「系統自動計算可預約時段」已由 TASK-010 的 `get_available_slots` RPC 實作
  完成；本批次會修改這個 RPC（加入公休日與緩衝時間判斷），因此會一併重新確認其既有行為
  （時段衝突防護、90 天視野、提前 1 小時限制、顧客去重）不受影響，不需要新工作。

## 問題

- 目前公休日只能透過每週固定的 `business_hours.is_closed` 設定（例如「每週日公休」），
  設計師無法標記「特定單一日期」公休（例如國定假日、臨時休診）——想休某一天，若透過既有的
  「營業時間設定」頁調整，會錯誤地把該天的每週固定公休狀態一併改掉（影響到每週同一天，而
  非只影響那一天一次），也沒有介面可以做「單一天例外」的標記。
- 目前所有服務項目共用同一套「依 `duration_minutes` 緊接排列」的可預約時段計算邏輯
  （`get_available_slots` RPC、`lib/admin/reschedule-slots.ts`），沒有欄位可以讓某個服務
  （例如需要事後整理／清潔的服務）在結束後保留緩衝時間，導致該服務結束後下一筆預約可以
  緊接著開始，設計師沒有整理空檔。

## 使用者

- 設計師（後台唯一登入帳號，經 `is_admin()` 驗證）：直接使用者，設定特殊公休日。緩衝時間
  本批次僅完成資料層／計算邏輯，設計師目前只能透過資料庫直接設定（詳見「非目標」），UI
  留待「服務項目管理」Epic。
- 顧客（前台，未登入）：間接受影響——`get_available_slots` RPC 會依新的公休日與緩衝時間
  規則，回傳不同的可預約時段。

## 目標

- 讓設計師能標記「特定單一日期」為整天公休，不影響該日期以外、同星期幾的其他日期。
- 修改後台週曆（`WeekCalendar.tsx`）與後台改期表單（`reschedule-slots.ts`）正確反映特殊
  公休日，與 `get_available_slots` RPC 保持一致（沿用 TASK-020 已建立的「後台週曆改查
  資料庫」模式）。
- 讓每個服務項目可以各自設定結束後的緩衝時間（分鐘），系統計算可預約時段時保留這段緩衝，
  不讓下一筆預約（不論服務項目）緊接著開始。

## 非目標

- **單日特殊營業時間覆寫**（例如「某天不是公休，但提早/延後打烊」）——已與人工確認本批次
  只支援「整天公休」，不支援單日時間覆寫。如未來需要，需另外評估資料表擴充（例如在
  `closed_dates` 之外允許 `open_time`/`close_time` 覆寫），留給本 Epic 更後續的批次。
- **服務項目編輯 UI**（新增/編輯服務項目、緩衝時間輸入介面）——已與人工確認：屬於「服務
  項目管理」Epic 尚未規劃／實作的範圍（`/admin/services` 目前仍是停用連結），本批次只完成
  `services.buffer_minutes` 欄位與計算邏輯，UI 留給該 Epic。緩衝時間本批次只能由具備
  service role 權限的維運人員直接改資料庫設定（或視需要擴充 seed script），這是明確接受
  的已知限制。
- **緩衝時間不改變 `appointments.end_at` 的實際紀錄語意，也不改變
  `appointments_no_overlap` exclusion constraint**——已與人工確認：緩衝時間純粹是
  `get_available_slots` RPC／後台改期表單在「計算可選時段」時的過濾條件，不是資料庫層級的
  衝突防護。因此存在理論上的競態風險：兩筆並發預約請求都各自通過「緩衝感知的可預約時段」
  檢查後才送出，資料庫的 exclusion constraint 只檢查實際起訖時間有沒有重疊、不知道緩衝的
  存在，理論上可能讓兩筆預約之間的間隔小於設定的緩衝時間（但不會真正重疊，仍受 exclusion
  constraint 保護不會撞期）。比照本專案既有的「單一設計師、低並發」網域假設（見
  `ai/context/decisions.md` 與 `business_hours` 無樂觀鎖的既有決策），判定為可接受風險，
  本批次不把緩衝時間也做成資料庫層級約束。
- 特殊公休日不設定日期上限（例如「只能設定未來 N 天內」）之外的額外防呆——沿用後台管理者
  是受信任內部使用者的既有假設，比照 `reschedule-slots.ts` 不套用顧客端 90 天視野限制的
  既有模式；僅擋過去日期（無實務意義）。
- 移除／取消特殊公休日不觸發受影響預約警告——移除公休日只會讓該天恢復成每週固定營業時間，
  不會讓任何既有預約變成不合法，不需要警告。
- 已有預約時段合法性的自動修復、自動改期或自動通知顧客——沿用第一批次已核准的既有非目標
  決策，本批次不變更。
- 特殊公休日的理由/備註欄位——本批次不做，維持與 `business_hours` 一致的最小可行設計
  （`closed_dates` 只有日期本身，不含文字說明）。
- 稽核紀錄、行動裝置版面——沿用既有非目標決策，本批次不變更。

## 使用者故事（User Stories）

| 故事 | 身為／我想要／以便 | 驗收標準 |
|---|---|---|
| 設定特殊公休日 | 身為設計師，我想要把特定日期（例如國定假日）標記為公休，以便處理不是每週固定重複的臨時公休 | 可在後台新增/移除特定日期的公休標記；新增時若該日期已有未來的既有預約（pending/confirmed/completed），顯示受影響預約警告，需二次確認才儲存；後台週曆、改期表單、顧客端可預約時段皆正確反映 |
| 設定服務的緩衝時間 | 身為設計師，我想要為特定服務項目設定結束後的緩衝分鐘數，以便預約之間保留整理/清潔的時間，不被下一筆預約緊接著排 | `services.buffer_minutes` 可儲存 0～120 的整數；`get_available_slots` RPC 與後台改期表單計算可預約時段時正確扣除緩衝區間；本批次不提供編輯 UI，只能透過資料庫直接設定 |

## 使用者旅程

```text
身為設計師，
我想要把下週三（國定假日）整天標記為公休，
以便讓顧客知道那天不開放預約，不用臨時打電話取消已預約的顧客而措手不及。

我登入後台、打開「營業時間」設定頁，在新增的「特殊公休日」區塊選擇下週三、點新增。
系統提示「下週三目前有 2 筆預約會受影響」，我看到清單後決定先電話聯絡這兩位顧客改期，
確認後再回來儲存公休設定；儲存後，後台週曆與改期表單都正確顯示下週三為公休，顧客端也
看不到下週三的可預約時段。
```

## 功能需求

- WHEN 設計師在特殊公休日區塊新增一個未來日期 THE SYSTEM SHALL 檢查該日期是否有未來的
  `pending`/`confirmed`/`completed` 預約，若有則顯示受影響預約警告，需二次確認才寫入
  `closed_dates`；若無受影響預約則直接儲存。
- WHEN 設計師嘗試新增一個過去的日期 THE SYSTEM SHALL 阻擋送出並顯示驗證錯誤。
- WHEN 設計師移除一個既有的特殊公休日 THE SYSTEM SHALL 直接刪除該列，不顯示警告。
- WHEN 後台週曆／改期表單／顧客端 `get_available_slots` RPC 判斷某日期是否可預約
  THE SYSTEM SHALL 同時檢查該日期是否存在於 `closed_dates`（命中即視為公休，優先於每週
  固定 `business_hours` 的判斷）。
- WHEN `get_available_slots` RPC 或後台改期表單計算某服務在某日的可預約時段
  THE SYSTEM SHALL 以「該服務的 `duration_minutes` + `buffer_minutes`」為準過濾候選時段，
  確保任兩筆預約（不分服務項目）之間的間隔不小於前一筆預約所屬服務的緩衝時間。
- WHEN 服務項目的 `buffer_minutes` 未設定 THE SYSTEM SHALL 視為 0（沿用現有無緩衝行為，
  對既有服務資料零風險，不需要資料回填）。

## 畫面

| 畫面 | 狀態 | 備註 |
|---|---|---|
| 營業時間設定（既有頁面，`/admin/business-hours`） | 新增「特殊公休日」區塊：預設（清單＋新增日期控制項）、新增中、受影響預約警告（沿用既有 ConfirmDialog 擴充模式）、錯誤、空狀態（尚無任何特殊公休日） | 沿用既有頁面與元件庫；UI 走 `ui-mockup-gate` 產出這個區塊的畫面狀態表與至少 2 個 mockup 變體（清單/新增控制項的呈現方式），等待人工選擇 |
| 後台週曆／改期表單（既有畫面） | 公休日判斷來源增加 `closed_dates` 查詢 | 既有畫面的資料來源異動，不是新畫面 |
| 服務項目編輯（緩衝時間欄位） | 不適用 | 本批次不做 UI，見「非目標」 |

## 資料與 API

- 輸入：
  - `closed_dates` 新資料表：`date`（primary key）欄位即代表該日期整天公休，無其他必要
    欄位（不含理由/備註，維持與 `business_hours` 一致的最小可行設計）。
  - `services.buffer_minutes`：新增 `int not null default 0` 欄位，check constraint
    `buffer_minutes >= 0 and buffer_minutes <= 120`（120 分鐘上限為合理防呆假設，避免
    誤設過大值導致服務永遠算不出可預約時段；非顧客端輸入，設計師/維運人員自行負責）。
- 輸出：
  - `get_available_slots` RPC 回傳值形狀不變（`AvailableSlot[]`），內部計算邏輯改變。
  - 特殊公休日的受影響預約清單沿用 `AffectedAppointment` 既有形狀（`id`／`customer_name`／
    `start_at`），不含電話等非必要個資，比照 TASK-019 既有模式。
- 驗證：`buffer_minutes` 的 check constraint 作為最終防線；`closed_dates.date` 只能是今天
  或未來日期。
- 錯誤：資料庫 constraint 違反時前端顯示通用友善訊息，不外洩原始 Postgres 錯誤內容，比照
  既有慣例。

## 安全性與隱私

- 身分驗證：沿用既有 `is_admin()` + authenticated 邊界。
- 權限：`closed_dates` 的 RLS policy 比照 `business_hours`——anon／authenticated 皆可讀
  （供顧客端 RPC 使用），只有 `is_admin()` 可寫；`services.buffer_minutes` 沿用 `services`
  表既有的 RLS 邊界（anon 只能讀 `is_active` 的服務，寫入需要 `is_admin()`，不因本批次新增
  欄位而改變既有 policy 結構）。
- 敏感資料：受影響預約警告沿用既有的最小化欄位模式，不外洩電話等資訊。
- 濫用情境：無新的 anon 可觸及寫入介面，風險與既有 Epic 一致。

## 驗收標準

- 設計師可在後台新增／移除特定日期的公休標記；新增時若有受影響的未來預約會顯示警告，
  需二次確認才儲存；沒有受影響預約則直接儲存；過去日期無法新增。
- 後台週曆、改期表單、顧客端 `get_available_slots` RPC 對特殊公休日的判斷一致，且優先於
  每週固定營業時間設定。
- 服務項目可設定 `buffer_minutes`（本批次透過資料庫直接設定，無 UI）；`get_available_slots`
  RPC 與改期表單計算可預約時段時正確扣除緩衝，任兩筆預約間隔不小於前一筆的緩衝設定。
- 既有測試（`test:rls`／`test:booking`／`test:admin-booking`／`test:business-hours`）重跑
  無回歸。

## 驗證計畫

- 單元測試：緩衝時間過濾邏輯（純函式，給定服務緩衝設定與既有預約時間，計算候選時段是否
  可用）；特殊公休日判斷邏輯（給定 `closed_dates` 與 `business_hours`，判斷某日期是否
  公休）。
- 整合測試：對真實 Supabase 專案驗證 `closed_dates` 的 RLS 邊界（anon 只能讀、寫入被拒）、
  `get_available_slots` RPC 對特殊公休日與緩衝時間的正確回應；比照 `test:business-hours`
  既有模式新增或擴充測試檔案，並重跑既有四組整合測試確認無回歸。
- E2E：Browser 工具桌面尺寸走查（新增／移除特殊公休日、受影響預約警告路徑、後台週曆同步
  反映）。
- 視覺：新增的「特殊公休日」區塊畫面狀態表涵蓋預設/新增中/警告確認態/錯誤/空狀態，比照
  design-craft 檢查表。
- 手動：確認顧客端 `get_available_slots` RPC 在設定緩衝時間後回傳正確間隔的可預約時段。
