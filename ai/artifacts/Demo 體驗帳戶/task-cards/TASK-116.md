# AI-Ready 任務卡

## Metadata

- 任務：Demo 專屬資料筆數上限（migration，BEFORE INSERT 觸發器）
- 上層規格：[`feature-spec.md`](../feature-spec.md)；架構筆記：[`architecture-notes.md`](../architecture-notes.md) D14
- 上層 Epic：Demo 體驗帳戶
- 上層 User Story：濫用防護與緊急開關
- 分軌：後端
- 前置任務（dependsOn）：TASK-097、TASK-106（皆 Done）
- 狀態：人工驗收通過，Done（2026-11-01；修訂版已套用，verify.sql ALL_OK，整合測試與回歸全過；回滾已實測）
- 風險等級：高
- Agent owner：Claude Code
- 人工核准者：使用者（2026-11-01 指示開始動工；各表上限 2026-11-01 核准，見下表；2026-11-01 人工驗收通過）

## 目標

Demo 體驗帳號是管理員，能新增服務、設計師、公休日等資料；公開入口的任何人都能以腳本大量新增，灌爆免費方案的資料庫容量，拖垮整個正式專案（含前台預約）。補上資料庫端的筆數硬上限：**只有 Demo 的 JWT 受限**，一般管理員、service role（含每日還原）、匿名顧客不受影響。與 TASK-113（Storage 上限）互補。

## 已核准的上限（整張表的總列數）

> **2026-11-01 審查後修訂：** customers 24、appointments 640 已**移除**（使用者決定）——Demo 只能經 `create_appointment` 寫入，匿名訪客能呼叫同一個 RPC，上限擋不到灌資料的人，反而讓匿名流量擠掉 Demo 的預約。最終為下列六張表。

| 表 | seed 筆數 | Demo 上限 | 核准 |
|---|---|---|---|
| services | 4 | 10 | 使用者指定（2026-10-31） |
| designers | 4 | 5 | 使用者指定 |
| designer_services | 14 | 50 | 使用者核准建議值（2026-11-01） |
| designer_leaves | 2 | 20 | 同上 |
| designer_portfolio_images | 40 | 60 | 同上 |
| closed_dates | 1 | 20 | 同上 |

## 情境包（Context Pack）

- 相關檔案：
  - `supabase/migrations/0025_storage_owner_and_demo_caps.sql`（硬上限的先例：SECURITY DEFINER、`pg_advisory_xact_lock`、尾端自我檢查）
  - `supabase/migrations/0026_demo_suppress_update_mail.sql`（以 `auth.jwt()` 判斷 Demo 的先例，PostgREST 請求內有效）
  - `supabase/migrations/0024_demo_reset.sql` 第 168～479 行（`reset_demo_data`；**第 281～285 行的觸發器白名單必須同步補上新觸發器，否則還原會在守門區拒絕執行**）
  - `supabase/migrations/0018_designer_aware_booking.sql`（`create_appointment` 對 customers 是先查再 insert，不是 upsert）
  - `lib/admin/closed-dates.ts`（公休日是 upsert，on conflict 時 BEFORE INSERT 仍會觸發）
  - `ai/artifacts/Demo 體驗帳戶/verification/TASK-114-verify.sql`（以 `set_config` 模擬 JWT、交易以例外收尾保證回滾的驗證腳本寫法）
- 既有模式：SQL Editor 整份執行、`begin/commit`、依賴檢查、尾端自我檢查、`_down.sql`；整合測試用拋棄式帳號。
- 假設：
  - PostgREST 請求內 `auth.jwt()` 讀得到 `app_metadata.is_demo`（TASK-114 已實測）；`create_appointment` 是 SECURITY DEFINER，但 `request.jwt.claims` 設定值不受影響。
  - 還原以 service role 執行，沒有 Demo claim，不受限；dry-run 同理。
- 未知事項：
  - 同一個 INSERT 陳述式多列時，BEFORE ROW 觸發器內的 `count(*)` 是否看得到同陳述式先前寫入的列（實測；決定多列 insert 能否被擋住）。
  - 觸發器函式的擁有者可繞過 RLS（否則計數永遠是 0；比照 0025 的自我檢查）。
- 允許變更的檔案：
  - `supabase/migrations/0027_demo_row_caps.sql` 與 `_down.sql`（新增）
  - `tests/lib/demo-row-caps-migration.test.ts`（新增，不連資料庫）
  - `tests/demo-row-caps.integration.test.ts`、`vitest.demo-row-caps.config.ts`（新增）、`package.json`（新增 `test:demo-row-caps`，以及把單元測試納入既有指令的方式依現況）
  - `tests/lib/demo-reset-test-scan.test.ts`（實作時補登記：白名單加入 0027 與其單元測試，兩者出現 `reset_demo_data` 字樣但不呼叫）
  - `ai/artifacts/Demo 體驗帳戶/verification/TASK-116.md`、`TASK-116-verify.sql`（新增）
  - `ai/context/decisions.md`、`architecture-notes.md`（D14 補記）、本任務卡、`tools/kanban/cards/TASK-116.json`
- 不得觸碰：既有 migration 檔、既有資料表結構與 policy、`designer001` 與真實 Demo 帳戶、任何真實資料（測試只用拋棄式帳號與拋棄式資料列）。

## 需求

- 對六張表各加一個 `BEFORE INSERT ... FOR EACH ROW` 觸發器（`demo_row_cap_<表名>`），共用一個函式 `public.demo_row_cap_guard()`；上限集中在該函式內的 `case` 一處。
- 先以 `current_setting('request.jwt.claims')` 字串預篩（沒有 `is_demo` 就放行，不解析 JSON、不依賴 auth schema）；疑似 Demo 才檢查 `auth.jwt() -> 'app_metadata' ->> 'is_demo'` 為 `'true'`，解析失敗即拒絕。
- 檢查：以 `pg_advisory_xact_lock` 讓同一張表的 Demo 寫入排隊，再計算該表**目前總列數**；`>= 上限` 時拒絕（**硬上限**，並行不超出）。
- 錯誤：`P0001`，訊息以 `DEMO_ROW_CAP:` 開頭並帶表名與上限，`hint` 為白話文字（「體驗帳號的資料筆數已達上限，每日凌晨會自動還原」）。
- 函式 SECURITY DEFINER、`search_path` 為空、擁有者可繞過 RLS、API 角色不可執行。
- `reset_demo_data` 的觸發器白名單同步補上六個新觸發器：0027 內以 `create or replace` 重新定義該函式，**除白名單外與 0024 逐字相同**（單元測試把關）；`_down.sql` 還原成 0024 本文。
- `_down.sql`：先 drop 觸發器（含初版的 customers／appointments）與函式，再還原 `reset_demo_data`；尾端自我檢查；檔頭警告 0028 以上不得使用。
- 初版（8 個觸發器）已被套用過：修訂版重跑即可，會清掉 customers／appointments 的兩個。
- 緊急停用（檔頭寫明）：`drop trigger if exists demo_row_cap_<表> on public.<表>;`。

## 非目標

- 不處理應用程式端的白話錯誤訊息（目前各管理操作對未知錯誤顯示通用訊息）：另案提出，見完成證據的後續任務。
- 不限制容量（位元組），只限列數；不限制匿名顧客的預約（既有的 Email／頻率規則不在本卡）。
- 不改 `business_hours`、`booking_policy`、`store_settings`（固定列數）、`audit_log`、`admins`。
- 不處理 TASK-114 殘留的 R1／R2（TASK-120、TASK-121）。

## 驗收標準

- Demo 在六張表各自達上限後再新增一筆被拒絕（`DEMO_ROW_CAP`）；未達上限可新增。
- 一般管理員（非 Demo）、service role、無 JWT 的連線在表已滿時仍可新增；claims 不是合法 JSON 且不含 `is_demo` 時放行（失敗方向）。
- 多列單一 `insert` 超過上限整句被拒絕；並行 Demo 新增在剩餘額度為 N 時恰好 N 筆成功。
- `reset_demo_data` 的 dry-run 在套用 0027 後仍通過（白名單已同步）；既有 `test:demo-reset`、`test:designers`、`test:services`、`test:business-hours`、`test:booking`、`test:admin-booking` 回歸通過。
- seed 各表筆數都小於上限（單元測試），Demo 還原後仍有操作空間。
- `_down.sql` 後上限消失、`reset_demo_data` 的白名單回到 0024。
- customers／appointments 不再有上限觸發器（初版建立的已清掉）。
- 日後新增的 migration 若在這十一張被覆寫的表上建立觸發器，卻沒有補進最新 `reset_demo_data` 的白名單，單元測試失敗。

## 實作備註

- 對公休日這類 upsert：表已滿時，對「已存在日期」的重複新增也會被拒絕（BEFORE INSERT 先於 on conflict 判斷）；接受並記錄，每日還原後恢復。
- 上限是整張表總列數：匿名顧客的預約也佔額度（見 TASK-106 殘留風險）。
- 目前正式庫的資料量可能已超過部分上限（使用者自己的測試資料）；觸發器只管新增，不影響既有資料，Demo 要等第一次真實還原（TASK-112）後才有額度。

## 驗證契約

- 單元測試：`npx vitest run tests/lib/demo-row-caps-migration.test.ts`
- 整合測試：`npm run test:demo-row-caps`（套用 0027 前為基準線、套用後生效、`_down` 後恢復三個模式）；SQL Editor 執行 `verification/TASK-116-verify.sql`（交易以例外收尾保證回滾，涵蓋八張表）。
- 回歸：`test:demo-reset`、`test:designers`、`test:services`、`test:business-hours`、`test:booking`、`test:admin-booking`、`test:demo-enter`。
- 型別檢查：`npx tsc --noEmit` 無錯誤
- Lint：`npm run lint` 無錯誤
- Build：`npm run build` 成功
- 螢幕截圖：不適用。
- 安全性檢查：Demo 判斷來自簽章後的 JWT claim（`app_metadata`，使用者無法自行改寫）；觸發器函式 API 角色不可執行；不新增任何對 API 開放的函式或資料表。

## 審查關卡

架構、安全性、驗證（測試工程）；高風險，動工前須人工核准。

## 完成證據

- 狀態：修訂版已由使用者套用，`TASK-116-verify.sql` `RESULT=ALL_OK`；`test:demo-row-caps` 16/16、`test:demo-reset` 34/34、六個回歸套件與 tsc／lint／build 全過（2026-11-01）。回滾（`_down`）已實測：回滾後 off 模式 16/16、test:demo-reset 34/34；重套後預設模式 16/16、test:demo-reset 34/34。
- 變更的檔案與已跑的驗證：見 [`verification/TASK-116.md`](../verification/TASK-116.md)。
- 與草稿不同：函式改 SECURITY DEFINER、硬上限、字串預篩；移除 customers／appointments（理由見驗證報告）。
- 已知限制：整張表總列數計數；正式庫現有資料可能已超過部分上限；`closed_dates` upsert 在表已滿時對已存在日期也被拒絕；Demo 看到通用錯誤訊息。
- 後續任務：**TASK-122（audit_log 每帳戶上限）、TASK-123（欄位長度 CHECK）——Demo 入口前置條件，已加入 TASK-112 依賴**；建議 TASK-120／121 同列阻擋條件（待使用者決定）；前端白話錯誤訊息（Demo 觸頂時）；TASK-111 手冊補「緊急停用單表上限」與「惡意使用者可在還原後填滿額度」；TASK-112 真實還原前確認各表筆數。
