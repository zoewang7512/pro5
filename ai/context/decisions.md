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
