# AI-Ready 任務卡

## Metadata

- 任務：核心資料模型與認證框架基礎
- 上層規格：無（Epic 0 基礎工程）
- 上層 Epic：專案設置
- 上層 User Story：核心資料模型與認證框架基礎
- 分軌：後端
- 前置任務（dependsOn）：無（實際執行順序建議在 TASK-001、TASK-002 之後）
- 狀態：就緒
- 風險等級：高
- Agent owner：待指定
- 人工核准者：待指定

## 目標

在 Supabase 建立服務項目、預約、顧客三張核心資料表與對應的 RLS（Row Level Security）規則，並建立單一設計師帳號的登入認證機制與後台路由保護基礎。

## 情境包（Context Pack）

- 相關檔案：
  - Supabase migration／schema 定義檔、`lib/supabase/*`、Next.js middleware（保護 `/admin` 路由）。
- 既有模式：
  - 無（全新資料模型）。
- 假設（初版欄位，實作時可依需要微調並記錄變更）：
  - `services`：id, name, description, price, duration_minutes, is_active, sort_order, created_at
  - `appointments`：id, service_id, customer_name, customer_phone, customer_email, start_at, end_at, status（pending/confirmed/completed/cancelled）, access_token（供顧客自助查詢使用）, created_at, updated_at
  - `customers`：id, name, phone, email, notes, created_at（以 phone 或 email 去重識別）
  - 設計師帳號使用 Supabase Auth 內建機制，不需自建使用者表，僅需建立唯一一個設計師帳號並設定對應 RLS 政策。
- 未知事項：
  - 無。
- 允許變更的檔案：
  - Supabase schema／migration、`lib/supabase/*`、`middleware.ts`（或等效路由保護機制）。
- 不得觸碰：
  - 尚未存在的其他 Epic 功能程式碼。

## 需求

- 建立 `services`、`appointments`、`customers` 三張資料表（含必要索引，如 `appointments.start_at`）。
- 設定 RLS 政策：
  - 顧客（匿名／未登入）可讀取啟用中的服務項目、可新增預約，但不可讀取其他顧客的預約或個人資料。
  - 設計師（已登入）可讀寫全部資料。
- 建立 Supabase Auth email/password 登入機制，建立唯一設計師帳號。
- 建立 Next.js middleware（或等效機制），未登入訪問 `/admin` 相關路由時導向登入頁。

## 驗收標準

- 資料表結構可透過 migration 重建（有版本化的 schema 定義）。
- RLS 必須實際啟用並生效（不能只是規劃未執行）：README／`.env.example` 中「anon key 受 RLS 限制」的說法要在此任務落地成真，而非僅為文件宣稱（TASK-002 安全審查的 carry-forward 事項）。
- RLS 政策經測試驗證：以匿名角色查詢無法讀取到他人 `appointments` 或 `customers` 資料。
- 設計師可用帳密登入取得 session。
- 未登入直接訪問後台路由會被導向登入頁，登入後可正常進入。

## 實作備註

- 高風險項目：涉及身分驗證、資料庫 schema 與 RLS，需經架構審查與安全性審查（`ai/process/review-gates.md`）。
- 之後所有涉及預約／服務／顧客資料的功能 Epic，皆以本任務建立的 schema 為基礎，不得另立平行資料模型。

## 驗證契約

- 單元測試：不適用（無業務邏輯函式）。
- 整合測試：RLS 政策測試（以匿名與已登入兩種角色分別測試可讀寫範圍）。
- E2E 測試：登入流程、未登入訪問後台被導向登入頁。
- 型別檢查：`tsc --noEmit` 成功。
- Lint：`npm run lint` 成功。
- Build：`npm run build` 成功。
- 螢幕截圖：登入頁、登入後導向後台首頁（或暫代頁面）。
- 安全性檢查：`ai/checklists/security-checklist.md` 逐項確認，特別是 RLS 與認證章節。

## 完成證據

實作前已請 architect／security-reviewer／test-engineer 三個子代理審查計畫（Phase 4 架構關卡），
併入必要修正後才動工；實作完成後又針對實際 diff 再跑一次 security-reviewer／architect 審查
（Phase 8 審查關卡），發現並修正了計畫審查沒抓到的兩個實作缺口（見「審查發現與修正」）。

- 變更的檔案：
  - `supabase/migrations/0001_core_schema.sql`、`0001_core_schema_down.sql`（新增，schema／RLS／`is_admin()`／回滾）
  - `lib/supabase/client.ts`、`server.ts`、`middleware.ts`（新增）
  - `proxy.ts`（新增，根目錄；Next.js 16.3 用 `proxy.ts` 取代舊的 `middleware.ts` 慣例）
  - `app/login/page.tsx`、`app/login/login-form.tsx`、`app/admin/page.tsx`、`app/admin/logout-button.tsx`（新增）
  - `scripts/seed-designer-account.mjs`（新增，一次性建立唯一設計師帳號）
  - `tests/rls.integration.test.ts`（新增）、`vitest.config.ts`（修改，排除整合測試）、`vitest.integration.config.ts`（新增）
  - `package.json`（新增 `@supabase/supabase-js@2.112.0`、`@supabase/ssr@0.12.4`〔版本鎖定〕、`test:rls`／`seed:designer` script）、`package-lock.json`
  - `.env.example`（新增 `DESIGNER_EMAIL`／`DESIGNER_PASSWORD` 說明）
  - `.env.local`（新增，已確認被 `.gitignore` 排除，內含真實金鑰與設計師帳密，不進版控）
  - `ai/context/decisions.md`、`ai/context/project-map.md`（補上本任務的架構決策與專案地圖）
  - `.claude/launch.json`（新增，供瀏覽器驗證用的本機 dev server 設定）
  - 已刪除 `.env.local.example`（內容已完整併入 `.env.local`，留著是重複的金鑰外洩面）

- 執行過的指令：
  - `npm install @supabase/supabase-js @supabase/ssr`
  - `npx tsc --noEmit` — 通過
  - `npm run lint` — 通過（無輸出即無錯誤）
  - `npm run build` — 通過（`proxy.ts` 無 deprecation 警告，`/admin`、`/login` 皆正確產出為動態路由）
  - `npm test`（預設）— 1 個測試通過，**確認不含** `tests/rls.integration.test.ts`（已用 `vitest.config.ts` 的
    `exclude` 排除，避免每個開發者/CI 意外連線真實 Supabase 專案）
  - `npm run seed:designer` — 成功建立唯一設計師帳號並登記進 `admins` 表（幂等，密碼全程未印出）
  - `npm run test:rls` — 對真實 Supabase 專案執行，8 個測試全過（見下方測試輸出）

- 測試輸出（`npm run test:rls`，對真實 Supabase 專案）：
  - ✓ anon 可讀取啟用中的 service，讀不到未啟用的
  - ✓ anon 讀不到 appointments 表任何資料
  - ✓ anon 讀不到 customers 表任何資料
  - ✓ anon 可以新增預約（只填允許的欄位），且 `status`／`access_token` 吃到資料庫預設值
  - ✓ anon 新增預約時指定未啟用的 service_id 會被拒絕
  - ✓ anon 無法自行指定 status 欄位（欄位層級權限阻擋）
  - ✓ 設計師帳密登入後可讀取 appointments 與 customers 全部資料
  - ✓ 錯誤密碼登入會失敗、不取得 session
  - 8 個測試檔案內測試全部通過（Test Files 1 passed、Tests 8 passed）

- 瀏覽器驗證（用 Claude Browser 工具；螢幕截圖功能本次逾時，同 TASK-001 的已知限制，改用
  `window.location.href` 與 `get_page_text` 取得渲染內容作為佐證，證據等同但非圖片格式）：
  - 未登入直接訪問 `/admin` → 正確導向 `/login`（顯示登入表單）。
  - 用一次性拋棄式設計師帳號（非真實 `DESIGNER_PASSWORD`，避免密碼出現在對話紀錄）登入 → 導向
    `/admin`，正確顯示「已登入：<email>」與登出按鈕；點登出 → 導向回 `/login`。
  - 錯誤密碼登入 → 停在 `/login` 並顯示「帳號或密碼錯誤，請再試一次。」（不透露帳號是否存在）。
  - 已登入的設計師直接訪問 `/login` → 正確導向 `/admin`。
  - 用一次性拋棄式**非管理者**帳號（已登入但未登記進 `admins` 表）驗證：訪問 `/admin` 被
    `is_admin()` 擋下導回 `/login`；`/login` 不會再把這個非管理者導去 `/admin`（避免與
    `/admin` 的導向互相形成無限迴圈——這是 Phase 8 審查後修正的問題，見下）。
  - 所有測試用的拋棄式帳號皆已於驗證後刪除（`auth.admin.deleteUser`，`admins` 表因
    `on delete cascade` 一併清除），確認最終 `admins` 表只剩 1 筆（真實設計師帳號）。

- 審查發現與修正（Phase 4 計畫審查 + Phase 8 實作審查，皆已修正）：
  - **Critical（計畫階段抓到）**：初版計畫用 `authenticated` 角色代表設計師身分，任何自行註冊
    的帳號都會拿到全部顧客 PII 讀寫權；改為 `admins` 表（RLS 啟用、零 policy）+
    `is_admin()`（SECURITY DEFINER）。
  - **High（實作階段抓到）**：`app/admin/page.tsx` 一開始只檢查「有沒有登入」，沒有呼叫
    `is_admin()`，讓已登入但非管理者的帳號能看到 `/admin` 頁面外殼；已補上
    `supabase.rpc("is_admin")` 二次確認。
  - **Medium（實作階段抓到）**：`appointments` 的「anyone can create pending appointment」
    INSERT policy 原本 `to anon, authenticated`，讓非管理者但已登入的帳號能繞過欄位權限限制
    寫入任意 `access_token`／`customer_id`；已收斂為只給 `anon`（設計師本身由「admin full
    access」policy 涵蓋）。**此修正需要在 Supabase SQL Editor 重新執行一次
    `0001_core_schema.sql`（已請使用者執行並以 `npm run test:rls` 重新驗證通過）。**
  - **自己在修 High 那項時新增的迴歸（我自己抓到並修掉）**：讓 `/login` 對已登入使用者一律
    導向 `/admin`、`/admin` 對非管理者一律導回 `/login`，兩者疊加會對「已登入但非管理者」的
    帳號形成無限重導迴圈；修正為 `/login` 只在確認 `is_admin()` 為真時才導向 `/admin`，已用
    拋棄式非管理者帳號實際重現問題並驗證修好。
  - Architect 另指出 `0001_core_schema_down.sql` 原本的 `drop policy if exists ... on
    <table>` 若表本身不存在會噴錯；已改為 `drop table if exists ... cascade` 讓回滾腳本
    在各種情境下都安全可重跑。

- 安全檢查（對照 `ai/checklists/security-checklist.md`）：
  - 權限控管：以身分（`admins` 表 + `is_admin()`）而非角色判斷管理者，RLS 為主要邊界，
    `proxy.ts`／頁面內 `getUser()`／`is_admin()` 為應用層防禦縱深，不是唯一邊界。
  - 密鑰：`.env.local` 已確認被 `.gitignore` 排除；service role key／設計師密碼從未寫死在
    程式碼或印在任何 log／對話紀錄中；seed script 與整合測試皆從環境變數讀取。
  - 密碼：Supabase Auth 內建雜湊儲存；seed script 額外要求本機設定的密碼至少 12 碼。
  - 注入風險：所有查詢皆透過 supabase-js 參數化呼叫，無手刻 SQL 字串拼接。
  - 輸入驗證／授權邊界：`appointments` INSERT 用 RLS `WITH CHECK` + 欄位層級 GRANT 限制
    anon 可寫欄位與可設定的值；已用整合測試驗證兩者實際生效。
  - 供應鏈：新增的兩個 Supabase 套件版本鎖定（無 `^`），與既有 `next`/`react` 慣例一致。
  - 遷移／回滾：migration 具幂等性（`if not exists`／`drop ... if exists`／
    `create or replace`），另附可重跑的 down migration。

- 已知限制／殘留風險：
  - Migration 目前靠人工貼到 Supabase SQL Editor 執行，沒有 CLI／CI 自動套用；下一次
    schema 變更前建議評估導入 Supabase CLI（需要額外的 Personal Access Token）。
  - 尚未在 Supabase 後台手動關閉公開註冊／開啟 leaked-password protection（防禦縱深層，
    非安全邊界必要條件——`is_admin()` 已確保即使有人自行註冊也進不了 `/admin`、讀不到
    RLS 保護的資料，但建議仍請使用者找時間到後台補上這兩個設定）。
  - `access_token` 自助查詢與顧客去重故意未實作，留給未來預約流程 Epic 用 RPC function
    處理（決策記錄於 `ai/context/decisions.md`）。
  - 目前只有這一個 Supabase 專案（開發/正式共用），`npm run test:rls` 會對它寫入/刪除測試
    資料（皆有 `try/finally` 風格的 `afterAll` 清除）；未來若有正式環境流量，建議切出獨立的
    測試專案。
  - `proxy.ts` 目前只保護 `/admin/:path*`；未來若新增其他需要驗證的路由（如伺服器端 API
    route），需要各自確認有對應保護，不能假設 `proxy.ts` 的 matcher 會自動涵蓋。

- 後續任務：所有功能 Epic（服務項目管理、預約流程、顧客管理）皆以本任務建立的 schema／
  `is_admin()` 機制為基礎；下一個直接依賴的是任務卡列出的「所有涉及預約／服務／顧客資料的
  功能 Epic」。等待人工核准後才將看板卡片推進到 Done。
