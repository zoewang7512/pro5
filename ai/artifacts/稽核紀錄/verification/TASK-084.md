# 驗證報告

## 摘要

- 任務：TASK-084 稽核紀錄 資料表與寫入機制（`0019_audit_log`、`lib/admin/audit-log.ts`、單元與整合測試、清掃腳本）
- 結果：**通過**（使用者已於 2026-10-24 套用 `0019`；整合測試權限矩陣與 `test:rls` 回歸皆通過）
- 驗證者：實作 agent（Claude Code）。product 關卡已由使用者確認簡版規格書（2026-10-24）；
  security-reviewer 已複審 `0019`（低風險 3 項已採納）；其餘關卡待人工核准。

## 指令

| 指令 | 結果 | 備註 |
|---|---|---|
| `npx tsc --noEmit` | 通過 | 0 錯誤 |
| `npm run lint` | 通過 | 0 error、0 warning |
| `npm run build` | 通過 | |
| `npx vitest run tests/admin/audit-log.test.ts` | 63 項全數通過 | 本卡新增 |
| `npx vitest run --testTimeout=60000 --maxWorkers=4`（全套） | 76 檔／1272 項，1271 通過 | 唯一失敗 `designer-portfolio-tab`（資料列已刪但檔案沒刪成功）單獨重跑 11 項全過，屬並行負載下的既有不穩定；預設參數全套跑會有 5 檔逾時，單檔皆可過，與本卡無關（本卡未改任何元件） |
| `npm run test:audit-log` | **23 項全數通過** | 第一次 22／23：帶 `id` 的 insert 實測回 `428C9`（generated always 欄位不接受指定值）而非 `42501`；兩者都是拒絕、id 無法指定，已修正斷言並確認沒有寫入 |
| `npm run test:rls` 回歸 | **18 項全數通過** | 套用 `0019` 後既有權限未受影響 |
| `npm run sweep:audit-test-rows`（dry-run） | 找到 0 筆 | 整合測試的 afterAll 已清乾淨 |

## 單元測試涵蓋（`tests/admin/audit-log.test.ts`）

- `recordAdminAction`：insert 回傳 error／reject／`from` 拋例外／`console.warn` 本身拋例外都不 throw；警告只印 error code，不含訊息內容；null 不查詢；只送五個白名單欄位。
- 截斷 60 字（含代理對）、`entityId` 128 字與空字串、changes 超限先丟、summary 也超限只留事件與對象。
- 白名單：19 個事件代碼全涵蓋；每個建構結果的鍵集合屬於白名單；顧客欄位／token／頭像／簡介不在任何白名單；傳入含 `customer_*` 的物件，輸出與實際送出的 insert 都不含。
- 無變動回傳 null、讀不到舊值只記新值、營業時間 `HH:mm:ss` 與 `HH:mm` 正規化、公休日時間不算變動。
- `describeAuditEntry`：中文事件名、對象、單位（小時／分鐘／NT$）、布林「是／否」、`null`「未設定」、Asia/Taipei 換算（含跨日）、白名單外 key 忽略、壞資料不 throw、**以 `process.env.TZ` 切換四個時區結果不變**。
- `listAuditLog`：查詢組成、類別篩選、游標 `^\d+$`（8 種非法值不查詢）、limit 夾值、多取一筆與 `nextCursor`、泛用錯誤。

## 整合測試權限矩陣（真實 Supabase，23 項）

- anon：select／insert／update／delete 全部 42501。
- 非店長登入者：先以 service_role 確認底下有列；select 回空陣列（非錯誤）；insert 42501；update／delete 42501 且基準紀錄不變。
- 店長：insert 成功且 `actor_id` 等於登入者 id、`created_at` 由資料庫決定；select 讀得到；帶 `actor_id`／`created_at` 被欄位層級拒絕（42501）；帶 `id` 被拒；update／delete 42501；constraint（事件代碼格式、entity_type、空 entity_id、summary 非物件、summary 超過 4096 位元組）都被資料庫拒絕。
- service_role：select、delete 成功；insert／update 42501。
- `recordAdminAction`／`listAuditLog` 對真實資料庫：寫入後類別篩選（預約／設定）正確；顧客欄位被白名單過濾而沒進資料庫；游標分頁不重複；非店長 client 讀到空結果，呼叫 `recordAdminAction` 不 throw 且寫不進。

## 已知限制

- 整合測試以未啟用 MFA 的店長帳號驗證；已啟用 MFA 但只到 aal1 的 session 會因 `is_admin()` 為 false 而與非店長同樣被擋（預期行為，與其他後台寫入一致）。
- 尚未人工確認的項目：security／test／code_review 關卡與人工驗收。
- `0019` 重跑會把授權與 policy 還原成本檔版本（檔頭已註明）。
- 保證邊界與測試雜訊見 `ai/context/decisions.md`「TASK-084～086」。

## 後續任務

TASK-085（16 個來源函式接線）、TASK-086（列表畫面）。
