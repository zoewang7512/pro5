# 驗證報告

## 摘要

- 任務：TASK-075 多位設計師 後台週曆／列表設計師標示與多選篩選、詳情顯示設計師、改期依原設計師
- 結果：通過（有殘留風險，見下方）
- 驗證者：實作 agent（Claude Code）。動工前 architect、security-reviewer 的審查意見**不等同人工核准**；product／ui／architecture／security／
  test／code_review 關卡待人工核准。**本卡沒有做實作後的 subagent 審查**（使用者只要求動工前審查）。

## 指令

| 指令 | 結果 | 備註 |
|---|---|---|
| `npx tsc --noEmit` | 通過 | |
| `npm run lint` | 通過 | 0 error、0 warning（中途一個 `useMemo` 依賴警告已修） |
| `npm run build` | 通過 | 路由清單不變。build 前先停掉 dev server，build 後重啟 |
| `npx vitest run --maxWorkers=3`（全套，最終程式碼） | 1026／1030 通過，4 項失敗全是 5 秒逾時 | 失敗在 `account-settings-view`（3 項）與 `designer-picker-section`（1 項），**都不是本卡改的檔案**；兩個檔案單獨重跑 56／56 通過。同一類逾時 TASK-069～072 報告已記載。前一輪全套為 1028／1030（同樣是 `account-settings-view` 2 項逾時） |
| `npm run test:admin-booking`（真實 Supabase 專案） | 16／16 通過 | 含本卡新增 3 項（見下方），afterAll 清除無殘留 |
| `npm run test:business-hours -- -t "後台改期表單"`（真實 Supabase 專案） | 1／1 通過 | 只跑被本卡改簽名的那一項（TS 版與 RPC 版一致性，現在雙方都指定同一位設計師）；**沒有跑該檔其他 32 項**（它們會暫時改營業時間，與本卡無關） |
| 瀏覽器走查（登入後台，真實專案，`__TEST__` 資料） | 通過 | 見下方「走查」 |

本卡新增或擴充的測試（單位：項，含 `it.each` 展開）：

- `tests/admin/designer-filter.test.ts`（新增，29）：`buildDesignerChips`（啟用中一律出現、計數排除已取消、停用中只在本週有預約時出現、
  只剩已取消仍出現、與啟用的混排依 `sort_order`、不改動輸入）；`toggleDesigner`（可複選、再點取消、取消最後一個回到空＝全部、不改動輸入）；
  `resolveEffectiveSelection`（空＝全部、依 chip 順序、切週後 chip 消失的殘留 id、全部消失回到全部、**以有效選取為基礎切換會清掉殘留 id**、
  **勾選全部設計師維持勾選但結果同全部**、**全部勾選後切到多一位停用設計師的週次，那位預約被隱藏**）；`filterAppointments`；
  `shouldShowDesignerRow`（0／1／2／3 位）；`buildLeaveLabels`（全部不標示、一位、多位依 chip 順序、勾選全部、沒資料）；`formatFilteredEmptyTitle`。
- `tests/admin/reschedule-slots.test.ts`（擴充，32 項）：原有 `computeAvailableSlots` 呼叫補必填參數；新增請假日回空與對照組；
  `getOccupiedRangesForDate`（`.eq("designer_id", A)` 與 `.neq("id", X)` 用兩個不同 id 同時斷言、換設計師換條件、**`null`／`undefined`／空字串／非 uuid／
  夾帶 PostgREST 語法的 designerId 一律 fail-closed 且不送請求**、查詢失敗通用錯誤、緩衝 embed 三種形狀）；`isDesignerOnLeave`（過濾條件、有列／沒列、
  **查詢失敗與拋例外都回錯誤**、`null`／非 uuid／`today`／`infinity`／`2099-02-30`／`2099-2-1` 不送請求）。
- `tests/admin/appointments.test.ts`（擴充，16 項）：週曆 select 帶 `designer_id` 與 `designers(id, name, avatar_url)`、**不含 `*`／`!inner`／電話／email／access_token**；
  攤平物件／陣列／null 三種 embed；詳情查詢與週曆共用欄位且保留電話。
- `tests/admin/designers.test.ts`（擴充，36 項）：`getDesignerFilterOptions`（不過濾 `is_active`、最小欄位、排序、失敗通用錯誤）；
  `getDesignerLeavesInRange`（範圍兩端含、最小欄位、不用 `.in()`、不合法日期不送請求）。
- `tests/components/designer-filter-chips.test.tsx`（新增，15）：預設亮起「全部」、「已停用」、勾選 ✓＋`aria-pressed`＋「清除篩選」、點擊回報、載入 Skeleton、
  沒有 chip 不顯示、`<bdi>`、Chip 頭像 `referrerpolicy=no-referrer`；`DesignerAvatar` 白名單（別的網域、同網域別的 bucket、`javascript:`、帶帳密都不渲染 `<img>`）；
  `DesignerLabel` 裁切。
- `tests/components/appointment-list-view.test.tsx`（新增，4）：表頭有「設計師」、embed 缺漏顯示破折號、**空狀態與載入列 `colSpan` 為 6**、篩選後空狀態文案。
- `tests/components/week-calendar.test.tsx`（擴充，14）：設計師列顯示／隱藏、embed 缺漏、請假標示（單位、多位、有標示時不顯示「—」）、篩選後空狀態與整週空狀態文案、`<bdi>`。
- `tests/components/appointment-detail-dialog.test.tsx`（新增，7）：詳情設計師列；改期表單設計師唯讀並說明；**時段與請假查詢都用該設計師 id、與排除的預約 id 不同**；
  對照組有時段；**請假日顯示說明、不畫灰掉的時段按鈕**；**請假查詢失敗與佔用查詢失敗都 fail-closed 顯示錯誤**。
- `tests/admin-booking.integration.test.ts`（真實 Supabase，擴充 +3）：週曆查詢帶出 `designer_id` 與 `designer`；**`getOccupiedRangesForDate` 只回該設計師的預約（同一測試內有正向對照：
  自己的預約確實被回傳，避免 RLS 回空造成恆真斷言）**；**兩位設計師同時段各自改期互不影響、撞到自己的預約回 `SLOT_CONFLICT`、撞到別位的可以**；
  **`isDesignerOnLeave`／`getDesignerLeavesInRange` 經 RLS 讀得到請假日、只算指定設計師、anon 失敗（不是回「沒請假」）**。第二位測試設計師用 `createTestDesigner`
  並納入 afterAll 的 `cleanupTestDesigners`；請假列 afterAll 先明確刪除；`customer_email` 一律 null。
- `tests/business-hours.integration.test.ts`（改簽名）：TS 版與 RPC 版一致性改成雙方都指定同一位測試設計師，並納入請假查詢。

## 走查（Browser 工具，`localhost:3000`，登入後台，正式資料庫）

隔離做法：以 service_role 建立 `__TEST__走查075` 服務與三位設計師（林；陳——建立時就是停用；一位 23 字名稱）、各設計師預約（`customer_email` 為 null，
不觸發寄信）與請假日，放在約 6 週後的週次（11/30–12/6）；因改期表單日期範圍只有未來 21 天，另補一組近期（10/27–10/29）資料，**補建同時把兩位測試設計師
改為停用**，避免出現在前台公開的設計師列表（先前約 15 分鐘兩位為啟用狀態，但都沒有開任何服務）。沒有碰「預設設計師」與「小狗」，沒有替真實設計師加請假，
只改期 `__TEST__` 預約。走查完以 service_role 刪除，查詢確認 `designers`／`services`／`__TEST__` 預約皆 0，只剩「預設設計師」「小狗」。

- 預設（暗色）：「全部 · 3」亮起（已取消的不計）；各設計師 Chip 帶頭像／首字、預約數；停用中且本週有預約的設計師標「已停用」；本週沒預約的停用設計師不出現。
  `小狗` Chip 的 `<img>` 帶 `referrerpolicy="no-referrer"`（DOM 確認）。
- 勾一位：該設計師 Chip 加 ✓、「全部」取消亮起（`aria-pressed` 確認）、出現「清除篩選」；事件卡**不顯示**設計師列；請假日格顯示「○○請假」。
- 勾兩位：事件卡**顯示**設計師列；請假標示對每位勾選的設計師都顯示。
- 取消最後一個勾選：自動回到「全部」，「清除篩選」消失，四筆預約全部顯示。
- 切到列表：篩選保留；表頭有「設計師」欄，每列顯示頭像與名稱。
- 篩選後該週沒有預約：「○○本週沒有預約／切換到「全部」或其他週次看看」（週曆與列表）；切到下週：篩選保留、Chip 預約數更新、沒有預約的停用設計師 Chip 消失、
  整週本來就沒預約時顯示「本週沒有預約」。
- 預約詳情：多一列「設計師：頭像＋名稱」。
- 改期表單：設計師欄唯讀「○○（改期不能更換設計師）」；選 10/28（B 同時段 11:00 有預約）→ 11:00 **仍可選**，A 自己的 15:00 預約→15:00 被排除；
  選 10/29（A 請假）→ 顯示「當日公休、設計師請假或已無可預約時段，請選擇其他日期。」，沒有任何時段按鈕；實際把 A 的預約改到 10/28 11:00 → Toast「已更新預約時段」，
  週曆上與 B 的預約並列同一時段。
- 亮色模式：Chip 選取態、請假標示（warning 色）正常；結束後切回暗色。
- 主控台沒有錯誤。

**走查發現並修正的兩個問題**：
1. 長名稱或「已停用」的 Chip 計數被裁掉（標籤容器 `inline-flex` 撐破 Chip 的省略號容器）→ 改 `display: flex`，名稱先縮、計數常駐。
2. 窄欄時請假標示「__TEST__…請假」的「請假」兩字被省略號吃掉 → 名稱與「請假」拆成兩個元素，名稱先省略、「請假」常駐（並更新元件測試）。

## 螢幕截圖

由 Browser 工具擷取，**未存成專案檔案**（畫面含走查用 `__TEST__` 資料，也避免 commit 任何真實個資）：全部、勾一位（含請假標示）、勾兩位、詳情、改期（有時段／請假日）、
列表、篩選空狀態、亮色與暗色。**沒有擷取**：載入中 Skeleton 的畫面（元件測試涵蓋）、768px 以下窄視窗（後台以桌面為主，screen-spec 不另外設計）。

## 已採納的動工前審查（詳見任務卡「動工前審查定案」）

- 範圍補列 `lib/admin/designers.ts`、`tests/business-hours.integration.test.ts`（使用者 2026-10-22 同意）；**另外為了讓整合測試能載入 `@/` 匯入，
  對 `vitest.admin-booking.config.ts`、`vitest.business-hours.config.ts` 加上 `@` 別名**（比照 `vitest.designers.config.ts` 的既有做法；這兩個檔案不在任務卡原列的允許範圍內，
  是實作時才發現的必要連動，請一併確認）。
- 改期時段計算 fail-closed：`designerId` 不合法或請假查詢失敗都進錯誤分支；請假日直接給空 cells、不呼叫 `buildSlotGrid`。
- `getOccupiedRangesForDate` 改物件參數；週曆與詳情共用 select 欄位與 `toWeekAppointment`；embed 不用 `*`／`!inner`。
- `DesignerAvatar` 是頭像唯一渲染點；顧客名稱、設計師名稱用 `<bdi>`；Chip／標示裁切；列表 `colSpan` 改 6。
- 整合測試正向對照；走查只動 `__TEST__` 資料。

## 殘留風險與已知限制

- **停用中設計師、設計師沒開此服務、請假日，改期都只在前端檢查**，資料庫不強制（資料庫只擋同一設計師時段重疊）：繞過前端直接 API 呼叫可以把預約改到請假日；
  改期表單開著期間另一分頁新增請假，改期仍會成功。**TASK-072 驗證報告登記的殘留「改期不看請假日」因此改成「改期請假檢查只在前端」**（我沒有改動那份已核准的報告）。
  需要更強的保證時，後續卡可考慮 BEFORE UPDATE trigger 或 admin 專用改期 RPC。
- 設計師 options 掛載時只查一次，另一個分頁新增或停用設計師要重新整理才看得到（比照 `closedWeekdays`）。
- 篩選列在週次切換時會短暫顯示 Skeleton（與週曆載入同步，依 screen-spec）。
- 週曆窄欄（800px 視窗）事件卡的設計師名稱會被省略成前幾個字；詳情 Modal 有完整名稱。
- 事件卡設計師列、Chip 都用 `<bdi>` 與裁切處理從右到左文字與超長名稱，**顧客名稱的方向控制字元（RLO 等）仍可由前台寫入資料庫**（`create_appointment` 只檢查長度，既有風險）。
- 後續卡建議（security-reviewer）：① `customer_name` 的資料庫字元檢查；② `DesignersTable` 頭像補 `referrerPolicy`。
- `tests/mfa-rls.integration.test.ts` 仍未涵蓋 `designer_leaves`（aal1 管理員），沿用 TASK-067／070／071／072 登記的殘留。
- 未走查：已啟用 MFA 但只有 aal1 的 admin；同時開兩個分頁操作；載入失敗畫面（元件測試涵蓋）；窄視窗。

## 人工核准

- 核准者：使用者
- 日期：2026-10-22
- 備註：驗收通過。範圍外的 vitest `@` 別名連動、已知限制維持原樣，兩張後續卡尚未建立。
