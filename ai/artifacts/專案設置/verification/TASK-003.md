# 驗證報告

## 摘要

- 任務：TASK-003 核心資料模型與認證框架基礎
- 結果：通過
- 驗證者：實作 agent（Claude Code）+ `architect`／`security-reviewer`／`test-engineer` 子代理
  （Phase 4 計畫審查各一次、Phase 8 實作審查 `architect`／`security-reviewer` 各再一次）

## 指令

| 指令 | 結果 | 備註 |
|---|---|---|
| `npx tsc --noEmit` | 通過 | |
| `npm run lint` | 通過 | |
| `npm run build` | 通過 | `proxy.ts` 無 deprecation 警告；`/admin`、`/login` 正確產出為動態路由 |
| `npm test`（預設） | 通過（1/1） | 確認 `tests/rls.integration.test.ts` 未被排入（`vitest.config.ts` 已排除） |
| `npm run seed:designer` | 通過 | 建立唯一設計師帳號並登記進 `admins` 表，幂等，密碼未印出 |
| `npm run test:rls`（對真實 Supabase 專案） | 通過（8/8） | 見下方測試明細 |
| 瀏覽器手動驗證（Claude Browser 工具） | 通過 | 見「UI 證據」 |

## 測試明細（`npm run test:rls`）

| 案例 | 結果 |
|---|---|
| anon 可讀取啟用中的 service，讀不到未啟用的 | ✓ |
| anon 讀不到 appointments 表任何資料 | ✓ |
| anon 讀不到 customers 表任何資料 | ✓ |
| anon 可以新增預約（只填允許欄位，status/access_token 吃預設值） | ✓ |
| anon 新增預約時指定未啟用的 service_id 會被拒絕 | ✓ |
| anon 無法自行指定 status 欄位（欄位層級權限阻擋） | ✓ |
| 設計師帳密登入後可讀取 appointments 與 customers 全部資料 | ✓ |
| 錯誤密碼登入會失敗、不取得 session | ✓ |

## UI 證據

螢幕截圖工具本次逾時（Browser pane 未顯示，與 TASK-001 相同的已知限制），改用
`window.location.href` 與 `get_page_text` 取得渲染後內容作為佐證：

- 未登入訪問 `/admin` → 導向 `/login`，顯示登入表單。
- 一次性拋棄式設計師帳號登入（非真實 `DESIGNER_PASSWORD`）→ 導向 `/admin`，顯示
  「已登入：<email>」＋登出按鈕；點登出 → 導向回 `/login`。
- 錯誤密碼登入 → 停在 `/login`，顯示「帳號或密碼錯誤，請再試一次。」
- 已登入設計師直接訪問 `/login` → 導向 `/admin`。
- 一次性拋棄式**非管理者**帳號（已登入但未登記進 `admins`）→ 訪問 `/admin` 被 `is_admin()`
  擋下導回 `/login`，且 `/login` 不再把它導去 `/admin`（驗證無限重導迴圈已修復）。
- 所有測試用拋棄式帳號皆已刪除，`admins` 表最終只剩 1 筆（真實設計師帳號）。

## 審查發現

| 發現 | 嚴重程度 | 階段 | 狀態 |
|---|---|---|---|
| 初版計畫用 `authenticated` 角色代表設計師身分，任何自行註冊帳號都能拿到全部顧客 PII 讀寫權 | Critical | Phase 4（計畫） | 已修復：改用 `admins` 表（RLS 啟用、零 policy）+ `is_admin()`（SECURITY DEFINER），見 `ai/context/decisions.md` |
| `appointments` 的 anon INSERT 原本 `with check (true)`，可任意設定 status／access_token／過去時間／未啟用 service | High | Phase 4（計畫） | 已修復：欄位層級 GRANT 限制 anon 可寫欄位＋收緊 `WITH CHECK` |
| 整合測試若放進預設 `npm test`，會讓每個開發者/CI 意外連線真實 Supabase 專案 | Medium | Phase 4（計畫） | 已修復：獨立 `npm run test:rls` + 專屬 vitest config，預設 `npm test` 排除 |
| `app/admin/page.tsx` 只檢查「有沒有登入」，沒呼叫 `is_admin()`，任何自行註冊帳號能看到 `/admin` 外殼 | High | Phase 8（實作） | 已修復：補上 `supabase.rpc("is_admin")` 二次確認 |
| `appointments` 的「anyone can create pending appointment」policy 原本 `to anon, authenticated`，讓非管理者已登入帳號能繞過欄位權限寫入任意 access_token/customer_id | Medium | Phase 8（實作） | 已修復：收斂為只給 `anon`；已請使用者重新執行一次 migration 並以 `npm run test:rls` 重新驗證通過 |
| `0001_core_schema_down.sql` 的 `drop policy if exists ... on <table>` 在表不存在時仍會噴錯 | Low | Phase 8（實作） | 已修復：改用 `drop table if exists ... cascade` |
| 修 `app/admin/page.tsx` 的 High 發現時，`/login`（登入即導向 `/admin`）與 `/admin`（非管理者導回 `/login`）疊加造成無限重導迴圈 | High（自行發現） | 修復過程中自行測出並修復 | 已修復：`/login` 只在確認 `is_admin()` 為真時才導向 `/admin`；已用拋棄式非管理者帳號重現問題並驗證修好 |

## 殘留風險

- Migration 目前靠人工貼到 Supabase SQL Editor 執行，沒有 CLI／CI 自動套用；下次 schema
  變更前建議評估導入 Supabase CLI（需要額外的 Personal Access Token）。
- 尚未在 Supabase 後台手動關閉公開註冊／開啟 leaked-password protection（防禦縱深層，非
  安全邊界必要條件——`is_admin()` 已確保自行註冊帳號進不了 `/admin`、讀不到 RLS 保護的資料，
  但建議仍找時間到後台補上這兩個設定）。
- `access_token` 自助查詢與顧客去重故意未實作，留給未來預約流程 Epic 用 SECURITY DEFINER
  RPC function 處理（決策記錄於 `ai/context/decisions.md`）。
- 目前只有一個 Supabase 專案（開發/正式共用），`npm run test:rls` 會對它寫入/刪除測試資料
  （皆有清除機制）；未來若有正式環境流量，建議切出獨立測試專案。
- `proxy.ts` 目前只保護 `/admin/:path*`；未來新增其他需要驗證的路由（如伺服器端 API
  route）需各自確認有對應保護，不能假設 matcher 會自動涵蓋。
