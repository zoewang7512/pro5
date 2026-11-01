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

> **部分被取代（2026-10-21，TASK-068）**：「只有一位設計師」的前提已不成立，constraint 現在是「同一位設計師
> 不可重疊」（`designer_id with =` 加時段 `&&`），仍不依 `service_id` 分割；其餘（不採應用層鎖、排除 cancelled）
> 仍然有效。見下方「TASK-068」。

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

## TASK-051～054（Email 通知與提醒）：Database Webhook 用 migration SQL + Supabase Vault 建立，不用 Dashboard 手動設定

```text
日期：2026-08-18
決策：appointments INSERT／UPDATE 觸發 email 通知的 Supabase Database Webhook，改用
      migration SQL（supabase/migrations/0011_appointments_insert_webhook.sql／
      0012_appointments_update_webhook.sql）建立 trigger function + pg_net.http_post
      呼叫，不使用 Supabase Dashboard 的「Database Webhooks」圖形化設定介面。
      webhook 目標網址與密鑰不寫死在 migration 明文裡，改存進 Supabase Vault
      （`vault.decrypted_secrets`，key 名稱 `appointment_webhook_url`／
      `appointment_webhook_secret`），trigger function 執行時才讀取。
情境：本專案所有 schema 變動都走「migration 檔案 + 人工貼 Supabase SQL Editor 執行」
      的既有慣例（見專案地圖「重要目錄」`supabase/migrations/` 說明），Database Webhook
      若用 Dashboard 手動設定，會變成一份版控外、換專案或重建環境時容易被遺忘的隱性
      狀態。
考慮過的替代方案：
  - Supabase Dashboard 圖形化設定 Database Webhook：設定步驟不會被版控紀錄，未來
    重新部署到新環境（例如換 Supabase 專案）時沒有任何檔案可以照著重建。
為何選這個：trigger function 本身可重複執行（`create or replace`／
      `drop trigger if exists`），版控內就能完整重建「觸發邏輯」這一半；真正無法版控
      的只剩「兩個 Vault 密鑰的實際值」這個一次性人工步驟（密鑰材料本來就不該進版控），
      已在 migration 檔頭與本檔案下方「Email 通知與提醒：正式環境設定步驟」段落完整
      記錄需要執行的 SQL 指令。
影響：任何人要在新的 Supabase 專案（或重建現有專案）上重新啟用這個 Email 通知功能，
      依序執行 0010～0012 三個 migration，再依 `ai/context/project-map.md`
      「Email 通知與提醒架構」段落記錄的步驟在 SQL Editor 建立兩個 Vault 密鑰即可，
      不需要另外去 Dashboard 點設定。
```

## TASK-022～027（營業時間與可預約時段管理，第二批次）：緩衝時間不做資料庫層級約束，只在 `get_available_slots`／改期表單做候選時段過濾

> **部分被取代（2026-10-22，TASK-068）**：下文以「單一設計師、低並發」為由的部分已不成立——現在有多位設計師，且 `create_appointment`
> 也會經由共用的 `_designer_is_free` 檢查緩衝（人工 2026-10-21 決定，見下方「TASK-068」）。「不把緩衝做成 exclusion constraint」的決定本身仍有效，
> 併發時兩筆相鄰預約仍可能吃掉緩衝，屬已知殘留。

> **部分被取代（2026-10-21，TASK-068，人工決定）**：`create_appointment` 現在也檢查 buffer（指定與不指定兩條
> 路徑都是）——緩衝不再只是「畫面上的排程偏好」，直接呼叫 API 擠進既有預約的 buffer 會回 `SLOT_CONFLICT`。
> exclusion constraint 仍然不含 buffer（見下方「TASK-068」的殘留）。

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


## TASK-065：建立資料表的 migration 必須在同一檔案寫出明確且最小權限的 GRANT

```text
日期：2026-10-21
決策：之後任何在 public schema 建立資料表的 migration，都要在同一個檔案裡、緊接在
      create table 之後寫出明確的 table GRANT，依這張表的實際用途分別決定 anon／
      authenticated／service_role 各自需要的最小權限：
        1. 先 revoke all on public.<表> from anon, authenticated, service_role;
           （TASK-066 審查後補上 service_role：同一個交易內 revoke 再 grant 不會有權限
           空窗，連 service_role 一起收，各環境的結果才會一致）
        2. 再只 grant 實際需要的權限（例如顧客端要讀才給 anon select；寫入走
           SECURITY DEFINER RPC 的表，不給 anon／authenticated 直接寫入權限）；
           需要限制可寫欄位時，用欄位層級 grant（語法可參考 0001 對 appointments 的
           insert (欄位...) 寫法）；
        3. service_role 明確 grant select, insert, update, delete（伺服器端與整合測試
           使用）。
      不得直接照抄 Supabase 通知信的範例：範例對每張表都給 anon select、對
      authenticated 給完整讀寫，對 customers／admins 這類含個資或管理用途的表過寬。
      down migration 不需要另外 revoke，drop table 會一併移除授權。
情境：Supabase 於 2026-10-20 通知，2026-10-30 起既有專案在 public schema 新建的資料表，
      不再自動授權給 Data API 角色（anon／authenticated／service_role）。沒有明確
      GRANT 時，supabase-js／PostgREST 會回 permission denied。這也影響「用 migration
      重建 schema」的情境（新 Supabase 專案、preview branch、本機 db reset）。
      10/30 前建立的既有 8 張表維持原本自動授權，不受影響，補齊明確授權另見 TASK-066。
      在此之前，本專案的資料表權限都靠 Supabase 自動授權（實際上 anon／authenticated
      幾乎拿到全部權限），只有局部收緊（0001 appointments 欄位層級 insert、0008／0014
      revoke truncate）；函式則早已慣例化「revoke from public + revoke from anon +
      grant execute to 指定角色」（見 0007 檔內註解）。
考慮過的替代方案：
  - 照抄通知信範例的 grant：最省事，但等於把原本過寬的自動授權寫死進版控，
    customers／admins 會對 anon 開 select，只剩 RLS 一道防線。
  - 只寫 grant、不先 revoke：在 10/30 之前就存在、或是由 default privileges 授權的
    環境裡，原本過寬的權限仍會留著，結果會因環境而異。
為何選這個：GRANT 與 RLS 是兩層不同的邊界：GRANT 決定這個角色能不能碰這張表、能做
      哪種操作；RLS 決定能碰到哪幾列。兩層都收緊，任何一層寫錯時另一層仍能擋住，
      比照本專案既有的縱深防禦做法（TASK-003 is_admin()、TASK-046 revoke truncate）。
      先 revoke all 再 grant，讓同一支 migration 不論在哪個環境執行，結果都一樣。
影響：撰寫建表 migration 時，要先想清楚「哪個角色、透過什麼路徑（直接查表或 RPC）
      會用到這張表」，再決定 grant。security-checklist.md 已加入對應檢查項，
      security-reviewer 審查 migration 時要確認每張新表都有明確 GRANT。新增資料表時，
      建議在整合測試裡加一個「不該有權限的角色被拒絕」的案例。
```

## TASK-066：既有 8 張資料表補上明確的最小權限 GRANT（0015），兩個刻意收斂與不再生效的 RLS policy

```text
日期：2026-10-21
決策：用 supabase/migrations/0015_explicit_table_grants.sql 為 0001～0014 建立的 8 張表
      補上明確授權，權限表如下（authenticated 的寫入都還要再通過 RLS 的 is_admin()）：
        表              anon      authenticated                       service_role
        services        select    select, insert, update              s/i/u/d
        business_hours  select    select, insert, update              s/i/u/d
        store_settings  select    select, update                      s/i/u/d
        booking_policy  select    select, update                      s/i/u/d
        closed_dates    －        select, insert, update, delete      s/i/u/d
        appointments    －        欄位層級：select 除 access_token 外； s/i/u/d
                                  update 只限 status, start_at,
                                  end_at, reminder_sent_at
        customers       －        －                                  s/i/u/d
        admins          －        －                                  s/i/u/d
      刻意的收斂：
        - closed_dates 不給 anon：前台不直接讀，公休日由 get_available_slots 判斷。
        - customers 不給 authenticated：後台不直接查 customers。這推翻了 TASK-003 的
          「設計師可讀 customers」測試斷言（tests/rls.integration.test.ts 已改為預期
          42501）。未來「顧客資料管理」Epic 需要時，由該卡的 migration 開放。
        - appointments 對 authenticated 用欄位層級授權：access_token 是顧客自助查詢的
          憑證，後台不需要讀；customer_* 等欄位後台不需要改。
情境：Supabase 自 2026-10-30 起不再自動授權 public schema 的新表（見 TASK-065）。這 8
      張表套用前，anon／authenticated 幾乎全開，唯一的邊界是 RLS。正式環境套用前的實際
      授權已存進 TASK-066 任務卡，0015_explicit_table_grants_down.sql 依此還原。
考慮過的替代方案：
  - 照 Supabase 通知信範例全部開 anon select、authenticated 完整讀寫：等於把過寬的自動
    授權寫死進版控。
  - 什麼都不做：既有環境不受影響，但 migration 無法重建出可運作的資料庫。
為何選這個：依程式碼實際存取路徑給最小權限，授權層和 RLS 兩道邊界都收緊。所有 RPC 與
      webhook trigger function 都是 SECURITY DEFINER，不受授權收緊影響。
影響：
  - 以下 RLS policy 仍留在資料庫裡，但因授權層已擋住而不再生效，讀 policy 時不要誤判
    誰實際能存取什麼（本卡依範圍不改 policy，清理留給後續任務）：
      * 0003 "public read closed dates"：對 anon 不再生效（對 authenticated 仍生效，
        非管理員登入帳號仍可讀 closed_dates）。
      * 0001 "admin full access to customers"：authenticated 沒有任何授權。
      * 0006 "admin insert store settings"、0008 "admin insert booking policy"：
        authenticated 沒有 insert 授權。
  - anon 對 services／business_hours／store_settings／booking_policy 是整張表 select，
    日後在這 4 張表新增的欄位一律視為對外公開（比照 0008 檔頭對 booking_policy 的約定）。
    含敏感資料的欄位不要加在這 4 張表，或改用欄位層級授權。
  - appointments 日後新增欄位時，後台若要讀寫，要在新的 migration 補上欄位層級授權，
    否則設計師端會收到 42501。
  - anon 對 appointments／customers／closed_dates／admins 的查詢，現在在授權層就回
    42501，不再是 RLS 回空陣列；測試斷言要比對錯誤代碼。
```

## TASK-079：`is_admin()` 對已啟用 MFA 的帳號要求 aal2（0016），資料庫層強制

```text
日期：2026-10-21
決策：is_admin() 改為「在 admins 表」且（JWT aal = 'aal2'，或該帳號在 auth.mfa_factors
      沒有 status = 'verified' 的 factor）。簽名不變（create or replace），所有 RLS policy、
      Storage policy、SECURITY DEFINER RPC 自動套用，多位設計師 Epic 新增的表也自動受保護。
情境：TASK-059 的 aal2 檢查只在 Next.js 三個入口點生效；已啟用 MFA 但只有 aal1 的 session
      直接打 Supabase REST／RPC／Storage 仍可讀寫全部後台資料（TASK-059 [High] 殘留風險，
      合併 TASK-043 H1）。
考慮過的替代方案：
  - 逐一修改每個 RLS policy 加 aal 檢查：改動面大、日後新增的 policy 容易漏。
  - 只信任 JWT 的 aal（RESTRICTIVE policy）：無法區分「沒啟用 MFA 的帳號」與「啟用但沒驗證」，
    會把未啟用 MFA 的店長鎖在外面。
為何選這個：改一處全部生效；「是否啟用 MFA」以 auth.mfa_factors（伺服器端權威資料）為準，
      與 lib/auth/aal.ts 不信任本地 cookie 快取的原則一致；aal 取自 PostgREST 已驗簽的 JWT。
影響：
  - 註冊中（unverified）的 factor 不算已啟用，MFA 註冊流程不受影響。
  - 店長若處於「已啟用 MFA 但只是 aal1」的 session，套用後立即失去後台權限，需重新登入並
    完成 TOTP（預期行為）。
  - get_admin_profile／update_admin_profile（0007）原本直接查 admins 表、不呼叫 is_admin()，
    只改 is_admin() 管不到它們（整合測試發現）；0016 一併改為 and public.is_admin()。日後
    新增的 SECURITY DEFINER 後台函式一律要透過 is_admin() 判斷身分，不可直接查 admins 表。
  - 前提：資料庫層保證依賴 Supabase Auth 在 aal1 時拒絕 mfa.enroll（否則只有密碼的人可自行
    註冊 TOTP 升到 aal2）。tests/mfa-rls.integration.test.ts 有測試把關這個前提。
  - 若日後啟用 Custom Access Token Hook，hook 不得改寫 JWT 的 aal 或 sub claim，否則
    is_admin() 的判斷基礎會被破壞。
  - 遺失 TOTP 裝置的復原（Supabase 沒有復原碼）：由有 Dashboard 權限的人到 Authentication →
    Users → 該使用者 → MFA 刪除 factor，或 SQL
    `delete from auth.mfa_factors where user_id = '<id>'`。刪除後沒有 verified factor，
    aal1 即可恢復登入。最後手段是執行 0016_is_admin_require_aal2_down.sql（會讓所有已啟用
    MFA 的帳號在資料庫層回到 aal1 全權限，屬安全降級）。
  - 應用層三個入口點（lib/auth/aal.ts 等）維持不動，作為縱深防禦。
  - 測試用 tests/mfa-rls.integration.test.ts（npm run test:mfa-rls），以拋棄式帳號暫時加入
    admins，不使用 designer001。
  - 多位設計師 Epic 的 migration 順延為 0017／0018。
```

## TASK-067（多位設計師 架構基礎，0017）：四張新表的權限與 trigger 設計取捨

```text
日期：2026-10-21
決策：0017 新增 designers／designer_services／designer_leaves／designer_portfolio_images 與
      designer-assets bucket；appointments.designer_id 先 nullable、回填「預設設計師」，0018 才改
      not null。以下是實作與審查期定案、容易被日後誤改的取捨。
決定與理由：
  - 作品集 12 張上限的 trigger 是 AFTER INSERT＋`for no key update`，不是 BEFORE＋`for update`。
    RLS 的 WITH CHECK 在 BEFORE ROW trigger 之後才檢查，BEFORE 會讓任何自行註冊的使用者（Supabase
    公開註冊開著）在被 42501 擋下前就以 postgres 身分取鎖、並用錯誤碼探測作品張數。`for update`
    與外鍵檢查已持有的 `for key share` 會在並行時互相等待而死結；`no key update` 相容 key share，
    也不會擋住 0018 的 create_appointment。測試：並行 14 筆正好 12 成功、單一 insert 14 列整批回滾、
    非管理員得到 42501 而非 PORTFOLIO_LIMIT。
  - designers 的 insert／update 都是欄位層級授權（排除 id、created_at）。「預設設計師」以
    `order by created_at, id limit 1` 辨識（0018 補回填 null 預約用），insert 若能自訂 created_at，
    被盜用的管理員 session 可以塞一位最早建立的設計師冒充。
  - designer_specialties_valid 保留 authenticated／service_role 的 execute，與架構筆記 E 原本寫的
    「同樣 revoke」不同：PostgreSQL 評估 CHECK 時以當前使用者身分檢查函式 execute 權限，revoke
    會讓管理員寫入 designers 全部失敗。只收回 public／anon。
  - image_url 的 check constraint 只保證以 storage_path 結尾，**擋不住外部網域**。網址只能指向
    designer-assets 的唯一防線是顯示層 resolveDesignerAssetUrl（origin＋pathname 白名單，並拒絕帳密與
    %2F／%5C），前台與後台每個顯示圖片的地方都必須套用。
  - Storage insert policy 限定剛好兩層資料夾與 jpg／png／webp 副檔名（bucket 的 MIME 限制只看用戶端
    宣告的 Content-Type）。不建 update policy（無 upsert 這條路），但管理員可以先刪再上傳到同一路徑，
    不能宣稱「同一網址不可能被換圖」。
  - authenticated 對 designer_leaves／designer_services 沒有 update 權限：TASK-070／072 不能用 upsert
    （on conflict do update），只能 insert（ignoreDuplicates）或 delete。
  - 0017 對四張新表做 revoke all 再 grant 並重建所有 policy：0018 套用後不要再重跑 0017，否則會悄悄
    還原 0018 之後對這些表追加的授權或 policy。
影響與殘留：
  - Supabase 公開註冊開著（disable_signup: false），本 Epic 所有防線靠 is_admin()；建議關閉，列為
    合併 master 或套用 0018 的前置條件（待人工決定）。
    **已決定（2026-10-22，TASK-077）：使用者決定關閉公開註冊。** 這是 Supabase 後台的設定（Authentication 的
    「Allow new users to sign up」），不受版控，**本專案無法驗證**；**使用者已於 2026-10-22 回報已在後台關閉**（未經本專案獨立驗證）。關閉不影響現有功能：
    應用程式碼從不呼叫 `signUp`，種子腳本與測試都用 service_role 的 `admin.createUser`。之後的 Demo 體驗帳戶也應走
    伺服器端 service_role 建立，不依賴公開註冊。
  - **已決定（2026-10-22，TASK-077）：designer001 先不啟用 MFA。** 使用者接受「唯一正式管理員只靠密碼保護」的殘留風險
    （TASK-079 的 aal2 強制只對已啟用 MFA 的帳號生效）。本 Epic 新增的、只靠這組密碼保護的寫入面：公開 bucket 上傳、
    可竄改前台設計師頁、關閉服務或標請假即可讓前台無法預約。與既有「管理員密碼外洩」同類風險，沒有新的攻擊類型；
    建議確認 Supabase Auth 的外洩密碼防護與登入限流已開啟。日後想補強時再啟用 MFA，`test:mfa-rls` 不依賴 designer001。
  - 0017 重跑冪等與 0017_down 尚未在隔離環境實跑；is_admin() aal2 對新表寫入是「繼承」保護，
    test:mfa-rls 尚未涵蓋新表。
  - 既有整合測試套件結束時 signOut() 預設 global scope，會撤銷設計師帳號在所有裝置的登入；
    新套件 test:designers 已改用 scope: "local"，其餘套件建議另開卡處理。
```

## TASK-068（多位設計師 依設計師計算時段與建立預約，0018）：exclusion 依設計師、自動指派、email 上限與審查定案的取捨

```text
日期：2026-10-21
決策：appointments_no_overlap 改為 exclude using gist (designer_id with =, tstzrange(start_at, end_at, '[)') with &&)
      where status in (pending, confirmed, completed)，名稱不變；designer_id 改 not null。get_available_slots 與
      create_appointment 新增 p_designer_id uuid default null（省略或 null＝不指定）；成功時 create_appointment
      回傳 designer_id、designer_name。取代 2026-08-05「時段衝突不分服務」中「只有一位設計師」的前提。
決定與理由（容易被日後誤改的取捨）：
  - 檢查順序：欄位驗證 → 有限值 → 服務 → 公休日 → 營業時間 → 提前量／視野 → 設計師候選清單（空則 SLOT_CONFLICT）
    → BOOKING_LIMIT（電話）→ BOOKING_LIMIT（email）→ 顧客去重 → insert 迴圈。設計師檢查放在視野之後，所以 90 天外的
    時間合格與不合格設計師都回 VALIDATION_ERROR；清單為空在碰 customers 之前就回，指定的設計師「不存在、停用、
    沒開服務、請假、時段被佔」回傳的 JSON 完全相同。
  - 指定設計師＝只有一位候選人的清單，與不指定共用同一個 insert 迴圈，兩條路徑不會漂移。兩支 RPC 共用
    _designer_is_eligible／_designer_is_free，buffer 判斷一致（只有一位設計師時，列出的每個時段都建得起來）。
  - 候選人在巢狀 begin ... exception 內 insert，被擋下就換下一位；全部失敗時 raise exclusion_violation（constraint =
    appointments_no_overlap），由外層 handler 轉成 SLOT_CONFLICT 並回滾整個區塊，不留 customers 孤兒列。
    **巢狀 handler 也必須接 deadlock_detected**（architect 套用前審查）：兩筆同時 insert 同一位設計師的重疊時段時，
    exclusion 檢查可能互相等待而死結，犧牲者拿到 40P01 而不是 23P01；不接的話會被外層吞成 INTERNAL_ERROR，破壞
    「第一順位被訂走就改派」的保證。
  - 不指定的排序：(當天 Asia/Taipei 的 pending／confirmed 預約數, sort_order, id)；已取消與已完成不計入。
  - migration 一開始就取 access exclusive 並設 lock_timeout 5 秒，不先取 share row exclusive 再升級（會與進行中的
    舊 RPC 互相等待而死結）。套用前檢查：上架中的服務都必須至少有一位啟用中的設計師，否則 migration 直接失敗。
  - 兩支 RPC 的 execute 權限明寫 anon、authenticated、service_role（revoke 時一併收回再 grant），不依賴 default
    privileges；套用前實測（proacl）原本是 postgres、anon、authenticated、service_role 四者皆有。內部函式
    anon／authenticated 不能呼叫（42501）。**0018 之後不要重跑 0009／0014**（舊簽名會與新簽名並存，PGRST203）。
  - BOOKING_LIMIT（電話）維持全店、跨設計師合計，不改成每位設計師各自計算（會讓可佔用總容量變成 N 倍）。新增
    以 email 計算的同等上限（人工決定併入本卡，取代延後的 TASK-080）：同 email 已有 3 筆未過期 pending／confirmed
    就回 BOOKING_LIMIT_EXCEEDED。比對用 _email_dedupe_key 正規化（去空白、不分大小寫、去掉 +標籤、去掉網域結尾的
    點、gmail.com／googlemail.com 去掉本地部分的點）；計數前先取 advisory lock（先電話、後 email）防止同時送出繞過。
    這只是縱深防禦，不能取代限流：換受害者 email、換電話總量仍無上限，國際化網域等同形寫法也擋不住；email 欄位
    不改成只收 ASCII（人工 2026-10-22 決定先不做：會擋掉國際化網域與少數正常顧客）。
  - TASK-080（建立預約的限流，Turnstile／依 IP）仍延後；重新啟動條件：出現實際濫用跡象，或準備對外宣傳／大量曝光，
    或 email 上限被繞過的證據。
接受的殘留：
  - exclusion constraint 不含 buffer，併發時兩筆相鄰預約仍可能吃掉緩衝時間（buffer 只在候選清單與
    get_available_slots 檢查）。
  - 候選清單算完之後、insert 之前，店長剛好停用設計師或新增請假，預約仍可能成立。
  - 指定模式可逐一推算各設計師的忙碌時段與疑似請假日；BOOKING_LIMIT 與 SLOT_CONFLICT 的回應差異也能當成不留痕跡
    的探測管道（已達上限的電話去約被佔時段得到 SLOT_CONFLICT，與 0014 不同，是檢查順序的結果）；回應時間差。
    get_available_slots 沒有限流（既有）。
  - 第 90 天晚於「現在時刻」的時段會被 get_available_slots 列出、create_appointment 卻以 90 天上限拒絕（0009／0014
    起就如此，不是本卡引入）。
  - 電話與 email 上限的計數條件用不到索引（資料量小時全表掃描，可接受）。
  - 前台 BOOKING_LIMIT_EXCEEDED 文案寫「這支電話…」，email 上限觸發時對顧客有點誤導；改文案在
    lib/booking/error-messages.ts，留給 TASK-073。
部署順序：先套用 0018，再合併 master／部署新前端（新前端一定送出 p_designer_id，在 0018 前部署會 PGRST202 讓預約
      中斷）。0018 套用到合併 master 之間，舊後台新增的服務不會對任何設計師開啟（createService 不寫
      designer_services），前台沒有時段；期間不要在後台新增服務（人工 2026-10-22 決定接受這個空窗，不加程式碼防護，只靠文件提醒）。回滾順序：Vercel 回滾前端 → 0018_down → 0017_down；
      多位設計師上線後若已有不同設計師同時段的預約，0018_down 會以明確訊息中止。
測試：tests/helpers/designer-fixture.ts 讓每個套件建立專屬 __TEST__ 設計師（只能對 __TEST__ 服務開啟，清除時先刪預約
      再刪設計師，並自動清掉超過 1 小時的同 tag 殘留）；直接 insert appointments 的 fixture 都要帶 designer_id。
      既有 10 套整合測試套用 0018 後只改 fixture 設定、斷言不變（測試數量與套用前相同）。email 上限的「不計入已取消與
      已過期」案例會真的成立一筆帶 email 的預約（@example.invalid，Resend 於 API 層拒絕，不會真的寄出），其餘一律
      先以 null 建立再只更新 customer_email 那一欄，避開 0011／0012 的 webhook 觸發條件。
```

## TASK-084～086（稽核紀錄，簡版 A，0019）：後台函式內記錄的操作日誌，擱置防竄改完整版

```text
日期：2026-10-24
決策：用「簡版 A」做後台操作日誌——一張只增不減的 public.audit_log，加上由各後台寫入函式在
      「原操作成功之後」呼叫的 recordAdminAction（lib/admin/audit-log.ts，永不 throw）。
      不做資料庫 trigger、不做測試標記與密鑰、不做清除帳本；原完整版設計（9 張卡）保留在
      ai/artifacts/稽核紀錄/完整版備案/。
情境：使用者的初衷是「簡單記錄店長有過什麼操作」。後台寫入都由瀏覽器直接對 Supabase 進行，資料表只有
      updated_at，事後無法回答「什麼時候誰改了什麼」。完整版（trigger 在資料庫層記錄所有寫入）能防繞過
      與竄改，但要動預約寫入路徑、需要測試標記機制，成本與風險遠高於需求。
考慮過的替代方案：
  - 完整版（資料庫 trigger＋防竄改）：能記到繞過後台的操作，但碰預約寫入路徑（顧客預約的核心流程）、
    要 9 張卡；使用者選擇擱置。升級路徑：保留備案文件，日後若出現「需要記到繞過後台的操作」或多位管理員，
    再依備案升級，audit_log 欄位（含 actor_id）已預留。
  - 只靠 updated_at／Supabase Auth logs：無法回答「改了什麼」。
為何選這個：改動小、不碰既有寫入路徑與顧客流程、記錄失敗不影響原操作，且足以回答使用者的實際問題。
權限與欄位（0019_audit_log.sql）：
  - anon 零權限；authenticated 只有 select 與「欄位層級 insert」(event_type, entity_type, entity_id,
    summary, changes)，不含 id、actor_id、created_at——操作者（default auth.uid()）與時間（default now()）
    只能由資料庫決定，前端無法指定（寫法比照 0001 對 appointments 的 insert (欄位...)）。
  - RLS 只有 select／insert 兩條 policy（is_admin()），沒有 update／delete policy 也沒有授權。
  - service_role 只有 select、delete（delete 僅供整合測試清掃，不給 insert／update）。
  - identity 欄位的 insert 不需對序列另外授權（security-reviewer 複審確認）。
  - 複審後採納：revoke 含 public；event_type 正則用 [.] 取代 \. 以免依賴 standard_conforming_strings；
    補 alter column actor_id set default 讓重跑收斂；檔頭註明「後續 migration 調整授權就不要重跑本檔」。
保證邊界（如實記錄，這是操作日誌不是防竄改稽核）：
  - 能防止：登入帳號修改或刪除既有紀錄、偽造操作者與時間。
  - 不能防止：被盜用的店長 session 新增偽造紀錄；繞過後台的操作（直接打 Supabase API、service key、
    SQL Editor）不會被記錄；資料庫 owner／service key 可改動資料表；使用者在寫入前關閉分頁會漏記；
    記錄失敗只 console.warn（刻意不影響原操作），所以可能漏記。
寫入函式的設計：
  - recordAdminAction 永不 throw；失敗只印 error code（不印訊息內容）；文字值截斷 60 字；摘要／差異序列化
    超過 3500 位元組（資料庫上限 4096，jsonb::text 較長，留餘裕）依序丟棄 changes、summary，仍保留事件與對象。
  - 事件建構函式只接受規格白名單欄位，且 recordAdminAction 會再依事件白名單過濾 summary／changes 的鍵
    （縱深防禦：即使呼叫端誤塞 customer_* 也寫不進去）；預約事件輸入型別不含顧客欄位。
  - 沒有實際變動回傳 null（不記）；舊值讀不到時只記新值（changes 沒有 from）。
  - 顯示文字（中文事件名、前後差異）由前端依事件代碼組成、不存資料庫；時間以 Intl 固定 Asia/Taipei，
    不依賴執行環境時區；白名單外的 key 一律忽略。
測試雜訊：整合測試以店長帳號呼叫來源函式會留下紀錄；帶 __TEST__ 名稱的可用
      npm run sweep:audit-test-rows（預設 dry-run，--apply 才刪，可 --since）清除；不帶名稱的
      （預約規則、營業時間還原）可能留下少量雜訊，屬已接受。
部署順序：先在 Supabase SQL Editor 套用 0019，再部署前端（前端早於 0019 部署時 recordAdminAction 只會警告，
      列表頁會顯示錯誤狀態）。回滾：Vercel 回滾前端 → 0019_audit_log_down（會刪除全部紀錄，先匯出）。
列表畫面（TASK-086，使用者 2026-10-24 選定 mockup 變體 A；決策紀錄 mockup-decision-稽核紀錄列表.md）：
  - 版型：四欄表格（發生時間／事件／對象／變更內容）＋Chip 篩選（全部／預約／設定），與服務項目管理、預約列表
    同一種表格樣式；否決 B（依日期分組活動流，新版型）與 C（可展開列，差異預設看不全）。
  - 載入更多失敗：保留既有列，在列表底部行內顯示錯誤與重試（以同一游標重試）；首頁／切換類別失敗則整區改為
    錯誤狀態與重試，不顯示部分資料。
  - 競態：每次發請求遞增序號，回來時序號不符就丟棄；切換類別同時作廢進行中的「載入更多」，所以舊類別的資料
    不會附加到新類別；附加時以 id 去重。切換類別一律重置游標與已載入的列。
  - 窄視窗：表格外層橫向捲動（最小寬度 720px），差異欄換行；後台以桌面為主，只要求 768px 不破版。
  - 顯示：時間欄 `M/D HH:mm`（Asia/Taipei），完整年月日放在儲存格 title；使用者可控字串（服務、設計師名稱）
    一律純文字、<bdi> 隔離方向、overflowWrap 換行；沒有對象或差異顯示「—」。頁面不顯示總筆數與操作者。
  - 頁首只寫「僅供查看，無法修改或刪除」，不加防竄改提示；保證邊界記載於 project-map.md 與本條目。
  - 存取控制沿用 app/admin/layout.tsx 三層檢查；非店長即使直接打資料層，RLS 也只回空結果。
後續建議（不在本 Epic，2026-10-24 與使用者討論後決定不做，原因：面試專案以最小 MVP 為優先，資料量與
      單一店長情境下價值有限；已整理進 README「未來規劃」）：日期區間與預約編號篩選、設定異動通知
      （目前只記錄不告警；若只做一項，建議只針對預約規則與營業時間寄信給店長）、升級成防竄改的完整版
      （見完整版備案）、為 services.name 補長度限制、updateBookingPolicy 的真實資料庫整合驗證
      （正式環境手動走查已確認接線）。
```

## TASK-087（儀表板與報表 預約價格快照，0020）：用 BEFORE INSERT trigger 帶入下單價格，不改 create_appointment

```text
日期：2026-10-24
決策：appointments 新增 price_at_booking numeric(10,2) not null check (>= 0)，由 BEFORE INSERT trigger
      public.set_appointment_price_snapshot() 無條件以 services.price 覆寫；既有預約一次性回補為
      「各自服務的目前價格」；authenticated 只有 select (price_at_booking)，沒有 update。
情境：報表的營收要用「下單當下的價格」，但 appointments 原本只關聯 services，服務一改價歷史營收就跟著變。
考慮過的替代方案：
  - 改 create_appointment 在 insert 時帶入價格：RPC 已被 0013／0014／0018 改過多次、是顧客預約核心路徑，
    再動它風險高；而且只涵蓋 RPC 一條路徑，service_role 腳本或未來後台新增預約會漏掉快照。
  - 不存快照、報表直接用服務目前價格：改價後歷史營收漂移，數字不可信（使用者否決）。
  - 另建價格歷史表：過度設計，單一店長、價格異動極少。
為何選這個：trigger 讓任何新增路徑都自動有快照；RPC 簽名與內容完全不動，回滾只需丟 trigger；無條件覆寫，
      不信任呼叫端帶入的值；只有 INSERT 寫快照，改期／改狀態不重算。
關鍵細節：
  - 找不到服務時以 23503（foreign_key_violation）中止，保留原本「service_id 不存在 → 外鍵錯誤」的語意。
  - trigger function 為 security definer、set search_path = ''、revoke execute from public（比照 0011／0012）。
  - 權限：appointments 對 authenticated 是欄位層級授權（0015），新欄位必須補 grant select，否則報表頁讀取
    會 permission denied；不給 update，所以店長 session 被盜用也改不了快照。service_role 有整表權限，
    整合測試靠它改快照造資料。anon 沒有任何權限。
  - 回補的副作用防護：回補前把「目前為啟用狀態」的 appointments_set_updated_at（否則全部既有預約的
    updated_at 被改成現在）與 appointments_notify_update（寄取消／改期信；其 WHEN 本來就不含本欄位，這裡是
    雙保險）停用，回補後只還原剛才停用的；整段在同一交易內，失敗整份回滾。ADD COLUMN 的 ACCESS EXCLUSIVE
    鎖持有到 commit，回補前不會有新預約插隊產生 null 列。
  - 歷史預約的快照是回補當下的服務價格（近似值）：既有預約沒有歷史價格可還原；規格書已列為非目標，畫面不標示。
security-reviewer 套用前複審（2026-10-24）：無 Critical／High；採納三項——(1) 先 set local lock_timeout = '5s' 並明確
      lock table ... access exclusive（比照 0018），拿不到鎖 5 秒內整份回滾，不讓預約請求排隊卡住（down 檔同樣處理）；
      (2) trigger function 對 public、anon、authenticated 三者都 revoke execute（比照 0017）；(3) 套用前先清點 appointments 上的
      trigger（預期只有 notify_insert、notify_update、set_updated_at 三個且為啟用），避免有人在 Dashboard 手動建過沒有 WHEN 的 webhook。
測試資料規則（沿用既有教訓）：整合測試新增預約一律 customer_email = null（0011／0012 webhook 只在有 email
      時寄信）、`__TEST__` 名稱、結尾只做 scope: "local" 的登出。
部署順序：先在 Supabase SQL Editor 整份執行 0020，再部署前端（前端早於 0020 部署時，報表頁只顯示錯誤狀態，
      不影響其他頁）。回滾：Vercel 回滾前端 → 0020_down（會刪除全部快照）。
影響：後續報表（TASK-088～）一律以 price_at_booking 計營收；日後若新增「後台新增預約」，不需處理快照；
      若日後要「改派／改價預約」，需另行決定是否重算快照（目前 UPDATE 不重算）。
```

## TASK-088～092（儀表板與報表 資料層、圖表、畫面與串接）：客戶端彙總、圖表純 CSS、儀表板＝B／報表＝C

```text
日期：2026-10-25
決策：
  1. 彙總在瀏覽器端做：fetchReportAppointments 抓單一期間的預約列（只選統計欄位），summarize／buildTrend／
     buildServiceRanking 以純函式計算；不新增資料庫函式或 RPC。
  2. 圖表純 CSS：TrendBarChart 以 MUI Box＋theme palette 堆疊長條，不引入圖表套件。
  3. 版型：儀表板頁籤＝變體 B（營收主角摘要列、預約量圖＋營收圖並排、橫條排行），報表頁籤＝變體 C（六格彙總列、
     含占比條的排行表、逐日／逐小時明細表）；使用者 2026-10-24 選定（mockup-decision-報表.md）。
情境：店長要在月底、排班、調價前看「做了幾筆、賺了多少、哪個服務最受歡迎、哪位設計師最忙」；單一店長、
      每月預約量約數百筆。
考慮過的替代方案：
  - 資料庫端彙總（security invoker 的 group by 函式）：數字只有一份、資料量不隨期間成長，但要新增函式與權限、
    遷移與回滾成本高；而口徑（取消不計、快照價）、設計師篩選、兩個頁籤與匯出共用同一份結果，在客戶端以純函式
    做最容易單元測試，也讓「切設計師／切頁籤不重新查詢」成立。
  - 圖表套件（Recharts、Chart.js 等）：多一個 dependency 與打包體積，主題色與深色模式要另外對接，鍵盤與螢幕
    閱讀器行為也要自己補；本頁只需要堆疊長條，純 CSS 能直接吃 theme token、斜紋區分已完成／待完成（不只靠顏色）。
  - 變體 A（單頁、無頁籤）：資訊密度最高但圖與明細互相擠壓；使用者要求「看趨勢」與「對數字／匯出」分開，所以拆兩頁籤。
為何選這個：單期間資料量遠低於上限，客戶端彙總的成本可忽略，換來單一口徑（summarize 一處）、兩頁籤與匯出天然一致、
      純函式可完整測試；圖表需求單純，不值得為它引入套件。
關鍵細節：
  - 口徑只在 summarize 定義；排行、趨勢、面板、匯出一律消費它的結果，不得各自重算（預約量不含已取消；營收＝
    completed 快照價；預估營收＝pending＋confirmed 快照價）。
  - 單期間上限 5000 列（每頁 1000、最多 5 頁，多取一頁判斷是否超過）；超過回錯誤，不顯示被截斷的數字。
    升級路徑：改為資料庫端彙總，另立任務。
  - 只有「期間」改變才重新查詢（TASK-092）；切頁籤與切設計師只重算。查詢結果以 {key, status, appointments} 存放、
    render 時推導載入中；effect 重跑即作廢前一次回應（等同遞增請求序號），避免先慢後快的請求蓋掉新資料。
  - 切粒度的錨點：本期（含今天）以今天為錨，其他期間以起始日為錨——規格書「以目前日期所在的日／週／月」與
    架構筆記「以目前期間的起始日為錨」兩處用字不同，採兩者的交集：在本月按「週」得到本週（而不是本月 1 日所在的週）。
  - 設計師 chip：數字＝期間內預約量（不含已取消）；載入中沿用上一份已載入資料的數字以維持可操作（第一次載入才顯示骨架），
    錯誤時隱藏 chip 列（不拿別的期間的數字冒充，勾選保留）。規格書「錯誤時篩選仍可操作」因此縮減為「工具列仍可操作」。
  - 設計師清單載入失敗時降級為不顯示 chip 列（與預約週曆一致），報表照常顯示全部設計師。
影響：匯出（TASK-093）吃 ReportsView 同一份計算結果；日後若資料量逼近 5000 列／月，需做資料庫端彙總。
```

## TASK-093（儀表板與報表 匯出 Excel）：瀏覽器端產生、write-excel-file@4.1.1、字串型別防公式注入

```text
日期：2026-10-25
決策：
  1. 匯出在瀏覽器端產生：lib/admin/reports-export.ts 直接吃畫面已算好的結果（期間、設計師名稱、totals、ranking、
     trend），不重新查詢、不新增伺服器端點，因此沒有新的授權面，也和畫面天然一致。輸入型別只有彙總結果，
     型別上拿不到任何 customer_*。
  2. 套件：write-excel-file@4.1.1（精確版本，package.json 無 ^）。npm view 事實：MIT；唯一相依 fflate；專司寫入、
     有 browser／node／universal 三個入口；最後發布 2026-06-08。瀏覽器端以動態 import("write-excel-file/browser")
     載入，只有按下匯出才下載該 chunk（build 產物中獨立成 chunk，不在報表頁的主 bundle）。spike 結果：browser
     入口在 Next 16（Turbopack）build 與開發伺服器都可用，不需要改用 universal。
     fflate@0.8.3 另列 devDependency（精確版本），只供測試解開 xlsx 讀回驗證。
  3. 公式注入：所有文字儲存格一律以 type: String 寫入（xlsx 的共用字串，不是 <f> 公式），Excel／Google 試算表
     不會執行；因此不改動文字內容（不加 ' 前綴，避免服務／設計師名稱被改字）。只有明確指定 type: "Formula" 才會
     產生公式，匯出模組不使用。讀回測試固定驗證：名稱為 =SUM(1)、+1、-1、@x、Tab 開頭時，工作表 XML 不含 <f>，
     該儲存格為共用字串且內容原樣。（規格書原寫「加前綴」，改為此做法，已同步於架構筆記 §5。）
  4. 檔名：報表_<期間>_<設計師>.xlsx；清理 \ / : * ? " < > |、控制字元（含 DEL）、連續的點（避免 ..）與前後空白；
     整個檔名 ≤ 80 字元（以 code point 截斷，不切壞代理對）；清理後為空回退為「全部設計師」。
  5. 下載：Blob＋暫時的 <a download>＋URL.revokeObjectURL（延後 1 秒，避免部分瀏覽器 click 後立刻 revoke 讓下載失敗）；
     失敗一律丟泛用錯誤「匯出失敗，請稍後再試。」，不帶套件或瀏覽器的細節。按鈕用 ref 守衛，連點只觸發一次。
情境：店長要把報表頁籤目前看到的數字交給會計或留存；單一店長、每月預約量約數百筆。
考慮過的替代方案：
  - xlsx（SheetJS）：npm 上的 0.18.5 有已知漏洞（原型污染、ReDoS），修正版只在官方 CDN 發佈、不在 npm，無法用 lockfile
    與 npm audit 管理。否決。
  - exceljs：相依樹大且老（archiver／unzipper／uuid 8 等），最後發布 2024-12，體積遠大於只需寫三張簡單工作表的需求。否決。
  - 伺服器端產生（Route Handler）：要新增端點、授權與重複查詢，且資料本來就在頁面上；否決（見決策 1）。
  - CSV：沒有多工作表、沒有數值格式與欄寬，中文在 Excel 還要處理 BOM；規格書非目標。
已知限制（security-reviewer 2026-10-25，Low）：
  - 套件內部的共用字串表是一般物件（initializeSharedStrings.js 的 `{}`）：服務／設計師名稱剛好是 `constructor`、
    `__proto__`、`toString` 等 Object.prototype 成員時，該儲存格會寫成 `function Object() { [native code] }` 之類的
    內容、Excel 開檔會跳修復對話框。只影響完整性（不是注入、不是 prototype pollution），名稱只有店長能寫；
    不在匯出端偷改文字，列為已知限制，向上游回報，必要時以 patch-package 改成 Object.create(null)。
    （2026-10-28 TASK-096：已重現、備妥上游回報草稿，使用者選定方案 A 等上游修，不改程式碼；見文末 TASK-096 段。）
  - 公式注入的殘留風險：字串儲存格開檔不會被計算；但使用者在該格按 F2＋Enter、另存 CSV 再開、或經純文字剪貼簿貼回，
    Excel 會重新解析成公式。目前匯出內容只有店長自己寫的名稱，屬自己攻擊自己；**日後若匯出顧客可控的文字
    （姓名、備註），必須重新評估（屆時需加 ' 前綴或改寫規則）**。
  - fflate 的非同步 zip 只在單一檔案 ≥160KB 時才用 Worker（blob: URL）；日後若加上 CSP 且匯出可能超過此大小，
    需要 `worker-src blob:`。
  - 檔名清理另移除 Cc／Cf／Zl／Zp 字元（RLO 雙向控制、零寬字元等），並避免清理後重新接成 ".."（先刪字元再處理點、
    截斷後去掉結尾的點）；ZWJ 組合 emoji 因此會被拆開，屬可接受的外觀代價。
影響：套件跑在店長的瀏覽器（同源、能碰 session）→ 供應鏈風險靠鎖版本＋動態載入＋lockfile＋讀碼審查緩解；
      日後升級 write-excel-file 或 fflate 時，必須重跑 tests/admin/reports-export.test.ts（讀回測試）並複查 browser 入口
      的原始碼是否新增網路／eval／儲存空間存取。若資料量逼近 5000 列／月，匯出會跟著改為資料庫端彙總的結果。
```

## TASK-094（儀表板與報表 Epic 收尾）：count 驗證分頁、超量專用提示、移除示範資料腳本

```text
日期：2026-10-25
決策：
  1. 分頁改以 count 驗證：第一頁帶 count: "exact"，由總筆數決定頁數，取回列數必須等於總筆數，否則回一般錯誤。
     原做法以「這頁不足 1000 列」判斷最後一頁，PostgREST 的 Max rows 若被調小（例如 500），某月 600 筆只會取到
     500 筆且不報錯，違反「寧可失敗也不顯示被截斷的數字」（architect 總覽審查 M1）。不新增資料庫函式或 migration。
  2. 超過 5000 列回可辨識的錯誤碼：錯誤型別在 lib/admin/reports.ts 內擴充為 AdminError & { code?: "too_many_rows" }
     （不改共用的 AdminError）。畫面新增 `status: "too_large"`：warning 提示「此期間的預約筆數超過上限（5,000 筆）／
     請改用較短的期間（日或週）。」、沒有重試按鈕（重試沒有意義）、工具列仍可操作；匯出按鈕與設計師 chip 同「錯誤」狀態。
     為此在兩個面板各加一行分支（TASK-094 任務卡原列「面板元件不得觸碰」，屬必要的最小範圍擴張，已向使用者說明）。
  3. 移除 scripts/seed-demo-reports.mjs（TASK-092 為了在正式庫檢視版面而加，驗收後已清除資料）。理由（security-reviewer
     M-1）：用 service_role 對正式庫寫入／刪除；清除只靠姓名前綴「【示範】」，顧客若在前台填入同樣前綴，真實預約會被
     誤刪且不會通知任何人；未來 14 天的示範預約會佔用真實設計師時段。用途已達成，也不在任何任務範圍內，直接移除。
  4. 0020_down 檔頭補上回滾前備份快照的 SQL 與「2026-10-25 之後的快照是真實下單價、回滾後無法還原」的警告
     （只改註解，SQL 邏輯不變）。
情境：Epic 完成後 architect＋security-reviewer 總覽審查皆為「有條件通過」，本卡處理其通過條件與低成本修正。
考慮過的替代方案：
  - 「抓到空頁才停」：offset 固定 1000，Max rows 小於 1000 時會跳過列，不可行。
  - 超量時仍顯示重試：重試永遠失敗，店長無從得知該改用較短期間。
  - 保留示範腳本並加防呆（email／phone 為 null 才刪、未來日期預設不產生、--target 防呆）：維運成本高於它的價值。
影響：資料量逼近 5000 列／月時，升級為資料庫端彙總，口徑整個搬進 SQL 成為唯一來源（見 project-map「已知限制」）；
      designer-filter 的 countActiveAppointments 與 summarize().booked 必須等價（新增預約狀態時兩處要一起改）。
```

## TASK-095（維運）：升級 next 16.3.0 → 16.4.3，處理 npm audit 的 critical 與三項 high

```text
日期：2026-10-25
決策：
  1. next、eslint-config-next 以精確版本同升 16.4.3（npm install --save-exact），不使用 npm audit fix --force，
     不新增 overrides。npm ls next 只有一份（@mui/material-nextjs 共用）。
  2. nanoid（3.3.17→3.3.20）、source-map-js（1.2.1→1.2.2）是 next/postcss／jsdom 的傳遞相依，升 next 後仍殘留，
     改用 `npm update nanoid source-map-js` 只動 lockfile、在原宣告範圍內升級；sharp 隨 next 升到 0.35.5（@img/sharp-* 同步）。
     結果：`npm audit --omit=dev` 由 1 critical＋3 high 降為 0。
  3. 升級範圍僅 next／eslint-config-next 及其傳遞相依（含 @swc/helpers、@next/*、fastq 的 dev 傳遞變動）；
     不順便升 @mui／react／@supabase。lockfile 無新增或移除套件、無新增 install script、integrity 與 registry 一致
     （security-reviewer 快速複審通過）。
  4. proxy.ts、next.config.ts 不需修改。16.4.3 release note 唯一相關的是「proxy.ts 不再載入 app-page runtime」；
     本專案 proxy 路徑只用 next/server 與 @supabase/ssr，不依賴它，且未登入存取 /admin/* 仍 307 導向 /login
     （dev 與 production 皆已實測）。
情境：Epic「儀表板與報表」完成後 security-reviewer 總覽審查建議；公告涉及的功能（next/image、next/og、use cache、
      Server Actions）本專案目前都沒用，但日後新增就可能碰到。
已知限制：
  - 完整 `npm audit`（含 dev）仍有 7 項（vitest 鏈的 tinypool critical、vite／@vitest/mocker、zod、js-yaml、
    brace-expansion），皆為測試／lint 工具，不進正式環境。其中 tinypool 需 vitest 主版本升級，另案評估。
  - package.json 的 dependencies 全為精確版本，但 devDependencies 本來就有 `^`（eslint、typescript、vitest 等），
    與任務卡「無 ^」的描述不符，以此為準；部署與 CI 應用 npm ci 以鎖定 lockfile。
  - 升級後第一次 `next build` 曾失敗於 next/font/google 的 Noto_Serif_TC（找不到 turbopack font 模組），之後同一份
    程式碼連跑 4 次 build 都成功。dev server 日誌顯示當時 fonts.gstatic.com 的 woff2 下載「Connection timed out」，
    且我清空 .next 使字型快取歸零而需要重新下載近百個子集；網路恢復、重啟 dev server 後恢復正常。判斷為字型下載逾時，
    而非 16.4.3 的缺陷，但沒有在 16.3.0 上重現對照；若日後在 CI 或部署偶發，先檢查對 Google Fonts 的網路。
影響：正式環境（Vercel）要重新部署才會套用；部署由使用者決定。
```

## TASK-096（維運）：write-excel-file 共用字串表缺陷——重現、上游回報草稿，選方案 A（等上游修）

```text
日期：2026-10-28
決策：
  1. 選方案 A「等上游修，維持已知限制」（使用者選定，agent 建議）：不改任何程式碼與相依，不新增 patch-package 或 install script，
     不在匯出端改文字或擋匯出。
  2. 已重現並備妥上游回報草稿：ai/artifacts/儀表板與報表/upstream-issue-write-excel-file.md。送出由使用者自行決定與操作；
     agent 沒有對外發布任何內容。上游 write-excel-file 4.1.1 已是 npm latest（2026-10-28 查證），尚未修。
  3. 查證結果（比 TASK-093 當時的描述更精確）：
     - 受影響的是 Object.prototype 的全部 12 個自有屬性名稱：constructor、__proto__、toString、valueOf、hasOwnProperty、
       isPrototypeOf、propertyIsEnumerable、toLocaleString、__defineGetter__、__defineSetter__、__lookupGetter__、__lookupSetter__。
       大小寫不同（Constructor）或加字尾（constructors）都不受影響。
     - ESM（modules/）與 CommonJS（commonjs/）兩份建置都有同一個缺陷；本專案瀏覽器端與測試走的是 ESM。
     - 套件內其他 lookup table（initializeStyles.js 的 format／font／fill／border）的鍵由程式本身產生，不是使用者輸入，
       只有共用字串表會被使用者文字打到。
     - 以真實匯出管線（buildExportSheets）實測：設計師篩選名稱為 toString → 「彙總」表 B3 壞掉；服務名稱為 constructor →
       「熱門服務排行」表 B3 壞掉；兩個字串都不在 sharedStrings.xml；同檔的正常服務「剪髮」不受影響。
     - 建議修法（Map）已在暫存副本套用到兩份建置並驗證：重現腳本由 5／9 個儲存格錯誤變為 0／9。
情境：TASK-093 security-reviewer L-1（Low）與 Epic 總覽審查；只影響匯出檔完整性，不是注入、也不是 prototype pollution，
      名稱只有店長能寫入，且店長幾乎不會把服務取名為這些字。
考慮過的替代方案：
  - B 本地 patch（patch-package）：要同時 patch ESM 與 CommonJS 兩個檔案，新增 devDependency 與 postinstall 安裝腳本
    （供應鏈與維護成本，升級套件時 patch 可能失效）；效益與風險不成比例。
  - C 匯出端防呆（偵測 12 個保留名稱並拒絕匯出）：改變匯出行為與提示文案，要維護保留名稱清單，
    且讓店長因為一個冷門限制而無法匯出；效益不成比例。
影響：
  - 在上游修好前，名稱為上述 12 個字之一的服務或設計師，匯出檔該格內容會錯、Excel 開檔會跳修復對話框。
  - 觸發條件與因應（改名）：店長只要避免這些字當服務或設計師名稱即可；其餘匯出內容不受影響。
  - 上游修好後：升級 write-excel-file（依 TASK-095 慣例精確版本、單獨升、單獨驗證），並新增一則讀回測試
    （名稱為 constructor 的服務，匯出後解開仍是共用字串且內容原樣）；屆時可關閉此已知限制。
  - 建議每次評估升級依賴時順便看一下上游 issue 狀態；本專案不自動追蹤。
```

## TASK-098（Demo 體驗帳戶）：auth 觸發器可行性實驗，結論採用觸發器（待人工核准）

```text
日期：2026-10-30
決策：
  1. 結論：採用觸發器（架構筆記 D5 的層 2 可行）。託管 Supabase 允許在 auth.users（BEFORE UPDATE）與 auth.mfa_factors
     （BEFORE INSERT）建立觸發器；GoTrue 的資料庫角色是 supabase_auth_admin，以 current_user 區分 GoTrue 與維修通道成立。
     結論待使用者人工核准後生效；TASK-100 才真正新增 migration。
  2. 鎖定欄位清單（auth.users）：encrypted_password、email、email_change、email_change_token_new、
     email_change_token_current、recovery_token、phone、phone_change。phone_change 未實測（保守保留）。
     不得列入：confirmed_at（generated column，BEFORE 觸發器看到過期值，每列都「變動」）、last_sign_in_at、updated_at、
     email_confirmed_at、raw_user_meta_data、banned_until（D12 緊急關閉依賴它可寫）。
  3. 實測：block 模式下 Demo 帳號的改密碼、改 Email、重設密碼、啟用 MFA，以及 admin API（service_role）的改密碼／改 Email／
     改電話皆被擋；登入、refresh、登出、改 user_metadata、ban、非 Demo 帳號（含啟用 MFA）、designer001 登入皆不受影響。
     postgres 可 delete from auth.sessions（刪除後該 session 的 refresh token 失效）。
情境：TASK-098 實驗（拋棄式帳號，實驗後已清除，附證據）。詳見 ai/artifacts/Demo 體驗帳戶/verification/TASK-098.md。
考慮過的替代方案：實驗失敗就退回備案（層 3 加強並請使用者重新確認殘留風險）；因實驗成功而未採用。
影響（給 TASK-100 與後續手冊）：
  - 這個專案新建資料表預設啟用 RLS 且無 policy。觸發器以 supabase_auth_admin 讀寫的表必須顯式處理，否則寫入被拒
    （42501）會讓符合 WHEN 的 Auth 操作全回 500（含建立 Demo 帳戶）、讀取則靜默讀到零列。正式觸發器建議不讀任何設定表。
  - 資料庫例外原文（SQLSTATE P0001 與訊息）會直接出現在客戶端的 HTTP 500 回應（改密碼、改 Email、重設密碼路徑；
    啟用 MFA 路徑只有通用 unexpected_failure）；supabase-js 呈現為 message = {}。正式訊息須為不含欄位名稱的通用文字，
    前端不得依賴錯誤文字辨識被鎖。
  - postgres 無法 set role supabase_auth_admin（42501），SQL Editor 不能模擬 GoTrue；維修通道成立（postgres 直接改不受鎖）。
  - 輪換 Demo 密碼只能走 SQL Editor（admin API 也被擋）。建立 Demo 帳戶時 GoTrue 會連續 UPDATE 兩次，皆不在鎖定欄位。
  - is_demo 缺鍵時為 null，判斷需 coalesce／is true。Auth 平台升級可能改變行為，手冊須寫「登入全面回 500 時先移除觸發器」。
```

## TASK-100（Demo 體驗帳戶）：資料庫鎖定 migration 0021（待人工核准）

```text
日期：2026-10-30
決策：
  1. 新增 migration 0021：auth.users BEFORE UPDATE 觸發器（WHEN old.raw_app_meta_data ->> 'is_demo' = 'true'）與
     auth.mfa_factors BEFORE INSERT 觸發器；兩個函式皆為 SECURITY INVOKER、search_path = ''，第一行
     `current_user <> 'supabase_auth_admin'` 即放行（維修通道：SQL Editor 的 postgres 不受限）。
     SECURITY DEFINER 會讓 current_user 變成擁有者、鎖等於沒做；migration 尾端自我檢查 prosecdef = false。
  2. 鎖定欄位（最終）：encrypted_password、email、email_change、email_change_token_new、email_change_token_current、
     recovery_token、reauthentication_token（安全審查後新增）、phone、phone_change；另外 raw_app_meta_data.is_demo
     標記本身不可被改動（防止分兩步清標記繞過）。比對用 to_jsonb(NEW)／to_jsonb(OLD) 同名鍵，欄位被 Auth 移除時
     不會丟例外（代價：鎖會靜默變弱）。使用者已決定維持現狀，不改 fail-closed。
  3. 錯誤訊息固定為 'DEMO_LOCKED: this demo account is read-only'（資料庫例外原文會出現在 Auth API 的 HTTP 500 回應；
     不含欄位名稱）。前端不得依賴錯誤文字，鎖定 UI 以 isDemo 為準。
  4. 不建任何設定表、模式固定為擋（TASK-098：專案新表預設啟用 RLS，觸發器讀寫自建表會被拒而讓 Auth 操作回 500）。
  5. demo_revoke_sessions()：SECURITY DEFINER、search_path = ''、只有 service_role 可執行；自己查 is_demo 帳戶，
     筆數不是剛好 1 就 raise；刪除其 auth.sessions，回傳刪除筆數。
  6. 緊急處置分兩種用途：緊急時只貼兩行 drop trigger（保留 demo_revoke_sessions，因 demo:disable 依賴它）；
     _down.sql 只用在下線整個 Demo 功能。
情境：TASK-098 實驗結論；TASK-100 三個子代理審查（架構、安全、測試）。詳見 verification/TASK-100.md。
考慮過的替代方案：auth.identities 觸發器（擋外部帳號綁定）——增加對所有人註冊路徑的可用性風險，改為請使用者確認
  Dashboard 的 Manual Linking 關閉且無 OAuth 提供者，列為殘留風險；raw_user_meta_data 大小上限——交 TASK-109 評估。
```

## TASK-102（Demo 體驗帳戶）：一鍵進入限流 migration 0022（待人工核准）

```text
日期：2026-10-30
決策：
  1. 新增 migration 0022：資料表 demo_entry_attempts(bucket, window_start, count)（RLS 開啟、無 policy、revoke all 後
     只授權 service_role）與 RPC demo_entry_check(p_bucket, p_limit, p_window_seconds)（SECURITY INVOKER、
     search_path = ''、只有 service_role 可執行）。刻意不用 SECURITY DEFINER：函式授權與資料表授權兩層，
     誤授 execute 時仍會因無資料表權限而失敗。
  2. 全站限流時間窗改為 300 秒、上限 14（原卡片為每小時）：Supabase 的登入限額是「每 IP 每 5 分鐘 30 次」
     （使用者於 Dashboard 確認），必須同單位比較；固定窗交界最多放行 2 倍，14 × 2 = 28 < 30。
     每 IP 維持 10 分鐘 10 次。Dashboard 限額若調整，lib/demo/rate-limit.ts 的兩個常數須一起重算。
  3. 保留期 2 小時、窗長上限 3600 秒（原構想為 1 天／86400 秒）：攻擊者輪替 bucket 會讓列數隨請求成長，保留越短越不佔儲存配額。
     間隔用 '2 hours'，不用 '1 day'（夏令時間下天數可能是 23 小時）。清除放在累加「之前」，不讓交易握著熱點列鎖。
  4. 出錯一律不允許（RPC 錯誤、逾時 3 秒、回傳非布林、缺或太短（< 32 字元）的 DEMO_RATE_LIMIT_SECRET、client 建立失敗）。
  5. IP 只以 HMAC-SHA256（DEMO_RATE_LIMIT_SECRET）進資料庫；IPv6 取 /64；IPv4-mapped 視為 IPv4；不合法 IP 視同取不到，只查全站。
  6. getClientIp 只在 VERCEL === "1" 時採用 x-real-ip，其他環境回 null（只查全站，較嚴格而非較寬鬆）。
  7. 先查每 IP、不通過就不累加全站：單一 IP 狂打只能用掉全站額度的一部分。
情境：TASK-102 三個子代理審查（架構、安全、測試）；使用者於 Dashboard 確認登入限額 30 次／5 分鐘。詳見 verification/TASK-102.md。
考慮過的替代方案：每 IP 再加每小時 bucket（多一個常數與一次 RPC，單一 IP 仍需 3 個 IP 才能擋入口，未採用）；
  全站已滿時改用唯讀預檢以避免繼續寫入 IP 列（複雜度高，列為殘留風險）。
```

## TASK-103（Demo 體驗帳戶）：一鍵進入端點 POST /api/demo/enter（人工驗收通過）

```text
日期：2026-10-31
決策：
  1. Supabase 寫出的 cookie 先暫存（自訂 cookie adapter），is_demo === true 且不需要 aal2 兩項都通過才寫進回應；
     暫存區同時是 Supabase client 的 cookie 儲存，getAll 只回暫存內容、不讀請求帶來的 cookie。失敗路徑天生不帶 session cookie，
     不依賴 signOut（signOut({ scope: "local" }) 只是盡力而為的額外清理，丟例外也吞掉）。
  2. 所有失敗回同一個 403 { ok: false }、同樣的標頭與 Set-Cookie（名稱＝請求帶來的 sb-* ＋固定預設清單 base、.0～.4、-code-verifier，排序）。
     刻意不把「暫存區出現過的名稱」併入過期清單：session 分成幾塊會讓 Set-Cookie 不同，洩漏「帳密正確但不是 Demo」（架構審查）。
  3. 成功前再確認暫存區有非空的 sb-* cookie；aal 讀不到（含 currentLevel 為 null）一律失敗（fail-closed，比照 lib/auth/aal.ts）。
  4. log 只記失敗類別（config_missing、cross_origin、rate_limited、sign_in_failed、not_demo、aal2，另加 aal_error、error），
     可附一個固定字串 detail：限流原因（ip_limit／global_limit／error）或例外類別名稱；絕不記 Email、密碼、token、IP、訊息。
  5. 單元測試在模組層 mock @supabase/ssr 與限流模組，再呼叫 Route Handler；整合測試直接匯入 Route Handler 對真實 Supabase
     （拋棄式帳號、限流 mock 成放行以免消耗正式 global 額度、server-only 以 vi.mock 取代，沿用既有慣例）。
  6. 與任務卡的差異（使用者 2026-10-31 決定）：跨站失敗（cross_origin）不寫任何 cookie，其餘失敗照規格一律讓 sb-* 過期。
     原因：任務卡的「失敗一律過期」會讓惡意網站自動送出跨站 POST，使店長或面試官在本機被登出（登出式 CSRF）。
     因此同源檢查改放在最前面（早於 DEMO_ENABLED 檢查），跨站請求在任何情況都只會得到 cross_origin。
     代價：非瀏覽器端能分辨「是否通過同源檢查」（它本來就知道自己送了什麼 Origin；瀏覽器端因 CORS 讀不到回應）。
情境：TASK-103 三個子代理審查（架構、安全、測試）；is_admin() 寫入面盤點與實測見 verification/TASK-103-admin-surface.md。
考慮過的替代方案：先寫 cookie 再撤銷（signOut 失敗時管理員 session 會外流，已否決）；同源檢查在 Vercel 上只認 NEXT_PUBLIC_SITE_URL
  （preview 部署網址會被擋，且對 CSRF 無實質增益，未採用）；把 TOTP 判斷抽成共用函式（lib/auth/aal.ts 不在本卡範圍，列為建議）。
```

## TASK-108（Demo 體驗帳戶）：還原函式 reset_demo_data 與 demo_list_storage_objects

```text
日期：2026-10-31
決策：
  1. reset_demo_data(p_payload jsonb, p_dry_run boolean)：SECURITY DEFINER、search_path 為空、只有 service_role 可執行；p_dry_run 無預設值且不得為 null。
  2. dry-run 以內層 BEGIN…EXCEPTION 區塊在最後 raise 自訂 SQLSTATE 'RD001' 回滾子交易，只攔截該 SQLSTATE；鎖（pg_try_advisory_xact_lock、
     lock_timeout、lock table appointments in exclusive mode）與守門放在內層之外，筆數變數宣告在外層。
  3. 守門在任何寫入之前：confirm、必要鍵與型別、最低筆數（services／designers／designer_services／customers／appointments ≥ 1）、business_hours 剛好 7 列、
     預約與顧客 email 必須為 null、預約不得帶 access_token。
  4. Demo 使用者由函式查 is_demo 帳戶決定（必須剛好 1 個）；payload 的 demo_user_id 只作交叉檢查。admins 只更新 Demo 那一列，列不存在就 raise（不自行新增管理員）。
  5. DELETE 一律 where true（相容 pg-safeupdate）；寫入一律以 jsonb_to_recordset 明確列欄位，沒有動態 SQL。
  6. 整合測試只准 dry-run：唯一的呼叫點是 callReset，dryRun 型別是 true | null | "omitted"（編譯期就不能傳 false），另有掃描測試（tests/lib/demo-reset-test-scan.test.ts）
     檢查整個 tests/ 目錄與 scripts／lib／app。「不傳 p_dry_run」不能用 undefined 表示（會觸發 JS 預設參數），改用 "omitted"。
  7. 沒有真實 Demo 帳戶時，測試建立拋棄式 is_demo 帳戶並暫時登記進 admins；有真實 Demo 帳戶時直接使用、不修改它。
  8. 審查後修訂：一條 lock table 鎖住 11 張被覆寫的表（customers → appointments → 其他）；守門區拒絕被覆寫表上白名單以外的觸發器
     （新增觸發器要同步更新函式內白名單，例如 TASK-116）；demo_user_id 必填；Demo 必須已登記在 admins（守門區檢查）；portfolio_images 至少 1 筆；
     非 dry-run 時 RD001 往外丟。回傳比任務卡多：counts 另含 booking_policy／store_settings／admins，另有 deleted（鍵名 portfolio_images 對應表 designer_portfolio_images）。
  10. 重置閘門（使用者 2026-10-31 選 A）：demo_reset_gate 單列表 + demo_reset_open_gate(1～30 分鐘)／demo_reset_close_gate／demo_reset_gate_is_open，皆只有 service_role 可執行，
     資料表不授權給任何 Data API 角色。真實還原（p_dry_run=false）需要閘門開著，成功時在同一個交易內關閘門（單次通行證）；dry-run 不需要。
     還原端點（TASK-110）在呼叫前 open、finally 時 close。**只擋程式 bug 與誤呼叫，擋不住持有 service role key 的人**（open 同樣只有 service_role 能呼叫）；
     更強的做法（例如 open 需要只存雜湊的第二組密鑰）未做。閘門關閉時拒絕真實還原的路徑不在測試中實跑（失敗代價是清空正式庫），
     改由 0024 尾端自我檢查確認 reset_demo_data 本文含閘門檢查，並測閘門函式本身。
  9. 測試端：每列只留 sha256（失敗輸出不外洩顧客個資與 access_token）、讀到列數必須等於總數、快照含 auth.users 與四個 bucket；callReset 有執行期護欄；
     掃描測試改為全 repo 白名單並隨 test:demo-reset 一起執行（TASK-109 新增合法呼叫時，把該檔案加進白名單，不得刪除掃描測試）。
情境：TASK-108 為高風險卡；第一次對正式庫跑 dry-run 前先做 13 張表的唯讀備份，測試後逐列比對。詳見 verification/TASK-108.md。
考慮過的替代方案：回傳 referenced paths（改由 TS 端算，RPC 只回筆數）；鎖用 access exclusive（會擋前台讀取，改用 exclusive）；搶不到 advisory lock 時排隊（改為立即失敗）。
```

## TASK-109（Demo 體驗帳戶）：還原編排 lib/demo/reset.ts

```text
日期：2026-10-31
決策：
  1. 流程固定：prepare → sync_images → reset_database → cleanup_orphans → revoke_account → health_check。資料庫提交之前的失敗不留下半套；
     提交之後的階段失敗不回滾、也不阻止後面的階段，最後回報第一個失敗階段，summary.databaseRestored 區分「資料沒動」與「資料已還原」。
  2. runDemoReset 是唯一可以對正式庫真實呼叫 reset_demo_data(p_dry_run=false) 的程式；正式入口只接受 { supabase, now, dryRun, deadlineMs }，
     dryRun 必須明確傳入且是 boolean（執行期檢查）。測試注入點在 runDemoResetWithDeps，掃描測試限制只有 reset.ts 與其單元測試能引用。
  3. 圖片網址是否為本專案由網域判斷，沒有預設網域：拿不到就失敗；seed 內每個圖片網址都必須是本專案網址且至少一張，
     否則引用集合會變空、孤兒清理會刪光公開 bucket（架構與安全審查共同列為高風險）。
  4. 孤兒清理：只在資料庫提交之後；白名單寫死三個公開 bucket（絕不碰 demo-seed）；admin-assets 只刪擁有者是 Demo 且不被任何 admins 引用的；
     只刪早於「還原開始時間減 60 秒」的物件；同網域但無法解析的引用網址 → 整個清理跳過並留警告（仍 ok: true）；列出剛好 1000 筆視為截斷。
  5. 內容不同的圖片「先 remove 再 copy」（任務卡與 D7 的設計；Storage copy 不能覆寫）。已知取捨：remove 成功、copy 失敗時公開 bucket 暫時缺檔，
     下次執行補回。TASK-112 必須實測 copy 後 eTag 與來源一致（第一次真實還原後 dry-run 的 sync.planned.replace 應為 0）。
  6. 閘門：真實還原前才開（3 分鐘），只要呼叫過開門 finally 就關；進入資料庫前至少要剩 15 秒（交易、帳戶處理、健康檢查）。
  7. 健康檢查用獨立 anon client（persistSession: false）登入，只結束自己剛建立的 session（scope: local），不修復、不改密碼。
  8. 測試用假 client；以變異測試（13 項）證明關鍵規則被測試守住。
情境：TASK-109 三個子代理審查（架構、安全、測試）；對正式庫只做唯讀實地驗證（真實 Storage 清單比對 45/45 相同）。詳見 verification/TASK-109.md。
考慮過的替代方案：覆寫改用「下載後 upsert 上傳」（原子，但偏離任務卡，未採用）；origin 預設為專案網址常數（會與環境不一致，改為必須取得）。
```

## TASK-113（Demo 體驗帳戶）：Storage 擁有者限制與 Demo 上傳上限 migration 0025

```text
日期：2026-10-31
決策：
  1. 不改任何既有 policy、bucket 或物件；只新增 3 條 RESTRICTIVE policy 與 1 個 BEFORE INSERT 觸發器。尾端自我檢查比對既有 PERMISSIVE policy 的內容指紋（md5），確認套用前後相同。
  2. admin-assets 的 update／delete 另加 owner_id = auth.uid()::text。目的：Demo（也是 is_admin()）不能刪或換 designer001 的頭像。
     owner_id 為 null 的物件（service role 上傳，例如還原複製進來的 seed）連一般管理員也動不了，這是預期行為。
  3. Demo 完全不能 update（RESTRICTIVE，JWT app_metadata.is_demo）。實測 storage-api 的 move 可把物件從 store-assets 搬進 admin-assets，繞過上限；
     專案的上傳流程只用 insert（新 uuid 路徑、不帶 upsert），不需要 update。
  4. Demo 物件數上限（每個公開 bucket 30）用 BEFORE INSERT 觸發器，不用 RLS policy：實測 RLS 只在 storage-api 寫入前的預檢生效，
     簽名上傳網址（物件數為 0 時簽出 35 個網址，35 個全成功）與並行上傳（40 個成功 34 個）都能超過上限；storage-api 的實際寫入走的不是使用者連線，
     所以觸發器以資料列的 owner_id 查 auth.users 的 app_metadata.is_demo 判斷 Demo（不讀 JWT claim），並以 pg_advisory_xact_lock 讓同一帳戶寫入排隊再計數，成為硬上限。
     錯誤碼 42501，storage-api 回「違反資料列安全政策」。service role 上傳的物件 owner_id 為 null，不受影響。
  5. 觸發器函式 SECURITY DEFINER、search_path 為空、API 角色不可執行；自我檢查驗擁有者可繞過 RLS（否則計數永遠是 0）。緊急停用：drop trigger if exists demo_storage_cap_guard on storage.objects;
  6. 不處理資料庫列數上限（TASK-116 另案）；designer-assets／store-assets 的跨使用者 update／delete 不加限制（接受，每日還原補回）；insert 不綁定 owner_id（storage-api 一律取 JWT 的 sub）。
  7. 調整上限：改 demo_storage_cap_guard() 內的 30 後整份重跑；TASK-116 設計時再決定是否集中管理上限常數。
情境：TASK-113 高風險卡。初版用 RLS 預檢做上限，安全審查指出可繞過，實測屬實後改用觸發器；三方子代理審查的處置見 verification/TASK-113.md。
考慮過的替代方案：RLS policy 內計數（擋不住簽名網址與並行）；用 sequence 當不會回滾的票數（失敗嘗試也耗額度，且每日還原要多重置一步）；接受現況並改寫殘留風險（可在一天內灌爆免費方案配額）。
為何選這個：觸發器在資料列真正寫入時執行，涵蓋 storage-api 所有寫入路徑，回滾只需 drop trigger 與 policy；託管 Supabase 已證實允許在 storage.objects 建立觸發器。
```

## TASK-114（Demo 體驗帳戶）：Demo 發動的改期／取消不寄信 migration 0026

```text
日期：2026-10-31
決策：
  1. create or replace public.notify_appointment_update()：函式開頭多一道守門 `coalesce(auth.jwt() -> 'app_metadata' ->> 'is_demo', '') = 'true'` 就 return new，
     不讀 Vault、不呼叫 net.http_post；其餘本文與 0012 逐字相同。觸發器 appointments_notify_update 不重建、WHEN 條件不動；notify_appointment_insert（確認信）不動。
  2. 判斷來源是 JWT 的 app_metadata（簽章後的 claim，使用者無法改寫），不讀 user_metadata 等可被使用者修改的欄位。
     與 0025 觸發器不同：這裡的 UPDATE 是 PostgREST 請求內的同一個交易，request.jwt.claims 有值；0025 的 storage-api 寫入不走使用者連線，所以當時改查 owner_id。
  3. 失敗方向安全：守門內讀 JWT 若拋例外，既有 exception handler 吞掉並 return new，結果是「不寄信」。
  4. 沒有 JWT 的呼叫者（cron、service role、顧客前台）行為與 0012 相同。注意：Demo 每日還原（0024）以 service role 執行、沒有 Demo JWT，但它對預約是先 delete 再 insert，不發 UPDATE，不會觸發本函式；INSERT 路徑由 0024 直接拒收帶 customer_email 的 seed（0024 第 236-241 行），不靠人工確認。守門依賴「Demo 的寫入一定帶 Demo JWT 經 PostgREST」，日後若新增伺服器端以 service role 代 Demo 改預約的功能，守門會靜默失效，需另行處理。
  5. 驗證方式：(a) tests/lib/demo-mail-suppress-migration.test.ts 逐字比對 0026 與 0012、_down 與 0012；(b) TASK-114-verify.sql 在 SQL Editor 內以 set_config 模擬各種 JWT，數 net.http_request_queue 增量，
     以 raise exception 收尾保證 rollback、不寄信；(c) test:demo-mail-suppress 以真實 Demo／非 Demo 拋棄式帳號改期／取消，用 DEMO_MAIL_TEST_EMAIL（使用者自己的信箱）做正反對照（套用後 1 封、套用前 3 封）。
  6. 殘留：reminder_sent_at 可被清成 null 造成提醒信重寄（頻率受每日排程限制）；Demo 以外的管理員仍可對任意 Email 預約改期寄信（本來就是正式功能）。
  7. 三方子代理審查（2026-10-31）皆有條件核准、無 MUST FIX。新增測試擋住「日後 migration 複製 0012 洗掉守門」（編號最大的重新定義者必須含守門條件）。verify.sql 改版：比對實際條件字串、只數起點 id 之後的列、補負向情境。
  8. 未關閉的殘留（待使用者決策，見 verification/TASK-114.md）：R1 Demo 靜默取消可解除「每 Email 最多 3 筆」上限，使確認信（0011，D13 刻意保留）能無限次寄給任意 Email；R2 Demo 正常改期會清 reminder_sent_at，使提醒排程對任意 Email 寄提醒信。0026 只堵改期／取消信，D13「借寄件網域對任意 Email 發信」的目標並未完全收斂。
情境：TASK-114 高風險卡（改寫既有函式）；對應 D13 使用者決定方案 A。migration 由使用者在 SQL Editor 套用。
考慮過的替代方案：停用 Demo 的整個通知（改動面更大）；在應用程式層擋（webhook 由資料庫觸發，應用層擋不住 service role 以外的來源，且要改 route）；在 webhook 端點辨識 Demo（payload 不含發動者）。
```

## TASK-116（Demo 體驗帳戶）：Demo 專屬資料筆數上限 migration 0027

```text
日期：2026-11-01
決策：
  1. 六張表各一個 BEFORE INSERT FOR EACH ROW 觸發器 demo_row_cap_<表>，共用 public.demo_row_cap_guard()。上限集中在函式內一個 case：
     services 10、designers 5、designer_services 50、designer_leaves 20、designer_portfolio_images 60、closed_dates 20。
     services／designers 是使用者 2026-10-31 指定，其餘 2026-11-01 核准 TASK-106 建議值。**customers 24／appointments 640 於 2026-11-01 三方審查後移除（使用者決定）**：Demo 只能經 create_appointment 寫入這兩張表，匿名訪客能呼叫同一個 RPC，上限擋不到灌資料的人，反而讓匿名流量刷 12 支新電話就能讓 Demo 當天無法預約；0027 會清掉初版建立的兩個觸發器，容量防護改靠 TASK-120／121。
  2. 先以 current_setting('request.jwt.claims') 字串預篩（沒有 is_demo 就放行，不解析 JSON、不依賴 auth schema；審查後新增，失敗方向只擋疑似 Demo 的請求），疑似 Demo 才檢查簽章後的 app_metadata.is_demo = 'true'（與 0026 相同）；其餘（一般管理員、service role、還原、SQL Editor、匿名）第一個判斷就放行。
     不讀 user_metadata 或頂層欄位（verify.sql 有偽造 claim 的負向案例）。
  3. 計數是整張表總列數（不只 Demo 新增的）。為了不被 RLS 縮小，函式 SECURITY DEFINER、search_path 為空，尾端自我檢查擁有者可繞過 RLS；
     與草稿任務卡的 security invoker 不同（理由見驗證報告）。API 角色（含 service_role）不可執行。
  4. 硬上限：pg_advisory_xact_lock（每張表一把，只有 Demo 會取）讓寫入排隊再計數；達上限 raise P0001，訊息 DEMO_ROW_CAP: <表> (cap N)，hint 為白話文字。
     與草稿的「軟上限」不同：0025 實測軟上限可被並行繞過，硬上限的成本只落在 Demo。
  5. reset_demo_data 的守門區會拒絕白名單以外的觸發器（0024 決策 8），所以 0027 以 create or replace 重新定義 reset_demo_data，**除白名單新增八個名稱外逐字相同**；
     _down 還原成 0024 本文。tests/lib/demo-row-caps-migration.test.ts 逐字比對，並檢查「所有 migration 在被覆寫的十一張表上建立的觸發器，都在編號最大的 reset_demo_data 白名單內」，日後漏補會失敗。
  6. 上限集中管理：函式內單一 case（回答 TASK-113 留下的問題）。調整 = 改數字後整份重跑，並同步 tests/lib/demo-row-caps-migration.test.ts 的 APPROVED_CAPS 與 TASK-116-verify.sql 的 v_caps（獨立抄寫的雙重檢查）。
     緊急停用單表：drop trigger if exists demo_row_cap_<表> on public.<表>;
     _down 把 reset_demo_data 寫死成 0024 本文：0027 之後若有 migration 又重新定義該函式，不得使用 _down（會蓋掉那份修改）。
  7. 已知行為：closed_dates／designer_leaves 的 upsert 在表已滿時，對已存在的日期也會被拒絕（BEFORE INSERT 先於 on conflict）；接受。
  8. 不納入本卡：audit_log 每帳戶上限（TASK-122）、services／store_settings 欄位長度 CHECK（TASK-123）——兩者皆為 Demo 入口前置條件，已加入 TASK-112 依賴；前端白話錯誤訊息；匿名顧客預約（TASK-120／121）。
  9. tests/lib/demo-reset-test-scan.test.ts 白名單新增 0027 與其單元測試（兩者出現 reset_demo_data 字樣但不呼叫）。
情境：TASK-116 高風險卡；對應 D14。migration 由使用者在 SQL Editor 套用。
考慮過的替代方案：每表各寫一個函式（上限分散）；用 trigger 參數傳上限（改上限要重建觸發器）；RLS policy 內計數（TASK-113 已證實擋不住並行）；在 reset_demo_data 用 like 'demo_row_cap_%' 放行（比明確名單寬，漏網風險）；用暫時降級白名單檢查的旗標（增加還原路徑的複雜度）。
為何選這個：一個函式一個來源、與 0025 同一套硬上限做法、只動 reset_demo_data 的白名單且有逐字比對把關。
```

## TASK-111（Demo 體驗帳戶）：Epic 總決策、緊急關閉指令與營運手冊

```text
日期：2026-11-01
決策（本條目彙整整個 Epic 的定案決策，細節與審查過程見各 TASK 條目與 architecture-notes.md）：
  1. 同庫全功能 Demo：Demo 是 admins 表裡的一般管理員（auth.users.raw_app_meta_data.is_demo = true，由 service role 設定，使用者本人無法改寫），
     與 designer001 共用同一個 Supabase 專案。不採唯讀，因為本專案的賣點都是寫入流程（改期、時段衝突、請假、營業時間連動可預約時段）。
     代價是 Demo 就等於 is_admin() 的全部寫入權限，防線靠下列各層，而不是靠限制 Demo 的角色。
  2. 一鍵進入（推翻早先「只填入欄位、不自動送出」與「不做伺服器端一鍵登入」）：POST /api/demo/enter 由伺服器端代為登入，
     Demo 密碼只存在伺服器環境變數，不顯示在畫面、README 或前端 bundle；cookie 暫存、驗證 is_demo 與 aal 之後才寫進回應（TASK-103）。
  3. 鎖三層：(a) 前端停用與橫幅（提示用，不是防線）；(b) 資料庫觸發器 auth.users BEFORE UPDATE 與 auth.mfa_factors BEFORE INSERT（TASK-100）；
     (c) 每日還原刪 MFA factor、撤銷 session、健康檢查（只回報不修復）。
     觸發器鎖定欄位：encrypted_password、email、email_change、email_change_token_new、email_change_token_current、recovery_token、
     reauthentication_token、phone、phone_change，另外 is_demo 標記本身不可改。寫法限制：函式必須 SECURITY INVOKER（DEFINER 會讓 current_user
     變成擁有者、鎖等於沒做）、WHEN 只限定 is_demo 的列、不建任何設定表、錯誤訊息固定不含欄位名稱。
     admin API 改 Demo 也會被擋（同樣經過 GoTrue），輪換密碼與修復帳戶只能走 SQL Editor 的 postgres 角色。
  4. 還原範圍與順序：services／designers 與三張子表／business_hours／closed_dates／booking_policy／store_settings／appointments／customers 整表還原成 seed；
     audit_log 只刪 Demo 帳戶的列；admins 只還原 Demo 那一列。順序固定：同步圖片（只新增與覆寫）→ 單一交易 reset_demo_data → 孤兒清理（白名單三個公開 bucket，
     絕不碰 demo-seed）→ 刪 MFA 與撤銷 session → 健康檢查。資料庫提交之後的階段失敗不回滾也不阻止後面階段。
     手動真實還原不受 DEMO_RESET_ENABLED 約束（旗標只管排程），需 CRON_SECRET 與 confirm=RESET_DEMO；排程模式不帶任何 query。
  5. designer001 不動清單：登入密碼、Email、MFA、admins 個人資料與頭像、稽核紀錄、他上傳的 admin-assets 物件（TASK-113 讓 Demo 無法刪除或更新）。
     原因：排程無人值守，若覆寫憑證而 seed 與實際密碼不同，作者會被鎖在後台外面。
  6. 寄信：預約確認信照寄；Demo 發動的改期與取消不寄信（0026，判斷來源是請求 JWT 的 app_metadata，TASK-114），並在最終確認後以說明視窗示意正式環境會寄出的通知信
     （TASK-115）。這推翻 TASK-080 原寫的「Demo 環境關閉寄信」，該卡的註記已同步更新。
  7. 暗啟動順序：本 Epic 的 migration 全是加法 → 先套用 migration → 合併到 master（DEMO_ENABLED 與 DEMO_RESET_ENABLED 皆關閉）→ 部署 → 建立帳戶、匯入圖片 →
     dry-run → （先備份、使用者同意）手動真實還原 → 驗證 → 開 DEMO_ENABLED 並 Redeploy → 最後開 DEMO_RESET_ENABLED 並 Redeploy。
     理由：只有一個 Supabase，git 分支隔離不了資料庫；vercel.json 只有 master 會部署且 Cron 只在 production 執行，「先部署驗證再合併」做不到。
  8. 備份：Supabase Free Plan 沒有專案備份，真實還原前必須自建備份（TASK-117）；備份的還原只走 restore.sql，不走 Demo 還原函式（它拒絕含 Email 的預約）。
  9. 緊急開關（本卡）：scripts/disable-demo.mjs，npm run demo:disable／demo:enable。
     - 關閉 DEMO_ENABLED 只擋新的進入，已發出的 session 與 refresh token 仍有效，所以另做指令：依序「刪 admins 列（is_admin() 立即失效）→ 封鎖帳戶（ban_duration）→ demo_revoke_sessions()」。
       與架構筆記 D12 的順序不同：封鎖排在撤銷 session 之前，否則封鎖前的空檔訪客可重新登入拿到新 session，日後 demo:enable 重新登記 admins 後它又變回管理員
       （TASK-100 審查已建議「先 ban 再撤銷」）。每一步獨立、一步失敗不阻止其他步驟，結束後重新讀取狀態檢查；可重複執行。
     - 目標帳戶一律由「is_demo 且剛好 1 個」決定，不接受命令列指定帳號，所以不可能對 designer001 動手；有 DEMO_EMAIL 時 Email 必須相符；預設只預覽，--yes 才寫入。
     - demo:enable 解除封鎖並重新登記 admins（顯示名稱「Demo帳號」，其餘個人資料由下次還原補回），不會自動開入口。
  10. 營運手冊 docs/demo-account.md：不含任何帳密、金鑰、Email；每個指令與 SQL 標明驗證狀態（已實跑／agent 無法實跑），無法實跑者寫明第一次使用時如何確認。
情境：TASK-111（文件與營運指令卡）；彙整 TASK-097～117 的決策。demo:disable／enable 對拋棄式 Demo 帳號實測，見 verification/TASK-111.md。
考慮過的替代方案：只靠改 DEMO_ENABLED 並 Redeploy（擋不住已發出的 session）；封鎖放最後（見上，空檔風險）；讓指令接受 --user-id（多一條動到非 Demo 帳號的路徑，已否決）；
  唯讀 Demo（與賣點衝突）；為每個環境另建 Supabase 專案（超出免費方案與作品集範圍）。
影響與殘留風險：
  - 顧客資料互相可見：Demo 能讀全部 appointments／customers，面試官輸入的資料會被下一位看到（使用者已接受；README 請訪客勿輸入真實個資）。
  - 資料量與配額：Storage 每個公開 bucket 30 個物件（所有訪客共用，0025）、六張表的總列數上限（0027）；audit_log 上限（TASK-122）、欄位長度（TASK-123）、
    匿名顧客預約的容量（TASK-120／121）尚未完成，是開啟入口前要確認的前置條件。
  - 公開前台可被竄改最長約 24 小時（店名、Logo、作品集、價格），使用者已接受；立即止血用 demo:reset --yes 或 demo:disable。
  - 觸發器依賴 Auth 平台目前的連線角色與寫入欄位，升級後可能失效或誤擋；對策是手冊 §7.4 的兩行 drop trigger（不要用 _down.sql）。
  - Demo 使用者可從 console 呼叫 global signOut 踢出其他面試官（可再按一次進入）；DEMO_EMAIL 公開，必須是作者控制的信箱；
    正式環境沒設 DESIGNER_EMAIL 時 Email 比對無作用，is_demo 驗證才是主要防線。
  - test:demo-disable 只能在沒有真實 Demo 帳戶時執行（指令要求 is_demo 剛好 1 個）；之後的回歸靠假 client 的單元測試。
  - 手冊中的 SQL Editor 語句（檢視、輪換密碼、稽核清理）agent 沒有存取權限，未實跑，已在手冊標明。

## TASK-122（Demo 體驗帳戶）：Demo 的 audit_log 容量防護 migration 0028

```text
日期：2026-11-01
決策：
  1. 新增 migration 0028：audit_log 的 BEFORE INSERT 觸發器 demo_audit_log_cap，函式 demo_audit_log_cap_guard()（SECURITY DEFINER、search_path 為空、API 角色全部收回 execute）。
     只對 Demo JWT（簽章後的 app_metadata.is_demo）生效；一般管理員、service role、匿名、SQL Editor 在第一個判斷就放行。
  2. 每帳戶計數（以 JWT 的 sub，上限 500，數字待使用者確認）：不能用整張表總列數，designer001 的紀錄會無限成長、遲早讓 Demo 永遠被擋。
     硬上限用 pg_advisory_xact_lock（key 帶 actor）讓同一帳戶的寫入排隊再計數，依賴 READ COMMITTED。
  3. 三項限制（安全審查後）：(a) 單筆大小：event_type／entity_type ≤ 64 位元組（0019 只有格式檢查沒有長度限制，只限筆數守不住容量，每筆最壞約 20 KB、500 筆最多約 10～12 MB）；
     (b) 單一請求最多 20 列（交易內計數器 demo.audit_rows，set_config 的 is_local = true；限制「寫入後再中止」造成的 dead tuple 膨脹；recordAdminAction 每次只寫 1 列）；
     (c) actor_id 必須等於 JWT 的 sub，沒有 sub 也拒絕（日後若有 SECURITY DEFINER RPC 代為寫入自訂 actor_id 也不會悄悄繞過）。
  4. 預篩與解析用同一份 claims 字串（coalesce(claims, claim)），不再另外呼叫 auth.jwt()（審查 N1：兩者可能讀到不同來源）。與 0026／0027 不同，因此本函式不依賴 auth schema。
  5. 取鎖前 set_config('lock_timeout', '2s', true)：攻擊者佔住鎖時，排隊的 Demo 請求最多等 2 秒，不長時間佔住 PostgREST 連線而拖累前台預約。極端排隊時 Demo 會多出 55P03 失敗，不影響不超過上限。
  6. 不改 reset_demo_data：audit_log 不在它覆寫的十一張表內（還原只 delete … where actor_id = Demo），白名單只檢查那十一張表，所以 0027_down 的警告不受影響；單元測試檢查「最新一份 reset_demo_data 的檢查範圍不含 audit_log」與「只有 0028 在 audit_log 上建立觸發器」，日後再加要重新評估。
  7. 刻意不建 (actor_id) 索引：不改既有資料表；每筆 Demo 寫入都會在鎖內全表計數，audit_log 超過約 10 萬列時再開卡（還原的 delete 也會受益）。
  8. 驗證：單元測試 20 項（檔案內容、順序、一致性）；SQL Editor 回滾式腳本 TASK-122-verify.sql（含 pg_locks 的決定性鎖證明）；整合測試 on／off 兩種模式（拋棄式帳號，含真實 JWT 的 user_metadata 偽造帳號）；
     PGlite 演練與 8 個變異（整表計數、無 actor 檢查、上限 501、信任 user_metadata、無鎖、無列數限制、無大小限制、不比對 actor）全被驗證腳本抓到。並行整合案例（30 個同時請求搶 3 個額度）只是機率性證明，鎖的決定性證明在驗證腳本。
情境：TASK-122 高風險卡（TASK-116 審查 M1，Demo 入口前置條件）；三方子代理審查（架構、安全、測試），處置見 verification/TASK-122.md。migration 由使用者在 SQL Editor 套用。
考慮過的替代方案：整張表總列數上限（designer001 會把 Demo 擠掉）；對所有人加 event_type 長度 CHECK（觸碰既有資料表，超出本卡範圍，列為可選的縱深防禦）；為 actor_id 建索引（見 7）；用 sequence 當票數（失敗嘗試也耗額度，且每日還原要多重置）。
影響與殘留風險：
  - Demo 觸頂後後台操作照常，只是稽核列表不再新增 Demo 的紀錄，伺服器日誌每次多一行 P0001 警告（預期內，手冊已寫）。額度是所有訪客共用的。
  - 重建 Demo 帳戶（新的 uid）時，舊帳戶的稽核列不會被還原刪除，手冊 §7.3 有清理語句。
  - 其他有 insert 權限的表也有「寫入後再中止」的膨脹，屬一般性風險；本卡只處理 audit_log。
  - 範圍外觀察（安全審查 N6，未查證）：0021 刻意不鎖 raw_user_meta_data，Demo 可能可用 updateUser({ data }) 寫入很大的 user_metadata，使 JWT／cookie 與 auth.users 該列變大；建議另開卡評估。
