# AI-Ready 任務卡

## Metadata

- 任務：Storage 擁有者限制與 Demo 上傳上限（migration，RESTRICTIVE policy）
- 上層規格：[`feature-spec.md`](../feature-spec.md)；架構筆記：[`architecture-notes.md`](../architecture-notes.md)
- 上層 Epic：Demo 體驗帳戶
- 上層 User Story：濫用防護與緊急開關
- 分軌：後端
- 前置任務（dependsOn）：TASK-097
- 狀態：草稿（待人工核准）
- 風險等級：高
- Agent owner：Claude Code
- 人工核准者：待使用者核准

## 目標

補上兩個 Storage 缺口：(1) `admin-assets` 的 update／delete 只檢查 `is_admin()`，Demo 能刪掉或換掉 `designer001` 的頭像，而還原刻意不動 `designer001`，成為永久的跨使用者影響；(2) Demo 可無限上傳 5MB 檔案，可能灌爆免費方案 Storage 配額、拖垮整個正式專案。**只新增 RESTRICTIVE policy，不改既有 policy。**

## 情境包（Context Pack）

- 相關檔案：
  - `supabase/migrations/0007_admin_profile.sql`（`admin-assets` 的既有 policy，第 135 到 171 行）
  - `supabase/migrations/0006_store_settings.sql`、`0017_designers.sql`（其他公開 bucket 的 policy）
  - `ai/artifacts/Demo 體驗帳戶/architecture-notes.md` D8、D11
- 既有模式：在 `storage.objects` 上建立 policy 的既有寫法；整合測試用拋棄式帳號與拋棄式物件（`__TEST__` 前綴）。
- 假設：
  - Demo 以 JWT 內 `auth.jwt() -> 'app_metadata' ->> 'is_demo' = 'true'` 判斷，不碰 `auth` schema。
  - `storage.objects.owner_id` 會記錄上傳者（目前專案內沒有任何 migration 使用，**需實測確認欄位存在與型別**）。
  - 每帳戶物件數上限暫定 30（每個公開 bucket）；還原會清除 Demo 的孤兒，所以每日重置。資料庫列數的上限暫不處理（需使用者決定，見架構筆記第 8 節第 2 項）。
- 未知事項：
  - `owner_id` 欄位是否存在、與 `auth.uid()::text` 的比對是否可行。
  - RESTRICTIVE policy 在 SQL Editor 的建立權限（既有 migration 已有建立 `storage.objects` policy 的先例）。
  - Storage 上傳在 RLS 檢查「物件數」時的並行行為（上限是軟上限，可接受少量超出）。
- 允許變更的檔案：
  - `supabase/migrations/00NN_storage_owner_and_demo_caps.sql` 與 `_down.sql`（新增；編號以動工當時的最大編號為準，檔頭加依賴檢查）
  - `tests/storage-owner.integration.test.ts`、`vitest.storage-owner.config.ts`（新增）
  - `package.json`（新增 `test:storage-owner`）
  - `ai/context/decisions.md`
- 不得觸碰：
  - 既有 migration 與既有 policy
  - `designer001` 真實帳號與其頭像物件（測試只用拋棄式帳號與拋棄式物件）

## 需求

- 對 `storage.objects` 新增 **RESTRICTIVE** 的 update 與 delete policy：`bucket_id = 'admin-assets'` 時必須 `owner_id = auth.uid()::text`（非 `admin-assets` 的 bucket 不受影響）。
- 對 Demo（JWT `is_demo`）在 `admin-assets`、`store-assets`、`designer-assets` 三個 bucket 的 insert 新增 RESTRICTIVE policy：該使用者在該 bucket 擁有的物件數必須小於上限（暫定 30）。非 Demo 不受上限約束。
- `_down.sql` 完整移除新增的 policy。
- 檔頭註明：只新增 policy、套用前後非 Demo 帳號行為不變；套用順序；回滾。

## 驗收標準

- 拋棄式管理員 A 上傳的 `admin-assets` 物件，拋棄式管理員 B 無法刪除或更新；A 自己可以。
- 既有的後台頭像上傳、更換、移除流程（`designer001` 的正常使用）不受影響（`test:account` 通過）。
- 拋棄式 Demo 帳號在某個公開 bucket 上傳第 31 個物件被拒絕；拋棄式非 Demo 管理員不受上限約束。
- `designer-assets` 與 `store-assets` 的既有後台流程（`test:designers`、`test:store-settings`）通過。
- `_down.sql` 後 B 又能刪除 A 的物件（證明 policy 已移除）。

## 實作備註

- 若 `owner_id` 不可用，整張卡回報並改為記錄殘留風險，由使用者決定是否接受 Demo 可刪 `designer001` 頭像。
- 測試結尾清除所有 `__TEST__` 物件與拋棄式帳號。

## 驗證契約

- 單元測試：不適用。
- 整合測試：`npm run test:storage-owner`；`test:account`、`test:designers`、`test:store-settings` 回歸。
- E2E 測試：不適用（串接於 TASK-112）。
- 型別檢查：`npx tsc --noEmit` 無錯誤
- Lint：`npm run lint` 無錯誤
- Build：`npm run build` 成功
- 螢幕截圖：不適用。
- 安全性檢查：只新增 RESTRICTIVE policy；不影響既有 policy 與非 Demo 帳號；Demo 判斷來自 JWT 而非 `auth` schema。

## 審查關卡

架構、安全性、驗證（測試工程）；高風險，動工前須人工核准。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：
- 已知限制：
- 後續任務：
