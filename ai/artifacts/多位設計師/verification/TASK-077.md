# 驗證報告

## 摘要

- 任務：TASK-077 多位設計師 前後端串接驗證、端到端走查與文件同步（整個「多位設計師」Epic 的整合驗證）
- 結果：**自動化驗證、走查與 SQL 檢查皆通過；剩下需要使用者決定或動手的事項**（見「待人工處理」：designer001 的 MFA、公開註冊、確認信實收、合併 master）。尚未合併 master。
- 驗證者：實作 agent（Claude Code）。動工前 architect、security-reviewer 的審查意見**不等同人工核准**；product／ui／architecture／security／
  test／code_review 關卡待人工核准。

## 使用者決定（2026-10-22）

- **designer001 先不啟用 MFA**：接受唯一管理員只靠密碼保護的殘留風險（記錄於 `decisions.md`）。
- **關閉 Supabase 公開註冊**：使用者決定關閉；這是後台設定、不受版控，**本專案無法驗證是否已關閉**，由使用者在 Supabase 後台操作。
- **確認信實收截圖、合併 master 後的正式網址走查**：等使用者合併到 master 後再由 agent 提醒執行（見下方 #4、#5）。

## 待人工處理（合併 master 前後）

1. ~~**`proacl` 等 SQL 證據**~~ **已完成（2026-10-22）**：使用者在 SQL Editor 執行附錄 SQL 並貼回，`proacl`、`is_admin()` aal2、四張表 RLS 旗標、`storage.objects` 全部 policy 皆符合預期，見下方「合併前 SQL／資料檢查」。
2. ✅ **已決定（先不啟用）** ——**designer001（唯一正式管理員）尚未啟用 MFA**：TASK-079（`is_admin()` 強制 aal2）**已完成並在 master**（`234e6f7`、`13d9970`、`b450c2b`，本分支已包含 master），
   但它只對「已啟用 MFA」的帳號生效，所以目前這個唯一的管理員仍只靠密碼保護。本 Epic 新增了只靠這組密碼保護的寫入面（公開 bucket 上傳、可竄改前台設計師頁、
   關閉服務或標請假即可讓前台無法預約）。security-reviewer 評為中風險、與既有「管理員密碼外洩」同類，沒有新的攻擊類型。
   建議：為 designer001 啟用 MFA（`test:mfa-rls` 已改用拋棄式帳號，不依賴 designer001 的 MFA 狀態）；若暫不啟用，請明確記錄為接受的殘留風險，並確認 Supabase Auth 的外洩密碼防護與登入限流已開。
3. ✅ **已決定（關閉；由使用者在後台操作，未經驗證）** ——**Supabase 公開註冊仍開著（`disable_signup: false`）**：`decisions.md` 與 TASK-067 驗證報告都把它列為「合併 master 或套用 0018 的前置條件（待人工決定）」。本 Epic 的防線全靠 `is_admin()`，建議關閉。
4. **確認信實收截圖**：需要你的信箱。**注意正式 Vercel 目前仍是 master 的舊程式**，在合併部署前寄出的確認信不會有「設計師」一行；TASK-076 的實收證據只能在合併部署後取得。
   合併後請在正式網址照下方「走查守則」走一次前台預約，並用你自己的信箱收信截圖。
5. **合併 master（觸發 Vercel 部署）與合併後正式網址走查**：等你人工驗收。

## 指令

| 指令 | 結果 | 備註 |
|---|---|---|
| `npx tsc --noEmit` | 通過 | 0 錯誤 |
| `npm run lint` | 通過 | 0 error、0 warning |
| `npm run build` | 通過 | 路由清單含 `/admin/designers`、`/admin/designers/[id]`、`/admin/designers/new`。build 前先停掉 dev server、build 後重啟 |
| `npx vitest run --maxWorkers=3`（單元，全套） | 1070／1072 通過，2 項失敗全是 5 秒逾時 | 失敗在 `account-settings-view`（不是本 Epic 的檔案）；該檔案單獨重跑 33／33 通過。同一類逾時 TASK-069～076 報告已記載；TASK-076 在乾淨 HEAD 上也重現過 |
| `npm run test:rls` | 18／18 通過 | |
| `npm run test:designers` | **首次 121／122，修正後 122／122 通過** | 首次失敗是測試程式碼的既有缺陷，見「發現的問題」 |
| `npm run test:booking` | 23／23 通過 | |
| `npm run test:admin-booking` | 16／16 通過 | |
| `npm run test:services` | 17／17 通過 | |
| `npm run test:booking-policy` | 7／7 通過 | |
| `npm run test:business-hours` | 33／33 通過 | 完整跑（TASK-075 只跑了一項） |
| `npm run test:store-settings` | 11／11 通過 | |
| `npm run test:account` | 17／17 通過 | |
| `npm run test:mfa-rls` | 20／20 通過 | 本分支唯一證明 `is_admin()` aal2 仍生效的測試；跑完 `admins` 筆數與基準一致 |
| `npm run test:notifications` | 20／20 通過 | 含 TASK-076 的設計師名稱案例（啟用與已停用設計師） |

整合測試合計 304 項。**依序執行、不平行**（共用真實資料庫），並在**測前測後各做一次設定表快照與殘留比對**（見下）。

### 測前測後比對

測前存基準（`business_hours`、`booking_policy`、`closed_dates`、`store_settings`、`admins` 的筆數與雜湊，加殘留清單），全部測完與走查完成後再比對：

- `business_hours`、`closed_dates`、`admins`：**完全一致**。
- `booking_policy`、`store_settings` 的雜湊不同：現值正常（最短提前 1 小時、取消時限空值；店名地址電話簡介都在），`updated_at` 落在測試時間，
  判斷是測試還原動作更新了 `updated_at`。**我沒有保存測前的原始列，無法逐欄證明值完全相同**，這是這個比對方法的限制。
- `__TEST__` 設計師、服務、預約、顧客、`.invalid` email 預約、`designer_services` 雙向混接、`designer-assets` 孤兒檔、`admin-assets` 測試頭像：**全部 0**。
- auth 使用者：測前 33 位（其中 32 位測試帳號），**測後 1 位（只剩管理員），測試帳號 0**——見下一節。

## 發現的問題

1. **`test:designers` 掃除邏輯從不刪 auth 測試帳號（TASK-067 引入）**：`u.email?.startsWith("__TEST__dz-")` 區分大小寫，Supabase 會把 email 轉成小寫，永遠比對不到。
   正式庫累積了 32 個 `__test__dz-…@example.invalid` 帳號，今天每跑一次再多一個。已改成不分大小寫比對，重跑後帳號清空（33 → 1），之後每輪不再洩漏。**依你的決定修正並清除。**
2. **`test:designers` 頭像斷言與較早案例耦合（TASK-069 引入）**：TASK-069 新增的「非管理員上傳被擋下，不留下檔案」斷言要求 `avatar/<activeDesignerId>/` 為空，
   但 TASK-067 較早的覆寫／搬移案例會在同一資料夾留檔。TASK-069 當時只跑了 `-t "TASK-069"`，所以沒發現；這次第一次完整跑整份才現形。已改成比對上傳前後資料夾內容不變。**依你的決定修正。**
3. **更正我自己的一項錯誤陳述**：我曾說「TASK-079 還在 backlog」，沒有實際查那張卡；實際已 Done 並在 master。已更正。
4. 兩項修正都只動 `tests/designers.integration.test.ts`（本 Epic 的測試檔），沒有動任何產品程式碼。

## 驗收標準逐條對照（feature-spec 第 317 行起）

| # | 驗收標準 | 證據 | 結論 |
|---|---|---|---|
| 1 | 升級後既有預約全有 `designer_id`、既有服務對預設設計師開啟；新增其他設計師前結果與升級前一致 | `test:designers`「最早建立的設計師不是測試資料，而且在它建立之前的所有預約都有 designer_id」（L302）＋ `designer_id` not null；既有套件全數回歸通過（booking 23、admin-booking 16、business-hours 33、rls 18、booking-policy 7、services 17）。**唯讀查詢**：`appointments_without_designer = 0`、`real_services_not_open_to_default_designer = 0`（預設設計師「店長」開了全部真實服務）。**這條原本沒有現成測試，查詢結果是本卡補的證據** | ✅ |
| 2 | 店長可新增／編輯／停用／重新啟用設計師，設頭像、簡介、專長、IG、服務、作品集（≤12）與整天請假；欄位驗證前端與資料庫兩層 | 走查：新增 2 位、開服務、上傳作品 2 張、請假、停用皆成功；`test:designers`（TASK-069～072 各組案例、作品集 12 張上限含並行 L866）。**兩個偏差**：(a) 簡介的控制字元與方向覆寫字元只有前端擋，資料庫只檢查長度；(b) 請假日「今天以後」只有函式層擋，資料庫沒有 constraint | ⚠️ **部分**——請人工決定是否接受或另開卡補 constraint |
| 3 | 兩位設計師同一時段各成立一筆；同一位同一時段不能第二筆（資料庫層級） | `test:designers` L1264、L1292（23P01，不同設計師可並存）；**走查**：10/23 10:00 指定甲、不指定（派給乙）各成立一筆 | ✅ |
| 4 | 顧客只看到提供該服務的啟用設計師＋「不指定」；詳細面板顯示專長、IG 連結（新分頁、`noopener noreferrer`）、仿 IG 作品集 | **走查**：只列兩位測試設計師與「不指定」，4 位真實設計師（沒開這項服務）不出現；個人頁顯示頭像、作品 2／專長 1、九宮格、底部選擇鈕；返回鍵只關個人頁。IG 連結新分頁與 `rel` 由元件測試涵蓋（`tests/components/designer-profile-dialog.test.tsx`）。**走查沒設 IG 帳號，所以 IG 連結沒有在瀏覽器實際驗證** | ✅（IG 連結為元件測試） |
| 5 | 指定時只顯示該設計師空檔；不指定時為聯集，回應不含設計師資訊 | `test:designers`「不指定：時段是聯集；指定時只看該設計師；回應只有時間、不含設計師資訊」（L1479）；**走查 10/24（甲請假）**：指定甲 0 個時段、指定乙 18、不指定 18；10/23 10:00 甲已被佔時不指定仍列出 | ✅ |
| 6 | 自動指派「當天預約數最少 → `sort_order` → `id`」；併發不雙重預約、第一順位衝突改派 | `test:designers` L1420、L1594（2 筆同時）、L1609（3 筆同時 2 成功 1 衝突）、L1639（8 筆對 3 位恰好 3 筆成功）、L1791（第一順位被 buffer 擋住改派）；**走查**：不指定自動派給乙並顯示說明文字 | ✅ |
| 7 | 請假、停用、未提供服務，直接呼叫 RPC 也無法成立預約 | `test:designers` L1335（不存在／停用／沒開服務／請假回應完全相同，時段空陣列且建立預約 SLOT_CONFLICT）、L3084（標記請假後指定該設計師的時段回空，移除後恢復） | ✅ |
| 8 | 後台週曆、列表、詳情都顯示設計師，可依設計師篩選；改期只算原設計師空檔 | TASK-075 驗證報告（`test:admin-booking` 16、元件測試、走查）；**本卡走查**：全部／勾一位（事件卡不顯示設計師列）／勾兩位（顯示）／取消最後一個回到「全部」；停用但有預約的設計師 Chip 標「已停用」 | ✅ |
| 9 | 四種通知信都顯示設計師名稱，名稱經 HTML 跳脫 | TASK-076 驗證報告：單元 285 項、`test:notifications` 20／20（含已停用設計師）。**實收信尚未驗證**（見待人工處理 #4） | ⚠️ 範本與寄送路徑已驗證；實收待合併部署後 |
| 10 | 沒有任何前台路徑可讀到 `designer_leaves` 或其他設計師的預約 | `test:designers`：anon 讀不到 `designer_leaves`（L365）、讀不到 `appointments.designer_id`（L394）、非管理員與 anon 看不到任何預約（L3075）；**grep**：`app/`、`lib/`、`components/` 內只有 `lib/admin/*`（後台專用）引用 `designer_leaves` | ✅ |

## 合併前 SQL／資料檢查

| 檢查 | 結果 |
|---|---|
| (1) 沒有殘留 `__TEST__` 設計師、服務、預約、顧客、Storage 檔案 | ✅ 全部 0；`designer-assets` 8 個物件全被 `designers.avatar_url` 或 `designer_portfolio_images.storage_path` 引用，**孤兒檔 0**；`admin-assets` 測試頭像 0 |
| (1b) 殘留 auth 帳號、`admins` 額外列 | ✅ auth 只剩 1 位（管理員）；`admins` 筆數與基準一致 |
| (2) 沒有「上架中但沒有任何啟用設計師」的服務 | ✅ `active_services_without_active_designer = []` |
| (2b) 測試設計師沒有混接到真實服務、真實設計師沒有混接到測試服務 | ✅ 兩個方向皆 0 |
| (3) 兩支 RPC 的 `proacl` 與 0018 套用前一致 | ✅ **使用者於 2026-10-22 在 SQL Editor 執行並貼回**（第一次只貼到第 4 段，因 SQL Editor 只顯示最後一段結果；之後改用合併成單一查詢的版本取得其餘三項）。`create_appointment`、`get_available_slots`：`postgres`／`anon`／`authenticated`／`service_role` 皆可 execute，與 TASK-068 記錄的套用前基準一致，參數含 `p_designer_id`（亦證明 0018 已套用）。內部函式 `_designer_is_eligible`、`_designer_is_free`、`_email_dedupe_key`、`designer_portfolio_limit_check` 只有 `postgres`、`service_role`，anon 與 authenticated 不能直接呼叫。`designer_specialties_valid` 為 `postgres`／`authenticated`／`service_role`，與 0017 刻意授權範圍一致（check constraint 執行時需要）。所有 ACL 都沒有 PUBLIC 項目 |
| (3b) `is_admin()` 含 aal2 判斷（0016） | ✅ `is_admin_checks_aal2 = true` |
| (3c) 四張設計師表的 RLS 旗標 | ✅ `designers`、`designer_services`、`designer_portfolio_images`、`designer_leaves` 皆 `relrowsecurity = true`、`relforcerowsecurity = false` |
| (4) `storage.objects` 全部 policy（附錄 SQL 第 4 段，使用者 2026-10-22 貼回） | ✅ 共 11 條，**全部只授權 `{authenticated}` 且都含 `is_admin()`**，沒有 anon／public 的 policy，沒有寬鬆的手動 policy。`designer-assets` 只有 select／insert／delete 三條，**沒有 update policy**（不能覆寫）；insert 限定路徑兩層、第一層 `avatar`／`portfolio`、第二層 `^[0-9a-f-]{36}$`、副檔名 jpg／png／webp，與 0017 設計一致。`admin-assets` 與 `store-assets` 的 policy 也只對管理員開放 |
| 0017／0018 已套用 | ✅ 間接證據：`test:designers` 122 項（含 `p_designer_id` 參數呼叫與四張新表）在真實專案全過 |

所有查詢唯讀，輸出只有計數與 id，不含顧客姓名、電話、email。

## 瀏覽器走查（`localhost:3000`，登入後台，正式資料庫，`__TEST__` 資料，已清除）

**隔離做法（依 security-reviewer 動工前審查）**：以 service_role 建立一個上架中的 `__TEST__走查077 勿預約` 服務；兩位測試設計師用後台 UI 新增，**只對這個服務開啟**（確認「提供服務 1」，
新增設計師預設不開任何服務）；走查電話先確認不在 `customers`；預約**不填 email**（避免觸發正式環境寄信）；作品圖用 canvas 產生的無內容測試圖；沒有碰任何真實設計師、真實服務、真實預約。
清除前先驗證兩位測試設計師名下預約**全部**是 `__TEST__` 顧客才刪除（不使用整批刪設計師預約的 `cleanupTestDesigners`）；刪除順序：預約 → 顧客 → Storage（走 API）→ 設計師 → 服務。

走查流程與結果：

1. 後台新增設計師甲、乙 → ✅（建立後跳到編輯頁、Toast「設計師已新增」）。
2. 提供服務：只開 `__TEST__` 服務（「提供服務 1」）→ ✅。
3. 作品集上傳 2 張 → ✅（「2 / 12 張」，最新的排最前）。
4. 前台：選服務 → 選擇設計師步驟（不指定＋甲＋乙，預設不指定並有說明）→ 選甲顯示簡介／專長／作品預覽 → 看完整作品集（仿 IG 個人頁）→ 返回鍵只關個人頁 → ✅。
5. 前台指定甲預約 10/23 10:00 → ✅ 成功頁顯示設計師甲。
6. 前台「不指定」同一時段 10:00（甲已被佔）→ ✅ 仍列出該時段；成功並自動派給乙，成功頁說明「你選擇了不指定設計師，系統已為你安排…乙」。
7. 後台週曆：「全部 · 3」、各設計師計數、多選篩選與清除 → ✅。
8. 標記請假：點甲有預約的 10/23 → ✅ 警告列出該筆預約並說明「不會自動取消、也不會通知顧客」（按取消，未標記）；標記沒有預約的 10/24 → ✅「已標記請假」。
9. 前台 10/24：指定甲 0 個時段（顯示「當日時段皆已被預約」）、指定乙 18、不指定 18 → ✅ 該日時段消失。
10. 停用甲 → ✅ 對話框提示「還有 1 筆未來的有效預約，不會自動取消、不會通知顧客」；停用後前台不再列出甲、乙與不指定仍在；後台週曆 Chip 標「已停用」。
11. 375px（行動裝置）與亮色／暗色 → ✅ 無水平溢出，亮色與暗色皆正常；結束後切回暗色並還原桌面視窗。
12. 主控台：只有 dev server 重啟造成的 HMR WebSocket 警告，沒有應用錯誤。
13. 確認信實收 → ⏳ 見待人工處理 #4。

## 螢幕截圖

由 Browser 工具擷取，**未存成專案檔案**（畫面含後台週曆，可能帶真實顧客資料，避免把個資 commit 進 git）。涵蓋：選擇設計師步驟（不指定／指定）、個人頁、成功頁（指定與不指定）、
請假警告對話框、請假月曆、停用對話框、375px 暗色與亮色。**沒有擷取**：後台三個畫面的完整截圖（週曆含真實顧客，改以 DOM 查詢驗證結構）、確認信（待實收）。

## Epic 總覽安全審查（security-reviewer，動工前於 2026-10-22 針對 `git diff master...HEAD` 做過，**不等同人工核准**）

結論：0017／0018 權限設計嚴謹，沒有找到提權或越權讀寫的路徑。已確認：anon 讀不到 `designer_leaves`、`appointments.designer_id`、停用設計師、其他人預約；所有 SECURITY DEFINER 函式都設 `search_path=''`；
兩支 RPC 的 execute 明寫、內部函式已收回 anon 與 authenticated；RPC 一律重新檢查設計師啟用、有開服務、沒請假，且各種不合格回應完全相同；作品集上限 trigger 用 AFTER 避免被拿來探測張數；
`designer-assets` 無 anon policy、無 update policy、路徑與副檔名限定；IG 注入、圖片網址白名單、上傳 MIME／大小、繞過前端直呼 RPC、併發自動指派皆有實作與測試；本 Epic 沒有新增 server action 或 API route。
**該審查之後的變更**：TASK-076（通知信設計師名稱）已另有動工前審查；本卡只動測試檔與文件。**沒有做實作後的 subagent 審查。**

## 文件同步

- `ai/context/project-map.md`：新增「多位設計師」段落（用詞說明、四張新表與 bucket、`designer_id` 與 exclusion constraint 變更、兩支 RPC 新簽名、前後台元件、通知信、資料隔離、已知前提）；
  更新 `lib/admin/designers.ts` 說明（原寫「目前只有唯讀 `listDesigners`」）；更正「全域 exclusion constraint」說法（4 處）；`test:designers` 說明更正；補 `test:mfa-rls` 指令列；產品段落補「店長／管理員」用詞。
- `README.md`：功能清單新增「挑選設計師」與「設計師管理」；通知信說明補「標示設計師」；「設計師後台」用詞改為「店長後台」（避免與新的「設計師」衝突）；
  「優化項目」第 1 條改寫——緩衝時間已由 0018 涵蓋，只剩 30 分鐘時段對齊 `create_appointment` 尚未強制。**README 內的畫面截圖仍是舊畫面，未更新。**
- `ai/context/decisions.md`：TASK-022～027 緩衝時間一節加「部分被取代」註記（「單一設計師、低並發」理由已不成立）。
- `ai/context/design-system.md`：已確認登記 **5 個**新元件（`DesignerFilterChips`（含 `DesignerAvatar`、`DesignerLabel`）、`PortfolioManager`、`DesignerAvatarRail`、`PortfolioGrid`、`DesignerProfileDialog`），任務卡寫「4 個」是舊數字，無需變更。

## 已知限制與後續（彙整各卡殘留）

- 簡介控制字元與請假日「今天以後」不在資料庫層強制（驗收標準 #2 偏差）。
- `get_available_slots` 沒有限流（TASK-080 已延後）；各設計師排程可透過逐一查詢推算（已接受的殘留）。
- 重新編碼只在瀏覽器端做；管理員 session 被盜時可把非圖片內容標成 image/* 上傳到公開 bucket（建議用 `curl -I` 確認公開物件有 `X-Content-Type-Options: nosniff`）。
- 刪除作品後 CDN 最多約 5 分鐘仍可能讀到舊圖（TASK-071 M3）。
- `create_appointment` 尚未強制 30 分鐘時段對齊；exclusion constraint 不含 buffer，併發時相鄰預約仍可能吃掉緩衝。
- UPDATE webhook 從資料庫重讀 `designer_id`，依賴「不能改派設計師」；日後做改派要改讀 payload 快照。
- cron 的 `designers(name)` 內嵌失敗會讓當天整批提醒不寄（與 `services(name)` 相同取捨）。
- 測試掃除的 `like` 沒跳脫 `_`（`designers` 測試與 `mfa-rls` 測試），低機率誤比對；`designers` 測試的掃除會依 like 結果刪預約，沒有套 `designer-fixture` 的名稱防護。
- 測試快照比對只存雜湊，無法逐欄還原證明（改善：下次存原始列再比對）。
- 後續任務：Demo 體驗帳戶 Epic（seed 要涵蓋本 Epic 的資料表）。

## 附錄 SQL（請在 Supabase SQL Editor 執行，唯讀）

```sql
begin read only;

-- 1) 兩支 RPC 與內部函式的授權（proacl）。兩支 RPC 應為 postgres/anon/authenticated/service_role 皆可 execute；
--    內部函式（_designer_is_eligible、_designer_is_free、_email_dedupe_key）anon、authenticated 不應有 execute。
select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.proacl::text as proacl
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('create_appointment','get_available_slots','_designer_is_eligible','_designer_is_free',
                    '_email_dedupe_key','designer_portfolio_limit_check','designer_specialties_valid')
order by p.proname, args;

-- 2) is_admin() 是否含 aal2 判斷（0016）
select position('aal2' in pg_get_functiondef('public.is_admin()'::regprocedure)) > 0 as is_admin_checks_aal2;

-- 3) 四張設計師表：RLS 應為 true、force RLS 應為 false
select relname, relrowsecurity, relforcerowsecurity
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in ('designers','designer_services','designer_portfolio_images','designer_leaves')
order by relname;

-- 4) storage.objects 的全部 policy（policy 之間是 OR，確認沒有人在 Dashboard 手動建過寬鬆的 policy）
select policyname, cmd, roles::text as roles, qual, with_check
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
order by policyname;

rollback;
```
