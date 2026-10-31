# 驗證報告

## 摘要

- 任務：TASK-113 Storage 擁有者限制與 Demo 上傳上限（migration 0025：RESTRICTIVE policy ＋ BEFORE INSERT 觸發器）
- 結果：**實作與自動化驗證完成，三方子代理審查已執行並處理，待使用者人工驗收。**整合測試 19 項在三種狀態下都符合預期（舊版對照、新版生效、`_down` 之後）；所有碰 Storage 的既有整合套件通過；`tsc`、`lint`、`build` 通過。
- 驗證者：實作 agent（Claude Code）。架構（architect）、安全（security-reviewer）、測試（test-engineer）三個子代理已審查，其意見是 agent 意見，**不等於人工核准**。
- 日期：2026-10-31。migration 由使用者在 Supabase SQL Editor 套用；測試由 agent 執行，只用拋棄式帳號與物件，不碰 designer001 與任何真實物件。

## 審查過程中發現並已修正的問題（重要）

**初版（RLS 預檢版）的「Demo 上傳上限」擋不住有心人。**安全審查指出上限只在 storage-api 寫入前的權限預檢生效。我用拋棄式 Demo 帳號對初版實測確認：

| 探針 | 結果（初版） |
|---|---|
| 物件數為 0 時簽出 35 個簽名上傳網址，再逐一上傳 | **35/35 成功**（簽 1000 個也一樣） |
| 同時並行上傳 40 個 | **34 個成功** |
| 滿 30 後把物件 `move` 到 admin-assets（跨 bucket） | **5/5 成功**，admin-assets 無上限 |
| 滿 30 後 `copy` | 被擋 |

影響：拿到公開 Demo session 的人可以在一天內灌爆免費方案 1GB 配額、影響整個正式專案。修正（使用者同意）：

1. 上限改用 `storage.objects` 的 **BEFORE INSERT 觸發器**（storage-api 真正寫入時也會觸發），以 `pg_advisory_xact_lock` 讓同一帳戶的寫入排隊再計數，成為硬上限；用資料列的 `owner_id` 查 `auth.users` 判斷 Demo（不讀 JWT claim，因為實際寫入走的不是使用者連線）。
2. 新增 RESTRICTIVE policy：Demo 完全不能 update（擋 move 與 upsert 覆寫）。本專案上傳流程只用 insert（新 uuid 路徑、不帶 upsert），不需要 update。
3. 移除初版的 insert 上限 policy 與 `demo_owned_object_count` 函式。

## 變更的檔案

| 檔案 | 說明 |
|---|---|
| `supabase/migrations/0025_storage_owner_and_demo_caps.sql`、`_down.sql` | 新增：3 條 RESTRICTIVE policy（admin-assets update／delete 限擁有者；Demo 不可 update）＋ 觸發器 `demo_storage_cap_guard`；檔頭依賴檢查、尾端自我檢查、緊急停用說明；`_down` 含安全降級警告 |
| `tests/storage-owner.integration.test.ts`、`vitest.storage-owner.config.ts` | 新增：19 項整合測試（支援 `STORAGE_OWNER_EXPECT=off`） |
| `tests/demo-enter.integration.test.ts` | **（經使用者同意擴大範圍）**反轉過期的特徵化案例：Demo 能列出，但不能刪除不是自己上傳的 admin-assets 物件 |
| `ai/artifacts/Demo 體驗帳戶/verification/TASK-103-admin-surface.md` | **（同上）**更新 §3-H：admin-assets 已封住，其他兩個 bucket 列為接受的殘留 |
| `package.json` | 新增 `test:storage-owner` |
| `ai/context/decisions.md` | 決策紀錄 |

## 設計重點

- **只收緊、不放寬**：尾端自我檢查確認 PERMISSIVE policy 的「內容指紋」（名稱、指令、條件的 md5）套用前後相同、三條 policy 都是 RESTRICTIVE＋`{authenticated}`、觸發器已啟用、函式是 SECURITY DEFINER＋search_path 為空＋擁有者可繞過 RLS（否則計數永遠是 0）＋API 角色不可執行、舊版物件已移除。
- **擁有者限制**：`admin-assets` 的 update（using＋with check）與 delete 加 `owner_id = auth.uid()::text`；其他 bucket 不受影響。
- **觸發器很短且先放行**：非目標 bucket、`owner_id` 為 null 或不像 uuid、查無此人或非 Demo，都在計數之前直接放行；錯誤碼用 `42501`，storage-api 回「違反資料列安全政策」。緊急停用只需 `drop trigger if exists demo_storage_cap_guard on storage.objects;`。
- **service_role 不受影響**（BYPASSRLS；其上傳物件 `owner_id` 為 null，不計入任何額度）。測試內的清理即用 service role 刪除他人擁有的物件。

## 驗收標準對照

| 驗收標準 | 結果 | 證據 |
|---|---|---|
| B 無法刪除、更新（upsert 覆寫、move）A 的 `admin-assets` 物件；A 自己可以 | **通過** | B 的 `remove` 回空陣列且物件仍在；upsert 與 move 被擋，內容、名稱、擁有者不變；A 可 upsert 與刪除自己的 |
| `test:account` 通過 | **通過** | 17/17 |
| Demo 在某公開 bucket 上傳第 31 個被拒絕；非 Demo 不受限 | **通過** | 三個 bucket 各自第 31 個被拒絕（擁有數仍為 30）、刪一個後又能上傳；各 bucket 獨立計數；B 擁有超過 30 個仍可繼續上傳；B 的物件不佔 Demo 額度 |
| 簽名上傳網址、並行上傳、move、copy 無法繞過上限 | **通過**（新增，審查提出） | 簽出 35 個網址再上傳：剛好 30 個成功；並行 40 個：剛好 30 個成功；Demo 跨 bucket move、upsert 覆寫被擋；滿 30 後 copy 被擋 |
| `test:designers`、`test:store-settings` 通過 | **通過** | 122/122、11/11 |
| `_down.sql` 後 B 又能刪除 A 的物件 | **通過** | `_down` 後 off 模式 19/19：B 能刪與 move A 的物件、Demo 能 move 與 upsert、無上限 |

## 指令與輸出

| 指令／步驟 | 結果 |
|---|---|
| PGlite 預演（假 storage／auth、角色與 RLS）：初版 5 組、v2 另含「從初版升級」「無 JWT 的寫入也擋」「null／非 uuid／查無此人不受限」「_down」 | 全過 |
| 套用前基準（`STORAGE_OWNER_EXPECT=off`，初版測試） | 12/12：證明原本的缺口真實存在 |
| 初版保護生效後跑**新版測試** | 19 項中 4 項失敗（Demo move、Demo upsert、簽名網址、並行）、15 項過：新測試能重現審查發現的缺口 |
| 使用者套用新版 0025 → 3 條 RESTRICTIVE policy 與觸發器（`tgenabled = O`）查得到 | `npm run test:storage-owner` **19/19** |
| 新版生效後的回歸：`test:demo-enter` 22/22（含反轉後的案例）、`test:mfa-rls` 20/20、`test:demo-seed-bucket` 14/14、`test:account` 17/17、`test:designers` 122/122、`test:store-settings` 11/11 | 全過 |
| 使用者套用 `_down` → `STORAGE_OWNER_EXPECT=off npm run test:storage-owner` | **19/19** |
| 使用者重新套用 0025 → 查詢確認 → `test:storage-owner` 19/19、`test:demo-enter` 22/22、`test:account` 17/17 | 全過 |
| `npx tsc --noEmit`／`npm run lint`／`npm run build` | 0 錯誤／0 error／成功 |
| `npx vitest run tests/lib` | 23 檔皆過（其中 `demo-reset-test-scan` 曾因我的測試註解出現禁用字樣而失敗，已改寫註解、未動掃描規則，6/6 通過） |

## 審查處理

**測試審查（test-engineer）**

| 項目 | 處置 |
|---|---|
| H1 `test:demo-enter` 有過期斷言、未納入回歸 | **採納並實測確認**（1 項失敗）；經使用者同意擴大範圍，反轉案例並更新 TASK-103-admin-surface.md |
| H2 回歸範圍漏了碰 Storage 的套件 | **採納**：補跑 `test:demo-enter`、`test:mfa-rls`、`test:demo-seed-bucket`，全過 |
| M1 off 模式有一項空過；報告把初次失敗全歸為 PGRST202 | **採納**：計數函式測試已移除（改由觸發器行為測試取代）；本報告改述每種狀態的實測結果 |
| M2 「只算自己的」靠前一測試的殘留；未證明每 bucket 獨立 | **採納**：改用 `ensureOwned` 自備前置條件；新增每 bucket 獨立計數案例 |
| M3 null 擁有者案例未測 | **採納**：新增（service role 上傳 → 一般管理員與 Demo 都刪不掉） |
| M4 簽名網址／move／copy 繞過未測 | **採納並實測確認為真實缺口**，見上方「發現並已修正的問題」 |
| M5 service_role 路徑無證據 | 部分採納：測試內以 service role 刪除他人／null 擁有者物件作為證據；`lib/demo/reset.ts` 的實跑留給 TASK-112 |
| L1 `remove` 回傳值未斷言 | 採納：被擋時斷言回空陣列 |
| L5 `afterAll` 在快照前失敗會誤報 | 採納：加 `if (before)` |
| L6 PGlite 預演腳本不在 repo | 如實標註：預演腳本在暫存目錄、未納入 repo，只作為套用前的語法／邏輯預演，**不作為驗收證據**；驗收證據是對正式庫的整合測試 |

**架構審查（architect）**

| 項目 | 處置 |
|---|---|
| H1 同上（demo-enter 回歸） | 已處理 |
| M1 計數函式的 EXECUTE 權限會影響所有上傳 | **不再適用**：改用觸發器後沒有給 `authenticated` 的函式；自我檢查改驗 API 角色不可執行 |
| M2 軟上限超出幅度未量化 | **已解決**：改為硬上限，實測並行 40 個剛好 30 個 |
| L1 `_down` 缺安全降級警告 | 採納 |
| L2 上限常數寫死／TASK-116 單一來源 | 記錄：現在寫在觸發器函式內；TASK-116 設計時再決定是否集中 |
| L3 PERMISSIVE 只比對數量 | 採納：改比對內容 md5 |
| L5 0023 檔頭驗證查詢說明過時（11 列） | 記錄：既有 migration 不改；全表現為 14 列（含 3 條 RESTRICTIVE），0023 的自我檢查只看 PERMISSIVE，不衝突 |
| L6 額度用完的營運說明 | 轉交 TASK-111 手冊 |

**安全審查（security-reviewer）**

| 項目 | 處置 |
|---|---|
| H1 上限只在預檢生效 | **採納，實測確認為真**，改用觸發器（見上） |
| M1 跨 bucket move 繞過 | **採納，實測確認為真**，新增「Demo 不可 update」policy |
| L1 計數靠擁有者有 BYPASSRLS | 採納：自我檢查驗 `rolbypassrls` |
| L2 insert 時沒綁定 owner_id | **不採納（記錄為殘留）**：storage-api 的 owner 一律取自 JWT；Data API 預設不開放 storage schema。綁定可能影響所有上傳，風險大於收益；建議上線前用 SQL 唯讀確認 API Exposed schemas 不含 `storage` |
| L3 designer-assets／store-assets 跨使用者刪除 | 維持已接受的殘留（每日還原補回，最長約 24 小時） |
| L4 null 擁有者 | 可接受，已測並記錄 |
| L5 測試期間 is_demo 帳戶變 2 個 | 檔頭已註明；轉交 TASK-111 手冊 |

## 殘留風險與備註

1. **Demo 額度是全體訪客共用**：只有一個 Demo 帳戶，30 個物件被一個人用完，其他人當天無法再上傳（只影響上傳）。上傳失敗時前端只顯示通用錯誤。每日還原清孤兒後重置；若當天孤兒清理被跳過，額度不會重置（手冊要寫手動以 service role 清掉 Demo 的物件）。
2. **只限物件數，不限容量**：每個物件最多 5MB，最壞約 450MB（3 bucket × 30 × 5MB）。
3. **上傳在資料列寫入前已先放進 Storage 後端**：被觸發器拒絕的上傳，storage-api 是否會清掉已傳的檔案未實測；若留下孤兒，會占用配額但不出現在 `storage.objects`。建議 TASK-112 觀察 Storage 用量（Dashboard）。TUS／S3 分段上傳同理未實測。
4. **designer-assets、store-assets 的跨使用者刪除未擋**（接受，每日還原補回）。
5. **owner_id 為 null 的 admin-assets 物件，一般管理員也刪不掉**（只有 service_role）。TASK-112 第一次真實還原後，service role 複製進來的 seed 物件即是如此，是預期行為。
6. **insert 時未綁定 owner_id**（見審查處理）；依賴 storage-api 一律取 JWT 的 sub。
7. **觸發器掛在 Supabase 管理的 `storage.objects` 上**：Storage 升級若改動結構可能影響；緊急停用只需 `drop trigger if exists demo_storage_cap_guard on storage.objects;`。觸發器對非 Demo 的上傳多一次 `auth.users` 主鍵查詢。
8. 套用／回滾都是人工在 SQL Editor 操作；回滾與重新套用之間，正式庫沒有這些保護（當時尚無 Demo 帳戶與公開入口）。第一次重新套用曾貼錯檔，已用 `pg_policies` 與 `pg_trigger` 查詢確認最終狀態。
9. **本卡實際使用的 Supabase 事實**：託管 Supabase 允許在 `storage.objects` 建立觸發器與 policy（0025 套用成功並查得到）。
