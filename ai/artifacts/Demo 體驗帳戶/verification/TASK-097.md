# 驗證報告

## 摘要

- 任務：TASK-097 Demo 體驗帳戶 架構基礎：Demo 識別、設定與 `isDemo` 貫穿後台外殼
- 結果：**通過**（新增 33 項單元測試（`demo-config` 31 項＋`admin-shell` 追加 2 項）；全套 91 檔 1641 項全過；`tsc`、`lint`、`build` 皆通過）
- 驗證者：實作 agent（Claude Code）。風險低（無資料庫、無端點、無畫面變更），依任務卡只需一般程式碼審查，未另跑子代理審查。人工驗收待使用者。

## 變更的檔案

| 檔案 | 內容 |
|---|---|
| `lib/demo/config.ts`（新增，`server-only`） | `isDemoUser`、`getDemoConfig`、`isDemoEntryEnabled`；重新匯出 `DEMO_RESET_LABEL` |
| `lib/demo/notice-copy.ts`（新增，不含 `server-only`） | `DEMO_RESET_LABEL = "每日凌晨 3 點左右"` 與橫幅／說明視窗文案常數 |
| `app/admin/layout.tsx` | 計算 `isDemoUser(user)` 傳入 `AdminProfileProvider` |
| `app/admin/_components/AdminProfileContext.tsx` | 新增選填 `isDemo`（預設 `false`），`useAdminProfile()` 回傳 |
| `app/admin/_components/AdminShell.tsx` | `main` 頂端掛 `<DemoNotice />` |
| `app/admin/_components/DemoNotice.tsx`（新增） | 只回傳 `null` 的空殼，TASK-105 才實作 |
| `.env.example` | 五個 `DEMO_*` 變數與說明 |
| `tests/lib/demo-config.test.ts`（新增） | 真值表與設定組合 |
| `tests/components/admin-shell.test.tsx` | 追加 `isDemo` 預設值案例；追加一個 `@/lib/supabase/client` mock（真實 Provider 需要），**既有斷言未改** |
| `tools/kanban/cards/TASK-097.json`、本報表 | 流程文件 |

## 指令

| 指令 | 結果 | 備註 |
|---|---|---|
| `npx vitest run tests/lib/demo-config.test.ts tests/components/admin-shell.test.tsx tests/components/account-settings-view.test.tsx` | **92 項通過** | account-settings-view 是會消費 `AdminProfileProvider` 的既有測試，確認未受影響 |
| `npx tsc --noEmit` | 通過 | 0 錯誤 |
| `npm run lint` | 通過 | 0 error |
| `npm run build` | 通過 | |
| 暫時讓 `DemoNotice` 匯入 `DEMO_RESET_LABEL` 後 `npm run build` | 通過 | 文案進入 `.next/static`（證明前端可匯入）；驗完已還原空殼 |
| `grep -rl DEMO_PASSWORD .next/static` | **無結果** | 兩次建置（含上一列的前端匯入情境）皆然 |
| `grep` 原始碼 `DEMO_PASSWORD` | 只在 `lib/demo/config.ts`（`server-only`）、測試、任務卡文件 | |
| `grep` `NEXT_PUBLIC_DEMO` | 無 | |
| `npx vitest run --maxWorkers=3`（全套） | 第一次 1640／1641（1 項 UI 測試逾時）；**第二次 91 檔 1641 項全過** | 見「審查發現」第 1 項 |

## 涵蓋範圍

- `isDemoUser`：`true` 為真；字串 `"true"`、`1`、`false`、`null`、缺欄位、空物件、`app_metadata` 為 `null`／缺少、user 為 `null`／`undefined` 皆為假；`user_metadata.is_demo` 不算。
- `getDemoConfig`／`isDemoEntryEnabled`：齊備時回傳設定；`DEMO_ENABLED` 為缺／空／`false`／`TRUE`／`1`／`yes`／`" true"` 皆為 `null`；`DEMO_EMAIL`、`DEMO_PASSWORD` 缺少、空字串、純空白皆為 `null`；Email 與 `DESIGNER_EMAIL` 相同（含大小寫、前後空白）為 `null`；`DESIGNER_EMAIL` 未設定時不比對；每次呼叫重新讀環境變數。
- `AdminProfileProvider`：不傳 `isDemo` → `false`；傳 `true` → `true`。
- 既有後台外殼導覽與未儲存變更攔截測試全數通過，未改斷言。

## UI 證據

不適用（無畫面變更；`DemoNotice` 為空殼，一般管理員畫面與現況一致，由既有元件測試證明）。

## 審查發現

| 發現 | 嚴重程度 | 狀態 |
|---|---|---|
| 1. 全套單元測試在高負載下偶發 5 秒逾時（本次第一次 1 項 UI 測試），單獨重跑與再跑全套都通過；與 TASK-087／088 報告記錄的既有並行不穩定同一議題，本卡未改動任何被影響的元件 | 低 | 非本卡造成，維持先前「另立任務」建議 |
| 2. `getDemoConfig` 的 Email 比對在正式環境未設定 `DESIGNER_EMAIL` 時形同沒作用 | 資訊 | 架構筆記 D2 已載明：主要防線是一鍵進入端點對 `is_demo` 的驗證（TASK-103），手冊（TASK-111）需寫明 |
| 3. `DEMO_RESET_LABEL` 同時由 `notice-copy.ts`（定義）與 `config.ts`（重新匯出）提供，維持單一來源；前端元件請從 `notice-copy.ts` 匯入，`config.ts` 為 `server-only` | 資訊 | 任務卡要求兩處皆可取得 |

## 殘留風險

- `isDemo` 僅是前端提示，真正的鎖由資料庫保證（TASK-100 等後續卡）；本卡不提供任何安全鎖。
- `.env.example` 的 `DEMO_ENABLED=false`、`DEMO_RESET_ENABLED=false` 為預設關閉；正式環境尚未設定任何 `DEMO_*` 變數，入口維持關閉。

## 後續任務

TASK-098～117 皆以本卡的 `isDemoUser`／`getDemoConfig`／`isDemo`／`notice-copy.ts` 為基礎。TASK-105 填入 `DemoNotice` 實作。
