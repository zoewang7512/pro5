# 驗證報告

## 摘要

- 任務：TASK-106 Demo seed 資料定義（純函式）與現況匯出工具
- 結果：**實作與自動化驗證完成，待使用者審閱 `seed-base.json` 並人工驗收。**單元 10 項全過；匯出工具對正式庫唯讀實跑一次，前後筆數完全一致。
- 驗證者：實作 agent（Claude Code）。本卡審查關卡只有「驗證（測試工程）」，未另外派子代理審查；agent 意見不等於人工核准。
- 日期：2026-10-31。基底資料來源採任務卡建議的 B（從目前正式資料匯出，再由使用者刪改）。
- **核准 `seed-base.json` 之前，不得推進 TASK-107／108／116 等下游卡。**

## 變更的檔案

| 檔案 | 說明 |
|---|---|
| `lib/demo/seed-types.ts` | 新增：基底資料與 `reset_demo_data` payload 的型別 |
| `lib/demo/seed-data.ts` | 新增：`buildDemoSeed(now, base)`、`summarizeDemoSeed`、`uuidV5`、基底資料檢查（純函式，無 `server-only`） |
| `lib/demo/seed-base.json` | 新增：**草稿**，由匯出工具產生後加上人工維護區塊（`schedule`、`customer_pool`、`demo_admin_profile`，以及我建議的一個公休日與兩筆請假） |
| `scripts/export-demo-base.mjs` | 新增：唯讀匯出工具 |
| `tests/lib/demo-seed-data.test.ts`、`tests/lib/__snapshots__/` | 新增：10 項單元測試（含 snapshot） |
| `package.json` | 新增 `demo:export-base` |

## 設計重點

- **id 策略**：設計師、服務、作品集的 id 與 `storage_path` 全部沿用基底；預約與顧客用 uuid v5（命名空間寫死）。同一天、同一設計師、同一順位永遠得到同一個預約 id。
- **日期**：以 `now` 的台北日期為基準，往前 `history_days`、往後 `future_days` 天；公休日、請假日在基底裡存「距離今天的天數」，還原時才換算成日期。
- **預約產生**：每天每位設計師用「日期＋設計師 id」雜湊成種子，確定性亂數決定筆數、服務、顧客、空檔；起始時間在 30 分鐘格線上，下一筆至少在「結束＋服務緩衝」之後。
- **狀態**：已結束且未取消 → `completed`；尚未結束且未取消 → `pending`／`confirmed`；取消比例依設定。
- **安全**：`customer_email` 一律 `null`、不帶 `access_token`、顧客電話為 `0900-000-0NN` 虛構值；`demo_admin_profile.display_name` 固定為「Demo帳號」；基底檢查會擋掉超過 5 位設計師、每位超過 12 張作品、路徑格式不符、電話重複。

## 指令與輸出

| 指令 | 結果 |
|---|---|
| `npx vitest run tests/lib/demo-seed-data.test.ts` | 10 passed |
| `npx tsc --noEmit` | 0 錯誤 |
| `npm run lint` | 0 error |
| `npm run build` | 成功 |
| `npx vitest run`（全部單元測試） | 1791 passed／17 failed，**失敗全在 `tests/components/account-settings-view.test.tsx`**（逾時）；單獨跑該檔 50 passed。與本卡無關，是整套並行時機器負載造成的既有逾時 |
| `npm run demo:export-base -- --yes`（對正式 Supabase 實跑） | 成功，寫出 `lib/demo/seed-base.json` |

### 匯出工具唯讀證據

實跑前後各以 service role 對全部相關表做 `count`（`head` 查詢），**完全一致**：

```text
前：services 4, designers 4, designer_services 14, designer_leaves 4, designer_portfolio_images 40, business_hours 7,
    closed_dates 1, booking_policy 1, store_settings 1, appointments 16, customers 14, audit_log 28, admins 1
後：同上，逐項相同
```

另有單元測試掃描腳本原始碼：不得出現 `.insert(`／`.update(`／`.upsert(`／`.delete(`／`.rpc(`、`.auth`／`.storage`，不得出現 `appointments`／`customers`／`audit_log`／`admins` 字串，且九張白名單表都出現。輸出檔掃描：沒有 Email、顧客資料；店家電話已換成佔位值。

## 驗收標準對照

| 驗收標準 | 結果 | 證據 |
|---|---|---|
| 固定 `now` 與基底，payload 完全可重現（snapshot） | 通過 | 同輸入跑兩次 `toEqual`，並有 snapshot |
| 不變量全過（無重疊、營業時間內、非公休、非請假、設計師有該服務、作品 ≤ 12、`customer_email` 全 null、無 `access_token`、狀態分布、設計師 `created_at` 順序） | 通過 | 單元測試逐筆檢查全部 425 筆預約 |
| 換不同 `now`（+30 天、台北跨日邊界）仍通過；設計師、服務、作品集 id 與路徑不變 | 通過 | 單元測試 |
| 匯出工具零寫入、輸出不含預約與顧客 | 通過 | 前後筆數比對、原始碼掃描、輸出檔檢查 |
| 使用者已審閱並核准 `seed-base.json` | **待使用者** | 見下方審閱清單 |
| 顯示名稱為「Demo帳號」；各表筆數清單已交使用者 | 通過／待使用者核准 | 見下方筆數與 TASK-116 建議表 |

## 請使用者審閱：`lib/demo/seed-base.json`

這份是從目前正式資料匯出的草稿，請逐項確認（要改的地方告訴我，或直接改檔案後重跑測試）：

1. **店家資訊**：名稱「普洛午理髮廳」、地址「台北市大安區忠孝東路四段1號」、簡介「我們相信，好的髮型不僅是外在的點綴，更是內在能量的釋放。」；Logo／封面指向 `store-assets` 公開 bucket。**電話已被匯出工具換成佔位值 `02-0000-0000`**（基底資料不得含真實電話），要用別的號碼請告訴我。
2. **服務 4 項**：京喚羽（5000 元、80 分＋10 分緩衝，有一段長說明）、剪髮造型 800／45 分、染髮設計 2400／120 分、頭皮護理 1200／60 分。
3. **設計師 4 位**（上限 5）：店長（無簡介、無頭像、無 IG，**預設設計師，created_at 最早**）、艾莉絲 Alice、傑克 Jack、肯尼 Kenny。作品集共 40 張（Jack 12、Alice 12、店長 9、Kenny 7）。圖片網址是正式專案的公開 bucket 網址（本來就公開，不含個資）。
4. **營業時間**：週日公休，週一至週六 10:00–19:00。**預約規則**：最早提前 1 小時、取消期限未設。
5. **我加上的人工維護區塊**（不是從資料庫來的，請看是否可接受）：
   - `closed_date_offsets: [9]`：今天起第 9 天公休一天（目前正式資料的公休日都已過期，匯出工具只保留未來日期，所以原本是空的）。
   - `designer_leave_offsets`：Jack 第 4 天、Alice 第 12 天請假。
   - `schedule`：往前 42 天、往後 21 天；每位設計師每個營業日 1～3 筆；約 10% 取消；未開始的預約約 30% 待確認、其餘已確認。
   - `customer_pool`：12 位虛構顧客（陳小美、林大偉…），電話 `0900-000-001` 到 `012`。名稱是我隨手取的常見名字，若想換成明顯的虛構名稱（例如「示範顧客 A」）請告訴我。
   - `demo_admin_profile`：顯示名稱「Demo帳號」，頭像 `null`。

## 各表筆數與 TASK-116 上限建議（請使用者核准）

以 `now = 2026-10-31`、目前基底產生的 payload：

| 表 | seed 筆數 | 建議 Demo 上限 | 說明 |
|---|---|---|---|
| services | 4 | 10 | 使用者指定（2026-10-31） |
| designers | 4 | **5** | 使用者指定 |
| designer_services | 14 | 50 | 5 位設計師 × 10 項服務的理論上限 |
| designer_leaves | 2 | 20 | seed 太少，2～3 倍沒有意義，抓一個合理的小數字 |
| designer_portfolio_images | 40 | 60 | 5 位 × 每位 12 張（資料庫既有上限） |
| closed_dates | 1 | 20 | 同上，seed 太少 |
| customers | 12 | 24 | 使用者指定：2 倍 |
| appointments | 425（不同日期 392～451） | 640 | 使用者指定：1.5 倍（425×1.5≈638，取整） |

## 殘留風險與已知限制

- **TASK-116 上限是「整張表的總列數」，不只算 Demo 新增的**：前台訪客（匿名）預約也會佔用 `customers` 與 `appointments` 的額度，額度滿了 Demo 就無法再預約，直到下次還原。customers 只剩 12 的空間，最容易遇到；TASK-116 的錯誤訊息要白話。

- 預約約 425 筆（42＋21 天、4 位設計師）。若覺得還原後資料太多或日曆太擠，可調 `schedule`；筆數也決定 TASK-116 的上限。
- 本卡沒有用真實資料庫驗證 payload：`reset_demo_data` 尚未存在（TASK-108）。重疊、營業時間、緩衝等約束靠單元測試的不變量檢查；與資料庫 constraint 的實際相容性要到 TASK-108 的 dry-run 才能證明。
- 匯出工具再跑一次會重新產生 `closed_date_offsets`、`designer_leave_offsets` 與店家等資料（我手動加的建議會被覆蓋為匯出值，原本空的）；`schedule`、`customer_pool`、`demo_admin_profile` 會保留。
- 圖片與頭像網址指向正式專案的公開 bucket；TASK-107 會處理私有 `demo-seed` bucket 的匯入，路徑不變。
- 全部單元測試並行時，`account-settings-view` 既有測試會因機器負載逾時（與本卡無關，單獨跑通過）。

## 後續

- 使用者審閱並核准 `seed-base.json` → 才能開始 TASK-107、TASK-108、TASK-116。
- TASK-116：依上表由使用者核准各表上限。
