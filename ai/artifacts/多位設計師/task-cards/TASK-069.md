# AI-Ready 任務卡

## Metadata

- 任務：多位設計師 後台設計師列表操作與「基本資料」頁籤（新增、編輯、停用／重新啟用、排序、頭像、專長標籤）
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：多位設計師
- 上層 User Story：管理設計師基本資料
- 分軌：前後端串接（後台畫面＋`lib/admin/designers.ts` 寫入函式；資料表已由 TASK-067 建立）
- 前置任務（dependsOn）：TASK-067
- 狀態：驗證中（實作與驗證完成，待人工驗收；人工已於 2026-10-21 核准；動工前 architect／security-reviewer 審查已於 2026-10-22 完成並採納，見「動工前審查定案」）
- 風險等級：中（後台寫入與頭像上傳，沿用既有 Storage／表單模式）
- Agent owner：Claude Code
- 人工核准者：使用者

## 目標

讓店長在 `/admin/designers` 完成設計師的新增、停用／重新啟用、順序調整，並在編輯頁
`/admin/designers/[id]` 建立四頁籤框架，完成「基本資料」頁籤（名稱、IG、專長、簡介、頭像）。其他三個頁籤
本卡只放占位內容，分別由 TASK-070／071／072 完成。

## 情境包（Context Pack）

- 相關檔案：
  - `ai/artifacts/多位設計師/screen-spec-後台設計師管理.md`、`mockup-decision-後台設計師管理.md`（Variant A）
  - `ai/artifacts/多位設計師/mockups/admin-designers-variant-a.html`（畫面 1、2、3、7）
  - `app/admin/_components/ServicesTable.tsx`、`ServiceFormDialog.tsx`（表格、二次確認、表單驗證的既有寫法）
  - `app/admin/_components/StoreSettingsForm.tsx`、`components/ui/ImageUploadField.tsx`（圖片上傳四態）
  - `lib/admin/account.ts`（`uploadAdminAvatar`／`removeAdminAvatar` 的 Storage＋資料列更新順序）
  - TASK-067 架構筆記 B／C／D／F
- 既有模式：表單驗證純函式放 `lib/`、元件只呼叫；`Result<T>`；寫入成功用 Toast；二次確認用 `ConfirmDialog`。
- 假設：新增設計師＝直接進入空白編輯頁，按「儲存」才建立（Variant A，無 Modal）；建立成功後網址換成
  `/admin/designers/<id>`，其他頁籤才可用。
- 未知事項：無。
- 允許變更的檔案：
  - `lib/admin/designers.ts`（`getDesigner`、`createDesigner`、`updateDesignerBasicInfo`、`setDesignerActive`、
    `swapDesignerOrder`、`countFutureAppointmentsForDesigner`、`uploadDesignerAvatar`、`removeDesignerAvatar`）
  - `lib/designers.ts`（新增驗證純函式：名稱、IG 帳號正規化與驗證、專長、簡介）
  - `app/admin/designers/page.tsx`、`app/admin/designers/new/page.tsx`、`app/admin/designers/[id]/page.tsx`（新增）
  - `app/admin/_components/DesignersTable.tsx`（啟用操作欄）
  - `app/admin/_components/DesignerEditView.tsx`（新增，頁籤框架）
  - `app/admin/_components/DesignerBasicInfoForm.tsx`（新增）
  - `components/ui/ImageUploadField.tsx`（只允許為支援圓形頭像預覽新增選填 prop，不改既有行為）
  - `ai/context/design-system.md`（S4 inventory 登記 `TagInput` 用法：MUI `Autocomplete multiple freeSolo`）
  - `tests/lib/designers.test.ts`、`tests/admin/designers.test.ts`（新增）
  - `tests/designers.integration.test.ts`（擴充寫入函式案例）
- 不得觸碰：`designer_services`／`designer_portfolio_images`／`designer_leaves` 的寫入（TASK-070～072）。

## 需求

- 列表頁：「新增設計師」、編輯、停用、重新啟用、上下箭頭排序（第一列不能上移、最後一列不能下移）。
- 停用：`ConfirmDialog` 顯示未來有效預約筆數；停用最後一位啟用中的設計師時額外警告。
- 基本資料：欄位驗證依 feature-spec（名稱 1～30、IG 格式、專長 0～5 個且每個 ≤ 12 字不重複、簡介 ≤ 200），
  前端錯誤文案依 screen-spec；IG 輸入框前綴顯示 `@`，送出時去掉使用者輸入的 `@`。
- 頁面上方顯示「這些資料會公開顯示在顧客預約頁」提示。
- 頭像：上傳／更換／移除，沿用 `ImageUploadField` 四態，路徑 `avatar/<designer_id>/<uuid>.<ext>`。
- 〔審查〕上傳前用 canvas 重新編碼成 webp（去除 EXIF）；更換頭像＝上傳新檔＋刪除舊檔（Storage 沒有 update policy），
  刪除舊檔時檢查 `remove()` 回傳筆數，不是 1 時顯示警告；網址白名單用 `resolveAdminAvatarUrl` 的 URL 解析寫法
  （TASK-067 架構筆記 D）。
- 〔審查〕走查與測試遵守單一資料庫隔離規則：只操作 `__TEST__` 設計師，不得停用或修改預設設計師（TASK-067 架構筆記 A）。

## 驗收標準

- 所有操作成功後列表或表單即時反映；失敗時顯示 Toast 通用訊息，畫面回到操作前狀態。
- 資料庫 check constraint 擋下的非法值不會出現（前端先擋），即使繞過前端也會被資料庫拒絕。
- 停用後，設計師在列表顯示「已停用」並可重新啟用。

## 實作備註

- 排序：`swapDesignerOrder` 交換兩列的 `sort_order`（兩次 update），任一失敗就重新讀取列表，不做樂觀更新。
- 新增設計師時 `sort_order` 取目前最大值 + 1。

## 動工前審查定案（2026-10-22）

architect、security-reviewer 皆為 Approve with changes（不等同人工核准）。以下為採納事項；使用者已於對話中決定
範圍擴充兩項（標「人工決定」）。

### 範圍修訂（追加允許變更的檔案）

- `components/ui/ImageUploadField.tsx`：**〔人工決定〕** discriminated union——`{ kind, supabase }` 走舊路徑，
  `{ onUpload, onRemove, validate? }` 走新路徑，另加選填 `shape="circle"`；既有商店設定頁行為不變。
  圓形時「更換／移除」移到圓形下方。補 `tests/components/image-upload-field.test.tsx` 回歸案例。
- `app/admin/_components/AdminShell.tsx`：**〔人工決定〕** 子路徑也算 active（`/admin` 首頁維持完全比對）＋單元測試。
- `lib/admin/image-reencode.ts`（新增）：canvas 重新編碼（含可測純函式：目標尺寸、mime→副檔名）。
- `lib/designers.ts`：`validateDesignerBio` 補擋控制／方向字元（允許換行）、`instagramProfileUrl()`、`isDesignerId()`。
- 測試：`tests/components/designers-table.test.tsx`（擴充）、`designer-basic-info-form.test.tsx`、
  `designer-edit-view.test.tsx`（新增）、`tests/lib/image-reencode.test.ts`（新增）。`tests/admin/designers.test.ts`
  為擴充（任務卡原寫「新增」）。
- `ai/context/design-system.md`：登記 TagInput 用法與 ImageUploadField 新 prop。
- `Result` 型別沿用 `./appointments` 既有匯出，不新增。

### 採納的設計定案

1. **canvas**：先 `image/webp`，`blob === null` 或 `blob.type !== "image/webp"` 改 `image/jpeg`（先填白底），再失敗就**中止**，
   任何分支都不上傳原檔；副檔名與 contentType 依 `blob.type` 經 `Object.hasOwn` 白名單推出；原圖超過 8000px／40MP
   拒絕；輸出長邊縮到 1024px；`createImageBitmap(file, { imageOrientation: "from-image" })`；用完歸零 canvas、
   `close()` bitmap。
2. **頭像更新用 CAS**：`update({avatar_url}).eq("id").eq("avatar_url", old)`（舊值 null 用 `.is`）`.select("id")`；
   0 列＝補刪新檔並提示重新整理；例外／逾時等結果不明時先重讀，`avatar_url !== newUrl` 才補刪。舊值**從資料庫讀**，
   不信任前端 props。移除：先 CAS 改 null，成功才刪檔。多步驟全在 lib 函式內。
3. **刪舊檔路徑**：先過 `resolveDesignerAssetUrl`，要求無 search／hash，pathname 以完整錨定正規式
   `^/storage/v1/object/public/designer-assets/avatar/<designerId>/<uuid>.(jpg|png|webp)$` 比對，用擷取群組重組路徑；
   不符就不刪並顯示警告。`designerId` 一律用 `getDesigner` 回傳的 `designer.id`（小寫）。
4. **`[id]` 路由**：先 UUID 正規式，不合法顯示「找不到這位設計師」；`getDesigner` 用 `.maybeSingle()`，查不到回 `ok(null)`。
5. **排序**：`planDesignerOrderSwap(list, index, direction)` 純函式（值不同＝交換；值相同＝整份重新編號）；
   交換分支第二次失敗時盡力回滾第一列，一律重讀；列表有共用「操作進行中」狀態，在途時停用所有箭頭與停用按鈕。
   箭頭旁加說明「順序也會影響『不指定設計師』時的自動指派優先順序」。
6. **停用前筆數查詢**：`select("id", { count: "exact", head: true })`（不可用 `*`）；失敗時**不顯示 0**，
   顯示「無法取得未來預約筆數」，仍可二次確認停用。
7. **欄位白名單**：`toBasicInfoPayload()` 只回傳 4 個欄位（建立時加 `sort_order`、`is_active`），單元測試斷言 `Object.keys`；
   不展開 `Designer`、不用 upsert；空字串 bio／IG 轉 null；名稱／專長／簡介送出前 NFC 正規化。
8. **錯誤**：不顯示也不 log `error.message／details`；只依 `error.code` 對應少數文案。
9. **新增模式**：頭像與其他三個頁籤停用，建立成功後 `router.replace` 到 `/admin/designers/<id>`。
   「基本資料」面板切頁籤時保持掛載。TagInput 用 `autoSelect`，避免打字後未按 Enter 就儲存而漏標籤。
10. **走查與清理**：只建 `__TEST__` 設計師，排序步驟只在兩位 `__TEST__` 設計師間交換；結束後用 service_role 先刪
    `avatar/<id>/` Storage 物件再刪設計師，以 `starts_with(name, '__TEST__')` 查無殘留（不用 `LIKE`，`_` 是萬用字元），
    並確認預設設計師 `sort_order`／`is_active` 未變。不與整合測試同時跑。

### 已知限制（寫入驗證報告）

- 排序重新編號分支寫入超過兩次，不做補償；失敗最壞情況是幾列同值，排序退回依 created_at。
- 「最後一位啟用中」以前端已載入列表判斷，多分頁同時操作可能過時（僅一位管理員）。
- 新增時網路逾時重試可能重複建立；補刪新檔失敗會留下孤兒檔（驗證報告附孤兒檔查詢 SQL）。
- 簡介的控制／方向字元只有前端擋，資料庫 constraint 需另開卡。
- 既有 `resolveAdminAvatarUrl` 弱點、CDN 快取殘留，同 TASK-067 驗證報告。

## 驗證契約

- 單元測試：驗證純函式（各邊界值）、IG 帳號正規化、`swapDesignerOrder` 失敗時的回傳。
- 整合測試：admin 可建立／更新／停用設計師、可上傳頭像到 `designer-assets`；非 admin 寫入被拒。
- E2E 測試：Browser 走查新增設計師 → 填資料 → 儲存 → 回列表排序 → 停用（含警告對話框）→ 重新啟用。
- 型別檢查／Lint／Build：`npx tsc --noEmit`、`npm run lint`、`npm run build`
- 螢幕截圖：列表（含停用中）、停用確認、基本資料頁籤（預設與驗證錯誤）、暗色模式各一張。
- 安全性檢查：頭像網址只信任 `designer-assets` bucket；上傳只接受 jpg/png/webp、5MB。

## 完成證據

完整內容見 [`../verification/TASK-069.md`](../verification/TASK-069.md)。

- 變更的檔案：`lib/designers.ts`（簡介字元驗證、`normalizeDesignerBio`、`instagramProfileUrl`、`isDesignerId`）、`lib/admin/designers.ts`（`getDesigner`、`createDesigner`、`updateDesignerBasicInfo`、`setDesignerActive`、`countFutureAppointmentsForDesigner`、`planDesignerOrderSwap`／`swapDesignerOrder`、頭像上傳／移除與路徑解析）、`lib/admin/image-reencode.ts`（新增）；`app/admin/designers/new/page.tsx`、`app/admin/designers/[id]/page.tsx`（新增）、`app/admin/_components/DesignerEditView.tsx`、`DesignerBasicInfoForm.tsx`（新增）、`DesignersTable.tsx`、`AdminShell.tsx`；`components/ui/ImageUploadField.tsx`；`ai/context/design-system.md`（TagInput、ImageUploadField 擴充）；測試：`tests/lib/designers.test.ts`、`tests/lib/image-reencode.test.ts`、`tests/admin/designers-write.test.ts`、`tests/components/designers-table.test.tsx`、`designer-basic-info-form.test.tsx`、`designer-edit-view.test.tsx`、`image-upload-field.test.tsx`、`admin-shell.test.tsx`、`tests/designers.integration.test.ts`。
- 執行過的指令：`tsc --noEmit`、`npm run lint`、`npm run build`、`vitest run --maxWorkers=3`（690 項）、`npm run test:designers -- -t "TASK-069"`（12 項，真實專案）、瀏覽器走查與 service_role 清理。
- 測試輸出：全數通過，詳見驗證報告（預設並行度下全套測試曾有無關檔案的逾時，已記錄）。
- 螢幕截圖：列表、新增頁（預設與驗證錯誤）、編輯頁、停用確認、已停用狀態、768px 亮色模式，見驗證報告。
- 已知限制：見驗證報告「殘留風險」——排序重新編號分支不補償、「最後一位啟用中」以前端列表判斷、孤兒檔、簡介字元只有前端擋、5MB 前置上限。
- 實作期偏離原設計：寫入函式的單元測試放在獨立新檔 `tests/admin/designers-write.test.ts`（`designers.test.ts` 維持讀取函式測試）；`DesignerEditView` 載入完成前麵包屑只顯示「設計師」。範圍追加（`ImageUploadField`、`AdminShell`、`image-reencode.ts` 等）已在動工前審查定案中記錄並經人工決定。
- 後續任務：TASK-070、TASK-071、TASK-072
