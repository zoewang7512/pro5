# 驗證報告

## 摘要

- 任務：TASK-121 Demo 動過的預約不再觸發提醒信（TASK-114 審查 R2；migration 0031，修法 A + 單一 migration）
- 結果：**實作完成；0031 已由使用者在 SQL Editor 套用（2026-11-02），套用前後的證據齊全。** 人工驗收：**使用者已於 2026-11-02 驗收通過，轉 Done。** 未做：`_down` 回滾實測（選做，需關閉 Demo 入口）。
- 審查：架構、安全、測試三方審查皆已完成，結論皆為「有條件核准」、**無 MUST FIX**；意見是 agent 意見，不等於人工核准。已處理的項目見下方。
- 風險：高（新增 `appointments` 觸發器，並重新定義 Demo 還原函式 `reset_demo_data`）。
- 日期：2026-11-02。驗證者：實作 agent（Claude Code）；migration 由使用者套用。

## 變更的檔案

| 檔案 | 內容 |
|---|---|
| `supabase/migrations/0031_demo_reminder_guard.sql` | 新增。BEFORE UPDATE 觸發器 `demo_appointment_reminder`（函式 `demo_appointment_reminder_guard()`）：Demo JWT 的更新強制 `reminder_sent_at := coalesce(old.reminder_sent_at, now())`；同交易內重新定義 `reset_demo_data`，**除白名單新增一個名稱外與 0027 逐字相同**（區塊由腳本從 0027 抽出，非手抄）；依賴檢查、`lock_timeout`、尾端自我檢查 |
| `supabase/migrations/0031_demo_reminder_guard_down.sql` | 新增。移除觸發器與函式，並把 `reset_demo_data` 還原成 0027 本文（逐字） |
| `tests/lib/demo-reminder-guard-migration.test.ts` | 新增。單元測試 17 項（函式判斷順序、觸發器結構、逐字比對、白名單、缺口來源形狀、驗證腳本） |
| `tests/demo-reminder-guard.integration.test.ts`、`vitest.demo-reminder-guard.config.ts`、`package.json`（`test:demo-reminder-guard`） | 新增。對真實專案的整合測試 8 項，分預設（守門生效）與 `DEMO_REMINDER_GUARD_EXPECT=off`（基準線）兩種模式 |
| `tests/lib/demo-reset-test-scan.test.ts` | 白名單加入 0031 與其單元測試（兩者出現 `reset_demo_data` 字樣但不呼叫） |
| `ai/artifacts/Demo 體驗帳戶/verification/TASK-121-verify.sql`、`TASK-121-pglite-rehearsal.mjs`、`TASK-121-verify-pglite-run.mjs` 與各輸出檔 | 新增。SQL Editor 驗證腳本（交易以例外收尾，保證 rollback、不寄信）、PGlite 演練 |
| `docs/demo-account.md`、`ai/context/decisions.md`、`ai/context/project-map.md`、`architecture-notes.md`、`verification/TASK-114.md`、`task-cards/TASK-121.md`、`tools/kanban/cards/TASK-121.json` | 文件與看板 |

未動：既有 migration、`notify_appointment_*` 與其觸發器、`app/api/cron/appointment-reminders/route.ts`、`lib/` 與前端程式碼、任何資料。

## 證據（套用前）

### 1. 單元測試與靜態檢查
- `npx vitest run tests/lib`：**30 檔 569 項全過**（含新測試 17 項、`demo-reset-test-scan` 6 項、`demo-row-caps-migration`、`demo-audit-log-cap-migration`）。
- `npx tsc --noEmit` exit 0；`npm run lint` exit 0；`npm run build` 成功。
- 突變測試（我做的 5 種：白名單漏補、拿掉預篩、觸發器加 WHEN、改讀 user_metadata、還原函式改一字）全部被單元測試抓到；測試審查另做 29 種變異，25 種被抓到，存活的 2 種「行為層」變異（賦值包進 `if false`、永遠放行分支）已補斷言，另 2 種為低優先的自我檢查分支（PGlite 演練執行過）。

### 2. PGlite 演練（記憶體內 Postgres，真的執行 0031／_down 的 SQL）
- `TASK-121-pglite-rehearsal.mjs`：**39 項全過**（`TASK-121-pglite-rehearsal-output.txt`）。涵蓋：三種依賴缺失時中止且整份回滾、重複套用、觸發器定義（BEFORE UPDATE ROW、無 WHEN）、白名單同時含新舊名稱、沒有 JWT／一般管理員／service role（claim 與 release）行為不變、`user_metadata.is_demo` 偽裝與 `is_demo=false` 不被當 Demo、Demo 改期（已提醒／未提醒）、只改狀態、直接設 null、排程挑選謂詞撈不到 Demo 動過的預約（對照：一般管理員改期後撈得到）、INSERT 不受影響、不額外觸發 UPDATE webhook、壞 claims（含／不含 `is_demo`）的失敗方向、舊式 `request.jwt.claim`、`_down` 與重複 `_down`、回滾後 `reset_demo_data` 本文 md5 與套用前一致、回滾後缺口重新打開、重新套用。
- `TASK-121-verify.sql` 在 PGlite 實跑（`TASK-121-verify-pglite-output.txt`）：**套用前 `RESULT=MISMATCH`（Demo 三情境與壞 claims 變 NULLED），套用後 `RESULT=ALL_OK`**，rollback 後資料未動。
- **限制：** PGlite 的 `auth.jwt()` 是我依 Supabase 定義寫的替身；它**無法證明** PostgREST 真的把簽章後 claims 放進 `request.jwt.claims`、RLS／grant／owner 行為，也**從未執行 `reset_demo_data`**（只檢查函式本文）。這三項由下方整合測試與套用後的 `test:demo-reset` 補上。

### 3. 對真實專案的整合測試（套用前基準線，`npm run test:demo-reminder-guard`）
- `DEMO_REMINDER_GUARD_EXPECT=off`：**8/8 通過**（`TASK-121-integration-baseline-off.txt`）。重現缺口：Demo 改期後 `reminder_sent_at` 變 null、提醒排程的挑選條件撈得到（有 Email 的預約）。
- 預設模式（守門生效）：**4 失敗、4 通過**（`TASK-121-integration-default-before-apply.txt`）——失敗的正是四個 Demo 情境，證明測試有鑑別力；通過的是一般管理員、`user_metadata` 偽裝、cron claim／release 與權限前提（與模式無關）。
- **權限前提已在正式庫實測成立：** Demo 更新 `customer_email`、`customer_name` 與直接 INSERT 皆回 `42501`（此案例在兩種模式都通過）。這是觸發器（只掛 UPDATE）完整的前提。
- 不會寄信：非 Demo 的改期一律不帶 Email；有 Email 的預約只用於 Demo 情境（0026 抑制 webhook），Email 是 Resend 測試信箱；提醒挑選條件以「id 限定的相同謂詞」重現，不呼叫排程端點，也不呼叫 `claimAppointmentsForReminder`（它沒有 id 限定，會佔走真實預約的提醒額度）。每輪結束預約仍為 16 筆，無殘留。

### 4. 全套件 `npx vitest run` 的已知不穩定
- 全套件有 4 個元件測試檔（`account-settings-view`、`login-form`、`designer-basic-info-form`、`designer-picker-section`）會**間歇**失敗（兩次全套件跑分別失敗 14、25 個）。
- 我用 `git stash -u` 在**乾淨樹**單獨跑這 4 個檔案：同樣失敗 1 個；在我的變更下單獨重跑兩次：失敗 1 個與 2 個，且是同一批測試。與本卡無關（本卡未動任何元件或 `lib/`），**不算本卡的回歸，但「全套件全綠」不能宣稱**；可宣稱的是「相關範圍全綠：`tests/lib` 30 檔 569 項、tsc、lint、build」。

## 審查意見與處置

| 審查 | 重點 | 處置 |
|---|---|---|
| 架構 | S1 檔頭說 verify.sql 列出還原 dry-run 結果，實際沒有；S2 緊急停用後「重套 0031」可能把更新的還原函式倒退；S3 鎖註解不準；S4 任務卡 md 與看板不一致；N1 CRLF；N2 預篩順序；N3 訊息與 `quote_literal`；N4 指紋預期值；N5 「永遠」措辭 | S1：改正檔頭，並把「套用後 `test:demo-reset` 通過」列為必要證據；S2：檔頭與手冊改成只重建觸發器、不重跑整份；S3：改寫並註明避開提醒 cron（台北 09:00）與還原 cron（台北 03:00）；S4：同步；N1：產生器腳本本身是 CRLF 污染輸出，已修並確認 LF；N2、N3、N4、N5 已處理。N6（`0027_down` 不察覺 0031）靠手冊順序，N7（security definer）保留以與同系列一致 |
| 安全 | 無 MUST FIX；找不到繞過途徑（`authenticated` 對 appointments 只有四欄位 UPDATE、無 INSERT／DELETE）；S1 權限前提沒有被驗證；N2 預篩順序；N3 `comment on column`；N4 重套警告；N5 觸發器順序限制 | S1：verify.sql 加 `grants_ok`、整合測試加權限案例（正式庫實測 42501）；N2、N4、N5 已處理；N3 未做（不動 schema，改寫入檔頭與決策） |
| 測試 | M1–M3 補套用後證據與基準線存檔；S1 補斷言；S2 案例空轉；S3 結尾總數比對易誤報；S4 中斷殘留；S5 依賴 0026；S6 PGlite 限制；S7 「全綠」宣稱方式 | M2：基準線輸出已存檔；M1、M3：見下方套用後清單；S1：補「`return new` 恰三處」「賦值為最上層語句」「不得有 `if true/false`」；S2：加 `.select("id")` 與受影響列數；S3：改為確認無殘留、總數只印出；S4：開頭掃除殘留預約；S5：檔頭註明；S6、S7：已如實寫在上方 |

## 證據（套用後，2026-11-02）

- **`TASK-121-verify.sql`（使用者在 SQL Editor 執行）：`RESULT=ALL_OK`**。Supabase 顯示的 P0001 是腳本刻意用 `raise exception` 收尾以保證 rollback，不是失敗。輸出：`has_trigger=t, trigger_enabled=O, security_definer=t, proconfig=[search_path=""], whitelist_has_new=t, whitelist_keeps_0027=t, grants_ok=t`；十二個情境全部與預期一致（Demo 三種寫法與含 is_demo 的壞 claims 為 KEPT；一般管理員、service role、無 claims、is_demo=false／"false"、user_metadata 偽裝、頂層 is_demo、不含 is_demo 的壞 claims 為 NULLED）。
- `npm run test:demo-reminder-guard`（預設模式）：**8/8 通過**，預約總數開始 16、結束 16（`TASK-121-integration-default-after-apply.txt`）；套用前同一個模式是 4 失敗，現在轉綠。
- `npm run test:demo-reset`（還原函式 dry-run 整合測試＋掃描測試）：**2 檔 34 項通過**（`TASK-121-test-demo-reset-after-apply.txt`）——白名單守門在 dry-run 也會執行，所以還原函式確實接受新觸發器。
- `npm run test:notifications`：**20/20 通過**（`TASK-121-test-notifications-after-apply.txt`）——提醒排程的 claim／release 在新觸發器存在時行為不變。輸出中的 `SEND_FAILED` 是該測試刻意模擬的寄信失敗。
- 尚未做：`_down` 回滾實測（會暫時重新打開缺口，需先關閉 Demo 入口）與真實還原（TASK-112）。

## 未關閉的殘留風險

- **R-A（中高，不在本卡範圍，需你決定是否另開卡）：** Demo 可修改服務名稱、設計師名稱、店家名稱／電話／地址，這些文字會流進**沒被 Demo 碰過**的預約的確認信與提醒信；搭配匿名 `create_appointment`（R1）可對任意 Email 寄純文字釣魚信（模板有 escape，無 HTML／header injection；受 0029 長度上限與 0030 每 key 24 小時 3 筆限制）。根本解法是全店寄信預算，或 Demo 開啟期間信件改用固定文案。0031 不處理。
- **R1 殘留：** Email 別名寫法（供應商別名、次網域、catch-all）仍可繞過 0030 的 dedupe；匿名預約仍可對任意 Email 寄確認信與提醒信。
- **已接受的副作用：** Demo 對預約做任何 UPDATE（含只改狀態）都會把 `reminder_sent_at` 填成目前時間，Demo 動過的預約不會收到提醒信（之後由一般管理員再改期則恢復）；`reminder_sent_at` 現在也代表「Demo 動過」。
- **真實還原靠推理：** `reset_demo_data` 是先 delete 再 insert、不發 UPDATE，所以不會觸發新觸發器（讀函式本文確認，未實測）；dry-run 與真實還原都會先過白名單守門，所以套用後 `test:demo-reset` dry-run 通過即證明函式接受新觸發器。真實還原的實測留給 TASK-112。
- **整合測試被強制中止（Ctrl-C）** 會讓拋棄式 `is_demo` 帳號殘留到下次執行，期間每日還原會因「不是剛好 1 個 Demo」而拒絕；重跑一次即清除。

## 套用 0031 後的證據清單（步驟 2–5 已完成，見上方「證據（套用後）」；步驟 1、6、7 未做）

1. 套用前先記下指紋：`select md5(prosrc) from pg_proc where oid = 'public.reset_demo_data(jsonb,boolean)'::regprocedure;`（0027 本文在 LF 下預期 `f80ed21daf4463befd02e371ee250662`，以你自己記下的為準）。
2. 在 SQL Editor **整份**執行 `supabase/migrations/0031_demo_reminder_guard.sql`（避開台北 03:00 與 09:00 前後；Demo 入口目前未開啟更佳）。
3. 貼上並執行 `TASK-121-verify.sql`，預期 `RESULT=ALL_OK`（含 `grants_ok=t`），存下輸出。
4. `select tgname, tgenabled from pg_trigger where tgrelid = 'public.appointments'::regclass and tgname = 'demo_appointment_reminder' and not tgisinternal;` 預期 1 列、`O`。
5. `npm run test:demo-reminder-guard`（預設模式）預期 **8/8**；`npm run test:demo-reset`（dry-run，證明白名單被接受）；`npm run test:notifications`（會 claim 並還原真實 0–26 小時內的預約，避開重要預約時段）；回歸 `test:demo-row-caps`、`test:booking-limit` 視需要。
6. 回滾實測（Demo 入口關閉時）：執行 `0031_demo_reminder_guard_down.sql`，再算 `md5(prosrc)` 應等於步驟 1 的值；`DEMO_REMINDER_GUARD_EXPECT=off npm run test:demo-reminder-guard` 預期 8/8；`npm run test:demo-reset`；重新套用 0031 後再跑預設模式與 verify.sql。
7. 之後做 TASK-112 的真實還原時，確認還原後觸發器仍在且啟用。
