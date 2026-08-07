# 決策紀錄

記錄未來 agent 不該重新摸索一次的持久性決策。

## 範本

```text
日期：
決策：
情境：
考慮過的替代方案：
為何選這個：
影響：
```

## TASK-003：用 `admins` 表 + `is_admin()` 判斷管理者身分，不用 `authenticated` 角色

```text
日期：2026-08-04
決策：唯一設計師帳號的權限判斷，用一張只有 SECURITY DEFINER function 能讀的 admins
      表（RLS 啟用、不建任何 policy），而不是直接用 Postgres 的 authenticated 角色。
情境：TASK-003 一開始的草案直接用「authenticated 角色」代表設計師。但 authenticated
      代表「任何登入過的使用者」，不是「唯一設計師」。只要 Supabase 專案的公開註冊
      沒被手動關掉，任何自行註冊的帳號都會透過這個角色拿到全部顧客 PII 的讀寫權。
      這個問題在 TASK-003 的 Phase 4 架構/安全審查（security-reviewer 子代理）被標記
      為 Critical。
考慮過的替代方案：
  - 直接用 authenticated 角色（初版做法）：不可行，見上述問題。
  - 依賴「手動在 Supabase 後台關閉公開註冊」當唯一防線：太脆弱，是不受版控、
    容易忘記的人工步驟，且審查後仍應視為防禦縱深而非邊界本身。
為何選這個：admins 表本身鎖死（RLS 啟用、零 policy，包含 authenticated 自己都讀不到），
      唯一存取路徑是 is_admin()（SECURITY DEFINER，set search_path = ''），這樣權限
      邊界進版控、不依賴任何後台開關才成立。所有需要「只有設計師能動」的 RLS policy
      都呼叫 is_admin()，不直接判斷角色。app/admin/page.tsx、app/login/page.tsx 也在
      應用層各呼叫一次 supabase.rpc("is_admin") 做第二層確認（middleware/proxy.ts
      只判斷「有沒有登入」，不是唯一的授權邊界）。
影響：日後任何新表只要有「只給設計師看/改」的需求，一律用 is_admin() 判斷，不要在
      RLS policy 或應用層碼裡用 authenticated 角色代表「是設計師」。新增第二個管理者
      帳號時，往 admins 表加一列即可，不需要改任何 policy。
```

## TASK-003：顧客自助查詢（access_token）與顧客去重，延後到未來預約流程 Epic 用 RPC 實作

```text
日期：2026-08-04
決策：appointments.access_token 只在建立時由資料庫產生隨機值（DEFAULT），本任務不開放
      任何用 access_token 查詢預約的管道；customers 表 anon 完全無法讀寫，顧客去重/
      建檔邏輯也不在本任務實作。
情境：任務卡假設欄位包含 access_token「供顧客自助查詢使用」，但若現在就開一個以
      query 參數比對 access_token 的 anon SELECT policy，RLS 沒有原生方式限制「只能
      查自己那筆」，容易做出漏洞式的寬鬆查詢。
為何選這個：等實際的預約流程 Epic 需要這個功能時，用 SECURITY DEFINER RPC function
      （帶 token 參數、內部精準比對後只回傳那一筆）實作，比在 RLS 開一個粗粒度 SELECT
      policy 安全。同理，顧客去重（依 phone/email 找既有 customer 或建新的）屆時也用
      RPC 處理，不要用寬鬆的 anon INSERT policy 開洞。
影響：未來做預約流程 Epic 時，appointments/customers 的讀寫入口預設是 RPC function，
      不是直接開放資料表的 anon policy。appointments.customer_id 欄位已存在（nullable），
      供屆時的去重邏輯關聯用，本任務不會自動填值。
```

## TASK-010（顧客預約流程）：撤銷 TASK-003 的 anon 直接 INSERT policy，改為 RPC-only 寫入

```text
日期：2026-08-05
決策：`0002_booking_flow.sql` 撤銷 TASK-003 建立的 "anyone can create pending appointment"
      policy 與對應的 anon 欄位級 INSERT 授權，appointments 的唯一寫入路徑改為
      `create_appointment` RPC；同步更新 `tests/rls.integration.test.ts` 裡驗證舊行為
      的測試案例。
情境：`ai/artifacts/顧客預約流程/task-cards/TASK-010.md` 送 architect／security-reviewer／
      test-engineer 三方計畫審查時，三份審查都獨立指出同一個問題：TASK-003 當時為了
      讓顧客能「先求堪用」建了一條 anon 直接 INSERT 的 policy，但本 Epic 要引入時段
      衝突檢查與顧客去重，若不撤銷該 policy，顧客可以完全繞過 create_appointment 的
      所有驗證直接寫入任意資料（自訂 end_at 封鎖整天、跳過營業時間檢查、customer_id
      留空破壞去重）。
考慮過的替代方案：
  - 保留舊 policy 並讓前端只呼叫 RPC（依賴前端不繞過）：不可行，anon key 是公開的，
    任何人都能直接呼叫 PostgREST，前端行為不構成安全邊界。
為何選這個：延續 TASK-003 本身的邊界收斂原則（見上一則決策）；RPC 內可以做交易層級的
      衝突檢查與去重，寬鬆的 INSERT policy 做不到。
影響：預約管理後台等後續 Epic 若也需要 anon 或 authenticated 寫入 appointments，一律
      走對應用途的 RPC，不要重新開寬鬆的 anon INSERT policy。
```

## TASK-010（顧客預約流程）：時段衝突用 exclusion constraint，不分服務、不分應用層鎖

```text
日期：2026-08-05
決策：`appointments` 加一個 `EXCLUDE USING gist` constraint（搭配 `btree_gist`），鍵是
      `tstzrange(start_at, end_at)`，`WHERE status in ('pending','confirmed','completed')`
      （不含 cancelled），且不依 `service_id`分割。不採用「exclusion constraint 或
      `select ... for update` 應用層鎖擇一」的原始規劃。
情境：初版任務卡把 exclusion constraint 與應用層鎖列為「擇一」，且鍵設計含
      `service_id`。architect 審查指出：(1) 只有一位設計師，不同服務也不能同時段重疊，
      鍵不該含 service_id；(2) 尚不存在的資料列鎖不住，`select ... for update` 對
      「即將要新建的時段」無效，不是真正等價的替代方案。
考慮過的替代方案：
  - 應用層鎖／重新檢查：在單一設計師、可能多實例部署的情況下不可靠。
為何選這個：exclusion constraint 是資料庫層保證，且不受應用程式碼是否正確重新檢查的
      影響；WHERE 排除 cancelled 避免取消的時段永久鎖死該區間。
影響：`get_available_slots` 的忙碌區間查詢與 `create_appointment` 的衝突判斷都要用
      同一組「有效狀態」定義（pending/confirmed/completed），未來新增狀態值時要同步
      檢視這個 constraint 與查詢邏輯。
```

## TASK-022～027（營業時間與可預約時段管理，第二批次）：緩衝時間不做資料庫層級約束，只在 `get_available_slots`／改期表單做候選時段過濾

```text
日期：2026-08-06
決策：`services.buffer_minutes` 純粹是 `get_available_slots` RPC 與後台改期表單
      （`lib/admin/reschedule-slots.ts` 的 `computeAvailableSlots`）在「計算可預約時段」
      時的過濾條件，不改變 `appointments.end_at` 的實際紀錄語意，也不改變
      `appointments_no_overlap` exclusion constraint 的定義。緩衝時間本身不做資料庫層級
      的衝突防護，只靠 `services.buffer_minutes` 的 `0～120` check constraint 當最終防線。
情境：`appointments_no_overlap` 只比較 `tstzrange(start_at, end_at)` 是否重疊，緩衝時間
      是「預約之間該留多少間隔」的排程偏好，不是「這兩筆預約有沒有真的撞期」——把緩衝也
      做成資料庫層級約束，需要讓 exclusion constraint 感知每筆預約所屬服務當下的
      `buffer_minutes`（該值可能事後被改動），複雜度與現有「單一設計師、低並發」的網域
      規模不成比例。
考慮過的替代方案：
  - 把緩衝時間內建進 exclusion constraint 的鍵（例如索引運算式改用
    `end_at + buffer_minutes`）：可行但需要應用層 trigger 或 generated column 同步緩衝
    設定變動，且緩衝設定變動時歷史資料的鍵值語意會跟著改變，複雜度高、與本 Epic「緩衝
    設定本批次連 UI 都還沒有、只能靠維運人員直接改資料庫」的成熟度不成比例。
為何選這個：比照本專案既有的「單一設計師、低並發」網域假設（見上面 `business_hours`
      無樂觀鎖、TASK-010 的 exclusion constraint 決策）。存在理論上的競態風險：兩筆並發
      預約請求都各自通過「緩衝感知的可預約時段」檢查後才送出，資料庫的 exclusion
      constraint 只檢查實際起訖時間有沒有重疊、不知道緩衝的存在，理論上可能讓兩筆預約
      之間的間隔小於設定的緩衝時間（但不會真正重疊，仍受 exclusion constraint 保護不會
      撞期）。判定為可接受風險。
影響：`get_available_slots` RPC（`supabase/migrations/0004_slots_closures_buffer.sql`）
      與 `computeAvailableSlots`（`lib/admin/reschedule-slots.ts`）各自獨立實作同一套
      「候選時段效力區間 = [start, end + 所屬服務 buffer_minutes)」比較邏輯，未來修改其中
      一邊的緩衝判斷時要同步檢視另一邊，並用整合測試交叉驗證兩者對同一組輸入產生一致結果
      （見 `tests/business-hours.integration.test.ts` TASK-027 新增的「後台改期表單與
      get_available_slots RPC 對同一組輸入產生一致的可預約時段判斷」案例）。若未來出現真實
      的並發競態問題（目前判定為低機率），才需要重新評估資料庫層級約束。
```

