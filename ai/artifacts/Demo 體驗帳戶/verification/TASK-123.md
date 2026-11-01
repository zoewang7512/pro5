# TASK-123 驗證報告：services／store_settings 文字欄位長度 CHECK

- 日期：2026-11-01
- 狀態：**實作完成、三方審查已處理、0029 已由使用者套用；套用後整合測試 21/21、六項回歸通過、約束查詢 6 列皆已驗證、既有資料雜湊不變；回滾實測完成（_down 後 off 21/21、重套後 on 21/21）；人工驗收通過（2026-11-01），轉 Done**
- 風險等級：高（migration，且影響每日還原寫回的兩張表）；上限數字由使用者核准為卡片建議值
- **重要：本卡完成後 Demo 入口仍不能開放**——安全審查發現另外三個容量缺口（見「審查結論與處置」M1／M2／S1），不屬本卡範圍，待使用者決定如何處理。

## 變更內容

| 檔案 | 說明 |
|---|---|
| `supabase/migrations/0029_text_length_checks.sql` | `set local lock_timeout = '5s'`；六個長度 CHECK（`char_length`）：services.name 60、description 500；store_settings.name 200、address 200、logo_url 2048、cover_image_url 2048；套用前既有資料檢查（超過即中止並指名欄位）；idempotent；尾端自我檢查（六個皆存在、CHECK、已驗證） |
| `supabase/migrations/0029_text_length_checks_down.sql` | 同樣 lock_timeout；移除這六個；自我檢查確認 0006 的 description／phone CHECK 仍在 |
| `lib/admin/services.ts`、`lib/store-settings.ts` | 上限常數（匯出）、`validateServiceName`／`validateStoreName` 加長度、新增 `validateServiceDescription`／`validateStoreAddress`（trim 後碼點數） |
| `app/admin/_components/ServiceFormDialog.tsx`、`StoreSettingsForm.tsx` | 接上驗證與既有錯誤顯示樣式；地址欄補 blur 驗證並保留一行錯誤空間（與其他欄位一致） |
| `tests/lib/text-length-checks-migration.test.ts` | 檔案內容把關 12 項 |
| `tests/admin/services.test.ts`、`tests/store-settings.test.ts`、兩個元件測試 | 驗證函式與元件案例 |
| `tests/text-length-checks.integration.test.ts`、`vitest.text-length-checks.config.ts`、`package.json` | `npm run test:text-length`：21 項，on／off 兩種模式（`TEXT_LENGTH_EXPECT=off`），含店長身分（authenticated）案例 |
| `verification/TASK-123-snapshot.mjs`、`TASK-123-pglite-rehearsal.mjs` | 套用前後唯讀雜湊；可重跑的 PGlite 演練 |
| `docs/demo-account.md`、`decisions.md`、`project-map.md`、`architecture-notes.md` | 手冊（文字欄位長度上限、緊急放行警語、尚未處理的缺口清單）、決策紀錄、專案地圖、D14 補記 |

## 已查證的事實

- 真實庫唯讀量測：services 4 列，name 最長 4、description 最長 78；store_settings 1 列，name 6、address 14、logo_url 124、cover_image_url 125。`lib/demo/seed-base.json` 同樣遠低於上限。
- 套用前快照（`TASK-123-snapshot.mjs`，2026-11-01）：`services 列數 4 hash 4eb0806a215c874e`；`store_settings 列數 1 hash 3e2195a3a5678288`（不含 updated_at）。整合測試（改動後已還原）前後各取一次，雜湊相同。

## 已跑的驗證（套用 0029 之前）

| 項目 | 結果 |
|---|---|
| 基準線 `TEXT_LENGTH_EXPECT=off npm run test:text-length` | **21/21**（上限不存在時超長值可寫入；店家設定快照已還原；services 測試列已清除） |
| 預設模式 `npm run test:text-length`（尚未套用） | **13 失敗、8 通過**；失敗全部是「預期被拒但沒有錯誤」；店長身分的「剛好上限」寫入通過（證明被拒絕時是 CHECK 而非 RLS） → 測試有鑑別力 |
| PGlite 演練（`TASK-123-pglite-rehearsal.mjs`，加入 lock_timeout 後重跑） | `ALL REHEARSAL CHECKS PASSED`：套用、重複套用、邊界、全形字與表情符號以碼點計、null 與空字串、update 被拒後原值不變、0006 既有 CHECK、`_down` 與重複 `_down`、既有資料超限時以明確訊息中止且不留半套、修正後重新套用 |
| `npx vitest run tests/lib tests/admin tests/store-settings.test.ts` + 兩個元件測試 | 49 檔 / 1220 項通過 |
| `npx tsc --noEmit`、`npm run lint`、`npm run build` | 無錯誤／成功 |

PGlite 不是 Supabase：它驗證 SQL 語法、順序、回滾與 CHECK 行為，沒有驗證真實專案的角色權限與 PostgREST 的錯誤格式。**所以套用後必須在真實庫再跑一次。**

## 套用後驗證（使用者已套用 0029，2026-11-01）

| 項目 | 結果 |
|---|---|
| 資料雜湊（TASK-123-snapshot.mjs；整合測試與回歸後再取一次） | 套用前、套用後、回歸後三次完全相同：services 4 列 `4eb0806a215c874e`；store_settings 1 列 `3e2195a3a5678288` → 既有資料不變 |
| `npm run test:text-length`（預設模式，已套用） | **21/21**（套用前同一模式是 13 失敗 / 8 通過）；店長身分案例通過 |
| `test:store-settings` / `test:services` / `test:demo-reset` / `test:demo-row-caps` / `test:audit-log` / `test:demo-audit-cap`（依序執行） | 11 / 17 / 34 / 16 / 28 / 13 項，全數通過 |

| `pg_constraint` 查詢（使用者在 SQL Editor 執行並貼回輸出） | 6 列、`convalidated` 皆為 true；定義與核准值一致：`services_name_length` ≤ 60、`services_description_length` ≤ 500（`COALESCE(description, '')`）、`store_settings_name_length` ≤ 200、`store_settings_address_length` ≤ 200、`store_settings_logo_url_length` ≤ 2048、`store_settings_cover_image_url_length` ≤ 2048 |

### 回滾實測（2026-11-01，已完成）

| 步驟 | 結果 |
|---|---|
| 使用者在 SQL Editor 執行 `0029_text_length_checks_down.sql` | 成功（尾端自我檢查通過才 commit） |
| `TEXT_LENGTH_EXPECT=off npm run test:text-length`（回滾後） | **21/21**：六個上限已消失，超長值可寫入；資料雜湊仍為 `4eb0806a215c874e`／`3e2195a3a5678288` |
| 使用者重新執行 `0029_text_length_checks.sql` | 成功（含套用前檢查與尾端自我檢查；同時證明真實庫可在已回滾狀態下重新套用） |
| `npm run test:text-length`（預設模式，重新套用後） | **21/21**：上限恢復；資料雜湊不變 |

未做：真實庫上「已套用狀態再執行一次 0029」（idempotent 的第二次套用）——PGlite 演練已涵蓋，真實庫沒有另跑；重新套用後未再查一次 `pg_constraint`（整合測試 21/21 與自我檢查已涵蓋）。

**人工驗收：** 使用者 2026-11-01 驗收通過，看板卡轉 Done。

## 待使用者執行（套用 0029 後）— 其餘項目

1. 在 SQL Editor 整份貼上執行 `supabase/migrations/0029_text_length_checks.sql`（尾端自我檢查通過才會 commit）。
2. 我再依序執行（**不可並行**，這些都會動 store_settings 單例）：
   - `node --env-file=.env.local "ai/artifacts/Demo 體驗帳戶/verification/TASK-123-snapshot.mjs"`（雜湊必須與上方套用前相同）
   - `npm run test:text-length`（預期 21/21）
   - 回歸：`test:store-settings`、`test:services`、`test:demo-reset`、`test:demo-row-caps`、`test:audit-log`、`test:demo-audit-cap`
3. 約束狀態唯讀查詢（語句見 0029 檔頭），預期 6 列、`convalidated` 皆為 t，請貼回輸出。
4. 回滾實測（比照 TASK-116／122）：執行 `0029_text_length_checks_down.sql` → `TEXT_LENGTH_EXPECT=off npm run test:text-length`（預期 21/21）→ 重新套用 0029 → 預設模式 21/21。**未做前不宣稱「`_down` 後行為恢復」與「真實庫可重複套用」已驗證。**

## 審查結論與處置

三份報告（架構、安全、測試）皆為「有條件核准」；子代理意見不等同人工核准。

| 項目（來源） | 處置 |
|---|---|
| **安全 M1**：`designers.name` 的 CHECK（0017）只限制 btrim 後長度（`char_length(btrim(name, E' 　')) between 1 and 30`），原值可用前後空白無限填充；Demo 有 `update (name…)` 權限，列數上限只管 insert。已核對 CHECK 內容屬實 | **不在本卡範圍**（`designers` 為任務卡「不得觸碰」）。**待使用者決定**是否另開卡（修法：`char_length(name) <= 30` 或要求 `name = btrim(name, …)`，沿用 0029 的套用前檢查） |
| **安全 M2**：`customers.name`／`appointments.customer_name` 只檢查 trim 後長度、存原值；`appointments.customer_email` 無長度限制；匿名就能做。**TASK-120／121 並沒有處理這件事**——先前 TASK-116 報告、任務卡草稿與手冊「歸 TASK-120／121」的說法不正確 | 已更正任務卡、手冊 §8、decisions.md。**待使用者決定**是否另開卡並列入口前置條件（修法：`create_appointment` 存 trim 後姓名、Email ≤ 254、四個欄位加 CHECK，套用前量測既有資料） |
| **安全 S1**：`auth.users.raw_user_meta_data` 未鎖（0021 刻意排除），Demo 可寫大型 JSON，且 user_metadata 會進 JWT（與 TASK-122 安全審查 N6 同一件事）。GoTrue 大小上限未查證 | **待使用者決定**是否另開卡（建議 0021 guard 對 is_demo 帳號限制大小），需實測 |
| **安全 S2**：緊急放行說明沒提醒「等於重新打開缺口」 | **採納**：0029 檔頭與手冊都補上（先 `demo:disable` 或接受風險；放行期間若寫入超長資料，重跑 0029 會被套用前檢查擋下，需先還原資料；放行後務必重套） |
| 安全 NOTE：CHECK 在 `ExecConstraints` 執行於寫入之前，超長值不會產生 heap／TOAST／WAL 寫入，也不會留下 dead tuple；多列語句每列受上限約束；23514 不外洩整列資料（RLS 表對非 bypassrls 角色不附 failing row）；無權限／search_path 風險 | 記錄；是審查者的分析，未在真實庫另行實測 |
| **架構 S1**：0029／`_down` 沒有 `lock_timeout`，ACCESS EXCLUSIVE 排在長交易（每日還原、備份）後面會讓前台查詢跟著卡住 | **採納**：兩檔皆加 `set local lock_timeout = '5s'`（比照 0018／0020），單元測試固定；PGlite 重跑通過。等不到鎖會整份回滾，重跑即可 |
| **架構／測試 S5**：`package.json` 的 `test:demo-disable` 行被我誤改（冒號後空格不見） | **已還原**（diff 只剩新增 `test:text-length` 一行） |
| 架構 NOTE 5：`validateStoreDescription`／`validateStorePhone` 仍用 UTF-16 `.length` 且不 trim，比資料庫嚴格 | 既有行為、不會寫入壞資料；本卡不動（可另開小卡統一）。已記錄 |
| 架構 NOTE 6：地址欄固定預留一行錯誤空間，與任務卡「不新增視覺元素」略有出入 | 已在決策紀錄與本報告寫明；建議人工驗收時目視確認地址欄高度 |
| **測試 MUST 1**：驗收標準「一般管理員身分」沒有測試 | **採納**：整合測試新增店長身分（authenticated，只登入不 signOut）案例：services.name 60／61、store_settings.name 200／201，並證明被拒絕的是 CHECK 而非 RLS。驗收標準措辭已更新：六欄位完整邊界以 service role 驗證（CHECK 與角色無關），店長路徑涵蓋兩欄 |
| **測試 MUST 2**：「套用前後既有資料不變」沒有證據 | **採納**：新增 `TASK-123-snapshot.mjs`（唯讀、只印列數與雜湊），已取套用前值；套用後再取一次比對 |
| **測試 MUST 3**：套用後證據全是待辦；回歸清單漏 `test:audit-log` | 清單已補（含 `test:demo-audit-cap`、依序執行）；證據需待使用者套用後取得，**目前尚未取得，不宣稱完成** |
| 測試 S1：殘留測試列前置檢查形同虛設（前綴含 `Date.now()`） | **採納**：改為固定前綴 `__TEST__tl-`，beforeAll 掃除上次殘留（`like` 跳脫底線，且限 `is_active=false`） |
| 測試 S2：「60 個全形字」「60 個表情符號」標題與實際不符，缺 61 個被拒案例 | **採納**：前綴縮短為 11 字元，改 `it.each`：總長剛好 60 成功、61 被拒；斷言位元組與 UTF-16 單位都超過 60（若資料庫改用位元組或 UTF-16 計算，案例會失敗） |
| 測試 S3：測試改動真實 store_settings 單例，檔頭缺並行／排程窗口提醒 | **採納**：檔頭補上不可與其他會改 store_settings 的測試並行、避開台北 03:00–04:00 每日還原窗口、覆寫式還原的限制 |
| 測試 S4：快照印到 console 含電話與簡介 | **採納**：只印本測試會改動的四個欄位 |
| 測試 S6：PGlite 演練不可重跑 | **採納**：腳本存為 `TASK-123-pglite-rehearsal.mjs`（檔頭有執行說明；PGlite 不進專案依賴） |
| 測試 S7：地址超長送出時焦點跳到店名欄 | **記錄為既有行為**：`handleSubmit` 對所有欄位錯誤一律聚焦店名（電話、簡介本來就如此），本卡不改；錯誤文字顯示在地址欄下方 |
| 測試 NOTE：service 名稱 61 字只測新增模式；「trim 後仍超長」沒有元件案例；off 模式 partial-write 對稱性 | partial-write 的 off 對稱斷言已補（address 也寫入）；其餘為 NOTE，未補 |

## 殘留風險與已知限制

- **Demo 入口仍不能開放**：除了本卡，還有 M1（designers.name）、M2（customers／appointments 欄位長度）、S1（raw_user_meta_data）、TASK-112 第一次真實還原，以及 TASK-120／121 原本的範圍；其中 M1／M2／S1 是本次審查新發現，等使用者決定。
- 0029 套用前，缺口仍然存在。
- 整合測試會在執行期間暫時改動商店設定那一列（名稱／圖片網址短暫變成測試值，影響前台顯示），結束時以快照還原並核對；覆寫式還原——期間若店長在後台改了設定會被蓋掉；`updated_at` 無法還原成原值。第一次基準線與預設模式各執行過一次，兩次都已還原並核對。
- 螢幕截圖：不適用（沒有新增視覺元素，只接上既有錯誤顯示）。唯一的版面變化是「地址」欄下方保留一行錯誤空間，與店名、電話、簡介一致，請人工驗收時目視確認。
- 先前 TASK-116 驗證報告（歷史文件）中「屬 TASK-120／121」的說法未改動，以本報告更正為準。
