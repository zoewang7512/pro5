# AI-Ready 任務卡

## Metadata

- 任務：商店基本資料設定 前後端串接驗證與端到端測試
- 上層規格：`ai/artifacts/商店基本資料設定/feature-spec.md`
- 上層 Epic：商店基本資料設定
- 上層 User Story：全部（整合驗證）
- 分軌：整合
- 前置任務（dependsOn）：TASK-029, TASK-030, TASK-031, TASK-032
- 狀態：草稿
- 風險等級：中
- Agent owner：待指派
- 人工核准者：待補

## 目標

新增 `npm run test:store-settings` 整合測試，涵蓋 `store_settings` 與 Storage bucket 的 RLS
邊界、後台編輯／上傳對真實資料的行為、前台讀取降級行為；重跑既有四組整合測試
（`test:rls`／`test:booking`／`test:admin-booking`／`test:business-hours`）確認無回歸；Browser
工具桌面尺寸 E2E 走查後台商店設定頁與前台首頁品牌顯示的完整流程。

## 情境包（Context Pack）

- 相關檔案：
  - `tests/business-hours.integration.test.ts`（既有「快照原始狀態、測試中改動、afterAll
    還原」模式，`store_settings` 只有 1 列固定資料，比照相同精神處理）
  - `vitest.business-hours.config.ts`（新增 `vitest.store-settings.config.ts` 比照既有格式，
    刻意不用萬用字元互相撿到其他整合測試檔案）
  - `ai/context/project-map.md`（更新常用指令表與資料表清單）
- 既有模式：
  - 各整合測試檔案用「離今天 N 天以上」的 offset 錯開彼此的日期範圍；`store_settings` 不涉及
    日期時段，不需要 offset，但若測試中建立任何測試用預約（用於驗證前台頁面不受品牌區塊影響
    的既有流程），需依 `project-map.md` 記錄的既有 offset 慣例挑選未使用的區段，避免撞期。
- 假設：
  - `store_settings` 測試模式：測試前記錄原始 1 列快照（含圖片 URL 欄位），測試中改動，
    `afterAll` 還原，比照 `business_hours` 既有模式；不新增或刪除列（本表恆為 1 列）。
  - Storage 測試上傳的檔案，測試完畢後清除（`afterAll` 刪除該次測試上傳的物件），避免累積
    測試垃圾檔案。
- 未知事項：無。
- 允許變更的檔案：
  - `tests/store-settings.integration.test.ts`（新增）
  - `vitest.store-settings.config.ts`（新增）
  - `package.json`（新增 `test:store-settings` script）
  - `ai/context/project-map.md`（更新）
  - `ai/context/decisions.md`（若本次驗證發現需要記錄的架構決策）
- 不得觸碰：
  - 既有四個整合測試檔案的既有測試案例邏輯（僅執行重跑確認無回歸，不修改內容，除非重跑發現
    真的回歸才需要另外討論）。

## 需求

- 新增整合測試涵蓋：
  - `store_settings` 讀取：anon／authenticated 皆可讀。
  - `store_settings` 寫入：管理員可寫入四個文字欄位；anon／非管理員 authenticated 寫入被拒。
  - Storage `store-assets` bucket：管理員可上傳；anon／非管理員 authenticated 上傳被拒；已
    上傳物件可被公開讀取（無需驗證的 GET 請求）。
  - 前台讀取降級：`store_settings` 欄位為空時，前台頁面元件正確回退為既有「預約」標題（可用
    元件測試或針對轉換純函式的單元測試涵蓋，視實作階段判斷是否需要整合測試層級）。
- 重跑 `test:rls`／`test:booking`／`test:admin-booking`／`test:business-hours`，確認無回歸。
- Browser 工具桌面尺寸走查：登入後台→商店設定頁編輯基本資訊並儲存→上傳 Logo／封面圖→切到
  顧客前台首頁確認正確顯示→回後台移除圖片→確認前台同步回退。

## 驗收標準

- `npm run test:store-settings` 全數通過，對真實 Supabase 專案驗證 RLS 與 Storage 邊界正確。
- 既有四組整合測試重跑無回歸。
- `npx tsc --noEmit`／`npm run lint`／`npm run build` 皆通過。
- Browser 工具走查完整流程無誤，並取得螢幕截圖或等效驗證證據（若截圖工具當下不可用，依既有
  慣例改用 accessibility tree／`get_page_text`／`javascript_tool` 讀取取得驗證證據，並在完成
  證據中註明）。
- `project-map.md` 更新反映 `store_settings`、Storage bucket、新增指令。

## 實作備註

- 比照既有慣例，測試日期／時段若涉及既有預約資料，選擇未被其他整合測試檔案佔用的 offset
  區段（實作前查看 `project-map.md` 記錄的既有範圍表）。
- 若 Browser 工具當下無法產生真正螢幕截圖（本次規劃階段已知的環境限制），比照
  TASK-018／019／020／021 的既有處理方式，改用 accessibility tree／`get_page_text` 驗證並記錄
  為已知限制，不視為阻擋驗收的缺陷。

## 驗證契約

- 單元測試：（若 TASK-030／031／032 尚未涵蓋齊全）補齊遺漏的純函式測試。
- 整合測試：`npm run test:store-settings`（新增）；重跑 `test:rls`／`test:booking`／
  `test:admin-booking`／`test:business-hours`。
- E2E 測試：Browser 工具桌面尺寸走查（見上方「需求」）。
- 型別檢查：`npx tsc --noEmit`
- Lint：`npm run lint`
- Build：`npm run build`
- 螢幕截圖：後台商店設定頁完整流程、前台首頁品牌顯示前後對照。
- 安全性檢查：RLS 與 Storage 邊界的整合測試即為本卡的安全性驗證核心，額外執行
  `security-reviewer` 子代理審查（風險等級為中，依 `definition-of-ready.md` 高風險項目定義，
  本卡本身非高風險，但涉及檔案處理與權限邊界，建議仍走一輪 security-reviewer）。

## 完成證據

- 變更的檔案：待補
- 執行過的指令：待補
- 測試輸出：待補
- 螢幕截圖：待補
- 已知限制：待補
- 後續任務：無（本 Epic 兩個 User Story 至此皆完整涵蓋）
