# AI-Ready 任務卡

## Metadata

- 任務：多位設計師 「提供服務」頁籤與新增服務的預設行為
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：多位設計師
- 上層 User Story：設定設計師提供的服務
- 分軌：前後端串接
- 前置任務（dependsOn）：TASK-067, TASK-069, TASK-078（兩張卡都改 ServicesTable.tsx／ServiceFormDialog.tsx，人工決定 TASK-078 先做）
- 狀態：完成（人工驗收通過，2026-10-22；見 [`verification/TASK-070.md`](../verification/TASK-070.md)；人工已於 2026-10-21 核准；動工前 architect／security-reviewer 審查已於 2026-10-22 完成並採納，見「動工前審查定案」）
- 風險等級：低（`designer_services` 單純 insert／delete，RLS 已由 TASK-067 建立）
- Agent owner：Claude Code
- 人工核准者：使用者

## 目標

在設計師編輯頁完成「提供服務」頁籤，讓店長逐項開關服務；並在後台新增服務成功時提示「新服務預設不開給
任何設計師」。

## 情境包（Context Pack）

- 相關檔案：
  - `ai/artifacts/多位設計師/mockups/admin-designers-variant-a.html`（畫面 4）
  - `app/admin/_components/DesignerEditView.tsx`（TASK-069 建立的頁籤框架）
  - `app/admin/_components/ServiceFormDialog.tsx`、`ServicesTable.tsx`（新增服務成功提示）
  - `lib/admin/services.ts`（`listServices`）
  - `app/admin/_components/BusinessHoursForm.tsx`（Switch 即時儲存、失敗回復的既有寫法）
- 既有模式：Switch 即時寫入，失敗時回復並 Toast。
- 假設：只列「上架中」的服務；下架中的服務即使設計師有開也不顯示（資料保留）。
- 未知事項：無。
- 允許變更的檔案：
  - `lib/admin/designers.ts`（新增 `listDesignerServiceIds`、`setDesignerService`）
  - `app/admin/_components/DesignerServicesTab.tsx`（新增）
  - `app/admin/_components/DesignerEditView.tsx`（掛載頁籤、頁籤上的數字）
  - `app/admin/_components/ServicesTable.tsx` 或 `ServiceFormDialog.tsx`（新增成功的 Toast 文案）
  - `tests/admin/designers-write.test.ts`（單元測試，與 TASK-069 的寫入函式測試同檔）、
    `tests/designers.integration.test.ts`、`tests/components/designer-services-tab.test.tsx`（新增）、
    `tests/components/designer-edit-view.test.tsx`（頁籤標籤的數字）、
    `tests/components/service-form-dialog.test.tsx`（新增；新增服務成功 Toast 文案，原清單漏列，實作時補上）
- 不得觸碰：前台服務列表過濾（TASK-073）。

## 需求

- 每個上架中的服務一列（名稱、時長、價格、Switch），開關即時寫入。
- 頁籤標題顯示目前開啟的服務數。
- 頁籤下方說明：「關閉服務不會影響已經成立的預約，只會影響之後的新預約。」
- 新增服務成功 Toast：「已新增服務。新服務預設不開給任何設計師，請到「設計師」頁開啟。」

## 驗收標準

- 開關後重新整理頁面仍維持設定；寫入失敗時 Switch 回復原狀。
- 新增服務後該服務在所有設計師的頁籤都是關閉狀態。

## 實作備註

- 連點 Switch 時，前一次請求未完成前停用該 Switch，避免 insert／delete 交錯。

## 動工前審查定案（architect／security-reviewer，2026-10-22，非人工核准）

- `setDesignerService`：先用 `isDesignerId` 驗 designerId／serviceId，不通過直接回通用錯誤、不送請求。開啟＝`insert`，
  只有 `error.code === "23505"` 視為成功（不比對 message／details，不用 upsert）；關閉＝`delete().eq("designer_id")
  .eq("service_id").select("service_id")`，欄位名稱寫死，**回傳剛好 1 列才算成功**（RLS 擋下 delete 時 PostgREST
  回成功但 0 列；0 列或多於 1 列一律回通用失敗）。例外（fetch 失敗）一律轉成通用錯誤。錯誤訊息不外洩。
- 畫面：`DesignerServicesTab` 在設計師載入完成後就掛載並常駐（切頁籤只隱藏，比照基本資料），頁籤標籤的數字
  在未開啟該頁籤前就要有。服務清單與 designer_services 由子元件持有，父層只存 `serviceCount: number | null`
  （`null` 不顯示數字），子元件在載入與寫入的事件處理中回報，不在 effect 內同步 setState。
- 數字口徑＝「上架中且已開啟」，與 `listDesigners` 的 `service_count` 一致；Switch 與數字由同一份 Set 推導。
- 寫入失敗或例外：Toast＋重讀 `listDesignerServiceIds` 以資料庫為準；重讀也失敗才回復該列原值。
- 服務清單與 designer_services 任一讀取失敗：顯示錯誤 Alert，不畫 Switch。
- 逐列「寫入中」鎖定（`Set<serviceId>`），不同列可並行。
- 無障礙：每個 Switch 有 `aria-label`（開放「服務名稱」）；服務名稱只放 JSX 文字節點。
- 不做（登記為已知限制）：關掉某服務的最後一位設計師時不提示（TASK-073 前台過濾一併收斂）；候選清單算完到 insert 之間
  剛好關閉服務仍會成立預約（與 TASK-068 已接受的殘留同類）。

## 驗證契約

- 單元測試：`setDesignerService` 對 enabled true／false 分別呼叫 insert／delete；重複 insert（主鍵衝突 23505）視為成功；
  23503／42501 回通用訊息；錯誤的 uuid 不送請求；delete 恰好兩個 eq；delete 回 0 列不當成功。
- 整合測試：admin 開關成功（含重複開啟冪等）；非管理員 insert 被擋、delete 0 列且資料列仍在；anon 只讀得到啟用中設計師的 `designer_services`。
- E2E 測試：Browser 走查開關服務 → 重新整理確認保留。
- 型別檢查／Lint／Build：`npx tsc --noEmit`、`npm run lint`、`npm run build`
- 螢幕截圖：提供服務頁籤（預設、寫入中）。
- 安全性檢查：沿用 TASK-067 的 RLS，不新增 migration；但要驗證 delete 被 RLS 擋下（非管理員）時函式回失敗而非成功（見「動工前審查定案」）。

## 完成證據

- 變更的檔案：`lib/admin/designers.ts`、`app/admin/_components/DesignerServicesTab.tsx`（新增）、`DesignerEditView.tsx`、
  `ServiceFormDialog.tsx`；測試 `tests/admin/designers-write.test.ts`、`tests/designers.integration.test.ts`、
  `tests/components/designer-services-tab.test.tsx`、`designer-edit-view.test.tsx`、`service-form-dialog.test.tsx`
- 執行過的指令、測試輸出、螢幕截圖、已知限制：見 [`verification/TASK-070.md`](../verification/TASK-070.md)
- 後續任務：TASK-073（前台依此過濾設計師與服務）；TASK-081（後台表單未儲存離開提示，驗收時另開）
