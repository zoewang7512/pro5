# AI-Ready 任務卡

## Metadata

- 任務：一鍵進入限流：demo_entry_attempts 資料表與 demo_entry_check RPC
- 上層規格：[`feature-spec.md`](../feature-spec.md)；架構筆記：[`architecture-notes.md`](../architecture-notes.md)
- 上層 Epic：Demo 體驗帳戶
- 上層 User Story：登入頁體驗入口
- 分軌：後端
- 前置任務（dependsOn）：TASK-097
- 狀態：已實作，待人工驗收（見 verification/TASK-102.md）
- 風險等級：中
- Agent owner：Claude Code
- 人工核准者：待使用者核准

## 目標

提供適用於 serverless 的限流機制，供一鍵進入端點使用；以資料庫計數，不依賴記憶體。**這張卡可選**：使用者若決定不做限流，整張移除，TASK-103 略過該步驟。

## 情境包（Context Pack）

- 相關檔案：
  - `supabase/migrations/0019_audit_log.sql`（`revoke all` 再逐一 `grant`、`notify pgrst` 的寫法）
  - `supabase/migrations/0015_explicit_table_grants.sql`
- 既有模式：migration 檔頭說明、`_down.sql`、service_role 專用 RPC 的授權寫法。
- 假設：
  - Supabase Auth 的內建限流以呼叫端 IP 計算，而呼叫端是 Vercel 伺服器，所有訪客與還原的健康檢查共用額度，所以不能替代每位訪客的限流。
  - IP 只存 **HMAC-SHA256（金鑰為 `DEMO_RATE_LIMIT_SECRET`）** 的結果，不存明文；單純 `sha256(ip + 日期)` 的鹽不是祕密，IPv4 空間很小，可被暴力還原。
- 未知事項：
  - Vercel 上取得來源 IP 的可靠方式（`x-real-ip` 或 `@vercel/functions` 的 `ipAddress()`）；取不到時只套用全站上限。
  - Supabase Dashboard 上目前的登入限額（全站上限必須低於它）。
  - 使用者對「全站每小時上限是阻斷服務槓桿」的決定：保留或改為只告警（架構筆記第 8 節第 6 項）。
- 允許變更的檔案：
  - `supabase/migrations/00NN_demo_entry_rate_limit.sql` 與 `_down.sql`（新增；編號以動工當時的最大編號為準，檔頭加依賴檢查）
  - `lib/demo/rate-limit.ts`（新增，`server-only`：包裝 RPC 呼叫與 IP 雜湊）
  - `tests/lib/demo-rate-limit.test.ts`、`tests/demo-rate-limit.integration.test.ts`、`vitest.demo-rate-limit.config.ts`（新增）
  - `package.json`（新增 `test:demo-rate-limit`）
- 不得觸碰：
  - 既有 migration
  - 既有資料表與 RLS

## 需求

- 資料表 `demo_entry_attempts(bucket text, window_start timestamptz, count int, primary key (bucket, window_start))`，啟用 RLS、不建立任何 policy、`revoke all` 後只授權 service_role。
- RPC `demo_entry_check(p_bucket text, p_limit int, p_window_seconds int) returns boolean`：以 `insert … on conflict do update set count = count + 1 returning count` 原子累加，超過上限回傳 false；順手刪除一天前的列。
- 只有 service_role 可執行；`anon`／`authenticated` 呼叫必須被拒絕。
- `lib/demo/rate-limit.ts`：兩個 bucket（每 IP 的 HMAC 每 10 分鐘 10 次；全站每小時的上限為常數可調，**必須低於 Supabase 實際登入限額**）；IPv6 以 /64 為單位；取不到 IP 時只檢查全站。
- **RPC 出錯（網路、權限、逾時）時回傳「不允許」**，不得放行。

## 驗收標準

- RPC 出錯時 `checkDemoEntryLimit` 回傳不允許（單元測試）。
- 同一 /64 內的兩個 IPv6 位址落在同一個 bucket；不同 IPv4 位址落在不同 bucket。
- 同一 bucket 在時間窗內前 N 次回傳 true，第 N+1 次回傳 false；進入下一個時間窗後恢復 true。
- 平行 20 個請求，被允許的次數恰好等於上限（原子性）。
- `anon`／`authenticated` 呼叫 RPC 失敗並回傳權限錯誤。
- 資料表內沒有明文 IP。
- `_down.sql` 完整移除資料表與函式。

## 實作備註

- 整合測試用 `__TEST__` 前綴 bucket 並清除，避免佔用正式的限流額度。

## 驗證契約

- 單元測試：`tests/lib/demo-rate-limit.test.ts`（IP 雜湊、bucket 組合、缺 IP 行為）。
- 整合測試：`npm run test:demo-rate-limit`（時間窗、原子性、權限、清除）。
- E2E 測試：不適用。
- 型別檢查：`npx tsc --noEmit` 無錯誤
- Lint：`npm run lint` 無錯誤
- Build：`npm run build` 成功
- 螢幕截圖：不適用。
- 安全性檢查：授權最小化；無明文 IP；函式 `search_path`。

## 審查關卡

架構、安全性、驗證（測試工程）。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：
- 已知限制：
- 後續任務：
