# AI-Ready 任務卡

## Metadata

- 任務：Demo 專屬資料筆數上限（設計師最多 5 位等，migration）
- 上層規格：[`feature-spec.md`](../feature-spec.md)；架構筆記：[`architecture-notes.md`](../architecture-notes.md)
- 上層 Epic：Demo 體驗帳戶
- 上層 User Story：濫用防護與緊急開關
- 分軌：後端
- 前置任務（dependsOn）：TASK-097, TASK-106
- 狀態：草稿（待人工核准）
- 風險等級：高
- Agent owner：Claude Code
- 人工核准者：待使用者核准

## 目標

避免單一 Demo session 以腳本無限新增資料而灌爆免費方案的資料庫容量、拖垮整個正式專案：對 Demo 帳戶新增各表的筆數上限，達上限就拒絕新增。一般管理員與 service role（含每日還原）不受影響。

## 情境包（Context Pack）

- 相關檔案：
  - `supabase/migrations/0017_designers.sql`、`0001_core_schema.sql`、`0003_closures_and_buffer.sql`（各表結構與既有 trigger 寫法）
  - TASK-106 產出的 seed（用來決定上限數字）
  - `ai/artifacts/Demo 體驗帳戶/architecture-notes.md` D14
  - `tests/mfa-rls.integration.test.ts`（拋棄式帳號做法）
- 既有模式：`BEFORE INSERT` 觸發器；Demo 判斷來自 JWT 的 `app_metadata.is_demo`，不碰 `auth` schema。
- 假設：
  - 設計師上限 5（使用者指定，含 seed 的設計師，因此 seed 的設計師數必須小於 5 才有可新增空間；若 seed 已達 5，回報由使用者決定）。
  - **其他表的上限數字須在 TASK-106 完成 seed 後，依 seed 筆數的約 2～3 倍列表給使用者核准，核准前不得套用。**
  - 上限是軟上限；並行請求可能略微超出，可接受。
- 未知事項：
  - 各表 seed 筆數（取決於 TASK-106）。
  - 觸發器內以 `count(*)` 檢查在資料量大時的成本（上限很小，預期可忽略）。
  - `audit_log` 是否需要同樣上限（每筆最多約 8KB，由 Demo 的操作產生）——實作時評估並回報。
- 允許變更的檔案：
  - `supabase/migrations/00NN_demo_row_caps.sql` 與 `_down.sql`（新增；編號以動工當時的最大編號為準，檔頭加依賴檢查）
  - `tests/demo-row-caps.integration.test.ts`、`vitest.demo-row-caps.config.ts`（新增）
  - `package.json`（新增 `test:demo-row-caps`）
  - `ai/context/decisions.md`
- 不得觸碰：
  - 既有 migration 與既有 trigger／policy
  - 前端畫面（錯誤顯示沿用既有通用錯誤處理；若 Demo 觸頂時畫面訊息不友善，另開卡回報）

## 需求

- 單一函式 `demo_check_row_cap()`（`security invoker`、`search_path = ''`）供各表 `BEFORE INSERT` 觸發器共用，上限以函式內的常數表或參數傳入，數字集中在一處。
- 只在 `coalesce(auth.jwt() -> 'app_metadata' ->> 'is_demo', '') = 'true'` 時檢查該表目前列數；達上限 `raise exception` 並帶可辨識的訊息。非 Demo 與沒有 JWT 的呼叫（service role、還原）直接放行。
- 涵蓋的表與上限：`designers` ≤ 5（固定）；其餘表（服務、預約、顧客、公休日、作品集、請假等）的數字由使用者核准後填入。
- `_down.sql` 完整移除新增的觸發器與函式。

## 驗收標準

- 拋棄式 Demo 帳號新增設計師到第 6 位被拒絕，前 5 位（含 seed 既有的）可成功。
- 拋棄式非 Demo 管理員不受上限約束；service role 不受約束（還原不被擋）。
- 各表上限在觸發器內只有一個來源，數字與使用者核准的一致。
- 被拒絕時，資料表內容不變，且錯誤訊息可辨識。
- 既有各整合套件（`test:designers`、`test:services`、`test:booking` 等）在套用前後都通過。

## 實作備註

- 核准的數字寫進 `decisions.md`。
- 測試結尾清除拋棄式資料與帳號。

## 驗證契約

- 單元測試：不適用。
- 整合測試：`npm run test:demo-row-caps`；`test:designers`、`test:services`、`test:booking`、`test:admin-booking` 回歸。
- E2E 測試：不適用（串接於 TASK-112）。
- 型別檢查：`npx tsc --noEmit` 無錯誤
- Lint：`npm run lint` 無錯誤
- Build：`npm run build` 成功
- 螢幕截圖：不適用。
- 安全性檢查：只對 Demo 生效；不影響 service role 與一般管理員；Demo 判斷來自 JWT；不碰 `auth` schema。

## 審查關卡

架構、安全性、驗證（測試工程）；高風險，動工前須人工核准。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：
- 已知限制：
- 後續任務：
