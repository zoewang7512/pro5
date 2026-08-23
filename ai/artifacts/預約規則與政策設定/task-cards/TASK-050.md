# AI-Ready 任務卡

## Metadata

- 任務：預約規則與政策設定 前後端串接驗證與端到端測試
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：預約規則與政策設定
- 上層 User Story：全部（整合驗證）
- 分軌：整合
- 前置任務（dependsOn）：TASK-046, TASK-047, TASK-048, TASK-049
- 狀態：完成（人工已於 2026-08-23 驗收通過）
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

詳見 `tools/kanban/cards/TASK-050.json` 的 `evidence` 欄位（commands／findings／residual）。
摘要：

- 變更的檔案：`ai/context/project-map.md`（更新，新增 `booking_policy`／`test:booking-policy`
  等說明）；`tests/booking-policy.integration.test.ts`（新增鎖定 anon 可讀欄位集合的
  斷言）；以下檔案因 security-reviewer 的 Epic 總覽性審查發現而回頭修正（見下方
  「審查」段落）：`tests/booking.integration.test.ts`（補快照 log、交叉引用註解）、
  `app/admin/_components/BookingPolicyForm.tsx`（新增超過 336 小時的非阻斷性警示）、
  `lib/booking-policy.ts`（`updateBookingPolicy` 補防禦性重跑驗證）、
  `supabase/migrations/0009_booking_policy_lead_time.sql`（補交叉引用註解）、
  `lib/booking/policy-text.ts`／`tests/lib/policy-text.test.ts`（修正「取消或改期」
  文案語意）、`ai/artifacts/預約規則與政策設定/feature-spec.md`／
  `mockup-decision-顧客前台政策說明.md`／`task-cards/TASK-047.md`／`TASK-048.md`／
  `TASK-049.md`（文件同步與追溯性記錄）。
- 執行過的指令：`npx tsc --noEmit`／`npm run lint`／`npm run build` 皆通過；
  `npx vitest run`（337/337，無回歸）；`npm run test:booking-policy`（7/7，含新增的
  欄位鎖定斷言）；`npm run test:booking`（23/23）；`npm run test:admin-booking`
  （13/13）；`npm run test:business-hours`（18/18）；`npm run test:rls`（6/6）；
  `npm run test:store-settings`（11/11）；`npm run test:services`（13/13）；
  `npm run test:account`（17/17）——以上皆重跑無回歸。
- 審查：依驗證契約要求派遣 security-reviewer 對整個 Epic（TASK-046～049 累積變更）
  做總覽性審查。判定跨卡組合未引入新的權限提升或資料外洩路徑；發現 1 項 MUST FIX
  （`tests/booking.integration.test.ts` 的 `booking_policy` 快照未印出，測試中斷會讓
  正式環境卡在「預約全滅」的數值且無法還原——已修正，補上 `console.log`）與 7 項
  NICE TO HAVE，已處理：欄位鎖定測試（防未來悄悄新增公開欄位）、force RLS 隱性約束的
  交叉引用文件化、`updateBookingPolicy` 防禦性重跑驗證、`TASK-048.md` 允許變更清單的
  追溯性補登；經人工核准後額外處理兩項原本標記為「留待決定」的發現：(1) 後台表單新增
  「最短提前預約時間超過顧客前台可見的 14 天範圍」非阻斷性警示；(2) 修正顧客前台
  「取消或改期」文案語意（原文案與後台說明文字語意相反），同步更新 `feature-spec.md`
  與 mockup-decision 的偏離紀錄。
- 測試輸出：見上方「執行過的指令」，整合測試涵蓋 `booking_policy` RLS 邊界＋欄位鎖定、
  提前量設定值對 `get_available_slots`／`create_appointment` 的影響（含公休日／緩衝
  時間組合案例）、既有八個整合測試套件重跑無回歸。
- 螢幕截圖：Browser 工具桌面尺寸走查完整流程——登入後台→「預約規則」頁儲存新數值
  （4 小時／48 小時）→顯示成功 Toast→切到顧客前台確認可選時段與政策文字皆正確反映
  新設定（「請於預約時段前 4 小時完成預約。請於預約時段前 48 小時以前完成取消或
  改期。」）→調回預設值（1／留空）確認資料庫已還原；另外驗證超過 336 小時的非阻斷性
  警示正確顯示且不阻擋儲存按鈕。本次 Browser 面板未顯示，`computer` 的 screenshot
  動作持續逾時失敗，以 `javascript_tool` 讀取 DOM 內容作為替代證據（與 TASK-047／049
  相同的已知限制）。
- 已知限制／殘留風險：
  - `booking_policy` 表不得啟用 `force row level security`（TASK-048 已記錄，本卡
    補上功能性迴歸偵測器的交叉引用文件化，無法直接斷言 `relforcerowsecurity`——
    PostgREST 只暴露 `public` schema）。
  - `cancel_window_hours` 目前只顯示、不強制執行（`feature-spec.md` 已核准的非目標），
    與 `lib/booking-policy.ts` 對查無資料一律視為錯誤的設計理由形成張力——待「顧客
    自助取消/改期」Epic 接上強制邏輯時應回頭核對顯示文字與實際行為是否一致。
  - `booking_policy` 沒有 `updated_by` 稽核欄位（與 `store_settings`／`business_hours`
    現況一致，非本 Epic 退步，但攻擊者取得管理員 session 後可透過這個欄位無症狀關閉
    整個預約功能且不留鑑識紀錄）——建議另立跨 Epic 的 backlog 任務，不在本卡處理。
  - 螢幕截圖缺口（Browser 面板未顯示），已用 DOM 驗證替代。
- 後續任務：無（本 Epic 三個 User Story 至此皆完整涵蓋）；殘留風險已如上登記，供後續
  Epic 或 backlog 任務參考。
