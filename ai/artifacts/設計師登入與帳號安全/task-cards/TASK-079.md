# AI-Ready 任務卡

## Metadata

- 任務：設計師登入與帳號安全 資料庫層強制 MFA：已啟用 MFA 的帳號，`is_admin()` 需要 aal2 才回傳 true
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：設計師登入與帳號安全
- 上層 User Story：設定雙重驗證（MFA）
- 分軌：後端
- 前置任務（dependsOn）：TASK-043, TASK-044, TASK-059
- 狀態：就緒（人工已於 2026-10-21 核准；排在多位設計師 Epic 之前）
- 風險等級：高（修改所有後台寫入權限共用的 `is_admin()`；做錯會讓店長被鎖在後台外，或讓保護失效）
- Agent owner：Claude Code
- 人工核准者：使用者

## 目標

修正 TASK-059 完成證據登記的 **[High]** 殘留風險（合併 TASK-043 已知限制 H1）：目前 aal2 檢查只在 Next.js 的
三個入口點生效。已啟用 MFA、但只輸入帳密（aal1）的 session，直接呼叫 Supabase REST／RPC／Storage API 仍然可以
讀寫全部後台資料。本卡讓這個保護在資料庫層生效。

## 情境包（Context Pack）

- 相關檔案：
  - `supabase/migrations/0001_core_schema.sql`（`is_admin()` 定義：`stable security definer set search_path = ''`，
    只檢查 `admins` 表有沒有 `auth.uid()`）
  - 所有呼叫 `is_admin()` 的地方（`grep -rn "is_admin()" supabase/migrations`）：`0001`、`0002`、`0003`、`0006`、
    `0007`（含 `get_admin_profile`／`update_admin_profile` 與 `admin-assets` Storage policy）、`0008`、`0015`
  - `lib/auth/aal.ts`（應用層判斷：`user.factors` 有 verified factor 時要求 `currentLevel === "aal2"`）
  - `app/admin/layout.tsx`、`app/login/page.tsx`、`lib/supabase/middleware.ts`（三個應用層入口點）
  - `ai/artifacts/設計師登入與帳號安全/task-cards/TASK-059.md`（「已知限制」與「後續任務」）
  - `tests/rls.integration.test.ts`、`tests/account.integration.test.ts`（用拋棄式使用者測試 `mfa.enroll`／`verify` 的既有做法）
- 既有模式：改函式用 `create or replace`，簽名不變，所有既有 policy 自動套用；migration 可重複執行、up/down 成對。
- 假設（技術做法，依 Supabase 官方建議的 RLS MFA 模式）：

  ```sql
  create or replace function public.is_admin()
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
  as $$
    select exists (select 1 from public.admins where user_id = auth.uid())
      and (
        coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
        or not exists (
          select 1 from auth.mfa_factors f
          where f.user_id = auth.uid() and f.status = 'verified'
        )
      );
  $$;
  ```

  - 判斷「是否啟用 MFA」以資料庫 `auth.mfa_factors` 為準（伺服器端權威資料），與 `lib/auth/aal.ts` 不信任本地
    cookie 快取的原則一致。`aal` 取自已驗簽的 JWT。
  - 只改這一支函式：所有 RLS policy、Storage policy、`SECURITY DEFINER` RPC 都透過它判斷，改一處全部生效。
    多位設計師 Epic 新增的資料表也用 `is_admin()`，會自動受到保護。
  - MFA 註冊流程不受影響：註冊中的 factor 狀態是 `unverified`，不算「已啟用」；`mfa.verify()` 成功後 Supabase
    會換發 aal2 session。
- 未知事項（實作第一步先查，結果回報後才繼續）：
  - **designer001（唯一正式管理員）目前有沒有 verified MFA factor**。如果有，套用後所有整合測試用帳密登入的
    designer001 session 都是 aal1，`is_admin()` 會變成 false，現有 `test:rls`／`test:admin-booking` 等管理員
    案例會全部失敗。這時要請人工決定：(a) 測試期間暫時停用 designer001 的 MFA；(b) 測試改成在登入後用 TOTP
    升級到 aal2（需要測試能取得 factor secret，目前沒有）；(c) 另建一個不啟用 MFA 的測試用管理員帳號（會改變
    「只有一個管理員」的既有前提，需要評估）。
  - `auth.mfa_factors` 在 `security definer`（擁有者 `postgres`）函式內可讀，預期可行，先在 SQL Editor 驗證。
- 允許變更的檔案：
  - `supabase/migrations/0016_is_admin_require_aal2.sql`、`0016_is_admin_require_aal2_down.sql`（新增；人工已決定
    本卡排在多位設計師 Epic 之前，多位設計師的 migration 順延為 `0017`／`0018`）
  - `tests/mfa-rls.integration.test.ts`、`vitest.mfa-rls.config.ts`（新增）、`package.json`（新增 `test:mfa-rls`）
  - `ai/context/decisions.md`（新增決策）、`ai/context/project-map.md`（身分驗證段落更新 `is_admin()` 說明）
  - `ai/artifacts/設計師登入與帳號安全/task-cards/TASK-059.md`（在「後續任務」註記已由 TASK-079 處理，不改其他內容）
- 不得觸碰：`lib/auth/aal.ts` 與三個應用層入口點（維持縱深防禦，不因資料庫層有檢查就移除）；任何個別 RLS policy
  的定義（只改 `is_admin()`）；`admins` 表結構。

## 需求

- WHEN 帳號沒有 verified MFA factor THE SYSTEM SHALL 讓 `is_admin()` 行為與現在相同（aal1 即可）。
- WHEN 帳號有 verified MFA factor 且 session 為 aal1 THE SYSTEM SHALL 讓 `is_admin()` 回傳 false，所有依賴它的
  讀寫（資料表、RPC、Storage）都被拒絕。
- WHEN 同一帳號完成 TOTP 驗證、session 為 aal2 THE SYSTEM SHALL 讓 `is_admin()` 回傳 true。
- WHEN 非管理員（不在 `admins` 表）THE SYSTEM SHALL 不論 aal 都回傳 false（行為不變）。

## 驗收標準

- 新增整合測試證明上面四種情境（含「aal1 直接呼叫 PostgREST 更新 `services`、呼叫 `update_admin_profile`、
  上傳 `admin-assets`」三種繞過路徑都被拒絕）。
- 既有全部整合測試套件回歸通過（處理方式依「未知事項」的人工決定）。
- 真實走查：已啟用 MFA 的帳號登入 → 輸入 TOTP → 後台各頁正常；只輸入帳密時無法進入後台（應用層既有行為不變）。
- `_down` 可還原成原本的 `is_admin()`。

## 實作備註

- 測試做法：用 service role 建立拋棄式使用者並暫時加入 `admins`，用 `mfa.enroll` 取得 secret、在測試內計算 TOTP
  完成 `verify`，再分別以 aal1（重新用帳密登入）與 aal2（challenge＋verify）的 session 驗證；`afterAll` 一定刪除
  `admins` 列與使用者。**風險**：測試期間正式資料庫會短暫存在第二個管理員（隨機密碼、僅測試程式持有），
  `afterAll` 失敗時要能手動清除，清除方式寫在測試檔頭。
- 套用時機：店長若正處於已啟用 MFA、但只是 aal1 的 session，套用後會立即失去後台權限，需要重新登入並完成 TOTP，
  屬於預期行為。

## 驗證契約

- 單元測試：不適用（純 SQL 函式）。
- 整合測試：`npm run test:mfa-rls`（四種情境＋三種繞過路徑）；既有 `test:rls`、`test:admin-booking`、
  `test:business-hours`、`test:store-settings`、`test:booking-policy`、`test:services`、`test:account` 回歸。
- E2E 測試：Browser 走查啟用 MFA 的登入流程。
- 型別檢查：`npx tsc --noEmit`
- Lint：`npm run lint`
- Build：`npm run build`
- 螢幕截圖：MFA 登入後進入後台。
- 安全性檢查：security-reviewer 審查函式邏輯、`auth.jwt()` 來源可信度、`search_path`、測試建立暫時管理員的清理機制；
  test-engineer 審查回歸範圍。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：
- 已知限制：
- 後續任務：
