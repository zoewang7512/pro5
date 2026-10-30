# 驗證報告

## 摘要

- 任務：TASK-102 一鍵進入限流：`demo_entry_attempts` 資料表與 `demo_entry_check` RPC
- 結果：**實作與自動化驗證完成，待使用者人工驗收。**單元 56 項、整合 21 項全過；回滾（`_down.sql`，殘留 0／0）與 up 重跑各實跑一次。
- 驗證者：實作 agent（Claude Code）。架構、安全、測試三個子代理審查已執行並處理，其意見是 agent 意見，**不等於人工核准**。
- 日期：2026-10-30。migration 由使用者在 Supabase SQL Editor 套用，測試由 agent 執行。

## 變更的檔案

| 檔案 | 說明 |
|---|---|
| `supabase/migrations/0022_demo_entry_rate_limit.sql`、`_down.sql` | 新增：資料表、RPC、授權、尾端自我檢查；回滾移除兩者 |
| `lib/demo/rate-limit.ts` | 新增（`server-only`）：`checkDemoEntryLimit`、`normalizeIp`、`ipBucket`、`getClientIp` |
| `tests/lib/demo-rate-limit.test.ts` | 新增：56 項單元測試 |
| `tests/demo-rate-limit.integration.test.ts`、`vitest.demo-rate-limit.config.ts` | 新增：21 項整合測試 |
| `package.json` | 新增 `test:demo-rate-limit` |
| `ai/context/decisions.md` | 新增 TASK-102 條目 |

## 與任務卡的差異（皆經審查提出、已寫入 decisions.md）

1. 全站限流由「每小時」改為「每 5 分鐘 14 次」：Supabase 登入限額是每 IP 每 5 分鐘 30 次（使用者於 Dashboard 確認），必須同單位比較；固定窗交界最多放行 2 倍，14×2=28<30。
2. 保留期 2 小時、窗長上限 3600 秒（卡片原為 1 天）：縮小攻擊者輪替 bucket 灌大資料表的影響。
3. 新增：HMAC 金鑰至少 32 字元、`x-real-ip` 只在 Vercel 採用、RPC 3 秒逾時、參數驗證。

## 指令與輸出

| 指令 | 結果 |
|---|---|
| `npx vitest run tests/lib/demo-rate-limit.test.ts` | 56 passed |
| `npm run test:demo-rate-limit`（第二版 migration，`_down` → up 重套之後） | 21 passed（1 檔） |
| `npx tsc --noEmit` | 0 錯誤 |
| `npm run lint` | 0 error |
| `npm run build` | 成功 |
| 測試後殘留檢查（`demo_entry_attempts` 列數、`demoratelimit` 拋棄式帳號） | 0、0 |

整合測試在第一版 migration 下通過兩次（20 項），第二版（審查修正後）通過一次（21 項）；第二版因 `window=3601` 出錯、2.5 小時前的列被清掉兩項斷言，舊版會失敗，證明新版函式已生效。

## 驗收標準對照

| 驗收標準 | 結果 | 證據 |
|---|---|---|
| RPC 出錯時回傳不允許 | 通過 | 單元：RPC error、全站那次出錯、網路錯誤、**卡住不回應 3 秒逾時（實際等待）**、回傳非布林、client 建立丟例外、缺或太短的金鑰 |
| 同 /64 內兩個 IPv6 同 bucket；不同 IPv4 不同 bucket | 通過 | 單元：`normalizeIp` 與 `checkDemoEntryLimit` 的 bucket 比對（以 bucket 過濾，不靠呼叫順序） |
| 前 N 次 true、第 N+1 次 false；下一個時間窗恢復 true | 通過 | 整合：上限 3 → `[true,true,true,false,false]`；6 秒窗翻轉後恢復 true，且留下兩列（count 1 與 3） |
| 平行 20 個請求，允許次數恰好等於上限 | 通過 | 整合：上限 7，平行 20 → 恰 7 次 true，且該列 `count = 20` |
| `anon`／`authenticated` 呼叫 RPC 失敗並回權限錯誤 | 通過 | 整合：兩者皆 `42501`；被拒的呼叫沒留下計數；兩者對資料表讀、寫、刪皆 `42501` |
| 資料表內沒有明文 IP | 通過（見限制） | 單元：送給資料庫的參數不含 IP、bucket 格式 `ip:<64 位十六進位>`、金鑰不同結果不同；整合：掃整表 bucket 格式 |
| `_down.sql` 完整移除資料表與函式 | 通過（人工） | 使用者實跑 `_down.sql`，內建查詢輸出 `leftover_functions = 0`、`leftover_tables = 0`（使用者貼回）；之後重套 up，整合測試 21 項通過 |
| up 可重複執行 | 通過 | 第二版 up 套用在「`_down` 之後」，另第一版→第二版（`create or replace`）亦曾直接套用過 |

## 審查處理

**已修正**（架構／安全／測試三個子代理）：全站時間窗單位不一致（架構、安全皆列最高）；保留期縮短＋`'2 hours'` 取代 `'1 day'`；清除移到累加前；`x-real-ip` 只在 Vercel 採用；金鑰長度檢查；逾時真正被演練；`rpc().abortSignal()` 鏈對真實 PostgREST 驗證；單元測試不再靠呼叫順序；清除案例與長時間窗案例避開整點邊界。

**未處理、列為殘留風險**
- 全站已滿時仍會繼續寫入 IP 列（每請求最多兩次資料庫寫入）。保留期縮為 2 小時後，列數上限約為「2 小時內的請求數」；改成唯讀預檢複雜度高，未採用。
- 全站上限是阻斷服務的槓桿：每 IP 5 次／5 分鐘，3 個 IP 即可持續擋住入口。使用者已接受（架構筆記第 8 節第 6 項）。
- 「沒有明文 IP」的整合斷言本身很弱（bucket 皆為十六進位時 IP 的正規表達式不可能匹配，且 `^ip:[0-9a-f]{64}$` 也放行未加鑰的 sha256）。真正的保證是單元測試（參數不含 IP、金鑰不同結果不同）。
- 固定時間窗的特性：窗界交界最多放行 2 倍；被拒絕的呼叫也累加計數。
- 視窗翻轉整合案例依本機時鐘與資料庫時鐘相差小於 0.5 秒；時鐘偏差大或網路突然變慢時可能偶發失敗（會失敗，不會假過）。
- 完整單元測試套件（`npm test`）在本機負載高時，約 33～40 項 React 元件測試會 `Test timed out`；調成 `--testTimeout=60000` 重跑那 10 個檔案 225 項全過。與本卡無關，未處理。
- `DEMO_RATE_LIMIT_SECRET` 需在 Vercel 與本機設定（≥ 32 字元，與其他密鑰不同）；`.env.example` 已有此變數。TASK-103 之前不會用到。
- 資料庫 `has_table_privilege` 自我檢查未列入 Postgres 17 的 `maintain`（舊版本無此權限類型）；`revoke all` 已涵蓋。

**給後續卡片**
- TASK-103：`checkDemoEntryLimit` 的 `reason` 有 `ip_limit`／`global_limit`／`error`；log 類別建議把 `error` 另記為 `rate_limit_error`，避免維運分不出「被限流」與「限流壞了」。端點以 `getClientIp(request.headers)` 取 IP。
- TASK-109：還原的健康檢查用 Supabase 登入額度，與一鍵進入共用同一個 IP；全站上限（14／5 分鐘）已預留空間。
- 回滾後（`_down.sql`）一鍵進入端點呼叫 RPC 會出錯而一律拒絕：下線限流要同步停用 Demo 入口或讓端點略過這一步。
