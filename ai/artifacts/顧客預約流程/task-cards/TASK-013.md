# AI-Ready 任務卡

## Metadata

- 任務：顧客預約流程 前後端串接驗證與端到端測試
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：顧客預約流程
- 上層 User Story：涵蓋全部三個 User Story 的端到端驗收
- 分軌：前後端串接
- 前置任務（dependsOn）：TASK-011, TASK-012
- 狀態：完成，已人工驗收（2026-08-05；TASK-012 已核准，前置條件滿足；架構／安全性 agent
  審查皆已通過並修正發現項目，使用者確認完成證據無問題）
- 風險等級：高（涵蓋併發衝突與 RLS 邊界的安全性驗證，屬於 feature-spec 高風險判定的驗收
  範圍）
- Agent owner：待指定
- 人工核准者：使用者，2026-08-05

## 目標

建立並執行 `npm run test:booking` 整合測試套件，驗證顧客預約流程整條路徑（服務列表→選
時段→填資訊→成功頁）符合 feature-spec 的驗收標準，特別是併發衝突防護、顧客去重正確性、
RLS 邊界未被打開；同時重跑既有 `npm run test:rls` 確認 TASK-010 撤銷舊 policy 沒有造成
未預期的回歸；並補齊 E2E 走查證據。

## 情境包（Context Pack）

- 相關檔案：`app/page.tsx`、`lib/booking/`、`supabase/migrations/0002_booking_flow.sql`、
  `vitest.integration.config.ts`（比照 `test:rls` 模式）、
  `ai/artifacts/顧客預約流程/feature-spec.md` 的「驗收標準」「驗證計畫」章節（已依三方
  審查發現修正，是本卡測試案例的權威來源）、`tests/rls.integration.test.ts`（TASK-010
  已同步更新斷言，本卡負責重跑確認）。
- 既有模式：比照 TASK-003 的 `npm run test:rls` 模式——對真實 Supabase 專案跑的整合測試，
  獨立 `npm run test:booking` 指令，不放進預設 `npm test`。
- 假設：無。
- 未知事項：無。
- 允許變更的檔案：`tests/booking.integration.test.ts`（新增）、`vitest.integration.config.ts`
  或新增對應 config、`package.json`（新增 `test:booking` script）、
  `ai/context/project-map.md`（更新常用指令表，補上 `test:booking`）。
- 不得觸碰：`app/page.tsx` 的功能邏輯（若測試中發現 bug，回頭修對應的 TASK-010/011/012
  範圍內程式碼，不在本卡順手改功能——但小的、範圍內的 bug 修正可以直接做並在完成證據中
  註明，比照 TASK-003 Phase 8 的做法）。

## 需求

- 整合測試涵蓋（皆對真實 Supabase 專案跑，測試資料於結束後清除，比照 `test:rls` 模式）：
  - `get_available_slots` 對「已佔用」「非營業時間」「空閒」「超出 90 天視野」四種情況
    回傳正確結果。
  - `create_appointment` 成功建立預約、正確關聯 `customer_id`（同 phone 兩次呼叫關聯同一
    `customer_id`；phone 命中既有顧客 A、email 另外命中不同顧客 B 時，以 A 為準且不覆寫
    A 的既有欄位——見 feature-spec「功能需求」的去重衝突規則）。
  - 併發衝突防護：至少 3-5 個並發 `create_appointment` 請求搶同一時段，重複跑至少 3 輪，
    每輪都斷言恰好一筆成功、其餘回傳 `SLOT_CONFLICT`（多輪重複驗證，避免單次僥倖通過
    掩蓋競態問題）。
  - Exclusion constraint 邊界測試（與併發測試分開、獨立案例）：時段恰好相鄰（如
    10:00-10:30 與 10:30-11:00）兩者皆應成功；重疊 1 分鐘應被拒絕。
  - 提前量／視野上限：時段早於「現在＋1 小時」或晚於「現在＋90 天」應回傳
    `VALIDATION_ERROR`。
  - 同號碼預約數上限：同一電話第 4 筆 `pending` 預約應回傳 `BOOKING_LIMIT_EXCEEDED`。
  - anon 直接對 `appointments`／`customers` 下 `select`/`insert`/`update` 皆被 RLS 拒絕
    （確認 TASK-010 的 RPC 沒有意外開放更寬的存取，且舊 policy 已確實撤銷）。
- 重跑既有 `npm run test:rls`，確認 TASK-010 撤銷舊 policy 與新增 exclusion constraint
  沒有造成其他既有案例（如 TASK-003 的設計師登入／權限測試）回歸失敗。
- E2E／視覺走查：用 Browser 工具在**行動裝置尺寸**（375-414px）跑一次完整流程（服務
  列表→選時段→填資訊→成功頁），並跑一次典型錯誤路徑（時段衝突、驗證失敗），對照 S5
  mockup 與 feature-spec 的畫面狀態表。
- 更新 `ai/context/project-map.md`：補上 `business_hours`／新 RPC 的說明、`test:booking`
  指令、`seed:booking` 指令。

## 驗收標準

- `npm run test:booking` 全數通過，涵蓋上述併發（多輪）／邊界／去重／視野／上限／RLS
  邊界案例。
- `npm run test:rls` 重跑通過，確認無回歸。
- Browser 工具在行動裝置尺寸下走查完整流程與至少一種錯誤路徑，畫面符合 feature-spec 的
  「畫面」狀態表。
- `npx tsc --noEmit`／`npm run lint`／`npm run build`／`npm test`（預設）皆通過。
- feature-spec 的「驗收標準」章節逐條核對，全部打勾或明確記錄例外。

## 實作備註

- 併發測試建議用 `Promise.all` 同時發出多個 `create_appointment` 請求打向真實 Supabase
  專案，斷言恰好一個成功、其餘回傳 `SLOT_CONFLICT`；多輪執行降低「網路層意外序列化掩蓋
  競態問題」的 false negative 風險。測試資料需在測試結束後清除（比照 TASK-003 `test:rls`
  的清除機制）。

## 驗證契約

- 單元測試：不適用（本卡聚焦整合／E2E，單元測試已在 TASK-011/012 涵蓋）。
- 整合測試：`npm run test:booking`（見「需求」，本卡負責建立與執行，非 TASK-010）；重跑
  `npm run test:rls` 確認無回歸。
- E2E 測試：Browser 工具手動走查，行動裝置尺寸（見「需求」）。
- 型別檢查：`tsc --noEmit` 成功。
- Lint：`npm run lint` 成功。
- Build：`npm run build` 成功。
- 螢幕截圖：行動裝置尺寸完整流程走查（服務列表→選時段→填資訊→成功頁）與至少一種
  錯誤路徑。
- 安全性檢查：anon 對 `appointments`／`customers` 的直接讀寫皆被拒絕（含撤銷後的舊
  policy）；個資不出現在 log／URL；`create_appointment` 回傳值為回顯輸入而非資料庫既有
  顧客記錄（見 feature-spec 的 PII 列舉風險防範）。

## 完成證據

- 變更的檔案：
  - `tests/booking.integration.test.ts`（新增：19 個整合測試案例，見「需求」逐項對應）
  - `vitest.booking.config.ts`（新增：`test:booking` 專用 config，只 include 這個檔案）
  - `vitest.integration.config.ts`（收斂：`include` 從萬用字元 `tests/**/*.integration.test.ts`
    改成只點名 `tests/rls.integration.test.ts`，避免 `test:rls`／`test:booking` 兩個獨立
    指令互相撿到對方的測試檔案）
  - `package.json`（新增 `test:booking` script）
  - `ai/context/project-map.md`（補上 `lib/booking/`／`app/_components/booking/`／
    `app/page.tsx` 目錄說明、`test:booking` 指令列，並記錄 exclusion constraint 全域
    不分服務、測試期間會暫時佔用真實時段的注意事項）
- 執行過的指令：
  - `npx tsc --noEmit` — 通過
  - `npm run lint` — 通過
  - `npm test`（預設）— 34/34 通過，確認 `tests/booking.integration.test.ts` 未被
    預設 `npm test` 撿到（`vitest.config.ts` 排除 `*.integration.test.ts`）
  - `npm run build` — 通過
  - `npm run test:booking` — 連續執行 5 次（含套用審查發現修正前後），最終版本
    穩定 19/19 通過（詳見「測試輸出」）；每次執行後皆用 service role 查詢
    `services`／`customers`／`appointments` 三表確認無 `__TEST__` 前綴的殘留資料
  - `npm run test:rls` — 6/6 通過，確認 TASK-010 撤銷舊 policy／新增 exclusion
    constraint 沒有造成回歸
  - Browser 工具（行動裝置 375×812）對本機 `npm run dev` 連線真實 Supabase 專案完整
    走查：
    - 服務列表 → 選時段（頭皮護理／週五 8/7／15:00）→ 填寫資訊（陳大文／
      0987654321）→ 送出 → 成功頁正確顯示摘要
    - 錯誤路徑：選定染髮設計／週二 8/11／12:00 並填好表單後，用一支獨立的
      node inline script（`node --env-file=.env.local --input-type=module -e "..."`，
      直接呼叫 anon `create_appointment` RPC）搶先佔用同一時段模擬真實並發搶單，
      再送出瀏覽器裡的表單；在同一個 JS 執行內以 100ms 輪詢方式擷取
      Snackbar／Alert，436ms 內量到 Toast 文字「很抱歉，這個時段剛被別人預約
      走了，請重新選擇時段。」，且欄位值（張美玲／0977777777）未被清空
    - 過程中一度用「連續多個工具呼叫後才查詢」的方式找 Toast 找不到，排查後
      確認是 Toast 4 秒 `autoHideDuration` 加上多次工具往返延遲，在我查詢前就
      已自動關閉，不是功能缺陷；改用單一 script 內輪詢後穩定量到
    - 手動驗證完成後，用 service role 清除本次走查建立的 fixture／race 測試資料
      （`__RACE__` 前綴與陳大文／王小美等具名測試資料），確認正式專案下不留殘留
- 測試輸出：`npm run test:booking` 19/19 通過，涵蓋：
  - `get_available_slots`：已佔用／非營業時間／空閒（18 格）／超出 90 天視野，共 4 案例
  - `create_appointment` 成功建立與顧客去重：基本成功回顯、同 phone 兩次同一
    `customer_id`、phone 命中 A／email 命中 B 時以 A 為準且不覆寫 A（含防列舉斷言：
    回傳的 `customer_name` 是本次請求值，不是資料庫裡 A 的既有姓名），共 3 案例
  - 併發衝突防護：3 輪、每輪 4 個並發請求搶同一時段，恰好 1 筆成功、其餘皆為
    `SLOT_CONFLICT`，共 3 案例
  - Exclusion constraint 邊界：相鄰時段兩者皆成功、重疊 1 分鐘被拒絕，共 2 案例
  - 提前量／視野上限：早於 1 小時、晚於 90 天皆為 `VALIDATION_ERROR`，共 2 案例
  - 同號碼上限：第 4 筆 `BOOKING_LIMIT_EXCEEDED`，共 1 案例
  - RLS 邊界：select（先驗證底下確實有資料，非恆真）、insert（精確比對
    `42501 insufficient_privilege` 且確認無資料寫入）、update（RLS 阻擋回傳空結果
    非拋錯）、delete（RLS 阻擋不會真的刪除），共 4 案例
  - `npm test` 34/34 通過；`npm run test:rls` 6/6 通過
- 螢幕截圖：本次驗證環境的 Browser 工具面板未於使用者端顯示，無法取得像素截圖；改用
  `read_page`／`get_page_text`／直接 DOM 查詢（含在單一 script 內輪詢擷取 Toast 文字）
  逐狀態驗證，見上「執行過的指令」。已驗證：完整成功路徑（服務列表→選時段→填資訊→
  成功頁）與 `SLOT_CONFLICT` 錯誤路徑（含 Toast 文字、欄位不清空）。
- 已知限制：
  - **架構／安全性 agent 審查發現與處理**：本卡完成後依 `ai/process/review-gates.md`
    對高風險任務的要求，分別請 architect／security-reviewer agent 審查
    `tests/booking.integration.test.ts`。發現並已修正：
    1.（architect）同號碼上限測試原本用 08:00/09:00（落在營業時間外），雖然
       `create_appointment` 本來就不檢查營業時間所以測試仍會通過，但等於把「未驗證
       的行為」寫死成測試預期；已改成 10:00/10:30/11:00/11:30 對齊營業時間與 30
       分鐘格點。
    2.（architect）`afterAll` 清除 customers 時的 `like` pattern 未跳脫 `TEST_MARKER`
       裡的 `_`（LIKE 萬用字元），已補上 `escapeLikePattern` 精確跳脫。
    3.（architect）`appointments_no_overlap` 是不分服務的全域 exclusion constraint，
       測試期間會暫時佔用真實時段；已把日期池從「今天+3天」改成「今天+70天」
       （接近 90 天視野上限，真實顧客提前這麼久預約機率低很多），並在
       `project-map.md` 加註「不要對正式環境高頻率重複執行」。這是設計上的
       殘留風險，不是本卡能完全消除的問題（根源在 TASK-010 已核准的全域
       constraint 設計）。
    4.（security-reviewer）phone/email 去重防列舉的測試原本只斷言 `ok:true`，沒有
       實際比對回傳的 `customer_name` 是否為請求值而非既有顧客 A 的姓名——已補上
       明確斷言，避免「RPC 改成回傳既有顧客資料」這種真實的 PII 列舉迴歸在測試
       裡也會綠燈通過。
    5.（security-reviewer）anon insert 被拒的斷言原本只比對「有 error」，換成任何
       欄位驗證錯誤也會誤判通過；已改成精確比對 Postgres 錯誤代碼
       `42501`（insufficient_privilege），並比照 `tests/rls.integration.test.ts`
       的既有模式，用 service role 重新查詢確認沒有資料真的寫入。
    6.（security-reviewer）anon select 被拒的斷言原本可能恆真（若 RLS 設錯讓 anon
       也讀到空表，斷言一樣會通過）；已補上「先用 service role 確認底下確實有
       資料」的前置檢查。
    7.（security-reviewer）原本沒有測試 anon 對 appointments／customers 的
       `delete`——Supabase 預設會給 `anon` 角色資料表層級的 DELETE 權限，只靠
       policy 缺席擋，屬於未涵蓋的破壞性操作邊界；已補上對應測試案例（建立
       fixture，anon 嘗試刪除，確認 service role 重新查詢後資料仍在）。
    以上 7 項修正後重新執行 `npx tsc --noEmit`／`npm run test:booking`（2 次，
    19/19 穩定）／`npm run test:rls`，皆通過。
  - **併發測試的已知邊界**（security-reviewer 提出的殘留風險，記錄但未在本卡擴大
    範圍去補測）：`Promise.all` 對 4 個並發請求無法區分「真正平行處理」與「網路層
    意外序列化」，理論上兩者都會讓斷言通過；且目前 3 輪併發測試每輪都用不同電話
    號碼，沒有涵蓋「同一電話同時搶不同顧客建檔」觸發 `customers_phone_key` 併發
    撞號、回傳 `INTERNAL_ERROR`（見 `0002_booking_flow.sql` 註解「請前端重試整個
    請求」）這條 TASK-010 已記錄為刻意簡化的路徑。這條路徑本身已由 TASK-010 的
    完成證據記錄為已知限制，本卡不重複擴大測試範圍。
  - `get_available_slots` 的「空閒營業日回傳完整格點」案例斷言剛好 18 個時段，
    依賴當下沒有其他資料落在該日期；已把日期池移到接近 90 天視野上限降低機率，
    但無法百分之百排除（全域 exclusion constraint 的既有設計限制，見上）。
- 後續任務：無（Epic 三個 User Story 已全部涵蓋並通過端到端驗證；待人工驗收後，
  可回頭視情況更新 `ai/artifacts/顧客預約流程/feature-spec.md` 狀態為「已實作」）。
