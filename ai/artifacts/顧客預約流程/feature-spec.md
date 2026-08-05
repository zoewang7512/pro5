# 功能規格書

## Metadata

- 功能：顧客預約流程
- 負責人：待指定
- 狀態：已實作（2026-08-05；TASK-010～TASK-013 皆已完成並人工核准，三個 User Story
  端到端驗證通過）
- 風險等級：高（涉及新的資料庫 migration、anon 可呼叫的 SECURITY DEFINER RPC、顧客個資寫入路徑——依 `ai/process/definition-of-ready.md` 的高風險清單「資料庫遷移」「權限」二項觸發）

## 問題

顧客目前無法在網站上自助完成預約——首頁只是佔位文字，`services`／`appointments`／
`customers` 三張表雖然在 TASK-003 已建立 schema 與 RLS 邊界，但沒有任何服務項目資料、
沒有營業時間資料，也沒有可預約時段運算與預約建立的 API。

## 使用者

未登入的顧客（前台，行動裝置為主），對應 `ai/context/project-map.md` 的「顧客」使用者。

## 目標

- 顧客能瀏覽目前啟用中的服務項目（名稱／時長／價格）。
- 顧客選擇服務後，能看到正確反映「已被預約」與「營業時間外」的可選時段（不可選時段
  直接不能點，不是選了才提示衝突）。
- 顧客填寫姓名／電話（email 選填）並送出後，系統建立一筆 `pending` 預約，正確處理顧客
  去重（依 phone/email 找既有 `customers` 或新建）並關聯 `customer_id`。
- 送出成功後顧客立即看到預約成功確認頁（服務／時段／聯絡資訊摘要）。
- 順帶建立本 Epic 需要的最小可行上游資料：新增 `business_hours` 表（供本 Epic 的可預約
  時段運算使用）＋預設營業時間種子資料；`services` 表用 SQL seed 幾筆服務項目。這兩者
  之後由「服務項目管理」「營業時間與可預約時段管理」Epic 接手，補上正式管理 UI，資料
  模型不變。
- 版面依 Epic 0 S5 已核准的 [`mockup-decision-顧客前台.md`](../專案設置/mockup-decision-顧客前台.md)
  變體 B「單頁捲動」實作。

## 非目標

- 服務項目／營業時間的正式管理 UI（新增/編輯/刪除服務項目、設定每週營業時間/公休日/
  緩衝時間的後台介面）——留給「服務項目管理」「營業時間與可預約時段管理」Epic；本 Epic
  只建最小可行的資料表與種子資料。
- Email 確認信／提醒信——留給「Email 通知與提醒」Epic。
- 顧客用 `access_token` 自助查詢／取消／改期預約——留給「顧客自助查詢／取消預約」Epic；
  本 Epic 的成功頁只顯示送出當下已知的資訊，不提供之後回訪查詢的連結。
- 設計師後台的預約列表／日曆管理——留給「預約管理後台」Epic。
- 最短提前預約時間、取消／改期時限等政策的可設定化——留給「預約規則與政策設定」Epic；
  本 Epic 先用合理寫死值：最短提前 1 小時、預約視野上限 90 天（見「功能需求」）。
- 進階防濫用機制（CAPTCHA、IP rate-limit）——本階段只做基本防呆（送出後鎖按鈕避免重複
  點擊、資料庫層防止同時段雙重預約），進階防濫用留待有實際濫用訊號時再處理，記錄為
  已知限制。

## 使用者故事（User Stories）

| 故事 | 身為／我想要／以便 | 驗收標準 |
|---|---|---|
| 顧客瀏覽服務並選日期時段 | 身為顧客，我想要看到服務項目與可預約時段，以便挑選適合我的服務與時間 | 只顯示 `is_active=true` 的服務；選定服務後，時段清單只列出營業時間內、且未與既有預約衝突的時段；已占用/非營業時間的時段不可點擊 |
| 填寫聯絡資訊並確認預約 | 身為顧客，我想要填寫姓名與電話並送出，以便完成預約 | 姓名／電話必填且通過格式驗證；送出後系統依 phone/email 找到既有顧客或新建，並建立一筆 `pending` 預約；兩人同時搶同一時段時只有一人成功 |
| 預約成功頁面／確認顯示 | 身為顧客，我想要送出後立即看到確認資訊，以便確認預約已成立 | 顯示服務名稱、時段、姓名／電話摘要；重新整理該頁不會重複送出預約 |

## 使用者旅程

```text
身為未登入的顧客
我想要在手機上瀏覽服務項目、選一個空的時段、填基本資料送出
以便不用打電話就能完成預約，並馬上知道有沒有約成功
```

## 功能需求

- WHEN 顧客造訪首頁 THE SYSTEM SHALL 顯示所有 `is_active=true` 的服務項目（名稱／時長／價格）。
- WHEN 顧客選擇一個服務並選擇日期 THE SYSTEM SHALL 呼叫可預約時段查詢，只回傳「在 `business_hours` 定義的營業時間內」且「未與任何既有 `appointments`（`pending`/`confirmed`/`completed`，不含 `cancelled`）重疊」的時段；不可選時段在畫面上直接不可點擊。時段以 30 分鐘為格點（例如 10:00、10:30、11:00…），起點需讓「起點＋服務時長」仍落在營業時間內才視為可選。所有時間運算以 `Asia/Taipei` 時區為準。
- WHEN 顧客選定時段並填寫姓名（必填）、電話（必填，格式為台灣手機或市話）、email（選填，若填需符合格式） THE SYSTEM SHALL 送出建立預約請求。
- WHEN 建立預約請求成立 THE SYSTEM SHALL 在同一交易內：依 `phone` 尋找既有 `customers` 記錄；找不到才依 `email` 尋找；兩者都找不到才新建。若 `phone` 命中顧客 A、但 `email` 另外命中不同的既有顧客 B，以 `phone` 命中的 A 為準，不覆寫 A 既有的 email／其他欄位（避免顧客打錯字誤改到別人的資料）。建立一筆 `status='pending'` 的 `appointments`，`customer_id` 指向上述顧客記錄。
- WHEN 顧客送出的時段早於「現在＋1 小時」，或晚於「現在＋90 天」 THE SYSTEM SHALL 拒絕並回傳驗證錯誤，不建立預約記錄。
- WHEN 同一電話號碼已有 3 筆以上尚未過期的 `pending`／`confirmed` 預約 THE SYSTEM SHALL 拒絕新的預約請求並回傳錯誤，做為基本防灌爆機制（見「非目標」：進階防濫用機制留待之後視訊號處理）。
- WHEN 兩筆建立請求搶同一重疊時段（不分服務，因為只有一位設計師同時只能服務一位顧客） THE SYSTEM SHALL 只允許其中一筆成功，另一筆回傳「時段已被預約」錯誤，不建立重複記錄；此保證由資料庫層 exclusion constraint 強制（見「資料與 API」），不是應用層鎖，也不分服務種類。
- WHEN 送出失敗（欄位驗證錯誤／時段衝突／服務已下架／超出可預約視野／同號碼預約數上限／未知錯誤） THE SYSTEM SHALL 顯示對應錯誤訊息、不建立預約記錄，讓顧客可修正後重試。
- WHEN 預約建立成功 THE SYSTEM SHALL 顯示成功頁（服務／時段／姓名／電話摘要，摘要內容一律回顯顧客本次送出的值，不是資料庫既有顧客記錄的值），且重新整理該頁不會重複送出（成功狀態存於前端 client state，非用可重放的 URL 參數觸發送出）。
- WHEN 尚未有任何 `business_hours` 資料（例如剛佈署的新環境） THE SYSTEM SHALL 以本 Epic 建立的種子資料為準（預設週一至週六 10:00–19:00、週日公休），可預約時段運算不會因為表是空的而整天都顯示可預約。

## 畫面

依 Epic 0 S5 已核准的變體 B「單頁捲動」（見
[`screen-spec-顧客前台預約流程.md`](../專案設置/screen-spec-顧客前台預約流程.md)）：

| 畫面 | 狀態 | 備註 |
|---|---|---|
| 服務列表區塊 | 預設、載入中、空狀態（尚無啟用服務） | 首屏／單頁最上方區塊 |
| 選時段區塊 | 預設（選定服務後展開）、載入中（查詢可預約時段）、空狀態（當日已無空檔） | 服務區塊收合為摘要列 |
| 填寫資訊區塊 | 預設（選定時段後展開）、錯誤（欄位驗證失敗） | 前兩區塊收合為摘要列，可點「修改」回頭調整 |
| 預約成功 | 成功（取代整頁內容） | 顯示服務／時段／聯絡資訊摘要 |
| 送出中 | 載入中（送出按鈕 loading，避免重複送出） | 沿用 S4 `Button` 的 `loading` prop |
| 送出失敗 | 錯誤（時段衝突／服務下架／未知錯誤） | 沿用 S4 `Alert`／`ToastProvider` |

## 資料與 API

- **既有邊界變更（重要）**：TASK-003 的 `0001_core_schema.sql` 已開放 anon 用欄位限制的
  `grant insert` ＋ `"anyone can create pending appointment"` policy **直接**寫入
  `appointments`。這是 TASK-003 當時「先求堪用」的過渡設計；本 Epic 引入時段衝突檢查與
  顧客去重後，這條路徑必須撤銷，改成兩個 RPC 是唯一寫入／查詢入口，否則顧客可以繞過
  `create_appointment` 的所有驗證直接灌資料。`0002_booking_flow.sql` 必須 `drop policy`
  該政策並 `revoke insert (...) on public.appointments from anon`，同時同步更新
  `tests/rls.integration.test.ts` 裡斷言「anon 可以新增預約」的既有測試案例（改成斷言
  anon 直接 insert 會被拒絕）。此變更記錄於 `ai/context/decisions.md`。
- 輸入：
  - 讀取啟用中服務：沿用既有 `services` 表的 anon SELECT policy（TASK-003 已建立，`is_active=true`）。
  - 查詢可預約時段：新增 RPC `get_available_slots(p_service_id uuid, p_date date) returns
    jsonb`，`SECURITY DEFINER`、`set search_path = ''`、`grant execute` 只給 `anon`（明確
    `revoke execute ... from public`，因為 Postgres 預設新函式對 `PUBLIC` 開放執行權）。
    只回傳「可用起訖時間」陣列，不回傳任何 `appointments`／`customers` 的個資欄位；會先
    確認 `p_service_id` 對應的服務 `is_active=true`，且 `p_date` 需在「今天～今天+90 天」
    範圍內，否則回傳空陣列而非報錯。
  - 建立預約：新增 RPC `create_appointment(p_service_id uuid, p_start_at timestamptz,
    p_customer_name text, p_customer_phone text, p_customer_email text) returns jsonb`，
    `SECURITY DEFINER`、`set search_path = ''`、`grant execute` 只給 `anon`。內部負責：
    驗證服務啟用中、驗證時段仍在營業時間內／未超出提前量與視野上限／同號碼未超過同時
    `pending` 上限、顧客去重找/建 `customers`（規則見「功能需求」）、寫入 `appointments`
    （`status='pending'`，交由資料庫 exclusion constraint 擋下衝突）、回傳預約摘要（不
    回傳 `access_token`，該欄位留給「顧客自助查詢」Epic 使用）。
- 輸出：兩個 RPC 一律回傳 `jsonb`，形如 `{ "ok": true, "data": {...} }` 或
  `{ "ok": false, "error_code": "...", "message": "..." }`——函式內部用
  `exception when others` 捕捉底層錯誤（含 exclusion constraint 違反），轉換成一致的
  jsonb 錯誤物件回傳，不讓原始 Postgres 例外訊息（可能包含 constraint 名稱等內部細節）
  直接傳到前端。`create_appointment` 成功時 `data` 為 `{ service_name, start_at, end_at,
  customer_name, customer_phone }`，其中 `customer_name`／`customer_phone` 一律回顯本次
  請求送出的值，不是資料庫裡既有顧客記錄的值（避免變成用電話號碼反查出他人姓名的
  列舉漏洞）。失敗時 `error_code` 為 `SLOT_CONFLICT` / `SERVICE_INACTIVE` /
  `VALIDATION_ERROR` / `BOOKING_LIMIT_EXCEEDED` / `INTERNAL_ERROR`（未預期錯誤統一歸類此
  類，不透出底層訊息），供前端對應成使用者看得懂的中文訊息。
- 驗證：姓名必填（1–50 字）；電話必填，格式為台灣手機（`09xxxxxxxx`）或市話，送進 RPC
  前先正規化（去除空格／破折號）；email 選填，填了需符合基本 email 格式；`start_at`
  必須是 `get_available_slots` 回傳過的合法時段、且對齊 30 分鐘格點（前端已篩選，後端
  RPC 仍需重新驗證，不可只信任前端）。
- 錯誤：時段衝突（`SLOT_CONFLICT`）、服務已下架（`SERVICE_INACTIVE`）、欄位驗證失敗／
  超出提前量或視野上限（`VALIDATION_ERROR`）、同號碼預約數達上限
  （`BOOKING_LIMIT_EXCEEDED`）、未預期錯誤（`INTERNAL_ERROR`，顯示通用錯誤訊息＋可重試）。

## 安全性與隱私

- 身分驗證：無，顧客全程免登入。
- 權限：anon 只能透過 `get_available_slots`／`create_appointment` 兩個 `SECURITY DEFINER`
  RPC 存取資料，**撤銷**既有 `"anyone can create pending appointment"` 的直接 INSERT
  policy（見「資料與 API」），不新增任何 `customers`／`appointments` 的 anon RLS
  policy；兩個 RPC 都要 `set search_path = ''`，`grant execute` 明確只給 `anon`，並
  `revoke execute ... from public`（Postgres 新函式預設對 `PUBLIC` 開放執行權，不可依賴
  預設值）。
- 敏感資料：`customer_name`／`customer_phone`／`customer_email` 為個資，只寫入資料庫，
  不記錄於應用層 client-side log 或錯誤回報；成功頁的資訊來自送出當下的表單值，不透過
  URL query string 帶出個資（避免瀏覽器歷史記錄／Referer 外洩）。**已知限制**：Postgres
  本身若開啟 `log_min_error_statement` 等級的錯誤記錄，失敗的 SQL 陳述式可能連同參數值
  （含姓名/電話）一併寫入資料庫伺服器的錯誤日誌，這是 Postgres 平台層級行為，本 Epic
  不承諾「絕對不出現在任何 log」，只承諾「應用層／前端不主動記錄」；如需更嚴格保證，
  需另外檢視 Supabase 專案的日誌等級設定，不在本 Epic 範圍。
- 顧客去重不得成為 PII 列舉管道：`create_appointment` 回傳給前端的 `customer_name`／
  `customer_phone` 一律回顯「本次請求送出的值」，不得回傳資料庫裡比對到的既有顧客記錄
  欄位值——否則任何人只要猜電話號碼呼叫本 RPC，就能反查出對應顧客的真實姓名，等於繞過
  `customers` 表對 anon 零存取的邊界。
- 濫用情境：anon 理論上可重複呼叫 `create_appointment` 灌爆 `pending` 預約。本 Epic在
  RPC 內建的因應（非僅前端）：(1) 時段需晚於「現在＋1 小時」且不晚於「現在＋90 天」，
  拒絕任意過去或超遠未來的時段；(2) 同一電話號碼同時最多 3 筆未過期的
  `pending`／`confirmed` 預約，超過即拒絕；(3) 資料庫層 exclusion constraint 從根本防止
  同一時段被灌爆成多筆衝突資料；前端另外在送出後鎖住按鈕避免手動重複點擊。更進階的
  IP rate-limit／CAPTCHA 記錄為已知限制，不在本 Epic 實作，待觀察到實際濫用訊號或風險
  承受度改變時再處理。

## 驗收標準

- 顧客可在 `/`（或後續決定的路由）完整走完：服務列表 → 選時段 → 填資訊 → 成功頁，
  且畫面版型符合 S5 已核准的單頁捲動變體 B，行動裝置尺寸下不截斷。
- 已被占用或非營業時間的時段在畫面上不可選取，不會等送出才被拒絕。
- anon 直接對 `appointments` 下 `insert`（不經過 RPC）會被 RLS 拒絕——確認舊的
  `"anyone can create pending appointment"` policy 已撤銷，`create_appointment` 是唯一
  寫入路徑；`tests/rls.integration.test.ts` 對應的舊斷言已同步更新。
- 3-5 個以上並發請求搶同一時段時，資料庫保證只有一筆成功，其餘回傳 `SLOT_CONFLICT`
  （多輪重複驗證，非單次僥倖通過）；另外驗證「時段恰好相鄰（如 10:00-10:30 與
  10:30-11:00）應兩者皆可成功」與「重疊 1 分鐘應被拒絕」，確認 exclusion constraint
  的邊界正確、沒有一刀切擋掉相鄰時段。
- 送出成功後建立的 `appointments` 記錄，`customer_id` 正確關聯既有或新建的 `customers`
  記錄（同 phone 兩次預約應關聯同一個 `customer_id`，不產生重複顧客；phone 命中 A、
  email 命中不同顧客 B 的情境依「功能需求」定義的規則正確處理）。
- `business_hours` 表與種子資料存在，可預約時段運算依此表計算，不是寫死在應用程式碼裡；
  `services` 表已有種子資料（至少 2-3 筆）。種子資料透過腳本或可重複執行的方式產生，
  不因重跑 migration 而重複或遺失既有管理者已修改的資料。
- `npx tsc --noEmit`／`npm run lint`／`npm run build`／`npm test`（含新增單元測試）／
  `npm run test:booking`（新增的 RPC 整合測試）／`npm run test:rls`（既有 RLS 測試，
  確認本 Epic 沒有造成回歸）皆通過。

## 驗證計畫

- 單元測試：表單驗證規則（姓名/電話/email 格式、電話正規化）；若時段篩選邏輯有抽出
  TS 端純函式，一併覆蓋。
- 整合測試：新增獨立的 `npm run test:booking`（比照 `test:rls` 模式，對真實 Supabase
  專案跑），涵蓋 `get_available_slots`／`create_appointment` 兩個 RPC 的正確性、
  「anon 無法繞過 RPC 直接讀寫 `appointments`/`customers`」、「3-5 個以上並發搶同一
  時段只有一筆成功（多輪）」、「相鄰時段可共存、重疊時段被拒絕」、「顧客去重含
  phone/email 衝突情境」等案例；同時重跑既有 `npm run test:rls` 確認沒有回歸。
- E2E／視覺：Browser 工具在行動裝置尺寸下跑一次完整流程（服務列表→選時段→填資訊→
  成功頁），比對 S5 mockup 的版型與各狀態（載入中／空狀態／錯誤／成功）。
- 手動：至少驗證一次「兩個瀏覽器分頁同時搶同一時段」的衝突情境。
