# 架構筆記：稽核紀錄（第 2 版）

上層規格：`ai/artifacts/稽核紀錄/feature-spec.md`（人工已核准 2026-10-23；本版同步修訂的部分見 §0，需人工確認）
風險等級：高
狀態：**第 2 版，待人工核准後才拆卡**。第 1 版經 architect（要求修改，5 項 MUST FIX）、security-reviewer（有條件核准，6 項 HIGH）、test-engineer（不足以拆卡，9 項 MUST FIX）三方審查；本版已併入全部 MUST／HIGH，SHOULD 項目併入各卡驗收條件。使用者於 2026-10-23 選定測試清理機制為「測試標記＋密鑰」。
範圍：資料庫層（migration `0019`～`0023`）＋ 測試基礎建設 ＋ 後台列表頁的資料契約。**列表頁 UI 必須先走 Phase 3 mockup 關卡**，本筆記只定資料契約。

## 0. 與規格書的差異（核准本筆記＝同意同步修訂規格書；規格書已依此更新）

| # | 規格書原寫法 | 本計畫調整 | 理由 |
|---|---|---|---|
| D1 | 預約只記建立／完成／取消／改期／刪除 | 新增 `appointment.status_changed`（其他狀態變化，例如已取消改回待確認）、`appointment.reassigned`（`designer_id`／`service_id` 被改） | `authenticated` 對 `appointments.status` 有欄位層級 update 授權，可把 `cancelled` 改回 `pending` 重新佔位；`service_role` 可改派 |
| D2 | 設定表只記新增／修改 | 每張納入的表 insert／update／delete 都記 | `authenticated` 在 0015 後**沒有**這幾張表的 delete 權限，刪除只有 `service_role`／SQL 能做（第 1 版理由引用了過時的 project-map，已更正）。仍要記，因為 service key 或 SQL Editor 的帶外刪除（例如刪掉某 weekday 的 `business_hours` 列讓該天預約全被拒）是最需要留痕的操作 |
| D3 | 操作者「店長／顧客／系統」 | `appointment.created` 一律 `customer`（無 claims 或 `service_role` 則 `system`），且 `actor_user_id` 一律 null | 預約只能經 `create_appointment` 建立；店長登入狀態下用前台訂位仍是顧客流程 |
| D4 | `service_role` 權限待決定、規格寫「任何角色都不能 delete」 | `service_role` 對 `audit_log` 只有 `select`＋**只能刪帶測試標記的列**；不能 insert／update／truncate；每次刪除寫入不可刪的清除帳本 | 保留測試清理能力又不讓 service key 能無痕抹除真實紀錄。偏離 `decisions.md` TASK-065「service_role 給 s/i/u/d」慣例，需記入 `decisions.md` |
| D5 | `occurred_at` 用 `now()`；操作者三類 | `occurred_at` 用 `clock_timestamp()`；`actor_type` 增加 `unknown`（已登入但非店長）；新增 `actor_role` 欄位（JWT role，無 claims 為 `none`） | 見 §2。避免 `system` 同時混入 service key、直連與無法歸類的來源 |
| D6 | 「稽核寫入失敗＝原始變更回滾」且錯誤無特徵 | 失敗一律以專用 SQLSTATE `AUD01` 重新拋出（仍 fail-closed） | 使 Postgres log 能一眼辨識稽核故障，而不是混在泛用 `INTERNAL_ERROR` 裡 |
| D7 | 篩選「反映在結果筆數」 | 改為顯示「已載入 N 筆」，不做總筆數查詢 | 資料契約不含 count，避免對大表做 `count: exact` |

## 1. 資料模型（`0019_audit_log.sql`）

```text
public.audit_log
  id            bigint generated always as identity primary key
  occurred_at   timestamptz not null default clock_timestamp()
  actor_type    text not null  check (actor_type in ('admin','customer','system','unknown'))
  actor_role    text not null  -- JWT role：'anon'／'authenticated'／'service_role'／'none'
  actor_user_id uuid           -- auth.uid()；customer 與無 claims 一律 null；不加外鍵
  event_type    text not null  check (event_type ~ '^[a-z_]+\.[a-z_]+$')
  entity_type   text not null  check (entity_type ~ '^[a-z_]+$')
  entity_id     text not null  check (char_length(entity_id) between 1 and 128)
  summary       jsonb not null default '{}' check (jsonb_typeof(summary) = 'object' and octet_length(summary::text) <= 4096)
  changes       jsonb not null default '{}' check (jsonb_typeof(changes) = 'object' and octet_length(changes::text) <= 4096)
  test_run_id   uuid           -- 僅在測試標記＋密鑰驗證通過時寫入，見 §6

public.audit_purge_log        -- 清除帳本：每次刪除 audit_log 都由 statement trigger 寫一列
  id, purged_at, rows_deleted, min_id, max_id, current_user_name, session_user_name, test_run_ids uuid[]
```

- `entity_id` 為 `text` 且上限 **128**：複合鍵 `<designer_id>:<service_id>` 為 73 字（第 1 版的 64 會讓開關設計師服務與 cascade 刪除必定失敗）；`<designer_id>:<date>` 47 字。
- **名稱快照一律在 trigger 內截斷**（`left(name, 60)`，`changes` 的文字值同樣截斷），保證任何輸入都不可能讓稽核寫入因長度失敗。`services.name` 在資料庫**沒有長度限制**（只有 `designers.name` 有，第 1 版前提錯誤），**本 Epic 不修改 `services` 的 constraint**；是否補 `services_name_valid` 列為獨立後續建議。長度 check 僅作備援（4096 bytes，位元組數，不是字數）。
- 所有 summary 同時保存對象的原始 id（`designer_id`、`service_id`、`appointment_id`，不是個資），使 cascade 刪除時父列已不存在、名稱查不到（為 null）也仍可追蹤。
- 事件代碼用格式檢查而非封閉清單；目錄放 `lib/audit-log/events.ts`，前端對不認識的代碼顯示原始代碼。
- 索引：PK、`(entity_type, entity_id, id desc)`。資料量預估每年 < 1 萬筆，不為 `occurred_at` 另建索引（列表以 `id desc` 排序）。
- 時間欄位存成明確 UTC 字串（`to_char(x at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')`），不用 `to_jsonb(timestamptz)`（其偏移取決於 session TimeZone）。
- 分頁：`order by id desc`，游標＝上一頁最後一筆 `id`（字串保存，驗證 `^\d+$`）；日期區間篩選用 `occurred_at`（呼叫端以 `+08:00` 日界組，比照 `lib/admin/week-range.ts`）。不保證嚴格時間序（長交易下 id 與 `occurred_at` 可能略有不一致），列表不聲稱。
- 建表之外的 constraint 一律用 `drop constraint if exists` 再 `add`（比照 0017），重跑才會收斂。
- `audit_log` **不得**加入 `supabase_realtime` publication；migration 檢查並確認。

## 2. 操作者判定

在 `audit_private._audit_write()` 內部計算，**不接受任何呼叫端傳入的 actor／時間參數**：

```text
claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb
role   := coalesce(claims ->> 'role', 'none')

appointment.created 專用：
  role in ('service_role','none') → ('system',   null)
  其餘                              → ('customer', null)            -- D3

其他事件：
  public.is_admin()                  → ('admin',    auth.uid())
  role in ('service_role','none')    → ('system',   auth.uid())
  role = 'anon'                      → ('customer', null)
  其餘（已登入、非店長）              → ('unknown',  auth.uid())
```

- 判定完全來自資料庫端已驗簽的 JWT claims（交易層級 GUC，不受 security definer 切換身分影響）；目前沒有任何 public 函式暴露 `set_config` 或動態 SQL，呼叫端無法影響。**日後不得新增會執行任意 SQL 的 definer 函式**（寫入 `decisions.md`）。
- `system` 同時涵蓋 service key 與直連／SQL Editor，靠 `actor_role` 與清除帳本的 `session_user_name` 輔助分辨；Supabase Studio 的 impersonate 可設定任意 claims，屬 owner 信任邊界（見 §10）。
- **R5 實測**：trigger 內 `auth.uid()`／`is_admin()`／`request.headers` 是否正確取得，在卡 C 以真實 PostgREST 端到端驗證（見 §7）。

## 3. 權限邊界（依角色列出實際生效的層，不再宣稱「任一層單獨擋得住」）

| 角色 \ 操作 | GRANT | RLS | Trigger |
|---|---|---|---|
| anon／authenticated：insert | 擋 | 擋（無 policy） | `before insert`：`current_user` 為 anon／authenticated／service_role 一律拒絕 |
| anon／authenticated：update／delete | 擋 | 擋 | `before update`：無條件拒絕；`before delete`：見下 |
| anon／authenticated：truncate | 擋 | 不適用（RLS 不涵蓋 truncate） | statement 級 `before truncate`：無條件拒絕 |
| service_role：insert／update／truncate | 擋（只給 select、delete） | 不存在（BYPASSRLS） | insert／update／truncate trigger 同上 |
| service_role：delete | 允許 | 不存在 | `before delete`：僅 `test_run_id is not null` 的列可刪 |
| postgres／supabase_admin（owner） | 不生效 | 不生效 | `before delete` 允許（緊急處理）；update／truncate 仍擋；owner 可 `disable trigger`，屬已知邊界 |

- GRANT：`revoke all on public.audit_log from anon, authenticated, service_role` → `grant select to authenticated` → `grant select, delete to service_role`。**identity 序列也明確收回**：`revoke all on sequence public.audit_log_id_seq from anon, authenticated, service_role`（Supabase default privileges 會授權序列）。`audit_purge_log` 同樣零寫入授權，`authenticated` 僅 select（RLS：`is_admin()`）。
- RLS：`enable`（**不得 force**，definer 函式靠 owner 繞過 RLS 才寫得進去）；唯一 policy `for select to authenticated using ((select public.is_admin()))`（以 sub-select 讓 planner 只評估一次）。非管理員／aal1 管理員 select 回傳**空陣列**（不是 42501）；anon 為 42501。測試斷言要分開寫。
- `before delete` 與清除帳本：刪除僅限帶測試標記的列（service_role）或 owner；每次刪除（含 owner）由 statement 級 `after delete ... referencing old table` trigger 寫入 `audit_purge_log`（筆數、最小／最大 id、`current_user`、`session_user`、涉及的 `test_run_id`）。`audit_purge_log` 本身有 `before update／delete／truncate` 無條件拒絕。→ 持有 service key 的人無法刪真實紀錄；就算想把自己的惡意操作也標成測試，也因缺少 Vault 密鑰而標不上（見 §6）。
- **內部函式全部放在不對外的 schema `audit_private`**（不加入 PostgREST exposed schemas）：`_audit_write`、`_audit_diff`、各表 trigger 函式。對 anon、authenticated、service_role `revoke usage on schema audit_private` 並對每支函式明寫 `revoke execute ... from public, anon, authenticated, service_role`（public schema 的 default privileges 會自動授權新函式，只 revoke public 不夠）。migration 結尾自我檢查：`has_function_privilege` 對三個角色任一為真就 `raise exception`。
- 各表 trigger 函式一律 `security definer`＋`set search_path = ''`、物件全限定名稱（invoker 會因收回 execute 而讓所有寫入 42501）；**禁止** `execute format(...)` 動態 SQL；白名單欄位寫死在各函式內，不作參數。appointments 的 trigger **不先做 `to_jsonb(old/new)`**，直接 `jsonb_build_object('status', old.status, ...)`，使 `customer_*`／`access_token` 連函式輸入都不會進入。
- `_audit_diff` 不需要 definer：invoker＋immutable 純函式。

## 4. 事件目錄與 trigger 設計

**原則**
- 全部 `AFTER ... FOR EACH ROW`。`INSERT ... ON CONFLICT DO UPDATE` 對新增列只觸發 AFTER INSERT、對衝突列觸發 AFTER UPDATE；`DO NOTHING` 不觸發。
- **事實更正（第 1 版錯誤）**：`designer_services`／`designer_leaves` 是一般 `insert` 再吞掉 23505（`lib/admin/designers.ts:108-109,741-742`），重複時該語句失敗、不產生列，也不觸發 trigger；`closed_dates` 是 `upsert ignoreDuplicates:false`（DO UPDATE），重複加入會走 AFTER UPDATE，但它只有 `date` 一欄，**不掛 UPDATE trigger**（只掛 INSERT／DELETE）。
- UPDATE 的 `WHEN` 子句＋函式內再 `IS DISTINCT FROM` 只比**追蹤欄位**，不得比整列（`set_updated_at` 每次都改 `updated_at`）。語法：`FOR EACH ROW` 之後、`WHEN (( ... ))` 整個條件包在一組括號內（0011／0012 的教訓）；INSERT 的 WHEN 不可引用 `old`。
- trigger 命名統一前綴 `audit_`（`audit_appointments_ins`、`audit_appointments_upd`…），緊急移除時以 `pg_trigger` 前綴查詢。
- cascade 子列（刪設計師／服務時連帶刪除 `designer_services`／`designer_leaves`）：AFTER DELETE 仍記錄，名稱查不到時為 null、id 保留，**不得因查不到而 raise**（卡 F 必須有專屬測試）。

| 資料表 | 事件代碼 | summary | changes |
|---|---|---|---|
| `appointments` INSERT | `appointment.created` | `appointment_id`、`service_id`、`service_name`、`designer_id`、`designer_name`、`start_at`、`end_at` | — |
| `appointments` UPDATE | `appointment.completed`／`appointment.cancelled`（status→completed／cancelled）、`appointment.rescheduled`（start_at／end_at 變）、`appointment.status_changed`（其他 status 變化）、`appointment.reassigned`（designer_id／service_id 變） | 同上（取事件後的值） | 追蹤欄位 `{from,to}` |
| `appointments` DELETE | `appointment.deleted` | 同上（舊值） | — |
| `booking_policy` | `booking_policy.created／updated／deleted` | — | `min_lead_time_hours`、`cancel_window_hours` |
| `business_hours` | `business_hours.created／updated／deleted`（`entity_id`＝weekday） | `weekday` | `open_time`、`close_time`、`is_closed`（time 型別比對，`09:00` 與 `09:00:00` 不算差異） |
| `closed_dates` | `closed_date.added／removed`（無 UPDATE trigger） | `date` | — |
| `services` | `service.created／updated／deleted` | `service_id`、`service_name` | `name`、`price`、`duration_minutes`、`buffer_minutes`、`is_active`（不含 description、sort_order） |
| `designers` | `designer.created／updated／deleted` | `designer_id`、`designer_name` | `name`、`is_active`（不含 bio／specialties／IG／avatar／sort_order） |
| `designer_services` | `designer_service.enabled／disabled` | `designer_id`、`service_id`、`designer_name`、`service_name` | — |
| `designer_leaves` | `designer_leave.added／removed` | `designer_id`、`designer_name`、`date` | — |

- appointments UPDATE 同次改多種欄位時，單一 trigger 呼叫內依序寫多筆（status 類在前、`rescheduled` 次之、`reassigned` 最後）。UPDATE 的 `WHEN`：`status`／`start_at`／`end_at`／`designer_id`／`service_id` 任一變動才進函式；`reminder_sent_at`、`confirmation_sent_at`、`updated_at`、`customer_*` 完全不進。
- 與既有 0011／0012 webhook trigger 並存：條件與 payload 不動；字母序 `audit_*` 先於 `appointments_notify_*`，兩者無依賴；稽核失敗回滾時 `net.http_post` 佇列列同在交易內一併消失（不會發生「沒預約卻寄信」）。

## 5. 寫入失敗語意（fail-closed）

- `_audit_write` 內部以 `begin ... exception when others` 捕捉後，**以專用 SQLSTATE `AUD01` 重新拋出**（訊息含原 SQLSTATE）：仍然 fail-closed，但 Postgres log 能辨識（`create_appointment` 外層 `when others` 只記 sqlstate，見 0018:609）。各表 trigger 函式本身不吞例外（與 0011／0012 webhook trigger 刻意相反）。
- `create_appointment`：AUD01 穿過巢狀區塊（只接 `exclusion_violation`／`deadlock_detected`）→ 外層 `when others` → `INTERNAL_ERROR`，整個區塊回滾（含新建的 `customers`）。稽核路徑不取鎖、沒有唯一鍵碰撞，不會被誤判成「候選人被訂走」。exclusion constraint 是立即檢查，先於 AFTER trigger，被擋下的候選人不會留稽核列。
- **這是本 Epic 最大的營運風險**：稽核函式任何 bug 會直接讓預約失敗。緩解：trigger 只做 select＋insert、不呼叫外部服務；名稱截斷保證不因長度失敗；`create_appointment` 回歸（§8）；快速止血只需 `0021_down`；Supabase Logs 以 `AUD01` 設查詢／告警（寫入部署 runbook）。
- **失敗注入驗證**（不新增任何正式庫入口）：`supabase/verify/` 底下的可回滾 SQL 腳本，單一批次：`begin; set local lock_timeout='3s'; alter table public.audit_log add constraint audit_fail_inject check (summary->>'service_name' is distinct from '__TEST__audit-fail') not valid; ...對 __TEST__ 資料執行會被稽核的操作；斷言拋 AUD01；斷言原始資料未改變；rollback;`。限定只擋測試名稱，避免擋住真實顧客預約；`alter table` 取 access exclusive，所以必須 `lock_timeout` 並立刻 rollback，離峰時執行。第 1 版採用的「SQL Editor 人工加 constraint」與 architect 提議的「竄改 `request.jwt.claims`」均不採用（後者會在 RLS 評估階段就失敗，證明不了稽核寫入回滾）。

## 6. 測試標記＋密鑰（使用者選定的清理機制）

**目標**：整合測試對正式資料庫的寫入，其稽核列要能被精確辨識並刪除，且任何非測試來源（含持有 service key 的攻擊者）都無法標記、無法刪除真實紀錄。

- Vault 密鑰 `audit_test_secret`（一次性人工建立，不進版控，步驟比照 0011 的 Vault 慣例寫入 runbook）。測試端的 `.env.local` 增加 `AUDIT_TEST_SECRET`；**Vercel production 不得設定**。
- 測試 client 每個請求帶兩個 header：`x-audit-test-run: <本次執行 uuid>`、`x-audit-test-secret: <密鑰>`。
- `_audit_write` 讀 `current_setting('request.headers', true)::jsonb`：僅當 `x-audit-test-run` 符合 uuid 格式且 `x-audit-test-secret` 與 Vault 密鑰完全相同時，才寫入 `test_run_id`；否則一律忽略（照常記錄為無標記列）。Vault 讀取只在帶 header 時才發生，正式流量零成本。
- 清理：`tests/helpers/audit-test-run.ts` 以 service_role `delete from audit_log where test_run_id = <本次 uuid>`；刪除後再查同一 uuid 必須為 0，否則測試失敗。`before delete` trigger 只允許刪帶標記的列，清除帳本留證據。
- 優點：cascade 子列、`service_role` 還原快照、單例設定表（無名稱可標記）、中斷後殘留都以同一個 uuid 精確處理；不再有名稱前綴、時間窗、`designer001` 與真實店長操作無法區分的問題；不需要改測試身分。
- 殘留風險：（1）持有 `.env.local` 的人（密鑰＋service key）可標記並刪除自己的寫入——等同開發機完全被入侵，已記錄；（2）被強制中斷的測試會在表上留下帶 uuid 的列，需要 `scripts/sweep-audit-test-rows.mjs`（預設 dry-run，`--apply` 才刪，只刪有標記的列，並列出每個 uuid 的筆數與時間）人工收尾。
- **先決驗證（卡 C 的第一步）**：PostgREST 是否真的把自訂 header 放進 `request.headers` GUC，以及 Supabase 閘道是否保留它，需端到端實測（試點 trigger 寫入後讀 `test_run_id`）。**若實測失敗，停止並回報人工，退回「實體 ID 清理＋拋棄式管理員」方案重新規劃**（卡 B 的 client 工廠與卡 C 之後的所有卡都要重新評估，因此試點必須在鋪開前完成）。
- `tests/helpers/designer-fixture.ts` 既有 `.like("name", `${prefix}%`)` 沒有跳脫（`_` 是單字元萬用字元）；順手在卡 B 改用 `escapeLikePattern`（與稽核清理無關，但 security-reviewer 指出可能誤刪真實資料）。

## 7. 測試基礎建設與驗證腳本

- **卡 B（測試基礎建設，不需任何 migration，可與卡 A 並行）**：新增 `tests/helpers/audit-test-run.ts`（產生本次 uuid、讀 `AUDIT_TEST_SECRET`、client 工廠 `createTaggedClient`、`cleanupAuditRows`）。**9 個套件**（`admin-booking`、`booking`、`business-hours`、`booking-policy`、`services`、`designers`、`notifications`、`rls`、`mfa-rls`；`account` 與 `store-settings` 不寫被稽核的表）全部改用工廠建立 client；沒有設定 `AUDIT_TEST_SECRET` 時工廠不帶 header（行為與現在完全相同）。驗證契約：全套整合測試重跑結果與改動前相同。以腳本檢查「整合測試檔出現 `from("<被稽核表>")`、`createTestDesigner`、`create_appointment` 者，必須使用工廠」，納入 `npm test`（單元層）以防日後新增套件漏掛。
- **SQL 驗證腳本**（`supabase/verify/0019_audit_log_verify.sql` 等，整段 `begin; ... rollback;`，輸出貼進驗證報告，每次修改 migration 都要重跑）：用 `set local role anon／authenticated／service_role` 搭配 `set_config('request.jwt.claims', ..., true)` 模擬 JWT（管理員要帶 `sub`；aal2 案例帶 `aal`，先對照 0016 `is_admin()` 實作確認 claims 形狀）。內容：truncate（PostgREST 沒有端點，只能用 SQL）、update 任何角色皆拒、delete 僅標記列、三層單獨驗證（交易內臨時 `grant` 後再以該角色寫入，預期 RLS 與 trigger 各自拒絕）、內部函式三角色呼叫皆 42501、`request.headers` 標記邏輯（模擬 GUC）、直連（無 claims）判定、失敗注入（§5）、各卡 `down` 在交易內演練後 rollback。
- **REST 權限矩陣**（卡 C 起，端到端）：逐格期望值——anon select／insert／update／delete 皆 42501；非管理員 authenticated select **空陣列**（先以 service_role 確認底下確有列，避免恆真）、寫入 42501；MFA 管理員 aal1 select 空陣列；管理員 aal2 或未啟用 MFA select 有列、寫入 42501；service_role select 有列、insert／update 42501、delete 僅標記列。拋棄式帳號沿用 `mfa-rls` 的做法，抽出 `tests/helpers/throwaway-admin.ts`，前綴改為 `__TEST__audit-log-`，抽出後重跑 `test:mfa-rls`。
- **migration 套用後**：`notify pgrst, 'reload schema'`（比照 0018），驗證不得靠「等一下再跑」。
- **個資掃描**（卡 D、F）：（1）植入針：顧客姓名／電話／email 為可辨識唯一字串、讀出 `access_token` 當針，走完整生命週期後 summary／changes 全文不得含任何針；設計師 bio／IG／avatar、服務 description 同樣植入；（2）鍵白名單：每個 `event_type` 的 summary／changes 鍵集合必須嚴格屬於事件目錄；（3）全表 regex 掃描（email 樣式、`\b09\d{8}\b`）。
- **稽核套件不得與其他整合套件並行**（`decisions.md` 註記），沿用 `project-map.md` 日期 offset 慣例並登記新範圍。

## 8. 遷移、部署與回滾

四個＋一個 migration，各自 up／down 成對、各自一個交易、可重複執行，依序套用：

| 檔案 | 卡 | 內容 |
|---|---|---|
| `0019_audit_log` | A | 兩張表、守護 trigger、`audit_private` schema 與內部函式、Vault 標記邏輯、自我檢查；**不含任何來源 trigger**（套用後無任何寫入，零風險） |
| `0020_audit_closed_dates` | C | 試點 trigger：`closed_dates`（單欄位、無 PII、與預約無關） |
| `0021_audit_appointments` | D | `appointments` 的 INSERT／UPDATE／DELETE |
| `0022_audit_settings_1` | E | `booking_policy`、`business_hours` |
| `0023_audit_settings_2` | F | `services`、`designers`、`designer_services`、`designer_leaves` |

- 套用前提：`0001`～`0018`；開頭檢查前置表存在，缺則 `raise exception`。
- 鎖：每個檔案開頭 `set local lock_timeout = '5s'`；函式定義放前面、`create trigger` 放最後以縮短持鎖時間；`0023` 對 `designers` 與子表加 trigger 時**先父表再子表**，避免與 service_role cascade 刪除互鎖；**套用期間不跑整合測試**。
- **每張來源 trigger 卡的上線順序**：先在本機完成 migration、測試與掛標記（卡 B 已完成）→ 套用 migration 到正式庫 → 立即人工 smoke（店長實際取消一筆測試預約、顧客端建立一筆預約，各出現一筆記錄）→ 跑該卡掛上的所有舊套件（`test:booking`、`test:notifications` 等）→ 驗證清理後殘留為 0。人工驗收不得由 agent 自我驗證替代。
- **回滾順序固定**：Vercel 前端 → `0023_down` → `0022_down` → `0021_down` → `0020_down` → `0019_down`。`0019_down` 開頭檢查：`pg_trigger` 還有任何 `audit_` trigger 就 `raise exception`（只 drop 函式不 drop trigger 會讓每筆 `create_appointment` 都 `INTERNAL_ERROR`）。**緊急止血**＝`0021_down`（只 drop appointments 上的 trigger，設 `lock_timeout`；`DROP TRIGGER` 要 access exclusive）。`0019_down` 預設**保留 `audit_log` 與 `audit_purge_log` 資料表以及它們的守護 trigger**（避免回滾即遺失或失去保護的證據），`drop table` 以註解形式附上，由人工明確決定。每個 `_down` 都要在交易內演練（§7）後 rollback，不得在正式庫真執行。
- 套用 migration 本身不更新任何被稽核的列，不產生「migration 噪音」。之後會更新追蹤欄位的 migration 會以 `system` 記錄，屬預期；將來若需對稽核表做個資遮蔽，須在 migration 內暫時 `disable trigger` 並寫入 runbook。

## 9. 前端與資料存取

**新增檔案（預期）**
- `supabase/migrations/0019`～`0023`（各附 `_down.sql`）、`supabase/verify/*.sql`
- `lib/audit-log/events.ts`（事件代碼→中文名稱、類別 `appointment`／`settings`、欄位→中文標籤與值格式化）
- `lib/audit-log/api.ts`：`listAuditLog(supabase, { category, from, to, appointmentId, cursor, limit })`，使用 `.eq()`／`.lt()`／`.like()`／`.gte()` 等 query builder，**禁止**用 `.or(\`...${input}\`)` 字串拼接；`select` 明列欄位；統一泛用錯誤
- `lib/audit-log/describe.ts`（差異→白話文字的純函式，時區轉換不得依賴執行環境時區）
- `app/admin/audit-log/page.tsx`、`app/admin/_components/AuditLogView.tsx`（畫面層由 Phase 3 決定）
- `AdminShell.tsx` 新增 Sidebar 項目「稽核紀錄」，放在**最後**（`tests/components/admin-shell.test.tsx` 有相鄰項目斷言）
- `tests/audit-log.integration.test.ts`、`vitest.audit-log.config.ts`、`package.json` 新增 `test:audit-log`、`tests/helpers/audit-test-run.ts`、`tests/helpers/throwaway-admin.ts`、`scripts/sweep-audit-test-rows.mjs`

**資料契約**
- 輸入：`category: 'all'|'appointment'|'settings'`（`like 'appointment.%'`／其餘）、`from`／`to`（`YYYY-MM-DD`，非法日期與 `from > to` 在前端處理）、`appointmentId`（trim、不分大小寫、uuid 格式驗證，非 uuid 不送查詢；查詢用 `eq('entity_type','appointment').eq('entity_id', id)`）、`cursor`（`^\d+$`）、`limit`（預設 50，夾在 1～100）。
- 輸出：`{ rows, nextCursor }`；多取一筆判斷下一頁（剛好等於 `limit` 筆時 `nextCursor` 為 null）。
- 中文文字不存資料庫；`changes` 值依欄位型別格式化（時間轉 Asia/Taipei、布林「是／否」、`null`「未設定」）；列表一律以純文字渲染並顯示 `entity_id`（服務名稱缺少 bidi／控制字元限制，避免誤導）。`changes` 缺 `from`／`to` 或含白名單外的 key 時忽略，不顯示原值。
- 「載入更多」失敗時的行為（保留既有列並顯示重試，或整頁錯誤）：在 screen spec 階段定案。

## 10. 風險與緩解總表

| # | 風險 | 嚴重度 | 緩解／狀態 |
|---|---|---|---|
| R1 | 整合測試污染不可刪的稽核表 | 高 | §6 測試標記＋密鑰；先決驗證在卡 C，失敗即停止 |
| R2 | 稽核 bug 擋住顧客預約（含名稱過長、`entity_id` 過長等必然失敗情境） | 高 | §1 截斷與上限放寬、§5 `AUD01`、回歸、`0021_down` 止血 |
| R3 | upsert 重複記錄／無差異也記 | 中 | AFTER trigger＋`IS DISTINCT FROM`；`closed_dates` 不掛 UPDATE；專案測試 |
| R4 | 新 trigger 改變既有 webhook 行為 | 中 | 條件與 payload 不動；靜態護欄＋`pg_trigger` 比對＋`test:notifications` 前後各跑一次 |
| R5 | trigger 內 JWT claims／`request.headers` 取不到 | 高 | 卡 C 端到端實測；失敗退回備案 |
| R6 | 稽核寫入夾帶個資 | 高 | 白名單寫死、不用 `to_jsonb(row)`、三層掃描測試 |
| R7 | owner／service key 的信任邊界 | 中 | service_role 只能刪標記列＋清除帳本；仍可被 owner 竄改、`disable trigger`、Studio impersonate 偽造 `admin`；`system` 混合 service key 與直連——寫入 `decisions.md` |
| R8 | 設計師／服務改名後快照不一致 | 低 | 設計如此；以 id 為準 |
| R9 | `occurred_at` 與 id 順序略有不一致 | 低 | 以 id 為準，列表不聲稱 |
| R10 | 被盜用 session 反覆改設定灌入大量記錄掩蓋惡意操作 | 低（接受） | 靠日期與類別篩選緩解 |
| R11 | 設計師名稱屬員工資料、永久保存且無刪除路徑 | 低 | 於 `decisions.md` 記下保留政策 |
| R12 | `create_appointment` 無限流（TASK-080 延後）下稽核表被間接增長 | 低 | 只有成功預約才寫稽核列，受時段容量限制；非本 Epic 引入 |

## 11. 任務卡（核准後建立，皆依賴「專案設置」Epic 全部卡片）

| 卡 | 內容 | 分軌 | 風險 | 前置 |
|---|---|---|---|---|
| A | 稽核資料基礎：`0019` 全部內容、down、`supabase/verify/0019` 腳本演練 | 後端 | 高 | — |
| B | 測試基礎建設：標記 client 工廠、清理 helper、9 套件改用工廠、`escapeLikePattern`、單元層護欄、sweep 腳本；不需 migration | 後端（測試） | 中 | —（可與 A 並行） |
| C | `closed_dates` 試點（`0020`）與端到端驗證：header 實測、REST 權限矩陣（拋棄式帳號）、四種操作者來源、清理與殘留為 0；**失敗則停止並重新規劃** | 後端 | 高 | A、B |
| D | 預約異動（`0021`）：全部事件、`create_appointment` 回歸（套用前先錄基準形狀並寫成嚴格斷言、各錯誤路徑 0 筆、勝者恰 1 筆、三種呼叫身分）、webhook 並存回歸、個資掃描（預約部分）、失敗注入腳本 | 後端 | 高 | C |
| E | 設定異動（1）（`0022`）：`booking_policy`、`business_hours`（upsert 七列邊界案例、time 格式、單例快照還原於 `finally`） | 後端 | 中 | C |
| F | 設定異動（2）（`0023`）：`services`、`designers`、`designer_services`、`designer_leaves`（每事件 happy path 含最長 `entity_id`、cascade 子列、名稱截斷、個資白名單） | 後端 | 中 | C |
| G | 稽核列表資料層與純函式：`lib/audit-log/*`、事件目錄、描述函式、`listAuditLog`、漂移護欄（讀 migration 的 `event_type` 字面值對照目錄）、單元測試 | 後端 | 低 | A |
| H | 稽核列表畫面：screen spec＋mockup 決策先行→元件、Sidebar、各狀態（競態、載入更多失敗、複製） | 前端 | 中 | G；**Phase 3 人工選定後才可就緒** |
| I | 串接與驗收：列表串接、篩選、分頁、錯誤／空狀態、瀏覽器走查、部署 runbook（Vault 密鑰、`AUD01` 告警）、更新 `project-map.md`／`decisions.md` | 前後端串接 | 中 | D、E、F、H |

MECE：規格「資料基礎」→A；「記錄預約異動」→D；「記錄設定異動」→C（`closed_dates`）＋E＋F；「查看列表」→G＋H＋I；「篩選」→G（查詢）＋H（控制項）＋I（串接）；測試污染（規格風險 1）→B＋C。檔案歸屬：A 擁有 `0019`；B 擁有 `tests/helpers/*` 與 9 套件的 client 建立行；C／D／E／F 各擁有自己的 migration 與 `tests/audit-log.integration.test.ts` 內自己的 describe 區塊（依序執行，不並行改同一檔，卡 C 建立檔案骨架）；G 擁有 `lib/audit-log/*`；H 擁有畫面元件。
