# AI-Ready 任務卡

## Metadata

- 任務：Demo 圖片素材：私有 demo-seed bucket 與上傳／匯入腳本
- 上層規格：[`feature-spec.md`](../feature-spec.md)；架構筆記：[`architecture-notes.md`](../architecture-notes.md)
- 上層 Epic：Demo 體驗帳戶
- 上層 User Story：Demo seed 資料
- 分軌：後端
- 前置任務（dependsOn）：TASK-097, TASK-106
- 狀態：草稿（待人工核准）
- 風險等級：中
- Agent owner：Claude Code
- 人工核准者：待使用者核准

## 目標

建立只有 service role 能存取的私有 bucket `demo-seed` 存放 seed 原圖，並提供腳本把圖片從目前的公開 bucket 匯入。還原時再由此處補齊到公開 bucket。

## 情境包（Context Pack）

- 相關檔案：
  - `supabase/migrations/0006_store_settings.sql`、`0007_admin_profile.sql`、`0017_designers.sql`（既有 bucket 設定與路徑規則）
  - `lib/designers.ts`（`parsePortfolioStoragePath`、作品集路徑規則）
  - `lib/admin/account.ts`（頭像路徑 `avatar/<uuid>.<ext>`）
- 既有模式：bucket 設定 `on conflict do update`、MIME 白名單（jpg／png／webp，不含 svg）、5MB 上限；私有 bucket 不建立任何 policy。
- 假設：
  - 作品集已由使用者補齊（2026-10-30 確認），所以匯入來源就是目前公開 bucket；**不做本機資料夾上傳模式**（使用者沒有提供素材資料夾，需要時另開卡）。
  - `demo-seed` 內的相對路徑與公開 bucket 完全相同：`demo-seed/<bucket>/<原路徑>`，且依 `seed-base.json` 的固定 id 與路徑（TASK-106）。
- 未知事項：
  - 無。
- 允許變更的檔案：
  - `supabase/migrations/00NN_demo_seed_bucket.sql` 與 `_down.sql`（新增；編號以動工當時的最大編號為準，檔頭加依賴檢查）
  - `scripts/upload-demo-images.mjs`（新增，只有 `--from-public` 模式，可加 `--overwrite`）
  - `package.json`（新增 `demo:upload-images`）
  - `tests/demo-seed-bucket.integration.test.ts`、`vitest.demo-seed-bucket.config.ts`（新增）
- 不得觸碰：
  - 既有 bucket 的設定與 policy
  - 公開 bucket 內的任何既有物件（本卡只讀取、不刪除）

## 需求

- migration：`insert into storage.buckets` 建立私有 bucket `demo-seed`（`public = false`，5MB 上限，MIME 白名單同既有），不建立任何 `storage.objects` policy；附 `_down.sql`。
- `--from-public`：依 `seed-base.json` 引用的路徑，用 service role 把公開 bucket 物件複製到 `demo-seed/<bucket>/<路徑>`；來源不存在則列出並以非 0 結束，不得靜默略過。
- 冪等：目的地已存在且大小與 eTag 相同則略過；預設不覆寫，需 `--overwrite` 才先刪再複製（Storage `copy` 不會覆寫既有檔案）。
- 輸出總張數與總大小；不印出任何金鑰。

## 驗收標準

- `demo-seed` 為私有：匿名與 `authenticated` 請求都讀不到物件（整合測試）。
- `--from-public` 跑完後，`seed-base.json` 引用的每個路徑在 `demo-seed` 都存在，數量與大小與來源一致。
- 來源缺檔時中止並列出清單，且不產生任何半套。
- 重跑不重複上傳；`--overwrite` 才覆寫。
- 既有公開 bucket 沒有任何物件被改動（前後物件數比對）。

## 實作備註

- **做匯入之前先確認使用者作品集已完整**（使用者已於 2026-10-30 確認）；若之後又更動，需重跑 `--from-public --overwrite`。
- 整合測試的拋棄式物件用 `__TEST__` 前綴並清除。

## 驗證契約

- 單元測試：不適用。
- 整合測試：`npm run test:demo-seed-bucket`（私有性、權限）；腳本實跑輸出。
- E2E 測試：不適用。
- 型別檢查：`npx tsc --noEmit` 無錯誤
- Lint：`npm run lint` 無錯誤
- Build：`npm run build` 成功
- 螢幕截圖：不適用。
- 安全性檢查：bucket 私有且無 policy；腳本不覆寫公開 bucket；不印出金鑰。

## 審查關卡

安全性、驗證（測試工程）。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：
- 已知限制：
- 後續任務：
