# TASK-116 驗證報告：Demo 專屬資料筆數上限

- 日期：2026-11-01
- 狀態：**修訂版（6 張表 + 字串預篩）已由使用者套用，verify.sql `RESULT=ALL_OK`，整合測試與回歸全數通過；回滾已實測；人工驗收通過（2026-11-01），轉 Done**
- 風險等級：高；三方審查（架構、安全、測試）皆「有條件核准」、無 MUST FIX（對 0027 本身）；人工驗收未做

## 變更內容（修訂後）

| 檔案 | 說明 |
|---|---|
| `supabase/migrations/0027_demo_row_caps.sql` | `demo_row_cap_guard()` 觸發器函式 + **六個** `BEFORE INSERT` 觸發器（services、designers、designer_services、designer_leaves、designer_portfolio_images、closed_dates）；清掉初版建立的 customers／appointments 觸發器；同一交易內 `create or replace reset_demo_data`（只改白名單）；尾端自我檢查 |
| `supabase/migrations/0027_demo_row_caps_down.sql` | drop 觸發器（含初版兩個）與函式，還原 `reset_demo_data` 為 0024 本文；**新增尾端自我檢查**與「0028 以上不得使用」警告 |
| `tests/lib/demo-row-caps-migration.test.ts` | 單元測試（不連資料庫）；審查後加固，見下 |
| `tests/demo-row-caps.integration.test.ts`、`vitest.demo-row-caps.config.ts`、`package.json` | `npm run test:demo-row-caps`：16 項，closed_dates／services／designers |
| `verification/TASK-116-verify.sql` | SQL Editor 驗證腳本（交易回滾）：六張表 + 失敗方向案例 + 真實 closed_dates |
| `tests/lib/demo-reset-test-scan.test.ts` | 範圍補登記：白名單加入 0027 與其單元測試 |

## 上限（使用者核准；整張表總列數）

services 10、designers 5、designer_services 50、designer_leaves 20、designer_portfolio_images 60、closed_dates 20。

**已移除（2026-11-01 使用者決定）：** customers 24、appointments 640。理由見下節 S1。

## 審查結論與處置

三份報告：架構（有條件核准）、安全（有條件核准）、測試（有條件核准）。處置如下。

| 項目（來源） | 處置 |
|---|---|
| **S1 架構／N1 安全**：customers／appointments 上限擋不了灌資料（匿名用同一個 `create_appointment` 繞過），反而讓匿名流量刷 12 支新電話就能讓 Demo 當天無法預約 | **採納，移除這兩個觸發器**（使用者決定）；容量防護改靠 TASK-120／121（建議列為入口阻擋條件，待使用者決定）。原 S2（`create_appointment` 端到端驗證）隨之不適用 |
| **安全 S1**：守門對每個角色的每筆 insert 都解析 JWT；`auth.jwt()` 失效時匿名預約與還原會一起壞 | **採納（使用者決定）**：先以 `current_setting('request.jwt.claims')` 字串預篩，沒有 `is_demo` 就放行，不解析 JSON、不依賴 auth schema；疑似 Demo 才解析，解析失敗即拒絕。verify.sql 新增「垃圾 claims（無 is_demo）放行／含 is_demo 擋下」案例 |
| **安全 M1**：`audit_log` 無筆數上限 | **另開 TASK-122，列為 Demo 入口前置條件**（TASK-112 已加依賴）；不併入本卡（使用者決定） |
| **安全 M2**：`services`／`store_settings` 文字欄位無長度上限，可繞過列數上限；本報告先前「欄位有各自長度限制」的說法不正確 | **另開 TASK-123，列為入口前置條件**；說法已更正（見殘留風險） |
| **架構 S3／測試 P1-2**：套用後證據沒寫回；回歸與 build 沒結果 | 已補（見下表）；修訂版套用後需再跑一次 |
| **架構 S4／N4**：audit_log 與「TASK-112 第一次真實還原」應為入口前置關卡 | 已記錄：TASK-122 納入 TASK-112 依賴；「第一次真實還原」本來就是 TASK-112 內容 |
| **架構 N3／安全 N6**：`_down` 無自我檢查；0028 以後會被倒退 | **採納**：`_down` 加尾端自我檢查與檔頭警告 |
| **架構 N5**：`designer_services` 開啟服務依賴 23505 視為成功，表滿時重複開啟會見到錯誤 | 記錄為已知限制（與 closed_dates upsert 同類） |
| **測試 P1-1**：`_down` 沒有實測 | **待使用者**：依序執行 `_down` → `DEMO_ROW_CAPS_EXPECT=off npm run test:demo-row-caps`（預期 16/16）+ `test:demo-reset` → 重套 0027 → 預設模式 16/16。未做前不宣稱驗收標準 6 達成 |
| **測試 P1-3**：整合測試鑑別力取決於真實筆數；額度為 0 時靜默通過 | **採納**：開頭印出每表真實／上限／額度；額度為 0 的案例改 `ctx.skip()`（明確略過）；upsert 案例至少保留 1 筆測試列。最近一次實測額度：closed_dates 真實 1／上限 20／額度 19；services 4／10／6；designers 4／5／**1**（designers 的並行與多列案例額度只有 1，已涵蓋「恰好 1 筆成功」） |
| **測試 P2-2**：單元測試可被繞過（區塊註解、`then 10 + 1`、`else 0`、`grant all`、觸發器 regex 漏洞） | **採納**：`code()` 剝除區塊註解與行尾註解；case 解析要求整行單一整數；`else null` 固定；禁止任何對守門函式的 `grant`；觸發器掃描 regex 容許 constraint trigger、引號、大小寫、省略 schema。**未做**：把整個守門函式與快照逐字比對（改動上限數字時要同步改快照，成本高於收益；行為由整合測試與 verify.sql 把關） |
| **測試 P2-3**：seed 比對只取一個日期 | **採納**：掃描連續 30 個起始日取最大值 |
| **測試 P2-4**：並行證據是機率性的 | 記錄：並行硬上限靠 8 個同時請求重疊，網路若序列化則沒有鑑別力；單元測試只能確認鎖存在於計數之前 |
| **測試 P3**：清除用 `like '__TEST__…'` 的底線是萬用字元 | **採納**：跳脫底線並加 `is_active = false` 條件 |
| **安全 N2**：advisory lock 排隊的間接 DoS | 接受（鎖只有 Demo 會取；與 0025 同類）；未採納 `lock_timeout`／`pg_try_advisory_xact_lock`，會改變「並行恰好 S 筆」的語意 |
| **安全 N5／架構 N8**：白名單只比對觸發器名稱 | 沿用 0024 既有設計，不是本卡新增的風險 |
| 測試：Demo 登入下前台預約與 `designer_services`／請假在 P0001 時的 UI 行為 | 不在本卡（customers／appointments 已移除）；Demo 看到通用錯誤訊息的問題維持為殘留風險 |

## 已跑的驗證

### 初版（8 張表）套用後

| 項目 | 結果 |
|---|---|
| 使用者執行 `TASK-116-verify.sql` | 全部行為檢查符合預期（六張暫存表、真實 closed_dates 路徑；**多列單一 insert 整句被拒絕——設計時的未知事項已證實**）；唯一 MISMATCH 是腳本自己的格式 bug（`prosecdef` 印成 `t`、`search_path=` 前綴重複），函式屬性實際正確，已修腳本 |
| 套用前（基準線） | `DEMO_ROW_CAPS_EXPECT=off` 16/16；預設模式 10 失敗、6 通過 → 測試有鑑別力 |
| 套用後 `npm run test:demo-row-caps` | 16/16 |
| 套用後 `npm run test:demo-reset` | 34/34（白名單同步生效） |
| 套用後回歸 | `test:designers` 122、`test:services` 17、`test:business-hours` 33、`test:booking` 23、`test:admin-booking` 16、`test:demo-enter` 22；`npm run build` 成功 |
| 真實表筆數（verify.sql D 段） | appointments 16／640、customers 14／24（已移除）、closed_dates（含測試列）、designer_leaves 4／20、portfolio 40／60、designer_services 14／50、designers 4／5、services 4／10 |

### 修訂版（6 張表 + 預篩）— 已套用並驗證（2026-11-01）

| 項目 | 結果 |
|---|---|
| `npx vitest run tests/lib/demo-row-caps-migration.test.ts tests/lib/demo-reset-test-scan.test.ts` | 22/22 通過 |
| 使用者重新套用修訂版 0027 後執行 `TASK-116-verify.sql` | **`RESULT=ALL_OK`**：A 段 6 個觸發器 BEFORE INSERT ROW 已啟用、名稱對應、函式 `secdef=true,search_path="",owner_bypassrls=true`、API 角色不可執行、白名單含 6 個、`removed_triggers_gone=0`；B 段六張表每項皆符合（含多列單一 insert 整句被拒、垃圾 claims 無 `is_demo` 放行／含 `is_demo` 擋下）；C 段真實 closed_dates 路徑符合 |
| `npm run test:demo-row-caps` | 16/16（額度：closed_dates 19、services 6、designers 1 → 三張表皆有額度，沒有退化成全被拒） |
| `npm run test:demo-reset` | 34/34 |
| 回歸 | `test:designers` 122、`test:services` 17、`test:business-hours` 33、`test:booking` 23、`test:admin-booking` 16、`test:demo-enter` 22 |
| `npx tsc --noEmit`、`npm run lint`、`npm run build` | 皆無錯誤／成功 |
| 單元 `demo-row-caps-migration` + `demo-reset-test-scan` | 22/22 |
| 真實表筆數（verify.sql D 段） | designer_leaves 4／20、portfolio 40／60、designer_services 14／50、designers 4／5、services 4／10；closed_dates 顯示 21（含本腳本暫補的測試列） |

### 回滾實測（測試審查 P1-1，2026-11-01，已完成）

| 步驟 | 結果 |
|---|---|
| 使用者在 SQL Editor 執行 `0027_demo_row_caps_down.sql` | 成功（尾端自我檢查通過才 commit） |
| `DEMO_ROW_CAPS_EXPECT=off npm run test:demo-row-caps`（回滾後） | **16/16**：Demo 在表已滿時也能新增，上限已消失 |
| `npm run test:demo-reset`（回滾後） | **34/34**：`reset_demo_data` 白名單回到 0024，dry-run 正常 |
| 使用者重新套用 `0027_demo_row_caps.sql` | 成功 |
| `npm run test:demo-row-caps`（預設模式，重套後） | **16/16**：上限恢復 |
| `npm run test:demo-reset`（重套後） | **34/34** |

驗收標準「`_down` 後上限消失、白名單回到 0024」已有執行證據。未做：回滾後預設模式預期失敗的反向對照（套用前基準線已證明預設模式在無上限時會失敗，10 項）；重套後未重跑 verify.sql（重套的是同一份檔案，且整合測試 16/16）。

### 驗收

使用者 2026-11-01 人工驗收通過，看板卡轉 Done。三個審查關卡由子代理完成（皆有條件核准、無 MUST FIX，意見處置見上表），加人工驗收勾選。Demo 入口開放前的前置條件（TASK-122、TASK-123、TASK-112 第一次真實還原；建議 TASK-120／121）仍未完成。
3. Demo 入口前置：TASK-122、TASK-123（已加入 TASK-112 依賴）；建議 TASK-120／121（待使用者決定）。

## 殘留風險與已知限制

- **本卡沒有達成「資料庫不會被灌爆」的完整目標**，Demo 入口開放前還必須完成：TASK-122（audit_log）、TASK-123（欄位長度）、TASK-112 第一次真實還原；建議一併把 TASK-120／121 列為阻擋條件。
- **customers／appointments 沒有 Demo 上限**：Demo 與匿名訪客能力相同（同一個 `create_appointment`，只有每支電話／每個 Email 3 筆的限制），匿名流量可無限新增這兩張表；容量防護屬 TASK-120／121。
- **欄位容量未受限**（更正先前說法）：`designers` 欄位有長度 CHECK；`services.name`／`description`、`store_settings` 多數欄位沒有（TASK-123）。
- **上限是整張表總列數**：匿名訪客不會佔這六張表的額度（它們只能經管理員寫入），但惡意 Demo 使用者可在每次還原後立刻填滿額度，讓當天其他面試官無法新增（共用帳號的設計限制，建議寫進 TASK-111 手冊）。
- designers 上限 5、seed 4：Demo 每天只能新增 1 位設計師（使用者指定）。
- 正式庫現有資料量若已超過某些上限，Demo 要等第一次真實還原後才有額度。
- **`closed_dates`／`designer_leaves`／`designer_services` 的重複新增**：表已滿時，對「已存在」的項目再新增也會得到 `DEMO_ROW_CAP` 而非 23505／upsert 成功（`BEFORE INSERT` 先於衝突判斷）。每日還原後恢復。
- **Demo 看到的錯誤訊息仍是通用文案**：資料庫回 `P0001`／`DEMO_ROW_CAP: <表> (cap N)`＋白話 `hint`，各管理操作對未知錯誤顯示通用訊息；錯誤碼與 `PORTFOLIO_LIMIT` 相同（`P0001`），前端日後只能用訊息前綴 `DEMO_ROW_CAP:` 區分，需寫進前端卡的契約。
- 單元測試是文字把關，不取代行為測試；每次改動 0027 後必須重跑整合測試與 verify.sql。並行硬上限的證據是機率性的。
- 測試期間系統內暫時多一個 `is_demo` 帳戶：每日還原會因「不是剛好 1 個」拒絕執行；若測試被中斷，請立即重跑一次或手動清理；TASK-112 上線前檢查清單要確認沒有 `rowcaps_test` 殘留帳號。
- 整套 `npx vitest run` 跑了兩次，UI 元件測試（account-settings-view、login-form、designer-basic-info-form、designer-picker-section）在整套並行下逾時失敗，案例兩次不同；單獨重跑通過。判斷為並行負載所致，**推定而非證實**（未在乾淨分支完整重現整套）。
