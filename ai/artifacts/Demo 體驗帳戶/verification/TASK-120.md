# 驗證報告

## 摘要

- 任務：TASK-120 create_appointment 加「24 小時建立數」滾動視窗（migration 0030，修法 A'，N = 3）
- 結果：**通過。** 套用前、套用後、`_down` 回滾後、重新套用後四個階段的證據都已齊全（見下方）。0030 目前**已套用**（使用者在 SQL Editor 套用，2026-11-01／02）。人工驗收通過（2026-11-02），轉 Done。
- 審查：架構、安全、測試三方審查皆已完成，**無 MUST FIX**；審查後已修正的項目與使用者需決定的取捨見下方。
- 風險：高（改寫公開預約入口 `create_appointment`，影響所有真實顧客）。人工驗收待使用者。

## 變更的檔案

| 檔案 | 內容 |
|---|---|
| `supabase/migrations/0030_booking_limit_rolling_window.sql` | 新增。`create or replace` 重定義 `create_appointment`（六參數）：函式本文與 0018 逐字相同，只在既有電話、Email 兩道檢查之後各多一道「`created_at > now() - interval '24 hours'`、不分狀態 ≥ 3」；授權與 0018 相同；含依賴檢查與 begin／commit |
| `supabase/migrations/0030_booking_limit_rolling_window_down.sql` | 新增。把函式與授權逐字還原成 0018 |
| `tests/lib/booking-limit-migration.test.ts` | 新增。逐字比對單元測試 10 項 |
| `tests/booking-limit.integration.test.ts`、`vitest.booking-limit.config.ts`、`package.json`（`test:booking-limit`） | 新增。對真實專案的整合測試，分預設（視窗生效）與 `BOOKING_LIMIT_EXPECT=off`（套用前／回滾後）兩種模式 |
| `ai/context/decisions.md`、`task-cards/TASK-120.md`、`architecture-notes.md`（D13 補充）、`verification/TASK-114.md`（R1 更新）、`tools/kanban/cards/TASK-120.json` | 文件 |

未動：既有 migration、確認信觸發器、webhook route、Demo 守門（0026）、前台程式碼與文案、任何資料。

## 套用前證據（原始輸出摘要）

| 指令 | 結果 |
|---|---|
| `npx vitest run tests/lib/booking-limit-migration.test.ts` | **10／10 通過**：`_down` 本文與 0018 逐字相同；0030 拿掉兩個新增區塊後與 0018 逐字相同；兩個新增區塊逐字固定；函式以外只剩 do 依賴檢查（只讀）與 begin／notify／commit；日後若有 migration 重新定義 `create_appointment`，編號最大者必須仍含視窗 |
| `BOOKING_LIMIT_EXPECT=off npm run test:booking-limit`（套用前） | **8／8 通過**＝**重現攻擊情境**：建立 3 筆、取消 1 筆後第 4 筆成功；全部取消後第 4 筆成功；Email 取消後同 Email（含 +標籤變體）再預約成功；並行恰好 2 筆成功（只受舊檢查約束） |
| `npm run test:booking-limit`（預設模式，套用前） | **7 項失敗、1 項通過**（通過的是「原檢查不是被取代」，兩種模式都成立）＝測試對視窗有鑑別力 |
| `npm run test:booking`（套用前基準） | 23／23 |
| `npm run test:booking-policy`（套用前基準） | 7／7 |
| `npm run test:designers`（套用前基準） | 122／122 |
| `npm run test:admin-booking`（套用前基準） | 16／16 |
| `npx tsc --noEmit`、`npm run lint` | 通過 |
| 測試後殘留檢查 | `__TEST__booking-limit-%` 預約 0、服務 0；appointments 總數仍 16（與測試前相同） |
| 套用當下影響量測（唯讀） | 過去 24 小時內建立的預約 0 筆；任一電話或 Email 鍵都沒有 ≥ 3 筆＝**套用當下不會擋到任何人** |

`npm run build` 未重跑：本卡沒有改任何 app／lib 程式碼，只新增 migration、測試與設定。

## 套用後證據（使用者於 SQL Editor 套用 0030 後執行）

| 階段 | 指令／查詢 | 結果 |
|---|---|---|
| 套用 0030 後 | DB 側查詢（使用者貼上 SQL Editor 的輸出） | `has_window` true、`overloads` 1（沒有舊簽名多載）、`anon_ok`／`auth_ok`／`service_ok` 皆 true、`acl` = `{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}`（**沒有 PUBLIC 項**） |
| 套用 0030 後 | `npm run test:booking-limit`（預設） | **8／8**（套用前同一組是 7 項失敗） |
| 套用 0030 後 | `test:booking`／`test:booking-policy`／`test:admin-booking`／`test:business-hours`／`test:services`／`test:reports` | **23／23、7／7、16／16、33／33、17／17、19／19** |
| 套用 0030 後 | `test:designers` | 第一次 121／122：失敗的是既有案例「email 上限只計未過期的待服務預約…」——它先塞 4 筆同 Email 預約（含已取消、已過期，`created_at` 都是現在）再期待新預約成功，驗證的是舊規則；0030 的視窗現在會把這 4 筆計入，屬**預期行為改變**，不是缺陷。處置：`tests/designers.integration.test.ts` 的 `seedAppointment` 新增可選的 `createdAt`，該案例把 5 筆種子的建立時間推到 25 小時前（視窗外），讓它繼續驗證「原檢查只計未來待服務」；視窗本身由 `test:booking-limit` 驗證。修後 **122／122** |
| 套用 `_down` 後 | `BOOKING_LIMIT_EXPECT=off npm run test:booking-limit` | **8／8**（取消後第 4 筆又能成功，行為恢復）；`test:booking` 23／23、`test:booking-policy` 7／7 |
| 重新套用 0030 後 | `npm run test:booking-limit`（預設） | **8／8**；`test:booking` 23／23、`test:booking-policy` 7／7 |
| 每個階段結束後 | 殘留檢查（service role） | `__TEST__` 預約、服務、設計師皆 0；appointments 總數維持 16 |
| 靜態檢查 | `npx tsc --noEmit`、`npm run lint`、`tests/lib/booking-limit-migration.test.ts`（10 項） | 通過 |

### 這次驗證沒做到的（誠實列出）

- **沒有套用前後的函式本文 md5 比對**：套用前沒有記下 `md5(prosrc)`，所以「線上現況原本就是 0018 本文」與「_down 後與套用前逐字相同」沒有用指紋證明；改以「`_down` 後 off 模式 8／8＋單元測試證明 `_down` 檔案本文與 0018 逐字相同」作為替代，證據強度較弱。
- **`test:notifications`、`test:rls` 未跑**（它們只在註解中提到 `create_appointment`，審查列為低優先度）。
- **`npm run build` 未重跑**：本卡沒有改 app／lib 程式碼。
- **Email 並行案例、恰好 24 小時邊界**：已在審查中接受為不測（見審查發現）。

## 審查發現與處置

| 來源 | 發現 | 嚴重度 | 處置 |
|---|---|---|---|
| 架構 | 檔頭寫「Demo 每日還原不會清掉 24 小時內預約」不符事實：0027 `delete from public.appointments where true` 整表清空，視窗隨還原歸零 | 中 | 已改正檔頭，寫入殘留（還原前後各約 3 封） |
| 架構 | 檔頭描述了不存在的「後台代訂」路徑（authenticated 只能 update 四個欄位） | 中 | 已改寫；並補「Demo 為何繞不過」 |
| 架構 | 「與既有 Email 計數相同取捨」不準確：既有計數有 `start_at > now()`，新計數沒有範圍條件 | 中 | 已改正說法並寫明補索引的門檻（約 5 萬列或回應變慢）；**未加索引**（維持「不動索引」的範圍，列為使用者可選） |
| 架構 | 任務卡、decisions、D13、TASK-114 R1 狀態未跟上 A' | 中 | 已全部更新 |
| 架構 | Email 並行案例缺測試 | 低 | **接受**：Email 與電話共用同一套 advisory lock 與計數流程，電話並行案例已證明鎖與視窗在並行下有效；Email 並行會多寄 1–3 封信 |
| 安全 | 保證範圍只到 dedupe key 相同；供應商別名、次網域定址、catch-all、IDN 可繞過；anon key 可直接打 PostgREST，Next／Vercel 限流管不到 | 中 | 已寫入檔頭與 decisions；根本解法（全店寄信預算，原方案 B）**需另開卡** |
| 安全 | **電話額度 DoS**：任何人用別人的電話建 3 筆預約即可鎖住該電話；0030 之前店長取消即可解除，之後只能等 24 小時；前台文案「太多筆待確認的預約」對此不準確 | 中 | 已如實記錄；**需使用者決定**（見下） |
| 安全／測試 | Email 大寫變體可能不被 Resend 視為測試位址 | 低 | 已改成只用小寫 +標籤變體 |
| 測試 | 「不同電話互不影響」兩種模式皆恆真 | 中 | 已改成「電話 A 被視窗擋下，電話 B 仍成功」 |
| 測試 | `afterAll` 在 `beforeAll` 失敗時會蓋掉原錯誤；探測失敗訊息沒有清理指令 | 低 | 已加 `if (!serviceId) return` 與清理語句 |
| 測試 | 取消前先清 email 的做法有極小機率競態多寄 1 封取消信 | 低 | 已更正檔頭說明（確認信約 4 封，另有取消信競態可能多 1 封，收件人皆為 Resend 測試位址） |
| 測試／安全 | 新增區塊內可夾帶語句、函式外可夾帶 DDL | 中 | 已加「新增區塊逐字固定」與「函式外白名單」兩項單元測試 |
| 安全 | `_down` 無條件覆蓋，日後若有 0031 重新定義會被蓋掉 | 低 | 已在 `_down` 檔頭加警語；單元測試的「最後定義者」檢查會提醒 |
| 安全 | 整合測試電話 `09…` 理論上可能撞到真實號碼 | 低 | **接受**（沿用 `test:booking` 既有模式；且僅測試期間） |
| 測試 | 套用後回歸範圍太窄、需 `_down` 實測與 DB 側查詢 | 高 | 已納入上方「套用後待補的證據」 |

## 使用者決定（2026-11-01）：選 (b)、不加索引、全店寄信預算先說明再決定

- 第 1 項選 **(b)**：維持現狀；營運手冊 §8 已補「預約額度被鎖住」解除程序（⚠️ 未實跑）；前台限額文案另開 **TASK-124**（草稿）。
- 第 2 項：**不加索引**。
- 第 3 項：使用者要求先以白話說明改動大小，尚未決定是否建卡。

以下為當時提出的選項原文：

1. **電話額度 DoS 的取捨。** 0030 之後，店長把預約取消**不會**釋放額度。安全審查提出兩個緩解方向：
   - (a) 只把「Demo 取消的」預約算進視窗（需在 0026 同一個觸發點依 JWT 標記 `cancelled_by_demo`，並更新 0024／0027 的觸發器白名單）——店長取消仍可釋放額度，迴圈照樣堵住；改動較大。
   - (b) 維持現狀，在營運手冊補一段 service_role 的解除程序，並把前台限額文案改成中性說法（現文案「目前有太多筆待確認的預約」對被視窗擋下的情況不準確）。
   - 我的建議：(b)，且前台文案另開一張小卡；(a) 若要做需另開卡。
2. **新計數的索引。** 目前不加（資料量小，且維持「不動索引」的範圍）。若希望一併加 `appointments(created_at)` 索引，需放寬單元測試對 `create index` 的禁止並重跑驗證。
3. **全店寄信預算（原方案 B）** 是 Email 別名繞過的根本解法，建議另開卡。

## 殘留風險

見 `ai/context/decisions.md` 的 TASK-120 條目：電話 DoS、dedupe key 之外的別名繞過、Demo 還原邊界、無索引計數、真實顧客 24 小時內「訂了又取消再訂」超過 3 次會被擋。

## 後續任務（尚未建卡，待使用者決定）

- 全店確認信寄信預算（堵別名繞過）。
- 前台限額文案改中性說法／電話 DoS 的解除程序。
- 視需要：`appointments(created_at)` 索引。
