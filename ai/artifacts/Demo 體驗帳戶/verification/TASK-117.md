# 驗證報告

## 摘要

- 任務：TASK-117 還原前備份腳本 `backup-demo-tables`（含 `restore.sql`，備份不進 git）
- 結果：**實作與自動化驗證完成，待使用者人工驗收。**單元測試 51 項全過；`tsc`、`lint`、`build` 通過；已對正式庫**唯讀實跑一次**（使用者同意），筆數與圖片與資料庫完全一致；`restore.sql` 已在拋棄式資料（PGlite 記憶體內 Postgres）上實測可還原。
- 驗證者：實作 agent（Claude Code）。本卡未啟動子代理審查；審查關卡（驗證／測試工程）請使用者決定。
- 日期：2026-10-31。對正式庫與 Storage **零寫入**，也**沒有**對正式庫執行 `restore.sql`。

## 變更的檔案

| 檔案 | 說明 |
|---|---|
| `scripts/backup-demo-tables.mjs` | 新增：唯讀備份。匯出 13 張表為 JSON、下載三個公開 bucket 的全部物件、產生 `manifest.json`（筆數／大小／SHA-256）、`restore.sql`、`README.md`；先寫 `backups/<時間戳>.partial`，讀回驗證通過才改名 |
| `package.json` | 新增 `demo:backup` |
| `.gitignore` | 加入 `backups/` |
| `tests/lib/backup-demo-tables.test.ts` | 新增：51 項（表順序與外鍵、restore.sql 結構與跳脫、路徑安全、`.gitignore` 判斷、原始碼零寫入掃描、用假 client 跑完整流程） |
| `tools/kanban/cards/TASK-117.json`、本報告、`task-cards/TASK-117.md` | 看板與文件 |

## 設計重點

- **零寫入**：只用 `select`（含 `count`）、唯讀 RPC `demo_list_storage_objects`（0024，`stable`）與 Storage `download`。測試掃描原始碼，不得出現 insert／update／upsert／delete／remove／upload／copy／move 等寫入呼叫、不得碰 `auth.admin`，且整支腳本只有一處 `.rpc(`。
- **備份期間一致性**：開始前先數各表筆數與物件數，匯出後再各數一次；任一不同就中止（要求重跑）。表資料分頁（每頁 1000，依主鍵排序）；下載後比對 Storage 回報的大小。
- **未完成不會被當成有效備份**：寫入 `.partial`，讀回驗證（每個檔重算 SHA-256、筆數、`restore.sql` 結構）通過才改名。失敗時只留 `.partial`。
- **開始前檢查**：`.gitignore` 必須排除 `backups/`，再用 `git check-ignore` 確認；否則中止。目標專案網址先印出；非互動環境必須帶 `--yes`。輸出不含任何金鑰（測試掃描 console 輸出不引用金鑰變數）。
- **`restore.sql` 的做法**（答覆任務卡的未知事項）：
  - 用 `insert … select * from jsonb_populate_recordset(null::public.<表>, $標籤$[…]$標籤$::jsonb)`：型別由資料表自己轉換；內容放進 dollar-quote，**標籤會挑一個不出現在內容裡的**，所以不需要逐值跳脫。
  - **不依賴 `session_replication_role`**（SQL Editor 的 postgres 角色不一定能設定）。改為在交易內 `alter table … disable trigger user` 暫停被覆寫表上所有使用者觸發器（寄信 webhook、價格快照、更新時間…），結尾 `enable trigger user`；外鍵檢查不是使用者觸發器，不會被暫停。0020 migration 已有同樣的 `disable trigger` 先例。
  - 單一交易、`lock_timeout 10s`；清空依外鍵反序、灌入依外鍵正序；`audit_log` 用 `overriding system value` 並把識別欄位序號**只往上調**（`setval(seq, greatest(max, nextval))`）；結尾逐表核對筆數，不符就 `raise exception` 整個回滾。
  - 不涵蓋 `auth.users`：`admins.user_id` 必須仍存在，否則外鍵失敗、整個回滾。
- **圖片的本機路徑**：保留 bucket 與資料夾；拒絕空片段、`.`、`..`；Windows 不允許的字元與 `%` 以 `%XX` 編碼；偵測大小寫不同的同名衝突。原始名稱留在 manifest。

## 驗收標準對照

| 驗收標準 | 結果 |
|---|---|
| 對正式庫實跑一次：各表筆數與資料庫一致；圖片數量與大小與 Storage 一致 | **通過。** 備份後另寫獨立查詢逐表、逐 bucket 比對：13 張表筆數全相同；`store-assets` 4 個／2,011,147 bytes、`designer-assets` 43 個／8,630,788 bytes、`admin-assets` 3 個／51,582 bytes 全相同（輸出「ALL MATCH」） |
| 對資料庫與 Storage 零寫入（前後筆數比對） | **通過。** 腳本內建前後各數一次且相同才算成功；獨立查詢備份後筆數與備份時相同；原始碼掃描無寫入呼叫 |
| `backups/` 在 `.gitignore` 內；`git status` 看不到備份檔 | **通過。** `git check-ignore -v` 命中 `.gitignore:31:backups/`；實跑後 `git status` 只列出本卡的 5 個變更，沒有備份檔 |
| `restore.sql` 的產生有單元測試（順序、跳脫、交易包覆）；並在拋棄式資料上實測可還原（不得對正式庫實測） | **通過。** 單元測試見下；PGlite 實測見下 |
| 手冊（TASK-111）寫明：何時可以刪備份 | **轉交 TASK-111。** 備份資料夾的 `README.md` 已寫「由使用者決定」的建議條件；已在 TASK-111 看板卡留言提醒手冊要寫明 |

### 正式庫實跑結果（備份 `backups/20261031T073758Z`，UTC）

| 資料表 | 筆數 | | 資料表 | 筆數 |
|---|---|---|---|---|
| services | 4 | | customers | 14 |
| designers | 4 | | appointments | 16 |
| designer_services | 14 | | audit_log | 28 |
| designer_leaves | 4 | | admins | 1 |
| designer_portfolio_images | 40 | | business_hours | 7 |
| closed_dates | 1 | | booking_policy／store_settings | 1／1 |

另核對：`restore.sql` 內嵌的 13 段資料與 `tables/*.json` 逐表 JSON 相同，且只有一個 `begin;`、一個 `commit;`。

### `restore.sql` 在拋棄式資料上的實測（PGlite，記憶體內 Postgres，與任何真實專案無關）

測試腳本與 PGlite 都放在暫存目錄，**未加入專案依賴**。建了與真實結構相同的 13 張假表（含外鍵、`text[]`、`jsonb`、`timestamptz`、`time`、`numeric`、identity 欄位、模擬寄信的觸發器），先放入與備份不同的「現況」資料，再執行 `buildRestoreSql` 產生的腳本：

1. **成功路徑**：現況資料被整表換掉；含單引號、雙引號、反斜線、`$$`、`$bk$`、emoji、換行、`'; drop table …` 的字串原樣還原；`text[]`、`jsonb`、時間、numeric 正確；`audit_log` 的 id 原樣（5、9）；**還原期間模擬寄信觸發器零觸發，還原後新增資料觸發器照常觸發**（已重新啟用）；識別欄位序號調高到大於備份最大 id。
2. **冪等**：同一份連跑兩次，結果相同、觸發器仍零觸發。
3. **外鍵失敗**（`admins` 指向不存在的 `auth.users`）：整個交易回滾，現況資料與觸發器啟用狀態維持原樣。
4. **筆數核對不符**（竄改一段資料）：`raise exception` 並整個回滾。

> 失敗時連線會停在「交易已中止」狀態，這是 Postgres 的正常行為；SQL Editor 在連線結束時回滾。

## 指令與輸出

| 指令 | 結果 |
|---|---|
| `npx vitest run tests/lib/backup-demo-tables.test.ts tests/lib/demo-reset-test-scan.test.ts` | 2 檔 57 項全過（後者是全 repo 掃描，確認本卡檔案沒有出現白名單外的 Demo 還原函式字樣） |
| `npx tsc --noEmit` | 0 錯誤 |
| `npm run lint` | 0 錯誤 |
| `npm run build` | 成功 |
| `npm run demo:backup -- --yes`（對正式庫，唯讀） | 完成並讀回驗證，輸出見上方表格；輸出不含金鑰 |
| 獨立查詢比對（備份後逐表 `count`、逐 bucket 呼叫唯讀 RPC） | ALL MATCH |
| `git check-ignore -v backups/20261031T073758Z/restore.sql` | `.gitignore:31:backups/` |
| `node restore-test.mjs`（PGlite，暫存目錄） | 4 項全過：「ALL RESTORE TESTS PASSED」 |
| `npx vitest run`（全套） | 見下方「已知現象」 |

### 已知現象：全套單元測試的元件測試不穩

全套跑時有 `tests/components/*` 的測試逾時（`Test timed out in 5000ms`）：同樣的檔案在不同次執行失敗數不同（30 → 7 → 2 項），集中在 `login-form`、`account-settings-view`、`designer-*`、`admin-shell`、`service-form-dialog` 的 userEvent 互動。本卡沒有改任何元件或其依賴，判斷是本機負載下的既有不穩（與先前卡片記錄的現象一致）。**本卡相關的測試檔全數穩定通過。** 若需要，可在負載較低時重跑確認。

## 殘留風險與待辦

1. **（已解決：使用者於驗收時在 SQL Editor 執行下列檢查，回傳 `Success. No rows returned`，確認 postgres 角色可暫停觸發器。）** **PGlite 不是 Supabase。** 它驗證了 SQL 語法、順序、跳脫、觸發器暫停／恢復、序號與回滾，但沒有驗證 Supabase 的角色權限：`alter table … disable trigger user` 需要是資料表擁有者。0020 migration 在 SQL Editor 內用過同樣的語句，預期可行；建議在 TASK-112 動工前，先在 SQL Editor 貼這段**完全無副作用**的檢查（結尾 `rollback`）：
   ```sql
   begin;
   alter table public.appointments disable trigger user;
   alter table public.appointments enable trigger user;
   rollback;
   ```
   若出現 `must be owner of table`，restore.sql 檔頭已寫明改用 postgres 角色。
2. **備份是「某一刻」的快照。** `backups/20261031T073758Z` 之後的任何資料變動不在其中。TASK-112 的真實還原前，請重跑一次 `npm run demo:backup -- --yes` 取得最新備份（有 `.partial` 後綴的資料夾不算數）。
3. **備份檔含顧客個資**，只在本機 `backups/`（已被 `.gitignore` 排除；Vercel 走 git 部署，不會上傳）。何時刪除由使用者決定；備份資料夾的 `README.md` 寫了建議條件。
4. **圖片還原是手動的**：`restore.sql` 只還原資料庫；圖片在備份資料夾內，需依 `README.md` 用 Dashboard 或腳本重新上傳（腳本方式為示意、未實測）。本卡刻意不做會寫入 Storage 的還原工具，以維持「備份腳本零寫入」。
5. **JSON 數值經 JavaScript 往返**：超過 2^53 的整數或超過雙精度的 numeric 會失真。目前資料的最大數值為 `audit_log.id`（兩位數）與價格（整數／兩位小數），不受影響。
6. **`enable trigger user` 會啟用全部使用者觸發器**：若有人刻意停用過某個觸發器，執行 `restore.sql` 後它會變成啟用。檔頭已註明。
7. 日後新增業務資料表時，需同步更新腳本的 `BACKUP_TABLES`，否則新表不在備份內，`restore.sql` 也不會處理它。
