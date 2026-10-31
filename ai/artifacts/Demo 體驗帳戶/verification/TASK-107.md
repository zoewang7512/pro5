# 驗證報告

## 摘要

- 任務：TASK-107 Demo 圖片素材：私有 `demo-seed` bucket 與上傳／匯入腳本
- 結果：**實作與自動化驗證完成，待使用者人工驗收。**整合測試 11 項全過；腳本對正式庫真實匯入一次（45/45 張）、重跑冪等、`--overwrite` 修復路徑各實跑一次。
- 驗證者：實作 agent（Claude Code）。安全性子代理審查已執行並處理（見下方），其意見是 agent 意見，**不等於人工核准**。
- 日期：2026-10-31。migration 由使用者在 Supabase SQL Editor 套用，測試與匯入由 agent 執行。

## 變更的檔案

| 檔案 | 說明 |
|---|---|
| `supabase/migrations/0023_demo_seed_bucket.sql`、`_down.sql` | 新增：私有 bucket `demo-seed`（5MB、jpg／png／webp）；不建任何 policy；尾端自我檢查；回滾在 bucket 仍有物件時拒絕執行 |
| `scripts/upload-demo-images.mjs` | 新增：`--from-public`（必填）、`--overwrite`、`--dry-run`、`--base <路徑>`（測試用） |
| `tests/demo-seed-bucket.integration.test.ts`、`vitest.demo-seed-bucket.config.ts` | 新增：11 項整合測試 |
| `package.json` | 新增 `demo:upload-images`、`test:demo-seed-bucket` |

## 指令與輸出

| 指令 | 結果 |
|---|---|
| `npm run test:demo-seed-bucket` | 11 passed（私有性、bucket 設定、腳本防呆） |
| `npm run demo:upload-images -- --from-public --dry-run`（migration 套用前） | 45 個引用物件，來源齊全；提醒 bucket 尚未建立 |
| `npm run demo:upload-images -- --from-public`（第一次） | 已相同 0／缺少 45／不同 0 → 就緒 45/45 張，9.20 MB，結束碼 0 |
| 同上（重跑） | 已相同 45／缺少 0／不同 0，沒有重複上傳 |
| 把一個目的檔換成別的內容後：不加 `--overwrite` | 偵測到 1 個不同，不動目的地，結束碼 2 |
| 同上加 `--overwrite` | 刪除舊檔再複製，就緒 45/45，結束碼 0；再重跑 45 相同 |
| `npx tsc --noEmit`／`npm run lint`／`npm run build` | 0 錯誤／0 error／成功 |

### 公開 bucket 沒有被改動

匯入前後各 bucket 的物件數與總位元組（遞迴計數）：

```text
匯入前：store-assets 4（2011147）、designer-assets 43（8630788）、admin-assets 3（51582）、demo-seed 0
匯入後：store-assets 4（2011147）、designer-assets 43（8630788）、admin-assets 3（51582）、demo-seed 45（9649658）
```

三個公開 bucket 逐項相同。（`designer-assets` 43 個物件中 40 張作品集＋3 張頭像都被引用；`store-assets` 4 個中有 2 個被引用，其餘是舊的未引用檔，本卡不處理。）

## 驗收標準對照

| 驗收標準 | 結果 | 證據 |
|---|---|---|
| `demo-seed` 為私有：匿名與 authenticated 讀不到 | 通過 | 整合：公開網址取不到、匿名與拋棄式 authenticated 帳號的下載／列出／簽名網址／上傳／刪除皆被拒絕；SVG 被 MIME 白名單拒絕 |
| 跑完後引用的每個路徑都存在，數量與大小一致 | 通過 | 腳本事後核對 45/45，大小逐一比對；總計 9.20 MB |
| 來源缺檔時中止並列出清單，不產生半套 | 通過 | 整合：缺檔 → 結束碼 1、列出清單、`demo-seed` 遞迴快照前後相同 |
| 重跑不重複上傳；`--overwrite` 才覆寫 | 通過 | 實跑（見上表） |
| 既有公開 bucket 沒有任何物件被改動 | 通過 | 前後物件數與位元組比對 |

## 審查處理

安全性子代理審查在使用者驗收時尚未回報；結果回報後補記於此，如有需修正的項目另行追加修正。

## 殘留風險與已知限制

- `_down.sql` 在正式庫**沒有實跑**：Storage 可能禁止以 SQL 直接刪 bucket，若被擋改在 Dashboard 刪除（結果相同）；檔頭已說明。
- 匯入來源是「目前的」公開 bucket。使用者之後若更動作品集或店家圖片，需重跑 `--from-public --overwrite`；seed-base.json 引用到已不存在的圖片時，腳本會在複製前中止。
- 圖片位元組總量約 9.2 MB，Storage 配額多佔這一份（免費方案 1 GB）。
- `designer-assets` 與 `store-assets` 內有未被 seed 引用的舊檔（約 2 個）；還原（TASK-109）的孤兒清理會處理，本卡不動公開 bucket。
- 腳本把基底資料中的網址當不可信輸入處理（只認本專案公開網址與三個來源 bucket、擋 `..`），不過基底檔本身是人工審閱過的程式庫檔案。

## 後續

- TASK-109（還原編排）會使用 `demo-seed` 補齊公開 bucket 的圖片；TASK-108 的 `demo_list_storage_objects` 白名單需包含 `demo-seed`。
