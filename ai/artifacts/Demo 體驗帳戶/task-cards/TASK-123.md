# AI-Ready 任務卡

## Metadata

- 任務：services／store_settings 文字欄位長度 CHECK
- 上層規格：[`feature-spec.md`](../feature-spec.md)；來源：[`verification/TASK-116.md`](../verification/TASK-116.md)（三方審查）
- 上層 Epic：Demo 體驗帳戶
- 上層 User Story：濫用防護與緊急開關
- 分軌：後端
- 前置任務（dependsOn）：TASK-116
- 狀態：草稿（**待使用者核准數字與動工**）；**Demo 入口開放前必須完成（TASK-112 的前置條件）**
- 風險等級：高（migration）
- Agent owner：Claude Code
- 人工核准者：待使用者核准

## 目標

0027 限制了列數，但 `services.name`／`description`（0001）與 `store_settings` 的 `name`／`address`／`logo_url`／`cover_image_url`（0006）在資料庫層沒有長度上限（`store_settings` 只限制 description 500、phone 20）。Demo 可對既有列反覆 PATCH 塞入數 MB 字串，繞過列數上限（實際上限取決於 API 閘道的請求大小，未實測）。

## 需求（草稿）

- 對上述欄位加長度 CHECK（建議 `services.name` ≤ 60、`description` ≤ 500；`store_settings.name`／`address` ≤ 200；兩個 URL 欄位 ≤ 2048，數字待核准）。
- 套用前先查既有資料是否都符合（不符合要先處理，否則 migration 失敗）。
- 同步前端驗證與錯誤文案（`lib/admin/services.ts`、店家設定表單），避免使用者看到通用錯誤。
- 對所有管理員生效（不只 Demo）：這是資料完整性規則，不是 Demo 專屬。

## 注意

- 若新增觸發器的表在 `reset_demo_data` 的覆寫範圍內，必須同步更新最新那份 `reset_demo_data` 的觸發器白名單（`tests/lib/demo-row-caps-migration.test.ts` 的全域不變量會在漏補時失敗）。
- 沿用 0027 的做法：預篩 claims 字串、SECURITY DEFINER、search_path 為空、API 角色不可執行、尾端自我檢查、`_down.sql`、SQL Editor 回滾式驗證腳本、整合測試 on／off 兩種模式。

## 允許變更的檔案（預估）

- `supabase/migrations/00NN_text_length_checks.sql` 與 `_down.sql`
- `lib/admin/services.ts`、店家設定相關驗證與表單、對應測試
- `ai/context/decisions.md`

## 驗證契約（草稿）

- 單元測試、整合測試（拋棄式帳號）、`test:demo-reset` 與既有回歸、`npx tsc --noEmit`、`npm run lint`、`npm run build`。
- 動工前補完整驗收標準。

## 完成證據

（待填）
