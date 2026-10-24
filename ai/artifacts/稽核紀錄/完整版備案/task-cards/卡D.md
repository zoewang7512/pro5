# AI-Ready 任務卡

## Metadata

- 任務：稽核紀錄 預約異動（`0021_audit_appointments`：`appointments` INSERT／UPDATE／DELETE 稽核 trigger）
- 上層規格：[`feature-spec.md`](../feature-spec.md)、[`architecture-notes.md`](../architecture-notes.md)（§2、§4、§5、§7、§8）
- 上層 Epic：稽核紀錄
- 上層 User Story：記錄預約異動
- 分軌：後端
- 前置任務（dependsOn）：TASK-086
- 狀態：草稿（前置任務完成後才可就緒）
- 風險等級：高（掛在顧客端唯一的預約寫入路徑 `create_appointment` 上，fail-closed）
- Agent owner：Claude Code
- 人工核准者：使用者（2026-10-23）

## 目標

預約被建立、完成、取消、改期、改狀態、改派、刪除時，自動留下不含顧客個資的稽核列；顧客預約流程的回應與行為與套用前完全一致。

## 情境包（Context Pack）

- 相關檔案：`supabase/migrations/0018_designer_aware_booking.sql`（`create_appointment`：巢狀 `exception` 只接 `exclusion_violation`／`deadlock_detected`，外層 `when others`→`INTERNAL_ERROR`）、`0011`／`0012`（既有 webhook trigger 與 WHEN 語法教訓）、`lib/admin/appointments.ts`、`tests/booking.integration.test.ts`、`tests/admin-booking.integration.test.ts`、`tests/notifications.integration.test.ts`、`tests/helpers/designer-fixture.ts`。
- 既有模式：同 TASK-084／086；webhook trigger 命名 `appointments_notify_*`，本卡 trigger 命名 `audit_appointments_ins／upd／del`（字母序先於 notify，兩者無依賴）。
- 假設：TASK-086 通過決策關卡；`AUDIT_TEST_SECRET` 已設定；所有會寫入 `appointments` 的整合套件已改用工廠（TASK-085）。
- 未知事項：套用前 `create_appointment` 各回應的完整鍵集合（動工前先跑 `test:booking` 錄製基準）。
- 允許變更的檔案：
  - `supabase/migrations/0021_audit_appointments.sql`、`0021_audit_appointments_down.sql`（新增；`down` 即「緊急止血」：只 drop `appointments` 上的 `audit_` trigger，設 `lock_timeout`，檔頭註明）
  - `supabase/verify/0021_audit_appointments_verify.sql`（失敗注入、`pg_trigger` 比對 `appointments_notify_*` 的 WHEN 與 0011／0012 一致、`down` 演練）
  - `tests/audit-log.integration.test.ts`（新增本卡的 describe 區塊）
  - 若既有套件對 `appointments` 的清理需補掛鉤，僅限 client／清理呼叫行（斷言不變）
- 不得觸碰：`0011`／`0012` 及其 trigger 函式與 WHEN 條件、`create_appointment` 函式本體、`lib/`、`app/`。

## 需求

- 事件與欄位依架構筆記 §4：`appointment.created`、`completed`、`cancelled`、`rescheduled`、`status_changed`、`reassigned`、`deleted`。summary 含 `appointment_id`、`service_id`、`service_name`、`designer_id`、`designer_name`、`start_at`、`end_at`（名稱截斷 60 字、時間為明確 UTC 字串）；changes 為追蹤欄位的 `{from,to}`。
- trigger 函式為 `security definer`＋`set search_path = ''`，**直接** `jsonb_build_object(...)` 取白名單欄位，不得 `to_jsonb(old/new)`；UPDATE 的 `WHEN` 為 `status`／`start_at`／`end_at`／`designer_id`／`service_id` 任一 `IS DISTINCT FROM`。
- 操作者：`appointment.created` 依 §2 特例（`customer`／`system`，`actor_user_id` null）；其餘事件依一般規則。
- 同次 UPDATE 改多種欄位時各記一筆，順序為狀態類、改期、改派。
- `reminder_sent_at`、`confirmation_sent_at`、`updated_at`、`customer_*` 更新不產生列，也不進 trigger 函式。
- fail-closed：稽核失敗使原操作回滾（`AUD01`）；`create_appointment` 此時回 `INTERNAL_ERROR` 且不留 `customers` 孤兒列。
- 既有 `appointments_notify_insert`／`appointments_notify_update` 的條件與 payload 不得改變。

## 驗收標準

- 套用前先跑 `test:booking`，錄下成功與 `SLOT_CONFLICT`、`BOOKING_LIMIT_EXCEEDED`、`SERVICE_INACTIVE` 的完整鍵集合；套用後以**嚴格鍵集合斷言**證明一致。
- 稽核列數：成功恰 1 筆 `appointment.created`；`SLOT_CONFLICT`／`BOOKING_LIMIT_EXCEEDED`／`SERVICE_INACTIVE` 為 0 筆；併發（多輪）勝者恰 1 筆、輸家 0 筆（以實體鍵查，不用全表計數）。
- 三種呼叫身分：anon RPC→`customer`＋null；已登入店長 session 呼叫 `create_appointment`→`customer`＋null；service_role→`system`。
- 狀態類邊界：`pending→confirmed`、`cancelled→pending` 為 `status_changed`；只改 `end_at` 為 `rescheduled`；已取消再取消（0 列更新）0 筆；同次改狀態與時間為 2 筆且順序正確。
- 個資掃描三層（植入針含 `access_token`、事件目錄鍵白名單、全表 regex）通過。
- 失敗注入腳本：稽核失敗時預約取消／建立被回滾、`create_appointment` 回 `INTERNAL_ERROR`、無 `customers` 孤兒列。
- `test:notifications` 套用前後各跑一次輸出一致；既有掛上的套件（`booking`、`admin-booking`、`notifications`、`rls`、`mfa-rls`、`designers`）全數通過，執行時間記錄在案（確認遠低於 testTimeout／hookTimeout）；稽核殘留為 0。
- `0021_down` 在交易內演練後 rollback，證明 `create_appointment` 與取消仍可用。

## 實作備註

- 套用順序：本機完成 → 貼 SQL Editor 套用 `0021` → `notify pgrst` → **立即人工 smoke**（店長取消一筆測試預約、顧客端建立一筆預約，各一筆記錄）→ 跑回歸套件。套用期間不跑整合測試。
- 整合測試建立預約時 `customer_email` 一律先 null 再補（避免觸發寄信 webhook），沿用 TASK-068 的既有做法。
- 緊急情況：先執行 `0021_down`，不要動 `0019`。

## 驗證契約

- 單元測試：`npm test`。
- 整合測試：`npm run test:audit-log`（本卡區塊）＋ `test:booking`、`test:admin-booking`、`test:notifications`、`test:rls`、`test:mfa-rls`、`test:designers` 重跑。
- E2E 測試：不適用。
- 型別檢查：`npx tsc --noEmit`；Lint：`npm run lint`；Build：`npm run build`。
- 螢幕截圖：不適用。
- 安全性檢查：security-reviewer 複審個資白名單與 definer 函式；test-engineer 複審回歸證據。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：不適用
- 已知限制：
- 後續任務：TASK-092
