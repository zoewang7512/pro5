# AI-Ready 任務卡

## Metadata

- 任務：多位設計師 「作品集」頁籤（上傳、刪除、12 張上限）
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：多位設計師
- 上層 User Story：管理設計師作品集
- 分軌：前後端串接
- 前置任務（dependsOn）：TASK-067, TASK-069
- 狀態：完成（人工驗收通過，2026-10-22；實作與驗證完成，見 [`verification/TASK-071.md`](../verification/TASK-071.md)；人工已於 2026-10-21 核准；動工前 architect／security-reviewer 審查已於 2026-10-22 完成並採納，人工決定 4 項，見「動工前審查定案」）
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
  - `lib/admin/designers.ts`（新增 `listPortfolio`、`uploadPortfolioImage`、`deletePortfolioImage`、`removePortfolioFile`）
  - `lib/admin/image-reencode.ts`（`reencodeImage`／`planReencodeSize` 接受選填 `maxDimension`，預設 1024 不變；動工前審查補列）
  - `lib/designers.ts`（新增 `resolvePortfolioImageUrl`、`portfolioLimitMessage`；動工前審查補列，TASK-074 前台重用）
  - `components/ui/PortfolioManager.tsx`（新增，跨頁共用元件）
  - `app/admin/_components/DesignerPortfolioTab.tsx`（新增）
  - `app/admin/_components/DesignerEditView.tsx`（掛載頁籤、頁籤上的數字）
  - `ai/context/design-system.md`（S4 inventory 登記 `PortfolioManager`）
  - 測試：`tests/admin/designers-write.test.ts`（寫入函式與 `reencodeImage` mock 實際放這裡，原清單寫的 `designers.test.ts` 是讀取函式測試）、
    `tests/lib/designers.test.ts`（`resolvePortfolioImageUrl`）、`tests/lib/image-reencode.test.ts`（`maxDimension`）、
    `tests/components/portfolio-manager.test.tsx`、`tests/components/designer-portfolio-tab.test.tsx`、
    `tests/components/designer-edit-view.test.tsx`（頁籤數字）、`tests/designers.integration.test.ts`
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

## 動工前審查定案（architect／security-reviewer，2026-10-22，非人工核准）

人工決定（2026-10-22）：① 作品集長邊 **1600px**（頭像維持 1024）；② 網址白名單**納入 `lib/designers.ts`**；
③ 刪檔失敗給**重試按鈕**；④ 作品集上傳 `cacheControl` **300 秒**。

**資料層**
- 三個函式（及 `removePortfolioFile`）的 designerId 一律先過 `LOWERCASE_ID_PATTERN`（資料庫回傳的小寫 uuid），imageId 先驗證為 uuid，
  才能放進 `new RegExp`；不通過不送請求。重用既有程式：`removeAvatarObject` 改名 `removeDesignerAssetObject` 共用；
  新增 `parsePortfolioStoragePath(path, designerId)` 與 `parseDesignerAvatarPath` 並排，共用 `STORAGE_UUID`。
- 上傳：`reencodeImage(file, { maxDimension: 1600 })` 的 blob 才上傳（任何分支都不得退回原始 File）→ `upload(path, blob,
  { contentType, upsert: false, cacheControl: "300" })`；upload 本身失敗／例外時順手 best-effort `remove([path])`。
  insert `.select("id, image_url, created_at")`。
  - **判定「確定沒寫入」只有兩種**：`code === "P0001"` 且 message 以 `PORTFOLIO_LIMIT` 開頭（回上限文案）；或 `code` 符合
    `/^[0-9A-Z]{5}$/`（SQLSTATE，如 23503／42501，回通用訊息）。這兩種才補刪剛上傳的檔。
  - **其餘一律「結果不明」**（`code` 為 `""`／`"20"`／undefined、拋例外、無 error 但不是剛好 1 列）：用 `storage_path` 重讀
    （`maybeSingle`）。列在 → 視為成功並回傳該列、絕不補刪；重讀成功且沒有 → 才補刪；重讀失敗 → 不補刪（寧可留孤兒檔）。
- 刪除：先用 `id`＋`designer_id` 讀回 `storage_path`（不信任前端）並以完整錨定正規式驗證 → `delete().eq("id").eq("designer_id")
  .select("id")` 要求剛好 1 列 → 成功後才 `remove([path])` 且 `data.length === 1`。delete 結果不明（error／例外）：以 id 重讀，
  列已不在就照樣刪檔（用事先讀到的路徑），列還在就回失敗。0 列不呼叫 remove（別的分頁已刪，後到的一方回失敗）。
  路徑驗證不通過：仍刪資料列，回 `cleanupWarning` 且沒有可重試的路徑。
- `removePortfolioFile(supabase, designerId, path)`：重試用，路徑重新過 `parsePortfolioStoragePath`，`remove()` 剛好刪 1 個才算成功。
- `listPortfolio` 只 select `id, image_url, created_at`（`created_at desc, id desc`，**TASK-073／074 前台用同一排序**）；
  型別與元件 props 不帶 `storage_path`。
- `lib/designers.ts` 的 `resolvePortfolioImageUrl(url, designerId)`：先過 `resolveDesignerAssetUrl`，要求 `search`／`hash` 為空，
  pathname 完整錨定 `^/storage/v1/object/public/designer-assets/portfolio/<該列 designer_id>/<uuid>\.(jpg|png|webp)$`。
  資料庫 constraint 只驗結尾，`image_url` 可以帶 `?portfolio/A/…` 指到別人的頭像或別位設計師的作品，所以顯示層必須用這個。
  **通不過的列不能濾掉**：畫成「圖片無法顯示」的佔位格，照樣算進張數、照樣可以刪除（否則會 12 張只畫 11 格、上傳停用、壞圖刪不掉）。
- 不在 UI 裡刪除後再 fetch 公開網址驗證（快取會誤報）；這項放在整合測試。

**元件與畫面**
- `PortfolioManager` 是純展示元件：不 import `lib/admin/*`、不碰 Supabase；props `items: { id; src: string | null }[]`、`maxImages`、
  `onUpload(file)`、`onDelete(id)`（回傳 `{ ok: true } | { ok: false; error: { message } }`，message 為可直接顯示的文案）。檔案驗證放在
  `uploadPortfolioImage`，元件不呼叫驗證函式。
- **一次只做一件事**：上傳中或刪除中，上傳格與所有刪除按鈕一律停用（單一 busy 鎖），省掉清單競態。`<input>` 不加 `multiple`，
  拖放多檔只取第一張並提示。標題「N / 12 張」，說明文字照 mockup；上限一律用 `DESIGNER_PORTFOLIO_MAX_IMAGES`。
  每格刪除按鈕 `aria-label="刪除第 N 張作品"`，圖片 `alt="作品 N"`、`referrerPolicy="no-referrer"`，不用 `next/image`、不設 `crossOrigin`。
- 容器 `DesignerPortfolioTab`：設計師載入完成後常駐掛載（比照服務頁籤）；任何失敗都重讀清單以資料庫為準；有 `cancelled` 保護；
  載入失敗顯示錯誤 Alert。`cleanupWarning` 用**頁籤內常駐、可關閉的 Alert**（不用 4 秒 Toast），文案「圖片已從作品集移除，但檔案可能仍可透過
  原網址存取，請點「重試刪除檔案」或聯絡管理者」，有路徑時附「重試刪除檔案」按鈕；頁籤另寫：「刪除後，照片最多約 5 分鐘內仍可能被看到。
  顧客要求移除照片時請直接刪除——停用設計師不會刪除檔案。」
- `DesignerEditView`：頁籤數字改成 `counts: Partial<Record<TabValue, number>>`，各頁籤 `aria-label` 不同（「已開啟 N 項」「共 N 張作品」），
  作品集面板常駐掛載，TASK-072 只需再加一項。

**登記為已知限制（不在本卡處理）**
- 孤兒檔沒有清理機制（上傳成功但資料列結果不明、刪檔失敗後重新整理）；可另開掃除卡（service_role 比對 `portfolio/<id>/` 與資料列）。
- 伺服器端不檢查檔案內容：admin 直接打 Storage API 可上傳未經重新編碼的原檔（帶 EXIF）；「去 EXIF」只對 UI 路徑成立。Storage 物件數沒有上限。
- `createImageBitmap` 在檢查解析度之前就解碼整張圖（30000×30000 的 PNG 可能讓店長分頁崩潰），需先解析檔頭才能避免；`image_url`
  的資料庫 constraint 收緊（`substring(...) = storage_path`）另開卡。
- 張數上限的正確性前提是 READ COMMITTED（PostgREST 預設）。
- 網址白名單的前台版本由 TASK-074 套用 `resolvePortfolioImageUrl`。

## 驗證契約

- 單元測試：檔案驗證、上限判斷、資料列寫入失敗時清除剛上傳的檔案。
- 整合測試：admin 上傳／刪除成功；第 13 張被拒；anon 寫入 Storage 與資料表被拒。〔審查〕刪除後公開網址回 400／404
  （不能只驗資料列消失）；只使用 `__TEST__` 設計師。
- E2E 測試：Browser 走查上傳 3 張 → 刪 1 張 → 重新整理。
- 型別檢查／Lint／Build：`npx tsc --noEmit`、`npm run lint`、`npm run build`
- 螢幕截圖：作品集頁籤（空狀態、上傳中、達上限）。
- 安全性檢查：security-reviewer 檢查上傳路徑產生方式、MIME／大小限制、白名單。

## 完成證據

完整內容見 [`../verification/TASK-071.md`](../verification/TASK-071.md)。

- 變更的檔案：`lib/admin/designers.ts`、`lib/admin/image-reencode.ts`、`lib/designers.ts`、`components/ui/PortfolioManager.tsx`（新增）、
  `app/admin/_components/DesignerPortfolioTab.tsx`（新增）、`DesignerEditView.tsx`、`ai/context/design-system.md`；測試
  `tests/admin/designers-write.test.ts`、`tests/lib/designers.test.ts`、`tests/lib/image-reencode.test.ts`、
  `tests/components/portfolio-manager.test.tsx`（新增）、`designer-portfolio-tab.test.tsx`（新增）、`designer-edit-view.test.tsx`、
  `tests/designers.integration.test.ts`
- 執行過的指令、測試輸出、螢幕截圖、已知限制：見驗證報告（tsc／lint／build 通過；全套 771／774，3 項為既有的 `account-settings-view` 逾時，單獨跑全過；
  `test:designers -t TASK-071` 11 項通過；瀏覽器走查通過並已清除測試資料）
- 實作期補充：`reencodeImage`／`planReencodeSize` 新增選填 `maxDimension`（作品集 1600，頭像預設 1024 不變）；`Alert` 的 `action` 會吃掉內建關閉鈕，
  改為把「關閉」放進 `action`
- 已知限制（摘要）：刪除後公開網址因快取最多約 5 分鐘仍可能讀到（整合測試實測）；孤兒檔沒有清理機制；伺服器端不檢查檔案內容；
  `createImageBitmap` 先解碼再檢查解析度；`image_url` 資料庫 constraint 只驗結尾
- 後續任務：TASK-074（前台必須用 `resolvePortfolioImageUrl` 與 `created_at desc, id desc` 排序）；建議另開卡：孤兒檔掃除、`image_url` constraint 收緊、
  上傳前解析檔頭尺寸
