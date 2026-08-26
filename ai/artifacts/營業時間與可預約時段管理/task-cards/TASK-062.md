# AI-Ready 任務卡

## Metadata

- 任務：`create_appointment` RPC 加入 `business_hours`（每週固定公休／營業時間）檢查
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：營業時間與可預約時段管理
- 上層 User Story：設定每週固定營業時間
- 分軌：後端
- 前置任務（dependsOn）：TASK-028
- 狀態：完成（使用者已核准，2026-08-26；migration 已由使用者親自套用到正式環境並驗收）
- 風險等級：高（比照 TASK-028，修改 `create_appointment` 這條顧客端唯一寫入路徑）

**範圍決策記錄（2026-08-26，spec-interrogation，使用者核准）**：
1. **檢查範圍**：整天公休（`is_closed`） + 時段落在 `open_time`～`close_time` 之外都擋
   （含服務時長跨過打烊時間的情況），比 TASK-028 的公休日檢查複雜——需要先算出
   `v_end_at`（服務時長）才能判斷時段是否完整落在營業時間窗內。
2. **30 分鐘時段對齊**：不檢查，維持現狀。`create_appointment` 目前本來就不驗證時間輸入
   是否對齊 30 分鐘刻度，這不是本卡要補的攻擊面，範圍聚焦在 `business_hours` 判斷本身。
   **風險連動提醒（第一輪審查，security-reviewer）**：正因為不驗證對齊，顧客可送入任意
   分鐘數的 `p_start_at`（例如 23:45），這正是下方「第一輪審查記錄」發現的跨午夜漏洞得以
   被觸發的前提，兩個決策合起來才構成可利用的破口，修正後的 SQL 邏輯需完整涵蓋這個情況。
3. **`force row level security` 隱性約束**：`business_hours` 表沿用 TASK-028 對
   `closed_dates` 的同一類記錄——採用 `select ... into` 讀取該表（非 `exists`，因為需要
   拿到 `open_time`／`close_time`／`is_closed` 三個欄位值，不只是命中與否），本函式的
   `security definer` 身分不受現行 `enable row level security`／`anon, authenticated`
   皆有 select policy（見 `0002_booking_flow.sql:28-35`）的限制。本卡設計為「查無該
   weekday 設定列」時一律**拒絕**（fail-closed）。
   **已確認的主要觸發原因（第二輪審查，architect／security-reviewer 一致確認）**：
   `0002_booking_flow.sql:37-43` 的 `admin full access to business hours` 是
   `for all`（含 DELETE），設計師身分本來就能刪除某個 weekday 的列；`lib/admin/
   business-hours.ts` 的批次 upsert 也可能部分失敗。這條路徑與 RLS 完全無關、且已確認
   可真實發生，是 fail-closed 設計主要要防的情境。
   **`force row level security` 前提未經查證，不作為主要敘事**（第一輪 test-engineer
   提出、第二輪 security-reviewer 覆核同意）：Supabase 的 `postgres` 角色通常具有
   `BYPASSRLS`，若本函式擁有者是 `postgres`，`force row level security` 對
   `security definer` 函式的 RLS 判定不生效，這條特定路徑可能根本不會發生。但無論
   該前提是否成立，「查無該 weekday 設定列」時 fail-closed 拒絕在上述已確認的「列被
   誤刪」情境下仍然正確且必要，不因此前提而失去意義，本卡不因此延後；`force RLS`
   查證建議另立維運檢查項目（見「後續任務」），檔頭與 `project-map.md` 的記錄需明確
   標註此為未查證前提，不得寫成既定事實。

## 目標

`create_appointment` 目前只檢查 `closed_dates`（TASK-028，特殊公休日），完全不檢查
`business_hours`（每週固定公休、每天營業起訖時間）——顧客繞過前端直接呼叫 API，理論上
仍能在週固定公休日（例如週日）或凌晨等非營業時段成功建立預約。這與 TASK-028 修補的是
同一類攻擊面（`get_available_slots` 有感知、`create_appointment` 沒有），本卡補齊。

## 情境包（Context Pack）

- 相關檔案：
  - `supabase/migrations/0013_create_appointment_closed_dates.sql`：TASK-028 剛完成的
    `closed_dates` 檢查，本卡的直接前例——新增檢查的位置（服務驗證後、提前量檢查前）、
    部署順序防呆寫法、重用 `SLOT_CONFLICT` 錯誤碼的姿態，皆應比照辦理。
  - `supabase/migrations/0009_booking_policy_lead_time.sql`：`get_available_slots`
    **目前正式環境實際版本**對 `business_hours` 的既有檢查邏輯（`v_weekday := extract
    (dow from p_date)`、查 `open_time`／`close_time`／`is_closed`、`p_date` 落在營業
    時間之外回傳空陣列）。**版本更正（第二輪審查，architect 2R-3）**：原情境包誤引用
    `0004_slots_closures_buffer.sql`，該版本已被本檔案 `create or replace` 取代
    （提前量讀取來源等已變更，邏輯位置行號不同）；`business_hours` 判斷邏輯本身相同，
    但需以 `0009` 為準核對行號，避免重演 MF-5 警告的「靠檔名認版本」失敗模式。
- 既有模式：比照 TASK-028 的既有模式（見 0013 檔頭），不新增錯誤碼、不改前端、部署順序
  防呆、`security definer`／`search_path=''` 邊界不變。與 TASK-028 的差異記錄在上方
  「範圍決策記錄」第 3 點：`exists` 換成 `select ... into`，null 情況要 fail-closed。
- 目前實際部署基準（2026-08-26 核對，避免重演 TASK-028 的編號漂移問題）：`supabase/
  migrations/` 最新編號為 `0013`（`create_appointment` 目前正式環境版本，見
  `0013_create_appointment_closed_dates.sql`），本卡新增檔案應編號 `0014`。
  **核對方式加強（第一輪審查，architect MF-5）**：本專案沒有 migration ledger、靠人工貼
  SQL Editor 套用（見 `0004` 檔頭），檔名無法證明正式環境實際在跑哪一版——TASK-028 檔頭
  已記錄過這個失敗模式。實作前與套用 down 腳本前，都必須對正式環境執行
  `select pg_get_functiondef('public.create_appointment(uuid,timestamptz,text,text,text)'
  ::regprocedure);`，逐字比對函式本體與 `0013_create_appointment_closed_dates.sql` 是否
  一致，作為完成證據的一部分；只用 `ls supabase/migrations/` 核對檔名不足夠。
- 未知事項：無（見上方「範圍決策記錄」，已由使用者核准三項決策）。
- 允許變更的檔案：
  - `supabase/migrations/0014_create_appointment_business_hours.sql`（新增）
  - `supabase/migrations/0014_create_appointment_business_hours_down.sql`（新增；`create
    or replace function` 還原成 0013 版本，不用 `drop function`，避免顧客端建立預約的
    唯一寫入路徑出現空窗，比照 0013 down migration 的既有選擇；檔頭需加註「回滾即恢復
    非營業時段可被繞過寫入的狀態，屬有意識接受的風險」，不只寫「不可跨級回滾」）
  - `tests/business-hours.integration.test.ts`（新增 `create_appointment` 對
    `business_hours` 回應的整合測試案例）
  - `tests/booking.integration.test.ts`（**新增，第一輪 architect MF-3、第二輪
    architect 2R-1／security-reviewer MUST FIX B 共同發現**：本卡新檢查插在
    `closed_dates` 之後、提前量檢查之前，所有用「牆鐘時間相對推算」構造 `p_start_at`
    的既有案例，只要算出的時間落在營業時間外或公休日，錯誤碼會從預期的
    `VALIDATION_ERROR`／成功變成 `SLOT_CONFLICT`，導致測試在特定時段執行時不穩定失敗。
    實際掃過全檔，共 4 處受影響，允許範圍限定為這 4 處，其餘案例不得變更：
    1. 第 488-497 行（`Date.now() + 30 分`，斷言 `VALIDATION_ERROR`）：改用「昨天
       （若為週日則往前一天，確保是營業 weekday）11:00」——固定落在營業時間內（business_
       hours 檢查通過），但因為是過去時刻，必然早於「現在 + 1 小時」門檻，穩定觸發提前量
       檢查回傳 `VALIDATION_ERROR`，不再依賴測試執行當下的牆鐘時間。
    2. 第 500-511 行（`Date.now() + 91 天`，斷言 `VALIDATION_ERROR`）：改用「+91～95 天
       內第一個非週日 11:00」，維持「超過 90 天視野上限」的語意但避開 weekday／公休
       不確定性。
    3. 第 748-756 行（`tooSoon`，`Date.now() + 2h50m`，斷言 `VALIDATION_ERROR`）與
    4. 第 758-764 行（`farEnough`，`Date.now() + 3h10m`，斷言成功）：這兩個案例在同一
       個 `it` 內、且該 `it` 已會呼叫 `serviceRoleClient` 動態調整
       `booking_policy.min_lead_time_hours`（見第 736-740 行既有寫法）。**修正策略**
       （第二輪 architect 建議）：改為先釘死一個未來營業日的營業中時段當目標，再分別把
       `min_lead_time_hours` 設成「大於距離目標的小時數」驗證 `tooSoon` 仍拒絕、「小於」
       驗證 `farEnough` 仍成功，而不是用牆鐘時間反推——`min_lead_time_hours` 上限 720
       小時（30 天，見 `0008_booking_policy.sql` check constraint），遠大於「距未來
       某個營業日時段」的小時數，此策略可行。
    比照 TASK-048 對同類「測試隱性耦合 DB 設定值」問題的既有解法（見該檔頭 7-13 行），
    修正後需實際印出算出的日期核對，避免重演第 160-167 行記錄過的撞期事故。）
  - `ai/context/project-map.md`（`business_hours` 說明段落補上「`create_appointment`
    自本卡起也會檢查該表」，以及 fail-closed 的故障徵狀與診斷入口——症狀是全站該
    weekday 預約 100% 被拒且訊息一律是 `SLOT_CONFLICT`、Postgres log 有對應 `raise
    log` 記錄（見下方需求段落）可查根因，主要觸發原因是「該 weekday 列被誤刪或 upsert
    部分失敗」；`force row level security` 只列為次要、未查證的理論前提，不得寫成
    既定事實，比照上方「範圍決策記錄」第 3 點的修正敘事）
- 不得觸碰：`get_available_slots` RPC（不修改，只讀取同一批表）、前端任何檔案、
  `business_hours` 的 schema（TASK-010 已建立，本卡只讀取使用）、`tests/
  booking.integration.test.ts` 除上述指定案例以外的其他測試案例。

## 需求

**第一輪審查後修正**：原始需求草稿用 `::time` 只比較時分秒、丟棄日期部分，三方審查
（security-reviewer MUST FIX 1、architect MF-1、test-engineer MUST FIX 1/2）獨立發現這在
服務時段跨越台北時間午夜時會回捲比較，導致檢查靜默 fail-open（例如週一 23:45 起訂、
30 分鐘服務，`v_end_at` 落在週二 00:15，`::time` 比較會讓兩個時間都誤判「落在營業時間
內」而放行）。下方需求已改用 timestamptz 區間比較（比照 `get_available_slots` 現行版本
在 `0009_booking_policy_lead_time.sql:106-107` 算 `v_day_start`／`v_day_end` 的既有
寫法），語意上「預約必須完整落在當天營業窗內」，跨午夜自動不成立。

- 新增 `supabase/migrations/0014_create_appointment_business_hours.sql`：
  - 檔頭比照 `0013_create_appointment_closed_dates.sql` 的既有慣例：說明本卡任務、對應
    回滾腳本、依賴表、部署順序防呆的理由，並記錄上方「範圍決策記錄」第 3 點的
    fail-closed 設計理由，以及第一輪審查發現並修正跨午夜漏洞的經過（供未來維護者理解
    為何用 timestamptz 區間而非 `::time`，避免被「看起來更簡短」的寫法誤導著改回去）。
    **第二輪審查要求補充的檔頭記錄**（security-reviewer SHOULD FIX 4）：
    (a) Asia/Taipei 自 1979 年起無日光節約時間，當地時刻與 timestamptz 一對一對應，
    是本檔案 `at time zone` 來回轉換寫法安全無歧義的前提，若未來需支援有 DST 的時區
    需重新檢視這個寫法；
    (b) `close_time` 若填 `'24:00'`（`time` 型別允許、`business_hours_valid_range`
    不禁止），`v_day_end` 會落在隔日 00:00，這是預期行為，不是 bug；
    (c) 本檢查讓「預約必須完整落在當天營業窗內」成為不可能跨當地午夜的不變量，這正是
    `0013` 檔頭「`closed_dates` 只需檢查 `p_start_at` 所屬那一天、不用管 `end_at`」
    這個論證能夠成立的前提——未來若有人覺得本檢查冗餘而移除，必須同時重新檢視 `0013`
    的這個假設是否還成立，不可單獨移除。
  - `create or replace function` 前先 `do $$ ... raise exception` 確認
    `public.business_hours` 存在（比照 0013 對 `closed_dates`／`booking_policy` 的既有
    部署期防呆）。
  - 在既有姓名／電話／Email 驗證區塊（0013 現行版本）之後、服務驗證之前，新增
    `p_start_at` 的有限值防護（**第一輪審查新增，security-reviewer MUST FIX 3**：目前
    `'infinity'::timestamptz` 或 `null` 只是偶然被 `extract`／`when others` 吞成籠統
    `INTERNAL_ERROR`，不是設計行為，顯式攔截後語意正確、回報 `VALIDATION_ERROR` 較準確）：
    ```sql
    if p_start_at is null or not isfinite(p_start_at) then
      return jsonb_build_object('ok', false, 'error_code', 'VALIDATION_ERROR', 'message', 'invalid start_at');
    end if;
    ```
  - 以 0013 版本為底，在既有 `closed_dates` 檢查（`if exists (...) then return
    SLOT_CONFLICT ...`）之後，**搬移**（不是新增第二次賦值——0013 原第 133 行的
    `v_end_at := p_start_at + make_interval(mins => v_duration_minutes);` 移到這裡，
    原位置刪除；architect 已核對 `v_end_at` 在原位置與新位置之間沒有任何語句改動
    `v_duration_minutes`／`p_start_at`，搬移是語意上的 no-op）並新增 `business_hours`
    檢查：
    ```sql
    v_end_at := p_start_at + make_interval(mins => v_duration_minutes);

    v_weekday := extract(dow from (p_start_at at time zone 'Asia/Taipei'));

    select open_time, close_time, is_closed into v_open, v_close, v_is_closed
    from public.business_hours where weekday = v_weekday;

    -- v_is_closed 是 not null 欄位（0002_booking_flow.sql:22），is null 只可能代表
    -- 查無該 weekday 列（多半是列被誤刪或 upsert 部分失敗，見上方「範圍決策記錄」
    -- 第 3 點），與「該 weekday 本來就整天公休」是不同情況，只對前者寫 log——這個
    -- 分支觸發時對顧客與 get_available_slots 都是全面靜默拒絕，沒有這行事後完全無法
    -- 區分「設定列意外消失」與「單純今天公休」（第二輪審查，security-reviewer
    -- SHOULD FIX 2）。
    if v_is_closed is null then
      raise log 'create_appointment: business_hours missing row for weekday %', v_weekday;
    end if;

    -- 查無列（v_is_closed is null）／整天公休（v_is_closed = true）／防禦性檢查
    -- open_time／close_time 為 null（理論上 business_hours_valid_range 已保證非公休列
    -- 必有這兩欄，但不假設 constraint 一定成立）→ 一律拒絕（fail-closed）。
    if v_open is null or v_close is null or coalesce(v_is_closed, true) then
      return jsonb_build_object('ok', false, 'error_code', 'SLOT_CONFLICT', 'message', 'slot already booked');
    end if;

    v_day_start := ((p_start_at at time zone 'Asia/Taipei')::date + v_open) at time zone 'Asia/Taipei';
    v_day_end := ((p_start_at at time zone 'Asia/Taipei')::date + v_close) at time zone 'Asia/Taipei';

    -- timestamptz 區間比較（非 ::time），避免跨台北午夜時回捲失效
    if p_start_at < v_day_start or v_end_at > v_day_end then
      return jsonb_build_object('ok', false, 'error_code', 'SLOT_CONFLICT', 'message', 'slot already booked');
    end if;
    ```
    邊界值：起點等於 `open_time`、終點等於 `close_time` 皆放行（`<`／`>` 而非 `<=`／`>=`，
    對齊 `get_available_slots` 現行版本在 `0009_booking_policy_lead_time.sql:110` 的
    `while ... <= v_day_end` 既有語意）。
  - 新增變數宣告：`v_weekday int`、`v_open time`、`v_close time`、`v_is_closed boolean`、
    `v_day_start timestamptz`、`v_day_end timestamptz`（命名比照 `get_available_slots`
    現行版本在 `0009_booking_policy_lead_time.sql` 的既有宣告）。
  - 函式簽名、`security definer`／`set search_path = ''`、`grant execute ... to anon`
    邊界、其餘既有驗證與寫入邏輯（含 0013 的 `closed_dates` 檢查、`booking_policy` 提前量
    讀取）全部不變。套用後以 `\df public.create_appointment` 確認只有一個 overload
    （**第一輪審查提醒，security-reviewer**：若參數清單型別被意外改動會新建 overload，
    舊版本仍保有 `anon` 執行權限並可能繼續被 PostgREST 選中）。
  - 新增 `revoke truncate on public.business_hours from anon, authenticated;`（**第二輪
    審查新增，security-reviewer SHOULD FIX 1**：比照 `0008_booking_policy.sql:50-53`
    的既有縱深防禦寫法，本卡讓 `business_hours` 從「只影響 `get_available_slots`
    顯示」升級為 `create_appointment` 寫入路徑依賴，補這行的理由比 `booking_policy`
    當初更充分）。down migration **保留**此 revoke，不隨回滾恢復 TRUNCATE 權限——
    回滾只換回函式本體，不是恢復到「本卡之前的一切狀態」。
  - 對應 `0014_create_appointment_business_hours_down.sql`：換回 0013 版本，並在檔頭加註
    「不可跨級回滾」與「回滾即恢復非營業時段可被繞過寫入的狀態，屬有意識接受的風險」兩則
    警語（比照 0013 down migration NICE TO HAVE 記錄第 3 點，並依第一輪審查要求擴充）。

## 驗收標準

- `create_appointment` 對週固定公休日（`business_hours.is_closed = true` 的 weekday），
  回傳 `{ok: false, error_code: "SLOT_CONFLICT", ...}`，不寫入任何 `appointments`／
  `customers` 資料列。
- `create_appointment` 對非公休 weekday、但 `p_start_at` 早於 `open_time` 或
  `p_start_at + duration_minutes` 晚於 `close_time` 的請求，同樣回傳 `SLOT_CONFLICT`，
  不寫入資料列（涵蓋服務時長跨過打烊時間的情況）。
- `create_appointment` 對非公休 weekday、時段完整落在 `open_time`～`close_time` 內的請求，
  行為與修改前完全一致（回歸安全網），仍受 0013 的 `closed_dates` 檢查與既有提前量／
  視野上限檢查約束。起點等於 `open_time`、終點（`p_start_at + duration_minutes`）等於
  `close_time` 的邊界情況皆應成功（不得誤用 `<=`／`>=`）。
- **服務時段跨越台北時間午夜的請求必須被拒絕**（例如非公休 weekday 23:45 起訂、
  30 分鐘服務，即使該 weekday 有營業時間設定）——這是第一輪審查發現並要求修正的核心
  回歸測試，證明檢查邏輯改用 timestamptz 區間比較後跨午夜漏洞已修正。
- 查無該 weekday 的 `business_hours` 設定列時，`create_appointment` 必須拒絕
  （fail-closed，不得放行）。
- `p_start_at` 為 `null` 或非有限值（例如 `'infinity'`）時，回傳 `VALIDATION_ERROR`，
  不寫入任何資料列。
- 同一天同時符合正常營業時間、但被標記為 `closed_dates` 特殊公休時，`closed_dates`
  檢查（0013）仍正確優先拒絕，不受本卡新插入的 `business_hours` 檢查影響。
- `get_available_slots` 與 `create_appointment` 在 `business_hours` 這個判斷維度上一致：
  前者因 `business_hours` 回傳空陣列的情況，後者一律拒絕寫入。**範圍限定**（第一輪審查
  architect NH-4，第二輪審查 architect 2R-3 更正版本引用）：兩支 RPC 在 30 分鐘刻度
  對齊、`buffer_minutes` 感知這兩處本來就不一致（`get_available_slots` 有做，
  `create_appointment` 依範圍決策記錄第 2 點不做），這不是本卡範圍，不列入本條驗收
  標準，於「已知限制」記錄。**提前量來源已在 TASK-048 統一**（`0009_booking_policy_
  lead_time.sql` 起兩支 RPC 皆讀 `booking_policy.min_lead_time_hours`），原草稿誤引用
  已被取代的 `0004` 版本、宣稱兩者提前量來源不一致，該說法不成立，已移除。
- **已知限制（新增，第二輪審查 security-reviewer 提醒）**：本卡把「預約必須完整落在
  當天營業窗內」做成資料庫寫入層硬規則，等於永久排除「跨午夜營業」的店家設定（例如
  22:00-02:00）——目前 `business_hours` schema（`business_hours_valid_range` 要求
  `close_time > open_time`）本來就不支援這種設定，不是本卡造成的回歸，但本卡把它從
  「查詢層不顯示」變成「寫入層硬擋」，值得明確記錄。
- 既有測試（`test:booking`／`test:admin-booking`／`test:business-hours`）重跑無回歸，
  完成證據需記錄實際通過筆數（比照 TASK-028 完成證據的既有慣例）。
- `npx tsc --noEmit`／`npm run lint`／`npm run build`／`npm test` 皆通過。

## 第一輪審查記錄（2026-08-26）

architect／security-reviewer／test-engineer 三方平行審查，結論一致 **Request Changes**。
三方獨立發現同一個核心邏輯漏洞：原始 SQL 用 `::time` 比較會在服務時段跨越台北時間午夜時
回捲失效，造成本卡要補的防線在每天固定時間窗內形同虛設。已依三方 MUST FIX 修正需求段落
（見上方「需求」開頭的修正說明）與驗收標準／驗證契約。修正後尚未進行第二輪審查——依高風險
工作規則，人工核准前建議再過一輪 architect／security-reviewer 確認（不需要重新跑
test-engineer，測試案例已依其 MUST FIX 擴充，除非人工核准者認為修正幅度大到需要重新走
三方）。

## 第二輪審查記錄（2026-08-26）

architect／security-reviewer 複核修正後的任務卡，結論仍是 **Request Changes**，但雙方都
確認核心 SQL 邏輯（跨午夜 fail-open 修正、`v_end_at` 搬移、fail-closed 設計本身）已經正確
——不需要第三輪重新審查 SQL。剩餘問題全部集中在測試範圍與文件敘述準確度：

- architect 2R-1／security-reviewer MUST FIX B：`tests/booking.integration.test.ts`
  受影響案例不只 758-764 行，實際還有 488-497、500-511、748-756 行三處，已擴充進上方
  「允許變更的檔案」並給出具體修正策略。
- architect 2R-2：驗證契約案例 7（跨 UTC 日界 weekday 判斷）在 seed 資料下是零鑑別力的
  空測試，已在下方「驗證契約」重新設計。
- architect 2R-3：「提前量來源不一致」是引用已被 TASK-048 取代的舊版本，已移除並修正
  情境包對 `get_available_slots` 的版本引用（`0004` → `0009`）。
- security-reviewer MUST FIX A：驗證契約案例 8（fail-closed 分支測試）原指示「挑未使用
  過的 weekday」會選到週日（本來就公休），測不出任何東西，已改為明確要求營業中的
  weekday 並加上 positive control。
- security-reviewer SHOULD FIX 1-5：`revoke truncate`、`raise log`、force RLS 敘述
  準確度、檔頭補充記錄、已知限制記錄，皆已整合進上方對應段落。

## 實作備註

- 依高風險工作規則，Agent 執行前需完成審查且無 MUST FIX（或 MUST FIX 已修正並經
  確認），並取得使用者核准，比照 TASK-028 的完整流程。
- 實作完成後，**必須**（非僅建議，第一輪審查 test-engineer 要求）比照 TASK-028 的既有
  作法，用一組案例人工核對正式環境 RPC 實際行為，且需包含邊界相等值，不能只測「明顯
  情境」：
  1. 標記週日公休，對週日呼叫 `create_appointment` 確認被拒絕。
  2. 對某營業 weekday，開店時刻（`open_time` 當下）呼叫確認**成功**。
  3. 對同一 weekday，服務結束時刻恰好等於 `close_time` 呼叫確認**成功**。
  4. 對同一 weekday，開店前一刻呼叫確認被拒絕；打烊後一刻呼叫確認被拒絕。
  5. 對同一 weekday，接近午夜起訂、服務時長會跨過午夜的時段呼叫確認被拒絕（跨午夜
     漏洞的正式環境正面驗證，不能只依賴自動化測試）。
  6. 完成後執行 `\df public.create_appointment` 確認只有一個 overload。
- 公休日／營業時間檢查刻意放在服務驗證「之後」（沿用 0013 既有順序）：若 `p_service_id`
  本身無效或服務已停用，應該回報 `SERVICE_INACTIVE`，不該被本檢查搶先攔截。

## 驗證契約

- 單元測試：不適用（本卡純 SQL migration，無可抽出的 TypeScript 純函式邏輯）。
- 整合測試：擴充 `tests/business-hours.integration.test.ts`，新增案例（第一輪審查後由
  5 案例擴充為 11 案例，涵蓋三方各自提出的缺口）：
  1. 標記週固定公休日後呼叫 `create_appointment` 被拒絕（`SLOT_CONFLICT`），資料庫無
     新增列。**測試資料策略**（test-engineer NICE TO HAVE 1）：優先直接使用種子資料中
     已經是公休的週日（`weekday = 0`，本測試檔案目前尚未用過這個 weekday 常數），避免
     額外 mutate／restore。
  2. 非公休 weekday、時段早於 `open_time` 呼叫 `create_appointment` 被拒絕。
  3. 非公休 weekday、時段（含服務時長）晚於 `close_time` 呼叫 `create_appointment` 被
     拒絕。案例 2、3 建議直接讀取該 weekday 目前實際的 `open_time`／`close_time`
     快照值來推導界外時間，不需要 mutate 該表（減少對共用表的寫入次數與還原失敗風險，
     且不假設目前一定是 seed 預設的 10:00-19:00）。
  4. 非公休 weekday、時段完整落在營業時間內呼叫 `create_appointment` 成功建立（回歸
     安全網）。
  5. **邊界相等值**（第一輪審查新增，test-engineer MUST FIX 1）：`p_start_at` 恰好等於
     `open_time` → 成功；`v_end_at`（`p_start_at + duration`）恰好等於 `close_time` →
     成功。這是最典型的 off-by-one 風險，原 5 案例測不到，若 SQL 誤用 `<=`／`>=` 這兩個
     案例才會失敗。
  6. **跨台北時間午夜**（第一輪審查新增，三方一致要求，核心回歸測試）：非公休 weekday、
     `p_start_at` 落在當地午夜前 `duration` 分鐘內（例如 23:45 起訂 30 分鐘服務）→
     必須被拒絕。沒有這個案例等於沒有驗證本輪修正的核心 MUST FIX。
  7. **台北時間跨 UTC 日界的 weekday 判斷**（第一輪審查新增，test-engineer MUST FIX 2；
     **第二輪審查重新設計，architect 2R-2**：原設計「驗證台北 00:30 被拒絕」在 seed
     資料下無論 weekday 判斷對或錯都會拒絕，是零鑑別力的空測試，比照 TASK-028 00:30
     案例的表面形式抄過來卻沒有真正對應到 `business_hours` 判斷的鑑別條件）。**正確
     設計**：需要讓「UTC weekday」與「台北 weekday」判斷出的 `business_hours` 列不同、
     且結果會翻轉（成功 vs 拒絕），測試才有鑑別力。作法：選定週一，在受控 `it` 內暫時
     把週一（`weekday = 1`）的設定改為 `open_time = '00:00'`、`close_time = '23:00'`、
     `is_closed = false`（週一整天營業），呼叫 `create_appointment` 傳入台北時間
     週一 00:30 起訂的短服務——若 `extract(dow from ...)` 正確使用台北時間，讀到週一
     的設定（00:00-23:00 營業）應**成功**；若誤用 UTC 日期（此時 UTC 仍是週日，
     `is_closed = true`）則會**被拒絕**。測試完成後立即還原週一原始設定（`afterEach`）。
     **撞期提醒（實作前已核對）**：本檔案既有測試已用週一（`weekday = 1`）兩次
     （`CLOSED_RLS_WEEKDAY`、`BUFFER_WEEKDAY`，皆為「單一 `it` 內短暫改動並立即還原」
     模式）。本案例必須用週日／週一相鄰組合（週日在 seed 中保證公休，兩者相鄰才能構成
     UTC／台北判斷會翻轉結果的最小案例，換其他 weekday 對無法達到同樣效果），因此無法
     迴避重疊，須確保：(a) 本案例的 `it` 與既有兩個週一案例不會並發執行（vitest 依宣告
     順序循序執行 `it`，這點本來就成立，但仍需在新增時明確排列順序、不要用
     `.concurrent`）；(b) `afterEach` 確實在本案例的 `it` 結束前把週一還原，下一個用到
     週一的既有案例執行時，快照必須是原始值。
  8. **查無該 weekday 設定列的 fail-closed 分支**（第一輪審查新增，test-engineer
     MUST FIX 3；**第二輪審查修正選列方式與加入 positive control，security-reviewer
     MUST FIX A**：原指示「挑本檔案未使用過的 weekday」在本檔案既有測試已用掉 weekday
     1/2/3/4/5/6 的情況下，唯一沒用過的是 weekday 0（週日），而週日在 seed 中本來就是
     `is_closed = true`；照原指示實作會刪除一個「反正也會被拒絕」的列，`SLOT_CONFLICT`
     測試恆通過，但完全沒有實際驗證到「查無列時 fail-closed」這件事，等於原地踏步）。
     **正確設計**：改選一個**營業中**的 weekday（沿用本檔案既有 `WRITE_WEEKDAY = 2`
     這類「單一 `it` 內短暫改動並立即還原」的既有模式，若該 weekday 已被其他案例佔用
     則另挑一個未撞期的營業 weekday），在同一個 `it` 內依序：
     (a) **positive control**：刪除前，先用一組落在該 weekday 營業時間內的
     `p_start_at` 呼叫 `create_appointment`，確認**成功**（或至少不是
     `SLOT_CONFLICT`）——證明「等一下的拒絕」不是巧合，而是真的由「查無列」造成；
     (b) 刪除該 weekday 的 `business_hours` 列；
     (c) 用同一組 `p_start_at` 再次呼叫，確認回傳 `SLOT_CONFLICT`；
     (d) 立即插回原始值（`afterEach` 兜底，避免 `it` 中途失敗留下缺列狀態）；
     (e) 用同一組 `p_start_at` 第三次呼叫，確認恢復**成功**，證明還原生效。
     **注意**：這個測試套件對真實 Supabase 專案執行，刪除視窗內該 weekday 的所有真實
     顧客預約請求都會被拒絕，須確保刪除到插回之間沒有其他非同步操作、視窗盡量短。
  9. **非有限 `p_start_at`**（第一輪審查新增，security-reviewer MUST FIX 3）：
     `p_start_at` 為 `"infinity"` 與 `null` 兩種輸入，皆回傳 `VALIDATION_ERROR`，不得
     建立資料列。
  10. **`closed_dates` 優先性組合案例**（第一輪審查新增，test-engineer NICE TO HAVE
      5）：同一天同時符合正常營業時間、但被標記為 `closed_dates` 特殊公休，驗證 0013
      的 `closed_dates` 檢查仍正確優先拒絕，不受本卡新插入的檢查影響。
  11. 與 `get_available_slots` 對同一組輸入（限 `business_hours` 判斷維度）的判斷一致性
      案例（比照 0013 既有測試風格）。
  - **Setup／teardown 要求**（第一輪審查，architect MF-4）：`business_hours` 以
    weekday 為單位，污染半徑是「未來所有該 weekday 的日期」，比 TASK-028 的
    `closed_dates`（單一日期）大很多，會波及 `tests/booking.integration.test.ts`
    （+70 天池）與 `tests/admin-booking` 正在用的日期。還原機制須用 `afterEach`（不能
    只有 `afterAll`），單一 `it` 失敗中斷時也不能讓 weekday 停在被修改狀態；新增的
    weekday／date offset 常數需與本檔案既有常數核對不重疊（比照第 160-167 行記錄過的
    真實撞期事故），並實際印出算出的日期核對，不能只憑 offset 數字不同就假設安全。
- 回歸測試：重跑 `test:booking`／`test:admin-booking`／`test:business-hours`，完成證據
  需記錄實際通過筆數（第一輪審查，test-engineer MUST FIX 4，比照 TASK-028 完成證據的
  既有慣例）。`tests/booking.integration.test.ts` 上方「允許變更的檔案」列出的 4 處
  （488-497、500-511、748-756、758-764 行）需先完成修正，否則此項回歸測試會因與本卡
  無關的既有測試設計問題而失敗（第二輪審查擴充範圍，architect 2R-1／security-reviewer
  MUST FIX B）。
- E2E 測試：不適用（無 UI 變更）。
- 型別檢查：`tsc --noEmit` 成功。
- Lint：`npm run lint` 成功。
- Build：`npm run build` 成功。
- 螢幕截圖：不適用。
- 安全性檢查：`create_appointment` 維持 `security definer`／`set search_path = ''`／只
  `grant execute` 給 `anon` 的既有邊界不變（套用後以 `\df` 確認無多餘 overload）；新增
  檢查重用既有 `SLOT_CONFLICT`／新增 `VALIDATION_ERROR`（沿用既有錯誤碼，非新增）；
  fail-closed 判斷式需經上方案例 8 實際測試觸發驗證，不能只靠程式碼審查判斷涵蓋。

## 審查 NICE TO HAVE（未列入本卡範圍，記錄供實作時參考或另立任務卡）

**以下兩項原為 NICE TO HAVE，第二輪審查後已升格納入上方「需求」段落，不再重複列於此**：
`revoke truncate`（security-reviewer SHOULD FIX 1）、`raise log`（security-reviewer
SHOULD FIX 2）。

- `extract(dow from ...)` 顯式轉型為 `::int`，`v_weekday` 宣告與查詢寫法對齊 `0009`
  既有風格（architect NH-1，版本引用已依 2R-3 更正）。
- 部署前建議確認正式環境 `business_hours` 確實有七列（`select count(*)`）——目前 seed 與
  後台寫入路徑都保證七列，風險低，但本卡把「查無列」升級成硬拒絕後這是新的隱性前提。
- 後續共用抽象：`business_hours` 的營業時間窗推導目前有三份獨立實作（`get_available_
  slots`、本卡新增的 `create_appointment` 檢查、`lib/admin/business-hours.ts` 的
  `isAppointmentOutsideHours`），且 `isAppointmentOutsideHours`（該檔第 92-101 行）有
  同一類跨午夜回捲 bug（`endTod > hours.close_time`，`endTod` 由 `Intl.DateTimeFormat`
  取當地 time-of-day）。本卡不動 `get_available_slots`、不抽共用函式（避免擴大本卡風險
  範圍），但建議另立任務卡：(1) 修 `lib/admin/business-hours.ts` 同一類 bug；(2) 評估抽
  `public.business_day_window(p_date)` 供兩支 RPC 共用，消除三份實作各自維護的風險。
- BYPASSRLS 查證（test-engineer 提出）：確認 Supabase migration 執行角色是否具有
  `BYPASSRLS`，釐清「force RLS 誤啟用」這個威脅情境對 `business_hours`／`closed_dates`／
  `booking_policy` 是否真的成立，屬維運層面查證，不阻擋本卡。

## 完成證據

- 變更的檔案：
  - `supabase/migrations/0014_create_appointment_business_hours.sql`（新增；已由使用者
    人工貼 Supabase SQL Editor 套用到正式環境，2026-08-26）
  - `supabase/migrations/0014_create_appointment_business_hours_down.sql`（新增）
  - `tests/business-hours.integration.test.ts`（新增「create_appointment RPC 對
    business_hours 的回應」describe 區塊，11 個測試案例）
  - `tests/booking.integration.test.ts`（修正 4 處受本卡錯誤碼優先順序改變影響的既有
    案例：488、502、748-756、758-764 行，改為釘死營業時段／反過來調整
    `min_lead_time_hours`，不再依賴牆鐘時間）
  - `ai/context/project-map.md`（`business_hours` 說明段落更新）
- 執行過的指令與結果：
  - **版本基準核對**（無 `pg_get_functiondef` 直連管道，改用無副作用行為探測，見下方
    說明）：套用前探測「週日＋100 天後」回傳 `VALIDATION_ERROR`（超出視野上限，確認
    0013 版本、無 `business_hours` 檢查）；套用後同一探測回傳 `SLOT_CONFLICT`（確認
    `business_hours` 檢查已生效且排在視野檢查之前）；另用 `p_start_at: 'infinity'`
    探測，套用前回傳 `SERVICE_INACTIVE`（0013 無 `isfinite` 檢查），套用後回傳
    `VALIDATION_ERROR "invalid start_at"`（0014 `isfinite` 檢查已生效）。兩組探測皆
    刻意設計成無論版本為何都不會實際寫入任何資料列。
  - `npx tsc --noEmit`：通過，無錯誤。
  - `npm run lint`：通過，無錯誤。
  - `npm run build`：通過，`next build` 成功產出全部路由。
  - `npm run test:business-hours`：**33/33 通過**（含本卡新增的 11 個案例）。過程中發現
    並修正一個測試自身的 bug：多個新案例的 `customerName` 字尾過長，導致 `TEST_MARKER`
    前綴加總後超過 `create_appointment` 的 50 字元姓名上限，姓名驗證搶先回傳
    `VALIDATION_ERROR "invalid name"`，掩蓋了真正要測的 `business_hours` 判斷結果——
    已仿照 TASK-028 既有案例改用更短字尾修正（例如 `bh-before-open` → `bh-bef-open`），
    修正後全部通過。
  - `npm run test:booking`：**23/23 通過**，含修正過的 4 處案例，無回歸。
  - `npm run test:admin-booking`：**13/13 通過**，無回歸。
  - `npm test`（完整套件，480+ 案例）：業務相關套件皆穩定通過；`tests/components/
    account-settings-view.test.tsx`（與本卡完全無關的帳號設定／MFA 元件測試，本卡未
    觸碰）在與其他檔案並行執行時偶發 5 秒逾時（不同次執行逾時的具體 it 不同），單獨
    執行該檔案時穩定 **33/33 通過**（31.8 秒內完成，遠低於逾時門檻），確認是既有的
    計時緊繃間歇性問題，不是本卡造成的回歸。
- 螢幕截圖：不適用（無 UI 變更）。
- 已知限制：
  - `get_available_slots` 與 `create_appointment` 在 30 分鐘刻度對齊、`buffer_minutes`
    感知兩項仍不一致（範圍決策記錄第 2 點，非本卡範圍）。
  - 本卡把「預約必須完整落在當天營業窗內」做成資料庫寫入層硬規則，永久排除跨午夜營業
    的店家設定（目前 schema 本來就不支援，非本卡造成的回歸，但值得記錄）。
  - `force row level security` 對本函式是否真的會生效尚未查證（`postgres` 角色通常具
    `BYPASSRLS`），已在檔頭與 `project-map.md` 標註為未查證前提，不影響 fail-closed
    設計本身的正確性（主要觸發原因是「weekday 列被誤刪」，已確認可真實發生）。
  - `tests/components/account-settings-view.test.tsx` 有既有的間歇性逾時問題（與本卡
    無關），建議另立任務卡調查（可能是該檔案案例數多、渲染／非同步斷言較重，並行執行
    時在資源有限的環境下偶發逾時）。
- MUST FIX 修正記錄：無新的阻斷項（審查階段的 MUST FIX 已在核准前全數修正並經第二輪
  architect／security-reviewer 確認，見上方「第一輪審查記錄」「第二輪審查記錄」）。
- 後續任務：
  1. `revoke truncate on public.closed_dates from anon, authenticated;`（`closed_dates`
     目前沒有這行，TRUNCATE 會導致 fail-open，比 `business_hours` 危險）。
  2. 修 `lib/admin/business-hours.ts` 的 `isAppointmentOutsideHours`（該檔第 92-101
     行）同一類跨午夜回捲 bug（只影響後台「受影響預約」提示，非寫入路徑）。
  3. 評估抽 `public.business_day_window(p_date)` 供 `get_available_slots`／
     `create_appointment` 共用，消除營業時間窗推導的三份獨立實作。
  4. 查證 Supabase migration 執行角色是否具有 `BYPASSRLS`，釐清 `force row level
     security` 對 `business_hours`／`closed_dates`／`booking_policy` 三張表的
     `security definer` RPC 是否真的會生效。
  5. 調查 `tests/components/account-settings-view.test.tsx` 的間歇性逾時問題。
