# 驗證報告

## 摘要

- 任務：TASK-072 多位設計師 「請假」頁籤（月曆標記整天請假、受影響預約警告）
- 結果：通過（有殘留風險，見下方）
- 驗證者：實作 agent（Claude Code）。動工前 architect、security-reviewer 與**實作後 security-reviewer、test-engineer** 的審查意見
  都**不等同人工核准**；product／ui／architecture／security／test／code_review 關卡待人工核准。實作後審查已於 2026-10-22 完成，
  結果與處理見下方「實作後審查」。

## 指令

| 指令 | 結果 | 備註 |
|---|---|---|
| `npx tsc --noEmit` | 通過 | |
| `npm run lint` | 通過 | 0 error、0 warning |
| `npm run build` | 通過 | 路由清單不變。build 前先停掉 dev server，build 後重啟 |
| `npx vitest run --maxWorkers=3`（全套，審查補強後） | 847／850 通過，3 項失敗全在 `account-settings-view`（5 秒逾時） | 沒改到的檔案，單獨跑 33 項全過，與 TASK-069／070／071 報告記載的逾時同一類。審查補強前的全套為 844／844。同一輪另有一次（共跑三輪）出現 4 項失敗、2 個檔案，我沒抓到第二個檔案的名稱，之後兩輪沒有重現 |
| `npm run test:designers -- -t "TASK-072"`（真實 Supabase 專案，審查補強前後各跑一次） | 通過 | 10 項（見下方），afterAll 的清除斷言通過，無殘留 |
| 瀏覽器走查（登入後台，真實專案） | 通過 | 見下方「走查」 |

本卡新增或擴充的測試：

- `tests/admin/designers.test.ts`（9→29，新增 20 項，含審查補的 `is_closed` 單獨成立）：`listDesignerLeaves`（只查該設計師、日期由小到大、id 格式錯誤不送請求、失敗回通用錯誤）；
  `findAffectedAppointmentsForDesignerLeave`（過濾條件：設計師、pending／confirmed、台北時間 `[00:00, 次日 00:00)`、依時間排序、limit 200；
  跨月跨年；select 只列最小欄位；服務名稱攤平三種形狀；`2099-02-30`／`today`／`infinity`／`2099-2-1` 等日期與非 uuid id 在送出請求前被擋）；
  `isShopClosedDate`（每週固定公休、`closed_dates`、查不到列或缺開關店時間都算公休）。
- `tests/admin/designers-write.test.ts`（93→121，新增 28 項，含審查補的 delete 回 null 或 2 列以上）：`addDesignerLeave`（insert 一列、不用 upsert、今天可標記、23505 視為成功、
  `23503`／`42501`／`PGRST301`／空碼／undefined 一律通用失敗、例外、過去與不合法日期不送請求）；`removeDesignerLeave`（兩個 `eq` 都帶、
  `select` 確認剛好 1 列、過去日期可移除、0 列失敗、錯誤與例外、不合法日期與 id 不送請求）。
- `tests/components/month-picker.test.tsx`（新增，6 項，含審查補的「今天可點」）：過去日期不能點；`readOnlyDates` 不可點、鍵盤也不能觸發、無障礙名稱含日期與說明、
  刪除線；唯讀優先於已標記；省略時行為不變；跨年導覽。
- `tests/components/designer-leaves-tab.test.tsx`（新增，20 項，含審查補的：確認成功後重讀與解除鎖定、確認失敗後重試、對話框標題日期格式、寫入中清單「移除」與月曆已標記日被擋、「今天」邊界、讀取函式拋例外）：載入只列今天以後並回報天數、空狀態、三種載入失敗；點日期直接新增；有預約先警告
  （時間、顧客、服務與文案）再確認；取消不寫入並解除鎖定；確認寫入失敗保留對話框；查詢受影響預約失敗不寫入（fail closed）；新增失敗重讀；
  點已標記日期與清單「移除」直接刪除、失敗重讀；全店公休（`closed_dates` 與每週固定公休）唯讀；同一天既請假又全店公休時清單仍可移除；
  寫入成功但重讀失敗保留畫面並 Toast；寫入中處理函式自己的 busy 防呆。
- `tests/components/designer-edit-view.test.tsx`（新增 2 項、改 1 項）：請假面板常駐掛載且傳入資料庫回傳的小寫 id 與名稱、新增模式不掛載；
  頁籤天數回報與獨立的無障礙名稱；原「請假占位內容」案例改成請假面板。
- `tests/designers.integration.test.ts`（新增 10 項，真實 Supabase）：admin 新增（重複新增冪等）、可對停用中的設計師新增；移除只影響指定那一天
  （同設計師其他日期、其他設計師同一天都在，再移除一次回失敗）；不存在的設計師（23503）回通用錯誤且訊息不含 constraint 名稱；函式層擋過去與
  不合法日期（資料庫沒收到列）；非管理員新增被 RLS 擋下、移除回失敗且列仍在、讀取是空的；anon 讀取／新增／移除都失敗；
  `findAffectedAppointmentsForDesignerLeave` 只回該設計師當天 pending／confirmed（排除其他設計師、cancelled、completed、前一天 23:30、次日 00:00，
  依時間排序，欄位剛好是 `id, customer_name, start_at, service_name`）；非管理員與 anon 看不到預約；**標記請假後指定該設計師的
  `get_available_slots` 回空陣列，移除後恢復**（驗收標準 1，TASK-068 已完成所以現在就能驗）。建立的預約一律 `customer_email: null`。

## 走查（Browser 工具，正式資料庫）

隔離做法：以 service_role 建立 `__TEST__走查072` 設計師，**建立時就是停用狀態**（不會被指派預約、anon 也讀不到），以及該設計師當天兩筆預約
（`customer_email` 為 null，不觸發寄信）。沒有碰「預設設計師」與「小狗」。走查完以 service_role 刪除預約與設計師，查詢確認只剩「預設設計師」「小狗」、
`designer_leaves` 0 列、`__TEST__` 預約 0 筆。

- 頁籤標籤在點進去之前就顯示「請假 1」（已排 1 個請假日）。
- 預設畫面（暗色）：月曆、今天外框、過去日期淡化、**每週日（全店公休）灰底加刪除線且不能點**、已標記日期暖色底加小圓點、圖例、
  右側「即將到來的請假」清單與說明文字。
- 點有 2 筆預約的日期：對話框「標記 10/24（六）為__TEST__走查072的請假日？」，列出「11:00 顧客 · 服務」「15:30 顧客 · 服務」與
  「這些預約不會自動取消，也不會通知顧客，請記得另外處理。」；按「仍要標記請假」後 Toast「已標記請假」、月曆與清單更新、頁籤數字 1→2；
  重新整理後仍在。
- 點沒有預約的日期：直接新增，沒有對話框，頁籤數字 3。
- 點已標記日期（月曆）與清單的「移除」：直接移除、不警告，頁籤數字回到 1。
- 下個月的每個週日：`aria-label`「N 日，全店公休」、`aria-disabled=true`、點擊沒有反應。
- 寫入失敗（攔截 `designer_leaves` 的 POST 回 403）：Toast「操作失敗，請稍後再試」，月曆與清單維持不變。
- 768px 寬度（亮色）：無橫向捲動，圖例色塊可見。主控台只有 dev server 的 HMR WebSocket 連線錯誤（既有）與該分頁在 TASK-071 走查時留下的一筆 400。

## 實作後審查（2026-10-22，security-reviewer、test-engineer；非人工核准）

**security-reviewer：可以驗收，沒有必須修正項目。** 動工前定案逐項核對都已落實（add／remove／find 先驗證 id 與日期、remove 兩個 `eq`、只有 23505 算成功、
try/catch、select 最小欄位）；畫面只有固定文案、無 `console.*`；`customer_name`／`service_name`／`designerName` 都以文字節點渲染；`isRealDate` 擋得住
換行結尾、全形數字、空白、`2099-02-30`；沒有新增前台可讀路徑。處理：
- 建議：初次載入的 `Promise.all` 沒有 `.catch`，`getAllBusinessHours`／`getAllClosedDates` 拋例外時會一直停在 Skeleton → **已修**（改顯示錯誤）並補測試。
- 建議：非管理員呼叫 find 的斷言太弱 → **已修**（明確斷言 `{ ok: true, data: [] }`）。
- 建議：`tests/mfa-rls.integration.test.ts` 補 aal1 對 `designer_leaves` 的案例 → **未做**（不在允許變更的檔案內，沿用 TASK-067／070／071 登記的殘留）。
- 可忽略：`0000-01-01`、`9999-12-31` 能通過 `isRealDate`，但前者被「早於今天」擋下或由資料庫報錯、後者在 find 時查詢報錯而 fail closed；`add` 沒有日期上限，只有管理員能寫、影響低。

**test-engineer：需補測試後再驗收（缺口不大），合約每一項都有對應測試，沒有宣稱有測但實際沒測。** 變異推演中 remove 少一個 `eq`、非 23505 當成功、
add 不擋過去日期、find 不過濾設計師／狀態／日期、唯讀日期可點、寫入或查詢失敗後沒重讀／沒 fail closed，現有測試都會失敗。處理：
- 必須：確認警告後寫入成功，沒斷言重讀與解除鎖定（拿掉 `reloadLeaves()` 或 `setBusy(false)` 測試仍通過）→ **已補**。
- 必須：整合測試沒涵蓋「非管理員／anon 對已存在的列新增」（23505 若在 RLS 之前回傳會被當成冪等成功，UI 顯示已標記但其實無權限）→ **已補並實測通過**，
  證實 RLS 的 WITH CHECK 先於唯一性檢查。
- 建議：`isShopClosedDate` 的 `is_closed` 單獨成立、delete 回 null 或 2 列以上、「今天」邊界（清單與 `MonthPicker`）、busy 時清單移除的防呆、確認失敗後重試、
  對話框標題日期格式 → **都已補**。
- 建議：整合測試的服務預設上架，期間前台可見 → **已修**（服務預設下架，只有「前台時段」案例才暫時上架）。
- 驗證報告的測試數量都對得上；報告原先沒交代「確認後重讀」只靠行為推測——現已有斷言。

## 螢幕截圖

由 Browser 工具擷取，未存成專案檔案：預設（暗色）、受影響預約警告對話框、標記成功（Toast、清單、月曆）、768px 亮色。
使用者看過畫面後調整：清單的「移除」文字改為危險色（`color="error"`；亮色 rgb(179, 70, 46)、暗色 rgb(227, 122, 92)）——使用者已確認顏色。
同時修掉右欄較窄時日期「10/26（一）」折成兩行（改為不折行，按鈕內距與欄間距縮小）。
**未擷取／未走查**：已啟用 MFA 但只有 aal1 的 admin 情境（`test:mfa-rls` 尚未涵蓋新表，同 TASK-067／070／071 登記的殘留）；
同時開兩個分頁操作；載入失敗畫面（元件測試涵蓋）。

## 已採納的動工前審查（詳見任務卡「動工前審查定案」）

- **灰底用 `grey.200`**：我原本想用 `action.disabledBackground`，architect 指出暗色 grey 色階已經覆寫（`lib/theme/index.ts`）、`WeekCalendar` 公休格本來就用
  `grey.200`，查證後採用，讓「全店公休」在月曆與週曆同一個 token；並更正 `MonthPicker.tsx` 內過時的註解。
- 唯讀日期的 `aria-label` 含日期（「15 日，全店公休」），否則無障礙名稱會被蓋成只剩說明。
- 四個函式都包 try/catch、`designerId` 與日期一律先驗證（remove／find 也驗證）、remove 兩個 `eq` 寫死、只有 23505 算新增成功、
  `add` 函式層也擋「早於台北今天」。
- 受影響預約**不加 `start_at > now`、不含 `completed`**（與公休日不同，註解與任務卡都寫明）。
- `isShopClosedDate` 對齊 RPC：查不到該週幾的列、缺開／關店時間都算公休。
- 寫入成功但重讀失敗：保留畫面現狀並 Toast，不換成整頁錯誤。
- 整合測試：`customer_email` 一律 null、非管理員與 anon 的新增／移除／讀取、移除範圍、受影響預約邊界、`get_available_slots` 驗收。
- 任務卡「允許變更的檔案」補列 `app/design-system/page.tsx`（Demo 補唯讀日期）與各測試檔。

## 實作中發現並修正

- 走查時發現圖例的「全店公休」色塊在暗色模式幾乎看不見（`grey.200` 貼近背景）：兩個圖例色塊加上 `grey.300` 細邊框。
- 元件測試：寫入進行中的鎖定是 CSS `pointer-events: none`，`user-event` 會直接拒絕點擊；改用 `fireEvent` 驗證處理函式自己的 busy 防呆。

## 殘留風險與已知限制

- 查受影響預約到寫入之間顧客剛好下單，這筆不會出現在警告裡（與公休日同類，沒有 lock）。
- **TASK-075 完成前，後台改期（`lib/admin/reschedule-slots.ts`）不看請假日**，店長可以把預約改到設計師請假的那一天。
- 請假日在資料庫層沒有「>= 今天」約束，只有函式層與畫面擋過去日期（過去的請假日不影響前台；加 constraint 會讓日後清理舊資料變麻煩）。
- 「今天」只在掛載時算一次，頁面開著跨午夜不會更新（沿用 `ClosedDatesSection` 寫法）。
- 兩個分頁同時操作：後到的移除回失敗並重讀，Toast 會顯示一次「操作失敗」。
- 寫入成功但重讀失敗時畫面停在舊狀態（刻意設計，Toast 提醒重新整理）；再點一次新增（23505 冪等）或移除（0 列重讀）會自動修正。
- `tests/mfa-rls.integration.test.ts` 尚未涵蓋 `designer_leaves`（aal1 管理員）；`addDesignerLeave` 沒有日期上限。
- 實作後審查的 security／test 結論是 subagent 意見，不等同人工核准。
- 後台週曆與列表還看不到請假日標示（TASK-075）；前台時段由 TASK-068 的 RPC 強制，本卡整合測試已驗證寫入後立即生效。
- `app/design-system` 頁的 MonthPicker Demo 新增兩個唯讀日期（8/10、8/11），未走查該頁畫面（只有型別檢查、lint、build 與元件測試）。

## 人工核准

- 核准者：使用者
- 日期：2026-10-22
- 備註：驗收通過。實作後 security／test 審查建議已採納（唯 mfa-rls 的 aal1 案例未補），殘留風險維持已知限制。
