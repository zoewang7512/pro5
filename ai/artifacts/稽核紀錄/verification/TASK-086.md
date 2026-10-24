# 驗證報告

## 摘要

- 任務：TASK-086 稽核紀錄 列表畫面與驗收（`/admin/audit-log`）
- 結果：**實作與自動化驗證通過；人工驗收待辦**（含下方「尚未涵蓋」的預約操作走查）
- 驗證者：實作 agent（Claude Code）。product 關卡：使用者確認簡版規格書（2026-10-24）；ui 關卡：使用者選定 mockup 變體 A（2026-10-24）；security-reviewer 見下方「審查」；architecture／test／code_review 與人工驗收待核准。
- 分支：`feat/audit_log`
- 看板：維持 Backlog——前置 TASK-084／085 仍在 Verify，`dependsOn` 防呆不允許推進。

## 變更

| 檔案 | 內容 |
|---|---|
| `ai/artifacts/稽核紀錄/screen-spec-稽核紀錄列表.md`、`mockup-decision-稽核紀錄列表.md`、`mockups/audit-log-variant-a/b/c.html` | Phase 3：畫面規格書、3 個變體、取捨比較；使用者選定 A |
| `app/admin/_components/AuditLogView.tsx`（新增）、`app/admin/audit-log/page.tsx`（新增） | 列表：類別篩選、載入更多、載入中／載入更多中／載入更多失敗／空（兩種）／錯誤／已到最後一頁；競態以遞增請求序號處理；純文字渲染 |
| `app/admin/_components/AdminShell.tsx` | Sidebar 最後一項「稽核紀錄」＋手繪 SVG 圖示 |
| `tests/components/audit-log-view.test.tsx`（新增 21 項）、`tests/components/admin-shell.test.tsx`（新增 2 項斷言） | 元件測試 |
| `ai/context/project-map.md`、`decisions.md`、`design-system.md` | 稽核紀錄段落（含保證邊界、已知限制、整合測試雜訊）、`test:audit-log`／`sweep:audit-test-rows` 指令列、`lib/admin/audit-log.ts` 目錄列；決策定稿；元件庫 inventory 登記 `AuditLogView`、Sidebar 圖示數量、S5 版面列 |
| `lib/admin/audit-log.ts`（`describeAuditEntry` 內部）、`tests/admin/audit-log.test.ts` | **走查發現的缺陷修正**（見下方「走查發現」）：差異改依固定順序顯示；新增 1 項測試（先確認會失敗再修）。未改任何對外介面 |
| `tools/kanban/cards/TASK-086.json` | `gates.ui` 轉 true、補評論 |

未碰：`lib/admin/audit-log.ts` 的對外介面（型別與函式簽名）、migration、其他頁面。

## 指令

| 指令 | 結果 | 備註 |
|---|---|---|
| `npx tsc --noEmit` | 通過 | 0 錯誤 |
| `npm run lint` | 通過 | 0 error、0 warning（過程中修掉一則 `react-hooks/exhaustive-deps` 警告） |
| `npm run build` | 通過（修正差異順序後再跑一次） | `/admin/audit-log` 出現在路由表 |
| `npx vitest run tests/components/audit-log-view.test.tsx tests/components/admin-shell.test.tsx` | 33 項全過 | 新增 21＋2 |
| `npx vitest run --testTimeout=60000 --maxWorkers=4`（全套） | 78 檔／1356 項，1355 通過 | 唯一失敗 `designer-portfolio-tab` 為既有並行負載不穩定（TASK-084／085 報告已記載），單獨重跑 11 項全過，與本卡無關 |
| `npm run test:audit-log` | **28 項全數通過** | 對真實 Supabase 專案 |
| `npm run sweep:audit-test-rows`（dry-run） | 找到 0 筆含 `__TEST__` 的紀錄 | 測試自行清乾淨 |

## 元件測試涵蓋

載入中；第一次載入 `{category: "all"}` 且無游標；時間（Asia/Taipei，`10/24 23:12`，title 帶完整年月日）、中文事件、對象、差異與「—」；HTML 內容不變成元素（純文字）；已到最後一頁；兩種空狀態；首次與切換類別的錯誤與重試（不顯示部分資料）；載入更多（游標、附加、按鈕消失、載入中停用且不重複送出、失敗保留既有列並用同一游標重試、以 id 去重）；篩選（替換列表、`aria-pressed`、進入載入中、**重置游標**、點已選類別不重載）；競態三案（舊請求較慢成功、舊請求較晚失敗、載入更多途中切換類別）。Sidebar：新項目在最後、緊接「帳號設定」、連結正確、在 `/admin/audit-log` 時為使用中。

## 瀏覽器走查（本機 dev server，真實 Supabase，店長帳號）

- 空表時：深色模式顯示「尚無任何紀錄」＋說明。
- 在「預約規則」頁把最短提前預約時間 1 → 2 小時儲存，再改回 1；列表依序出現兩筆「修改預約規則」，差異文字為「最短提前預約時間：1 小時 → 2 小時」與「2 小時 → 1 小時」，最新的在上、時間為台北時間；**正式資料已還原為 1 小時**（並由第二筆紀錄佐證）。
- 類別篩選：「預約」→ 骨架 → 「此類別沒有紀錄」；「設定」→ 兩筆；「全部」→ 兩筆＋「已顯示全部紀錄」。篩選在資料庫端執行（預約類別確實為空）。
- 淺色與深色模式各截圖確認；1280px 模擬寬度下四欄全部可見；約 800px 窗格寬度下表格橫向捲動（符合規格的窄視窗行為）。
- 主控台無 React／hydration 警告。
- 螢幕截圖：深色（空狀態、載入中骨架、此類別沒有紀錄、有資料捲動版）、淺色（骨架轉場、有資料）皆在本次對話的瀏覽器窗格截取，未另存檔案。

## 預約與設定走查（測試資料，使用者同意，2026-10-24）

為避免寄信給顧客，用暫時腳本（已刪除）沿用整合測試的做法，在真實資料庫建立 `__TEST__walk` 服務（建立後立刻下架）與 `__TEST__fx-walk` 設計師、3 筆 3 年後的預約（`customer_email` 為 null，不觸發寄信 webhook），經真正的後台函式操作後**保留資料**，在瀏覽器檢視，之後以 service_role 清除。

- 66 筆紀錄：第一頁 50 筆並出現「載入更多」，點擊後附加 16 筆、共 66 筆、無重複，按鈕消失並顯示「已顯示全部紀錄」。
- 預約類別（篩選「預約」→ 3 筆）：「預約改期」「取消預約」「完成預約」，對象為「服務・設計師・時段」，差異為「開始時間：… → …／結束時間：… → …」「狀態：待處理 → 已取消／已完成」。
- 設定類別：新增服務（價格／時長／緩衝時間）、修改服務（價格：NT$600 → NT$700）、下架服務、開放／關閉設計師服務、修改設計師名稱（名稱：… → …b）、停用設計師、新增／移除設計師請假日。
- 超長的測試名稱在對象欄自動換行，不撐破版面。
- 清除後列表只剩最初 2 筆預約規則紀錄；`npm run sweep:audit-test-rows` dry-run 找到 0 筆；暫時的測試檔與設定檔已刪除，`git status` 無殘留。

### 走查發現並已修正

- **差異順序顛倒**：Postgres jsonb 不保留鍵的寫入順序（短鍵在前），所以從資料庫讀回的改期紀錄顯示成「結束時間 → 開始時間」，新增服務顯示成「價格→緩衝時間→時長」。既有單元測試以寫入順序給資料，抓不到。
- 修正：`describeAuditEntry` 內部改依固定順序迭代（一般欄位依欄位表宣告順序；營業時間依「星期→開店→打烊→公休」）。新增 1 項測試（以 jsonb 實際順序給資料，修正前失敗、修正後通過）。
- 修正後重跑：`npx vitest run tests/admin tests/components/audit-log-view.test.tsx` 524 項全過；`tsc`、`lint`、`build` 皆通過；瀏覽器重新確認順序已正確。
- 此檔屬 TASK-084 範圍；因為是內部迭代順序、不改對外介面，在本卡內修正並於此記錄，請人工審查時一併確認。

## 尚未涵蓋

- **公休日實際畫面**：新增公休日（正式資料）被系統擋下，未在瀏覽器目視；接線由單元與整合測試涵蓋。
- **錯誤狀態的真實畫面**：未在瀏覽器重現（需要讓資料層失敗），由元件測試涵蓋。
- **跨年份顯示**：對象欄的時段與時間欄不含年份（時間欄的 title 有）。走查資料排在 3 年後，畫面顯示「10/23」而無年份；這是 `describeAuditEntry` 既有格式（規格範例即為 `10/25 15:00–16:00`），一般操作在同年內不影響。
- 修正差異順序後，我沒有再跑 `npm run test:audit-log`（該測試最後會讓店長帳號全域登出，會把你的瀏覽器登入踢掉）；修正僅動顯示層，該整合測試不涵蓋 `describeAuditEntry`。

## 審查

security-reviewer 對整個 Epic 的總覽審查（只讀）：**沒有 Critical／High／Medium**。審查意見不等於核准。

| 檢查 | 結果 |
|---|---|
| 純文字渲染／XSS | 安全：列表以 JSX 文字節點渲染，無 `dangerouslySetInnerHTML`；服務名、設計師名、未知 `event_type` 都只當文字；`event_type` 另受 0019 的 CHECK 限制 |
| 非店長存取 | 安全：`proxy.ts`＋`layout.tsx`（`getUser`→aal→`is_admin`）三層，資料表再有 RLS `is_admin()`；anon 零權限，無 update／delete 授權 |
| `cursor`／`category` 注入 | 安全：cursor 以 `^\d+$` 驗證；category 只對應寫死的 like 樣式，未知值退回「全部」 |
| 錯誤訊息洩漏 | 安全：畫面只顯示固定文字，console 只印短錯誤碼 |
| 顧客個資 | 安全：預約寫入前只讀 id／時間／狀態／名稱，再經事件白名單過濾 |
| 競態 | 安全：遞增請求序號丟棄過期回應，並以 id 去重 |
| Low：`service_role` 有 `audit_log` delete 權限（0019:89） | 已知設計（僅供整合測試清掃，不給 insert／update）；請確認正式環境未在其他地方使用該金鑰——專案既有的密鑰管理規則已涵蓋，本卡不變更 |

## 已知限制

- 日誌可能漏記；繞過後台不記；被盜 session 可新增偽造紀錄；只記錄不通知（保證邊界，見 `project-map.md`）。
- 時間欄不含年份（title 有）；紀錄跨年時需看 title。
- 窗格寬度約 960px 以下表格橫向捲動。
- 列表沒有總筆數、日期區間與預約編號篩選。

## 後續任務

日期區間與預約編號篩選、設定異動通知、升級完整版（見 `完整版備案/`）、`services.name` 長度限制、`updateBookingPolicy` 的真實資料庫整合驗證。
