# AI-Ready 任務卡

## Metadata

- 任務：多位設計師 「作品集」頁籤（上傳、刪除、12 張上限）
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：多位設計師
- 上層 User Story：管理設計師作品集
- 分軌：前後端串接
- 前置任務（dependsOn）：TASK-067, TASK-069
- 狀態：就緒前審查中（人工已於 2026-10-21 核准；動工前先完成 architect／security-reviewer 架構審查）
- 風險等級：中（檔案上傳與 Storage／資料列兩邊一致性）
- Agent owner：Claude Code
- 人工核准者：使用者

## 目標

完成「作品集」頁籤：格狀顯示作品（最新在前）、上傳、刪除、上傳中狀態、達上限停用。新做 `PortfolioManager`
元件並登記回 design-system inventory。

## 情境包（Context Pack）

- 相關檔案：
  - `ai/artifacts/多位設計師/mockups/admin-designers-variant-a.html`（畫面 5）
  - `components/ui/ImageUploadField.tsx`、`lib/store-settings.ts`（檔案類型／大小驗證與上傳流程）
  - TASK-067 架構筆記 B（張數 trigger）、D（路徑與白名單）
- 既有模式：先上傳 Storage、成功後才寫資料列；資料列寫入失敗時嘗試刪除剛上傳的檔案。
- 假設：一次只上傳一張（選多檔時只取第一張並提示），降低部分失敗的複雜度。
- 未知事項：無。
- 允許變更的檔案：
  - `lib/admin/designers.ts`（新增 `listPortfolio`、`uploadPortfolioImage`、`deletePortfolioImage`）
  - `components/ui/PortfolioManager.tsx`（新增，跨頁共用元件）
  - `app/admin/_components/DesignerPortfolioTab.tsx`（新增）
  - `app/admin/_components/DesignerEditView.tsx`（掛載頁籤、頁籤上的數字）
  - `ai/context/design-system.md`（S4 inventory 登記 `PortfolioManager`）
  - `tests/admin/designers.test.ts`、`tests/components/portfolio-manager.test.tsx`、`tests/designers.integration.test.ts`
- 不得觸碰：前台作品集（TASK-074）。

## 需求

- 上傳格：jpg/png/webp、5MB，錯誤時格子顯示行內錯誤；達 12 張時停用並顯示「已達 12 張上限，請先刪除舊作品」。
- 上傳中：新格子顯示 spinner；完成後出現在最前面。
- 刪除：二次確認 → 刪資料列 → 刪 Storage 檔案。〔審查〕檢查 `remove()` 回傳 `data.length === 1`，不是 1 時給店長
  看得到的警告（「圖片已從作品集移除，但檔案可能仍可透過原網址存取，請稍後再試或聯絡管理者」）。作品集可能是有臉的
  顧客照片，不能讓刪除靜默失敗。
- 〔審查〕上傳前用 canvas 重新編碼成 webp（去除 EXIF 的 GPS 與拍攝時間，也擋掉多格式混合檔案）。
- 〔審查〕trigger 擋下第 13 張時，依固定訊息前綴 `PORTFOLIO_LIMIT` 對應文案，不比對錯誤訊息全文。
- 資料庫 trigger 擋下第 13 張時，前端顯示同一句上限文案。

## 驗收標準

- 上傳後重新整理仍在；刪除後前台（TASK-074 完成後）不再顯示。
- 第 13 張無論從前端或直接 API 都無法新增。

## 實作備註

- `storage_path` 存完整物件路徑，刪除時用它，不從網址反推。

## 驗證契約

- 單元測試：檔案驗證、上限判斷、資料列寫入失敗時清除剛上傳的檔案。
- 整合測試：admin 上傳／刪除成功；第 13 張被拒；anon 寫入 Storage 與資料表被拒。〔審查〕刪除後公開網址回 400／404
  （不能只驗資料列消失）；只使用 `__TEST__` 設計師。
- E2E 測試：Browser 走查上傳 3 張 → 刪 1 張 → 重新整理。
- 型別檢查／Lint／Build：`npx tsc --noEmit`、`npm run lint`、`npm run build`
- 螢幕截圖：作品集頁籤（空狀態、上傳中、達上限）。
- 安全性檢查：security-reviewer 檢查上傳路徑產生方式、MIME／大小限制、白名單。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：
- 已知限制：
- 後續任務：TASK-074
