# AI-Ready 任務卡

## Metadata

- 任務：營業時間與可預約時段管理 第二批次前後端串接驗證與端到端測試
- 上層規格：[`feature-spec.md`](../feature-spec.md)（第二批次）
- 上層 Epic：營業時間與可預約時段管理
- 上層 User Story：全部（整合驗證，涵蓋「設定公休日／特殊假期」「設定服務間的緩衝時間」
  兩個 story 的完整驗收）
- 分軌：前後端串接
- 前置任務（dependsOn）：TASK-024, TASK-025, TASK-026
- 狀態：完成
- 風險等級：中（涵蓋 `closed_dates` 寫入、`services.buffer_minutes` 對可預約時段計算的
  整合驗證，會回頭確認顧客端 `get_available_slots` RPC 行為不受意外影響；不涉及 anon 可
  觸及的新介面，風險與第一批次 TASK-021 相當）
- Agent owner：claude
- 人工核准者：使用者，2026-08-07（「沒問題」）

## 目標

建立並執行對真實 Supabase 專案的整合測試，驗證「設定公休日／特殊假期」「設定服務間的
緩衝時間」兩個 story 的整條路徑符合 feature-spec 的驗收標準；並用 Browser 工具完成桌面
尺寸的端到端走查。

## 情境包（Context Pack）

- 相關檔案：`tests/business-hours.integration.test.ts`（TASK-021 已建立，本卡在同一個
  檔案裡擴充新的 `describe` 區塊，不新增另一個測試檔案——`closed_dates`／
  `services.buffer_minutes` 與 `business_hours` 屬於同一個整合測試涵蓋範圍，繼續沿用同一套
  client 設置與清理慣例）、`vitest.business-hours.config.ts`（不需要修改，`include` 已經
  指向這個測試檔案）。
- 既有模式：`tests/business-hours.integration.test.ts` 既有的三種 client（service
  role／anon／designer）設置、`TEST_MARKER` 隔離、`afterAll` 清除失敗要 throw（且分開嘗試
  多個刪除步驟）、恆真斷言要先用 service role 做正向確認、時間比較一律轉 epoch 再比較、
  `business_hours` 快照還原模式——本卡新增的測試沿用同一套慣例，並延伸出 `closed_dates`
  自己的快照還原（`closed_dates` 沒有固定 7 列，是任意筆數，還原策略是「測試前記錄原始
  全部列、測試後刪除本次測試新增的列、不動測試前就已存在的列」，比照
  `TEST_MARKER`-like 的做法但改用「本次測試新增的日期」作為識別，而非資料庫欄位前綴
  （`closed_dates` 沒有可以掛 `TEST_MARKER` 前綴的文字欄位）。
- 假設：無。
- 未知事項：無。
- 允許變更的檔案：`tests/business-hours.integration.test.ts`（擴充）、
  `ai/context/project-map.md`（更新，補上 `closed_dates`／`buffer_minutes` 相關說明）、
  `ai/context/decisions.md`（新增一則決策紀錄：緩衝時間不做資料庫層級約束的取捨，內容
  整理自 feature-spec.md 的非目標段落，格式比照既有決策紀錄的範本）。
- 不得觸碰：`app/admin/`／`lib/admin/`／`supabase/migrations/` 的功能邏輯（若測試中發現
  bug，回頭修對應的 TASK-022～026 範圍內程式碼，不在本卡順手改功能——但小的、範圍內的
  bug 修正可以直接做並在完成證據中註明，比照第一批次 TASK-021 的既有做法）。

## 需求

- 整合測試擴充（對真實 Supabase 專案跑，測試資料於結束後清除）：
  - designer 可讀寫 `closed_dates`（新增／移除）；anon 只能讀、寫入被拒（重新確認邊界）；
    已登入但非 `is_admin()` 的 authenticated 使用者寫入也被拒（比照 TASK-021 對
    `business_hours` 新增的同類測試，`closed_dates` 同樣是這批次第一次讓 authenticated
    對這張新表直接寫入，需要同樣的邊界確認）。
  - `findAffectedAppointmentsForClosedDate` 對真實資料的正確性：建立一筆未來的
    `pending` 預約在某個未被標記的日期，呼叫該函式確認回傳包含這筆預約；不同日期的預約
    不應出現在清單中；已取消的預約不應出現在清單中。
  - `get_available_slots` RPC 對 `closed_dates` 的回應：把某天標記為特殊公休日後，該天
    回傳空陣列；移除標記後恢復正常（比照 TASK-021 對 `business_hours` 公休的既有測試
    模式）。
  - `get_available_slots` RPC 對 `buffer_minutes` 的回應：建立一個 `buffer_minutes = 30`
    的測試服務與一筆既有預約，確認緊接在該預約結束後 30 分鐘內的候選時段不會出現在可
    預約清單中，30 分鐘之後的時段正常出現；`buffer_minutes = 0`（未設定緩衝）的既有服務
    行為不受影響。
  - 後台改期表單（`computeAvailableSlots`）與 RPC 對同一組公休日／緩衝時間輸入產生一致
    的可預約時段判斷（至少一組案例交叉驗證兩者結果相同）。
- E2E／視覺走查：用 Browser 工具在桌面尺寸下跑一次完整流程（登入→開啟營業時間設定→在
  特殊公休日區塊點選月曆新增一天→觸發受影響預約警告的路徑（先建立測試預約）→確認送出
  →回到後台週曆確認該天公休顯示同步更新→移除該天→週曆恢復正常），對照
  `screen-spec-營業時間設定.md` 的畫面狀態表。
- 更新 `ai/context/project-map.md`：補上 `closed_dates`／`services.buffer_minutes`／
  `MonthPicker`／`lib/admin/closed-dates.ts`／`lib/admin/month-range.ts` 的說明。
- 新增 `ai/context/decisions.md` 條目：記錄「緩衝時間不做資料庫層級約束、只在
  `get_available_slots`／改期表單做候選時段過濾」的決策與理由（整理自 feature-spec.md
  非目標段落已記錄的推理，格式比照既有決策條目）。

## 驗收標準

- `npm run test:business-hours` 全數通過，涵蓋上述新增的讀取、寫入、受影響預約判定、RLS
  邊界、`buffer_minutes` 案例。
- `npm run test:rls`／`npm run test:booking`／`npm run test:admin-booking` 重跑通過，確認
  本批次沒有造成既有測試回歸。
- Browser 工具在桌面尺寸下走查完整流程與受影響預約警告路徑，畫面符合 feature-spec 與
  screen-spec 的畫面狀態表。
- `npx tsc --noEmit`／`npm run lint`／`npm run build`／`npm test`（預設）皆通過。
- feature-spec 第二批次的「驗收標準」章節逐條核對，全部打勾或明確記錄例外。

## 實作備註

- 沿用 TASK-013／TASK-017／TASK-021 審查中發現並修正的測試撰寫細節，不要重蹈同樣的
  問題：LIKE pattern 需要跳脫萬用字元、`afterAll` 清除失敗要 throw（且要分開嘗試多個
  刪除步驟）、RLS 拒絕的斷言要精確比對錯誤代碼或先確認底下確實有資料（避免恆真斷言）、
  涉及時間比較一律轉 epoch 再比較、寫入結果驗證不能只看 `error` 是否為 null（RLS 阻擋可能
  回傳成功但空結果）。
- TASK-021 審查（security-reviewer）指出的「anon 測試不足以涵蓋唯一真正授權邊界」教訓
  本卡直接沿用：`closed_dates` 的寫入測試一開始就要包含「已登入非管理員」案例，不要等
  審查再補。
- `buffer_minutes` 的測試需要建立一個獨立的測試服務（而非重用既有種子服務），設定
  `buffer_minutes = 30`，測試結束後這個服務隨 `afterAll` 清除，不影響正式服務資料。

## 驗證契約

- 單元測試：不適用（本卡聚焦整合／E2E，單元測試已在 TASK-022～026 涵蓋）。
- 整合測試：`npm run test:business-hours`（本卡負責擴充）；重跑 `npm run test:rls`／
  `npm run test:booking`／`npm run test:admin-booking` 確認無回歸。
- E2E 測試：Browser 工具手動走查，桌面尺寸（見「需求」）。
- 型別檢查：`tsc --noEmit` 成功。
- Lint：`npm run lint` 成功。
- Build：`npm run build` 成功。
- 螢幕截圖：桌面尺寸完整流程走查（特殊公休日設定→警告→儲存成功→後台週曆同步）。
- 安全性檢查：anon 與非管理員 authenticated 對 `closed_dates` 的直接寫入皆被拒絕；受影響
  預約警告清單不包含電話等非必要個資；錯誤訊息不洩漏原始 Postgres 錯誤細節。

## 完成證據

- 變更的檔案：
  - `tests/business-hours.integration.test.ts`（擴充，新增 10 個測試案例：closed_dates
    讀寫邊界 5 個、findAffectedAppointmentsForClosedDate 1 個、get_available_slots 對
    closed_dates 1 個、對 buffer_minutes 2 個、後台改期表單與 RPC 交叉驗證 1 個）
  - `ai/context/project-map.md`（補上 closed_dates／buffer_minutes 說明、test:business-hours
    描述更新、日期 offset 錯開規則更新）
  - `ai/context/decisions.md`（新增「緩衝時間不做資料庫層級約束」決策條目）
- 執行過的指令：`npx tsc --noEmit`／`npm run lint`／`npm test`（102 tests）／
  `npm run test:business-hours`（18 tests，對真實 Supabase 專案）／`npm run test:rls`
  （6 tests）／`npm run test:booking`（19 tests）／`npm run test:admin-booking`
  （13 tests）／`npm run build`，皆通過，其餘三組整合測試無回歸。
- 子代理審查：security-reviewer 首輪發現 5 項問題（1 項 Medium 是真實資料損毀風險——測試
  日期理論上可能撞到設計師已設定的正式公休日並永久刪除，審查時實測確認 offset 落在
  2026-10-10 國慶日，並非理論疑慮）、test-engineer 首輪發現交叉驗證測試只驗證了緩衝為零的
  平凡情況；皆已修正並重新驗證通過。詳見 `tools/kanban/cards/TASK-027.json` 的
  `evidence.findings`。
- 瀏覽器互動走查：登入設計師帳號，完整跑過一輪「建立測試預約 2026-08-20 → 於
  `/admin/business-hours` 標記公休 → 受影響預約警告出現 → 確認送出 → `/admin` 週曆同步
  顯示公休 → 移除公休標記 → 週曆恢復正常 → 取消測試預約」，全程用 accessibility tree／
  `get_page_text` 確認正確。
- 螢幕截圖：`/admin/business-hours` 預設畫面（含營業時間表格＋特殊公休日月曆／清單）為本次
  工作階段實際拍攝；受影響預約警告 Modal、後台週曆標記前後對照兩張沿用 TASK-026 驗證階段
  拍攝的既有截圖（該部分 UI 程式碼本卡未變更）。
- 已知限制：
  1. 兩張截圖（警告 Modal、週曆前後對照）沿用 TASK-026 既有截圖，非本卡工作階段新拍。
  2. Browser 工具的點擊互動在本卡驗證後段完全失去反應（換分頁、重新整理、重新登入皆
     無效），與先前 TASK-023/025/026 記錄的 screenshot 逾時是不同的失效模式；核心 E2E
     流程已在失去反應前完整驗證成功，未完成的只有「額外補拍一張警告 Modal 新截圖」這個
     加分項；受影響的測試預約已改用 service role 直接更新 status=cancelled 清除。
- 後續任務：無（本次「營業時間與可預約時段管理」Epic 的四個 User Story 全數完成後，Epic
  視為完成，回頭更新 `tools/kanban/epics.json` 的完成度）。
