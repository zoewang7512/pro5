# 驗證報告

## 摘要

- 任務：TASK-067 多位設計師 架構基礎（0017 migration、設計師資料表、RLS／GRANT、Storage、
  `appointments.designer_id` 回填、後台唯讀列表骨架與 Sidebar）
- 結果：通過（有殘留風險與待人工決定事項，見下方）
- 驗證者：實作 agent（Claude Code）。security-reviewer、test-engineer 兩份審查意見**不等同人工核准**；
  security／test／code_review 關卡待人工核准。

## 指令

| 指令 | 結果 | 備註 |
|---|---|---|
| `npx tsc --noEmit` | 通過 | |
| `npm run lint` | 通過 | 0 error、0 warning |
| `npm run build` | 通過 | 路由清單出現 `/admin/designers` |
| `npm test` | 通過 | 48 檔 549 項（本卡新增：`tests/lib/designers.test.ts` 34、`tests/admin/designers.test.ts` 9、`tests/components/designers-table.test.tsx` 8、`tests/components/admin-shell.test.tsx` 2） |
| `npm run test:designers`（0017 重新套用後） | 通過 | 44 項：RLS／GRANT 邊界、check constraint（斷言 constraint 名稱）、作品集 12 張上限（單列、並行 14 筆＝12 成功＋2 被拒、單一 insert 14 列整批回滾、非管理員不能探測）、Storage policy（路徑／副檔名／MIME／不可覆寫／不可列舉／刪除後 400 或 404）、真實 admin session 的 `listDesigners` |
| 回歸：`test:rls` 18、`test:booking` 23、`test:admin-booking` 13、`test:business-hours` 33、`test:store-settings` 11、`test:booking-policy` 7、`test:services` 17、`test:account` 17、`test:mfa-rls` 20、`test:notifications` 19 | 全數通過 | 證明 0017 套用後既有行為不變（`test:booking` 與 `test:admin-booking` 在新增 nullable 欄位後仍可建立預約） |
| 正式資料庫唯讀查詢（service_role） | 符合預期 | `designers` 只有 1 位「預設設計師」；16 筆預約 `designer_id` 為 null 的 0 筆；`designer_services` 4 列＝`services` 4 項；`designer-assets` bucket 為 public／5242880／jpeg·png·webp；測試後無任何 `__TEST__` 設計師、服務、Storage 檔案或測試帳號殘留 |
| 瀏覽器走查（登入後台 → Sidebar「設計師」→ 列表） | 通過 | 列表顯示預設設計師、「4 / 4 項」、啟用中、專長「—」、操作按鈕停用；載入中狀態顯示 Skeleton 且「新增設計師」停用；頁面的三個 Supabase 查詢皆回 200；未登入時導向 `/login` |
| 版面檢查（窄寬度與桌面寬度） | 通過（修正後） | 窄寬度原本名字與表頭被折成直排、操作欄被擠出畫面；已改為表格容器內橫向捲動、文字不折行，桌面寬度六欄同一行顯示 |

## 螢幕截圖

截圖由 Browser 工具擷取，未存成專案檔案：設計師列表（載入中、已載入）、窄寬度（修正前、修正後）、桌面寬度。

## 審查發現

security-reviewer（實作後審查）：無 Critical／High。採納並已修正：

- M1 作品集張數 trigger 是 BEFORE INSERT，在 RLS 之前以 postgres 身分執行，任何自行註冊的使用者可觸發／探測 → 改 AFTER INSERT＋`for no key update`（同時避免與外鍵檢查的 `key share` 死結），補「非管理員得到 42501 而非 PORTFOLIO_LIMIT」回歸測試。
- L1 `designers` insert 可自訂 `created_at`，可冒充「預設設計師」→ insert 改欄位層級授權。
- L3 check constraint 可被多維陣列、全形空白、方向覆寫／零寬字元繞過 → 補強並加測試。
- L4 Storage 路徑未限層數與副檔名 → policy 補 `array_length = 2` 與 `storage.extension in (jpg, png, webp)`；修正「無法同網址換圖」不正確的註解。
- L5 `resolveDesignerAssetUrl` 回傳原始字串、未擋帳密與編碼斜線 → 回傳 `parsed.href`，拒絕帳密與 `%2F`／`%5C`，補測試。
- L2、L6、L7、I1：修正 `image_url` constraint 註解（擋不住外部網域，白名單是唯一防線）、檔頭補「0018 套用後不要重跑本檔」與 down 的匯出提醒、更正任務卡中 `designer_specialties_valid` 的 execute 權限文字。

test-engineer：已處理 H3（唯讀回填測試）、H4（constraint 案例改為各自只違反一條並斷言名稱）、M1（fake 記錄呼叫參數＋真實 admin session 的 `listDesigners` 整合測試）、M2／M3（意外成功的 insert 一律追蹤、beforeAll 掃除前次殘留、afterAll 以前綴再掃一次）、M4（Storage 斷言改為 403＋RLS 訊息、415 MIME、`[400, 404]`、service_role 對照組）、M5 大部分（邊界正向案例、admin 讀停用設計師的資料、`updated_at` trigger、update／delete 權限、多列 insert）、M7（頭像正向案例、順序欄、Sidebar 導覽項目測試）、`hookTimeout`、`signOut({ scope: "local" })`。

## 殘留風險

- **（待人工決定）Supabase 公開註冊是開著的**（`disable_signup: false`，已驗證）。任何人都能取得 authenticated 身分，本卡所有防線都靠 `is_admin()`。建議在 Dashboard → Authentication 關閉；列為合併 master 或套用 0018 的前置條件。
- **`0017` 重跑冪等與 `0017_down` 未在隔離環境實跑**（test-engineer H2）。0017 已實際重新套用一次並成功，但不等於冪等的完整證據（尚未驗證「重跑不會重開店長關掉的服務」，因為單一資料庫禁止動預設設計師的服務開關）；down 腳本的 `delete from storage.buckets` 可能被新版 Supabase 的保護 trigger 擋下（交易回滾，安全失敗），檔頭已附 Dashboard 備案，但沒有人驗過。
- `is_admin()` aal2 對新表寫入的保護是「繼承」，`test:mfa-rls` 尚未加入新表的案例（該檔不在本卡允許變更範圍）。
- 既有整合測試套件結束時呼叫 `signOut()`（預設 global scope），會撤銷設計師帳號在所有裝置的登入（本卡新套件已改用 `scope: "local"`）。其餘套件為既有問題，建議另開卡。
- `lib/admin/account.ts` 的 `resolveAdminAvatarUrl` 有與 `resolveDesignerAssetUrl` 修正前相同的弱點（帳密、編碼斜線、回傳原始字串）；不在本卡範圍，實務上無法利用，建議另開卡一併修。
- `designer_leaves`／`designer_services` authenticated 沒有 update 權限，TASK-070 以後不能使用 upsert（`on conflict do update`），只能 insert（`ignoreDuplicates`）或 delete。
- 已知殘留（架構筆記已記）：CDN 快取在 cache-control 到期前仍可能回傳已刪除的圖片；停用設計師後頭像與作品仍可用原網址讀到。
- 範圍外的 `0018` 提醒：多位設計師上線後 `0018_down` 要還原全店 exclusion constraint，已有不同設計師同時段預約時會失敗。

## 人工核准

- 待人工驗收。
