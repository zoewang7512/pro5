# AI-Ready 任務卡

## Metadata

- 任務：預約規則與政策設定 前後端串接驗證與端到端測試
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：預約規則與政策設定
- 上層 User Story：全部（整合驗證）
- 分軌：整合
- 前置任務（dependsOn）：TASK-046, TASK-047, TASK-048, TASK-049
- 狀態：已核准（2026-08-18），待前置任務 TASK-046～049 完成後轉就緒
- 風險等級：高（涵蓋 `create_appointment`／`get_available_slots` 核心 RPC 修改的整合
  驗證，比照 TASK-048 的風險等級判定）

## 目標

新增 `npm run test:booking-policy` 整合測試，涵蓋 `booking_policy` 的 RLS 邊界與調整
最短提前預約時間後 `get_available_slots`／`create_appointment` 的實際行為（含與既有
公休日、緩衝時間規則同時生效的組合案例）；重跑既有整合測試確認無回歸；Browser 工具
桌面尺寸 E2E 走查後台預約規則頁與顧客前台政策說明區塊的完整流程；更新
`project-map.md`。

## 情境包（Context Pack）

- 相關檔案：
  - `tests/business-hours.integration.test.ts`：最近一次涵蓋「調整設定值後 RPC 行為
    變化」的既有整合測試寫法（`buffer_minutes`／`closed_dates` 案例），本卡的最短提前
    預約時間驗證比照同樣的「記錄原始快照、測試中改動、afterAll 還原」模式。
  - `tests/booking.integration.test.ts`：`get_available_slots`／`create_appointment`
    既有的呼叫與斷言寫法。
  - `ai/context/project-map.md`：更新「常用指令」表新增 `test:booking-policy`，補充
    `booking_policy` 表與新增後台頁面的描述。
- 既有模式：
  - 各整合測試檔案用「離今天 N 天以上」的 offset 錯開彼此的日期範圍；本卡新增的
    `create_appointment`／`get_available_slots` 案例需依 `project-map.md` 記錄的既有
    offset 表挑選未使用的區段，避免撞期。
- 假設：
  - `booking_policy` 只有 1 列固定資料，測試採「記錄原始快照、測試中短暫改動、
    afterAll 還原」模式（同 `test:business-hours`）。
- 未知事項：無。
- 允許變更的檔案：
  - `tests/booking-policy.integration.test.ts`（新增）
  - `vitest.booking-policy.config.ts`（新增）
  - `package.json`（新增 `test:booking-policy` script）
  - `ai/context/project-map.md`（更新）
  - `ai/context/decisions.md`（若驗證過程發現需要記錄的架構決策）
- 不得觸碰：
  - 既有整合測試檔案的既有測試案例邏輯（僅執行重跑確認無回歸）。

## 需求

- 新增整合測試涵蓋：
  - `booking_policy` 寫入：管理員可成功寫入；anon／非管理員 authenticated 寫入被拒。
  - 調整 `min_lead_time_hours` 後 `get_available_slots`／`create_appointment` 的正確
    回應；與既有公休日（`closed_dates`）、緩衝時間（`buffer_minutes`）規則同時生效的
    組合案例（例如同時設定較長提前時間與公休日，兩種限制都要生效）。
  - `cancel_window_hours` 設定／未設定兩種情境下，顧客前台政策說明文案的正確性（可用
    元件測試或針對 `formatBookingPolicyText` 純函式的單元測試涵蓋，視實作階段判斷是否
    需要整合測試層級）。
- 重跑 `test:rls`／`test:booking`／`test:admin-booking`／`test:business-hours`／
  `test:store-settings`／`test:services`（若已存在），確認無回歸。
- Browser 工具桌面尺寸走查：後台預約規則頁設定兩個數值並儲存→切到顧客前台確認可選
  時段與政策說明文字皆正確反映→調回預設值確認恢復原本行為。

## 驗收標準

- `npm run test:booking-policy` 全數通過，對真實 Supabase 專案驗證 RLS 邊界與 RPC
  行為皆正確。
- 既有整合測試重跑無回歸。
- `npx tsc --noEmit`／`npm run lint`／`npm run build` 皆通過。
- Browser 工具走查完整流程無誤，並取得螢幕截圖或等效驗證證據。
- `project-map.md` 更新反映 `booking_policy`、後台預約規則頁與新增指令。

## 實作備註

- 比照既有慣例，測試日期／時段若涉及 `create_appointment` 測試案例，選擇未被其他
  整合測試檔案佔用的 offset 區段。
- 若 Browser 工具當下無法產生真正螢幕截圖，比照既有慣例改用 accessibility tree／
  `get_page_text` 驗證並記錄為已知限制。

## 驗證契約

- 單元測試：（若前置任務尚未涵蓋齊全）補齊遺漏的純函式測試。
- 整合測試：`npm run test:booking-policy`（新增）；重跑既有整合測試組。
- E2E 測試：Browser 工具桌面尺寸走查（見上方「需求」）。
- 型別檢查：`npx tsc --noEmit`
- Lint：`npm run lint`
- Build：`npm run build`
- 螢幕截圖：後台預約規則頁完整流程、顧客前台政策說明文字前後對照。
- 安全性檢查：本卡風險等級高，建議額外執行 `security-reviewer` 子代理對整個 Epic
  （TASK-046～049 累積的變更，特別是 TASK-048 對核心 RPC 的修改）做一次總覽性審查。

## 完成證據

- 變更的檔案：待實作後填寫。
- 執行過的指令：待實作後填寫。
- 測試輸出：待實作後填寫。
- 螢幕截圖：待實作後填寫。
- 已知限制：待實作後填寫。
- 後續任務：無（本 Epic 三個 User Story 至此皆完整涵蓋）。
