# AI-Ready 任務卡

## Metadata

- 任務：服務項目管理 前後端串接驗證與端到端測試
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：服務項目管理
- 上層 User Story：全部（整合驗證）
- 分軌：整合
- 前置任務（dependsOn）：TASK-034, TASK-035, TASK-036
- 狀態：完成（人工已於 2026-08-18 驗收通過）
- 風險等級：中（涉及 RLS 權限邊界的整合驗證，比照 TASK-033 的風險等級判定）

## 目標

新增 `npm run test:services` 整合測試，涵蓋 `services` 表的 RLS 邊界（管理員可新增/編輯/
切換上下架，非管理員皆被拒）與下架後對 `get_available_slots`／`create_appointment` 的實際
影響；重跑既有整合測試（`test:rls`／`test:booking`／`test:admin-booking`／
`test:business-hours`／`test:store-settings`）確認無回歸；Browser 工具桌面尺寸 E2E 走查
後台服務項目管理頁完整流程，並確認顧客前台既有服務清單行為無回歸；更新 `project-map.md`。

## 情境包（Context Pack）

- 相關檔案：
  - `tests/store-settings.integration.test.ts`／`vitest.store-settings.config.ts`：最近一次
    新增整合測試檔案的既有格式範本，`test:services` 比照建立獨立的 `vitest.services.config.ts`
    （刻意不用萬用字元互相撿到其他整合測試檔案，沿用既有慣例）。
  - `tests/booking.integration.test.ts`：`get_available_slots`／`create_appointment` 既有的
    呼叫與斷言寫法，本卡新增「服務下架後兩個 RPC 的行為」案例可直接參考既有呼叫模式。
  - `ai/context/project-map.md`：更新「常用指令」表新增 `test:services`，並在服務相關描述中
    補充服務項目管理後台頁面的存在。
- 既有模式：
  - 各整合測試檔案用「離今天 N 天以上」的 offset 錯開彼此的日期範圍；若本卡新增的
    `create_appointment` 相關案例需要建立測試預約，依 `project-map.md` 記錄的既有 offset
    表挑選未使用的區段，避免撞期。
  - `services` 資料非固定列數（可新增/下架），測試新增的服務項目測試完畢後於 `afterAll`
    刪除（真刪除僅限測試建立、確定未被任何預約參照的資料列，符合 feature-spec「只做下架、
    不支援真刪除」的產品範圍——這是測試清理邏輯，不是產品功能，不牴觸該範圍決策）。
- 假設：
  - 測試建立的服務項目使用明顯可辨識的名稱前綴（例如 `TEST_MARKER` 或既有慣例的測試標記），
    避免與正式服務項目混淆，測試結束後清除。
  - 下架後 `create_appointment` 對該服務的預約請求，實際回傳的錯誤碼以既有 RPC 定義為準
    （查證 `supabase/migrations/0002_booking_flow.sql` 服務驗證段落的既有錯誤碼），本卡驗證
    既有行為而非新增。
- 未知事項：無。
- 允許變更的檔案：
  - `tests/services.integration.test.ts`（新增）
  - `vitest.services.config.ts`（新增）
  - `package.json`（新增 `test:services` script）
  - `ai/context/project-map.md`（更新）
  - `ai/context/decisions.md`（若驗證過程發現需要記錄的架構決策）
- 不得觸碰：
  - 既有五個整合測試檔案的既有測試案例邏輯（僅執行重跑確認無回歸，不修改內容，除非重跑
    發現真的回歸才需要另外討論）。
  - `app/_components/booking/ServiceListSection.tsx`（本卡只驗證既有行為無回歸，不修改）。

## 需求

- 新增整合測試涵蓋：
  - `services` 寫入：管理員可新增／編輯／切換 `is_active`；anon／非管理員 authenticated
    寫入被拒。
  - 下架後 `get_available_slots` 對該服務不再回傳任何時段；`create_appointment` 對該服務的
    新預約請求被拒絕（既有錯誤碼，非本卡新增）。
  - 重新上架後上述兩個 RPC 恢復正常行為。
- 重跑 `test:rls`／`test:booking`／`test:admin-booking`／`test:business-hours`／
  `test:store-settings`，確認無回歸。
- Browser 工具桌面尺寸走查：登入後台→服務項目管理頁→新增服務項目→編輯→下架→切到顧客
  前台確認不再顯示→回後台重新上架→前台恢復顯示。
- 確認顧客前台既有服務清單（載入中／載入失敗／空狀態）行為不受本 Epic 新增程式碼影響。

## 驗收標準

- `npm run test:services` 全數通過，對真實 Supabase 專案驗證 RLS 邊界與下架/上架對兩個 RPC
  的實際影響皆正確。
- 既有五組整合測試重跑無回歸。
- `npx tsc --noEmit`／`npm run lint`／`npm run build` 皆通過。
- Browser 工具走查完整流程無誤，並取得螢幕截圖或等效驗證證據（若截圖工具當下不可用，依
  既有慣例改用 accessibility tree／`get_page_text`／`javascript_tool` 讀取取得驗證證據，並
  在完成證據中註明）。
- `project-map.md` 更新反映服務項目管理後台頁面與新增指令。

## 實作備註

- 比照既有慣例，測試日期／時段若涉及 `create_appointment` 測試案例，選擇未被其他整合測試
  檔案佔用的 offset 區段（實作前查看 `project-map.md` 記錄的既有範圍表）。
- 若 Browser 工具當下無法產生真正螢幕截圖，比照既有既有處理方式（見 TASK-018／033 完成
  證據記錄），改用 accessibility tree／`get_page_text` 驗證並記錄為已知限制，不視為阻擋
  驗收的缺陷。

## 驗證契約

- 單元測試：（若 TASK-034／035／036 尚未涵蓋齊全）補齊遺漏的純函式測試。
- 整合測試：`npm run test:services`（新增）；重跑 `test:rls`／`test:booking`／
  `test:admin-booking`／`test:business-hours`／`test:store-settings`。
- E2E 測試：Browser 工具桌面尺寸走查（見上方「需求」）。
- 型別檢查：`npx tsc --noEmit`
- Lint：`npm run lint`
- Build：`npm run build`
- 螢幕截圖：服務項目管理頁完整流程（新增/編輯/下架/重新上架）、顧客前台服務清單下架前後
  對照。
- 安全性檢查：RLS 邊界的整合測試即為本卡的安全性驗證核心；風險等級為中，建議額外執行
  `security-reviewer` 子代理審查（比照 TASK-033 的判斷標準，實作階段依當時實際變更範圍
  決定是否需要）。

## 完成證據

詳見 `tools/kanban/cards/TASK-037.json` 的 `evidence` 欄位（commands／findings／residual）。
摘要：

- 變更的檔案：`tests/services.integration.test.ts`（新增，13 個整合測試）、
  `vitest.services.config.ts`（新增）、`package.json`（新增 `test:services` script）、
  `ai/context/project-map.md`（更新常用指令表與 offset 表）。
- 執行過的指令：`npx tsc --noEmit`／`npm run lint`／`npm run build` 皆通過；
  `npm run test:services`（新增，13/13）；`test:rls`（6/6）／`test:booking`（19/19）／
  `test:admin-booking`（13/13）／`test:business-hours`（18/18）／`test:store-settings`
  （11/11）重跑皆無回歸；`npx vitest run`（18 files／155 tests）無回歸。
- 測試輸出：`services` RLS 邊界（新增/編輯/切換上下架權限、anon 讀不到已下架項目）與
  下架對 `get_available_slots`（空陣列）／`create_appointment`（`SERVICE_INACTIVE`）的
  影響、重新上架後恢復正常，13 案例全數通過。
- 螢幕截圖：Browser 工具對真實 Supabase 專案完整 E2E 走查（新增→前台顯示→編輯→
  下架→前台不再顯示→清除測試資料→確認清單還原），取得多張畫面文字/截圖證據。
- 已知限制：無新增；沿用 TASK-034/035/036 既有記錄的已知限制。
- 後續任務：無（本 Epic 兩個新增 User Story 至此皆完整涵蓋；第三個 User Story「顧客端瀏覽
  服務項目列表」已由既有實作涵蓋，本卡驗證無回歸）。
