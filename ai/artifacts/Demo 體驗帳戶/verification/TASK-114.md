# 驗證報告

## 摘要

- 任務：TASK-114 Demo 發動的改期／取消不寄信（改寫 `notify_appointment_update`，migration 0026）
- 結果：**實作與驗證完成，已由使用者在正式庫套用，三方子代理審查已執行並處理，使用者已於 2026-10-31 人工驗收通過。**資料庫層基準線與套用後對照、真實請求的 Vercel 請求紀錄、真實信箱正向對照都符合預期。
- 驗證者：實作 agent（Claude Code）；migration 由使用者在 Supabase SQL Editor 套用，信箱結果由使用者確認。架構、安全、測試三個子代理審查結論皆為「有條件核准」、沒有 MUST FIX；其意見是 agent 意見，**不等於人工核准**。
- 日期：2026-10-31。
- **重要：0026 只堵住「改期／取消信」這一條路。D13 想擋的「借寄件網域對任意 Email 發信」並沒有完全收斂，見下方「未關閉的殘留風險 R1、R2」，需要使用者決策。**

## 變更的檔案

| 檔案 | 說明 |
|---|---|
| `supabase/migrations/0026_demo_suppress_update_mail.sql` | 新增：`create or replace` 改寫函式，開頭加 Demo 守門；有依賴檢查；觸發器與確認信不動 |
| `supabase/migrations/0026_demo_suppress_update_mail_down.sql` | 新增：把函式還原成 0012 本文（逐字） |
| `tests/lib/demo-mail-suppress-migration.test.ts` | 新增（任務卡原未列出）：逐字比對、守門區塊固定、禁止附加敘述、掃描日後 migration 不得洗掉守門，共 8 項 |
| `ai/artifacts/Demo 體驗帳戶/verification/TASK-114-verify.sql` | 新增（任務卡原未列出）：SQL Editor 內以 `raise exception` 收尾保證 rollback 的驗證腳本。審查後已改版（見下） |
| `tests/demo-mail-suppress.integration.test.ts`、`vitest.demo-mail-suppress.config.ts`、`package.json` | 新增：`test:demo-mail-suppress`（真實拋棄式 Demo／非 Demo 帳號，信箱正反對照） |
| `ai/context/decisions.md`、`architecture-notes.md`、任務卡、看板卡 | 決策、殘留風險與狀態紀錄 |

## 設計重點

- 守門：`coalesce(auth.jwt() -> 'app_metadata' ->> 'is_demo', '') = 'true'` 時 `return new`，早於讀 Vault 與 `net.http_post`，位於 `begin ... exception` 內。來源是簽章後的 JWT claim，使用者無法自行改寫（`auth.updateUser` 只寫 `user_metadata`；0021 連 admin API 都禁止改 `is_demo`）。
- 失敗方向安全：讀 JWT 若拋例外，既有 exception handler 吞掉並 return new，結果是「不寄信」，不會讓 Demo 的改期／取消失敗。
- 沒有 Demo JWT 的呼叫者（cron、service role）行為與 0012 相同。
- 觸發器 `appointments_notify_update` 的 `WHEN` 與確認信（`notify_appointment_insert`）完全沒動。

## 驗證證據（原始輸出）

**套用前基準線**（`TASK-114-verify.sql` 舊版，使用者執行）：

```
VERIFY_RESULT（交易已 rollback，沒有改動任何資料、沒有寄出任何信件）：has_guard=f, demo_reschedule=1, demo_cancel=1, nondemo_reschedule=1, service_reschedule=1, nondemo_cancel=1
```

**使用者在 SQL Editor 套用 0026**：`Success. No rows returned`

**套用後**（同一份舊版腳本）：

```
VERIFY_RESULT（交易已 rollback，沒有改動任何資料、沒有寄出任何信件）：has_guard=t, demo_reschedule=0, demo_cancel=0, nondemo_reschedule=1, service_reschedule=1, nondemo_cancel=1
```

**Vercel 請求紀錄**（`vercel logs requests --environment production`，`pg_net/0.20.4`，`POST /api/webhooks/appointment-events`）：

| 輪次 | 時間（UTC） | 回應 | 說明 |
|---|---|---|---|
| 第一次整合測試 | 2026-10-31T11:11:21.068Z | 200 | 該輪 3 個動作中只有 1 次請求（一般管理員那次）；預約已被清掉，所以沒寄信 |
| 第二次整合測試（正向對照後等 25 秒） | 2026-10-31T11:19:40.814Z | 200 | 該輪同樣只有 1 次請求；使用者確認收到 1 封信 |

**真實信箱**：使用者確認收到 1 封「預約已改期」（顧客名含 `mailsuppress-normal`），沒有 `mailsuppress-demo` 的信。

| 其他指令 | 結果 |
|---|---|
| `npm run test:notifications`（套用後） | 20/20 |
| `npm run test:demo-enter`（套用後） | 22/22 |
| `npx vitest run tests/lib/demo-mail-suppress-migration.test.ts` | 8/8 |
| `npx tsc --noEmit`、`npm run lint` | 0 錯誤 |
| `npm run build` | 本卡未改應用程式碼，未重跑（上一張卡已通過） |

> **證據效力說明（測試審查要求如實標註）：** `test:demo-mail-suppress` 的三項斷言只驗證「預約資料照常改期／取消成功」，**沒有任何斷言與 webhook 有關**，沒套用 0026 時也會 3/3 通過，所以它**不是守門的回歸測試**，只保證資料路徑沒壞。真正支撐「Demo 零 webhook」的是：verify.sql 的 0／0 前後對照、Vercel 請求紀錄、使用者人工看信箱。正向對照（一般管理員有寄信）同樣沒有自動判定，靠人工看信箱。TASK-112 把它列入回歸時要帶這個前提。

## 驗收標準對照

| 驗收標準 | 狀態 | 證據 |
|---|---|---|
| Demo 改期與取消：沒有任何 webhook 請求被送出 | 達成 | verify.sql 增量 0／0；Vercel 每輪只有 1 次（非 Demo 那次） |
| 非 Demo 管理員：webhook 照常送出 | 達成 | verify.sql 增量 1；Vercel 有請求；信箱收到信 |
| service role 與顧客端取消行為不變 | 部分 | service role：verify.sql 以「無 Demo claim」模擬（舊版用空 claims，新版另含真實 `{"role":"service_role"}` 形狀）；**顧客端取消不適用**：目前沒有顧客自助取消路徑（需 access_token 的取消尚不存在） |
| Demo 建立預約（確認信路徑）不受影響 | 僅靜態證據 | `notify_appointment_insert` 與觸發器未動（單元測試斷言）；**沒有**實測 Demo JWT 下建立預約仍寄確認信，建議 TASK-112 走查時補一次 |
| 預約資料本身對 Demo 照常改期／取消成功 | 達成 | 整合測試 2 項（真實 Demo JWT 經 PostgREST） |
| `_down.sql` 後函式與 0012 逐字一致 | 達成 | 單元測試逐字比對；**並已實際套用 `_down` 與重新套用 0026（見下方「回滾實測」）**：回滾後 `has_guard=f`，Demo 情境變回 1；重新套用後恢復 ALL_OK |
| 既有 `test:notifications` 在套用前後都通過 | **未完全達成** | 只有套用後 20/20；**沒有套用前基準**，也沒有 `_down` 後的結果 |

## 回滾實測（2026-11-01，使用者於 Supabase SQL Editor 執行；當時 Demo 帳戶尚未建立、入口未公開）

流程：整份貼上 `0026_demo_suppress_update_mail_down.sql` → 跑 `TASK-114-verify.sql` → 整份貼上 `0026_demo_suppress_update_mail.sql` → 再跑 `TASK-114-verify.sql`。

**回滾後**（`_down` 回報 Success）：

```
VERIFY_RESULT（交易已 rollback，沒有改動任何資料、沒有寄出任何信件）：has_guard=f, security_definer=t, proconfig=[search_path=""], demo_reschedule=1(0), demo_cancel=1(0), demo_string_true=1(0), nondemo_reschedule=1(1), nondemo_cancel=1(1), service_real_claims=1(1), no_claims=1(1), is_demo_false=1(1), is_demo_string_false=1(1), user_metadata_demo=1(1), top_level_demo=1(1),  RESULT=MISMATCH
```

**重新套用 0026 後**：

```
VERIFY_RESULT（交易已 rollback，沒有改動任何資料、沒有寄出任何信件）：has_guard=t, security_definer=t, proconfig=[search_path=""], demo_reschedule=0(0), demo_cancel=0(0), demo_string_true=0(0), nondemo_reschedule=1(1), nondemo_cancel=1(1), service_real_claims=1(1), no_claims=1(1), is_demo_false=1(1), is_demo_string_false=1(1), user_metadata_demo=1(1), top_level_demo=1(1),  RESULT=ALL_OK
```

結論：`_down` 如預期移除守門（`has_guard=f`，三個 Demo 情境回到 1，其餘情境不變，`security definer` 與 `search_path` 設定維持），重新套用 0026 後完全恢復；回滾與重套都可重複執行、不留下半套。回滾期間 Demo 的改期與取消會寄信，這段時間正式庫沒有守門（當時沒有 Demo 帳戶、入口未公開）。

## 子代理審查結果與處置（2026-10-31）

三份審查結論皆為「有條件核准」，沒有 MUST FIX。

| 審查 | 重點意見 | 處置 |
|---|---|---|
| 架構 | S1 日後 migration 若複製 0012 會洗掉守門；S2 文件把 Demo 還原的風險機制寫錯（0024 是先刪後插、不發 UPDATE，帶 Email 的 seed 已被 0024 直接拒收）；N1 守門區塊內部沒逐字固定；N3 確認信內容可控未列入殘留 | S1：已加掃描測試（編號最大的重新定義者必須含守門）；S2：已修正 decisions.md 與本報告；N1：已加守門區塊逐字測試；N3：列入殘留 R3 |
| 安全 | 無 MUST FIX；守門無法被竄改或繞過；R1、R2 為本卡範圍外但使 D13 目標落空的高風險殘留；S1 verify.sql 計數可能偽陰性；N4 Dashboard 設定無法從 repo 驗證 | R1、R2：已記入殘留並**交使用者決策**；S1：verify.sql 改為只數起點 id 之後的列；N4：待使用者確認 |
| 測試 | 整合測試不是守門回歸測試；`test:notifications` 套用前基準缺；原始輸出未存檔；`has_guard` 會被註解命中；缺負向情境；逐字測試抓不到「後面再附一份函式」等變異；整合測試殘留與 25 秒等待靜默失敗 | 已在本報告標註與貼上原始輸出；verify.sql 改版（比對實際條件字串、加印 security definer／proconfig、補 8 個情境）；逐字測試補禁止清單；整合測試風險列入限制 |

**verify.sql 改版後已由使用者重跑**（2026-10-31，0026 已套用），原始輸出：

```
VERIFY_RESULT（交易已 rollback，沒有改動任何資料、沒有寄出任何信件）：has_guard=t, security_definer=t, proconfig=[search_path=""], demo_reschedule=0(0), demo_cancel=0(0), demo_string_true=0(0), nondemo_reschedule=1(1), nondemo_cancel=1(1), service_real_claims=1(1), no_claims=1(1), is_demo_false=1(1), is_demo_string_false=1(1), user_metadata_demo=1(1), top_level_demo=1(1),  RESULT=ALL_OK
```

結論：線上函式含守門的實際條件字串，仍是 security definer 且 `search_path` 為空；Demo（布林與字串 "true"）的改期、取消為 0，其餘情境（非 Demo、真實 service role 形狀、無 claims、`is_demo` 為 false／"false"、只放在 `user_metadata`、放在頂層）都照常寄（1）。「守門不採信 `user_metadata`」由此得到實測證明，不只是靜態字串比對。

## 未關閉的殘留風險（需使用者決策）

- **R1（高）：Demo 靜默取消可解除「每個 Email 最多 3 筆」上限，確認信因此能無限次寄給任意 Email。** `create_appointment` 開放 anon，上限只計 `pending/confirmed` 且未來的預約（`0018:524-534`）；Demo 把預約改成 cancelled（0026 後不寄信）就釋放額度，再用同一個 Email 重新預約，確認信（0011 觸發器，D13 刻意保留）再寄一次。顧客姓名由攻擊者填寫、店名等由 Demo 可改，信件內容可控（模板有 escape，無 HTML／header injection，但純文字釣魚可行）。0026 之前同一迴圈就存在，0026 沒有引入也沒有關閉。
- **R2（中）：Demo 用正常改期就能讓提醒排程對任意 Email 寄提醒信。** `rescheduleAppointment` 本身會把 `reminder_sent_at` 設回 null，改期到明天後隔天排程就寄提醒信；每筆預約每日最多一封、每次排程最多 100 筆。原殘留紀錄只寫「可被清成 null」，低估了這條路徑。
- **R3（低，D13 已接受）：** 確認信內容的店名、設計師名、服務名可被 Demo 修改；每個 Email 最多 3 筆；每日還原會清除。
- **已依使用者指示另開卡（草稿，待使用者決定修法與核准）：R1 → TASK-120、R2 → TASK-121。**
- 安全審查建議的修法（已寫進上述兩張卡）：把 Email／電話上限改為「過去 24 小時內建立的預約，不分狀態」的滾動視窗；或對確認信做頻率節流；R2 可加 `BEFORE UPDATE` 觸發器，Demo 動過的預約 `reminder_sent_at` 強制視為已提醒（可共用 0026 的 JWT 判斷式）。

## 其他已知限制

1. 回滾（`_down`）已實測可用（見「回滾實測」）；但回滾會重新打開寄信缺口，只應在 Demo 入口未公開或已關閉時執行。
2. Demo 每日還原（0024）對預約是**先刪後插**，不發 UPDATE，不會觸發 `appointments_notify_update`；INSERT 路徑則由 0024 直接拒收帶 `customer_email` 的 seed（`0024:236-241`），不靠人工確認。
3. 守門依賴「Demo 的寫入一定帶著 Demo JWT 經 PostgREST」。目前 service role client 只用在 webhook、cron、demo-reset、rate-limit；日後若新增「伺服器端以 service role 代 Demo 改預約」的功能，守門會靜默失效（已記入 decisions.md）。
4. 整合測試會寄 1 封真實信件，需設定 `DEMO_MAIL_TEST_EMAIL`；不放進預設 `npm test`。中斷（Ctrl-C）時會殘留一個 `is_demo` 的拋棄式管理員帳號與測試服務，下次執行的 `beforeAll` 會清帳號；期間 Demo 還原函式會因「不是剛好 1 個 Demo 帳戶」拒絕執行。25 秒等待在冷啟動較慢時可能不足（超時會靜默：預約被刪、webhook 回 200 不寄信）。
5. verify.sql 的計數仍依賴低流量；`has_guard` 比對線上函式本文，但不比對 `md5(prosrc)` 與檔案完全一致（行為計數間接證明）。
6. 一般管理員仍可對任意 Email 的預約改期寄信（本來就是正式功能，非 Demo 範圍）。

## Dashboard 設定確認（使用者於 2026-10-31 在 Supabase Dashboard 確認）

- **Authentication → Auth Hooks：沒有任何 hook**（清單為空），所以沒有 Custom Access Token Hook 能改寫 `app_metadata` claim；守門依賴的 `is_demo` claim 不會被 hook 動到。
- **Authentication → Sign In / Providers → 「Allow new users to sign up」：關閉**，所以沒有「任何人用任意 Email 註冊並觸發確認信」這個與 Demo 無關的寄信面。

## 待使用者決定

- R1（TASK-120）、R2（TASK-121）要選哪個修法，或接受為殘留風險。

## 後續任務

- TASK-112：端到端走查時補一次「Demo JWT 建立預約仍寄確認信」；回歸清單加入 `test:demo-mail-suppress`（帶上「不是守門回歸測試」的前提）與改版後的 `TASK-114-verify.sql`。
- TASK-120（R1：滾動視窗上限／確認信節流）、TASK-121（R2：Demo 預約提醒標記觸發器，需同步更新 0024 還原函式的觸發器白名單）：已建立草稿卡，待使用者決定修法。
- 建議（NICE TO HAVE）：把 verify.sql 的邏輯做成以 `pg` 直連、`begin ... rollback` 的自動化測試，成為真正有鑑別力的守門回歸測試。
