# 驗證報告

## 摘要

- 任務：TASK-081 UI 設計系統 後台「未儲存變更」離開提示：共用機制＋預約規則表單（試點）
- 結果：**通過**（有已知限制與一項需注意的驗證方式說明，見下方）
- 驗證者：實作 agent（Claude Code）。動工前 architect 審查（7 項 MUST FIX 已併入計畫）**不等同人工核准**；
  product／ui／architecture 關卡已由使用者核准計畫與變體 B；security／test／code_review 關卡待人工核准。
  **本卡沒有做實作後的 subagent 審查。**
- 分支：`feat/task-081-unsaved-changes-guard`（與 TASK-082／083 同一分支）

## 指令

| 指令 | 結果 | 備註 |
|---|---|---|
| `npx tsc --noEmit` | 通過 | 0 錯誤 |
| `npm run lint` | 通過 | 0 error、0 warning（含 React Compiler 的 `react-hooks/refs`、`set-state-in-effect` 規則） |
| `npm run build` | 通過 | build 前先停 dev server、build 後重啟 |
| `npx vitest run --maxWorkers=3`（全套） | 1123／1124 通過 | 1 項失敗是 `account-settings-view` 的 5 秒逾時（既有環境問題，TASK-069～077 報告已記載）；**該檔案單獨重跑 33／33 通過** |
| 整合測試 | 未重跑 | 本卡不動 migration、RPC、資料層，依任務卡驗證契約不需要 |

本卡新增或擴充的測試（共 52 項新增）：

- `tests/lib/unsaved-changes.test.ts`（新增 8）：多 key 獨立、`clear`、值沒翻轉不通知、**A 已 dirty 時 B 才變 dirty 仍通知**、取消訂閱（含回呼中取消）、實例互相獨立、NOOP store。
- `tests/components/unsaved-changes-provider.test.tsx`（新增 22）：沒有 Provider 時 no-op；`confirmIfDirty` 有／無變更；繼續編輯／Esc／放棄變更；Enter 不會誤觸放棄變更；StrictMode 下放棄只執行一次；
  **動作丟例外時對話框仍關閉**；key 範圍；`beforeunload` 只在有變更時註冊並在改回乾淨後移除；**表單卸載但 Provider 仍在時清除 dirty**；`guardNavigate` 同頁不攔截、放棄後 `router.push`、
  **`leavingRef`（導覽中 `beforeunload` 不再提示、路徑變更後恢復）**、離開中再點另一連結不重複提示；`useIsUnsavedDirty` 反應式；StrictMode 與 key 交接。
- `tests/components/sidebar.test.tsx`（新增 4）：`onItemNavigate` 能穿過 `ListItemButton component={Link}` 傳到 `Link` 且帶入 href；Ctrl／Cmd 點擊由 Next 排除（同一測試先證明一般點擊會呼叫，避免空轉通過）；停用項目不觸發；不傳時行為不變。
- `tests/components/confirm-dialog.test.tsx`（新增 2）、`admin-shell.test.tsx`（新增 4：有變更點側邊欄攔截、繼續編輯、無變更照常、同頁不提示）、
  `logout-button.test.tsx`（新增 4：登出接線原本沒有任何測試）、`booking-policy-form.test.tsx`（新增 8：改欄位、改回原值、儲存成功／失敗、載入中、沒有 Provider）。

### 突變測試（驗證測試不是空轉）

對 `UnsavedChangesProvider.tsx` 暫時植入 7 種錯誤，確認對應測試會失敗，每次跑完還原並驗證檔案一致：

| 突變 | 結果 |
|---|---|
| 放棄變更後不設 `leavingRef` | 2 項失敗 ✅ |
| `beforeunload` 一律註冊（不看 `hasUnsaved`） | 3 項失敗 ✅ |
| `confirmIfDirty` 忽略 key 範圍 | 1 項失敗 ✅ |
| 卸載時不清除 dirty | **第一次沒被抓到**，見下方「發現的問題 3」；修正測試後 1 項失敗 ✅ |
| 路徑改變時不重設 `leavingRef` | 1 項失敗 ✅ |
| 放棄變更不關閉對話框 | 3 項失敗 ✅ |
| `guardNavigate` 不略過同頁 | 1 項失敗 ✅ |

## 瀏覽器走查（`localhost:3000`，登入後台，正式資料庫）

**守則**：預約規則的值**一律不儲存**，只在畫面上改了再離開。原值為「最短提前 1 小時、可取消／改期時限留空」。
走查結束後以唯讀查詢確認 `booking_policy` 仍是 `min_lead_time_hours=1`、`cancel_window_hours=null`，且 `updated_at` 停在 `11:12:46Z`
（早於走查時間約 2 小時，是先前 `test:designers` 重跑時留下的；若走查有儲存會是 13:xxZ）——**走查沒有儲存任何東西**。

| 情境 | 結果 |
|---|---|
| 基準：沒有改動 | 無對話框；`beforeunload` 未註冊 ✅ |
| 改成 24 | `beforeunload` 註冊並攔截（`defaultPrevented = true`）✅ |
| 點側邊欄「服務設定」 | **被攔截**：網址不變、對話框出現、輸入仍是 24 ✅（這是 App Router 版 `next/link` 的 `onNavigate` 在真實應用裡的驗證，vitest 載入的是 Pages 版） |
| Esc | 等同「繼續編輯」：對話框關閉、停留原頁、輸入仍是 24 ✅ |
| 再次點側邊欄 → 「放棄變更」 | 導覽到 `/admin/services`；新頁面 `beforeunload` 不殘留 ✅；回到預約規則值仍是 1（沒存）✅ |
| 改成 24 再**改回 1** | `beforeunload` 解除、點側邊欄不提示、照常導覽 ✅ |
| 沒有改動時點側邊欄 | 不提示、照常導覽 ✅ |
| 同頁點擊（預約規則 → 預約規則，有變更） | 不提示、輸入保留 ✅ |
| 登出（有變更） | 被攔截，仍在原頁，**焦點在「繼續編輯」**；按 Enter 沒有誤觸登出，仍在登入狀態、輸入仍在 ✅（我只按了繼續編輯，沒有真的登出） |
| 亮色與暗色 | 提示外觀與已核准的 mockup 一致：danger 色「放棄變更」、outlined「繼續編輯」✅ |

**Ctrl／Cmd 點擊**：瀏覽器走查**沒有**取得「沒有彈對話框」的直接證據（見下方說明）。證據是：讀過 Next 16 `next/link` 原始碼（修飾鍵在呼叫 `onNavigate` 之前就排除）＋單元測試（一般點擊會呼叫、Ctrl／Cmd 不會）。
走查時我用 `dispatchEvent` 送合成的 Ctrl 點擊，瀏覽器自己執行了 `<a>` 的預設導覽把頁面帶走，腳本被中斷；這間接說明我們的攔截沒有介入，但不是乾淨的驗證。

## 發現的問題

1. **預設焦點在真實瀏覽器沒有生效（單元測試沒抓到）**：只用 `autoFocus`，真實瀏覽器裡 `document.activeElement` 是對話框容器而不是「繼續編輯」，Enter 的保護形同虛設。
   原因是 MUI 對話框淡入期間內容是 `visibility: hidden`，不可見元素無法取得焦點，隨後 MUI FocusTrap 把焦點給容器；jsdom 沒有動畫與可見性，所以單元測試過了。
   已修：`ConfirmDialog` 在 `autoFocusCancel` 時於 `slotProps.transition.onEntered` 明確把焦點給取消鈕（保留 `autoFocus`）。**瀏覽器內驗證通過**（焦點在「繼續編輯」、Enter 不誤觸）。
   **此修正的 `onEntered` 路徑在 jsdom 無法單元測試**（`autoFocus` 就會讓測試通過），以瀏覽器走查為證據。
2. **vitest 裡的 `next/link` 是 Pages Router 實作**（`RouterContext`），正式建置才換成 app-dir 實作（`AppRouterContext`）；沒有 router context 時 `Link` 點擊會在 `if (!router) return;` 提早返回，連 `onNavigate` 都不會呼叫。
   已新增 `tests/test-utils.tsx` 的 `renderWithAppRouter`（兩個 context 都提供）；兩者對 `onNavigate` 的語意相同（已讀兩份原始碼確認），真實 app-dir 行為以瀏覽器走查為準。
3. **我自己的測試缺陷**：`renderWithTheme` 回傳的 `rerender` 會把整棵樹連 Provider 一起重新掛載，導致用 `rerender` 的測試其實每次都在用全新的 store，因此「卸載不清除 dirty」的突變沒被抓到。
   已新增 `TestThemeWrapper`，改用 RTL 的 `wrapper` 選項讓 `rerender` 保留 Provider，並修正一個因「傳同一個 element 物件導致 React 跳過重繪」而失敗的測試；之後所有突變都被抓到。

## 已採納的動工前審查（詳見任務卡「架構筆記」）

- `AdminShell` 拆成 Provider 外層＋`AdminShellInner`；`useIsUnsavedDirty` 獨立 hook＋穩定的動作 context；`confirmIfDirty(action, { key, leaving })`；
  `leavingRef` 防第二次原生提示；`useState` 建 store（不用 `useRef`）；所有 `useSyncExternalStore` 都有 `getServerSnapshot`；待執行動作存 ref；
  採用 Next `Link` 的 `onNavigate` 取代自寫修飾鍵判斷；新增登出測試。

## 已知限制與殘留風險

- **瀏覽器上一頁／下一頁不攔截**（已決定）。
- **`beforeunload` 的原生對話框無法自動化驗證**：以 `dispatchEvent(new Event("beforeunload"))` 驗證處理常式的註冊、攔截（`defaultPrevented`）與移除；實際的瀏覽器原生提示文案由瀏覽器決定，需人工在真實瀏覽器確認（關閉分頁或重新整理時）。
- 儲存進行中選「放棄變更」，寫入仍可能成功，提示文案會失準（只有預約規則表單，且儲存很快）。
- 若未來開啟 `cacheComponents`，路由會被 Activity 保留，「放棄變更」後回到原頁可能看到舊輸入，屆時需重新評估。
- 只套用到預約規則；其餘表單由 TASK-082、TASK-083 套用。
- 截圖由 Browser 工具擷取，**未存成專案檔案**。

## 變更的檔案

- 新增：`lib/admin/unsaved-changes.ts`、`app/admin/_components/UnsavedChangesProvider.tsx`、`tests/lib/unsaved-changes.test.ts`、
  `tests/components/{unsaved-changes-provider,logout-button,booking-policy-form}.test.tsx`
- 修改：`components/ui/ConfirmDialog.tsx`（`autoFocusCancel`＋`onEntered` 焦點）、`components/ui/Sidebar.tsx`（`onItemNavigate`）、
  `app/admin/_components/AdminShell.tsx`、`app/admin/logout-button.tsx`、`app/admin/_components/BookingPolicyForm.tsx`、
  `tests/test-utils.tsx`、`tests/components/{confirm-dialog,sidebar,admin-shell}.test.tsx`、
  `ai/context/design-system.md`、`ai/context/project-map.md`
