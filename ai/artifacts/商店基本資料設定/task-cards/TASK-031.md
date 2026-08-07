# AI-Ready 任務卡

## Metadata

- 任務：商店基本資料設定 品牌圖片（Logo／封面圖）上傳、更換、移除
- 上層規格：`ai/artifacts/商店基本資料設定/feature-spec.md`
- 上層 Epic：商店基本資料設定
- 上層 User Story：上傳／更換 Logo 或封面圖
- 分軌：前端（含 Supabase Storage 上傳整合）
- 前置任務（dependsOn）：TASK-029
- 狀態：完成（人工已於 2026-08-07 驗收通過）
- 風險等級：高（本專案首次檔案上傳功能，需正確處理格式／大小驗證、儲存路徑、RLS 邊界，避免
  被濫用上傳惡意或超大檔案）
- Agent owner：Claude Code
- 人工核准者：待補

## 目標

在 TASK-029 建立的頁面骨架與 Storage bucket 上，接上「品牌圖片」卡片（依已核准 mockup 變體
B）的上傳能力：Logo／封面圖各自可選檔即自動上傳、更換、移除，並依 `screen-spec-商店設定.md`
新做「圖片上傳（Image Upload Field）」元件，完成後登記回 `design-system.md` 的 S4 inventory。

## 情境包（Context Pack）

- 相關檔案：
  - `app/admin/_components/StoreSettingsForm.tsx`（TASK-029 骨架，本卡新增品牌圖片卡片）
  - `lib/store-settings.ts`（TASK-029 讀取函式，本卡新增上傳／更新 URL／移除函式）
  - `lib/supabase/client.ts`（Storage 上傳需要的 client，比照既有 client 建立方式）
  - `ai/artifacts/商店基本資料設定/screen-spec-商店設定.md`（「本畫面新做的元件」段落，圖片
    上傳元件的視覺設計）
  - `ai/artifacts/商店基本資料設定/mockups/store-settings-variant-b.html`（已核准 mockup，
    品牌圖片卡片版面）
  - `ai/context/design-system.md`（S4 inventory，完成後新增一列登記）
- 既有模式：
  - `components/ui/` 目錄下客製元件的既有慣例（例如 `MonthPicker.tsx`：依既有 token 拼版面、
    純函式邏輯抽到 `lib/`、涵蓋必要狀態）。
  - `Result<T>` 錯誤處理模式。
- 假設：
  - 允許格式：`image/jpeg`、`image/png`、`image/webp`。實作階段確認 TASK-029 已在
    `0006_store_settings.sql` 的 `storage.buckets.allowed_mime_types` 設定伺服器端強制
    （見該 migration），本卡前端 `validateStoreImageFile` 只檢查瀏覽器回報的 `File.type`
    （多半由副檔名推導），**不做檔案內容 magic bytes 嗅探**——修正本段原先「同時檢查副檔名
    與實際 MIME type」的描述，實際只檢查 `File.type` 一項；在「只有 is_admin() 能上傳＋
    bucket 層強制白名單」的威脅模型下，內容嗅探不是必要防線，security-reviewer 審查已確認
    此差異可接受，僅記錄澄清避免日後誤解為已做內容驗證。
  - 大小上限：5MB。實作階段確認 TASK-029 已在同一 migration 設定
    `storage.buckets.file_size_limit`，是伺服器端強制的最終防線；前端驗證純粹是體驗優化。
  - 上傳路徑：`logo/<uuid>.<ext>`、`cover/<uuid>.<ext>`（沿用 TASK-029 的路徑慣例，不使用
    使用者原始檔名）。
  - 「移除」只清空 `store_settings` 對應 URL 欄位，不刪除 Storage 裡的舊檔案物件（避免額外
    的刪除失敗處理路徑；孤兒檔案的清理留待未來視需要另立任務，非本卡範圍，需在完成證據記錄
    此已知限制）。
  - 「更換」＝上傳新檔案＋更新 URL 欄位（不主動刪除舊檔案物件，理由同上）。
- 未知事項：
  - Supabase Storage 用戶端 SDK（`supabase.storage.from(bucket).upload()`）的實際錯誤形狀
    需在實作階段確認，用於對應到「格式錯誤」「大小超限」「網路錯誤」等前端錯誤文案。
- 允許變更的檔案：
  - `app/admin/_components/StoreSettingsForm.tsx`
  - `components/ui/ImageUploadField.tsx`（新增）
  - `lib/store-settings.ts`
  - `ai/context/design-system.md`（S4 inventory 新增一列）
  - `tests/components/image-upload-field.test.tsx`（新增）
- 不得觸碰：
  - `StoreSettingsForm.tsx` 裡 TASK-030 負責的「基本資訊」文字欄位區塊。
  - `supabase/migrations/0006_store_settings.sql`（bucket／policy 若需調整，先確認是否屬於
    TASK-029 範圍內的修正，不在本卡新增額外 migration）。

## 需求

- WHEN 設計師在 Logo 或封面圖上傳區塊選擇或拖曳檔案 THE SYSTEM SHALL 先驗證格式與大小，通過
  後立即上傳至 `store-assets` bucket 並更新 `store_settings` 對應 URL 欄位，成功後區塊切換為
  預覽態（縮圖＋「更換」「移除」按鈕）。
- WHEN 檔案格式或大小不符 THE SYSTEM SHALL 顯示對應行內錯誤（見 screen-spec 文案），不觸發
  上傳，不影響已有的設定。
- WHEN 設計師在預覽態點擊「更換」 THE SYSTEM SHALL 允許重新選擇檔案，走同一套驗證與上傳流程，
  成功後以新圖取代。
- WHEN 設計師點擊「移除」 THE SYSTEM SHALL 清空對應 URL 欄位並寫入 `store_settings`，區塊切換
  回未上傳狀態。
- WHEN 上傳進行中 THE SYSTEM SHALL 顯示上傳中狀態（遮罩＋載入指示），該區塊按鈕暫時停用，避免
  重複觸發。

## 驗收標準

- 設計師可上傳 Logo／封面圖，各自獨立運作（其中一個上傳失敗不影響另一個）。
- 格式或大小不符時正確擋下並顯示錯誤，不寫入 `store_settings`。
- 更換與移除功能正確運作，`store_settings` 對應 URL 欄位正確更新。
- 非管理員無法上傳至 `store-assets` bucket（沿用 TASK-029 建立的 RLS 邊界）。
- 圖片上傳元件已登記回 `design-system.md` 的 S4 inventory。

## 實作備註

- 圖片上傳元件依 `screen-spec-商店設定.md` 的視覺設計實作（虛線邊框預設態、縮圖預覽態、上傳
  中遮罩態、錯誤態邊框變色），涵蓋既有 design-craft 要求的五態（含 disabled：上傳中時更換/
  移除按鈕停用）。
- 若 Supabase Storage 用戶端 SDK 對超過大小上限的檔案是在上傳後才回錯誤（而非前端能提早攔
  截），仍須確保前端在選檔當下就先做本地檔案大小檢查（`File.size`），不必等網路來回。

## 驗證契約

- 單元測試：檔案格式／大小驗證純函式；`ImageUploadField` 元件的狀態切換（預設/上傳中/預覽/
  錯誤），比照既有 `tests/components/` 慣例。
- 整合測試：對真實 Supabase 專案驗證 Storage bucket 上傳權限邊界（管理員可上傳、非管理員被
  拒）；可併入 TASK-033。
- E2E 測試：Browser 工具走查上傳→預覽→更換→移除全流程（併入 TASK-033 或本卡自行走查）。
- 型別檢查：`npx tsc --noEmit`
- Lint：`npm run lint`
- Build：`npm run build`
- 螢幕截圖：未上傳、上傳中、已上傳預覽、上傳錯誤（格式／大小）。
- 安全性檢查：格式與大小驗證不能只做前端（若 Storage 層能設定 MIME 白名單／大小上限，一併
  設定；若不能，於完成證據記錄此殘留風險）；儲存路徑使用固定命名（uuid），不接受使用者輸入
  的檔名；確認 RLS 邊界。

## 完成證據

- 變更的檔案：`lib/store-settings.ts`（新增 `validateStoreImageFile`／`uploadStoreImage`／
  `removeStoreImage`）、`components/ui/ImageUploadField.tsx`（新增）、
  `app/admin/_components/StoreSettingsForm.tsx`（接上 ImageUploadField，取代原 TASK-029
  的唯讀 `ImagePlaceholder`）、`ai/context/design-system.md`（S4 inventory 新增
  ImageUploadField 一列）、`tests/components/image-upload-field.test.tsx`（新增）、
  `tests/store-settings.test.ts`（新增 `uploadStoreImage`／`removeStoreImage`／
  `validateStoreImageFile` 相關測試）
- 執行過的指令：`npx tsc --noEmit`、`npm run lint`、`npm run build`、`npx vitest run`
  （17 files / 130 tests passed，既有測試無回歸）
- 測試輸出：新增 22 個 `store-settings.test.ts` 測試（含 F1 修正後的 prototype 屬性防呆
  案例）、6 個 `image-upload-field.test.tsx` 元件測試（預設／已有圖片／格式錯誤／上傳成功／
  上傳失敗／移除成功）
- 螢幕截圖：Browser 工具對真實 Supabase 專案手動走查——用 service role 腳本直接上傳一張測試
  圖片並寫入 `logo_url`，重新整理後確認 UI 正確顯示縮圖預覽＋「更換」「移除」按鈕；點擊
  「移除」確認畫面切回未上傳的拖放區，並以腳本查詢 `store_settings.logo_url` 確認資料庫
  真的被清空；測試上傳的 Storage 物件已清除，不留殘留。**已知限制**：Browser 工具（
  `mcp__Claude_Browser__computer`）沒有原生檔案選擇器互動能力，無法在瀏覽器裡真的模擬
  「點擊上傳區塊→開啟系統選檔對話框→選檔」這個第一步，因此「選檔上傳成功」路徑改以
  （1）`tests/components/image-upload-field.test.tsx` 對 `<input type="file">`
  觸發 `change` 事件搭配 mock 過的 `uploadStoreImage` 驗證前端邏輯正確呼叫，（2）上述真實
  Supabase 腳本直接呼叫與 `uploadStoreImage` 相同的 Storage upload API 驗證後端與 UI 顯示
  邏輯正確銜接，兩者互補涵蓋，但不是同一次「使用者在瀏覽器裡選檔」的單一端到端操作。
- 安全性審查：security-reviewer 首輪「approve with required fixes」，發現並修正：
  - **F1（必修）** `validateStoreImageFile` 用 `file.type in ALLOWED_MIME_TYPES` 會命中
    `Object.prototype` 繼承屬性（例如 `"constructor"`），讓白名單名不符實——已改用
    `Object.hasOwn()`，並補上對應測試案例。
  - **F2（建議，已採納）** `handleFile`／`handleRemove` 沒有 `try/finally`，例外會讓元件
    卡在「處理中…」且無法自救——已包 `try/catch/finally`，例外時顯示泛用錯誤並解除 busy。
  - **F3（建議，已採納）** 上傳中若元件卸載，`URL.revokeObjectURL` 可能不會被呼叫、且對
    已卸載元件 `setState`——已加 `mountedRef` guard，比照 `StoreSettingsForm.tsx` 既有的
    cancelled guard 模式。
  - **F5（測試缺口，已補）** `uploadStoreImage`／`removeStoreImage` 原本零單元測試覆蓋——
    已補 8 個測試，包含核心不變量「上傳路徑固定為 `logo/<uuid>.<ext>`，與使用者可控的原始
    檔名完全無關（即使檔名刻意帶路徑穿越字元）」、依 `kind` 更新正確欄位、storage 上傳失敗
    與 RLS 靜默擋下（受影響列數為 0）皆正確回傳泛用錯誤不誤報成功。
  - **F6（文件澄清，已採納）** 本段「假設」原先描述「同時檢查副檔名與實際 MIME type」與
    實作不符（只檢查 `File.type`）——已修正措辭，見上方「假設」段落。
  - 額外採納：拖放區塊補上 `role="button"`／`tabIndex`／`onKeyDown`，讓鍵盤使用者也能觸發
    上傳（security-reviewer 順帶提出的可及性觀察，非安全性阻擋項，一併處理）。
  - 審查確認無阻擋性（blocking）問題：路徑構造無法被使用者輸入影響（無路徑穿越）、前端
    驗證正確定位為體驗優化而非安全邊界（真正邊界是 TASK-029 已審查的 bucket 層設定與
    `is_admin()` RLS）、圖片顯示走安全的 `<img src>` sink、無硬編碼密鑰或敏感資料記錄。
- 已知限制：
  1. 「移除」只清空 `store_settings` 對應 URL 欄位，不刪除 Storage 裡的舊檔案物件——孤兒
     檔案仍可透過原本的 public URL 被存取，直到有人另立任務清理（TASK-029/031 規劃階段已
     記錄的既知取捨）。
  2. 額外的孤兒物件來源（security-reviewer 審查發現，先前未記錄）：`uploadStoreImage` 若
     Storage 上傳成功、但緊接著 `store_settings` 欄位更新失敗，該次上傳的物件會殘留成孤兒
     （沒有走過「移除」也會發生）。發生機率低（僅在網路剛好於兩次 API 呼叫間中斷、或
     `store_settings` 那唯一一列被意外刪除等罕見情境），且不影響安全邊界，接受為已知限制。
  3. 無使用者層級的儲存配額限制——只要通過格式與大小驗證，管理員可無限次上傳，長期可能
     累積儲存成本；本專案為單一管理員信任網域，接受此風險，未來若需要可另立任務加上物件
     計數或定期清理機制。
  4. `store_settings.logo_url`／`cover_image_url` 欄位本身沒有限制必須是
     `store-assets` bucket 底下的網址——本卡的寫入路徑（`uploadStoreImage`／
     `removeStoreImage`）一定寫入正確網域，但因為是直接 table update（無 RPC 可集中做
     格式驗證），理論上未來若有其他寫入路徑被加進來，可能寫入任意外部網址；目前唯一寫入者
     是本卡程式碼，風險有界，記錄供未來擴充時留意。
- 後續任務：TASK-032（顧客前台品牌顯示）、TASK-033（整合驗證，含將 F5 的 mock 測試延伸為
  對真實 Supabase 專案的端到端整合測試）
