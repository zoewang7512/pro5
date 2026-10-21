# AI-Ready 任務卡

## Metadata

- 任務：多位設計師 「提供服務」頁籤與新增服務的預設行為
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：多位設計師
- 上層 User Story：設定設計師提供的服務
- 分軌：前後端串接
- 前置任務（dependsOn）：TASK-067, TASK-069, TASK-078（兩張卡都改 ServicesTable.tsx／ServiceFormDialog.tsx，人工決定 TASK-078 先做）
- 狀態：就緒前審查中（人工已於 2026-10-21 核准；動工前先完成 architect／security-reviewer 架構審查）
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
  - `tests/admin/designers.test.ts`、`tests/designers.integration.test.ts`
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

## 驗證契約

- 單元測試：`setDesignerService` 對 enabled true／false 分別呼叫 insert／delete；重複 insert（主鍵衝突）視為成功。
- 整合測試：admin 開關成功；anon 只讀得到啟用中設計師的 `designer_services`。
- E2E 測試：Browser 走查開關服務 → 重新整理確認保留。
- 型別檢查／Lint／Build：`npx tsc --noEmit`、`npm run lint`、`npm run build`
- 螢幕截圖：提供服務頁籤（預設、寫入中）。
- 安全性檢查：不適用（沿用 TASK-067 的 RLS）。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：
- 已知限制：
- 後續任務：TASK-073（前台依此過濾設計師與服務）
