# 架構筆記：儀表板與報表

上層規格：`ai/artifacts/儀表板與報表/feature-spec.md`（人工已核准，含 2026-10-24 範圍異動）、`screen-spec-報表.md`、`mockup-decision-報表.md`（定案 mockup：`mockups/reports-final-tabs.html`；使用者 2026-10-24 回覆「照預設」，視為定案版與預設假設皆已確認）。

## 0. 設計總覽

```text
appointments.price_at_booking  ←  BEFORE INSERT trigger（讀 services.price）          [0020，TASK-087]
        │
        ▼  （店長瀏覽器經 RLS 直接讀，只選統計欄位，不碰顧客欄位）
lib/admin/reports.ts            期間運算 ／ 分頁查詢 ／ 彙總 ／ 趨勢 ／ 設計師篩選     [TASK-088]
lib/admin/reports-ranking.ts    熱門服務排行（純函式）                                [TASK-091]
        │  （同一份「ReportData」餵給兩個頁籤與匯出，數字天然一致）
        ▼
ReportsView（容器：期間／頁籤／設計師篩選／載入中／空／錯誤／競態）                    [TASK-092]
  ├─ 儀表板頁籤＝變體 B：摘要列＋TrendBarChart×2＋橫條排行                             [TASK-089／090／091]
  └─ 報表頁籤＝變體 C：彙總列＋排行表＋逐日明細表＋「匯出 Excel」                      [TASK-090／091／093]
lib/admin/reports-export.ts     由 ReportData 組出三個工作表並下載 .xlsx（瀏覽器端）   [TASK-093]
```

關鍵決策（理由見各節）：

1. **價格快照用 BEFORE INSERT trigger 帶入，不改 `create_appointment`**。
2. **彙總在瀏覽器端做**（分頁抓取單一期間的預約列，純函式彙總），不新增資料庫函式／RPC。
3. **匯出在瀏覽器端產生**（動態載入 `write-excel-file`），不新增伺服器端點。
4. **圖表純 CSS**，不新增圖表套件。

## 1. 資料庫：價格快照（`supabase/migrations/0020_appointment_price_snapshot.sql`）

```sql
alter table public.appointments add column if not exists price_at_booking numeric(10,2);
-- trigger function：security definer、set search_path = ''、revoke execute from public
create or replace function public.set_appointment_price_snapshot() returns trigger ... as $$
begin
  new.price_at_booking := (select s.price from public.services s where s.id = new.service_id);
  return new;   -- 無條件覆寫：不信任呼叫端帶入的值
end $$;
create trigger appointments_set_price_snapshot before insert on public.appointments
  for each row execute function public.set_appointment_price_snapshot();
-- 回補（見下）→ alter column set not null → check (price_at_booking >= 0)
grant select (price_at_booking) on public.appointments to authenticated;   -- 不給 update
```

- **為何用 trigger 而不改 RPC**：`create_appointment` 已被 0013／0014／0018 改過多次、是顧客預約核心路徑；trigger 讓任何新增路徑（RPC、service_role 腳本、未來後台新增）都自動有快照，且 RPC 簽名與內容完全不動，回滾只需丟 trigger。無條件覆寫可避免「呼叫端帶假價格」。
- **權限**：0015 已把 `appointments` 對 authenticated 收斂為**欄位層級**授權；新欄位必須補 `grant select (price_at_booking)`，否則報表頁讀不到（會得到 permission denied）。**不給** `update (price_at_booking)`，所以店長、顧客都改不了；`service_role` 有整表權限，整合測試靠它把快照改成指定值來驗證彙總（trigger 只在 INSERT）。anon 仍零權限。
- **回補**：`update appointments a set price_at_booking = s.price from services s where s.id = a.service_id and a.price_at_booking is null`。**要避開兩個既有 trigger 的副作用**：
  - `appointments_set_updated_at`（BEFORE UPDATE）會把全部既有預約的 `updated_at` 改成現在 → 回補前後以 `alter table ... disable trigger appointments_set_updated_at` / `enable trigger` 包住（同一交易內，失敗整份回滾）。
  - `appointments_notify_update`（AFTER UPDATE，會寄通知信）的 WHEN 只在 `status` 變取消、`start_at`／`end_at` 變動時觸發，回補不改這些欄位，**不會寄信**；仍須在任務卡以 `pg_get_triggerdef` 實際確認條件後才套用，並在套用前確認 Vault 密鑰狀態無關緊要。
  - 回補的值＝**回補當下的服務目前價格**（既有預約沒有歷史價格，只能近似；已列入非目標與 `decisions.md`）。
- **新增預約流程的 trigger 順序**：BEFORE INSERT 只有這一支新 trigger；AFTER INSERT 的 `appointments_notify_insert`（確認信，WHEN `customer_email is not null`）不受影響。
- **約束**：`not null`＋`check (>= 0)`（`drop constraint if exists` 再 `add`，比照 0017，重跑才收斂）。
- **索引**：不新增（`start_at` 既有索引足以支撐單期間查詢；資料量預估每年數千筆）。
- **部署順序**：先套用 `0020`、再部署前端（前端早於 0020 部署時報表頁只會顯示錯誤狀態，不影響其他頁）。回滾：Vercel 回滾 → `0020_down`（丟 trigger、function、欄位；**快照資料一併消失**，檔頭註明）。
- **套用方式**：人工貼到 Supabase SQL Editor 整份執行（單一交易、可重複執行、結尾 `notify pgrst, 'reload schema'`）。
- **測試資料注意（既有教訓）**：整合測試用 service_role 新增 `appointments` 會觸發真實資料庫的 `appointments_notify_insert`／`notify_appointment_update`；測試預約一律 `customer_email = null`（WHEN 條件不成立，不會寄信），姓名、服務、設計師皆 `__TEST__`，且只對 `__TEST__` 設計師與服務操作；腳本結尾**不得**對店長帳號做全域 `signOut()`（用 `scope: "local"` 或不登出）。

## 2. 資料層（`lib/admin/reports.ts`，純函式＋一支查詢）

**型別**

```ts
type ReportGranularity = "day" | "week" | "month";
type ReportPeriod = { granularity; from: string; to: string; label: string; isCurrent: boolean }; // from/to 為 Taipei 日期 YYYY-MM-DD，含頭尾
type ReportAppointment = { id; startAt: string; status: AppointmentStatus; price: number;
                           serviceId: string; serviceName: string; serviceIsActive: boolean; designerId: string };
type ReportTotals = { booked; completed; pending; cancelled; revenue; estimated };
type TrendBucket = { key; label; ...ReportTotals };
```

**期間運算**（沿用 `week-range.ts` 的 `addDays`／`getWeekRange`／`getTaipeiToday` 與 `month-range.ts`）：`getReportPeriod(granularity, anchorDate, today)`、`shiftReportPeriod(period, ±1)`、`resetToToday`。切換粒度時以「目前期間的起始日」為錨（日→週→月都取含該日的範圍）；標籤格式與 mockup 一致（`2026 年 10 月`、`10/19（一）– 10/25（日）`、`10/24（六）`）。

**查詢** `fetchReportAppointments(supabase, period): Promise<Result<ReportAppointment[]>>`

- `from("appointments").select("id, start_at, status, price_at_booking, service_id, designer_id, services(name, is_active)")`——**明確列欄位，不用 `*`，不含任何 `customer_*`／`access_token`**（欄位層級授權本來就擋）。
- 範圍：`.gte("start_at", `${from}T00:00:00+08:00`).lt("start_at", `${addDays(to, 1)}T00:00:00+08:00`)`，`.order("start_at").order("id")`（分頁需穩定排序）。
- **分頁**：PostgREST 預設單次上限 1000 列。以 `.range(n*1000, n*1000+999)` 迴圈取，**最多 5 頁（5000 列）**；超過就回傳錯誤（寧可失敗也不顯示被截斷的錯誤數字）。預估量：每月約數百筆，離上限差一個數量級；若日後逼近，改為資料庫端彙總（見 §9「升級路徑」）。
- 錯誤：統一泛用訊息（不洩漏資料庫內容），`Result<T>` 寫法比照 `lib/admin/appointments.ts`。
- `price_at_booking` 以 `Number()` 轉型並檢查有限數，不合法視為錯誤（不靜默當 0）。

**彙總（全部為純函式，口徑集中一處）**

| 函式 | 口徑 |
|---|---|
| `summarize(appts)` | `booked`＝pending＋confirmed＋completed；`completed`；`pending`＝pending＋confirmed；`cancelled`；`revenue`＝completed 的 price 加總；`estimated`＝pending＋confirmed 的 price 加總 |
| `buildTrend(period, appts)` | 月／週：每個 Taipei 日期一格（沒資料為 0，不省略）；日：每小時一格，範圍＝`min(10, 最早預約小時)`～`max(19, 最晚預約小時)`（保證沒有預約被丟掉）；日期／小時以 `Intl`（`Asia/Taipei`）換算，**不得用瀏覽器本地時區** |
| `filterByDesigners(appts, ids)` | 空＝全部；沿用 `designer-filter.ts` 的有效選取規則 |
| `buildDesignerChips` | **重用** `lib/admin/designer-filter.ts`：把參數型別放寬為 `Pick<WeekAppointment, "designer_id" \| "status">`（結構相容，行為不變），chip 的數字＝期間內預約量（不含已取消）；`ReportAppointment` 以轉接函式提供 `designer_id` |

**金額**：以 `numeric(10,2)` 讀入的 number 做加總，最後以 `Math.round(x * 100) / 100` 收斂浮點誤差；顯示用既有 `formatPrice`（`NT$105,300`，`lib/admin/format.ts`）。

## 3. 排行（`lib/admin/reports-ranking.ts`）

`buildServiceRanking(appts)`：排除 cancelled → 依 `serviceId` 分組 → `{ serviceId, name, isActive, count, revenue }` → 排序：`count` 降序、`revenue` 降序、名稱 `localeCompare("zh-Hant")`、`serviceId`（最後保底，確保穩定）。預約量為 0 的不列、不設上限。「已下架」＝`serviceIsActive === false`；服務名稱純文字、`<bdi>`。獨立成檔是為了和 088 的檔案所有權切開，並讓排行可被儀表板（橫條）與報表（表格）共用。

## 4. 元件

| 元件 | 位置 | 說明 |
|---|---|---|
| `TrendBarChart`（新，**登記回 design-system inventory**） | `components/ui/TrendBarChart.tsx` | 純展示。props：`buckets`（每格 `label`、`showLabel`、`segments: {value, kind: "solid" \| "striped"}[]`、`tooltip: string[]`、`ariaLabel`）、`max`、`formatTick`、`legend`。純 CSS（MUI `Box` ＋ theme palette）堆疊長條；斜紋用 `repeating-linear-gradient`（`primary.main`／`primary.50` 對應的暗色值取自 theme，不寫死 hex）。互動：hover 與鍵盤焦點顯示 tooltip；**單一 tab stop＋方向鍵／Home／End 的 roving tabindex**（月視圖 31 格，不能 31 個 tab stop）；另提供視覺上隱藏的等價資料表給螢幕閱讀器；`max` 以「nice max」算法由呼叫端傳入。 |
| `ReportsToolbar` | `app/admin/_components/` | 日／週／月（`ToggleButtonGroup`）、`‹ 期間 ›`、回到本期；右側 `actions` 插槽（匯出按鈕由 093 放入）。 |
| `ReportsDashboardPanel`（B） | 同上 | 營收主角摘要列、預約量圖＋營收圖並排（窄視窗堆疊）、`ranking` 插槽。 |
| `ReportsTablePanel`（C） | 同上 | 彙總列、`ranking` 插槽、逐日／逐小時明細表（sticky 表頭＋sticky 合計列）。 |
| `ServiceRankingBars`／`ServiceRankingTable` | 同上 | 排行的兩種呈現（B 橫條、C 表格含占比）。 |
| `ReportsView`（容器） | 同上 | 持有 state（頁籤、粒度、錨點日、勾選的設計師）、抓資料、競態防護、載入中／空／錯誤，組合以上元件。 |
| `app/admin/reports/page.tsx` | | 薄頁面，渲染 `ReportsView`；存取控制沿用 `app/admin/layout.tsx` 三層檢查，不另寫。 |
| Sidebar | `AdminShell.tsx` | `NAV_ITEMS` 在「預約」之後插入「儀表板與報表」＋手繪 SVG 圖示；`isNavItemActive` 既有規則涵蓋；更新 `sidebar` 與 `admin-shell` 既有測試的項目數。 |

**資料流與狀態**

- state：`tab`（預設 `dashboard`，只在記憶體）、`granularity`（預設 `month`）、`anchor`（預設台北今天）、`selectedDesignerIds`。
- **只有「期間」改變才重新查詢**；切頁籤、切設計師只是對同一份 `ReportAppointment[]` 重算（與預約週曆一致）。結果以 `{key, status, data}` 存放，render 時比較目前依賴值與最後完成的 key 推導載入中（寫法比照 `AdminDashboard`／`AuditLogView`，避免違反 `react-hooks/set-state-in-effect`）；遞增請求序號丟棄過期回應。
- 載入中：工具列與設計師 chip 維持可操作，只有內容區換骨架。空：期間內（全部設計師）沒有預約 → 空狀態；篩選後沒有 → 另一種文案；**「全部已取消」視為有資料**（不顯示空狀態）。錯誤：泛用訊息＋重試，不顯示部分數字。
- 設計師選項沿用 `getDesignerFilterOptions`（失敗時降級為不顯示 chip 列，與週曆一致）。
- 深色模式：所有顏色取自 theme palette；以 `design-system.md` 的暗色 token 驗證對比。

## 5. 匯出（`lib/admin/reports-export.ts`）

- **瀏覽器端產生**：資料本來就已在頁面上（經 RLS 取得），匯出直接吃**同一份已彙總的結果**，與畫面天然一致；不新增伺服器端點，因此沒有新的授權面、也沒有重複查詢。代價：套件跑在店長的瀏覽器（同源、能碰 session）→ 供應鏈風險靠「鎖版本＋動態載入（只在按下匯出時才載入）＋讀碼審查＋lockfile」緩解。
- **套件選擇：`write-excel-file@4.1.1`（精確版本）**。事實（`npm view`，2026-10-24）：MIT；只有一個相依（`fflate`）；專司寫入、有瀏覽器版；最後發布 2026-06-08。否決：`xlsx`（SheetJS）— npm 上的 0.18.5 有已知漏洞（原型污染、ReDoS），修正版只在官方 CDN 發佈、不在 npm；`exceljs` — 相依樹大且老（archiver／unzipper／uuid 8 等），最後發布 2024-12，體積遠大於需求。
- **實作 spike（卡 093 第一步）**：確認 `write-excel-file/browser`（4.x，據文件使用 Web Worker）在 Next 16 Turbopack 打包、動態 `import()` 與實際瀏覽器可用；若 Worker 打包有問題，改用 `write-excel-file/universal`；兩者皆不行才退回評估其他方案並回報（屆時需人工決定）。單元測試在 node 環境用 `write-excel-file/node` 的 `toBuffer()` 產生同樣的工作表資料。
- **工作表（與規格書一致）**：「彙總」（期間、設計師篩選、匯出時間、六個彙總數字，並含口徑說明文字）、「熱門服務排行」、「逐日明細」（日粒度為「逐小時明細」，最後一列合計）。金額與筆數寫成**數值儲存格**（金額格式 `#,##0`），日期、名稱為字串。
- **公式注入**：xlsx 的字串儲存格以字串型別（shared／inline string）寫入、**不是** `<f>` 公式，Excel／Google 試算表不會執行；因此不改動文字內容（不加 `'` 前綴，避免名稱被改字）。以讀回測試驗證：把名稱設為 `=SUM(1)`、`+1`、`-1`、`@x`、Tab 開頭的服務／設計師，解開 xlsx 後該儲存格為字串型別、工作表 XML 不含任何 `<f>`。（**規格書原寫「加前綴」，改為此做法，已同步修正文字**。）
- **檔名**：`報表_<期間>_<設計師>.xlsx`；期間＝`2026-10`／`2026-10-19_2026-10-25`／`2026-10-24`；設計師＝`全部設計師`，或所選名稱以 `、` 以外的 `_` 連接並**移除 `\ / : * ? " < > |`、控制字元與前後空白**，總長限制 80 字元；清理後為空則回退為 `全部設計師`。
- **下載**：`Blob` ＋ 暫時的 `<a download>` ＋ `URL.revokeObjectURL`；匯出中停用按鈕、成功／失敗 Toast（既有 `useToast`）；無資料、載入中、錯誤時按鈕停用；儀表板頁籤不渲染。
- **不含**逐筆預約與顧客個資：匯出模組的輸入型別只有彙總結果（`ReportData`），**型別上就拿不到** `customer_*`。

## 6. 安全性

- **身分／權限**：頁面沿用後台 layout 三層檢查；資料層只靠 RLS（`is_admin()`，含 aal2）；非店長即使直接打資料層也只得到空結果；沒有新增任何 `SECURITY DEFINER` 函式（trigger function 除外，且 `revoke execute from public`、`set search_path = ''`）。
- **敏感資料**：報表只用 `price_at_booking`、狀態、時間、服務名稱、設計師 id；查詢明確列欄位；`price_at_booking` 不出現在任何顧客端 RPC 回傳（`get_available_slots`／`create_appointment` 不回此欄，任務卡 087 以整合測試斷言）。
- **輸入驗證**：期間錨點日期只來自程式內部（`<input>` 不開放自由輸入）；`from`／`to` 組成查詢前以 `isRealDate` 風格驗證；設計師 id 只取自 chip 列。
- **供應鏈**：唯一新增 dependency 為 `write-excel-file@4.1.1`（精確版本，間接 `fflate`）＋測試用 `fflate`（devDependency，已是間接相依）；記錄於 `decisions.md`；升級需重做公式注入與讀回測試。
- **XSS**：服務名稱、設計師名稱一律 React 文字節點；tooltip 同；不使用 `dangerouslySetInnerHTML`。
- **審查關卡**：TASK-087 套用前 security-reviewer 快速複審 `0020`（trigger、grant、回補、webhook 副作用）；TASK-093 security-reviewer 審匯出（套件、檔名、公式注入、無個資）；Epic 完成後 architect＋security-reviewer 總覽審查（比照稽核紀錄 Epic）。

## 7. 測試策略

| 層級 | 內容 |
|---|---|
| 單元（`npm test`） | 期間運算（跨月、跨年、週跨月、今天回歸）、`summarize` 口徑（各狀態組合、全取消、空）、`buildTrend`（補零、時區邊界 23:30／00:30、日粒度小時範圍擴張）、`filterByDesigners`、`buildServiceRanking`（同量排序、已下架、取消排除）、金額浮點、`fetchReportAppointments`（欄位清單不含顧客欄位、`+08:00` 邊界、分頁組合、超過 5 頁回錯誤、錯誤不洩漏）、`TrendBarChart`、各面板元件（五態）、`ReportsView`（競態、切頁籤不重查、篩選重算、空／錯誤／載入中）、匯出建構函式與檔名清理、公式注入讀回、Sidebar／AdminShell 項目數。 |
| 整合（`npm run test:reports`，新，對真實 Supabase） | 快照：新預約自動帶當下價格；之後服務改價，既有快照不變；呼叫端帶假價格被覆寫；authenticated 不能 update `price_at_booking`、anon 讀不到 `appointments`；authenticated 讀得到該欄；顧客端 RPC 回傳不含該欄。彙總：以 `__TEST__` 固定資料（含改價、取消、不同設計師、期間邊界）算出的彙總／趨勢／排行與手算一致。 |
| 回歸 | `test:booking`、`test:admin-booking`、`test:rls`、`test:designers`（新增 trigger 後預約仍可建立、不重複寄信）。 |
| 手動／截圖 | 正式庫走查本月數字與預約列表對帳數筆；實際下載 `.xlsx` 以 Excel 或 Google 試算表開啟核對三張工作表；淺色／深色；768px。 |

## 8. 遷移、部署與回滾

1. 人工套用 `0020`（SQL Editor 整份）→ `notify pgrst, 'reload schema'` → 驗證 `select price_at_booking from appointments limit 3` 與一筆測試預約的快照。
2. 部署前端（Vercel）。
3. 回滾：Vercel 回滾前端 → `0020_down`。

## 9. 風險與緩解

| 風險 | 緩解 |
|---|---|
| 回補誤觸通知信／改動 `updated_at` | 回補前停用 `updated_at` trigger（同交易）；套用前以 `pg_get_triggerdef` 確認 webhook WHEN；整合測試預約一律無 email |
| 新欄位漏補欄位層級 `select` → 報表頁 permission denied | 0020 含 grant；整合測試以店長帳號實際讀取該欄 |
| 歷史營收為近似值（以回補當下價格） | 已列入規格非目標與 `decisions.md`；畫面不標示個別預約 |
| 單期間超過 5000 列被截斷 | 超過即回錯誤，不顯示不完整數字；**升級路徑**：改為資料庫端 `security invoker` 的彙總函式（group by），任務另立 |
| 時區錯置（瀏覽器本地時區） | 一律 `Intl`／`+08:00`；單元測試在非 Taipei 時區環境也通過（`TZ` 切換） |
| 套件供應鏈／Worker 打包 | 精確版本、動態載入、spike 先行、讀碼審查；失敗不影響其他頁籤 |
| 圖表 31 格鍵盤焦點負擔 | roving tabindex＋隱藏資料表 |
| 兩頁籤數字不一致 | 兩頁籤與匯出吃同一份 `ReportData`，不各自計算；整合測試比對 |
| 既有測試受 Sidebar 項目數、`buildDesignerChips` 型別變動影響 | 這兩處改動最小且在對應卡內調整測試 |

## 10. 任務卡

| 卡 | User Story | 內容 | 風險 | 前置 |
|---|---|---|---|---|
| TASK-087 | 預約價格快照 | `0020`（欄位、trigger、回補、授權）、down、`test:reports` 快照整合測試、`decisions.md` | 中高（動 `appointments` 與預約寫入路徑上的 trigger、遷移、回補既有資料） | 「專案設置」全部卡片 |
| TASK-088 | 查看預約數量與營收統計 | `lib/admin/reports.ts`（期間、分頁查詢、彙總、趨勢、篩選）、`designer-filter.ts` 型別放寬、單元測試、彙總整合測試 | 低 | 087 |
| TASK-089 | 查看預約數量與營收統計 | `TrendBarChart` 元件＋測試＋inventory 登記 | 低 | 088 |
| TASK-090 | 查看預約數量與營收統計 | 工具列、儀表板面板（B）、報表面板（C）、頁籤殼、Sidebar 項目與圖示（以 props 餵資料，含各狀態） | 低 | 088、089 |
| TASK-091 | 查看熱門服務項目排行 | `reports-ranking.ts`、`ServiceRankingBars`／`ServiceRankingTable` | 低 | 088 |
| TASK-092 | 查看預約數量與營收統計 | `ReportsView`、`/admin/reports` 頁面、串接與狀態、競態、`project-map.md`／`decisions.md`／README、人工驗收 | 中 | 090、091 |
| TASK-093 | 匯出報表為 Excel | spike、`reports-export.ts`、匯出按鈕與 Toast、新 dependency、讀回測試、security 審查、人工驗收 | 中 | 092 |

**MECE**：規格四個 story 各有對應卡（story 1→087；story 2→088／089／090／092；story 3→091（計算與呈現）＋092（串接）；story 4→093）。檔案所有權：087 擁有 `0020*`、`vitest.reports.config.ts`、`tests/reports.integration.test.ts`（088 只「追加」彙總案例）；088 擁有 `lib/admin/reports.ts`、`designer-filter.ts` 型別；089 擁有 `components/ui/TrendBarChart.tsx`；090 擁有 `ReportsToolbar`／`ReportsDashboardPanel`／`ReportsTablePanel` 與 `AdminShell.tsx` 導覽；091 擁有 `reports-ranking.ts` 與兩個排行元件；092 擁有 `ReportsView`、`app/admin/reports/`、文件；093 擁有 `reports-export.ts`、`package.json`／lockfile，並**只**在 `ReportsView`／`ReportsToolbar` 的既有插槽放入匯出按鈕。090 與 091 彼此獨立（排行以插槽傳入面板），可平行但不同時改同一檔。
