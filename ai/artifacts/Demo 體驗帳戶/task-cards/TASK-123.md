# AI-Ready 任務卡

## Metadata

- 任務：services／store_settings 文字欄位長度 CHECK
- 上層規格：[`feature-spec.md`](../feature-spec.md)；來源：[`verification/TASK-116.md`](../verification/TASK-116.md)（安全審查 M2）
- 上層 Epic：Demo 體驗帳戶
- 上層 User Story：濫用防護與緊急開關
- 分軌：後端（含少量前端驗證同步）
- 前置任務（dependsOn）：TASK-116
- 狀態：人工驗收通過，已完成（2026-11-01；上限數字由使用者確認為卡片建議值）；**Demo 入口開放前必須完成（TASK-112 的前置條件）**
- 風險等級：高（migration，且影響每日還原寫回的兩張表）
- Agent owner：Claude Code
- 人工核准者：使用者

## 目標

TASK-116 對六張表設了列數上限，但 `services.name`／`description` 與 `store_settings.name`／`address`／`logo_url`／`cover_image_url` 沒有長度限制。Demo 對既有列反覆 PATCH 塞入大字串（單欄最大 1 GB）即可繞過列數上限、灌滿免費方案的 500 MB。本卡用資料庫 CHECK 補上這六個欄位的長度上限，並讓前端驗證與錯誤文案對齊。

## 情境包（Context Pack）

- 相關檔案：`supabase/migrations/0006_store_settings.sql`（已有 `description` 500、`phone` 20 的 CHECK，寫法範本）、`0017_designers.sql`（`designers` 欄位 CHECK 與 `char_length` 慣例）、`0001_core_schema.sql`（services 表）、`lib/admin/services.ts`、`lib/store-settings.ts`、`app/admin/_components/ServiceFormDialog.tsx`、`StoreSettingsForm.tsx`、`lib/demo/seed-base.json`（每日還原寫回這兩張表的來源）。
- 已查證的事實：
  - 其餘 Demo 可寫的表已有長度限制（`designers` 各欄、`designer_portfolio_images.image_url` ≤ 2048 且必須以 `storage_path` 結尾、`admins` 的 display_name／avatar_url、`audit_log` 見 0019／0028）；`closed_dates`、`designer_leaves`、`designer_services`、`business_hours`、`booking_policy` 沒有自由文字欄位。`customers.name/phone/email/notes` 與 `appointments` 屬匿名可寫路徑，不在本卡。
    **安全審查更正（2026-11-01）：** 原先寫「`designers` 各欄都有限制」「services／store_settings 是 Demo 文字欄位僅剩的缺口」「其餘歸 TASK-120／121」都不正確——`designers.name` 的 CHECK 只限制 btrim 後長度（原值可用前後空白無限填充）；TASK-120／121 只處理寄信計數視窗與提醒信，沒有欄位長度內容；`auth.users.raw_user_meta_data` 也未鎖。見 verification/TASK-123.md「審查結論與處置」。本卡範圍不變（`designers` 屬「不得觸碰」，需使用者另外核准）。
  - **真實庫現況（唯讀量測，2026-11-01）：** services 4 列，name 最長 4 字元、description 最長 78；store_settings 1 列，name 6、address 14、logo_url 124、cover_image_url 125。`seed-base.json`：name 最長 4、description 78、store name 6、address 14、兩個 URL 124／125。全部遠低於上限，套用不會失敗，每日還原寫回也不會被擋。
  - 前端寫入前都先 `trim()`；DB 的 CHECK 看的是儲存值，所以前端驗證以 trim 後的碼點數計算才與 DB 一致。`char_length` 計碼點，前端用 `Array.from(...).length`（比照 `lib/designers.ts`）。
  - `logo_url`／`cover_image_url` 只由 `uploadStoreImage` 以 `getPublicUrl` 產生（約 125 字元），沒有使用者輸入的 UI，所以只需要 DB 上限，不需要前端驗證。
- 假設：CHECK 對所有角色一視同仁（不是只擋 Demo）——正常使用的值都遠低於上限，行為不變；這也讓 REST 直接 PATCH 的任何人都受限。
- 未知事項：無。
- 允許變更的檔案：
  - `supabase/migrations/0029_text_length_checks.sql` 與 `0029_text_length_checks_down.sql`
  - `lib/admin/services.ts`、`lib/store-settings.ts`（新增上限常數與驗證函式）
  - `app/admin/_components/ServiceFormDialog.tsx`、`app/admin/_components/StoreSettingsForm.tsx`（只接上驗證與既有錯誤顯示樣式，不新增視覺元素）
  - `tests/admin/services.test.ts`、`tests/store-settings.test.ts`、`tests/components/service-form-dialog.test.tsx`、`tests/components/store-settings-form.test.tsx`（補案例）
  - `tests/lib/text-length-checks-migration.test.ts`、`tests/text-length-checks.integration.test.ts`、`vitest.text-length-checks.config.ts`、`package.json`（`test:text-length`）
  - `ai/artifacts/Demo 體驗帳戶/verification/TASK-123.md`、`TASK-123-snapshot.mjs`（套用前後唯讀雜湊）、`TASK-123-pglite-rehearsal.mjs`（可重跑的演練）
  - `ai/context/decisions.md`、`ai/context/project-map.md`、`docs/demo-account.md`、`ai/artifacts/Demo 體驗帳戶/architecture-notes.md`（D14 補一句）
- 不得觸碰：每日還原函式、既有 migration、`seed-base.json`、`designers` 與其他表的 CHECK、RLS policy／grant。

## 需求

- 六個 CHECK（`char_length`，字元數）：

  | 欄位 | 上限 | constraint 名稱 |
  |---|---|---|
  | `services.name` | 60 | `services_name_length` |
  | `services.description` | 500 | `services_description_length` |
  | `store_settings.name` | 200 | `store_settings_name_length` |
  | `store_settings.address` | 200 | `store_settings_address_length` |
  | `store_settings.logo_url` | 2048 | `store_settings_logo_url_length` |
  | `store_settings.cover_image_url` | 2048 | `store_settings_cover_image_url_length` |

  可為 null 的欄位用 `char_length(coalesce(col, '')) <= N`（比照 0006）。只加上限，不加下限、不加「非空白」（`store_settings.name` 的 seed 列本來就是空字串；services.name 的必填由前端把關，維持現狀）。
- migration 套用前先檢查既有資料：有任何一列超過就以明確訊息中止（列出表、欄位、最大長度），不留下半套。
- 前端：`validateServiceName` 增加長度檢查（trim 後 > 60 回「名稱長度須在 60 字以內」）；新增 `validateServiceDescription`（> 500 回「描述長度須在 500 字以內」）；`validateStoreName` 增加長度檢查；新增 `validateStoreAddress`。表單送出前擋下並以既有錯誤樣式顯示。上限常數為單一來源並匯出，單元測試比對常數與 migration 內的數字一致。
- 可重複執行（drop constraint if exists 後重建）、`_down.sql`、尾端自我檢查、緊急停用說明。

## 驗收標準

- 套用後，以 service role 與店長帳號（authenticated，經 RLS）直接 PATCH／insert（店長路徑涵蓋 services.name 與 store_settings.name；六欄位的完整邊界以 service role 驗證，CHECK 與角色無關）：恰好等於上限的值成功，上限 + 1 以 `23514`（check violation）拒絕且指名對應 constraint，資料不變。六個欄位皆驗證。
- 多位元組字元以碼點計：60 個全形字成功、61 個失敗（不是以位元組或 UTF-16 單位）。
- off 模式（未套用 0029 或 `_down` 後）：上限 + 1 的值可寫入；每個「套用後被擋」的斷言在 off 模式都有對應的「沒被擋」斷言。
- 既有資料與 Demo 種子（`seed-base.json`）全部符合上限（單元測試固定這件事，之後改種子超過上限會在測試就失敗，而不是等到還原失敗）。
- 前端：服務表單名稱 61 字／描述 501 字、商店設定店名 201 字／地址 201 字，送出被擋並顯示對應文案，不呼叫寫入；上限邊界值可正常送出。
- 回歸：`test:services`、`test:store-settings`、`test:demo-reset`（dry-run）、`test:demo-row-caps`、`test:audit-log`、`npx vitest run tests/lib`、`tests/admin`、`tests/components` 相關檔案仍通過。
- 套用前後 services／store_settings 的既有資料不變。
- migration 可重複執行；`_down` 後行為恢復。

## 實作備註

- 兩張表都只有個位數列，`add constraint` 的全表驗證與鎖定可忽略；仍在 SQL Editor 單一交易內完成。
- 上限數字在 SQL 與前端各一份（資料庫是最終防線、前端是體驗優化），以單元測試比對防止漂移。
- 錯誤訊息：資料庫的 `23514` 在前端仍走既有的通用「操作失敗」文案；前端驗證先行擋下，所以一般使用者不會看到；Demo 或直接打 REST 的人才會遇到。
- 不使用 `NOT VALID`：既有資料已量測全數符合，要的是完整驗證。

## 驗證契約

- 單元測試：`tests/lib/text-length-checks-migration.test.ts`（檔案內容把關：六個 constraint 的欄位／上限／名稱、前置資料檢查、自我檢查、`_down`、前端常數與 SQL 一致、種子資料符合上限）；`tests/admin/services.test.ts`、`tests/store-settings.test.ts` 補驗證函式案例。
- 元件測試：`tests/components/service-form-dialog.test.tsx`、`store-settings-form.test.tsx` 補長度被擋案例。
- 整合測試：`npm run test:text-length`（真實庫；on／off 兩種模式；21 項；store_settings 快照並於結束還原；含店長身分案例）。
- 套用前後「既有資料不變」：`TASK-123-snapshot.mjs` 兩次輸出的列數與雜湊相同。
- 套用後 constraint 狀態：`pg_constraint` 查詢（語句見 0029 檔頭），預期 6 列皆已驗證。
- 套用後回歸（依序執行，不可並行，因為都會動 store_settings 單例）：`test:store-settings`、`test:services`、`test:demo-reset`、`test:demo-row-caps`、`test:audit-log`、`test:demo-audit-cap`。
- 型別檢查：`npx tsc --noEmit` 無錯誤
- Lint：`npm run lint` 無錯誤
- Build：`npm run build` 成功
- 螢幕截圖：不適用（沒有新增視覺元素，只接上既有錯誤顯示；以元件測試驗證）
- 安全性檢查：三方審查（架構、安全、測試）；確認六欄位涵蓋 Demo 可寫的文字欄位、碼點計算、不影響每日還原與非 Demo 路徑。

## 審查關卡

高風險：architect、security-reviewer、test-engineer 三方審查（子代理意見不等同人工核准）。

## 完成證據

完整證據見 [`verification/TASK-123.md`](../verification/TASK-123.md)：套用後整合測試 21/21、六項回歸通過、資料雜湊不變、約束查詢 6 列已驗證、回滾實測（_down 後 off 21/21、重套後 on 21/21）。
