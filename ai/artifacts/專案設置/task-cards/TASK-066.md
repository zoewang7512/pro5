# AI-Ready 任務卡

## Metadata

- 任務：補一支 migration，為既有 8 張資料表寫出明確的最小權限 GRANT
- 上層規格：無（因應 Supabase 2026-10-30 平台變更）
- 上層 Epic：專案設置
- 上層 User Story：核心資料模型與認證框架基礎
- 分軌：後端
- 前置任務（dependsOn）：TASK-065
- 狀態：完成
- 風險等級：高
- Agent owner：Claude Code
- 人工核准者：使用者（2026-10-21 核准開工；權限表另需核准）

## 目標

讓 `supabase/migrations/` 在 2026-10-30 之後仍能完整重建出一個 app 可正常運作的資料庫，並把每張表的權限明確收斂為最小權限。

## 情境包（Context Pack）

- 相關檔案：
  - `supabase/migrations/0001`～`0014`（8 張表：admins、services、customers、appointments、business_hours、closed_dates、store_settings、booking_policy）
  - 新增 `supabase/migrations/0015_explicit_table_grants.sql`、`0015_explicit_table_grants_down.sql`
  - `lib/`、`app/` 內所有 supabase-js 的 `.from(...)` 呼叫（用來盤點每個角色實際用到哪些權限）
  - `tests/rls.integration.test.ts` 及各 `test:*` 整合測試
- 既有模式：
  - 收緊權限的先例：`0001` 對 appointments 的欄位層級 insert grant、`0008`／`0014` 的 revoke truncate、`0007` 的 revoke from anon。
  - 寫入大多走 SECURITY DEFINER RPC（例如 `create_appointment`），所以 anon 對資料表本身需要的直接權限可能很少。
  - migration 要可重複執行，並附 up/down 成對檔案。
- 假設：
  - 目前 8 張表都沿用 Supabase 自動授權（anon／authenticated／service_role 大致為 ALL），再加上 0001／0008／0014 的局部收緊。
  - service_role 只在伺服器端與測試使用，保留完整權限。
- 未知事項：
  - **正式環境目前的實際授權**：要先請使用者在 SQL Editor 執行下方查詢並回貼結果，作為基準。
  - 各表 anon／authenticated 實際需要的最小權限：要盤點程式碼和 RLS policy 後才知道。
- 允許變更的檔案：
  - `supabase/migrations/0015_*`（新增）
  - 整合測試（新增「權限符合預期」的測試案例）
  - `ai/context/decisions.md`、`ai/context/project-map.md`（記錄權限表）
- 不得觸碰：
  - 既有 migration 檔（0001～0014）。
  - RLS policy 內容（只動 GRANT，不動 policy）。
  - 應用程式碼（若盤點後發現程式碼需要調整，另開卡）。

## 需求

- 實作前，請使用者在 Supabase SQL Editor 執行以下查詢並回貼結果（唯讀查詢）：

  ```sql
  select grantee, table_name, string_agg(privilege_type, ', ' order by privilege_type) as privileges
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role')
  group by grantee, table_name
  order by table_name, grantee;

  select grantee, table_name, column_name, privilege_type
  from information_schema.column_privileges
  where table_schema = 'public' and grantee in ('anon', 'authenticated')
  order by table_name, grantee, column_name;
  ```

- 產出「每張表 × 每個角色」的權限表（目前授權 vs 目標授權 vs 理由），先給人工核准，核准後才寫 SQL。
- `0015` 對每張表先 `revoke all ... from anon, authenticated, service_role`，再依權限表 `grant` 需要的權限；service_role 明確 grant select, insert, update, delete。appointments 對 authenticated 用欄位層級授權。
- `0015_down` 還原成套用前的授權（依查詢結果的基準）。
- migration 可重複執行。

## 驗收標準

- 權限表經人工核准。
- 在 SQL Editor 套用 `0015` 後，所有既有整合測試（`test:rls`、`test:booking`、`test:admin-booking`、`test:business-hours`、`test:store-settings`、`test:booking-policy`、`test:services`、`test:account`、`test:notifications`）全部通過。
- 新增的整合測試能證明：anon 對不該碰的表（例如 customers、admins）會被拒絕，且是權限層就被擋下，不只是 RLS 回傳空結果。
- 套用後再跑一次上面的查詢，結果與權限表一致。
- 正式站（Vercel）顧客預約流程與 `/admin` 後台實際操作正常。

## 權限表（人工於 2026-10-21 核准，①② 照草案）

基準（套用前，正式環境 `role_table_grants` 查得）：anon／authenticated 對 8 張表幾乎全開（select／insert／update／delete／truncate／references／trigger），例外只有 anon 沒有 appointments insert、anon／authenticated 沒有 booking_policy／business_hours truncate。service_role 全開。欄位層級沒有額外授權。

| 表 | anon | authenticated | service_role |
|---|---|---|---|
| services | select | select, insert, update | select, insert, update, delete |
| business_hours | select | select, insert, update | 同上 |
| store_settings | select | select, update | 同上 |
| booking_policy | select | select, update | 同上 |
| closed_dates | －（①） | select, insert, update, delete | 同上 |
| appointments | － | 欄位層級（③）：select 除 access_token 外；update 只限 status, start_at, end_at, reminder_sent_at | 同上 |
| customers | － | －（②） | 同上 |
| admins | － | － | 同上 |

- ① closed_dates 不給 anon：顧客前台不直接讀，公休日由 `get_available_slots` 判斷。
- ② customers 不給 authenticated：後台不直接查。這會推翻 TASK-003 的「設計師可讀 customers」測試斷言，改為預期 42501。
- ③ appointments 欄位層級授權：security-reviewer 審查後提出，比原核准版本（整張表 select, update）更緊，使用者於 2026-10-21 同意。
- service_role 原本有 truncate／references／trigger，審查後改為連 service_role 一起 revoke all 再 grant s/i/u/d，讓各環境結果一致（單一交易內，沒有權限空窗）。
- 所有 RPC 與 webhook trigger function 都是 SECURITY DEFINER，不受影響。

## 審查紀錄（Phase 4 計畫 + diff，2026-10-21）

architect 結論為「要求修改」，security-reviewer 結論為「無 Critical／High」。下列發現都已處理：

- architect H1／security M1：`admin-booking.integration.test.ts` 另有兩個 anon 讀 appointments 的斷言沒改到，已改為預期 42501。
- architect M1／security L2：service_role 套用後結果會因環境而異、註解理由不成立，已改為一併 revoke all 後再 grant s/i/u/d。TASK-065 規則與 security-checklist 同步更新。
- architect M2：兩個刻意收斂和不再生效的 policy，已寫進 `decisions.md`「TASK-066」。
- security M2：補上非管理員 authenticated 帳號對 appointments 的 select／update（RLS 回空）與 insert／delete、customers／admins（42501）測試。
- security M3／architect L3：套用前存 `pg_policies`、`relrowsecurity`、`relacl` 基準；先在交易裡試跑再 rollback；套用後用 `has_table_privilege` 比對完整矩陣（見下方「套用步驟」）。
- security L1：appointments 改用欄位層級授權（③）。
- security L4：down 檔頭補上「只適用於本專案」「優先修正、最後才回滾」、MAINTAIN 限制。
- security L5：decisions.md 記錄「anon 可讀的 4 張表新增欄位一律視為公開」。
- security L6／architect L1：補上 42501 斷言，修正已不準的測試標題；新增設計師在授權層被擋的測試（delete／insert／access_token／customer_id）。

留給後續任務（不在本卡範圍）：
- 清理或加註不再生效的 RLS policy（architect M3、security L3）。
- 非管理員 authenticated 對 closed_dates delete 的測試（architect L2）。
- `is_admin()` 不檢查 aal，資料層可繞過 MFA（既有風險，TASK-046 已列為已知限制）。
- `is_admin()` 沒有明確 grant execute，依賴 PUBLIC 預設授權（既有風險）。

## 套用步驟（使用者在 Supabase SQL Editor 執行）

腳本放在 `ai/artifacts/專案設置/verification/TASK-066-sql/`。

1. `1-baseline.sql`：唯讀，存下套用前的 RLS policy、RLS 開關與原始授權（relacl）。
2. `2-dry-run.sql`：在交易內套用 0015、比對權限矩陣、模擬非管理員與 anon 存取，最後故意拋錯回滾。預期結果：權限不一致 0 筆、非管理員可見／可更新 appointments 皆 0 筆。
3. 試跑結果正確後，整份執行 `supabase/migrations/0015_explicit_table_grants.sql`。
4. `3-post-apply-check.sql`：唯讀，預期結果為「全部一致」。
5. 跑全部 `test:*` 整合測試，並到正式站實際操作前台預約與 `/admin` 各頁。
6. 任一步出問題：先只補缺少的那個權限；需要止血才整份執行 `0015_explicit_table_grants_down.sql`。

## 實作備註

- 高風險：牽涉權限邊界，而且只有一個 Supabase 專案（開發與正式共用），套錯會直接讓正式站壞掉。依 `ai/process/review-gates.md`，需經 architect 與 security-reviewer 審查計畫與 diff。
- 套用前先確認 down migration 可用，作為出問題時的回滾路徑。
- 注意 `0011`／`0012` 的 Database Webhook trigger：整合測試寫入 appointments 會觸發真實寄信（見記憶「整合測試小心真實 DB trigger」）。

## 驗證契約

- 單元測試：不適用。
- 整合測試：全部 `test:*` 整合測試 + 新增的權限測試。
- E2E 測試：瀏覽器實際操作顧客預約流程與後台主要頁面（本機 + 正式站）。
- 型別檢查：`npx tsc --noEmit`（若有修改測試檔）。
- Lint：`npm run lint`。
- Build：不適用（無應用程式碼變更）。
- 螢幕截圖：正式站預約流程與後台頁面。
- 安全性檢查：`ai/checklists/security-checklist.md`，特別是權限控管與 migration／回滾項目。

## 完成證據

- 變更的檔案：
  - `supabase/migrations/0015_explicit_table_grants.sql`、`0015_explicit_table_grants_down.sql`（新增）
  - `tests/rls.integration.test.ts`：anon 對 4 張表 42501；設計師對 customers／admins 42501、`is_admin()` 仍可用；新增「TASK-066 授權層邊界」describe（設計師 delete／insert／access_token／customer_id 42501、非管理員對 appointments 讀改皆空、insert／delete 42501）；兩組 fixture 改排到約 3 年後，避開真實預約。
  - `tests/booking.integration.test.ts`、`tests/admin-booking.integration.test.ts`：anon 斷言從「RLS 回空」改為 42501。
  - `tests/business-hours.integration.test.ts`：只改測試標題。
  - `ai/context/decisions.md`：新增 TASK-066 決策；TASK-065 規則改為一併 revoke service_role。
  - `ai/checklists/security-checklist.md`：同步 TASK-065 規則。
  - `ai/artifacts/專案設置/verification/TASK-066-sql/`：基準、試跑、套用後檢查腳本，以及套用前證據 `results-before-apply.md`。
- 執行過的指令：
  - 使用者於 SQL Editor：`1-baseline.sql`（14 條 policy 與 migration 一致，grantor 皆 postgres，無 PUBLIC 授權）→ `2-dry-run.sql`（權限不一致 0 筆、非管理員可見／可更新 appointments 0 筆、anon 可見 services 4 筆）→ 套用 `0015`（Success）→ `3-post-apply-check.sql`（全部一致）。
  - `npm run test:rls`、`test:booking`、`test:admin-booking`、`test:business-hours`、`test:store-settings`、`test:booking-policy`、`test:services`、`test:account`、`test:notifications`。
  - `npx tsc --noEmit`、`npm run lint`、`npm test`。
- 測試輸出：
  - 整合測試 9 組共 154 個全部通過：rls 18、booking 23、admin-booking 13、business-hours 33、store-settings 11、booking-policy 7、services 13、account 17、notifications 19。
  - `test:rls` 第一次執行失敗：原有 fixture 排在「1 小時後」，撞到正式環境已有的預約（`appointments_no_overlap`），與 0015 無關；改排到約 3 年後重跑通過。
  - `npx tsc --noEmit`、`npm run lint` 通過。
  - `npm test` 有元件測試逾時（每次失敗的檔案不同，皆為 `Test timed out in 5000ms`，機器同時執行 dev server／看板／Turbopack）。`npx vitest run tests/components --testTimeout=30000` 13 個檔案、108 個測試全部通過；本卡未修改任何元件或其測試對象。
- 螢幕截圖：
  - 本機前台（anon）：店家資訊、服務列表、週四 22 可預約時段（`get_available_slots`）正常顯示。
  - 本機後台（使用者自行登入設計師帳號，只讀不寫）：預約週曆（含預約、顧客名稱、10/25 公休）、預約詳情（含電話）、改期視窗時段載入、服務設定列表、營業時間＋特殊公休日、預約規則、商店設定（含品牌圖片）、帳號設定（個人資料 `get_admin_profile`）皆正常；瀏覽器 console 與 dev server log 皆無錯誤。
- 已知限制：
  - 不再生效的 RLS policy 仍留在資料庫（見 decisions.md TASK-066）。
  - `npm test` 在高負載時有元件測試逾時，屬既有環境問題。
- 後續任務：見上方「審查紀錄」的「留給後續任務」。
