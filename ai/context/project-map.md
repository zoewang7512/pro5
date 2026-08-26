# 專案地圖

狀態：依 TASK-001～TASK-003 完成的部分填寫，隨後續 Epic 持續更新。

## 產品

- 名稱：理髮廳線上預約系統
- 使用者：顧客（前台，行動裝置為主，未登入自助預約）／設計師（後台，桌面為主，唯一帳號登入管理）
- 核心工作流程：顧客瀏覽服務項目並預約 → 設計師在後台管理服務項目、預約與顧客資料

## 技術棧

- 前端：Next.js 16（App Router + TypeScript）
- 後端：Next.js Server Components／Server Actions + Supabase（BaaS）
- 資料庫：Supabase Postgres，啟用 RLS；schema 定義於 `supabase/migrations/`。核心表：
  `services`（含 `buffer_minutes` 欄位，TASK-022，0～120 分鐘，預設 0）／`customers`／
  `appointments`／`admins`（TASK-003）、`business_hours`（TASK-010，每週固定營業時間／
  固定公休；`create_appointment` 自 TASK-062 起也會檢查這張表，不只 `get_available_
  slots`（TASK-024 起）——顧客繞過前端直接呼叫 RPC 不再能在週固定公休日或非營業時段
  訂到位，見 `supabase/migrations/0014_create_appointment_business_hours.sql`；查無
  該 weekday 的設定列時一律拒絕（fail-closed），已確認的主要觸發原因是該 weekday 列被
  誤刪或後台 upsert 部分失敗——`0002_booking_flow.sql:37-43` 的 admin policy 是
  `for all`（含 DELETE），設計師身分本來就能刪除某個 weekday 的列，與 RLS 完全無關、
  且已確認可真實發生；`force row level security` 誤啟用只是次要、**未經查證**的理論
  前提（Supabase 的 `postgres` 角色通常具有 `BYPASSRLS`，若函式擁有者是 `postgres`，
  force RLS 對 `security definer` 函式可能根本不生效），不是主要敘事。**故障徵狀**：
  這個分支觸發時，全站該 weekday 的預約 100% 被拒、訊息一律是 `SLOT_CONFLICT`，
  `get_available_slots` 同時對該 weekday 全部日期回傳空陣列，錯誤碼本身看不出根因；
  Postgres log 有 `raise log 'create_appointment: business_hours missing row for
  weekday %'` 記錄可查——這是判斷「單純該 weekday 公休」與「設定列意外消失」的入口）、
  `closed_dates`
  （TASK-022，特定日期整天公休標記，`date` 為 primary key，RLS 邊界比照 `business_hours`：
  anon／authenticated 皆可讀，只有 `is_admin()` 可寫；`create_appointment` 自 TASK-028
  起也會檢查這張表，不只 `get_available_slots`（TASK-024 起）——顧客繞過前端直接呼叫
  RPC 不再能在公休日訂到位，見 `supabase/migrations/0013_create_appointment_closed_
  dates.sql`；**同樣不得啟用 `force row level security`**，理由與下方 `booking_policy`
  相同：`create_appointment` 的公休日檢查靠 `select ... exists` 讀到列才會生效，force
  RLS 會讓它讀到 0 列而靜默失效，比 `booking_policy` 的 fallback 更危險——那裡至少還有
  提前量，這裡整個防線會直接消失）、`store_settings`（TASK-029，店家基本
  資訊與品牌圖片 URL，單例表，`id` 恆為 1，migration 內 seed 保證恆有 1 列，不需要處理零列
  情境；RLS 邊界比照 `business_hours`；後台 `/admin/store-settings`（TASK-030／031）可編輯／
  上傳，顧客前台首頁品牌顯示區塊（TASK-032）anon 讀取後同步顯示，未設定或讀取失敗時回退純
  文字標題）、`booking_policy`（TASK-046，預約規則設定，單例表，`id` 恆為 1，欄位
  `min_lead_time_hours`（1～720 小時，`not null`）／`cancel_window_hours`（0～720
  小時或 `null`＝未設定）；RLS 邊界比照 `business_hours`／`store_settings`：anon／
  authenticated 皆可讀，只有 `is_admin()` 可寫，另外 `revoke truncate`；讀取函式
  `getBookingPolicy` 放在 `lib/booking-policy.ts` 頂層而非 `lib/admin/`，後台
  `/admin/booking-policy`（TASK-046 骨架／TASK-047 編輯儲存）與顧客前台
  `BookingFlow.tsx`（TASK-049）共用同一支函式；`create_appointment`／
  `get_available_slots` 自 TASK-048 起改讀 `min_lead_time_hours` 取代原本寫死的
  1 小時提前量，查無資料時 fallback 為 1 小時且不受 `force row level security`
  影響——**該表不得啟用 `force row level security`**，否則兩支 RPC 會靜默把管理員
  設定的提前量放寬回 1 小時，見 `supabase/migrations/0009_booking_policy_lead_time.sql`
  的檔頭說明）。Supabase Storage 另有 `store-assets` public bucket（TASK-029，存放 Logo／
  封面圖，公開讀取、只有 `is_admin()` 可寫入/更新/刪除，本專案首次引入檔案上傳；顧客前台
  只信任這個 bucket 底下的網址才會渲染成 `<img>`，見 `lib/store-settings.ts`
  `resolveStoreDisplay` 的網址白名單，TASK-032 security-reviewer 審查發現）。顧客端（anon）對
  `appointments`／`customers` 沒有任何直接讀寫 policy，唯一存取路徑是兩個
  `SECURITY DEFINER` RPC：`get_available_slots`（查可預約時段，TASK-024 起同時感知
  `closed_dates` 與 `services.buffer_minutes`，TASK-048 起改讀 `booking_policy.
  min_lead_time_hours` 取代原本寫死的 1 小時提前量）、`create_appointment`（建立預約，
  含時段衝突防護與顧客去重，見 `ai/context/decisions.md` 2026-08-05 決策；提前量檢查
  同樣自 TASK-048 起改讀 `booking_policy`，最遠視野上限 90 天維持寫死不變）
- 身分驗證：Supabase Auth（email/password），僅一個設計師帳號；管理者身分用 `admins`
  表 + `is_admin()` function 判斷，不用 `authenticated` 角色（原因見
  `ai/context/decisions.md` TASK-003 決策）。`admins` 表另有 `display_name`／
  `avatar_url` 兩個個人資料欄位（TASK-038，`0007_admin_profile.sql`），讀寫透過
  `get_admin_profile`／`update_admin_profile` 兩支 `SECURITY DEFINER` RPC（不直接查
  `admins` 表，該表零 RLS policy）；大頭貼存於 Storage `admin-assets` public bucket
  （5MB、jpg/png/webp，路徑固定 `avatar/<uuid>.<ext>`）。忘記密碼／重設密碼（TASK-040）、
  帳號設定頁修改顯示名稱／大頭貼（TASK-041）、修改密碼／登入 email（TASK-042）皆已實作，
  見下方「重要目錄」`lib/admin/account.ts`／`app/admin/account/`／`app/reset-password/`。
  **已知未查證事項**：Supabase 專案的「Email 變更確認機制」設定（單重確認／雙重確認，即
  改 email 時是否連舊信箱都要收確認信）尚未在 Supabase Dashboard 人工核對——這是
  TASK-042 任務卡「未知事項」段落與 architect 審查都要求記錄查證的項目，目前
  `AccountSettingsView.tsx` 的待確認文案刻意寫得通用（不聲明「只需新信箱」或「新舊皆要」）
  以同時相容兩種設定，但若之後有人要精確描述這個流程，需要先去 Dashboard 確認。
- 測試：Vitest。`npm test` 為預設單元/煙霧測試（不連線真實服務）；
  `npm run test:rls`／`npm run test:booking`／`npm run test:admin-booking`／
  `npm run test:business-hours`／`npm run test:store-settings`／`npm run test:account` 是
  另外對真實 Supabase 專案跑的整合測試，各自獨立（見 `vitest.integration.config.ts`／
  `vitest.booking.config.ts`／`vitest.admin-booking.config.ts`／
  `vitest.business-hours.config.ts`／`vitest.store-settings.config.ts`／
  `vitest.account.config.ts`，刻意不用萬用字元互相撿到對方的測試檔），需要
  `.env.local` 的 Supabase 設定；`test:rls`／`test:admin-booking`／`test:business-hours`／
  `test:store-settings`／`test:account` 額外需要已 seed 的設計師帳密，`test:booking`
  涵蓋顧客預約流程整條路徑（含併發衝突、顧客去重、RLS 邊界，見
  `tests/booking.integration.test.ts`），`test:admin-booking` 涵蓋預約管理後台整條路徑
  （讀取權限邊界、標記完成/取消、改期 exclusion constraint、anon 直接寫入被拒，見
  `tests/admin-booking.integration.test.ts`），`test:business-hours` 涵蓋營業時間設定整條
  路徑（designer 讀寫 business_hours、anon 只能讀、受影響預約判定、`get_available_slots`
  RPC 對新設定的回應，見 `tests/business-hours.integration.test.ts`；`business_hours` 只有
  7 列固定資料，測試採「記錄原始快照、測試後還原」模式，不要對正式環境高頻率重複執行）
- 部署：Vercel

## 重要目錄

| 路徑 | 用途 | 備註 |
|---|---|---|
| `lib/supabase/` | Supabase client 封裝 | `client.ts`（瀏覽器）、`server.ts`（Server Component/Action）、`middleware.ts`（proxy 用） |
| `lib/booking/` | 顧客預約流程的 RPC／資料存取封裝 | 型別＋薄呼叫函式（`types.ts`／`api.ts`），純函式邏輯拆到 `date-range.ts`／`slot-grid.ts`／`validation.ts`／`error-messages.ts` 方便單元測試 |
| `app/_components/booking/` | 顧客前台單頁捲動流程的區塊元件 | `BookingFlow.tsx`（頁面層 state）＋品牌顯示區塊 `BrandHeaderSection.tsx`（TASK-032，讀取 `store_settings`，獨立 fetch／loading，與下方預約流程互不阻塞）＋四個區塊元件（服務列表／選時段／填寫資訊／成功頁），掛載於 `app/page.tsx`；`ContactFormSection.tsx`（TASK-049）在送出按鈕正上方用既有 `Alert severity="info"` 顯示 `booking_policy` 政策說明文字（`lib/booking/policy-text.ts` 的 `formatBookingPolicyText` 組成，讀取獨立 fetch／`.catch` 靜默降級，不阻擋既有流程） |
| `supabase/migrations/` | 版本化 schema migration（up/down 成對） | 目前無 Supabase CLI／DB 連線字串，需人工貼到 Supabase SQL Editor 執行；檔案本身寫成可重複執行 |
| `scripts/` | 一次性維運腳本 | `seed-designer-account.mjs`（建立唯一設計師帳號）、`seed-booking-data.mjs`（`business_hours`／`services` 最小可行種子資料，冪等） |
| `proxy.ts`（根目錄） | 路由層驗證第一道門 | Next.js 16 用 `proxy.ts` 取代舊的 `middleware.ts` 慣例，實際邏輯在 `lib/supabase/middleware.ts`（`updateSession`）；判斷「有沒有登入」，並自 TASK-059 起額外判斷已啟用 MFA 的帳號是否已達 `aal2`（見 `lib/auth/aal.ts`），兩者皆會導向 `/login`；`is_admin()` 授權判斷仍交給 `app/admin/layout.tsx` 與 RLS |
| `app/admin/` | 受保護的設計師後台 | `layout.tsx` 依序檢查 `getUser()`、`isAalSatisfied()`（TASK-059，已啟用 MFA 但尚未通過驗證的帳號在此被擋下，與 `lib/supabase/middleware.ts` 各自獨立檢查、縱深防禦）、`is_admin()`，皆通過才渲染；`_components/`（`AdminDashboard.tsx`／`WeekCalendar.tsx`／`AppointmentListView.tsx`／`AppointmentDetailDialog.tsx`／`BusinessHoursForm.tsx`／`ClosedDatesSection.tsx`／`StoreSettingsForm.tsx`／`ServicesTable.tsx`／`ServiceFormDialog.tsx`）為週曆/列表顯示、標記完成/取消/改期、營業時間設定表單、特殊公休日設定、商店基本資料設定（`StoreSettingsForm.tsx`：TASK-030 接上「基本資訊」編輯／驗證／儲存，TASK-031 接上「品牌圖片」`ImageUploadField` 上傳／更換／移除）、服務項目管理（`ServicesTable.tsx`：唯讀列表骨架 TASK-034、新增/編輯 Modal `ServiceFormDialog.tsx` TASK-035、下架/重新上架二次確認 TASK-036）的互動元件；`business-hours/`（`page.tsx`）為 `/admin/business-hours` 頁面骨架，掛載 `BusinessHoursForm.tsx`（內含 `ClosedDatesSection.tsx`）；`store-settings/`（`page.tsx`）為 `/admin/store-settings` 頁面骨架，掛載 `StoreSettingsForm.tsx`；`services/`（`page.tsx`）為 `/admin/services` 頁面骨架，掛載 `ServicesTable.tsx`；`booking-policy/`（`page.tsx`）為 `/admin/booking-policy` 頁面骨架（TASK-046），掛載 `BookingPolicyForm.tsx`（TASK-047 接上編輯／驗證／儲存，兩欄位＋底部單一「儲存」按鈕） |
| `lib/admin/` | 後台預約管理與營業時間設定的資料存取與純函式邏輯 | `appointments.ts`（週次查詢／單筆詳情／標記完成/取消/改期，含樂觀鎖與 23P01→SLOT_CONFLICT 轉換）、`reschedule-slots.ts`（改期表單可預約時段計算）、`week-range.ts`（週次範圍純函式，不再含公休判斷）、`business-hours.ts`（七天設定讀寫、受影響預約判定 `findAffectedAppointments`）、`closed-dates.ts`（特殊公休日讀寫、單日受影響預約判定 `findAffectedAppointmentsForClosedDate`）、`month-range.ts`（`MonthPicker` 用的月曆日期純函式）、`format.ts`（含 `formatPrice`，服務項目管理頁用）、`services.ts`（服務項目管理頁的資料存取：`listServices` 唯讀全部項目含下架中、`createService`／`updateService`／`setServiceActive`，TASK-034～036；與顧客端 `lib/booking/api.ts` 的 `getServices` 不同之處是不過濾 `is_active`） |
| `lib/store-settings.ts` | 商店基本資料（`store_settings`）的資料存取 | 放在 `lib/` 頂層而非 `lib/admin/`——顧客前台（`getStoreSettings`／`resolveStoreDisplay`，TASK-032）與後台（`updateStoreSettingsBasicInfo`／`uploadStoreImage`／`removeStoreImage`，TASK-030／031）皆會讀取，比照既有「`app/admin/*` 可 import `lib/booking/*`，但顧客前台不會 import `lib/admin/*`」的既有分層方向，避免顧客前台反向依賴後台模組；`resolveStoreDisplay` 額外把 `logo_url`／`cover_image_url` 限制為只信任 `store-assets` bucket 底下的網址才顯示，避免 RLS 只限制寫入者身分、未限制網址內容本身而讓匿名頁面被導向任意外部圖片網址（TASK-032 security-reviewer 審查發現） |
| `lib/booking-policy.ts` | 預約規則設定（`booking_policy`）的資料存取 | 放在 `lib/` 頂層而非 `lib/admin/`——理由與 `lib/store-settings.ts` 完全同類（雙邊共享的網域資料，顧客前台與後台皆會讀），架構審查於 TASK-046 明確要求比照既有分層方向；`getBookingPolicy` 查無資料一律視為錯誤（`ok:false`），與 `store_settings` 刻意回退空白值的方向相反——`booking_policy` 顯示的是直接呈現給顧客的政策文字，靜默降級會讓畫面與後端實際強制規則不一致卻無錯誤跡象；`updateBookingPolicy`（TASK-047）／`validateMinLeadTimeHours`／`validateCancelWindowHours` 供後台表單使用 |
| `components/ui/ImageUploadField.tsx` | 商店品牌圖片上傳元件 | TASK-031 新做，涵蓋預設（拖放區）／上傳中／預覽（縮圖＋更換／移除）／錯誤四態，已登記回 `design-system.md` S4 inventory；`StoreSettingsForm.tsx` 的「品牌圖片」卡片掛載兩個實例（Logo／封面圖） |
| `app/login/` | 設計師登入頁 | `login-form.tsx`（TASK-039 套用 design system；TASK-040 接上忘記密碼：同卡片內以 `mode` 狀態切換登入／忘記密碼／MFA 三種表單，`?mode=forgot-password` query param 可直接開啟忘記密碼模式，供 `/reset-password` 連結已逾時時的「重新申請」連結導回；TASK-044 接上 MFA 挑戰步驟：`signInWithPassword` 成功後呼叫 `getAuthenticatorAssuranceLevel()` 判斷是否需要 TOTP 驗證碼，需要時顯示 `OtpInput` 畫面，`mfa.challenge()`／`mfa.verify()` 驗證通過才導向 `/admin`）；`page.tsx`（伺服器端）已登入且 `is_admin()` 為真時導向 `/admin`，TASK-059 起額外要求 `isAalSatisfied()` 為真才導向——已啟用 MFA 但尚未通過驗證的帳號在此停留在登入表單，不會自動接續顯示 MFA 步驟（需重新輸入帳密），這是已核准的已知 UX 取捨，見 `ai/artifacts/設計師登入與帳號安全/task-cards/TASK-059.md` |
| `app/reset-password/` | 設計師重設密碼頁（TASK-040） | `reset-password-form.tsx`：只信任 Supabase `PASSWORD_RECOVERY` 事件判斷連結有效（不接受「有任何既有 session 就算有效」，避免已登入者略過忘記密碼流程直接改密碼），成功後 `signOut()` 並導回登入頁；已知限制：目前走 PKCE flow，忘記密碼申請與開信若不同瀏覽器/裝置會失效，見 TASK-058（backlog） |
| `app/admin/account/` | 帳號設定頁（`/admin/account`，TASK-038～043） | `page.tsx` 掛載 `_components/AccountSettingsView.tsx`：個人資料（顯示名稱／大頭貼，TASK-041）、密碼／登入 Email 修改（TASK-042，email 修改也要求先驗證目前密碼——mockup 原本只有單一 email 欄位，實作期依安全審查加上「目前密碼」欄位，見 `mockup-decision-帳號設定頁.md` 的實作期偏離紀錄）、雙重驗證 MFA（TASK-043：未啟用時可啟動 TOTP 註冊（QR Code＋`OtpInput` 6 碼驗證碼確認），已啟用時可停用；停用需輸入「目前驗證碼」而非密碼——mockup 原本畫密碼欄位，實作期對真實 Supabase 走查發現移除已驗證 factor 需要 session 處於 aal2、純密碼重新驗證的 session 只有 aal1 會被伺服器拒絕，見同一份 mockup-decision 的 TASK-043 實作期偏離紀錄與 `lib/admin/account.ts` `unenrollMfaWithPasswordAndCode` 程式碼註解）；`_components/AdminProfileContext.tsx` 是 displayName／avatarUrl／email／pendingEmail 的單一狀態來源（`app/admin/layout.tsx` 伺服器端讀取一次灌入 initial props，`refresh()` 讓 Sidebar 與本頁存檔後即時同步，不需整頁重新整理） |
| `lib/admin/account.ts` | 帳號設定頁與 Sidebar 個人資料的資料存取 | `getAdminProfile`／`updateAdminProfile`（RPC）、`uploadAdminAvatar`／`removeAdminAvatar`（Storage＋RPC）、`resolveAdminAvatarUrl`（只信任 `admin-assets` bucket 網址白名單）、`resolveAdminDisplayName`（Sidebar 預設文案）；`updateAdminPassword`／`updateAdminEmail`（TASK-042）共用私有的 `reauthenticateAdmin` 輔助函式（用 `supabase.auth.signInWithPassword` 重新驗證目前密碼，`getUser()` 現查 email 不接受呼叫端傳入），**已知限制**：這層「驗證目前密碼」完全在瀏覽器端執行，Supabase 專案預設設定下不會在伺服器端強制檢查是否剛完成 re-auth，詳細說明與取捨見該函式的程式碼註解；`listMfaFactors`／`enrollMfa`／`verifyMfaEnrollment`／`cancelMfaEnrollment`／`unenrollMfaWithPasswordAndCode`（TASK-043，Supabase Auth `mfa.*` API 薄封裝）——**重要**：停用已驗證 MFA factor 一律走驗證碼路徑，不能只靠密碼重新驗證，因為 GoTrue 要求 session 處於 aal2 才允許 `mfa.unenroll()` 移除 verified factor，`signInWithPassword` 只會建立 aal1 session（422 `insufficient_aal`），這是實測發現的伺服器端強制規則，非本專案自訂邏輯 |
| `lib/auth/password-strength.ts` | 密碼強度計算與格式驗證純函式 | `calculatePasswordStrength`、`passwordsMatch`、`MIN_PASSWORD_LENGTH`（6，對齊 Supabase 預設）、`MAX_PASSWORD_LENGTH`（72 bytes，GoTrue/bcrypt 上限），供 `PasswordStrengthMeter` 與重設密碼頁／帳號設定頁修改密碼共用 |
| `lib/auth/aal.ts` | 判斷 session 是否已滿足 Authenticator Assurance Level（TASK-059） | `isAalSatisfied(supabase, user)`：修正 TASK-044 security-reviewer 發現的 C1（登入頁 MFA 驗證碼畫面重新整理即可繞過，因為伺服器端只檢查 `is_admin()`、不檢查 aal）。**重要（第二輪安全性審查確認）**：判斷「是否啟用 MFA」的依據刻意不用 `getAuthenticatorAssuranceLevel()` 不帶 jwt 版本回傳的 `nextLevel`——那個值是從本地、未經伺服器驗證的 cookie 快取（`session.user.factors`）算出來的，可被瀏覽器端竄改 cookie 繞過（實測 PoC 已確認）；改用呼叫端本來就會呼叫的 `getUser()`（真的會打 Supabase Auth API、回傳伺服器端權威資料）取得的 `user.factors`，`currentLevel` 才用本地解碼（安全性建立在「同一個 access_token 已被上面那次 `getUser()` 驗證過」，呼叫順序不可調換）。`app/login/page.tsx`／`lib/supabase/middleware.ts`／`app/admin/layout.tsx` 三個入口點各自獨立呼叫（縱深防禦），皆為 fail closed（例外或判斷失敗一律視為未滿足）。**已知限制**：只在應用層生效，不含 RLS／`is_admin()` 層級的 aal2 強制，直接呼叫 Supabase REST/RPC 不受此保護，已登記後續任務卡（見 TASK-059 完成證據） |
| `components/ui/PasswordStrengthMeter.tsx` | 密碼強度計量條元件（TASK-040） | 弱／中／強三階，`password` 為空字串時不渲染；`/reset-password`、`/admin/account` 密碼卡片共用 |
| `app/page.tsx` | 顧客前台預約首頁 | 單頁捲動版型（S5 變體 B），見 `app/_components/booking/` |
| `ai/` | 治理流程、任務卡、審查紀錄 | 見根目錄 `AGENTS.md` |
| `tools/kanban/` | 治理看板 | `npm run kanban` |
| `lib/email/` | Email 內容組成與 Resend 薄封裝（Email 通知與提醒 Epic，TASK-051） | `resend-client.ts`（`sendEmail`，`server-only`，讀 `EMAIL_API_KEY`／`EMAIL_FROM_ADDRESS`，逾時走 `Promise.race` 而非 SDK 原生 signal，見檔案註解）；`format.ts`（`escapeHtml`／`formatAppointmentDateTime`，內插使用者輸入到 HTML 前必經 `escapeHtml`）；`templates/`（`confirmation.ts`／`cancellation.ts`／`reschedule.ts`／`reminder.ts`，純函式組 subject／html，不做 I/O）；`classify-appointment-update.ts`（UPDATE 事件分類成 cancelled／rescheduled／none 的純函式，只依賴 payload 的 status／start_at／end_at，見下方架構段落的 race condition 說明） |
| `lib/webhooks/verify-secret.ts` | webhook／cron 共用的密鑰驗證（TASK-051） | `verifySecret`（常數時間比較，先雜湊成固定長度再比較，避免長度側錄）／`verifyBearerSecret`（拆 `Bearer ` 前綴後呼叫前者，供 Vercel Cron 用） |
| `lib/admin/appointment-reminders.ts` | 提醒信排程端點的資料存取（TASK-054） | `computeReminderWindow`（純函式，0～26 小時寬視窗，見下方架構段落的 Vercel Hobby 方案限制說明）／`claimAppointmentsForReminder`（`UPDATE ... WHERE reminder_sent_at IS NULL ... RETURNING` 原子性 claim 模式，不是先 select 再逐筆 update）／`releaseReminderClaim` |
| `app/api/webhooks/appointment-events/route.ts` | Supabase Database Webhook 觸發端點（appointments INSERT／UPDATE，TASK-052／053） | 見下方「Email 通知與提醒架構」段落 |
| `app/api/cron/appointment-reminders/route.ts` | Vercel Cron 觸發端點（TASK-054） | `maxDuration = 60`／`TIME_BUDGET_MS = 45000`，逼近 serverless 執行時間上限會提前中止並釋放剩餘 claim，見下方架構段落 |

## Email 通知與提醒架構（TASK-051～055）

顧客預約成立／取消／改期／預約前 24 小時，系統各寄一封 Email 通知信（純文字告知，不含任何操作連結）。寄信一律用 Resend（`lib/email/resend-client.ts`），失敗不影響預約本身的交易（寄信是附加動作）。兩條觸發路徑分開：

- **appointments 表異動 → Database Webhook**（確認信／取消改期通知信，TASK-052／053）：
  `supabase/migrations/0011_appointments_insert_webhook.sql`（INSERT）／
  `0012_appointments_update_webhook.sql`（UPDATE）建立 trigger function，用
  `pg_net.http_post` 呼叫 `app/api/webhooks/appointment-events/route.ts`（同一支端點依
  payload 的 `type` 分派）。**INSERT** 分支用 `confirmation_sent_at` 欄位做原子性
  claim 去重（`UPDATE ... WHERE confirmation_sent_at IS NULL ... RETURNING`），寄信
  失敗會釋放回 `null` 供補寄；payload 只帶 appointment id，寄信所需欄位由 route 端用
  service role client 依 id 重新讀回（不整列外送，避免外洩 `access_token`／
  `customer_phone`）。**UPDATE** 分支不用去重欄位（pg_net 不重試，且
  `cancelAppointment`／`rescheduleAppointment` 本身有狀態機防止重複真實異動），而是
  直接信任 payload 的 `record`／`old_record`（同一次 UPDATE 語句的前後快照）分類成
  取消／改期／none 三種情境（`lib/email/classify-appointment-update.ts`）——**不能改成
  「只送 id、事後重讀資料庫當下值」**，否則同一筆預約短時間內連續兩次真實異動會被
  誤判成重複結果，見該 migration 檔頭的完整說明。
- **時間到了 → Vercel Cron**（預約前提醒信，TASK-054）：`vercel.json` 的 `crons`
  設定（`0 1 * * *` UTC，每天一次）觸發 `app/api/cron/appointment-reminders/route.ts`。
  用 `reminder_sent_at` 欄位做 claim 去重，時間窗寬度 0～26 小時（不是任務卡原本假設
  的每小時執行、23～25 小時窄窗）——**因為本專案 Vercel 帳號是 Hobby 方案，cron
  只能每天執行一次**，改用更寬的視窗；下界固定為 0（不能設更高，否則會有預約永遠
  卡在兩次執行的窗縫之間、永久漏寄，見 `lib/admin/appointment-reminders.ts` 的完整
  說明）。代價是提醒信寄送時間與「預約前 24 小時」有 0～26 小時的誤差，這是已知且
  被接受的取捨。

兩個端點的密鑰驗證共用 `lib/webhooks/verify-secret.ts`：webhook 端點比對
`x-webhook-secret` header 與 `SUPABASE_WEBHOOK_SECRET`；cron 端點比對
`Authorization: Bearer <token>` 與 `CRON_SECRET`。兩者都是常數時間比較，且環境變數
未設定時一律拒絕（fail closed）。

**正式環境設定步驟**（版控外、換 Supabase 專案或重建環境時需要重新執行；為何選擇這個
設計見 `ai/context/decisions.md` 對應決策紀錄）：

1. Vercel production 環境變數需要 `SUPABASE_WEBHOOK_SECRET`、`CRON_SECRET`、
   `EMAIL_API_KEY`、`EMAIL_FROM_ADDRESS`、`SUPABASE_SERVICE_ROLE_KEY`（皆已於本專案
   實際設定完成，`npx vercel env ls production` 可查）。
2. 部署帶正確環境變數的應用程式（`npx vercel deploy --prod --yes`）。
3. 依序套用 `supabase/migrations/0010`～`0012`（人工貼 Supabase SQL Editor 執行，比照
   本專案既有 migration 慣例）。
4. 在 Supabase SQL Editor 手動執行以下一次性指令建立 Vault 密鑰（不進版控；之後修改
   用 `vault.update_secret` 或 Dashboard Vault UI）：
   ```sql
   select vault.create_secret(
     'https://pro5-nu.vercel.app/api/webhooks/appointment-events',
     'appointment_webhook_url'
   );
   select vault.create_secret(
     '<與 Vercel SUPABASE_WEBHOOK_SECRET 完全相同的值>',
     'appointment_webhook_secret'
   );
   ```
   若這兩個 Vault 密鑰尚未設定，trigger function 會略過寄送 HTTP 請求、不阻擋
   `appointments` 的寫入本身（見 0011 migration `notify_appointment_insert()` 的判斷）。
5. Vercel Cron（`vercel.json` 的 `crons` 設定）只在 production deployment 才會被
   Vercel 自動排程觸發，不需要另外在 Dashboard 手動設定；確認方式是 Vercel
   Dashboard 專案的「Cron Jobs」頁籤出現這個排程。
6. 人工排查工具：`select * from net._http_response order by created desc limit 20;`
   （webhook 端 pg_net 實際送出的請求與回應狀態，pg_net 不會重試，非 2xx 也不會有
   自動補救）；`npx vercel logs https://pro5-nu.vercel.app`（應用程式端 runtime log）。

`EMAIL_FROM_ADDRESS` 已於 TASK-061（2026-08-25）從 Resend 沙盒地址
`onboarding@resend.dev` 換成正式網域 `zoework.fyi`（Cloudflare 購買並代管 DNS）下的
`noreply@zoework.fyi`：於 Cloudflare DNS 新增 Resend 要求的 DKIM（TXT，
`resend._domainkey`）／SPF（MX＋TXT，皆為 `send` 子網域）三筆 record 後，Resend
Dashboard 顯示 Domain Verified；已用非 Resend 帳號本人的信箱（顧客情境）實際收到
確認信驗證過，寄件人正確顯示為 `noreply@zoework.fyi`，不再受沙盒模式限制。

## 常用指令

| 指令 | 用途 | 備註 |
|---|---|---|
| `npm run dev` | 啟動本機開發伺服器 | <http://localhost:3000> |
| `npm run build` / `npm start` | 建置／啟動正式環境版本 | |
| `npm run lint` | ESLint | |
| `npx tsc --noEmit` | TypeScript 型別檢查 | |
| `npm test` | 單元/煙霧測試（Vitest） | 不連線真實 Supabase |
| `npm run test:rls` | RLS 整合測試 | 對真實 Supabase 專案跑，需要 `.env.local` 齊備 |
| `npm run test:booking` | 顧客預約流程整合測試 | 對真實 Supabase 專案跑，涵蓋 `get_available_slots`／`create_appointment` 兩個 RPC 的正確性、併發衝突防護（多輪）、顧客去重、RLS 邊界；測試資料執行後自動清除。**注意**：`appointments_no_overlap` 是不分服務的全域 exclusion constraint，測試期間會暫時佔用真實時段（已選接近 90 天視野上限的日期降低風險，見 `tests/booking.integration.test.ts` 註解）——不要對正式環境高頻率重複執行。**TASK-048 起額外耦合 `booking_policy`**：外層 `beforeAll` 記錄快照並明確設回 `min_lead_time_hours=1`（不能假設環境當下剛好是預設值），檔案最後新增的 `booking_policy` 讀取 describe 區塊會暫時把該值調成 720／3／2／5 等測試用數值，各自在 `it`／`afterEach` 內改回 1；`min_lead_time_hours` 上限 720 小時（30 天）遠小於既有 `OPEN_DATES`（+70 天起）能測出的提前量過濾效果，因此這個區塊改用「明天起最近一個營業日」的 `NEAR_TERM_OPEN_DATE`，是本檔案唯一使用近期日期而非遠期 offset 的測試群組，相對可能與正式顧客資料互相干擾 |
| `npm run test:admin-booking` | 預約管理後台整合測試 | 對真實 Supabase 專案跑，涵蓋 designer 讀取權限邊界（含 anon 被拒）、`markAppointmentCompleted`／`cancelAppointment`／`rescheduleAppointment` 對真實資料的行為（含 `appointments_no_overlap` exclusion constraint 透過 authenticated 直接 update 路徑的邊界）、anon 直接寫入 appointments 皆被拒；測試資料執行後自動清除。同樣需注意全域 exclusion constraint，測試日期已選離今天 40 天以上降低與正式資料衝突風險 |
| `npm run test:business-hours` | 營業時間與可預約時段管理整合測試 | 對真實 Supabase 專案跑，涵蓋 designer 讀寫 `business_hours`／`closed_dates`（含 anon／已登入非管理員的 authenticated 使用者皆被拒，重新確認寫入邊界）、`findAffectedAppointments`／`findAffectedAppointmentsForClosedDate` 對真實預約資料的受影響判定、`get_available_slots` RPC 於公休（`business_hours`／`closed_dates` 兩種來源）/緩衝時間（`services.buffer_minutes`）設定變更/還原後的正確回應、後台改期表單 `computeAvailableSlots` 與該 RPC 對同一組輸入產生一致判斷（TASK-027）。`business_hours` 只有 7 列固定資料（`weekday` 為 primary key），測試採「記錄原始快照（並印到終端機/CI log 供程序被強制中斷時人工還原）、測試中短暫改動、afterAll 還原」模式；`closed_dates` 沒有固定列數也沒有可掛 `TEST_MARKER` 的文字欄位，改用「記錄本次測試新增過的日期、afterAll 逐一刪除，不動測試前已存在的列」模式。**不要對正式環境高頻率重複執行**（測試期間會暫時影響顧客端可預約時段判定） |
| `npm run test:store-settings` | 商店基本資料設定整合測試 | 對真實 Supabase 專案跑，涵蓋 `store_settings` 讀寫權限邊界（anon／已登入非管理員的 authenticated 使用者皆被拒、designer 可寫、非管理員無法 insert 第二列）、`store-assets` Storage bucket 權限邊界（anon／非管理員上傳被拒、designer 可上傳且公開可讀、`allowed_mime_types` 與路徑前綴限制皆由 bucket 層強制擋下，非只靠前端驗證）。`store_settings` 只有 1 列固定資料，測試採「記錄原始快照、測試中短暫改動、afterAll 還原」模式（同 `test:business-hours`）；前台讀取降級行為（`resolveStoreDisplay` 的「哪些欄位視為未設定」判斷）改由 `tests/store-settings.test.ts` 的單元測試涵蓋，不重複放進本整合測試。**不要對正式環境高頻率重複執行** |
| `npm run test:booking-policy` | 預約規則與政策設定整合測試（TASK-046） | 對真實 Supabase 專案跑，涵蓋 `booking_policy` 讀寫權限邊界（anon 可讀、anon／已登入非管理員的 authenticated 使用者皆被拒寫入、designer 可寫、非管理員無法 insert 第二列、`min_lead_time_hours` 超出 720 被 constraint 擋下）。`booking_policy` 只有 1 列固定資料，測試採「記錄原始快照、測試中短暫改動、afterAll 還原」模式（同 `test:business-hours`／`test:store-settings`）。調整 `min_lead_time_hours` 後 `get_available_slots`／`create_appointment` 的實際行為改由 `test:booking` 涵蓋（見下方說明），不在本測試檔重複 |
| `npm run test:services` | 服務項目管理整合測試 | 對真實 Supabase 專案跑，涵蓋 `services` 讀寫權限邊界（anon／已登入非管理員的 authenticated 使用者皆被拒新增/編輯/切換上下架、designer 可寫、anon 讀不到已下架項目）、下架後 `get_available_slots`（回傳空陣列）／`create_appointment`（`SERVICE_INACTIVE`，不寫入任何資料）的實際影響、重新上架後兩個 RPC 恢復正常。`services` 非固定列數，測試建立的服務項目一律加 `TEST_MARKER` 前綴並於 `afterAll` 真刪除（測試自己清理測試資料，不牴觸後台 UI 層「只做下架不支援真刪除」的產品範圍決策，兩者性質不同）。測試日期選離今天 84 天起（見下方 offset 表） |
| `npm run test:account` | 設計師登入與帳號安全整合測試（TASK-045） | 對真實 Supabase 專案跑，涵蓋 `get_admin_profile`／`update_admin_profile` RPC 權限邊界（designer 可讀寫、非管理員回傳空結果集／`false`、anon 明確被 revoke）、`admin-assets` Storage bucket 權限邊界（同 `test:store-settings` 的驗證方式：anon／非管理員上傳被拒、designer 可上傳且公開可讀、mime type／路徑前綴限制皆由 bucket 層強制擋下）、`mfa.enroll`／`challenge`／`verify`／`unenroll` 呼叫行為（含驗證碼錯誤被拒、正確驗證碼成功並將 factor 轉為 verified、verified factor 需要 aal2 才能 unenroll 的既有 GoTrue 行為）。個人資料測試用 designer001 本人（`admins` 表快照還原模式，同 `test:store-settings`）；MFA 測試刻意改用 service role 建立的拋棄式 authenticated 使用者，不動 designer001 的真實 MFA 狀態，避免與人工手動走查（真實 Authenticator App）互相干擾；TOTP 驗證碼用 Node.js 內建 `crypto` 模組自行實作 RFC 6238，未新增任何 npm 依賴。**不要對正式環境高頻率重複執行** |
| `npm run test:notifications` | Email 通知與提醒前後端串接整合測試（TASK-055） | 對真實 Supabase 專案跑，`sendEmail`（Resend）全程 mock（見 `tests/notifications.integration.test.ts` 頂端說明，任務卡「假設」段落明訂自動化測試不寄真實信件），驗證真正的 webhook／cron route handler 對真實資料庫的密鑰驗證、INSERT/UPDATE 事件正確分派（確認/取消/改期/標記完成四種情境）、`confirmation_sent_at` 去重、排程端點時間窗篩選與 `reminder_sent_at` 去重。**排程端點測試會呼叫真正的 GET handler，其查詢涵蓋整張 `appointments` 表（不限本檔案建立的測試資料）**，採「執行前快照當下符合條件的既有 id、執行後在 `finally` 還原回 `null`」模式，把對真實顧客資料的影響限制在測試執行的短暫期間內；若執行過程被強制中斷，需要人工檢查是否有非本檔案建立的預約被意外標記為已提醒。四種信件的真實送達驗證是**人工**步驟（見 `ai/artifacts/Email 通知與提醒/task-cards/TASK-055.md` 完成證據），不併入本指令 |

各整合測試檔案的測試日期都用「離今天 N 天以上」的 offset 找不同星期幾，刻意錯開彼此的日期範圍避免互相干擾（`test:business-hours` 第一批次用 55 天起、第二批次（`closed_dates`／`buffer_minutes`，TASK-027）用 58／65 天起、`test:admin-booking` 用 40 天起、`test:booking` 用 70 天起（9 個營業日，實際涵蓋約 70～81 天）、`test:services` 用 84 天起）；同一個 offset 下也要用不同星期幾（同一天內的不同時段錯開亦可，見 `tests/business-hours.integration.test.ts` 對 `SLOTS_DATE` 的既有教訓：兩個不同 describe 共用同一天時，appointments_no_overlap 是不分服務的全域 exclusion constraint，插入的既有預約時段必須手動錯開，不能想當然爾各自用 11:00 起始）。新增下一個以真實 Supabase 資料為基礎的整合測試檔案或案例時，選 offset／時段前先看一下這幾個既有檔案目前用的範圍，避免撞期。`test:store-settings` 不涉及日期時段（`store_settings`／`store-assets` 皆與日期無關），不需要 offset。
| `npm run seed:designer` | 建立唯一設計師帳號 | 讀 `.env.local` 的 `DESIGNER_EMAIL`／`DESIGNER_PASSWORD`，具幂等性 |
| `npm run seed:booking` | seed `business_hours`／`services` 最小可行資料 | 冪等，對真實 Supabase 專案寫入 |
| `npm run kanban` | 啟動治理看板 | <http://127.0.0.1:4420> |
