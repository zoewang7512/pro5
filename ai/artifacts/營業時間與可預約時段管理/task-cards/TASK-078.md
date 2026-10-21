# AI-Ready 任務卡

## Metadata

- 任務：營業時間與可預約時段管理 服務項目表單新增「緩衝時間」欄位（後台 UI）
- 上層規格：[`feature-spec.md`](../feature-spec.md)（「非目標」段落記錄緩衝時間當時只做資料層、不做 UI，本卡補上 UI）
- 上層 Epic：營業時間與可預約時段管理
- 上層 User Story：設定服務間的緩衝時間
- 分軌：前後端串接（後台表單＋`lib/admin/services.ts` 讀寫；資料欄位與時段計算已由 TASK-022／TASK-024 完成）
- 前置任務（dependsOn）：TASK-022, TASK-024, TASK-034, TASK-035
- 狀態：就緒（人工已於 2026-10-21 核准；排在多位設計師 Epic 之前）
- 風險等級：低（只新增一個既有欄位的編輯介面，不改 schema、不改 RPC；但設定值會立即影響前台可預約時段）
- Agent owner：Claude Code
- 人工核准者：使用者

## 目標

讓店長在後台「服務項目」的新增／編輯 Modal 設定每項服務的緩衝時間（0～120 分鐘），列表也看得到目前設定，
不用再直接改資料庫。

## 情境包（Context Pack）

- 相關檔案：
  - `supabase/migrations/0003_closures_and_buffer.sql:36-41`（`services.buffer_minutes int not null default 0`，
    check constraint `services_buffer_minutes_range` 限制 0～120）
  - `supabase/migrations/0009_booking_policy_lead_time.sql`（`get_available_slots` 的 buffer-aware 重疊判斷，本卡不動）
  - `lib/admin/reschedule-slots.ts`（後台改期已讀 `buffer_minutes`，本卡不動）
  - `lib/admin/services.ts`（`listServices`／`createService`／`updateService`／`validateServiceDuration`）
  - `app/admin/_components/ServiceFormDialog.tsx`（名稱／價格／時長／描述四欄位，價格與時長同一列）
  - `app/admin/_components/ServicesTable.tsx`（「時長」欄）
  - `lib/booking/types.ts`（`Service` 型別目前沒有 `buffer_minutes`，前後台共用）
  - `ai/artifacts/服務項目管理/screen-spec-服務項目管理.md`、`mockup-decision-服務項目管理.md`（已核准 Variant A）
  - `ai/context/decisions.md` TASK-022～027 決策（緩衝時間是排程偏好，不做資料庫層級約束，只影響候選時段過濾）
- 既有模式：驗證純函式放 `lib/admin/services.ts`，錯誤文案與資料庫 check constraint 對齊；`submitAttempted` 後才顯示欄位錯誤。
- 假設：
  - 欄位用數字輸入框（`TextField type="number"`），整數 0～120，預設 0；不做下拉選單。
  - 修改緩衝時間**不會**重新檢查既有預約（沿用 TASK-022 決策：緩衝是排程偏好，不是硬規則），只影響之後的
    可預約時段計算。表單 helper text 要讓店長知道這一點。
  - `Service` 型別新增 `buffer_minutes` 欄位；前台 `getServices` 的 select 不需要讀它（前台不顯示），所以前台
    型別改用 `Omit` 或讓欄位選填，二選一在實作時決定，原則是不讓前台多讀用不到的欄位。
- 未知事項：（UI 關卡已由人工於 2026-10-21 決定豁免 mockup 變體，見實作備註）
  - **UI 關卡**：這只是在已核准的 Variant A 表單加一個欄位，全部用既有 `TextField`。是否需要另外產出 2～3 個
    mockup 變體，或在既有 screen-spec 補一段並由人工確認豁免變體，需要人工決定（見下方「實作備註」的建議）。
- 允許變更的檔案：
  - `lib/admin/services.ts`（select／create／update 加 `buffer_minutes`、新增 `validateServiceBuffer`）
  - `lib/booking/types.ts`（`Service` 型別）
  - `app/admin/_components/ServiceFormDialog.tsx`
  - `app/admin/_components/ServicesTable.tsx`（只改「時長」欄的顯示文字）
  - `ai/artifacts/服務項目管理/screen-spec-服務項目管理.md`（狀態表與互動表補上緩衝欄位）
  - `ai/artifacts/營業時間與可預約時段管理/feature-spec.md`（非目標段落加註「已由 TASK-078 補上 UI」，不改原文）
  - `tests/admin/services.test.ts`、`tests/services.integration.test.ts`
- 不得觸碰：`get_available_slots`／`create_appointment`、`lib/admin/reschedule-slots.ts`、任何 migration；
  多位設計師 Epic 的 TASK-070 也會改 `ServicesTable.tsx`／`ServiceFormDialog.tsx`（新增服務的 Toast 文案），
  兩張卡**不得同時進行**，先完成的一張合併後，另一張再開始。

## 需求

- WHEN 店長開啟新增／編輯 Modal THE SYSTEM SHALL 顯示「緩衝時間（分鐘）」欄位，新增時預設 0，編輯時帶入目前值。
- WHEN 店長送出 THE SYSTEM SHALL 驗證為 0～120 的整數，錯誤文案：「緩衝時間需為 0～120 的整數分鐘」。
- helper text：「服務結束後保留的整理時間，這段時間不開放下一筆預約。修改後只影響之後的預約。」
- WHEN 列表顯示 THE SYSTEM SHALL 在「時長」欄顯示「60 分鐘」，緩衝大於 0 時顯示「60 分鐘＋緩衝 15」
  （緩衝部分用 `text.secondary`）。

## 驗收標準

- 新增與編輯都能設定緩衝時間，重新整理後保留。
- 非法值（負數、小數、> 120、空白）前端擋下；直接打 API 也會被資料庫 check constraint 拒絕。
- 設定 30 分鐘緩衝後，前台該服務相鄰時段依既有 `get_available_slots` 邏輯被排除（證明串接到既有計算）。
- 既有服務項目管理功能（新增、編輯、下架、重新上架）回歸正常。

## 實作備註

- UI 關卡建議：豁免 mockup 變體，在 `screen-spec-服務項目管理.md` 補一段「TASK-078 新增欄位」並請人工在核准本卡時
  一併確認。理由：只新增一個既有元件欄位，不改版型，變體之間不會有實質差異。若人工不同意，改為產出 2 個變體
  （欄位放在「價格／時長」同一列 vs 獨立一列）。
- 欄位位置建議放在「時長」右邊同一列（三欄），與時長語意相鄰。

## 驗證契約

- 單元測試：`validateServiceBuffer` 邊界值（-1、0、120、121、1.5、空字串）；表單送出帶入 `bufferMinutes`。
- 整合測試：`npm run test:services` 新增「admin 可寫入 buffer_minutes」「121 被 check constraint 拒絕」。
- E2E 測試：Browser 走查編輯服務設定緩衝 30 → 列表顯示 → 前台選該服務確認時段變化。
- 型別檢查：`npx tsc --noEmit`
- Lint：`npm run lint`
- Build：`npm run build`
- 螢幕截圖：新增 Modal（預設、驗證錯誤）、列表（有緩衝與無緩衝）、暗色模式。
- 安全性檢查：不適用（沿用既有 `services` 的 RLS 與 GRANT，`authenticated` 已有 update 權限）。

## 完成證據

- 變更的檔案：
  - `lib/admin/services.ts`（select／create／update 加 `buffer_minutes`、新增 `validateServiceBuffer`）
  - `lib/booking/types.ts`（新增 `AdminService = Service & { buffer_minutes }`）
  - `app/admin/_components/ServiceFormDialog.tsx`、`ServicesTable.tsx`
  - `tests/admin/services.test.ts`、`tests/services.integration.test.ts`
  - `ai/artifacts/服務項目管理/screen-spec-服務項目管理.md`、`ai/artifacts/營業時間與可預約時段管理/feature-spec.md`
- 執行過的指令：`npx tsc --noEmit`、`npm run lint`、`npm test`、`npm run test:services`、`npm run build`
- 測試輸出：tsc／lint／build 通過；`npm test` 44 檔 496 項通過；`npm run test:services` 17 項通過（含新增 4 項）
- 螢幕截圖：Browser 走查已執行（預設 0、121 驗證錯誤、新增 30 後列表、編輯帶入值）；截圖僅在 session 內，未存檔，亮色模式未截
- 已知限制：
  - 前台型別未改：選擇新增 `AdminService` 型別（`Service` 加上 `buffer_minutes`），而非卡片所列 `Omit`／選填二選一，前台 `getServices`／`Service` 完全不動，不多讀用不到的欄位。
  - `validateServiceBuffer` 接收原始字串（卡片驗證契約要求涵蓋空字串；`Number("")` 會變 0 而漏判）。
  - helper text 以欄位下方一行 caption 呈現，不放在欄位內，避免三欄窄欄內折成多行。
  - Modal 寬度由 `xs` 調為 `sm` 以容納三欄。
- 後續任務：與 TASK-070 同檔案（`ServicesTable.tsx`／`ServiceFormDialog.tsx`），本卡合併後才能開始 TASK-070。
