# 驗證報告

## 摘要

- 任務：TASK-108 還原函式 `reset_demo_data` 與唯讀物件清單 RPC（migration，單一交易、含 dry-run）
- 結果：**實作與自動化驗證完成，待審查與使用者人工驗收。**整合測試 28 項加掃描測試 3 項全過、0 skipped（全部 dry-run，已對審查後的修訂版重跑）；13 張相關表在測試前後與測試前的唯讀備份**逐列相同**；拋棄式帳號已清除。
- 驗證者：實作 agent（Claude Code）。架構、安全、測試三個子代理審查已派出，結果見下方「審查處理」，其意見是 agent 意見，**不等於人工核准**。
- 日期：2026-10-31。migration 由使用者在 Supabase SQL Editor 套用，測試由 agent 執行。
- **本卡絕不對正式庫做真實還原**（`p_dry_run = false` 的路徑從未被執行過；見殘留風險）。

## 變更的檔案

| 檔案 | 說明 |
|---|---|
| `supabase/migrations/0024_demo_reset.sql`、`_down.sql` | 新增：`reset_demo_data(jsonb, boolean)`、`demo_list_storage_objects(text)`；只有 service_role 能執行；尾端自我檢查；回滾只移除兩個函式 |
| `tests/demo-reset.integration.test.ts`、`vitest.demo-reset.config.ts` | 新增：22 項整合測試（**只 dry-run**） |
| `tests/lib/demo-reset-test-scan.test.ts` | 新增：3 項掃描測試，把關「測試不得真實還原」 |
| `package.json` | 新增 `test:demo-reset` |

## 設計重點

- **原子性**：守門、鎖與 `lock_timeout` 在內層區塊之外；覆寫在內層 `BEGIN … EXCEPTION WHEN SQLSTATE 'RD001'`，dry-run 於最後以 `RD001` 回滾子交易，其他錯誤（constraint 違反等）一律往外丟、整個交易回滾；筆數變數宣告在外層，回滾後仍保留。
- **守門**：`p_dry_run` 無預設值且不得為 null；`confirm = 'RESET_DEMO'`；必要鍵與型別；`services`／`designers`／`designer_services`／`customers`／`appointments` 至少 1 筆；`business_hours` 剛好 7 列且 weekday 不重複；`demo_admin_profile.display_name` 必填。
- **Demo 使用者由函式決定**：查 `is_demo` 帳戶，筆數不是剛好 1 就 raise；payload 的 `demo_user_id` 只作交叉檢查。
- **不寄信**：payload 預約與顧客 email 必須全為 null、預約不得帶 `access_token`，否則 raise。
- **鎖**：`pg_try_advisory_xact_lock`（搶不到就失敗，不排隊）、`lock_timeout = 5s`、`lock table appointments in exclusive mode`（擋寫入、不擋讀取）。
- **相容 pg-safeupdate**：DELETE 一律 `where true`。
- **欄位**：全部以 `jsonb_to_recordset` 明確列欄位，沒有字串拼接 SQL；`access_token`、`price_at_booking`、`updated_at` 不由 payload 帶入。

## 指令與輸出

| 指令 | 結果 |
|---|---|
| `npm run test:demo-reset`（對正式 Supabase，只 dry-run，修訂版 0024） | 31 passed（28 整合 + 3 掃描），0 skipped（含重置閘門 4 項；對閘門版 0024 重跑）；dry-run 耗時約 0.85～1.4 秒（425 筆預約的 payload）；未知觸發器守門在正式庫通過 |
| `npx vitest run tests/lib/demo-reset-test-scan.test.ts` | 3 passed |
| `npx tsc --noEmit`／`npm run lint`／`npm run build` | 0 錯誤／0 error／成功 |
| 測試後與測試前唯讀備份逐列比對（13 張表） | 13/13 逐列相同（閘門版 0024 重跑後再比對一次） |
| 測試後殘留檢查（`demoreset`／`demoseedbucket` 拋棄式帳號、閘門狀態） | 0；Auth 使用者只剩 designer001；閘門為關閉 |

測試中發現並修正一個**測試輔助函式**的問題（不是函式的問題）：原本 `callReset(payload, undefined)` 會因 JavaScript 預設參數變成 `true`，「不傳 p_dry_run」案例其實送了 `true`。已改用明確的 `"omitted"` 標記，掃描測試同步更新。

## 驗收標準對照

| 驗收標準 | 結果 | 證據 |
|---|---|---|
| dry-run 後所有表筆數與內容與執行前完全一致（含 designer001 的 `admins` 與 `audit_log` 其他列） | 通過 | 每個案例前後 13 張表 `select *` 逐列比對；另與測試前備份比對 |
| dry-run 回傳筆數等於 payload 各陣列長度；`audit_log` 只計 Demo 的列 | 通過 | `counts` 與 `deleted` 逐項斷言；`deleted.audit_log` 等於 Demo 帳戶的稽核列數 |
| 缺 `confirm`、缺必要鍵、陣列低於最低筆數、空 payload、`business_hours` 非 7 列、預約含非 null email、`is_demo` 帳戶不是剛好 1 個、`demo_user_id` 不符皆失敗且資料不變 | 通過 | 對應案例逐一斷言錯誤訊息並比對資料不變（另含：`p_dry_run` 為 null／不傳、顧客帶 email、預約帶 `access_token`、Demo 未登記在 `admins`） |
| 違反 constraint 的 payload 整個交易失敗，資料不變 | 通過 | 重疊預約（23P01）、設計師名稱為空（23514）、外鍵不存在（23503）、作品集超過 12 張（`PORTFOLIO_LIMIT`） |
| dry-run 以外的真實錯誤不被吞掉 | 通過 | 上述 constraint 案例都是在 `p_dry_run = true` 下仍回傳對應錯誤 |
| `anon`／`authenticated` 執行失敗；service_role 可執行 | 通過 | `anon`、一般帳號、**已登記 `admins` 的帳號（Demo 的身分）**呼叫兩個函式皆 `42501`；service_role 成功 |
| `demo_list_storage_objects` 非白名單 bucket 拒絕；含子目錄 | 通過 | 拒絕 `avatars`、空字串、大小寫不同、null；`demo-seed` 回傳 ≥45 筆含三層路徑，涵蓋 seed 引用的全部作品集路徑；三個公開 bucket 筆數與 Storage API 遞迴結果一致 |
| `_down.sql` 完整移除兩個函式 | **未在正式庫實跑** | 內容僅兩個 `drop function if exists` 與查詢；見殘留風險 |
| 掃描測試：整合測試不得出現非 dry-run 呼叫 | 通過 | 掃描 tests/ 全部檔案，只有一處 `rpc("reset_demo_data")`；`dryRun` 型別不含 `false`；scripts／lib／app 沒有任何呼叫 |

## 審查處理

架構、安全、測試三個子代理（architect、security-reviewer、test-engineer）已審查；沒有 Critical／High，意見是 agent 意見、不等於核准。處置如下（**含 SQL 的修改需要重新套用 0024**，`create or replace` 可重複執行）：

| 項目（來源） | 處置 |
|---|---|
| 架構 M1：只鎖 appointments，其他被覆寫的表可被並行寫入 | **已修正（SQL）**：一條 `lock table` 鎖住 11 張表（順序 customers → appointments → 其他，對齊 create_appointment 避免死結） |
| 架構 M2：Dashboard 手動建的 Webhook 在 dry-run 看不見、真實還原才觸發 | **已修正（SQL）**：守門區檢查被覆寫表上是否有白名單以外的觸發器，有就 raise；之後新增觸發器（如 TASK-116）要同步更新白名單 |
| 架構 M3／安全 M2／測試 A3：快照 `select *` 會把個資與 access_token 印進失敗輸出；PostgREST 1000 列截斷 | **已修正（測試）**：每列只留 sha256；讀到列數必須等於總數，否則直接失敗；快照另含 `auth.users` 與四個 bucket 的物件清單 |
| 安全 M1／測試 A1、A2：型別與文字掃描可被繞過；掃描沒掛在 `test:demo-reset` | **已修正（測試）**：`callReset` 加執行期護欄（不是 true／null／"omitted" 就丟錯）；掃描改為全 repo 白名單（任何副檔名）；掃描測試加進 `vitest.demo-reset.config.ts` 的 include。**未做**：DB 端第二道門（見殘留風險） |
| 安全 L1：作品集最低筆數 0 | **已修正（SQL）**：`portfolio_images` 至少 1 筆 |
| 安全 L2：`demo_user_id` 選填 | **已修正（SQL）**：必填且必須與查到的相同；TASK-109 呼叫前要補上 |
| 安全 L3／測試 C6：RD001 不看 `p_dry_run` | **已修正（SQL）**：非 dry-run 時 `raise` 往外丟 |
| 架構 L1：admins 檢查太晚 | **已修正（SQL）**：移到守門區 |
| 測試 A4：兩個案例在有真實 Demo 帳戶時空轉但顯示 passed | **已修正**：改用 `ctx.skip()`，會顯示 skipped；本次跑的是拋棄式 Demo 帳戶，這兩個案例有實際執行 |
| 測試 A5：並行測試不證明互斥 | **已改名並註明**「不死鎖、不改資料」；鎖的互斥未驗證，列為殘留風險 |
| 測試 A6：守門案例只斷言有錯 | **已修正**：逐案斷言具體錯誤訊息（`PGRST202` 等）；補型別錯誤案例 |
| 測試 B1：`audit_log` 刪除範圍的斷言是套套邏輯、Demo 列為 0 時沒驗到 | **已修正**：刪除套套邏輯；新增案例以拋棄式 Demo 帳戶與另一位管理員各寫一筆稽核列（結束後清除），斷言只計入 1 筆且資料不變 |
| 測試 B3：storage 欄位斷言偏弱 | **已修正**：比對名稱集合、`owner_id` 型別 |
| 安全 L4：DB 用 `->> 'is_demo' = 'true'`、TS 用布林 | **不改**：與已套用的 0021 一致，結果只會是失敗而非越權 |
| 安全 L5／L6、架構 Info：測試期間正式庫有拋棄式管理員帳號、dry-run 短暫鎖寫入 | 接受；建議離峰單獨執行，中斷後再跑一次即清除 |
| 安全 L7／架構 L2：`demo_list_storage_objects` 受 1000 列限制 | 記入 TASK-109：回傳剛好 1000 列要中止 |
| 架構 L3：回傳比卡片多（`deleted`、`counts` 多三項） | 已寫入 decisions.md；TASK-109 定義回應型別 |
| 架構 L4：掃描測試在 TASK-109 合法新增呼叫時會失敗 | 記入 TASK-109：把呼叫檔加進白名單，不得刪除這個測試 |
| 架構 L5：逾時 | dry-run 約 0.6 秒；`authenticator`／`service_role` 的 `statement_timeout` 請在 TASK-112 前以 `select rolname, rolconfig from pg_roles ...` 確認 |
| 架構 L6／L7、Info：並行前台預約邊界、TASK-116 觸發器須放行還原路徑、還原後 Next.js 快取、刪除真實預約不寄通知 | 記入 TASK-109／112／116 |
| **重置閘門（使用者選 A）** | **已實作（SQL，需重新套用 0024）**：真實還原需要閘門開著，成功時同一交易內關閘門；閘門函式與資料表只有 service_role／函式能碰；新增 4 個整合測試（權限、資料表不可讀、開關與期限、dry-run 不受影響也不消耗閘門）。**「閘門關閉時拒絕真實還原」未實跑**（失敗代價是清空正式庫），由 0024 尾端自我檢查確認函式本文含閘門檢查。擋的是程式 bug／誤呼叫，**擋不住持有 service role key 的人** |
| 測試 A7：`_down.sql` 沒有證據 | **未做**：見殘留風險 |


## 殘留風險與已知限制

- **真實還原路徑（`p_dry_run = false`）從未被執行**：dry-run 與真實路徑共用同一段程式碼，差別只在最後是否 `raise RD001`；真實路徑只有「不回滾、提交」這一步沒被實跑驗證。第一次真實還原是 TASK-112，需使用者明確同意並先完成備份（TASK-117）。
- dry-run 會鎖住 `appointments`（exclusive，擋寫入約 0.6 秒）；測試期間若有前台預約同時進來會短暫等待。
- 真實還原時間會比 dry-run 略長（需 commit 與索引維護），預估仍在數秒內；PostgREST 逾時要等 TASK-109/112 實測。
- **重置閘門擋不住金鑰外洩**：持有 service role key 的人可以自己 `demo_reset_open_gate` 再還原。閘門擋的是程式 bug 與誤呼叫；若要連金鑰外洩也擋，需讓 open 要求另一組只存雜湊的密鑰（與 service role key 分開存放），未做，屬使用者可再決定的強化。
- **鎖的互斥未驗證**（並行測試只證明不死鎖、不改資料）。
- 目前正式庫**沒有真實 Demo 帳戶**，測試使用拋棄式 `is_demo` 帳戶；TASK-099／112 建立真實 Demo 帳戶後，這份測試會改用它（不修改它）。
- `demo_list_storage_objects` 受 PostgREST 預設單次最多 1000 列限制；目前最大 bucket 約 45 個物件。
- `_down.sql` 與回滾未在正式庫演練。

## 後續

- TASK-109（還原編排）呼叫這兩個函式；`demo_list_storage_objects` 回傳的 `owner_id` 供 admin-assets 孤兒清理判斷（TASK-113 實測欄位是否存在，目前不存在時為 null）。
- TASK-116 的上限已由使用者決定：services 10、designers 5、customers 24、appointments 640。
