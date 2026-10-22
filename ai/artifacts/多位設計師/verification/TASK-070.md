# 驗證報告

## 摘要

- 任務：TASK-070 多位設計師 「提供服務」頁籤與新增服務的預設行為
- 結果：通過（有殘留風險，見下方）
- 驗證者：實作 agent（Claude Code）。動工前 architect、security-reviewer 兩份審查意見**不等同人工核准**；
  product／ui／architecture／security／test／code_review 關卡待人工核准。**尚未做實作後的 security／test 審查**
  （是否補做由人工決定）。

## 指令

| 指令 | 結果 | 備註 |
|---|---|---|
| `npx tsc --noEmit` | 通過 | |
| `npm run lint` | 通過 | 0 error、0 warning |
| `npm run build` | 通過 | 路由清單不變（`/admin/designers`、`/admin/designers/[id]`、`/admin/designers/new`）。build 前先停掉 dev server，build 後重啟 |
| `npx vitest run --maxWorkers=3`（全套） | 712／716 通過，4 項逾時失敗 | 失敗全在 `tests/components/account-settings-view.test.tsx`（5 秒逾時），沒改到的檔案；該檔單獨跑 33 項全過。與 TASK-069 報告記載的「預設並行度下無關檔案偶發逾時」同一類，判斷為機器負載 |
| 本卡相關檔案（7 個測試檔，136 項） | 通過 | 最後連跑 2 次皆全過；**另有一次跑出 1 項失敗，當下沒有擷取是哪一項**，隨後兩次重跑與單獨重跑皆通過，疑似同類逾時，未能證實 |
| `npm run test:designers -- -t "TASK-070"`（真實 Supabase 專案） | 通過 | 7 項（見下方），afterAll 的清除斷言通過，無殘留 |
| 瀏覽器走查（登入後台，真實專案） | 通過 | 見下方「走查」 |

本卡新增的測試：

- `tests/admin/designers-write.test.ts`（擴充，新增 9 項）：`listDesignerServiceIds` 的查詢欄位與 `eq`；`setDesignerService`
  的 insert 欄位白名單、23505 視為成功、23503／42501／22P02 回通用訊息、只比對 `code`、delete 恰好兩個 `eq` 加 `select`、
  delete 回 0 列／null／多於 1 列／錯誤皆失敗、錯誤的 uuid 不送請求、例外不外拋。
- `tests/components/designer-services-tab.test.tsx`（新增，10 項）：載入、下架服務不列出且不計數、空狀態、開啟（含寫入期間該列
  停用、其他列不受影響）、關閉、寫入失敗重讀以資料庫為準、結果不明（伺服器其實已寫入）、重讀也失敗時只回復該列、兩份資料任一
  讀取失敗不畫 Switch。
- `tests/components/designer-edit-view.test.tsx`（擴充，新增 3 項）：面板載入後常駐掛載且用資料庫回傳的小寫 id、新增模式不掛載、
  頁籤標籤的數字在回報前沒有、回報後顯示。
- `tests/components/service-form-dialog.test.tsx`（新增，3 項，**不在原任務卡允許清單，已補進任務卡**）：新增成功的新 Toast 文案、
  編輯維持原文案、新增失敗不顯示成功提示。
- `tests/designers.integration.test.ts`（擴充，新增 7 項，真實 Supabase）：admin 開啟寫入一列且重複開啟冪等；關閉只刪那一列
  （同設計師其他服務、其他設計師同一服務都不受影響）；關閉本來沒開的服務回失敗且資料不變；admin 讀得到停用中設計師的服務開關
  且可對其開關；不存在的設計師或服務（外鍵）回通用錯誤且不寫入；**非管理員 insert 被擋、delete 回失敗（0 列）且既有資料列仍在**；
  anon 讀不到停用中設計師的 `designer_services`、讀得到啟用中的。

## 走查（Browser 工具，正式資料庫）

隔離做法：建立 `__TEST__走查070` 設計師後**立刻以 service_role 停用**（停用的設計師不會被指派預約、anon 也讀不到其服務列），
所以開關真實服務不影響顧客；新增服務只建立一個 `__TEST__走查070服務`，驗證後立即清除。全程沒有碰「預設設計師」與「小狗」。

- 編輯頁：標籤顯示「提供服務 0」（還沒點進去就有數字）；點進去列出 4 個上架中服務，名稱、時長、價格、Switch，預設全關。
- 開啟兩項：數字變 2，資料庫 2 列；重新整理後 Switch 與標籤數字（2）皆保留。
- 寫入中（攔截 fetch 延遲 8 秒）：該列 Switch `disabled`、其他列可操作，標籤數字已先更新（樂觀更新）。
- 寫入失敗（攔截 fetch 對關閉回 403）：Toast「操作失敗，請稍後再試」，重讀資料庫後 Switch 回復為開啟、數字維持 4、Switch 重新可操作。
- 真正關閉：數字 4→3，資料庫 3 列。
- 服務設定頁新增 `__TEST__走查070服務`：Toast「已新增服務。新服務預設不開給任何設計師，請到「設計師」頁開啟。」；回到設計師頁，
  該服務在這位設計師的頁籤是**關閉**，開啟數仍是 3（驗收標準「新增服務後在所有設計師頁籤都是關閉」；另一位設計師未逐一開頁檢查，
  由資料層保證：`createService` 不寫 `designer_services`）。
- 清除：以 service_role 刪除測試設計師與測試服務，查詢確認只剩「預設設計師」「小狗」與 4 個真實服務、`designer_services` 4 列
  （預設設計師原本的 4/4）。

## 螢幕截圖

由 Browser 工具擷取，未存成專案檔案：提供服務頁籤（預設全關、開啟後、寫入中、寫入失敗 Toast）、新增服務成功 Toast。
**未擷取／未走查**：亮色模式與手機寬度（沿用 MUI Switch 與 Paper，未新增樣式）；載入失敗與空狀態（元件測試涵蓋）；
一次開兩個以上並行寫入的實際畫面（元件測試以單列涵蓋，並行重讀時保留其他列樂觀值的分支沒有測試）。

## 已採納的動工前審查（詳見任務卡「動工前審查定案」）

- delete 以 `.select("service_id")` 要求剛好 1 列才算成功（RLS 擋下 delete 時 PostgREST 回成功但 0 列）；兩個 `eq` 與 id 格式在
  函式內強制，不依賴呼叫端。
- insert 只把 `error.code === "23505"` 當成功；不用 upsert；其餘錯誤通用訊息。
- 面板常駐掛載、父層只存 `serviceCount: number | null`；失敗以重讀資料庫為準；兩份資料任一讀取失敗不畫 Switch。
- 使用資料庫回傳的設計師 id（網址大小寫不影響）。

## 殘留風險與已知限制

- 關掉某服務的最後一位設計師時不提示：前台在 TASK-073 上線前仍會列出沒有任何設計師的服務，顧客看到服務但沒有時段，直接呼叫
  `create_appointment` 回 SLOT_CONFLICT。新增服務的 Toast 文案已部分緩解（新服務預設關閉就是同一種情況）。
- 候選清單算完到 insert 之間剛好有人關閉服務，預約仍會成立（與 TASK-068 已接受的「停用設計師／新增請假」殘留同類，沒有 lock）。
- 後台改期（`rescheduleAppointment`）不檢查設計師資格，是既有行為，不是本卡引入。
- delete 回 0 列時無法分辨「別的分頁已關閉」與「權限不足」，一律當失敗並重讀；多分頁同時操作是最後寫入為準，由冪等與重讀收斂。
- 非管理員對「停用中設計師」本來就讀不到，這類情況重讀結果也可能不同；後台入口已要求 aal2，視為可接受。
- 整合測試的 aal1（有 MFA 但 session 只有 aal1）情境沒有測：`test:mfa-rls` 尚未涵蓋新表（同 TASK-067 登記的殘留）。
- 全套測試在預設並行度下的逾時不穩定（`account-settings-view`），非本卡引入。

## 人工核准

- 核准者：使用者
- 日期：2026-10-22
- 備註：驗收通過。實作後的 security／test 審查未做。使用者詢問服務頁籤是否應有存檔按鈕與未存檔提示：該頁籤是已核准的「開關即時儲存」設計，維持不變；
  後台所有有儲存按鈕的表單都沒有未儲存離開提示，另開 TASK-081 處理，不併入本卡。
