# AI-Ready 任務卡

## Metadata

- 任務：Email 通知與提醒 取消／改期時寄送通知信
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：Email 通知與提醒
- 上層 User Story：取消／改期時寄送通知信
- 分軌：後端
- 前置任務（dependsOn）：TASK-051
- 狀態：完成（人工已於 2026-08-24 驗收通過）。architect／security-reviewer／
  test-engineer 三方審查皆已完成、發現皆已修正；真實 Supabase 環境的端對端
  驗證亦已完成（取消信／改期信皆確認收到）。殘留風險（節流機制、狀態預言機等
  非阻斷項）見「完成證據」的「已知限制」段落。
- 風險等級：高（同一 webhook 端點的另一分支，需正確區分「取消」與「改期」兩種
  `UPDATE` 情境並各自寄送對應內容，判斷邏輯錯誤可能寄出錯誤的通知信誤導顧客；需
  架構、安全性、測試三方審查）

## 目標

在 `/api/webhooks/appointment-events`（TASK-052 建立）新增處理 `UPDATE` 事件的分支：
比對 `old_record` 與 `record` 判斷這次異動是取消（`status` 變為 `cancelled`）還是
改期（`start_at`／`end_at` 變更），寄送對應的通知信。

## 情境包（Context Pack）

- 相關檔案：
  - `app/api/webhooks/appointment-events/route.ts`（TASK-052 建立，本卡新增 `type
    === "UPDATE"` 的處理分支，與 `INSERT` 分支各自獨立的處理函式，不共用可變狀態）。
  - `lib/admin/appointments.ts`：既有 `markAppointmentCompleted`／`cancelAppointment`／
    `rescheduleAppointment` 的既有寫法，確認這些既有函式對 `appointments` 的
    `update` 操作會正確觸發 Database Webhook 的 `UPDATE` 事件（Supabase Database
    Webhook 對任何 `update` 語句皆會觸發，不論是透過這幾支既有函式或未來「顧客自助
    查詢／取消預約」Epic 的新函式）。
- 既有模式：
  - `lib/email/format.ts`（TASK-051）的時間格式化函式，本卡的改期通知信需要同時
    顯示「原時段」與「新時段」，用 `old_record.start_at` 與 `record.start_at` 分別
    格式化。
- 假設：
  - 判斷邏輯：`old_record.status !== 'cancelled' && record.status === 'cancelled'`
    → 觸發取消通知信；`record.status !== 'cancelled' && (old_record.start_at !==
    record.start_at || old_record.end_at !== record.end_at)` → 觸發改期通知信；
    兩個條件互斥（取消的預約不會同時被視為改期，即使改期又取消也只會在各自的
    `update` 呼叫觸發當下事件各自判斷，不會有同一次 `UPDATE` 事件同時滿足兩個條件的
    情況，因為現有 `cancelAppointment`／`rescheduleAppointment` 是各自獨立的
    `update` 呼叫）。
  - `markAppointmentCompleted`（標記完成）的 `UPDATE` 事件**不**觸發任何通知信（不
    在本 Epic 三個 User Story 範圍內，需在判斷邏輯中明確排除，避免誤寄）。
  - 取消通知信主旨「預約已取消：{原服務名稱} {原日期} {原時間}」；改期通知信主旨
    「預約已改期：{新日期} {新時間}」，內文包含原時段與新時段對照。
- 未知事項：無（Database Webhook 的建立方式已於 TASK-052 定案，本卡沿用同一個
  trigger／設定，不需要重新設定）。

**TASK-051 審查後追加的注意事項**：與 TASK-052 相同，取消／改期通知信內插的顧客
姓名等使用者輸入務必先呼叫 `lib/email/format.ts` 的 `escapeHtml`（email HTML
injection 防護，見 TASK-052 情境包同一項 MUST FIX 的完整說明）。

**TASK-052 審查後追加的注意事項**（architect／security-reviewer 於 TASK-052 審查
提出，留給本卡實作時處理）：
- **payload 設計無法直接沿用 TASK-052 的「只送 id」模式**：TASK-052 的 `INSERT`
  trigger 只送 `record: {id}`，route 端用 service role client 依 id 回讀資料庫
  最新值組信——這是為了避免把 `access_token` 等整列個資送到 webhook 目標網址
  （見 `supabase/migrations/0011_appointments_insert_webhook.sql` 的說明）。但
  `UPDATE` 事件的分類邏輯（取消 vs 改期，見上方「假設」段落）需要比對
  `old_record` 與 `record` 的 `status`／`start_at`／`end_at`，而 `old_record`
  在 `UPDATE` 語句執行後**無法從資料庫回讀**（資料庫此時只剩新值）。因此本卡的
  `UPDATE` trigger 必須讓 payload 至少帶上分類所需的欄位（例如
  `old_record: {status, start_at, end_at}`、`record: {id, status, start_at,
  end_at}`），不能只送 `id`；建議白名單到剛好夠分類與組信用的欄位（例如額外加
  `customer_name`／`customer_email`，但**不要**用 `to_jsonb(old)`／`to_jsonb(new)`
  整列送出，避免重蹈 `access_token` 外洩的問題）。
- **確認信去重的 `UPDATE` 本身會再觸發一次本卡的 trigger，需要 `when` 子句排除**：
  TASK-052 的 route handler 為了去重會對 `appointments` 執行一次
  `update ... set confirmation_sent_at = ...`，這個 `UPDATE` 也會經過既有的
  `appointments_set_updated_at` trigger（`0001_core_schema.sql`）動到
  `updated_at`，並且會被本卡新增的 `UPDATE` trigger 攔到。本卡的 trigger 建立時
  務必加 `when (old.status is distinct from new.status or old.start_at is
  distinct from new.start_at or old.end_at is distinct from new.end_at)`
  這類條件，只在真正的取消／改期時才觸發，避免確認信去重寫入或未來
  `reminder_sent_at`／本卡自己的去重欄位寫入被誤判成一次新的預約異動而寄出錯誤的
  通知信或造成不必要的 webhook 負載。
- **pg_net 不會重試**：與 TASK-052 相同的既知限制（見 0011 migration 檔頭），本卡
  的去重／補償設計需要延續 TASK-052 route.ts 的「claim 失敗就釋放佔位供後續補寄」
  模式，不能假設 Supabase 或 pg_net 會自動重送失敗的 webhook 請求。
- 允許變更的檔案：
  - `app/api/webhooks/appointment-events/route.ts`
  - `lib/email/templates/cancellation.ts`（新增）
  - `lib/email/templates/reschedule.ts`（新增）
  - `tests/lib/email-templates.test.ts`（新增或擴充；實作時改用與 TASK-052
    一致的「每個 lib 檔案一個測試檔」慣例，拆成
    `tests/lib/email-cancellation-template.test.ts`／
    `tests/lib/email-reschedule-template.test.ts`）
  - **以下為實作階段修訂（2026-08-24，architect 於本卡審查後補列）**：
    - `lib/email/classify-appointment-update.ts`（新增，任務卡「實作備註」
      要求抽取的純函式，原清單漏列）。
    - `supabase/migrations/0012_appointments_update_webhook.sql`／
      `_down.sql`（新增，UPDATE 版 DB trigger；任務卡在 TASK-052 定案
      trigger-based 架構前寫成，沒有預期需要對應的 DB trigger 才能讓
      UPDATE 分支在真實環境被觸發，原清單漏列）。
    - `tests/lib/classify-appointment-update.test.ts`（新增）。
    - `tests/api/appointment-events-webhook.test.ts`（擴充，原清單未列出此
      整合測試檔案，沿用 TASK-052 已建立的檔案）。
- 不得觸碰：
  - TASK-052 負責的 `INSERT` 分支處理函式。
  - `lib/admin/appointments.ts` 既有的取消／改期／標記完成函式邏輯本身（本卡只是
    在這些操作觸發的 `UPDATE` 事件上掛外掛式的通知信邏輯，不修改這些函式的既有
    行為）。

## 需求

- WHEN `appointments.status` 由非 `cancelled` 變更為 `cancelled` THE SYSTEM SHALL
  觸發取消通知信寄送流程；`record.customer_email` 非空時寄送，內容包含原服務與時段。
- WHEN `appointments.start_at`／`end_at` 變更且變更後 `status` 非 `cancelled`
  THE SYSTEM SHALL 觸發改期通知信寄送流程；`record.customer_email` 非空時寄送，
  內容包含原時段與新時段對照。
- WHEN `UPDATE` 事件不符合上述兩種情境（例如僅 `status` 變為 `completed`，或
  `updated_at` 因既有 trigger 自動更新但無實質欄位變更） THE SYSTEM SHALL 不寄送
  任何信件。

## 驗收標準

- 預約被取消（`customer_email` 非空）後，收到取消通知信，內容正確。
- 預約被改期（`customer_email` 非空）後，收到改期通知信，內容包含新時段。
- 標記完成的 `UPDATE` 事件不觸發任何通知信。
- `customer_email` 為空的預約，取消/改期皆不寄信，不產生錯誤。

## 實作備註

- 判斷邏輯建議抽成獨立的純函式（例如
  `classifyAppointmentUpdate(oldRecord, record): "cancelled" | "rescheduled" |
  "none"`），方便單元測試涵蓋所有欄位變化組合，不要把判斷邏輯直接寫在 API Route
  handler 裡難以測試。

## 驗證契約

- 單元測試：`classifyAppointmentUpdate` 純函式（涵蓋取消／改期／標記完成／無實質
  變更等各種組合）；取消/改期信件內容組成純函式。
- 整合測試：模擬 `UPDATE` webhook 請求（取消／改期／標記完成三種情境）驗證端點
  正確分派、正確寄信或不寄信；併入 TASK-055。
- E2E 測試：不適用（無 UI）；改用「後台取消/改期一筆測試預約→確認對應通知信被
  正確觸發」的端到端流程驗證取代。
- 型別檢查：`npx tsc --noEmit`
- Lint：`npm run lint`
- Build：`npm run build`
- 螢幕截圖：不適用。
- 安全性檢查：沿用 TASK-052 已建立的密鑰驗證，本卡不重新設計驗證機制。

## 完成證據

- 變更的檔案：
  - `app/api/webhooks/appointment-events/route.ts`（修改，新增
    `handleAppointmentUpdate` 函式處理 `type === "UPDATE"` 分支，與 `INSERT`
    分支各自獨立）。
  - `lib/email/classify-appointment-update.ts`（新增，`classifyAppointmentUpdate`
    純函式，任務卡「實作備註」要求的抽取；改用 `Date.parse()` 比較時間點，不
    直接比字串，見下方審查發現第 6 點）。
  - `lib/email/templates/cancellation.ts`／`reschedule.ts`（新增，取消／改期
    通知信內容組成純函式，皆支援可選的 `storeName`／`storePhone`，比照
    TASK-052 confirmation.ts 的既有模式帶入店家聯絡資訊）。
  - `supabase/migrations/0012_appointments_update_webhook.sql`／`_down.sql`
    （新增；不在任務卡原「允許變更的檔案」清單內，已補列於該段落並記錄原因）。
  - `tests/lib/classify-appointment-update.test.ts`（新增，9 個測試）。
  - `tests/lib/email-cancellation-template.test.ts`（新增，5 個測試）。
  - `tests/lib/email-reschedule-template.test.ts`（新增，5 個測試）。
  - `tests/api/appointment-events-webhook.test.ts`（擴充，新增
    `UPDATE 事件（TASK-053：取消／改期通知信）` 區塊，共 18 個整合測試；同時把
    原本測「type 為 UPDATE 時先 ack 不處理」的舊案例改成測「type 為 DELETE 時
    先 ack 不處理」）。
- 執行過的指令：
  - `npx tsc --noEmit`（通過）／`npm run lint`（通過）／`npm run build`
    （通過，`/api/webhooks/appointment-events` 仍在路由清單中）。
  - `npx vitest run tests/api/appointment-events-webhook.test.ts`（33/33 通過）。
  - 完整 `npx vitest run`：431 tests，427 通過／4 失敗，失敗集中在
    `tests/components/account-settings-view.test.tsx`／`login-form.test.tsx`，
    屬 TASK-052 審查時已記錄的既有滿載並行間歇性 flaky 問題，與本卡無關。
- 審查：本卡風險等級高，依規則派遣 architect／security-reviewer／test-engineer
  三方審查，**三方皆已完成**（architect／security-reviewer 因 Anthropic API
  持續 529 過載，各自重試 6 次、歷時約 1.5 小時失敗後，使用者先跳過；之後 API
  恢復穩定，第 7 次重試兩者皆成功完成）。關鍵發現與修正：
  1. **architect MUST FIX（最關鍵）**：原設計「UPDATE payload 的 record 只帶
     id，route 端事後重讀資料庫當下值做分類」有 race condition——若同一筆預約
     短時間內連續發生兩次真正異動（例如先改期、幾秒內又取消），兩次 webhook
     處理時都可能讀到「當下已是 cancelled」的資料庫狀態，導致兩次都被誤判成
     取消、顧客收到兩封取消信。已改為 payload 的 `record`（新值）與
     `old_record`（舊值）皆帶 `{status, start_at, end_at}`、都是**同一次
     UPDATE 語句的完整前後快照**，分類與信件內容（原時段／新時段）一律直接
     使用 payload 快照，不再重讀資料庫；只有 `customer_name`／
     `customer_email`／`service_id` 這幾個不受時序問題影響的識別性欄位才依 id
     重讀資料庫。已補上迴歸測試（同一筆預約先改期又取消的兩次 webhook 各自
     正確分類，見 `appointment-events-webhook.test.ts` 最後一個 UPDATE 測試）。
  2. **architect／security-reviewer 皆提出 MUST FIX**：程式碼與 migration
     檔頭原本宣稱「`old_record` 不會被拿來當作寄信內容」，但實際上
     `old_record.start_at` 就是用來顯示改期信「原時段」的——這句註解與實作不符
     （雖然值有經過 `formatAppointmentDateTime` 驗證＋`escapeHtml`，不構成
     實際漏洞，但誤導未來維護者）。已隨上述第 1 點的重新設計一併修正註解，
     明確說明 record／old_record 的時間欄位就是信件內容的資料來源。
  3. **architect MUST FIX**：`0012` migration 檔頭原本沒有像 0011 那樣的
     「部署順序」警告——若人工先套用 migration、應用程式還沒部署新版
     `handleAppointmentUpdate`，UPDATE webhook 會打到舊 handler 得到
     `type_not_handled`，且 pg_net 不重試、回應 200，該空窗期的通知信會永久
     遺失且完全沒有異常訊號。已在 migration 檔頭補上部署順序說明。
  4. NICE TO HAVE（已一併處理）：trigger `WHEN` 子句收斂為
     `old.status is distinct from new.status and new.status = 'cancelled'`
     （而非單純 `new.status = 'cancelled'`），避免已取消的預約之後任何 UPDATE
     都白白觸發一次無用的 webhook；`classifyAppointmentUpdate` 改用
     `Date.parse()` 比較時間點而非字串相等，不依賴呼叫端 trigger WHEN 子句
     先過濾掉無意義變動這個外部前提；`isValidSnapshot` 型別守衛加上
     `Date.parse()` 合法性驗證，非法時間字串在驗證階段就回 400，不留到組信
     時才被 try/catch 吞成 200；取消信／改期信補上店家聯絡資訊（`storeName`／
     `storePhone`），修正與 TASK-052 confirmation.ts 既有模式的偏移；任務卡
     「允許變更的檔案」清單補列本次實作階段發現的漏列檔案。
  5. NICE TO HAVE（已記錄為殘留風險，未實作）：security-reviewer 指出 UPDATE
     分支沒有節流機制，若 `SUPABASE_WEBHOOK_SECRET` 外洩，攻擊者可對同一筆
     真實預約重放同一個 webhook payload 任意次數、每次都寄出一封通知信（不同
     於 INSERT 分支有 `confirmation_sent_at` 天然擋住重放）。此風險與密鑰外洩
     本身同源，且需要新增節流欄位／機制屬於較大的設計決策，已記錄在 migration
     檔頭與下方「已知限制」，留待未來視需要另立任務卡處理。
  6. test-engineer 審查（第一輪）發現：完成證據與看板卡片原本空白（已補齊）；
     E2E 真實環境驗證完全沒有證據（見下方「已知限制」）；補上 4 個測試覆蓋率
     對稱性缺口。
- 測試輸出：新增/擴充共 42 個測試（`classifyAppointmentUpdate` 9 個、取消信
  範本 5 個、改期信範本 5 個、webhook UPDATE 整合測試 18 個），全數通過。
- 螢幕截圖：不適用（無 UI）。
- 已知限制／殘留風險：
  - ~~真實 Supabase 環境尚未驗證~~ **已於 2026-08-24 由人工完成端對端驗證**：
    1. 套用 `0012_appointments_update_webhook.sql`（SQL Editor 執行成功；用
       `select tgname, tgenabled from pg_trigger where tgrelid =
       'public.appointments'::regclass and tgname =
       'appointments_notify_update';` 確認 trigger 已建立且啟用）。
    2. 第一輪人工測試（取消、改期）**沒有收到信**，診斷後發現根本原因：
       **這不是 Supabase／migration 的問題，而是 Claude Code 在完成
       architect／security-reviewer 審查修正（含 payload 契約改版的
       race condition 修正）後，忘記把更新後的 `route.ts` 重新部署到
       Vercel**——`select id, status_code, content from net._http_response`
       查出實際回應是 `{"ok":true,"skipped":"type_not_handled"}`，代表線上
       跑的仍是舊版本（沒有 `handleAppointmentUpdate`），trigger／migration
       本身完全正常。已重新執行 `npx vercel deploy --prod --yes` 部署最新
       程式碼，`curl` 確認端點恢復正常（401，密鑰驗證邏輯運作中）。
    3. 第二輪人工重新測試取消與改期，**皆成功收到內容正確的通知信**。
    4. 標記完成（`markAppointmentCompleted`）**確認不會觸發任何通知信**
       （新的 `WHEN` 子句設計：只有 `old.status is distinct from new.status
       and new.status = 'cancelled'` 才會判定為狀態類異動，標記完成不滿足
       這個條件，trigger 甚至不會觸發，比對 `net._http_response` 也沒有
       對應這次操作的紀錄，符合預期）。
    5. `select * from net._http_response order by created desc;` 確認取消／
       改期的觸發皆為 `status_code = 200`。
    - **這次的教訓**：往後任何在審查/修正階段對已部署程式碼（尤其是
      `app/api/` 底下的檔案）做出實質變更後，在進行真實環境驗證前，必須先
      確認並重新執行 `npx vercel deploy --prod --yes`，不能只憑本機
      `npm run build` 通過就假設正式環境已經是最新版本。
  - **UPDATE 端點無節流機制**（security-reviewer 提出，見上方發現第 5 點）：
    密鑰外洩時可被重放任意次數，每次都寄出一封通知信。留待未來視需要另立
    任務卡處理。
  - 端點回應中的 `skipped` 字串（`not_found`／`no_notification_needed`／
    `no_email`）讓持有密鑰者可探測預約是否存在、是否已取消、是否有 email
    （security-reviewer 提出的 NICE TO HAVE）；因與 TASK-052 INSERT 分支既有
    的回應風格一致、且需持有密鑰才觀察得到，暫不修改，記錄備查。
  - 若未來新增「只改 end_at（例如調整服務時長）不改 start_at」的操作，目前
    `classifyAppointmentUpdate` 仍會分類成 `rescheduled`，但改期信只顯示
    start 時間，會出現「原時段＝新時段」的confusing 內容（security-reviewer
    提出；目前 `rescheduleAppointment` 一律同時改動兩者，此情境尚不可達，
    留待真的出現該需求時再處理）。
- 後續任務：TASK-054（提醒信，需留意 `reminder_sent_at` 的 UPDATE 也不能誤觸發
  本卡的 trigger，已符合現有 `WHEN` 子句設計）、TASK-055（整合驗證，需含上方
  「已知限制」列出的真實環境端對端驗證步驟）。
