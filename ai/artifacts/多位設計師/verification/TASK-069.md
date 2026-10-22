# 驗證報告

## 摘要

- 任務：TASK-069 多位設計師 後台設計師列表操作與「基本資料」頁籤（新增、編輯、停用／重新啟用、排序、頭像、專長標籤）
- 結果：通過（有殘留風險與待人工決定事項，見下方）
- 驗證者：實作 agent（Claude Code）。動工前 architect、security-reviewer 兩份審查意見**不等同人工核准**；
  product／ui／architecture／security／test／code_review 關卡待人工核准。**尚未做實作後的 security／test 審查**
  （TASK-067 有做，本卡未做；是否補做由人工決定）。

## 指令

| 指令 | 結果 | 備註 |
|---|---|---|
| `npx tsc --noEmit` | 通過 | |
| `npm run lint` | 通過 | 0 error、0 warning |
| `npm run build` | 通過 | 路由清單出現 `/admin/designers`、`/admin/designers/[id]`、`/admin/designers/new` |
| `npx vitest run --maxWorkers=3`（全套單元／元件測試） | 通過 | 52 檔 690 項。**注意**：預設並行度下跑全套，曾出現沒改到的檔案（`login-form`、`account-settings-view`、`reset-password-form`）5 秒逾時，每次失敗的檔案不同，單獨跑或降低並行度都通過；沒有在原始版本上重跑確認是否本來就會這樣，判斷為機器負載造成。本卡新增的元件測試已改用 `userEvent.setup({ delay: null })` 降低耗時 |
| 本卡新增的單元／元件測試 | 通過 | `tests/lib/designers.test.ts`（擴充）、`tests/lib/image-reencode.test.ts`、`tests/admin/designers-write.test.ts`、`tests/components/designers-table.test.tsx`（改寫）、`designer-basic-info-form.test.tsx`、`designer-edit-view.test.tsx`、`image-upload-field.test.tsx`（擴充）、`admin-shell.test.tsx`（擴充） |
| `npm run test:designers -- -t "TASK-069"`（真實 Supabase 專案） | 通過 | 12 項：建立（sort_order＝最大值＋1、欄位清理）、資料庫 check constraint 擋下繞過前端的非法值、非管理員被擋（建立／更新／停用／排序／頭像上傳）、更新只動基本資料欄位、停用／啟用、head count 查詢可用、排序交換（預設設計師的 `sort_order`／`is_active`／頭像／名稱前後相同）、頭像上傳→更換→移除（Storage 列表確認舊檔被刪、舊網址回 400／404）、舊網址被竄改成別人的檔案時不會刪到別人的檔案。跑完無殘留（afterAll 的清除斷言通過） |
| 瀏覽器走查（登入後台，真實專案） | 通過 | 見下方「走查」 |

未重跑整份 `test:designers` 與其他整合測試套件（本卡沒有 migration、沒改 RPC，只在本檔案追加案例）。

## 走查（Browser 工具，正式資料庫，只動 `__TEST__` 設計師）

- 側邊欄「設計師」在 `/admin/designers`、`/new`、`/[id]` 都高亮（AdminShell 子路徑判斷）。
- 新增頁：頭像區塊顯示「儲存設計師資料後，即可上傳頭像」，其他三個頁籤停用；空名稱＋IG `bad handle` 送出 → 欄位下方顯示
  「請輸入 1～30 字的名稱」「只能使用英文、數字、底線和句點」並聚焦名稱欄。
- 填入 `__TEST__走查A`、IG `@test.walk_a`、兩個標籤（第二個**沒按 Enter 直接按建立**，autoSelect 把它收進去）、簡介 → 建立成功，
  Toast「設計師已新增」，`router.replace` 到 `/admin/designers/<id>`，畫面顯示 IG `test.walk_a`（`@` 已去掉）。
- 頭像：頁面內產生 1600×1200、1.8MB 的 PNG 並模擬選檔 → 實際上傳的是 **1024×768、8KB 的 webp**，路徑
  `avatar/<小寫 designer id>/<uuid>.webp`，公開網址回 200；圓形預覽，「更換／移除」在圓形下方。
- 列表：第一列▲、最後一列▼停用；建立第二位 `__TEST__走查B` 後把它上移 → 只與 A 交換，寫入期間所有箭頭停用；
  停用 A → 確認對話框顯示「這位設計師目前沒有未來的有效預約」（不是最後一位啟用中，所以沒有額外警告）→ 確認後顯示「已停用」徽章與
  「重新啟用」→ 重新啟用直接執行並 Toast。
- 編輯頁修改簡介 → 儲存 → 儲存鈕回到停用（無變更）。
- 亮色模式、768px 寬度：版面正常，不破版；暗色模式為預設走查模式。
- 走查結束以 service_role 清除：先刪 `avatar/<id>/` Storage 物件（1/1），再刪兩位 `__TEST__` 設計師；清除後只剩「預設設計師」
  （`sort_order` 0、啟用中、無頭像，與走查前一致），`__TEST__` 設計師 0 位，`avatar/` 底下無未對應任何設計師的資料夾。
- 走查中順手修正：載入中麵包屑短暫顯示「設計師 / 設計師」，改為載入完成才顯示名稱。

## 螢幕截圖

截圖由 Browser 工具擷取，未存成專案檔案：列表（含新增的測試設計師與頭像）、新增頁（預設與驗證錯誤）、編輯頁（頭像預覽、標籤）、
停用確認對話框、已停用狀態、768px 亮色模式。**未擷取**：「最後一位啟用中」的額外警告（單元測試涵蓋；走查不得停用預設設計師）、
頭像上傳中／錯誤態、載入失敗 Alert（元件測試涵蓋）。

## 已採納的動工前審查（詳見任務卡「動工前審查定案」）

- 範圍修訂（人工決定）：擴充 `ImageUploadField`（選填 `onUpload`／`onRemove`＋`shape="circle"`）、AdminShell 子路徑高亮。
- canvas 重新編碼失敗一律中止、原圖 8000px／40MP 上限、輸出長邊 1024px、副檔名與 contentType 依實際 blob.type。
- 頭像更新與移除用 compare-and-swap；結果不明先重讀；舊檔路徑用完整錨定正規式解析並以資料庫回傳的小寫 id 組成。
- `[id]` 路由先驗 UUID；`getDesigner` 查不到回 `ok(null)`；排序純函式＋補償回滾＋「操作進行中」鎖定；停用前筆數查詢失敗不顯示 0。
- 欄位白名單 `toBasicInfoPayload`（測試斷言 `Object.keys`）；簡介擋控制／方向字元；錯誤不外洩。

## 殘留風險

- 排序「整份重新編號」分支寫入超過兩次，不做補償；失敗最壞情況是幾列同值，排序退回依 `created_at`，不會壞資料。
- 「最後一位啟用中」以前端已載入的列表判斷，多分頁同時操作可能過時（僅一位管理員）。
- 新增時網路逾時重試可能重複建立；補刪新檔失敗或重讀也失敗時會留下孤兒檔（建議 TASK-077 合併前查詢
  `designer-assets/avatar/` 底下沒有被任何 `designers.avatar_url` 引用的物件）。
- 簡介的控制／方向字元只有前端擋，資料庫 `designers_bio_length` 只檢查長度；需另開卡補 constraint。
- 頭像前置驗證沿用 5MB 上限：超過 5MB 的手機原圖會在重新編碼前就被拒絕（即使重新編碼後遠小於 5MB）。
- 頭像網址以 `getPublicUrl` 取得並存入資料庫；CDN 快取殘留、停用後仍可用原網址讀到，同 TASK-067 驗證報告。
- 既有 `resolveAdminAvatarUrl` 弱點（帳密、編碼斜線、回傳原始字串）仍在，同 TASK-067 驗證報告，未在本卡處理。
- 全套測試在預設並行度下的逾時不穩定（見上方），非本卡引入但本卡的新測試也受影響，已降低其耗時。
- 提供服務、作品集、請假三個頁籤只有占位內容（TASK-070／071／072）；新增的設計師在這之前沒有任何服務，不會被指派到預約。

## 人工核准

- 核准者：使用者
- 日期：2026-10-22
- 備註：驗收通過。實作後的 security／test 審查未做；簡介控制字元的資料庫 constraint、孤兒檔查詢、全套測試預設並行度下的無關逾時仍為殘留（見上方「殘留風險」）。
