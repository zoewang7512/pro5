# AI-Ready 任務卡

## Metadata

- 任務：營業時間與可預約時段管理 前後端串接驗證與端到端測試
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：營業時間與可預約時段管理
- 上層 User Story：全部（整合驗證，涵蓋設定每週固定營業時間 story 的完整驗收）
- 分軌：前後端串接
- 前置任務（dependsOn）：TASK-018, TASK-019, TASK-020
- 狀態：完成（Done，人工審核通過，2026-08-06）
- 風險等級：中（涵蓋 `business_hours` 寫入與受影響預約判定的整合驗證，會回頭確認顧客端
  `get_available_slots` RPC 行為不受意外影響；不涉及 anon 可觸及的新介面，風險與「預約
  管理後台」Epic 的 TASK-017 相當）

## 目標

建立並執行對真實 Supabase 專案的整合測試，驗證「營業時間與可預約時段管理」（本次範圍：
設定每週固定營業時間）整條路徑（檢視→編輯→受影響預約警告→儲存→顧客端與後台週曆正確
反映）符合 feature-spec 的驗收標準；並用 Browser 工具完成桌面尺寸的端到端走查。

## 情境包（Context Pack）

- 相關檔案：`app/admin/business-hours/`、`lib/admin/business-hours.ts`、
  `vitest.admin-booking.config.ts`（比照其命名與獨立執行模式，本卡新增對應的整合測試
  config）、`tests/admin-booking.integration.test.ts`（既有的 admin 整合測試模式：
  service role／anon／已登入 designer client 三種 client 的設置、`TEST_MARKER` 隔離、
  `afterAll` 清除失敗要 throw、恆真斷言要先用 service role 做正向確認、時間比較一律轉
  epoch 再比較，本卡的新測試檔案直接沿用同一套慣例）。
- 既有模式：比照 TASK-017 的 `npm run test:admin-booking` 模式——對真實 Supabase 專案跑的
  整合測試，獨立指令，不放進預設 `npm test`。
- 假設：無。
- 未知事項：無。
- 允許變更的檔案：`tests/business-hours.integration.test.ts`（新增）、
  `vitest.business-hours.config.ts`（新增，比照 `vitest.admin-booking.config.ts`）、
  `package.json`（新增 `test:business-hours` script）、`ai/context/project-map.md`
  （更新常用指令表，補上 `/admin/business-hours`、`lib/admin/business-hours.ts`、
  `test:business-hours` 指令）。
- 不得觸碰：`app/admin/`／`lib/admin/` 的功能邏輯（若測試中發現 bug，回頭修對應的
  TASK-018/019/020 範圍內程式碼，不在本卡順手改功能——但小的、範圍內的 bug 修正可以直接做
  並在完成證據中註明，比照「預約管理後台」Epic TASK-017 的既有做法）。

## 需求

- 整合測試涵蓋（對真實 Supabase 專案跑，測試資料於結束後清除）：
  - designer（`authenticated`＋`is_admin()`）呼叫 `getAllBusinessHours` 成功讀取七天設定；
    anon 只能讀（沿用既有 `"public read business hours"` policy，這是既有行為，重新確認
    沒有被本 Epic 意外收緊或放寬）。
  - designer 呼叫 `updateBusinessHours` 成功寫入；anon 呼叫被 RLS 拒絕（這是本 Epic 第一次
    讓 authenticated 角色對 `business_hours` 做直接寫入，需要重新確認 anon 邊界沒有被意外
    連帶放寬，比照 TASK-017 對 `appointments` 表做的同類邊界重新確認）。
  - `findAffectedAppointments` 對真實資料的正確性：建立一筆未來的 `pending` 預約，把該
    weekday 改成公休或縮小時段後，確認該筆預約被正確判定為受影響；不受影響的預約
    （落在新設定內）不應出現在清單中。
  - `updateBusinessHours` 寫入後，重新查詢 `business_hours` 確認資料確實生效；並手動驗證
    （或整合測試）顧客端 `get_available_slots` RPC 對新設定的回應行為正確（例如把某天設為
    公休後，該天回傳空陣列）。
- E2E／視覺走查：用 Browser 工具在桌面尺寸下跑一次完整流程（登入→開啟營業時間設定→編輯
  某天時間／切換公休→儲存成功路徑→觸發受影響預約警告的路徑→確認送出→回到後台週曆確認
  公休日顯示同步更新），對照 `screen-spec-營業時間設定.md` 的畫面狀態表。
- 更新 `ai/context/project-map.md`：補上本 Epic 的重要目錄與 `test:business-hours` 指令。

## 驗收標準

- `npm run test:business-hours` 全數通過，涵蓋上述讀取、寫入、受影響預約判定、RLS 邊界
  案例。
- `npm run test:rls`／`npm run test:booking`／`npm run test:admin-booking` 重跑通過，確認
  本 Epic 沒有造成既有測試回歸（`test:rls` 若仍受既有已知的時段碰撞問題影響，記錄為已知
  限制，不視為本卡回歸，比照 TASK-017 的既有處理方式）。
- Browser 工具在桌面尺寸下走查完整流程與至少一種警告路徑（受影響預約），畫面符合
  feature-spec 與 screen-spec 的畫面狀態表。
- `npx tsc --noEmit`／`npm run lint`／`npm run build`／`npm test`（預設）皆通過。
- feature-spec 的「驗收標準」章節逐條核對，全部打勾或明確記錄例外。

## 實作備註

- 沿用 TASK-013／TASK-017 審查中發現並修正的測試撰寫細節，不要重蹈同樣的問題：LIKE
  pattern 需要跳脫萬用字元、`afterAll` 清除失敗要 throw（且要分開嘗試多個刪除步驟，不能
  第一步失敗就中止導致後面殘留 PII）、RLS 拒絕的斷言要精確比對錯誤代碼或先確認底下確實有
  資料（避免恆真斷言）、涉及時間比較一律轉 epoch 再比較。
- `business_hours` 只有 7 列固定資料（以 `weekday` 為 primary key），整合測試對這張表的
  操作要用「測試前記錄原始 7 列、測試後還原」的模式清除，不能用 `TEST_MARKER` 前綴刪除
  （沒有可以掛前綴的欄位）——比照 `afterAll` 讀回並 `upsert` 原始快照的做法，並且要小心
  這是全域唯一一份設定，測試期間會暫時影響顧客端可預約時段判定，不要對正式環境高頻率
  重複執行。

## 驗證契約

- 單元測試：不適用（本卡聚焦整合／E2E，單元測試已在 TASK-018/019/020 涵蓋）。
- 整合測試：`npm run test:business-hours`（本卡負責建立與執行）；重跑
  `npm run test:rls`／`npm run test:booking`／`npm run test:admin-booking` 確認無回歸。
- E2E 測試：Browser 工具手動走查，桌面尺寸（見「需求」）。
- 型別檢查：`tsc --noEmit` 成功。
- Lint：`npm run lint` 成功。
- Build：`npm run build` 成功。
- 螢幕截圖：桌面尺寸完整流程走查（設定頁→編輯→警告→儲存成功→後台週曆同步）。
- 安全性檢查：anon 對 `business_hours` 的直接寫入皆被拒絕；受影響預約警告清單不包含電話
  等非必要個資；錯誤訊息不洩漏原始 Postgres 錯誤細節。

## 完成證據

- 變更的檔案：
  - `tests/business-hours.integration.test.ts`（新增，經 test-engineer／security-reviewer
    審查後修訂）：7 個測試案例，涵蓋讀取權限邊界（designer／anon 皆可讀）、寫入權限邊界
    （designer 成功寫入並還原；anon 被拒且資料不受影響、錯誤訊息不外洩 Postgres 細節；
    **已登入但非 `is_admin()` 的 authenticated 使用者**被拒且資料不受影響——這是
    security-reviewer 指出的關鍵補強：`business_hours` 對 `authenticated` 角色本身沒有整體
    `revoke`，唯一防線是 policy 的 `is_admin()` predicate，只測 anon 無法證明這道 predicate
    本身有效，需要額外自建一個拋棄式非管理員帳號（透過 service role 的
    `auth.admin.createUser`/`deleteUser`，測完即刪，不需要新的 `.env.local` 設定）才能真正
    驗證）、`findAffectedAppointments` 對真實預約資料的判定（縮小時段／整天公休／維持現狀
    三種情境，含已取消預約不列入、其他星期幾不受誤判影響、受影響清單每筆欄位皆最小化的
    驗證；改用貼近 `BusinessHoursForm.tsx` 實際呼叫形狀的完整 7 列 `newRows` 陣列，而非
    單列，對應 test-engineer 指出的真實性落差）、`get_available_slots` RPC 於公休/還原後的
    正確回應。另外把 `beforeAll` 記錄的原始 7 列快照印到終端機/CI log（test-engineer 指出
    `business_hours` 沒有 `TEST_MARKER` 式的事後復原路徑，程序被強制中斷時這份 log 是唯一
    能讓人工手動 `upsert` 還原的紀錄）。
  - `vitest.business-hours.config.ts`（新增）：比照 `vitest.admin-booking.config.ts`，獨立
    `include`，不放進預設 `npm test`。
  - `package.json`：新增 `test:business-hours` script。
  - `ai/context/project-map.md`：補上 `/admin/business-hours`、`BusinessHoursForm.tsx`、
    `lib/admin/business-hours.ts`、`test:business-hours` 指令的說明，以及四個整合測試檔案
    彼此的日期 offset 分配（避免未來新增第 4 個檔案時撞期）。
- 子代理審查：
  - test-engineer：approve with suggestions。快照還原機制在 vitest 生命週期下對「單一
    `it` 中途斷言失敗」是安全的（`afterAll` 仍會執行），但對「程序被強制中斷」沒有
    `TEST_MARKER` 式復原路徑——已補上快照 log。指出 `findAffectedAppointments` 三個子案例
    原本都只傳單一列 `newRows`，與正式呼叫（`BusinessHoursForm.tsx` 一律傳全部 7 列）形狀
    不符，未驗證「其餘未變動星期幾不受誤判影響」這個安全性質——已改用完整 7 列並新增對照
    組預約驗證。星期幾/日期 offset 無實際碰撞風險，僅建議集中記錄——已補進
    `project-map.md`。
  - security-reviewer：approve with suggestions。核心結論：無硬編碼密鑰、無 SQL/PostgREST
    injection 風險、PII 隔離與清除邏輯正確、anon 拒絕斷言是真實（非恆真）驗證。指出一項
    中度發現：只測 anon 無法涵蓋「已登入但非管理員」這個實際上唯一真正的授權邊界（`
    business_hours` 對 authenticated 角色沒有整體 revoke）——已新增對應測試（見上）。其餘
    低嚴重度建議（錯誤訊息斷言、避免探測值恆真、PII key-set 檢查涵蓋所有筆數、
    `signOut()` 與清除步驟收集模式不一致、`JSON.stringify(Error)` 遺失訊息內容）皆已採納
    修正。
- 執行過的指令：
  - `npx tsc --noEmit`（乾淨）
  - `npm run lint`（0 problems）
  - `npm run test:business-hours`（審查修正前 6/6 通過；套用審查建議後重跑 7/7 通過，對
    真實 Supabase 專案跑，測試前記錄 `business_hours` 原始 7 列快照並輸出到 log、測試後由
    `afterAll` 還原）
  - `npm run test:rls`（6/6 通過，無回歸，審查修正前後皆重跑確認）
  - `npm run test:booking`（19/19 通過，無回歸，審查修正前後皆重跑確認——這組測試假設週一
    至週六營業、週日公休的 seed 預設值，全數通過間接證明 `business_hours` 已正確還原）
  - `npm run test:admin-booking`（13/13 通過，無回歸，審查修正前後皆重跑確認）
  - `npx vitest run`（預設單元/煙霧測試，11 files / 75 tests 通過，數量與 TASK-020 完成時
    相同）
  - `npm run build`（成功，審查修正前後皆重跑確認）
  - 瀏覽器（Browser 工具）對真實 Supabase 專案桌面尺寸走查（登入 → 開啟營業時間設定 →
    切換週三為公休 → 送出偵測到 1 筆受影響預約並顯示警告 Modal（列出顧客姓名/日期/時段）
    → 點「再想想」確認資料庫未寫入、欄位維持使用者編輯內容不重置 → 再次送出、點「仍要
    儲存」確認資料庫確實寫入公休 → 切到 `/admin` 週曆確認週三正確顯示「· 公休」且既有
    預約卡片仍照常顯示（不隱藏資料）→ 改回週三 10:00–19:00 送出，因無受影響預約故直接
    儲存、未顯示警告 Modal → 確認資料已還原）。走查用的測試預約與腳本走查後即刪除，
    不留痕跡。
- 測試輸出：
  - `test:business-hours`：`Test Files 1 passed (1)` / `Tests 7 passed (7)`（審查修正後）
  - `test:rls`：`Test Files 1 passed (1)` / `Tests 6 passed (6)`
  - `test:booking`：`Test Files 1 passed (1)` / `Tests 19 passed (19)`
  - `test:admin-booking`：`Test Files 1 passed (1)` / `Tests 13 passed (13)`
  - 預設 `vitest run`：`Test Files 11 passed (11)` / `Tests 75 passed (75)`
- 螢幕截圖：沿用既有 Browser pane 限制（screenshot 逾時），改以 accessibility tree
  （`read_page`）／`get_page_text`／`javascript_tool` 讀取 DOM 與 dialog 內容取得對照證據
  （警告 Modal 文字內容、儲存前後 `business_hours` 資料庫實際值、週曆畫面文字）。
- feature-spec 驗收標準逐條核對：
  - 「設計師可在 `/admin/business-hours` 檢視並編輯七天的營業時間與公休狀態」：已核對
    （TASK-018/019 建立，本次 E2E 再次走查確認）。
  - 「打烊時間未晚於開店時間、或公休切回營業卻缺時間欄位時，前端擋下送出並顯示錯誤」：
    已核對（TASK-019 完成證據涵蓋，`tests/admin/business-hours.test.ts` 單元測試涵蓋）。
  - 「變更會影響未來已存在的預約時，送出前顯示警告列表且需二次確認才能儲存；沒有受影響
    預約時可直接儲存」：已核對（本次整合測試 + E2E 走查皆驗證受影響/不受影響兩種路徑）。
  - 「儲存成功後，顧客端可預約時段（`get_available_slots` RPC）與後台改期表單
    （`getBusinessHoursForWeekday`）依新設定正確反映」：`get_available_slots` 已核對（整合
    測試 + E2E）；`getBusinessHoursForWeekday` 本身未變動、直接查表，架構上不受影響，沿用
    既有 `tests/admin/reschedule-slots.test.ts` 測試覆蓋，本卡未另外新增整合測試（任務卡
    驗證契約只列 `get_available_slots` 需要整合/手動驗證）。
  - 「後台週曆／列表畫面的公休日顯示改為查詢 `business_hours`，不再使用寫死的
    `isClosedWeekday()` 邏輯」：週曆（`WeekCalendar.tsx`）已核對（TASK-020 + 本次 E2E）。
    **例外記錄**：`AppointmentListView.tsx`（列表檢視）核對後確認其本來就是純預約清單（依
    日期/時段/顧客/服務/狀態逐列顯示實際預約，沒有「每天一格」的版面結構），在本 Epic
    之前就沒有任何公休標示可供改查——feature-spec 該條驗收標準的「列表」字樣對列表畫面的
    實際結構而言不適用，不是遺漏未實作。已與 TASK-020 architect 審查記錄的殘留事項一致。
  - 「anon 無法直接寫入 `business_hours`（RLS 拒絕，整合測試重新確認邊界未被意外放寬）」：
    已核對（本次整合測試）。
- 已知限制：
  1. `getBusinessHoursForWeekday`（改期表單用）未新增專屬整合測試，僅沿用既有單元測試與
     架構上「直接查表、未變動」的推理確認，任務卡驗證契約本身也未要求新增。
  2. `AppointmentListView.tsx` 沒有公休標示，如上「feature-spec 驗收標準逐條核對」的例外
     記錄，屬既有結構限制，非本次未完成項目。
  3. `business_hours` 只有 7 列固定資料，本卡新增的整合測試以「記錄原始快照、測試後還原」
     模式操作真實表格，測試期間會短暫影響顧客端可預約時段判定，不應對正式環境高頻率重複
     執行（沿用 TASK-021 情境包已預先記錄的風險）。
  4. 螢幕截圖沿用既有 Browser pane 限制，改以 accessibility tree/get_page_text/
     javascript_tool 讀取取得驗證證據。
  5. TASK-020 完成證據記錄的既有殘留事項（跨分頁不即時同步、公休推導只看 `is_closed`
     未比照 null 時間的保守判斷、查詢失敗 fail-open）本卡未重新處理，維持原判定。
  6. security-reviewer 提出但未採納的操作面建議：本檔案沒有明確的「拒絕在正式環境執行」
     opt-in 防呆機制（例如額外的環境變數旗標），只靠測試前 `console.log` 快照留下人工復原
     紀錄。判定為不採納：三個既有的 sibling 整合測試檔案（`test:rls`／`test:booking`／
     `test:admin-booking`）皆為同一種風險框架（對真實 Supabase 專案跑、僅靠檔頭註解提醒不要
     高頻率對正式環境執行），本卡刻意維持與既有慣例一致，不引入這個檔案獨有的防呆機制；
     若要採用，應該是跨所有整合測試檔案的一致性決策，留給未來視需要另外評估。
- 後續任務：無（本次「設定每週固定營業時間」story 完成後，回頭視情況規劃
  `epics.json`「營業時間與可預約時段管理」Epic 剩餘的「設定公休日／特殊假期」「設定服務
  間的緩衝時間」story，另開新的一輪 spec-interrogation）。
