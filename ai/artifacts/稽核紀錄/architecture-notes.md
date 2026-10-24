# 架構筆記：稽核紀錄（簡版）

上層規格：`ai/artifacts/稽核紀錄/feature-spec.md`（簡版，待人工確認）。原完整版設計見 `完整版備案/`，本版**不採用**其 trigger、測試標記、清除帳本等機制。

## 1. 資料表（`supabase/migrations/0019_audit_log.sql`）

```text
public.audit_log
  id          bigint generated always as identity primary key
  created_at  timestamptz not null default now()
  actor_id    uuid default auth.uid()        -- 預設由資料庫決定，不授與 insert 權限
  event_type  text not null  check (event_type ~ '^[a-z_]+\.[a-z_]+$')
  entity_type text not null  check (entity_type ~ '^[a-z_]+$')
  entity_id   text not null  check (char_length(entity_id) between 1 and 128)
  summary     jsonb not null default '{}' check (jsonb_typeof(summary) = 'object' and octet_length(summary::text) <= 4096)
  changes     jsonb not null default '{}' check (jsonb_typeof(changes) = 'object' and octet_length(changes::text) <= 4096)
```

- `entity_id` 用 `text`（對象主鍵型別不一：uuid、weekday、date、複合鍵）。
- 索引：PK 即可（列表以 `id desc` 排序，資料量預估每年 < 1 萬筆）；另加 `(entity_type, id desc)` 供類別篩選。事件類別（預約／設定）用 `event_type like 'appointment.%'` 或其餘。
- 以 `drop constraint if exists` 再 `add` 的寫法建立 constraint（比照 0017），重跑才會收斂。

## 2. 權限（GRANT＋RLS 兩層）

- `revoke all on public.audit_log from anon, authenticated, service_role`，再：
  - `grant select on public.audit_log to authenticated`
  - `grant insert (event_type, entity_type, entity_id, summary, changes) on public.audit_log to authenticated` — **不含 `actor_id`、`created_at`**，這兩欄只能走資料庫預設，前端無法指定（已確認的做法：欄位層級 insert，語法比照 0001 對 `appointments` 的 `insert (欄位...)`）。
  - `grant select, delete on public.audit_log to service_role`（delete 只供整合測試清掃，不給 insert／update）。
- RLS `enable`；policy：`for select to authenticated using ((select public.is_admin()))`、`for insert to authenticated with check ((select public.is_admin()))`；**不建立** update／delete policy。
- 識別欄位的 insert 不需對序列另外授權（identity 欄位）；若實測需要再補，由整合測試的權限矩陣把關。
- 結果：anon 一律 42501；非店長登入者 select 得到**空結果**（RLS）、insert 被拒；店長可 select／insert，不能 update／delete，也無法指定操作者與時間。

## 3. 寫入函式（`lib/admin/audit-log.ts`）

- `recordAdminAction(supabase, { eventType, entityType, entityId, summary?, changes? }): Promise<void>`
  - 內部 `try/catch`，**永不 throw**；失敗只 `console.warn`（只印 error code，不印內容）。
  - 文字值截斷 60 字；摘要與差異序列化後超過上限就丟棄 `changes` 保留 `summary`（再超過則只記事件與對象）。
  - 事件代碼以 TypeScript 聯集型別限制（`AuditEventType`），避免字串打錯。
- 呼叫位置：各來源函式在**確認成功之後**（`ok: true` 之前）`await recordAdminAction(...)`。用 `await` 是為了讓請求在頁面導覽前送出；因為函式永不 throw，不影響原回傳。
- 舊值讀取：需要前後值的來源（預約、預約規則、營業時間、服務、設計師名稱）寫入**之前**先 select 一次；讀取失敗就只記新值，**不阻擋原操作**。差異只在確有變動時產生；沒有任何追蹤欄位變動則不記。
- 摘要欄位以各事件白名單組成（`lib/admin/audit-log.ts` 內的事件建構函式），來源函式不直接塞物件；預約事件一律只用預約編號、服務名稱、設計師名稱、起訖時間，**不得**取用 `customer_*`。
- 預約事件的名稱與時間：寫入前以單一查詢 `select id, start_at, end_at, status, services(name), designers(name)` 取得（比照 `lib/admin/appointments.ts` 的 `APPOINTMENT_EMBEDS` 欄位，不含顧客欄位）。

## 4. 列表資料層

- `listAuditLog(supabase, { category, cursor, limit })`：`from("audit_log").select("id, created_at, event_type, entity_type, entity_id, summary, changes").order("id", { ascending: false }).limit(limit + 1)`；`category`：`all` 不加條件、`appointment`＝`.like("event_type", "appointment.%")`、`settings`＝`.not("event_type", "like", "appointment.%")`；`cursor` 僅接受 `^\d+$`，用 `.lt("id", cursor)`；`limit` 預設 50、夾在 1～100；多取一筆判斷下一頁。錯誤統一泛用訊息。
- 中文名稱與差異文字：`lib/admin/audit-log.ts` 內的事件目錄（代碼→中文、欄位→標籤與值格式化）與 `describeAuditEntry`；時間轉 Asia/Taipei，不依賴執行環境時區；差異含白名單外的 key 時忽略；列表一律純文字渲染。

## 5. 測試與整合測試雜訊

- 單元測試比照 `tests/admin/*.test.ts` 的 mock 做法。因為 `recordAdminAction` 永不 throw，既有測試即使 mock 沒處理 `audit_log` 也不會失敗；若有依賴 `from` 呼叫次數或逐次回傳的測試，在接線卡一併調整。
- 整合測試 `test:audit-log`（新增，沿用 `vitest.*.config.ts` 與 `package.json` script 慣例）：權限矩陣用既有 `rls.integration.test.ts` 的「已登入非店長」做法建立拋棄式使用者；店長用既有的設計師帳密；測試資料一律 `__TEST__`。
- 清掃：`scripts/sweep-audit-test-rows.mjs`（service_role；預設 dry-run，`--apply` 才刪；預設刪除 `summary::text` 含 `__TEST__` 的列，可用 `--since <ISO 時間>` 縮小範圍）。既有整合套件若呼叫來源函式（用店長帳號），不帶名稱的紀錄（預約規則、營業時間還原）可能留下少量雜訊，接受並在 `project-map.md` 說明。
- 不改既有 9 個整合套件的 client 建立方式，也不引入測試標記或密鑰。

## 6. 遷移、部署與回滾

- `0019_audit_log.sql`：單一交易、可重複執行；開頭檢查 `is_admin()` 存在；結尾 `notify pgrst, 'reload schema'`。建表同檔寫 GRANT（`decisions.md` TASK-065）。
- `0019_audit_log_down.sql`：`drop table public.audit_log`（檔頭註明：會刪除全部紀錄）。
- 部署順序：**先套用 `0019`，再部署前端**（前端在 `0019` 前部署時，`recordAdminAction` 只會警告，不影響操作；列表頁則顯示錯誤狀態）。回滾：Vercel 回滾前端 → `0019_down`。
- 因為不碰預約寫入路徑也沒有 trigger，上線後只要手動確認：後台取消一筆測試預約，紀錄出現一筆。

## 7. 風險與緩解

| 風險 | 緩解 |
|---|---|
| 日誌漏記 | 接受（刻意不阻擋原操作）；`console.warn` 留跡；列表上看到缺漏時以 Vercel／瀏覽器 log 追查 |
| 繞過後台的操作不被記 | 已寫入規格「保證邊界」；若日後需要，升級為完整版備案 |
| 偽造紀錄 | 只能新增，不能改刪，操作者與時間由資料庫決定；已記錄 |
| 既有單元測試受影響 | 永不 throw 設計降低影響；接線卡逐檔跑測試 |
| 個資外洩進紀錄 | 事件白名單建構函式＋單元測試鍵白名單斷言 |
| 欄位層級 insert 在 `is_admin()` 的 aal2 要求下被擋 | 這是預期行為（與其他後台寫入一致）；整合測試以未啟用 MFA 的店長帳號驗證 |

## 8. 任務卡

| 卡 | 內容 | 風險 | 前置 | 預估 |
|---|---|---|---|---|
| TASK-084 | 資料表與寫入機制：`0019`、`lib/admin/audit-log.ts`（`recordAdminAction`、事件目錄、`describeAuditEntry`、`listAuditLog`）、單元測試、`test:audit-log`、清掃腳本、`decisions.md` | 中 | 專案設置全部卡片、TASK-079 | 約 0.5 天（含人工套用 migration） |
| TASK-085 | 記錄後台操作：16 個來源函式接線、舊值讀取、既有測試調整、新增逐函式單元測試、整合案例 | 中 | TASK-084 | 約 0.5～1 天 |
| TASK-086 | 稽核紀錄列表畫面與驗收：Phase 3（screen spec＋2～3 個 mockup 變體＋人工選定）→ 元件、頁面、Sidebar、狀態、串接、`project-map.md`／`decisions.md`、人工驗收 | 中 | TASK-085 | 約 0.5～1 天（不含 mockup 等待） |

MECE：規格三個故事各對應一張卡；檔案歸屬——084 擁有 `0019`、`lib/admin/audit-log.ts`、清掃腳本；085 擁有各來源函式（`lib/admin/*.ts`、`lib/booking-policy.ts`）與其測試；086 擁有 `app/admin/audit-log/`、列表元件與 `AdminShell.tsx`。
