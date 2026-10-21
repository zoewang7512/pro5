# TASK-066 套用前證據（2026-10-21，使用者於 Supabase SQL Editor 執行）

## 步驟 1：基準（`1-baseline.sql`）

### RLS policy（public schema，共 14 條，與 migration 檔逐條一致）

| 表 | policy | cmd | roles | using | with check |
|---|---|---|---|---|---|
| appointments | admin full access to appointments | ALL | authenticated | is_admin() | is_admin() |
| booking_policy | admin insert booking policy | INSERT | authenticated | － | is_admin() |
| booking_policy | admin update booking policy | UPDATE | authenticated | is_admin() | is_admin() |
| booking_policy | public read booking policy | SELECT | anon, authenticated | true | － |
| business_hours | admin full access to business hours | ALL | authenticated | is_admin() | is_admin() |
| business_hours | public read business hours | SELECT | anon, authenticated | true | － |
| closed_dates | admin full access to closed dates | ALL | authenticated | is_admin() | is_admin() |
| closed_dates | public read closed dates | SELECT | anon, authenticated | true | － |
| customers | admin full access to customers | ALL | authenticated | is_admin() | is_admin() |
| services | admin full access to services | ALL | authenticated | is_admin() | is_admin() |
| services | public read active services | SELECT | anon, authenticated | (is_active = true) | － |
| store_settings | admin insert store settings | INSERT | authenticated | － | is_admin() |
| store_settings | admin update store settings | UPDATE | authenticated | is_admin() | is_admin() |
| store_settings | public read store settings | SELECT | anon, authenticated | true | － |

全部為 PERMISSIVE。

### RLS 開關與原始授權（relacl）

8 張表皆 `relrowsecurity = true`、`relforcerowsecurity = false`。所有授權的 grantor 都是 `postgres`，沒有授權給 PUBLIC。權限字母含 `m`（MAINTAIN），表示 Postgres 17。

| 表 | relacl |
|---|---|
| admins | `{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}` |
| appointments | `{postgres=arwdDxtm/postgres,anon=rwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}` |
| booking_policy | `{postgres=arwdDxtm/postgres,anon=arwdxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}` |
| business_hours | `{postgres=arwdDxtm/postgres,anon=arwdxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}` |
| closed_dates | `{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}` |
| customers | `{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}` |
| services | `{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}` |
| store_settings | `{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}` |

`0015_explicit_table_grants_down.sql` 的 `grant all`（Postgres 17 含 MAINTAIN）＋三個 revoke，結果與上表一致。

## 步驟 2：試跑（`2-dry-run.sql`）

```text
ERROR:  P0001: DRY RUN（已全部回滾，資料庫未變更）｜權限不一致 0 筆：無｜非管理員可見 appointments 0 筆｜非管理員可更新 appointments 0 筆｜anon 可見 services 4 筆
CONTEXT:  PL/pgSQL function inline_code_block line 147 at RAISE
```

- 權限矩陣（8 表 × 3 角色 × 7 種權限，加上 appointments 12 個欄位層級檢查）與權限表全部一致。
- 模擬非管理員 authenticated：appointments 可見 0 筆、可更新 0 筆（RLS 生效）。
- 模擬 anon：services 可見 4 筆，與前台顯示的上架服務數一致。
