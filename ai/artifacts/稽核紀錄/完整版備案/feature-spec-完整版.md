# 功能規格書

## Metadata

- 功能：稽核紀錄（既有 Epic，核准後依本規格更新 `tools/kanban/epics.json` 的 stories）
- 負責人：待指定
- 狀態：人工已核准（使用者，2026-10-23）
- 風險等級：高。
  - 要在 `appointments` 與多張設定表掛資料庫 trigger，其中 `create_appointment`（顧客端唯一寫入路徑）會多一次寫入，稽核寫入出錯可能連帶擋住預約。
  - 新增一張「寫入後不可修改、不可刪除」的資料表，權限邊界（GRANT／RLS／trigger 函式）出錯等於稽核失去意義。
  - 本專案整合測試都對**同一個正式 Supabase 專案**執行，會產生稽核資料（見「風險與待架構階段定案事項」）。
  - 需要架構、安全性、測試三方審查。
- 已與人工確認的範圍決策（2026-10-23）：
  - **記錄範圍：預約＋影響可預約性的設定**（不含商店文案／圖片、設計師頭像與作品集、帳號資料）。
  - **加記顧客建立預約**，操作者區分「店長」「顧客」「系統」。不記寄信與 cron 提醒這類系統行為。
  - **不存顧客個資**（姓名、電話、email 都不進稽核表）。
- 先前 Epic 已明確延後到本 Epic 的項目：預約操作歷史（預約管理後台）、設定異動歷史（商店基本資料、營業時間）、`booking_policy` 被改壞會靜默關掉預約功能卻無記錄（TASK-050 安全審查，見 `app/admin/_components/BookingPolicyForm.tsx` 檔頭註解）。

## 問題

- 後台的寫入都是瀏覽器直接用登入者的 session 對 Supabase 寫入（受 RLS 約束，沒有統一的伺服器端入口），資料表本身只留 `updated_at`，**事後無法回答「誰在何時把什麼改成什麼」**。
- 預約被取消或改期後，只看得到現在的狀態，看不出原本是什麼時間、誰改的、是店長改的還是顧客自己建的。
- 影響顧客能不能預約的設定（提前預約時間、營業時間、公休日、服務上下架、設計師停用／請假）被改錯或被盜用帳號惡意修改時，症狀只是「前台突然沒有時段」，沒有任何線索可以追查（TASK-050、TASK-077 審查已點名這個風險）。

## 使用者

- 店長（後台唯一登入帳號，經 `is_admin()` 驗證）：直接使用者，查看稽核紀錄列表。
- 顧客（前台，未登入）：不接觸稽核功能，只是「顧客建立預約」事件的觸發者。
- 系統（service_role：webhook、cron、種子腳本、整合測試）：不是使用者，但其寫入需要被明確分類，避免與店長操作混淆。

## 目標

- 預約的**建立、完成、取消、改期**都自動留下一筆記錄，包含操作者、時間、前後差異。
- 影響可預約性的設定被**新增、修改、刪除**時自動留下記錄，包含前後值。
- 記錄由**資料庫 trigger** 產生，不依賴前端程式有沒有記得呼叫；直接打 Supabase REST／RPC 的寫入也一樣會被記錄。
- 稽核紀錄**寫入後不可修改、不可刪除**（對 anon／authenticated 在授權層就擋下），只有店長可讀。
- 店長可在後台看到依時間倒序的稽核列表，能依類型、日期區間、預約編號篩選，差異以中文白話顯示。
- 稽核紀錄不含顧客個資。

## 非目標

- **顧客個資**（姓名、電話、email）：已確認不存。列表需要顧客姓名時不顯示，只顯示預約編號。
- **登入／登出／MFA／改密碼／改 email 事件**：這些在 Supabase Auth 層（`auth.audit_log_entries`），不在 public 資料表，本 Epic 不納入；店長可到 Supabase Dashboard 的 Auth logs 查。
- **商店基本資料、Logo／封面圖、設計師基本資料中的簡介／專長／IG／頭像、作品集、帳號個人資料**：已確認不納入。日後要加，只需對該表掛同一支 trigger 函式。
- **寄信、cron 提醒、`reminder_sent_at`／`confirmation_sent_at` 這類系統欄位的更新**：不記，否則每天都會產生雜訊。
- **IP、User-Agent 等請求來源資訊**：這次不記（資料庫 trigger 內雖可從 `request.headers` 取得，但可信度與隱私影響需另行評估）。
- **歷史資料回填**：稽核從部署當下才開始記，不回補既有預約與設定的過去異動。
- **編輯、刪除、匯出（CSV）、保留期限自動清理**：列表唯讀；保留期限本次不做（資料量小，見假設）。
- **預約詳情對話框內嵌「這筆預約的歷史」**：本次只做獨立列表，可由預約編號篩選；內嵌留給後續任務。
- **即時通知／警示**（例如設定被改時寄信給店長）：不做。
- **行動裝置版面**：沿用既有後台非目標，桌面為主。

## 使用者故事（User Stories）

| 故事 | 身為／我想要／以便 | 驗收標準 |
|---|---|---|
| 稽核資料基礎 | 身為店長，我想要有一個寫入後無法被改動的稽核資料表，以便記錄值得信任 | `audit_log` 表存在；anon 完全無權限；authenticated 只有 `select` 且須通過 `is_admin()`；任何角色（含 authenticated、service_role）都不能 insert／update／truncate 稽核列；刪除只限帶「測試標記」的列（僅 service_role，每次刪除寫入不可刪的清除帳本），其餘列任何應用程式角色都刪不掉；稽核列只能由 trigger 函式寫入 |
| 記錄預約異動 | 身為店長，我想要每筆預約被建立、完成、取消、改期時都有記錄，以便追查預約為何變成現在這樣 | 顧客建立→1 筆（操作者＝顧客）；店長完成／取消／改期→各 1 筆（操作者＝店長）；改期記錄前後的起訖時間；`reminder_sent_at` 等系統欄位更新不產生記錄；記錄不含顧客姓名、電話、email |
| 記錄影響可預約性的設定異動 | 身為店長，我想要提前預約時間、營業時間、公休日、服務、設計師的異動都有記錄，以便設定被改錯或被盜用時能查出來 | 見「功能需求」第 3 組的逐表規則；值沒有實際變動的儲存不產生記錄；一次儲存七天營業時間時只記有變動的那幾天 |
| 查看稽核紀錄列表 | 身為店長，我想要在後台看到依時間倒序的稽核列表，以便事後追溯 | Sidebar 有「稽核紀錄」入口；列表顯示時間、操作者、事件、對象、差異；分頁載入；有載入中／空狀態／錯誤狀態；非店長看不到任何資料 |
| 篩選稽核紀錄 | 身為店長，我想要依事件類型、日期區間、預約編號篩選，以便在大量記錄中找到要查的那一筆 | 三種篩選可單獨或組合；清除篩選回到全部；無符合結果顯示空狀態而非錯誤；列表顯示「已載入 N 筆」（不做總筆數查詢） |

## 使用者旅程

```text
身為店長，
我發現有位顧客說「我明明預約了週六下午，怎麼被改成週日」，
以便搞清楚這筆預約被誰動過。

我進後台點「稽核紀錄」，在預約編號欄貼上那筆預約的編號，列表只剩兩筆：
10/18 14:02 顧客 建立預約（剪髮・設計師 A・10/25 15:00）、
10/20 09:41 店長 改期（10/25 15:00 → 10/26 15:00）。
我確認是我自己前天改的，記得是因為設計師 A 當天臨時請假。
```

```text
身為店長，
我發現前台突然一個時段都沒有，
以便找出是不是設定被改壞了。

我進稽核紀錄，事件類型篩「設定異動」，看到昨晚 23:12 有一筆
「預約規則：最短提前預約時間 2 小時 → 720 小時」，操作者是店長，
但我昨晚沒有登入後台——我立刻改回設定並更換密碼、啟用 MFA。
```

## 功能需求

### 1. 資料基礎與權限

- THE SYSTEM SHALL 提供 `audit_log` 資料表，欄位至少包含：流水號、發生時間（資料庫端 `clock_timestamp()`，不接受外部傳入）、操作者類型（`admin`／`customer`／`system`／`unknown`）、JWT role、操作者使用者 id（可為 null）、事件類型代碼、對象類型、對象 id（上限 128 字元）、人類可讀的摘要快照、欄位前後差異、測試標記（可為 null）。
- THE SYSTEM SHALL 對 `audit_log` 撤銷 anon 全部權限，對 authenticated 只授與 `select`，且 RLS policy 要求 `is_admin()`；anon 的任何操作 SHALL 被授權層拒絕（42501）；非管理員 authenticated 與 MFA aal1 管理員的 `select` SHALL 回傳空結果（RLS，非 42501）；任何角色對 `audit_log` 的 insert／update／truncate SHALL 被拒絕（GRANT、RLS 或 trigger 至少其一，truncate 以 SQL 驗證）。
- THE SYSTEM SHALL 對 `service_role` 只授與 `select` 與 `delete`，且 `delete` 只能刪除帶測試標記的列；每次對 `audit_log` 的刪除 SHALL 寫入不可修改、不可刪除的清除帳本。測試標記只有在請求同時帶有與資料庫 Vault 密鑰相符的密鑰時才會寫入。
- THE SYSTEM SHALL 在稽核內部函式放在不對外公開的 schema，anon、authenticated、service_role 皆不可呼叫。
- THE SYSTEM SHALL 只透過 `SECURITY DEFINER` trigger 函式寫入稽核列，這些函式 SHALL 設 `search_path = ''`，且 anon／authenticated 無 execute 權限。
- THE SYSTEM SHALL 在 `audit_log` 的對象 id 欄位使用不帶外鍵的純值，使被刪除的對象（例如測試資料、日後可能的硬刪除）不會連帶影響稽核列。
- WHEN 操作者判定發生時，THE SYSTEM SHALL 依序判斷：`public.is_admin()` 為真 → `admin`（記 `auth.uid()`）；請求角色為 `service_role` 或無 claims（直連）→ `system`；`anon` → `customer`；其餘已登入但非店長 → `unknown`（記 `auth.uid()`）。`appointment.created` 例外：一律為 `customer`（`service_role`／無 claims 則 `system`），且不記使用者 id（店長登入狀態下用前台訂位仍是顧客流程）。判斷依據一律來自資料庫端已驗簽的 JWT claims，不接受呼叫端傳入。

### 2. 預約異動

- WHEN 一筆 `appointments` 被 INSERT，THE SYSTEM SHALL 記錄事件 `appointment.created`，摘要含預約編號、服務名稱、設計師名稱、起訖時間，**不含**顧客姓名、電話、email、`access_token`。
- WHEN `appointments.status` 由非 `completed` 變為 `completed`，THE SYSTEM SHALL 記錄 `appointment.completed`；變為 `cancelled` 時記錄 `appointment.cancelled`，並附前一個狀態。
- WHEN `appointments.start_at` 或 `end_at` 改變，THE SYSTEM SHALL 記錄 `appointment.rescheduled`，差異含前後起訖時間。
- WHEN `appointments.status` 發生上述兩種以外的變化（例如已取消改回待確認），THE SYSTEM SHALL 記錄 `appointment.status_changed`；WHEN `designer_id` 或 `service_id` 改變（目前只有 service_role 能做到），THE SYSTEM SHALL 記錄 `appointment.reassigned`。
- WHEN 同一次 UPDATE 同時改變多種追蹤欄位，THE SYSTEM SHALL 各記一筆對應事件（不合併成一筆含糊的記錄），順序為狀態類、改期、改派。
- WHEN 只有 `reminder_sent_at`、`confirmation_sent_at` 等系統欄位被更新，THE SYSTEM SHALL NOT 產生稽核列。
- WHEN 預約被 DELETE（目前只有測試清理會發生），THE SYSTEM SHALL 記錄 `appointment.deleted`，讓稽核至少不留下沉默的缺口。

### 3. 設定異動（只記前後有實際差異的欄位）

| 資料表 | 事件 | 追蹤欄位（摘要顯示用名稱） |
|---|---|---|
| `booking_policy` | `booking_policy.created`／`updated`／`deleted` | `min_lead_time_hours`、`cancel_window_hours` |
| `business_hours` | `business_hours.created`／`updated`／`deleted`（每個有變動的星期一筆） | 營業起訖時間、是否公休 |
| `closed_dates` | `closed_date.added`／`closed_date.removed`（重複加入同一天不記） | 日期 |
| `services` | `service.created`／`updated`／`deleted` | 名稱、價格、時長、緩衝時間、是否上架（上下架另標示在摘要，因為最常被追查） |
| `designers` | `designer.created`／`updated`／`deleted` | 名稱、是否啟用（停用／重新啟用另標示）；不含簡介／專長／IG／頭像／排序 |
| `designer_services` | `designer_service.enabled`／`designer_service.disabled` | 設計師名稱、服務名稱 |
| `designer_leaves` | `designer_leave.added`／`designer_leave.removed` | 設計師名稱、日期 |

- WHEN 一次儲存的新值與舊值完全相同（例如營業時間表單按儲存但沒改任何欄位），THE SYSTEM SHALL NOT 產生稽核列。
- THE SYSTEM SHALL 在摘要中保存**事件當下**的人類可讀名稱（服務名稱、設計師名稱），使對象之後改名或停用，稽核列仍可閱讀；摘要不得包含 `designers`／`services` 以外的個資欄位。
- WHEN 設計師被停用或某位設計師被標請假，THE SYSTEM SHALL NOT 另外記錄「受影響預約」（只記動作本身，影響範圍由後台既有警告處理）。

### 4. 寫入原子性

- WHEN 稽核寫入失敗，THE SYSTEM SHALL 讓整個原始變更一併回滾（同一交易），不允許出現「已變更但沒有記錄」；失敗 SHALL 以專用 SQLSTATE `AUD01` 拋出，使資料庫 log 能辨識。
- THE SYSTEM SHALL 保證稽核寫入不會因輸入內容而失敗：名稱等文字快照在寫入前先截斷（60 字）。
- THE SYSTEM SHALL 在 `create_appointment` 路徑上的額外稽核寫入不改變既有回傳格式、錯誤碼與併發行為（`SLOT_CONFLICT`、`BOOKING_LIMIT_EXCEEDED` 等）。

### 5. 稽核列表（後台 `/admin/audit-log`）

- WHEN 店長開啟頁面，THE SYSTEM SHALL 以發生時間倒序載入第一頁（預設每頁 50 筆），並可載入下一頁；僅店長可見，未登入或非店長導向既有登入／拒絕流程。
- THE SYSTEM SHALL 對每列顯示：發生時間（Asia/Taipei）、操作者（店長／顧客／系統）、事件（中文）、對象摘要、前後差異（例如「最短提前預約時間：2 小時 → 720 小時」）。
- THE SYSTEM SHALL 提供篩選：事件類別（全部／預約／設定）、日期區間、預約編號；篩選在資料庫端執行，不在前端對整批資料過濾。
- WHEN 預約事件有對應預約編號，THE SYSTEM SHALL 把編號顯示為可複製的文字（點擊可複製，方便貼回篩選欄）。
- WHEN 查詢失敗，THE SYSTEM SHALL 顯示錯誤狀態與重試，不顯示部分資料。
- WHEN 沒有任何符合結果，THE SYSTEM SHALL 顯示空狀態，並區分「尚無任何紀錄」與「沒有符合篩選條件的紀錄」。

## 畫面

| 畫面 | 狀態 | 備註 |
|---|---|---|
| 稽核紀錄列表（`/admin/audit-log`） | 預設、載入中、載入更多、空（無紀錄／無符合）、錯誤、篩選中 | 新增 Sidebar 項目；桌面為主；表格＋右側或上方篩選列；差異欄白話呈現；UI 屬必經 `ai/templates/screen-spec.md`／`mockup-decision.md` 與人工選定（Phase 3），先對照 `ai/context/design-system.md` 重用既有元件 |

## 資料與 API

- 輸入：資料庫 trigger 事件（`appointments`、`booking_policy`、`business_hours`、`closed_dates`、`services`、`designers`、`designer_services`、`designer_leaves` 的 INSERT／UPDATE／DELETE）；列表端為篩選條件（類別、日期區間、預約編號、分頁游標）。
- 輸出：`audit_log` 列；列表以店長身分直接查詢（RLS 把關，不新增 service role 路徑），中文事件名稱與差異文字在前端由事件代碼＋差異欄位組成，不存在資料庫。
- 驗證：事件類型代碼為固定集合（check constraint 或枚舉）；差異欄位為 JSON 且只含追蹤欄位白名單。
- 錯誤：稽核寫入失敗＝原始變更回滾（見功能需求 4）；列表讀取失敗＝錯誤狀態。
- 新增 migration（編號順延至 `0019`，up／down 成對）：建表時依 `decisions.md` TASK-065 在同檔寫出最小權限 GRANT。

## 安全性與隱私

- 身分驗證：列表走既有 `app/admin/layout.tsx` 三層檢查（`getUser()`／`isAalSatisfied()`／`is_admin()`）；資料層走 `is_admin()`（已啟用 MFA 的帳號需 aal2，見 0016）。
- 權限：稽核表對一般登入使用者與 anon 一律零寫入；`service_role` 只能 select 與刪除帶測試標記的列（刻意偏離 `decisions.md` TASK-065「service_role 給完整權限」的慣例，需記入 `decisions.md`）；稽核內部函式放在不對外公開的 schema。架構細節見 `architecture-notes.md` §3、§6。
- 稽核的保證邊界（如實記錄）：針對 anon、authenticated（含被盜用的店長 session）與一般應用程式路徑；資料庫 owner／Supabase Dashboard 仍可竄改稽核表或 trigger、Studio 的 impersonate 可偽造 `admin` 身分，`system` 同時涵蓋 service key 與直連。
- 敏感資料：不存顧客姓名／電話／email／`access_token`；摘要只存服務名稱、設計師名稱、時間等營運資料。設計師與服務名稱屬店家公開資訊。
- 濫用情境：
  - 被盜用的店長 session 想**抹除自己的痕跡**：authenticated 沒有 update／delete 授權，應被擋下。
  - 被盜用的 session 想**偽造別人的紀錄**：authenticated 沒有 insert 授權，只能靠被記錄的真實操作留下痕跡。
  - 公開註冊的路人帳號想讀稽核列：RLS 要求 `is_admin()`。
  - 稽核列本身成為探測管道：只有店長可讀，顧客端完全無路徑。
  - 稽核寫入故意製造失敗以阻擋顧客預約：寫入內容完全由 trigger 組成、不吃使用者可控的長字串；摘要欄位長度需有上限。

## 假設（合理且安全，若有異議請在核准時提出）

- 後台只有一位店長帳號，「操作者」顯示為「店長」，以 `actor_user_id` 關聯目前的顯示名稱；不另存 email。
- 保留期限：永久保留，不做自動清理。預估資料量（每日數十筆）一年遠低於一萬筆，不需分區或封存。
- 時區顯示固定 Asia/Taipei，與全站一致。
- 預約編號即 `appointments.id`（uuid）；篩選用完整編號精確比對。
- 稽核表的變更**向前相容**：新增事件類型只需新增 trigger，不需改表結構。

## 風險

完整風險表、緩解與定案見 `architecture-notes.md` §10。與規格直接相關的重點：

1. **整合測試污染稽核表**：已定案採「測試標記＋Vault 密鑰」（使用者 2026-10-23 選定，`architecture-notes.md` §6）；先決驗證（自訂 header 能否傳進資料庫）失敗時，退回「實體 ID 清理＋拋棄式管理員」重新規劃。
2. **稽核寫入故障會擋住顧客預約**：功能需求 4 選擇「同交易、失敗即回滾」；以名稱截斷、`entity_id` 上限放寬、專用 SQLSTATE `AUD01`、`create_appointment` 回歸測試與 `0021_down` 快速止血緩解。
3. **既有 webhook trigger 不得受影響**：`appointments` 已有 0011／0012；稽核 trigger 不改其條件與 payload。
4. **部署與回滾**：migration 拆成 0019～0023 逐卡套用；回滾順序固定為前端 → 0023 → 0022 → 0021 → 0020 → 0019，細節見 `architecture-notes.md` §8。

## 驗收標準

- 在預約與七張設定表的每一種「納入」異動後，`audit_log` 都恰好出現預期筆數的記錄（事件目錄見 `architecture-notes.md` §4，每張表每種事件至少一個 happy path，含最長的 `entity_id`），欄位與規格一致；不納入的欄位／表異動不出現記錄。
- 權限矩陣逐格符合：anon 的 select／insert／update／delete 皆 42501；非管理員 authenticated 與 MFA aal1 管理員的 select 回傳空陣列（測試前先確認底下確實有列）、寫入皆被拒；管理員 aal2 或未啟用 MFA 只能 select；service_role 能 select、insert／update 被拒、delete 僅限帶測試標記的列。truncate、「GRANT／RLS／trigger 各層獨立有效」、直連來源以可回滾的 SQL 驗證腳本驗證，輸出納入驗證報告。
- 稽核表內任何一列、任何欄位都找不到顧客姓名、電話、email、`access_token`（含 `jsonb` 內）；每個事件的 summary／changes 鍵集合嚴格屬於事件目錄白名單；設計師 bio／IG／頭像與服務 description 同樣不出現。
- `create_appointment` 對既有案例（成功、`SLOT_CONFLICT`、`BOOKING_LIMIT_EXCEEDED`、`SERVICE_INACTIVE`、併發）的回應形狀與套用前完全一致（套用前先錄基準，以嚴格鍵集合斷言）；成功時恰多一筆 `appointment.created`，各錯誤路徑 0 筆，併發時勝者恰 1 筆；店長登入狀態、anon、service_role 三種呼叫身分的操作者歸類符合規格。
- 儲存沒有實際差異的設定表單不產生稽核列；同一次儲存多天營業時間，只記有變動的天；`closed_dates` 重複加入同一天、`reminder_sent_at` 更新、`services` 只改 description 皆不產生。
- 刪除設計師或服務時連帶刪除的子列（`designer_services`／`designer_leaves`）不使原始刪除失敗，仍有記錄且保有 id。
- 後台 `/admin/audit-log` 可看到上述記錄，三種篩選與分頁運作，載入中／空／錯誤三種狀態皆可重現。
- 稽核寫入失敗時，原始變更確實回滾（以可回滾 SQL 腳本在交易內注入失敗，斷言 `AUD01` 與資料未改變，且 `create_appointment` 回 `INTERNAL_ERROR`、無 `customers` 孤兒列）。
- 各卡完成時：該卡掛上的所有舊整合套件重跑通過，且對正式資料庫的測試稽核殘留為 0。

## 驗證計畫

- 單元測試：事件代碼→中文文字、差異欄位→白話描述的純函式（時區轉換不依賴執行環境）；事件目錄與 migration 的 `event_type` 字面值漂移護欄；查詢組成（category、日期區間、預約編號 uuid 驗證、cursor、limit、下一頁判斷）；列表元件各狀態（載入中、錯誤＋重試且不顯示部分資料、空狀態兩種、載入更多、篩選變更重置游標、較慢的舊請求不覆蓋新結果、複製預約編號）；整合測試檔必須使用標記 client 工廠的靜態護欄。
- 可回滾 SQL 驗證腳本（`supabase/verify/`，單一 begin／rollback 批次）：truncate、各角色 update／delete、各層獨立有效、內部函式不可呼叫、測試標記邏輯、直連來源判定、失敗注入、各卡 `down` 演練。
- 整合測試（新增 `npm run test:audit-log`，比照既有套件獨立 config，不得與其他整合套件並行）：REST 權限矩陣（拋棄式管理員帳號，沿用 `mfa-rls` 做法）；每表每事件 happy path 與不記錄案例；`create_appointment` 基準形狀、錯誤路徑 0 筆、併發多輪、三種呼叫身分；cascade 子列；個資三層掃描（植入針、鍵白名單、全表 regex）；既有 webhook 並存回歸（`test:notifications` 套用前後各跑一次）。測試資料以測試標記精確清理，清理後同標記查詢必須為 0。
- E2E：無（專案目前沒有 E2E 套件）。
- 視覺：列表頁桌面版截圖，對照 `ai/checklists/design-review-checklist.md`；淺色／深色模式各一。
- 手動：每張來源 trigger 卡套用 migration 後立即 smoke（店長取消一筆測試預約、顧客端建立一筆預約，各出現一筆）；店長實際在後台做一輪「取消、改期、改最短提前時間、停用設計師」，再到稽核紀錄頁逐筆比對；顧客端實際建立一筆預約，確認顯示為「顧客」。人工驗收不得由 agent 自我驗證替代。

## 任務拆分

見 `architecture-notes.md` §11（卡 A～I，核准架構筆記後才建立看板卡片）。
