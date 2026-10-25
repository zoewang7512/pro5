# 驗證報告

## 摘要

- 任務：TASK-095 升級 `next`／`eslint-config-next` 16.3.0 → 16.4.3，處理 `npm audit` 的 critical 與 high
- 結果：**通過，使用者人工驗收通過 2026-10-25**。尚未部署（部署由使用者決定）；「尚待人工確認」三項已由使用者於驗收時確認。
- 驗證者：實作 agent（Claude Code）。agent 輸出不等於人工核准。
- 核准依據：使用者在對話中下達「開始做TASK-095」，agent 視為核准計畫並勾選 `human_approval_recorded`；security-reviewer 已指出這屬流程判斷，請使用者確認。

## 變更的檔案

| 檔案 | 內容 |
|---|---|
| `package.json` | `next`、`eslint-config-next` 皆 `16.3.0` → `16.4.3`（精確版本，無 `^`，無 `overrides`） |
| `package-lock.json` | 只有版本變動，無新增／移除套件：`@next/*`、`@swc/helpers`、`sharp` 與 `@img/sharp-*`、`nanoid`、`source-map-js`，以及 dev 傳遞相依 `fastq`（1.20.1→1.20.3） |
| `ai/context/decisions.md`、`project-map.md`、`README.md` | 記錄版本、決策、已知限制；README 把「升級 next」從待辦移除 |
| 看板卡、任務卡、本報告 | 流程文件 |

未觸碰：`proxy.ts`、`next.config.ts`、任何功能程式碼與測試。

## release notes 與本專案相關的部分

16.4.3 是 backport 修補版，release note 沒有列出 breaking change、deprecation 或 Windows 相關變更。唯一相關：`proxy.ts` 不再載入 app-page runtime。本專案的 proxy 路徑（`proxy.ts` → `lib/supabase/middleware.ts` → `lib/auth/aal.ts`）只用 `next/server`、`@supabase/ssr` 與 type-only import，不依賴它（security-reviewer 逐行確認）。16.3.1～16.4.2 沒有逐版 release note 可查，這部分以 16.4.3 的說明與實測為準。

## npm audit 前後對照

| | 升級前（`--omit=dev`） | 升級後（`--omit=dev`） |
|---|---|---|
| `next` | critical（13 項公告） | 已解決 |
| `sharp` | high（隨 next） | 已解決（0.35.5） |
| `nanoid` | high | 已解決（3.3.20，`npm update`，只動 lockfile） |
| `source-map-js` | high | 已解決（1.2.2，同上） |
| 合計 | 1 critical、3 high | **0 vulnerabilities** |

完整 `npm audit`（含 dev）仍有 7 項，全為測試／lint 工具鏈，不進正式環境，也在本卡範圍外：`tinypool`（critical，vitest 3 的相依，需 vitest 主版本升級）、`vite`／`@vitest/mocker`、`zod`、`js-yaml`、`brace-expansion`。

## 指令

| 指令 | 結果 | 備註 |
|---|---|---|
| `npm install --save-exact next@16.4.3 eslint-config-next@16.4.3` | 成功；`npm ls next` 只有一份 16.4.3 | |
| `npm update nanoid source-map-js` | 成功 | 只動 lockfile |
| `npm audit --omit=dev` | **0 vulnerabilities** | |
| `npx tsc --noEmit` | 通過 | |
| `npm run lint` | 通過，無輸出 | |
| `npm run build` | **見下方「build 的一次失敗」**；之後 4 次（1 次增量＋3 次清空 `.next`）皆通過，無警告，路由表與升級前相同 | |
| `npm test`（升級前基準） | 5 檔失敗／27 項失敗，1581／1608 通過 | 全為 5000ms 逾時：account-settings-view、designer-basic-info-form、designer-picker-section、login-form、service-form-dialog |
| `npm test`（升級後） | 8 檔失敗／43 項失敗，1565／1608 通過 | 39 項為 5000ms 逾時、2 項為斷言失敗（皆在並行負載下）。基準 5 檔全部再現，**多出** appointment-detail-dialog、designer-leaves-tab、reset-password-form 三檔 |
| 上述 8 檔 `--no-file-parallelism` 單獨重跑 | **8 檔 173 項全過** | 失敗是並行負載造成，與升級無關；但失敗數較基準多，因為升級後那次跑全套時同時有 security-reviewer 在讀檔等背景工作，負載不同，**無法嚴格證明「與升級前相同」，只能證明這 8 檔單獨跑都通過** |
| `npm run test:reports` | **19 項通過** | 對真實 Supabase（唯讀＋既有稽核雜訊慣例） |

## build 的一次失敗（需使用者知悉）

升級後第一次 `npm run build` 失敗：`next/font/google` 的 `Noto_Serif_TC` 回報 `Can't resolve '@vercel/turbopack-next/internal/font/google/font'`。之後同一份程式碼連續 4 次 build 成功。隨後在 dev server 也重現一次同樣錯誤，日誌顯示 `Connection timed out when requesting https://fonts.gstatic.com/...woff2`（數十個字型子集下載逾時）；當時我清空了 `.next`，字型快取歸零，必須重新下載近百個子集。網路恢復（curl 0.2s 回 200）並重啟 dev server 後恢復正常，日誌全為 200。

判斷：字型下載逾時加上損壞的快取狀態，不是 16.4.3 的功能缺陷。**但我沒有在 16.3.0 上用同樣條件重現對照**，所以這是推論，不是證明。部署到 Vercel 時請看第一次 build 是否成功；若失敗，重試一次，再失敗就回報。

## 手動走查（本機，店長 session 已登入於瀏覽器窗格，唯讀）

| 項目 | dev server | production（`next build` + `next start`，port 3100，已關閉） |
|---|---|---|
| 未登入存取 `/admin`、`/admin/reports`、`/admin/designers`、`/admin/audit-log`（curl，無 cookie） | 307 導向 `/login` | 307 導向 `/login` |
| 公開頁 `/`、`/login`、`/design-system`、`/reset-password`（curl） | 200 | 200 |
| 顧客前台首頁（服務清單、品牌區）截圖 | 正常 | 未截圖 |
| `/design-system` 截圖 | 正常 | 未截圖 |
| `/admin`（預約週曆）截圖 | 正常 | 未走查 |
| `/admin/reports`（儀表板）截圖：預約量 1、預估營收 NT$5,000，與 TASK-094 驗收時相同 | 正常 | 未走查 |
| `/admin/designers`、`services`、`business-hours`、`booking-policy`、`store-settings`、`account`、`audit-log` | 伺服器日誌全為 200，`proxy.ts` 皆有執行 | 未走查 |

備註：瀏覽器主控台曾列出舊 dev 工作階段（字型逾時那段）留下的錯誤，伺服器日誌顯示新實例沒有任何 4xx／5xx（除預期的 307），所以判斷主控台那些是舊紀錄。

## 尚待人工確認（agent 不能代做）

這三項需要登入憑證、寫入正式資料庫或下載檔案，依規則不由 agent 自行執行：

1. **`/login` 含 MFA 登入**：需要使用者輸入密碼與驗證碼。
2. **顧客預約流程成功頁**：實際下單會寫入正式資料庫（並觸發 Email 通知），agent 沒有送出預約。
3. **`/admin/reports` 匯出 Excel**：會下載檔案，需要使用者同意。匯出邏輯的單元測試（TASK-093）在全套測試中通過，但「升級後實際點匯出、開得起來」尚未驗證。

另外 **production build 只做了 curl 層級的走查**（存取控制與公開頁狀態碼），沒有登入後的頁面走查。

## 安全性

security-reviewer 快速複審：**通過，沒有阻擋項目**。確認項目：lockfile 無新增／移除套件；無新增 `hasInstallScript`、`bin`；全部 `resolved` 皆為 registry.npmjs.org 且 `integrity` 齊全、抽查與 registry 一致；維護者無變動；無 `overrides`；`proxy.ts` 與 `lib/supabase/middleware.ts` 沒有被改動，也不依賴 app-page runtime。

## 已知限制與殘留風險

- **正式環境尚未更新**：Vercel 目前仍跑 16.3.0，critical 公告在正式環境**尚未修補**，要重新部署才生效。專案未使用公告涉及的功能（`next/image`、`next/og`、`use cache`、Server Actions），暴露面有限；Vercel 也非 Windows 主機。部署由使用者決定。
- 全套測試「與升級前相同」未能嚴格證明（見上），僅證明 8 個失敗檔單獨重跑全過。
- build 一次失敗的原因是推論（見上）。
- 完整 `npm audit` 的 dev 項目仍在（tinypool critical 等），不進正式環境。
- 部署與 CI 應使用 `npm ci`，避免 dev 的 `^` 範圍讓安裝結果偏離這次審查的 lockfile。

## 後續任務（建議，使用者決定要不要立卡）

- 非破壞性更新 dev 工具鏈：`vite`（Windows 上 launch-editor 的參數跳脫問題，本機開發環境就是 Windows）、`zod`、`js-yaml`、`brace-expansion`，可用 `npm audit fix`（不加 `--force`）；`tinypool` 需評估 vitest 3→5。
- 任務卡「package.json 無 `^`」的描述只適用於 dependencies，devDependencies 有 `^`；以 decisions 的說明為準。
