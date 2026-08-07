# AI-Ready 任務卡

## Metadata

- 任務：預約管理後台 前後端串接驗證與端到端測試
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：預約管理後台
- 上層 User Story：涵蓋全部四個 User Story 的端到端驗收
- 分軌：前後端串接
- 前置任務（dependsOn）：TASK-014, TASK-015, TASK-016
- 狀態：就緒，實作中（TASK-014/015/016 已全部 done）
- 風險等級：中（涵蓋預約狀態變更與改期時段衝突的整合驗證；不涉及 anon 可觸及的新介面，
  風險低於「顧客預約流程」Epic 的 TASK-013，但仍屬於資料寫入路徑，維持中風險）
- Agent owner：Claude Code
- 人工核准者：使用者，2026-08-06（指名要求「繼續做 TASK-017」，視為核准開始實作）

## 目標

建立並執行對真實 Supabase 專案的整合測試，驗證「預約管理後台」整條路徑（查看週曆／列表
→標記完成／取消／改期）符合 feature-spec 的驗收標準，特別是改期時 exclusion constraint
透過 authenticated 直接 update 路徑仍正確運作；並用 Browser 工具完成桌面尺寸的端到端
走查。

## 情境包（Context Pack）

- 相關檔案：`app/admin/`、`lib/admin/`、`vitest.booking.config.ts`（比照其命名與獨立
  執行模式，本卡新增對應的 admin 整合測試 config 或擴充既有機制）、
  `tests/booking.integration.test.ts`（既有的整合測試模式，含 service role／anon client
  設置、`TEST_MARKER` 隔離、`afterAll` 清除的既有寫法，本卡的新測試檔案直接沿用同一套
  慣例，包含 TASK-013 審查發現後修正的細節：`escapeLikePattern`、精確錯誤代碼比對、
  `afterAll` 失敗時要 throw 不能吞掉）、`ai/artifacts/顧客預約流程/feature-spec.md`
  「安全性與隱私」段落（RLS 邊界驗證的既有規格語言可參考）。
- 既有模式：比照 TASK-013 的 `npm run test:booking` 模式——對真實 Supabase 專案跑的整合
  測試，獨立指令，不放進預設 `npm test`。
- 假設：無。
- 未知事項：無。
- 允許變更的檔案：`tests/admin-booking.integration.test.ts`（新增）、
  `vitest.admin-booking.config.ts`（新增，比照 `vitest.booking.config.ts`）、
  `package.json`（新增 `test:admin-booking` script）、`ai/context/project-map.md`
  （更新常用指令表）。
- 不得觸碰：`app/admin/`／`lib/admin/` 的功能邏輯（若測試中發現 bug，回頭修對應的
  TASK-014/015/016 範圍內程式碼，不在本卡順手改功能——但小的、範圍內的 bug 修正可以直接做
  並在完成證據中註明，比照「顧客預約流程」Epic TASK-013 的既有做法）。

## 需求

- 整合測試涵蓋（對真實 Supabase 專案跑，測試資料於結束後清除）：
  - 用 designer（`authenticated`＋`is_admin()`）角色查詢某週的 `appointments`（含
    embedded `services` 資料），確認回傳資料正確、anon 角色查詢同樣範圍應被 RLS 拒絕
    （沿用既有邊界，重新確認本 Epic 沒有意外開放更寬的存取）。
  - `markAppointmentCompleted`／`cancelAppointment` 對真實資料的成功案例，以及對已經是
    `completed`／`cancelled` 的預約再次操作應被畫面邏輯擋下（純函式層級驗證，見
    TASK-015 的單元測試；本卡驗證的是資料庫層確實正確反映狀態變更，不重複前端邏輯測試）。
  - `rescheduleAppointment` 成功改期案例；改期到與既有預約重疊的時段被
    `appointments_no_overlap` exclusion constraint 擋下（`23P01`），原預約時段不受影響；
    相鄰但不重疊的時段改期應成功——比照「顧客預約流程」TASK-013 的「Exclusion constraint
    邊界」案例設計。
  - anon 角色嘗試直接 `update`／`insert`／`delete` appointments 皆被 RLS 拒絕（重新確認，
    因為本 Epic 是本專案第一次讓 authenticated 角色對 appointments 做非 RPC 的直接寫入，
    需要確認這沒有意外連帶放寬 anon 的邊界）。
- E2E／視覺走查：用 Browser 工具在桌面尺寸下跑一次完整流程（登入→本週週曆→點選預約→
  標記完成／取消／改期各跑一次），並跑一次改期衝突的錯誤路徑，對照 S5 mockup 變體 B 與
  `screen-spec-預約週曆列表.md` 的畫面狀態表。
- 更新 `ai/context/project-map.md`：補上本 Epic 的重要目錄（`lib/admin/`、
  `app/admin/_components/`）與 `test:admin-booking` 指令。

## 驗收標準

- `npm run test:admin-booking` 全數通過，涵蓋上述資料讀取、狀態變更、改期衝突邊界、RLS
  邊界案例。
- `npm run test:rls`／`npm run test:booking` 重跑通過，確認本 Epic 沒有造成既有測試回歸。
- Browser 工具在桌面尺寸下走查完整流程與至少一種錯誤路徑（改期衝突），畫面符合
  feature-spec 與 screen-spec 的畫面狀態表。
- `npx tsc --noEmit`／`npm run lint`／`npm run build`／`npm test`（預設）皆通過。
- feature-spec 的「驗收標準」章節逐條核對，全部打勾或明確記錄例外。

## 實作備註

- 沿用 TASK-013 審查中發現並修正的測試撰寫細節，不要重蹈同樣的問題：LIKE pattern 需要
  跳脫萬用字元、`afterAll` 清除失敗要 throw、RLS 拒絕的斷言要精確比對錯誤代碼或先確認
  底下確實有資料（避免恆真斷言）、涉及時間比較一律轉 epoch 再比較（Postgres jsonb／
  timestamptz 序列化格式與 `.toISOString()` 不同）。

## 驗證契約

- 單元測試：不適用（本卡聚焦整合／E2E，單元測試已在 TASK-014/015/016 涵蓋）。
- 整合測試：`npm run test:admin-booking`（本卡負責建立與執行）；重跑
  `npm run test:rls`／`npm run test:booking` 確認無回歸。
- E2E 測試：Browser 工具手動走查，桌面尺寸（見「需求」）。
- 型別檢查：`tsc --noEmit` 成功。
- Lint：`npm run lint` 成功。
- Build：`npm run build` 成功。
- 螢幕截圖：桌面尺寸完整流程走查（週曆→詳情 Modal→標記完成／取消／改期）與改期衝突
  錯誤路徑。
- 安全性檢查：anon 對 `appointments` 的直接寫入（含 update／delete）皆被拒絕；改期／
  標記完成／取消的錯誤訊息不洩漏原始 Postgres 錯誤細節；顧客個資不出現在 log／URL。

## 完成證據

- 變更的檔案：
  - 新增：`tests/admin-booking.integration.test.ts`（13 個測試案例：designer 讀取權限邊界
    2 個、markAppointmentCompleted／cancelAppointment 4 個、rescheduleAppointment 2 個、
    anon RLS 邊界 4 個、getAppointmentDetail 的 anon PII 邊界 1 個——審查後新增）、
    `vitest.admin-booking.config.ts`（比照 `vitest.booking.config.ts`）。
  - 修改：`package.json`（新增 `test:admin-booking` script）、
    `ai/context/project-map.md`（補上 `lib/admin/`／`app/admin/_components/` 目錄說明、
    `test:admin-booking` 指令、測試段落說明）。
  - 未修改 `app/admin/`／`lib/admin/` 任何功能邏輯（本卡執行期間沒有發現需要修正的 bug）。
- 執行過的指令：
  - `npm run test:admin-booking` → 1 file / 13 tests passed（審查修正後的最終結果）。
  - `npm run test:booking` → 1 file / 19 tests passed（無回歸）。
  - `npm run test:rls` → **失敗，但已確認與本卡變更無關**（見下方「已知限制」）。
  - `npx tsc --noEmit` → 無錯誤。
  - `npm run lint` → 0 problems。
  - `npm run build` → 編譯成功。
  - `npm test`（預設）→ 10 files / 56 tests passed（`tests/admin-booking.integration.test.ts`
    未被預設 include 撿到，符合設計）。
  - 瀏覽器（Browser 工具）桌面尺寸對真實 Supabase 專案手動走查（設計師登入 designer001
    帳號）：
    1. 透過顧客前台建立 4 筆測試預約（E2E-Complete-Test 8/14 10:00、E2E-Cancel-Test 8/14
       11:00、E2E-Reschedule-Source 8/14 12:00、E2E-Reschedule-Occupant 8/14 15:00）。
    2. 後台週曆正確顯示本週切換（`下一週` 從 8/3–8/9 切到 8/10–8/16）與 4 筆新預約。
    3. 標記完成：E2E-Complete-Test 點開詳情→標記完成→Modal 關閉、狀態即時變為「已完成」。
    4. 取消（含二次確認）：E2E-Cancel-Test 點開詳情→取消預約→跳出「再想想／取消預約」
       確認對話框→確認→狀態即時變為「已取消」。
    5. 改期成功：E2E-Reschedule-Source 開啟改期表單，切換到 8/14 後確認時段格點正確（自己
       原時段 12:00 可選、已完成的 10:00–10:45 與已取消後空出的 11:00 分別正確停用/可選、
       E2E-Reschedule-Occupant 佔用的 15:00 前後時段正確停用），選 16:00→送出成功→Modal
       關閉、週曆即時反映新時段 16:00–16:45。
    6. **改期衝突錯誤路徑（競態模擬）**：E2E-Reschedule-Source 改期表單選定 8/14 13:00（送出
       前尚為空檔）後，切到顧客前台以另一筆預約（E2E-Race-Interloper）搶先佔用同一時段，
       再回到後台送出原本的（已過期）選擇，確認表單內正確顯示「這個時段已被其他預約占用，
       請選擇其他時段。」，Modal 不關閉，原預約時段不受影響。
    7. 列表檢視：切換「列表」分頁，5 筆預約（含競態測試建立的 E2E-Race-Interloper）正確
       顯示日期／時段／顧客／服務／狀態。
    8. 唯讀狀態：點開已完成的 E2E-Complete-Test，詳情 Modal 只顯示姓名/時段/服務/電話/狀態
       與「關閉」按鈕，無任何操作按鈕，符合 screen-spec 的「停用」狀態列。
    9. 驗證完成後清除所有測試預約（E2E-Complete-Test／E2E-Cancel-Test／
       E2E-Race-Interloper／E2E-Reschedule-Occupant／E2E-Reschedule-Source），還原資料庫為
       驗證前狀態（透過 service role 依 `E2E-%` 前綴刪除，未使用 TEST_MARKER 慣例前綴是
       因為手動走查步驟本身即為證據，不需要程式化重跑，故未沿用整合測試檔的做法，但同樣
       完整清除）。
  - feature-spec「驗收標準」章節已逐條核對，涵蓋於上方指令與走查記錄，無例外。
- 審查發現（比照 TASK-013 的審查模式，對新增的整合測試檔案跑 architect／security-reviewer
  審查）：
  - **architect 審查：核准（含 4 項非阻擋建議，已全部處理）**：(1) `STATUS_DATE`／
    `RLS_WRITE_DATE` 部分 fixture 落在 09:00-09:30，早於 seed 的營業時間
    10:00-19:00——沿用 TASK-013 曾被要求修正過的同一類問題，已全部改到 10:00 以後；
    (2) 合成電話固定重複使用同一組值，已改用比照
    `tests/booking.integration.test.ts` 的 `testPhone()` 遞增序號寫法；(3)
    `appointmentIdsToCleanup` id 陣列與最後 `service_id` 批次刪除重複，屬多餘的維護負擔，
    已移除只保留 `service_id` 刪除；(4) `afterAll` 對 `testServiceId` 的使用已在
    security-reviewer 審查中一併修復（見下方）。另外標出一項可選的涵蓋率缺口：
    `getAppointmentDetail`（唯一會回傳 `customer_phone` 的路徑）原本沒有整合測試涵蓋 anon
    PII 邊界，已新增對應測試。
  - **security-reviewer 審查：Changes needed（2 項阻擋，已修復；3 項次要建議，已處理）**：
    必要修復 1（恆真斷言）：「anon 讀不到本測試建立的任何 appointments」原本沒有先用
    service role 確認底下確實有資料，若 TEST_MARKER 或 LIKE 跳脫寫錯，這個斷言會靜默通過
    ——已補上與其他 RLS 測試一致的 service role 正向確認。必要修復 2（清除失敗可能中途
    中止、殘留 PII）：`afterAll` 原本用三個依序 `throw` 的刪除步驟，若第一步失敗會讓後面
    兩步完全不執行；且 `testServiceId` 若因 `beforeAll`提早失敗而是 `undefined`，會送出
    `service_id=eq.undefined` 這種看似成功、實則什麼都沒刪到的查詢掩蓋真正的失敗原因——
    已改成收集所有錯誤最後一次彙整丟出，並在 `testServiceId` 存在時才執行依賴它的刪除。
    次要建議（已處理）：anon 直接 delete 的回傳值原本被忽略，已補上 `error` 為
    `null` 的斷言；anon 直接 update／改期失敗後原本只驗證 `start_at` 不變，已補上
    `status`／`end_at` 也不變的斷言；檔案開頭註解已補充說明
    `appointments_no_overlap` 是全域 exclusion constraint 的風險與程序被中斷時的人工
    清除步驟。密鑰使用、PII 記錄行為皆確認乾淨（合成電話為假資料，且執行後由 afterAll
    清除；`.env.local` 已被 `.gitignore` 排除；檔案內無任何 `console.*`）。
  - 兩項審查發現的修正完成後已重新執行 `npm run test:admin-booking`（13/13 通過）、
    `npx tsc --noEmit`、`npm run lint`、`npm run build`、`npm test`（56/56）、
    `npm run test:booking`（19/19，無回歸），結果與上方「執行過的指令」一致。
- 已知限制：
  1. **`npm run test:rls` 目前會間歇性失敗，與本卡變更無關**：失敗原因是資料庫裡一筆既有
     的真實／示範預約（客戶名稱「Mr. Wang」，2026-08-06 07:00–07:45 UTC，狀態
     completed），與 `tests/rls.integration.test.ts` 的 `beforeAll` 用「now+1hr～
     now+1.5hr」建立 fixture 的寫法時段重疊，導致 `appointments_no_overlap` exclusion
     constraint 擋下 fixture insert，整個 describe block 崩潰、6 個測試全部 skipped。
     `rls.integration.test.ts` 完全沒有 import 任何 `lib/admin/` 或本卡新增的程式碼，純屬
     既有測試（TASK-003 範圍）的時間點碰撞設計缺陷＋資料庫裡一筆非 TEST_MARKER 前綴的
     殘留資料，經與使用者確認後記錄為已知問題、暫不處理（不在本卡「允許變更的檔案」清單
     內，也不屬於 TASK-014/015/016 範圍），已另開追蹤任務。
  2. `test:admin-booking` 沿用既有整合測試「不對正式環境高頻率重複執行」的注意事項——
     `appointments_no_overlap` 是全域 exclusion constraint，測試期間會暫時佔用真實時段
     （已選離今天 40 天以上降低風險）。
  3. 螢幕截圖：本次工作階段沿用 TASK-014/015/016 記錄過的既有限制（Browser pane 於部分
     操作中未穩定顯示 screenshot），改以 accessibility tree（`read_page`）、
     `get_page_text` 與 `javascript_tool` 讀取 dialog 內文字（僅用於讀取驗證，未用於實作
     互動）取得同等強度的驗證證據，並輔以直接資料庫查詢（服務金鑰）交叉確認測試資料狀態。
- 後續任務：
  - 已另開任務：修正 `tests/rls.integration.test.ts` 的 fixture 時段碰撞風險（改用遠期
    安全日期，比照 `tests/booking.integration.test.ts` 的做法），並確認「Mr. Wang」這筆
    既有資料是否為應清除的展示/測試殘留。
  - Epic 完成，回頭視情況更新 `ai/artifacts/預約管理後台/feature-spec.md` 狀態為
    「已實作」。
