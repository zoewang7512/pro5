# AI-Ready 任務卡

## Metadata

- 任務：商店基本資料設定 基本資訊編輯、驗證與儲存
- 上層規格：`ai/artifacts/商店基本資料設定/feature-spec.md`
- 上層 Epic：商店基本資料設定
- 上層 User Story：設定店名、地址、電話、簡介
- 分軌：前端
- 前置任務（dependsOn）：TASK-029
- 狀態：完成（人工已於 2026-08-07 驗收通過）
- 風險等級：低
- Agent owner：Claude Code
- 人工核准者：待補

## 目標

在 TASK-029 建立的頁面骨架上，接上「基本資訊」卡片（依已核准 mockup 變體 B）的編輯能力：
店名／地址／電話／簡介四個欄位可編輯、前端驗證、送出儲存，成功後顯示 Toast。

## 情境包（Context Pack）

- 相關檔案：
  - `app/admin/_components/StoreSettingsForm.tsx`（TASK-029 建立的唯讀骨架，本卡接上編輯）
  - `lib/store-settings.ts`（TASK-029 建立的讀取函式，本卡新增寫入函式）
  - `lib/admin/business-hours.ts`（既有「驗證函式＋`updateBusinessHours`」模式參考）
  - `components/ui/ToastProvider.tsx`（既有成功/錯誤提示）
  - `ai/artifacts/商店基本資料設定/screen-spec-商店設定.md`（已核准畫面規格，變體 B）
  - `ai/artifacts/商店基本資料設定/mockups/store-settings-variant-b.html`（已核准 mockup）
- 既有模式：
  - `BusinessHoursForm.tsx` 的「欄位 touched 狀態＋失焦或送出才顯示錯誤」既有慣例（見
    TASK-019 完成證據記錄的修正）。
  - `Result<T>` 錯誤處理模式，寫入失敗顯示通用 Toast，不外洩原始 Postgres 錯誤內容。
- 假設：
  - 店名必填（前端與後端皆驗證非空白字串，去除頭尾空白後長度需 > 0）；地址／電話／簡介皆
    選填。
  - 電話僅做寬鬆格式驗證（允許數字、`-`、`+`、空格，長度上限 20 字），不做嚴格的台灣門號
    格式檢查（避免擋下合理的市話／分機格式）。
  - 簡介長度上限 500 字（純前端＋後端雙重驗證，資料庫層可另加 `check` constraint，實作階段
    決定是否值得為此加 migration，或先只做應用層驗證）。
  - 儲存為單一 `update`（`id = 1`），不需要處理 `insert`（TASK-029 已 seed 保證有 1 列）。
- 未知事項：無。
- 允許變更的檔案：
  - `app/admin/_components/StoreSettingsForm.tsx`
  - `lib/store-settings.ts`
  - `tests/store-settings.test.ts`（新增，欄位驗證純函式的單元測試；放在 `tests/` 頂層
    而非 `tests/admin/`，對齊 TASK-029 把 `lib/store-settings.ts` 移到 `lib/` 頂層的既有
    路徑慣例）
- 不得觸碰：
  - `app/admin/_components/StoreSettingsForm.tsx` 裡 TASK-031 負責的品牌圖片區塊（若 TASK-031
    尚未完成，本卡只需確保文字區塊與既有唯讀圖片顯示骨架不互相干擾）。
  - `supabase/migrations/`（除非簡介長度需要資料庫層 constraint，若需要則先詢問使用者是否
    要新增 migration，不擅自新增）。

## 需求

- WHEN 設計師編輯店名／地址／電話／簡介欄位 THE SYSTEM SHALL 即時前端驗證（店名非空白、電話
  格式、簡介長度上限），有未儲存變更時「儲存」按鈕啟用。
- WHEN 設計師送出「儲存」且無前端驗證錯誤 THE SYSTEM SHALL 寫入 `store_settings`（`id = 1`），
  成功後顯示成功 Toast 並重新整理顯示的資料。
- WHEN 前端驗證失敗 THE SYSTEM SHALL 阻擋送出，標示錯誤欄位並聚焦第一個錯誤欄位。
- WHEN 寫入失敗（網路或資料庫錯誤） THE SYSTEM SHALL 顯示通用錯誤 Toast，不外洩原始錯誤內容，
  欄位內容維持使用者輸入不被清空。

## 驗收標準

- 設計師可編輯並儲存店名（必填）、地址、電話、簡介（皆選填）。
- 店名清空時無法送出，顯示行內錯誤「店名為必填」。
- 儲存成功後重新整理頁面，資料正確持久化。
- 非管理員（透過既有 RLS，非本卡新增邏輯）無法寫入，沿用 TASK-029 已建立的邊界。

## 實作備註

- 沿用 `screen-spec-商店設定.md` 變體 B 的「基本資訊」獨立卡片版面，卡片有自己的「儲存」
  按鈕，與品牌圖片卡片（TASK-031）互不影響、互不阻塞。
- 若簡介長度上限只做應用層驗證（不加資料庫 constraint），需在程式碼註解說明原因（避免下次
  有人誤以為資料庫層也有保護）。

## 驗證契約

- 單元測試：店名／電話／簡介驗證純函式（`vitest`）。
- 整合測試：對真實 Supabase 專案驗證管理員可成功寫入、非管理員（anon／非管理員
  authenticated）寫入被拒；可併入 TASK-033 的整合測試檔案。
- E2E 測試：Browser 工具走查編輯→驗證錯誤→修正→儲存成功全流程（併入 TASK-033 或本卡自行
  走查皆可，實作階段決定）。
- 型別檢查：`npx tsc --noEmit`
- Lint：`npm run lint`
- Build：`npm run build`
- 螢幕截圖：預設（已有資料）、編輯中、驗證錯誤、儲存中、儲存成功。
- 安全性檢查：確認寫入路徑沿用既有 `is_admin()` RLS 邊界，前端驗證不是唯一防線。

## 完成證據

詳見 `tools/kanban/cards/TASK-030.json` 的 `evidence` 欄位（commands／findings／residual）。
摘要：`tsc`／`lint`／`build` 通過；單元測試 112/112（含新增 10 個驗證函式測試）；新增
`npm run test:store-settings` 11/11（對真實 Supabase 專案）；`test:rls`／`test:business-hours`
重跑無回歸；Browser 工具走查編輯→驗證錯誤→修正→儲存成功→重新整理持久化全流程皆正確。
本卡風險等級低、未新增安全性表面，未派遣 architect／security-reviewer 正式審查，理由見
`evidence.findings`。

後續任務：TASK-031（品牌圖片上傳）、TASK-033（整合驗證）
