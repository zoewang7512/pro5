# AI-Ready 任務卡

## Metadata

- 任務：Demo 體驗帳戶 架構基礎：Demo 識別、設定與 isDemo 貫穿後台外殼
- 上層規格：[`feature-spec.md`](../feature-spec.md)；架構筆記：[`architecture-notes.md`](../architecture-notes.md)
- 上層 Epic：Demo 體驗帳戶
- 上層 User Story：建立與標記 Demo 帳戶
- 分軌：不適用
- 前置任務（dependsOn）：「專案設置」Epic 全部卡片（TASK-001～TASK-009）
- 狀態：草稿（待人工核准）
- 風險等級：低
- Agent owner：Claude Code
- 人工核准者：待使用者核准

## 目標

建立「是不是 Demo」與「Demo 設定」的單一事實來源，並讓 `isDemo` 一路貫穿到後台外殼，讓後續各卡共用，不再各自判斷。

## 情境包（Context Pack）

- 相關檔案：
  - `app/admin/layout.tsx`（已在伺服器端取得 `user`）
  - `app/admin/_components/AdminProfileContext.tsx`
  - `app/admin/_components/AdminShell.tsx`
  - `lib/supabase/service-role.ts`（`server-only` 的寫法範例）
  - `.env.example`
- 既有模式：`server-only` 模組標記（`lib/supabase/service-role.ts`）；Provider 以 props 灌入初始值（`AdminProfileContext`）。
- 假設：
  - Demo 識別只認 `app_metadata.is_demo === true`（見架構筆記 D1）。
  - `DemoNotice` 先建立只回傳 `null` 的空殼，TASK-105 才填入實作，避免兩張卡同時改 `AdminShell`。
- 未知事項：
  - 無。
- 允許變更的檔案：
  - `lib/demo/config.ts`（新增，`server-only`：`isDemoUser`、`getDemoConfig`、`isDemoEntryEnabled`、`DEMO_RESET_LABEL`）
  - `lib/demo/notice-copy.ts`（新增：說明視窗與橫幅的文案常數與 `DEMO_RESET_LABEL`，單一來源，**不含 `server-only`**，因為前端元件要匯入）
  - `app/admin/layout.tsx`（讀 `user.app_metadata` 傳 `isDemo`）
  - `app/admin/_components/AdminProfileContext.tsx`（新增選填 `isDemo`，預設 false）
  - `app/admin/_components/AdminShell.tsx`（在 `main` 頂端掛 `<DemoNotice />`）
  - `app/admin/_components/DemoNotice.tsx`（新增空殼）
  - `.env.example`（加入 `DEMO_ENABLED`、`DEMO_EMAIL`、`DEMO_PASSWORD`、`DEMO_RATE_LIMIT_SECRET`、`DEMO_RESET_ENABLED` 與說明）
  - `tests/lib/demo-config.test.ts`（新增；**不寫 cron 一致性測試**，那個只放在 TASK-110）、`tests/components/admin-shell.test.tsx`（補 `isDemo` 預設值案例，不改既有斷言）
- 不得觸碰：
  - `lib/supabase/middleware.ts`、`proxy.ts`
  - `lib/admin/account.ts`
  - `Sidebar.tsx`
  - 任何 migration

## 需求

- `isDemoUser(user)`：只有 `user.app_metadata?.is_demo === true`（嚴格布林）才為真；字串 `"true"`、`undefined`、`null` 一律為假。
- `getDemoConfig()`：`DEMO_ENABLED === "true"` 且 `DEMO_EMAIL`、`DEMO_PASSWORD` 皆非空，且 `DEMO_EMAIL` 與 `DESIGNER_EMAIL` 不同（不分大小寫）才回傳設定，否則回傳 `null`。
- `isDemoEntryEnabled()`：只回傳布林，不含任何密碼；供登入頁伺服器元件使用。
- `DEMO_RESET_LABEL = "每日 03:00"` 放在不含 `server-only` 的 `lib/demo/notice-copy.ts`（文案是否改為「每日凌晨 3 點左右」待使用者決定，見架構筆記第 9 節）。
- `app/admin/layout.tsx` 計算 `isDemo = isDemoUser(user)` 傳入 `AdminProfileProvider`；`useAdminProfile()` 回傳 `isDemo`。

## 驗收標準

- 一般管理員登入後，後台行為與畫面與現況完全一致（既有元件測試全數通過，未改斷言）。
- `isDemoUser` 對各種輸入的真值表有單元測試（含字串 `"true"`、`1`、缺欄位）。
- `getDemoConfig` 在任一變數缺漏、`DEMO_ENABLED` 不是 `"true"`、Email 與 `DESIGNER_EMAIL` 相同（含大小寫差異）時回傳 `null`。
- `DEMO_PASSWORD` 只出現在 `server-only` 模組；沒有任何 `NEXT_PUBLIC_DEMO_*` 變數。
- `.env.example` 五個變數都有說明，並註明密碼為長隨機值、不加 `NEXT_PUBLIC_`、`DEMO_EMAIL` 會顯示在帳號設定頁因此必須是作者自己控制的信箱、環境變數改動後需 Redeploy 才生效。
- `DEMO_RESET_LABEL` 可被前端元件匯入而 `next build` 不失敗。

## 實作備註

- `AdminProfileProvider` 的 `isDemo` 必須是選填且預設 false，否則既有 component tests 全部要改。
- 文案常數放在不含 `server-only` 的檔案，因為前端元件要匯入。

## 驗證契約

- 單元測試：`tests/lib/demo-config.test.ts`；既有 `tests/components/admin-shell.test.tsx` 仍通過。
- 整合測試：不適用。
- E2E 測試：不適用。
- 型別檢查：`npx tsc --noEmit` 無錯誤
- Lint：`npm run lint` 無錯誤
- Build：`npm run build` 成功
- 螢幕截圖：不適用（無畫面變更）。
- 安全性檢查：grep 確認 `DEMO_PASSWORD` 只在 `server-only` 檔案出現；`next build` 後在 `.next/static` 搜尋不到 `DEMO_PASSWORD` 字樣。

## 審查關卡

一般程式碼審查即可。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：
- 已知限制：
- 後續任務：
