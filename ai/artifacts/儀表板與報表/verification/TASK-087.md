# 驗證報告

## 摘要

- 任務：TASK-087 儀表板與報表 預約價格快照（`0020_appointment_price_snapshot`、`tests/reports.integration.test.ts`、`test:reports`、`decisions.md`）
- 結果：**通過**（使用者已於 2026-10-25 在正式環境套用 `0020`；整合測試與五個回歸套件皆通過）
- 驗證者：實作 agent（Claude Code）。product／ui 關卡已由使用者核准規格書與 mockup；security 關卡：security-reviewer 已於套用前複審 `0020`（無 Critical／High，三項建議已採納）。architecture／test／code_review 關卡與人工驗收待使用者。

## 套用過程（使用者於 Supabase SQL Editor 執行）

| 步驟 | 結果 |
|---|---|
| 套用前清點 `appointments` 的 trigger | 只有 `appointments_notify_insert`、`appointments_notify_update`、`appointments_set_updated_at` 三筆，`tgenabled` 皆為 `O`，與預期一致；`notify_update` 的 WHEN 條件只看狀態轉取消、`start_at`／`end_at` 變動與 email，不含價格欄位 |
| 執行 `0020`（整份、單一交易） | 成功，沒有鎖逾時 |
| 套用後 `select count(*) filter (where price_at_booking is null), count(*) from appointments` | `null_rows = 0`、`total = 16` |
| 套用後 trigger 清點 | 四筆（原三個＋`appointments_set_price_snapshot`），皆為 `O`（回補期間停用的 trigger 已正確還原） |

## 指令

| 指令 | 結果 | 備註 |
|---|---|---|
| `npx tsc --noEmit` | 通過 | 0 錯誤 |
| `npm run lint` | 通過 | 0 error、0 warning |
| `npm run build` | 通過 | |
| `npm run test:reports` | **11 項全數通過** | 本卡新增；快照寫入 5、權限矩陣 5、顧客端 RPC 1 |
| `npm run test:booking` 回歸 | 23 項全數通過 | 新增 BEFORE INSERT trigger 後 `create_appointment` 行為不變 |
| `npm run test:admin-booking` 回歸 | 16 項全數通過 | 標記完成／取消／改期仍正常 |
| `npm run test:rls` 回歸 | 18 項全數通過 | 既有權限未受影響 |
| `npm run test:designers` 回歸 | 122 項全數通過 | |
| `npm run test:notifications` 回歸 | 20 項全數通過 | 該套件對 Resend 全程 mock，且先以空 email 建立再單獨補 email，不會觸發真實 webhook；輸出中的 `SEND_FAILED` 是刻意模擬的寄信失敗案例 |
| `npx vitest run --maxWorkers=3`（全套單元測試） | **78 檔／1357 項全數通過** | 見下方「審查發現」第 1 項 |
| 測試資料殘留檢查（service_role 查詢） | 通過 | 跑完整合測試後 `appointments` 仍 16 筆、無 `__TEST__` 預約／服務／設計師／顧客；`audit_log` 無本測試的紀錄；`price_at_booking` 無 null |

## 整合測試涵蓋（`tests/reports.integration.test.ts`，真實 Supabase）

- 新增預約自動帶入服務當下價格（100）。
- 服務改價（100→150）後：既有預約快照不變（100）；新預約帶新價格（150）。
- 呼叫端帶入 `price_at_booking: 999` 被覆寫為服務價格（150）。
- `service_id` 不存在時仍得到外鍵錯誤 `23503`（保留原錯誤語意）。
- `service_role` 可直接改快照（供後續彙總測試造資料）。
- 店長讀得到該欄且與資料庫一致；店長 update 該欄被拒（`42501`）且資料不變；店長仍可 update `status` 且不重算快照。
- anon 讀該欄被拒（`42501`）；非店長登入者讀得到空結果（先以 service_role 確認底下有 ≥3 筆資料）。
- 顧客端 `get_available_slots`／`create_appointment` 的回傳不含 `price_at_booking`；經 RPC 建立的預約快照等於當下服務價格（150）。
- 安全規則：測試預約一律 `customer_email = null`、`__TEST__` 名稱、結尾只做 `scope: "local"` 登出（不踢掉瀏覽器登入）。

## UI 證據

不適用（本卡為純資料庫與測試變更，沒有畫面）。

## 審查發現

| 發現 | 嚴重程度 | 狀態 |
|---|---|---|
| 1. 全套單元測試在預設並行度下出現不穩定失敗：第一次 13 項、第二次約 25 項，失敗的測試每次不同（`account-settings-view`、`login-form`、`designer-basic-info-form` 等 UI 元件測試）。單獨重跑這些檔案、或用 `--maxWorkers=3` 跑全套皆全數通過；暫存清乾淨的原始樹上同樣檔案也通過。本卡沒有改動任何元件或 `lib/`，判斷為既有的並行負載不穩定（與先前 Epic 記錄的 `designer-portfolio-tab` 同類） | 低 | 已確認非本卡造成；建議日後把預設 `maxWorkers` 降低或為 UI 測試加大逾時，另立任務 |
| 2. security-reviewer 複審：Medium——缺 `lock_timeout`；Low——trigger function 只對 public 收回 execute；Low——套用前應先清點 trigger | Medium／Low | 已採納並修正（`set local lock_timeout = '5s'`＋明確 `lock table`、revoke from public/anon/authenticated、套用前清點；down 檔同樣處理） |
| 3. 資訊：`tgenabled = 'A'`（ENABLE ALWAYS）的 trigger 不會被回補停用——正式資料庫實際為 `O`，不受影響 | 資訊 | 不需處理 |
| 4. 審查建議確認 `appointments` 是否在 `supabase_realtime` publication（新欄位會出現在推送內容） | 資訊 | 專案前端沒有使用 realtime；未另外查詢 |

## 殘留風險

- 既有預約的快照是**回補當下的服務價格**（近似值）：套用前已改過價的服務，其舊預約的歷史營收無法還原。目前 16 筆預約，影響有限；已記錄於 `decisions.md` 與規格書非目標。
- `UPDATE` 不重算快照（改期、改狀態不改價）；日後若新增「改派／改服務」功能，需另行決定是否重算。
- 套用的 `0020` 含 `disable/enable trigger`，只在 SQL Editor（資料表擁有者）可執行；若日後從其他環境重建資料庫需照同樣方式套用。
- 若 `0020` 之後又有 migration 調整 `price_at_booking` 的授權，不要重跑 `0020`（重跑會還原授權）。
