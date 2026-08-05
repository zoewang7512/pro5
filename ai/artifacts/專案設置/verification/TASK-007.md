# 驗證報告

## 摘要

- 任務：TASK-007 UI 設計系統 S4：核心元件庫
- 結果：通過
- 驗證者：實作 agent（Claude Code）；人工核准者：使用者（2026-08-05）

## 指令

| 指令 | 結果 | 備註 |
|---|---|---|
| `npx tsc --noEmit`（第一次） | 失敗 | `Stack` 的 `flexWrap` 需放進 `sx`，MUI v9 不接受頂層 `flexWrap` prop |
| 修復後 `npx tsc --noEmit` | 通過 | |
| `npm run lint`（第一次） | 失敗 | `ToastProvider` 在 `useEffect` 內 setState，觸發 `react-hooks/set-state-in-effect` |
| 修復後 `npm run lint` | 通過 | 改為直接以 `queue[0]` 衍生 `current`，用 `key={current.id}` 觸發重新動畫，不再需要 effect |
| `npm test`（第一次） | 3 個 unhandled error | MUI Button ripple／Dialog enter transition 的 `setTimeout` 在 jsdom teardown 後才觸發 |
| 修復後 `npm test` | 通過（6/6） | 新增 `tests/test-utils.tsx`，測試用 theme 關閉 ripple 與 dialog transition |
| `npm run build` | 通過 | `/design-system` 產出為靜態頁 |
| 瀏覽器手動驗證 `/design-system` | 通過 | 見「UI 證據」 |

## 測試明細

| 測試檔 | 案例 | 結果 |
|---|---|---|
| `tests/components/confirm-dialog.test.tsx` | 關閉時不渲染內容 | ✓ |
| | 開啟時顯示標題與說明，點取消呼叫 onClose | ✓ |
| | 點確認呼叫 onConfirm | ✓ |
| | loading 時取消按鈕停用 | ✓ |
| `tests/components/select.test.tsx` | 預設顯示第一個選項，點選後切換為新選項 | ✓ |
| `tests/smoke.test.ts`（既有） | 煙霧測試 | ✓ |

## UI 證據

本次 Browser 工具的螢幕截圖功能逾時（"the Browser pane is not displayed"，與 TASK-001／
TASK-003 相同的已知限制），改用 `read_console_messages`＋`get_page_text`＋互動點擊＋
`read_page` 可及性樹取得渲染後內容與行為作為佐證：

- `read_console_messages`：無任何錯誤訊息。
- `get_page_text`：確認 Nav（標題＋連結）、Button（4 種 variant／color＋停用＋載入中）、
  Input（預設／停用／錯誤 helperText）、Select、Checkbox/Radio（勾選/未勾選/停用）、Card、
  Table（兩列資料）、Form（FormSection 標題＋描述＋欄位）、Modal 觸發按鈕、Toast/Alert
  （四種 severity 的靜態 Alert）皆完整渲染於頁面文字。
- 互動驗證：
  - 點擊「服務項目」Select → `read_page` 確認彈出 listbox 含 3 個 option → 點選「染髮設計」
    → combobox 顯示值正確切換為「染髮設計」。
  - 點擊「開啟確認對話框」→ `get_page_text` 確認出現「確認取消預約？」標題、說明文字、
    「取消」／「取消預約」按鈕 → 點擊「取消」→ 對話框內容從頁面消失（正確關閉）。
  - 點擊「觸發成功 Toast」→ `get_page_text` 確認頁尾出現「預約已建立」（全域 `ToastProvider`
    運作正常，證明已正確掛載於 `lib/theme/ThemeRegistry.tsx`）。

## 審查發現

| 發現 | 嚴重程度 | 狀態 |
|---|---|---|
| `app/design-system/page.tsx` 多處 `Stack` 用了頂層 `flexWrap` prop，MUI v9 型別不接受，`tsc` 失敗 | Low（型別錯誤，阻擋 build） | 已修復：改放進 `sx={{ flexWrap: "wrap" }}` |
| `ToastProvider` 原本用 `useEffect` 把佇列第一則搬進 `current` state，違反 `react-hooks/set-state-in-effect`（lint 失敗） | Low | 已修復：`current` 直接由 `queue[0]` 衍生，關閉時在事件處理常式（非 effect）內 `setQueue` 移除已顯示項目 |
| MUI Button ripple 與 Dialog enter transition 用 `setTimeout`，測試環境常在元件 unmount／jsdom teardown 後才觸發，造成 `window is not defined` 的 unhandled error（測試仍全數通過，但輸出有噪音） | Low | 已修復：新增 `tests/test-utils.tsx` 的 `renderWithTheme`，測試專用 theme 關閉 ripple（`disableRipple`）與 Dialog transition（`transitionDuration: 0`） |

## 殘留風險

- Button 的 hover/focus 狀態靠瀏覽器原生行為驗證，未逐一截圖比對；如需嚴格視覺回歸建議未來
  導入 Playwright／Chromatic 視覺測試。
- Toast 佇列排隊訊息切換沒有先收合再展開的轉場，目前用 `key` 直接重掛簡化實作，足夠目前需求。
- `app/page.tsx`／`app/admin`／`app/login` 尚未改用這批元件重新設計，留給 S5／後續功能 Epic。
- 本次仍受限於 Browser 工具螢幕截圖逾時的已知環境限制，改用文字/互動驗證佐證；若之後截圖
  功能恢復，建議之後重新截圖補齊視覺證據存檔。

## 人工核准

- 核准者：使用者
- 日期：2026-08-05
- 決定：親自開瀏覽器檢視 `/design-system` 展示頁，確認沒問題，核准推進到「完成」。
