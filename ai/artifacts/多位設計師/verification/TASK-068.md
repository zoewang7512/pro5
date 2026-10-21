# 驗證報告

## 摘要

- 任務：TASK-068 多位設計師 依設計師計算時段與建立預約（`0018`：exclusion constraint 依設計師、
  `get_available_slots`／`create_appointment` 加 `p_designer_id` 與自動指派、同 email 上限）
- 結果：**通過，但有數項證據尚未取得**（見「尚未驗證」；重跑冪等與套用後 `proacl` 已於 2026-10-22 補上）。這張卡是高風險、改寫顧客端唯一的預約路徑，請人工驗收時
  特別看「尚未驗證」與「待人工決定」兩節。
- 驗證者：實作 agent（Claude Code）。architect、security-reviewer（套用前）與 test-engineer（套用後）三份審查意見
  **不等同人工核准**；security／test／code_review 關卡待人工核准。

## 指令與結果

| 指令 | 結果 | 備註 |
|---|---|---|
| `npx tsc --noEmit`、`npm run lint`、`npm run build` | 通過 | |
| `npm test` | 通過 | 48 檔 552 項（本卡新增 `tests/booking/api.test.ts` 的 3 項：`p_designer_id` 為 null／有值、`designer_name` 回傳） |
| `npm run test:designers`（0018 套用後） | 通過 | 首次 66 項；採納 test-engineer 意見補強後 **75 項** |
| 10 套既有整合測試回歸（**0017 狀態、改完 fixture 後**，套用 0018 之前） | 通過 | rls 18、booking 23、admin-booking 13、business-hours 33、store-settings 11、booking-policy 7、services 17、account 17、mfa-rls 20、notifications 19 |
| 10 套既有整合測試回歸（**0018 套用後**，審查補強後再跑一次） | 通過 | **數量與套用前完全相同**：18／23／13／33／11／7／17／17／20／19。`git diff -U0` 確認七個被改動的檔案新增行沒有任何 `expect`／`it(`／`describe(`，只改 fixture（建立設計師、補 `designer_id`、清除、`beforeAll` 逾時）；`booking-policy`、`store-settings`、`account` 三套沒有修改 |
| 併發案例（`-t "併發｜同時送出"`，含 8 筆壓力案例）重複 10 次 | 10／10 通過 | 沒有任何 `INTERNAL_ERROR`，也沒有孤兒 `customers` |
| 套用前 RPC 授權基準（使用者在 SQL Editor 執行 `pg_proc.proacl`） | `postgres`、`anon`、`authenticated`、`service_role` 皆有 execute | 兩支 RPC 皆為 `security definer`、`search_path = ""`；同時用 REST 實測三個角色都能呼叫兩支 RPC |
| **前台既有流程人工走查**（2026-10-22，使用者授權；本機 dev server 連正式資料庫，用 Browser 實際操作） | 通過 | 選「剪髮造型」→ 選 11/04 → 15:00 → 填姓名 `__TEST__走查`、假電話、Email 留空 → 送出，顯示「預約成功」（服務、時段、姓名、電話皆正確）。讀回資料庫：預約 `status = pending`、`customer_email = null`、時間 15:00～15:45（台北）、**指派給預設設計師**（唯一合格者）。走查後立即刪除該筆預約與顧客，刪除後預約仍為 16 筆、無任何 `__TEST__` 殘留。注意：本機前台是這個分支的**新**程式碼（`p_designer_id` 一律送 null）；尚未部署的 master 舊前端（完全不傳該參數）相容性由整合測試涵蓋（helper 省略該參數的案例，PostgREST 具名參數與預設值相容），沒有另外用舊前端實際操作 |
| **`0018` 重跑**（使用者於 SQL Editor 整份再貼一次，2026-10-22） | `Success. No rows returned` | 冪等實測：回填沒有 null 可補、constraint 與函式重建、授權維持；重跑後 `test:designers` 75 項與 10 套既有整合測試（18／23／13／33／11／7／17／17／20／19）再跑一次全數通過 |
| **套用後 `pg_proc.proacl`**（重跑後查得） | 與套用前一致 | `create_appointment(uuid,timestamptz,text,text,text,uuid)` 與 `get_available_slots(uuid,date,uuid)`：`postgres`、`anon`、`authenticated`、`service_role` 皆有 execute，`security definer`、`search_path=""`，與套用前基準相同；`_designer_is_eligible`、`_designer_is_free`、`_email_dedupe_key`：只有 `postgres`、`service_role`，**沒有 `anon` 與 `authenticated`**，`security invoker`、`search_path=""` |
| 套用後行為層授權 | 與套用前一致 | anon、authenticated（店長 session）、service_role 都能呼叫兩支 RPC；anon、authenticated 呼叫兩支內部函式得到 42501（不是 PGRST202，證明函式存在且被擋） |
| 正式資料庫唯讀查詢（每輪測試後） | 乾淨 | 只有 1 位預設設計師；16 筆預約 `designer_id` 皆非 null；沒有 `__TEST__` 服務／顧客／預約／帳號；沒有帶 `.invalid` email 的預約；`booking_policy.min_lead_time_hours` 為 1、`closed_dates` 只有 2026-08-17（皆與測試前相同） |

## 測試涵蓋（新增，`tests/designers.integration.test.ts` 的「依設計師計算時段與建立預約（0018）」）

- 兩位設計師同時段各一筆；同一位第二筆 `SLOT_CONFLICT`；成功時回傳實際指派的設計師，並讀回資料列逐欄比對
  （`designer_id`、設計師名稱、時間、顧客、狀態）。
- 資料庫層級：同一位設計師同時段 `23P01`（含 constraint 名稱）、不同設計師可以、已取消不佔用、`designer_id` 不可為 null（`23502`）。
- 指定設計師「不存在／停用／沒開服務／請假／時段被佔」：時段空陣列、建立預約回傳 JSON 完全相同；90 天外一律
  `VALIDATION_ERROR`（合格與不合格相同）。
- 不指定：時段聯集、指定只看該設計師、回應只有 `start_at`／`end_at`；**候選名單含不合格設計師**（sort_order 最小的
  停用、沒開服務、請假者）時不會被指派、聯集不含他們獨有的時段、請假只擋請假那一天；全部不合格時空陣列與
  `SLOT_CONFLICT`。
- 自動指派：當天有效預約數 → sort_order（已取消與已完成不計入）→ id（建立順序刻意與 id 順序相反，確定性案例）。
- 併發：兩筆（兩位候選）都成功且分屬不同設計師；三筆（兩位候選）恰好兩筆成功、第三筆 `SLOT_CONFLICT`、無孤兒
  `customers`；**8 筆（三位候選）恰好 3 筆成功、5 筆 `SLOT_CONFLICT`、零 `INTERNAL_ERROR`**。
- 與既有規則交叉（指定與不指定兩種模式）：特殊公休日、每週固定公休（含對照組，證明空陣列是因為公休而不是超出視野）、
  營業時間邊界、提前量、buffer（含反方向、貼齊邊界、不指定時第一順位被 buffer 擋住改派、45 分鐘＋30 分鐘 buffer 依序
  建立、跨服務 buffer）、「只有一位設計師時列出的每個時段都建得起來」。
- BOOKING_LIMIT：電話跨設計師合計、電話併發（5 筆恰好 3 筆成功，驗證 advisory lock）、**檢查順序特徵化**（已達上限的電話
  去約被佔的時段得到 `SLOT_CONFLICT`）；email 上限（大小寫、前後空白、`+標籤`、網域結尾的點視為同一個；跨設計師與
  `confirmed` 也計入；不指定模式同樣受限；未填 email 不受影響；已取消與已過期不計入；不同 email 不被誤判）。
- 權限：anon／authenticated／service_role 皆可呼叫兩支 RPC；anon、authenticated 不能呼叫內部函式（42501）。

## 審查發現與處理

**architect（套用前，Request changes，無 Blocker）**：M1 巢狀 handler 沒接 `deadlock_detected`（兩筆同時 insert 同一位設計師時
exclusion 檢查可能死結，犧牲者會被吞成 `INTERNAL_ERROR`，破壞改派保證）、M2 鎖先取 share row exclusive 再升級會與進行中的
舊 RPC 死結且沒有 `lock_timeout`、M3 `service_role` execute 權限靠 default privileges。**全部採納**；m1（down 先鎖表）採納；
m2（套用瞬間進行中的預約可能失敗）、m3（第 90 天邊界）、m4～m6（檢查順序差異、TOCTOU）列為殘留並寫入 `decisions.md`。

**security-reviewer（套用前，無 Critical／High）**：M1 email 上限可被同時送出與正規化不足繞過 → 加 advisory lock（先電話、後
email）與 `_email_dedupe_key` 正規化；M2 同架構 M2；M3 套用後舊後台新增的服務沒有設計師 → 套用前檢查「上架中服務都必須
有啟用中設計師」否則 migration 失敗。L1（grant 三角色）、L9（`when others` 記錄 sqlstate）、L5（down 鎖表）採納；L2／L6／L7／
L10 寫入 `decisions.md`；L3（前台文案）超出本卡允許範圍，留給 TASK-073；email 限制只收 ASCII 未採納（會擋掉國際化網域，
待人工決定）。

**test-engineer（套用後）**：已處理 H1（不指定含不合格設計師）、H2 的壓力案例部分、M2（id 層級確定性案例）、M3（公休日
改在視野內並加對照組、`pickOpenDay` 防呆）、M4（跨設計師、`confirmed`、不指定、不同 email 不誤判）、M5（buffer 改派、
45＋30、跨服務）、M6（讀回資料列）、M7（`cleanupTestDesigners` 拒絕清除非測試設計師、booking／rls 的 afterAll 不跳過
後面的清除）、M8（提前量案例還原失敗時重試並帶出原始值）、L1（營業時窗防呆改 270 分鐘）、L2（標題不過度宣稱）、L3（檢查順序
特徵化）、L5（過時註解）。其餘見下節。

## 尚未驗證（人工驗收前請確認接受，或指示補做）

1. ~~`0018` 重跑冪等~~ **已補證據（2026-10-22）**：使用者整份重跑，結果 `Success`，重跑後全部測試再跑一次通過（見上表）。注意重跑時沒有任何跨設計師預約，也沒有驗證「重跑不會改動店長之後自行調整的設定」，因為 0018 不碰設定類資料。
2. **`0018_down` 未實跑**：只做了靜態比對（還原的兩支函式本體與 0009／0014 逐行一致）；「跨設計師同時段預約會中止並提示」
   的分支也沒測。需要拋棄式環境（Supabase branch 或本機 Postgres）。在正式庫跑 down 會刪除多位設計師資料，不建議。
3. ~~套用後 `pg_proc.proacl` 輸出~~ **已補證據（2026-10-22）**：見上表，與套用前一致，內部函式 `anon`／`authenticated` 皆無 execute。
4. **`explain analyze`**：任務卡要求，未取得（只能透過 REST，無法執行 `explain`）。目前只有耗時記錄：3 位設計師的「不指定」
   時段查詢約 160～170 ms（含網路往返）。正式庫只有 16 筆預約，planner 一定是全表掃描，這個數字不能推論規模化後的表現；
   email 計數條件（`_email_dedupe_key(customer_email) = key`）用不到索引，資料量成長後需要補運算式索引。
5. **併發競爭路徑沒有確定性證據**：沒有資料庫連線字串，無法用兩個 session 手動製造「A 未 commit、B 同時 insert」。目前的證據
   是壓力案例（8 筆並行）加重複 10 次全過、零 `INTERNAL_ERROR`；`deadlock_detected` 分支是否曾被實際觸發沒有證據。
6. **`scripts/seed-booking-data.mjs` 的改動未實跑**：只做了 `node --check`。它會用 seed 預設值 upsert `business_hours`，在
   正式庫跑會覆寫真實營業時間，所以沒有執行。
7. ~~前台既有流程人工走查~~ **已補證據（2026-10-22）**：見上表。仍未用「尚未部署的 master 舊前端」實際操作（本機跑的是新程式碼）。
8. **Resend 對 `.invalid` email 的處理**：新測試有 1 個案例（`emailok`）經 RPC 真的成立一筆帶 `@example.invalid` email 的預約，
   既有 `booking.integration` 另有 1 個先例。預期 Resend 於 API 層拒絕、不會真的寄出，但沒有在 Resend 後台確認。
9. **email 上限的併發**未測（會經 RPC 寫入多筆帶 email 的預約而觸發 webhook）；電話併發已測。
10. **既有已知限制**（寫入 `decisions.md`，不在本卡修）：第 90 天晚於「現在時刻」的時段會被列出、建立時被視野上限拒絕；exclusion
    constraint 不含 buffer；候選清單算完後設計師被停用或新增請假仍可能成立；`BOOKING_LIMIT` 在候選清單之後檢查，已達上限的電話約
    被佔時段得到 `SLOT_CONFLICT`；指定模式可逐一推算各設計師忙碌程度；沒有限流。

## 與任務卡的差異

- **允許變更的檔案之外**：`tests/mfa-rls.integration.test.ts`（它直接 insert `appointments`，`designer_id` 改 not null 後必須補）；
  `tests/booking-policy.integration.test.ts` 不需要修改（沒有用到預約或預約 RPC）。
- **範圍擴大（審查採納）**：email 正規化與 advisory lock、套用前檢查上架中服務都有設計師、`when others` 記錄 sqlstate、
  `_email_dedupe_key`、fixture 的殘留自動清理與非測試設計師拒絕清除。
- **`getAvailableSlots`／`createAppointment` 一律送出 `p_designer_id`（含 null）**：必須先套用 0018 再合併 master，否則舊資料庫會回
  `PGRST202`。部署順序與 0018 套用到合併之間「不要在後台新增服務」已寫入 0018 檔頭與 `decisions.md`。
- 任務卡「驗證契約」的「`designer_name` 解析」實際上只是原樣透傳（沒有解析邏輯），單元測試驗證透傳。

## 待人工決定

- ~~套用後到合併 master 之間，是否接受「舊後台新增的服務沒有設計師」的空窗~~ **已決定（人工 2026-10-22）**：接受這個空窗，期間不要在後台新增服務；只有文件提醒（0018 檔頭、`decisions.md`），不加程式碼防護。
- ~~email 欄位是否只收 ASCII~~ **已決定（人工 2026-10-22）**：先不做。
- `explain analyze`、`0018_down`、`seed-booking-data.mjs` 是否要在拋棄式環境補驗證，或先接受為殘留。
- 前台 `BOOKING_LIMIT_EXCEEDED` 文案（寫「這支電話…」）是否在 TASK-073 一併改成「電話或 Email」。

## 後續任務

TASK-073（前台串接，含文案）、TASK-075（後台改期仍以全店已佔用範圍計算可選時段，比資料庫更保守，需改成依原設計師）、
TASK-076（通知信顯示設計師）。

## 人工核准

- 待人工驗收。
