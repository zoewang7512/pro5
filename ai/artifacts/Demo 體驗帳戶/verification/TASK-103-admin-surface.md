# TASK-103 `is_admin()` 寫入面盤點

> 目的：Demo 帳戶就是管理員（`is_admin()` 為真），一鍵進入端點上線後等於把後台的全部寫入權限公開。這份報告逐表列出 **Demo 管理員實際能做什麼、不能做什麼**，確認它無法提權、無法新增 `admins`、無法讀取 `auth` 資料。
>
> 方法：（1）讀 migration 0001～0022 的 GRANT、RLS policy、constraint；（2）`npm run test:demo-enter` 以端點發出的真實 Demo session，對正式 Supabase 專案逐項嘗試越權操作（全過；REST 表層與 RPC 的「被擋」項斷言錯誤碼 `42501`，其餘——未暴露的 schema、Auth Admin API（401／403）、Storage、MFA／改密碼——斷言為被拒絕；每項都斷言沒有回傳任何資料列）。
> 盤點範圍：`public` schema 全部資料表與函式、Storage 的 4 個 bucket、Auth Admin API。盤點時點：migration 套用至 0022（2026-10-30）。**之後任何新 migration 若新增資料表、函式或 Storage policy，都要回頭更新本表**（`is_admin()` 會自動涵蓋新表，這是優點也是風險）。

## 1. 結論

| 問題 | 結論 | 依據 |
|---|---|---|
| 能否提權（讓任何帳號成為管理員）？ | **不能** | `admins` 表 RLS 啟用、零 policy，且 `authenticated` 沒有任何表層授權（0015）；實測 insert／select／update／delete 全部 `42501` |
| 能否新增 `admins` 列？ | **不能** | 同上；`update_admin_profile` 只 `update … where user_id = auth.uid()`，不會新增 |
| 能否讀取 `auth` 資料（`users`、`mfa_factors`、`sessions`）？ | **不能** | `auth`／`storage` schema 未透過 REST 暴露；實測讀取皆被擋。`is_admin()` 內讀 `auth.mfa_factors` 是 `SECURITY DEFINER`，結果只回布林 |
| 能否用 Auth Admin API 建立／改其他帳號？ | **不能** | 實測以 Demo JWT 呼叫 `/auth/v1/admin/users`（GET／POST／PUT）皆 401／403 |
| 能否替自己啟用 MFA 或改密碼？ | **不能** | 0021 資料庫觸發器（TASK-100）；實測 `mfa.enroll`、`updateUser({password})` 皆失敗 |
| 能否呼叫限流／還原函式？ | **不能** | `demo_entry_check`、`demo_revoke_sessions` 只授權 `service_role`；實測 `42501`；`demo_entry_attempts` 表同樣被擋 |
| 能否讀取／竄改顧客憑證？ | **不能** | `appointments.access_token` 不給讀（`42501`）；`customers` 整表不給 authenticated |
| 能否建立 bucket、或**新增**檔案到白名單以外的 Storage 路徑？ | **不能** | 實測 `createBucket` 失敗；上傳到錯誤路徑、錯誤副檔名、不存在的 bucket 皆被擋 |
| 能否**刪除或覆寫** Storage 內既有物件（含 `designer001` 上傳的）？ | **`admin-assets` 已封住（0025，2026-10-31）；`store-assets`、`designer-assets` 仍能刪（接受的殘留）** | 原本 update／delete／list 的 policy 只檢查 `bucket_id` 與 `is_admin()`（0006、0007、0017），實測 Demo 能列出並刪除他人物件 → **§3-H**。0025 新增 RESTRICTIVE policy：`admin-assets` 的 update／delete 限物件擁有者，Demo 完全不能 update；其餘兩個 bucket 的跨使用者刪除由每日還原（整表還原加圖片同步）補回，最長約 24 小時 |

> **本結論的前提**：正式庫目前沒有真實顧客的預約與個資。一旦店家開始接真實預約，Demo 就能**取消或改期真實顧客的預約**，並讀取全部顧客的姓名、電話、Email（見 §3-I）。

**但「無法提權」不等於「沒有危害」**：Demo 管理員仍能寫入下列業務資料（第 2 節）。這些是 Demo 帳戶的本質，已列入架構筆記第 8 節的殘留風險並以每日還原兜底；第 3 節列出**需要後續卡片處理**的項目。

## 2. 逐表盤點：Demo 管理員能做什麼

「讀」「新增」「改」「刪」指 `authenticated` 角色在 GRANT 與 RLS（`is_admin()`）都通過後實際可行的操作。

| 表／資源 | 讀 | 新增 | 改 | 刪 | 備註 |
|---|---|---|---|---|---|
| `admins` | ✗ | ✗ | ✗ | ✗ | 只能透過下列 RPC 存取自己那列 |
| `customers` | ✗ | ✗ | ✗ | ✗ | 0015 刻意不給 authenticated |
| `appointments` | ✓（除 `access_token`、含顧客姓名／電話／Email） | ✗ | 僅 `status`、`start_at`、`end_at`、`reminder_sent_at` | ✗ | 改時間**或改成取消**都會觸發 0012 的通知信 → **§3-A**、**§3-I** |
| `services` | ✓ | ✓ | ✓ | ✗ | 價格、名稱、上下架皆可改（前台立即可見） |
| `business_hours` | ✓ | ✓ | ✓ | ✗ | 7 列 upsert |
| `closed_dates` | ✓ | ✓ | ✓ | ✓ | 可無限新增 → **§3-B** |
| `store_settings`（單例） | ✓ | ✗（0015 未授權 insert；另有 `id = 1` constraint） | ✓ | ✗ | 店名、Logo、封面、電話、簡介 |
| `booking_policy`（單例） | ✓ | ✗（0015 未授權 insert） | ✓ | ✗ | |
| `designers` | ✓ | ✓（欄位白名單，不含 `id`、`created_at`） | ✓（同上） | ✗ | 設計師只停用不刪 |
| `designer_services` | ✓ | ✓ | ✗ | ✓ | |
| `designer_portfolio_images` | ✓ | ✓（路徑 constraint） | ✗ | ✓ | 每位設計師上限由觸發器強制 |
| `designer_leaves` | ✓ | ✓ | ✗ | ✓ | |
| `audit_log` | ✓（含 `designer001` 的紀錄） | ✓（僅 5 個欄位，`actor_id` 一律是自己） | ✗ | ✗ | 每筆最多約 8KB → **§3-B** |
| `demo_entry_attempts` | ✗ | ✗ | ✗ | ✗ | 只有 `service_role` |

### RPC（函式）

| 函式 | 授權 | Demo 能做什麼 |
|---|---|---|
| `is_admin()` | PUBLIC | 回傳自己是否為管理員（布林） |
| `get_admin_profile()` / `update_admin_profile(text, text)` | `authenticated` | 只讀／改 `auth.uid()` 自己那列的顯示名稱與頭像網址（長度有上限）；不影響其他列 |
| `get_available_slots`、`create_appointment` | `anon`＋`authenticated` | 與公開前台相同，Demo 沒有額外能力 |
| `designer_specialties_valid` | `authenticated`、`service_role` | 純驗證函式 |
| `_designer_is_eligible`、`_designer_is_free`、`_email_dedupe_key` | 已 `revoke … from public, anon, authenticated`（0018） | ✗ |
| `demo_entry_check`、`demo_revoke_sessions` | 僅 `service_role` | ✗（實測 `42501`） |
| 觸發器函式（`set_updated_at`、`notify_appointment_*`、`designer_portfolio_limit_check`、`set_appointment_price_snapshot`、`demo_lock_*`） | 部分只 `revoke … from public`（`set_updated_at` 完全沒有 revoke；`notify_appointment_*` 依 0007 的說明，預設 ACL 可能仍授權給 `authenticated`） | 實際無害：回傳 `trigger` 型別的函式無法被直接呼叫；僅更正「都已 revoke」的說法 |

### Storage

| Bucket | 公開讀 | 新增（insert）限定的路徑 | 列出／覆寫／刪除（select／update／delete） | 備註 |
|---|---|---|---|---|
| `store-assets` | ✓ | `logo/…`、`cover/…` | **整個 bucket，無路徑限制** | 5MB、僅 jpeg／png／webp（**只檢查用戶端宣告的 Content-Type**）→ **§3-B**、**§3-H** |
| `admin-assets` | ✓ | `avatar/…` | **整個 bucket，無路徑限制**（含 `designer001` 的頭像） | 同上 |
| `designer-assets` | ✓ | `avatar/<uuid>/<uuid>.jpg／png／webp`、`portfolio/…`（兩層、副檔名白名單） | select、delete：**整個 bucket**；**無 update policy**（但「先刪再傳同路徑」等效覆寫） | 同上 |
| 其他 bucket／新建 bucket | — | ✗ | ✗ | 實測被擋 |

### Auth 面向（不經 REST，直接打 Auth API）

| 操作 | 結果 |
|---|---|
| `updateUser({ password })`、`updateUser({ email })`、`mfa.enroll` | 被 0021 觸發器擋下（TASK-100，實測） |
| `updateUser({ data })`（`user_metadata`） | **可寫**；程式只認 `app_metadata.is_demo`，不影響判斷 |
| global `signOut` | 可踢掉同時在線的其他面試官（已知殘留，架構筆記 D6） |
| `reauthenticate` | 會寄 OTP 到 `DEMO_EMAIL`（耗用 Auth 寄信額度；`reauthentication_token` 不在 0021 鎖定欄位）→ 見 §3-J |
| `linkIdentity` | TASK-100 已確認 manual linking 關閉 |
| passkey 註冊 API（auth-js 2.112 已提供） | **待你到 Dashboard 確認 passkey 未啟用**；若啟用，Demo 可能綁定一個不受還原影響、且繞過一鍵進入限流的替代登入方式 → §3-J |

應用層的 `service_role` 路徑：只用在 cron、webhook（皆要 Bearer 密鑰）與限流 RPC，**沒有任何 server action 以 service_role 代為執行未經 `is_admin` 守門的操作**（已核對）。

## 3. 需要後續處理或使用者已接受的項目

| 編號 | 項目 | 目前狀態 | 處理 |
|---|---|---|---|
| A | **改期寄信濫用**：Demo 可改預約時間，預約有 Email 時觸發寄信，信件內店名、電話等可被 Demo 竄改 | **上線前必須處理**（架構筆記第 8 節第 1 項，使用者決定採 A：Demo 修改時不寄信） | TASK-114（資料庫）、TASK-115（前端視窗）。**在 TASK-114 完成前，正式環境不得把 `DEMO_ENABLED` 設為 `true`**（暗啟動與開啟由 TASK-112 串接，其 dependsOn 已含 114） |
| B | **資料量與儲存配額**：`audit_log`、`services`、`closed_dates`、Storage 上傳可被灌爆，進而拖垮整個專案（含前台） | Storage 由 TASK-113 處理；資料庫列數使用者已接受，靠監控、每日還原與 `demo:disable` | TASK-113 |
| C | **公開前台被竄改**：店名、Logo、設計師作品集、服務價格改了會直接出現在正式前台，最長到下次還原 | 使用者已接受；需備妥「立即手動還原」流程 | TASK-108～110、111 手冊 |
| D | **網址欄位可填任意外部網址**：`store_settings.logo_url`／`cover_image_url`、`designers.avatar_url`、`admins.avatar_url` 在資料庫只有長度限制（`designer_portfolio_images.image_url` 則綁定儲存路徑尾端），沒有 origin 白名單；`lib/admin/account.ts` 的白名單是前端／伺服器端程式的防線，**直接打 REST 可繞過**。公開前台會把這些網址當圖片載入 → 可用作追蹤像素或內容注入，直到下次還原 | **新發現，未列在架構筆記** | 建議併入 C 一起請使用者確認接受；若不接受，需新 migration 加 `check`（限定 `NEXT_PUBLIC_SUPABASE_URL` 的 storage 路徑），屬既有資料表的變更，須另開高風險卡 |
| E | 面試官輸入的顧客資料會被下一位看到（Demo 可讀全部 `appointments` 的姓名／電話／Email） | 使用者已接受（第 8 節第 4 項） | — |
| F | Demo 讀得到 `designer001` 的 `audit_log` | 已知（僅 actor UUID、服務名、設計師名） | 可接受 |
| H | **跨帳號刪除／覆寫 Storage 物件**：Demo 可列出並刪除三個 bucket 內任何既有物件，包含 `designer001` 上傳的 `admin-assets` 頭像與 `designer-assets` 作品集；每日還原**刻意不動 `designer001` 的頭像**，所以這是**永久性**損害，不是還原就會恢復（架構筆記 D11 已知，本表先前只當配額問題，已更正） | **上線前必須處理** | TASK-113（Storage 擁有者與上傳上限）。**在 TASK-113 完成前，正式環境不得把 `DEMO_ENABLED` 設為 `true`**（TASK-112 的 dependsOn 已含 113）。**2026-10-31 TASK-113 已處理 `admin-assets`（頭像永久損害）**，整合測試的特徵化案例已反轉為「被擋」；`store-assets`／`designer-assets` 的跨使用者刪除列為接受的殘留（每日還原補回） |
| I | **竄改真實顧客預約**：Demo 可取消或改期任一筆預約（含真實顧客的）；TASK-114 上線後 Demo 發動的取消／改期**不寄信**，顧客本人不會知情 | 目前前提是「正式庫沒有真實預約」（見 §1）；**使用者尚未明確接受這點**（第 8 節第 4 項接受的是「讀得到」） | 請使用者明確接受，或在店家開始接真實預約前先關閉 Demo／另開卡處理 |
| J | **Auth 額度與替代登入**：`reauthenticate` 可消耗 Auth 寄信額度；passkey 若啟用可能成為不受還原影響的後門 | 新發現 | 請你到 Supabase Dashboard 確認 passkey 未啟用；寄信額度併入 TASK-111 營運手冊的監控項 |
| K | **測試中斷會卡住緊急處置**：整合測試期間正式庫會同時有 3 個 `is_demo` 帳號（拋棄式），`demo_revoke_sessions()` 與還原要求「剛好 1 個」；若測試中途被中斷而沒清掉，`demo:disable` 會失敗 | 新發現 | 測試檔頭已寫清除步驟；TASK-111 手冊加一句「異常時先確認沒有殘留的 `demoenter` 測試帳號」。測試只在非還原期間手動跑 |
| G | 這份盤點是**時間點快照**；`is_admin()` 會自動涵蓋日後新表與新 Storage policy | — | 日後每張新增資料表或 Storage policy 的卡，驗收清單要加一項「Demo 管理員能對它做什麼」 |

## 4. 實測紀錄

`npm run test:demo-enter`（2026-10-31，正式 Supabase 專案，拋棄式帳號，結束後已刪除並驗證無殘留）：22 項全過，含 `is_admin() 寫入面` 區塊 12 項（含 §3-H 的特徵化案例；**TASK-113 套用 0025 後該案例已反轉為「Demo 不能刪除不是自己上傳的 admin-assets 物件」**）。被擋的操作沒有留下任何資料（Storage 上傳另有「萬一寫進去就立刻清除」的保險）；特徵化案例只動自己用 service role 上傳的測試物件。

未以實測涵蓋、僅依 migration 判讀的部分（誠實揭露）：各表「允許」操作的邊界（例如 `services` 可改哪些欄位、`designers` 欄位白名單的每個欄位），因為「允許的寫入」會改動正式資料，整合測試刻意不執行；這些以 GRANT 與 policy 原文為準。
