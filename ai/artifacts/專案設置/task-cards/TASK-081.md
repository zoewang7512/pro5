# AI-Ready 任務卡

## Metadata

- 任務：UI 設計系統 後台「未儲存變更」離開提示：共用機制＋預約規則表單（試點）
- 上層規格：[`feature-spec-未儲存變更離開提示.md`](../feature-spec-未儲存變更離開提示.md)（人工已核准 2026-10-22）
- 畫面規格／mockup：[`screen-spec-未儲存變更離開提示.md`](../screen-spec-未儲存變更離開提示.md)、[`mockup-decision-未儲存變更離開提示.md`](../mockup-decision-未儲存變更離開提示.md)（人工已選定變體 B，2026-10-22）
- 上層 Epic：專案設置
- 上層 User Story：UI 設計系統
- 分軌：前端
- 前置任務（dependsOn）：TASK-072（已完成）
- 後續卡：TASK-082、TASK-083（皆依賴本卡的共用機制）
- 狀態：**進行中**（計畫已於 2026-10-22 經使用者核准，含 architect 審查修正）
- 風險等級：中（只影響前端互動，不碰資料與權限；但攔截導覽若不當，可能讓使用者「離不開頁面」）
- Agent owner：Claude Code
- 人工核准者：使用者
- 分支：`feat/task-081-unsaved-changes-guard`（從 master 開出；TASK-081／082／083 **同一分支依序實作**，每張一個實作 commit＋一個驗收 commit，三張都完成後再合併 master）

## 目標

做出「未儲存變更離開提示」的**共用機制**，並套用到「預約規則」表單作為第一條完整的垂直切片：
有未儲存變更時，點側邊欄、登出、或關閉／重新整理頁面，都會先提示；沒有變更時完全不打擾。
其他表單由 TASK-082、TASK-083 套用同一機制。

## 情境包（Context Pack）

- 相關檔案（已讀過）：
  - `components/ui/ConfirmDialog.tsx`（重用；需新增預設焦點選用 prop）
  - `components/ui/Sidebar.tsx`（導覽項目是 `next/link` 的 `ListItemButton`；需新增選用的 `onItemNavigate`，轉傳給 `Link` 的 `onNavigate`）
  - `app/admin/_components/AdminShell.tsx`（掛 Sidebar 的地方，`usePathname()` 推導 active；拆成「Provider 外層＋`AdminShellInner`」，Sidebar 接線在內層）
  - `app/admin/logout-button.tsx`（`handleLogout` 直接 `signOut()` 後 `router.replace`）
  - `app/admin/_components/BookingPolicyForm.tsx`（`PolicyCard` 已有 `hasChanges`＝`fields` 與 `savedFields` 比對）
  - `app/admin/layout.tsx`（`AdminProfileProvider` → `AdminShell`，Provider 掛載順序參考）
  - 既有同類慣例：`app/admin/_components/AdminProfileContext.tsx`（context＋hook 的寫法）、`lib/admin/*.ts`（純函式放 `lib/admin/`）
  - 既有測試：`tests/components/confirm-dialog.test.tsx`、`sidebar.test.tsx`、`admin-shell.test.tsx`
- 既有模式：
  - 後台元件是 client component，純邏輯拆成 `lib/admin/*.ts` 方便單元測試。
  - lint 規則 `react-hooks/set-state-in-effect` 禁止在 effect 主體同步呼叫 React `setState`（見 `BusinessHoursForm.tsx` 的說明）；本機制的 hook 在 effect 裡呼叫的是外部 store，不是 React state，不觸發該規則。
  - 既有表單測試是「不包 Provider 直接 render」，所以 hook **在沒有 Provider 時必須是安全的 no-op**。
- 假設：已核准規格的 A1～A5（見規格書「假設」）；`ConfirmDialog` 的 MUI `Dialog` 在後開的疊在上層（`zIndex.modal`）。
- 未知事項：無阻擋性問題（範圍、攔截方式、按鈕、分支均已由使用者決定）。
- 允許變更的檔案：
  - 新增 `lib/admin/unsaved-changes.ts`（純 store，無 React 依賴）
  - 新增 `app/admin/_components/UnsavedChangesProvider.tsx`（Provider、hooks、提示對話框、`beforeunload`、`leavingRef`）
  - 修改 `components/ui/ConfirmDialog.tsx`（新增選用 `autoFocusCancel`）
  - 修改 `components/ui/Sidebar.tsx`（新增選用 `onItemNavigate`，轉傳給 `Link` 的 `onNavigate`）
  - 修改 `app/admin/_components/AdminShell.tsx`（拆成 Provider 外層＋`AdminShellInner`）、`app/admin/logout-button.tsx`、`app/admin/_components/BookingPolicyForm.tsx`
  - 新增／擴充測試：`tests/lib/unsaved-changes.test.ts`、`tests/components/unsaved-changes-provider.test.tsx`、`tests/components/confirm-dialog.test.tsx`、`tests/components/sidebar.test.tsx`、`tests/components/admin-shell.test.tsx`（補 `useRouter` mock）、`tests/components/logout-button.test.tsx`（新增；現有 admin-shell 測試整個 mock 掉 `LogoutButton`，登出接線沒有覆蓋）、`tests/components/booking-policy-form.test.tsx`（新增）
  - `ai/context/design-system.md`（登記 `ConfirmDialog` 的擴充）、`ai/context/project-map.md`（新增檔案與機制說明）
- 不得觸碰：任何表單的儲存邏輯、驗證規則與資料層（`lib/booking-policy.ts` 等）；其他表單（留給 TASK-082／083）；即時儲存控制項。

## 架構筆記（TASK-081／082／083 共用）

### 1. 狀態放在外部 store

- `lib/admin/unsaved-changes.ts`：`createUnsavedChangesStore()` 回傳
  `{ setDirty(key, dirty), clear(key), isDirty(key), hasUnsaved(), subscribe(listener) }`，內部是 `Map<string, true>`。
  **只存「哪些 key 有變更」，不存、不記錄任何表單內容。**
- 為什麼用外部 store：讓**事件處理函式**（連結點擊、登出、對話框關閉、`beforeunload`）能**同步讀到最新值**，不會讀到過期的 closure；
  多個表單與頁籤圓點共用同一份狀態。（不是為了避免重新 render——Provider 的 children 是 props，本來就不會因 Provider state 變動而重繪。）
- Store 在 Provider 內以 `useState(() => createUnsavedChangesStore())[0]` 建立一次（**不用 `useRef`**：`eslint-config-next` 16 內含 React Compiler 的
  `react-hooks/refs` 規則，會擋下 render 期間讀 `ref.current`）。每個 Provider 實例一個 store，測試之間不共用。
- **所有 `useSyncExternalStore` 都必須提供第三個參數 `getServerSnapshot`（`() => false`）**：`AdminShell` 會在伺服器端 render，缺少時 SSR 會報錯並退回 client render。
- 沒有 Provider 時使用靜態的 NOOP store（`setDirty/clear` 為空函式、`hasUnsaved()` 回 false），讓 hook 能**無條件呼叫**（不違反 hooks 規則）。

### 2. Provider 位置與兩個 context

- **`AdminShell` 要拆成兩層**：`AdminShell = <UnsavedChangesProvider><AdminShellInner/></UnsavedChangesProvider>`。
  元件拿不到自己 render 出來的 Provider 的 context，所以 `Sidebar` 的接線（需要讀 context）寫在 `AdminShellInner`。`app/admin/layout.tsx` 不動。
- Provider 內用 `useRouter()`、`usePathname()`，所以 `tests/components/admin-shell.test.tsx` 的 `next/navigation` mock（目前只有 `usePathname`）**必須補上 `useRouter`**，否則既有測試會壞。
- 兩個 context：
  - **動作 context（穩定，不隨 dirty 變動）**：`confirmIfDirty`、`guardNavigate`。函式內部在**呼叫當下**讀 `store.hasUnsaved()`／`store.isDirty(key)`，不閉包 dirty 值，所以 `LogoutButton`、`ServiceFormDialog` 不會因 dirty 翻轉而重新 render。
  - **store context**：只給需要反應式讀取的 hook 用（下方 `useIsUnsavedDirty`）。

### 3. Hook API（公開契約；TASK-082／083 不得改動它，缺口須停下來回報）

```text
useUnsavedChangesGuard(key: string, isDirty: boolean): void
  單一 effect：useEffect(() => { store.setDirty(key, isDirty); return () => store.clear(key); }, [store, key, isDirty])
  （StrictMode 的 設定→清除→設定 與卸載都安全；React 先跑所有卸載清除再跑新掛載的 effect，所以 /new→/[id] 兩個頁面共用同一個 key 不會互相蓋掉。開發模式可加重複 key 的 assert。）

useIsUnsavedDirty(key: string): boolean
  useSyncExternalStore(store.subscribe, () => store.isDirty(key), () => false)   // 給 TASK-083 的頁籤圓點

useUnsavedChangesActions(): {
  confirmIfDirty(action: () => void, options?: { key?: string }): void
    // 未指定 key：看「全域是否有任何變更」；指定 key：只看該 key（例如服務對話框只看 "service-form"，不被頁面上別的表單誤觸發）
    // 無變更：立刻執行 action；有變更：開提示，選「放棄變更」才執行
  guardNavigate(href: string, event: { preventDefault(): void }): void
    // 供 next/link 的 onNavigate 使用，見規則 4
}
```

- 沒有 Provider 時：`confirmIfDirty(a)` 直接 `a()`、`guardNavigate` 不攔截、`useIsUnsavedDirty` 回 false。

### 4. 攔截規則

- **站內連結**：用 Next 16 `<Link>` 的 `onNavigate`（`next/dist/client/app-dir/link.js`：只在 Next 確定要做站內 client 導覽時才呼叫；
  修飾鍵、`download`、外部網址已被它排除）。`Sidebar` 新增選用 prop `onItemNavigate?: (href: string, event: { preventDefault(): void }) => void`，轉傳給 `Link` 的 `onNavigate`；
  `guardNavigate` 在「沒有變更」或「目標等於目前路徑」時不攔截，否則 `event.preventDefault()` 再 `confirmIfDirty(() => router.push(href))`。
  **實作時先以測試確認 `onNavigate` 能穿過 MUI `ListItemButton component={Link}` 傳到 `Link`**；若不行，退回 `onClick` 並自行判斷修飾鍵、非左鍵、`target`。
- **登出**：`confirmIfDirty(doLogout)`；登出本身的 `router.replace("/login")` 是程式化導覽，不再攔截。
- **程式化導覽不攔截**（例如新增設計師成功後的 `router.replace`、儲存後的 `router.refresh()`）。
- **「放棄變更」後的整頁導覽**：選了「放棄變更」之後，表單要等新頁面 commit 才卸載，期間 `beforeunload` 仍掛著；若 Next 改成整頁導覽
  （Vercel 重新部署後版本不一致、proxy 轉址、RSC 請求失敗退回整頁導覽），使用者會在選過「放棄變更」後又看到瀏覽器原生提示。
  所以**導覽類的放棄動作執行前先設 `leavingRef.current = true`**，`beforeunload` 處理常式與 `guardNavigate` 都略過；`usePathname()` 改變時重設為 false。
  這也順便避免 `router.push` 進行中又點另一個連結而再次提示。
- **關頁／重新整理**：Provider 內 `useEffect` 依 `hasUnsaved` 註冊／移除 `beforeunload`；處理常式：`event.preventDefault(); event.returnValue = "有尚未儲存的變更"`
  （非空字串才相容舊版瀏覽器；文案由瀏覽器決定）。沒有變更時**不註冊**。
- **瀏覽器上一頁／下一頁：不攔截**（已知限制，已決定）。

### 5. 提示對話框

- 由 Provider 渲染，重用 `ConfirmDialog`：`title="有尚未儲存的變更"`、`description="離開後，你輸入的內容會消失。"`、
  `cancelLabel="繼續編輯"`、`confirmLabel="放棄變更"`、`confirmColor="error"`、`autoFocusCancel`。
- **待執行動作存在 `useRef`，state 只存 `open` 布林**：把函式放進 `useState` 會被 React 當成 updater 立即執行，StrictMode 下還會執行兩次。
- `onClose`（Esc、點背景）與「繼續編輯」相同：關閉並清掉待執行動作。「放棄變更」：先關閉對話框，再執行待執行動作。
- **「放棄變更」永遠可用、不依賴任何非同步結果**；待執行動作丟例外時，對話框仍已關閉、攔截狀態不殘留。
- 疊在服務對話框之上：MUI 只讓最上層 modal 處理 Esc 並 `stopPropagation`，下層 FocusTrap 自動停用，Esc 不會同時關兩層；
  「繼續編輯」會還原焦點到原輸入框；**「放棄變更」兩層同時卸載，焦點可能掉到 body，走查要確認焦點回到觸發的按鈕**。

### 6. `ConfirmDialog` 小幅擴充

- 新增選用 `autoFocusCancel?: boolean`，為 `true` 時取消鈕加 `autoFocus`，讓 Enter 不會誤觸破壞性按鈕。預設 `false`，既有呼叫端行為不變。
- 同步更新 `design-system.md` inventory 的 Modal/Dialog 列與單元測試。

### 7. dirty 判定（各卡共同規則）

- 與「載入時或最近一次儲存成功的值」比對；改回原值＝沒變更；儲存成功立即乾淨；儲存失敗維持有變更。
- 每個表單用固定 key 呼叫 `useUnsavedChangesGuard`：`booking-policy`（081）、`store-basic-info`／`account-name`／`account-email`／`business-hours`（082）、
  `designer-basic-info`／`service-form`（083）。

### 8. 回滾

純增量、不碰資料與權限：還原 commit 即可。`onItemNavigate`、`autoFocusCancel` 都是選用 prop，既有呼叫端不受影響。

## 需求

- WHEN 預約規則表單有未儲存變更，且使用者點擊側邊欄任一導覽項目 THE SYSTEM SHALL 攔截並顯示「有尚未儲存的變更」提示，不導覽。
- WHEN 使用者選「繼續編輯」、按 Esc 或點背景 THE SYSTEM SHALL 關閉提示並停留，輸入內容與表單狀態不變。
- WHEN 使用者選「放棄變更」THE SYSTEM SHALL 關閉提示並導覽到被攔截的目標。
- WHEN 預約規則表單有未儲存變更，且使用者點登出 THE SYSTEM SHALL 先提示；選「放棄變更」才登出。
- WHEN 有未儲存變更 THE SYSTEM SHALL 註冊 `beforeunload`；WHEN 沒有 THE SYSTEM SHALL 不註冊（也不殘留）。
- WHEN 使用者以 Ctrl／Cmd／Shift 點擊、非左鍵點擊、或點擊目前所在頁 THE SYSTEM SHALL 不攔截（修飾鍵與非站內導覽由 Next 的 `onNavigate` 條件排除）。
- WHEN 使用者選「放棄變更」且被攔截的是導覽 THE SYSTEM SHALL 先設 `leavingRef`，使導覽進行中（含 Next 退回整頁導覽的情況）`beforeunload` 與後續攔截都不再提示；路徑改變後重設。
- `confirmIfDirty(action, { key })` 指定 key 時 THE SYSTEM SHALL 只看該 key 的狀態，不受其他表單的變更影響。
- WHEN 儲存成功、或輸入改回原值 THE SYSTEM SHALL 視為沒有變更，不提示。
- WHEN 預約規則元件卸載 THE SYSTEM SHALL 清除它登記的 dirty 狀態（不可殘留造成「離不開頁面」）。
- 沒有 Provider 時（既有測試、其他頁面）所有 hook 為安全的 no-op，且所有 `useSyncExternalStore` 都有 `getServerSnapshot`（SSR 不報錯）。
- `ConfirmDialog` 的 `autoFocusCancel` 為 `true` 時，取消鈕取得預設焦點；預設值不影響既有行為。

## 驗收標準

- 預約規則：改任一欄位 → 點側邊欄／登出 → 出現提示；「繼續編輯」後輸入不變；「放棄變更」後完成導覽或登出。
- 沒改、改回原值、儲存成功後 → 完全不提示。
- 有變更時 `beforeunload` 已註冊，無變更時未註冊（單元測試驗證 listener 的加入與移除）。
- 修飾鍵點擊、同頁點擊不被攔截。
- 提示的預設焦點在「繼續編輯」，Esc 等同「繼續編輯」。
- 提示在亮色與暗色模式的外觀與已核准的 mockup（變體 B 的對話框）一致，使用既有 `ConfirmDialog` 排版與 token，沒有硬寫的一次性數值。
- 不新增 npm 依賴；既有表單與測試不受影響（沒有 Provider 時行為不變）。
- 已知限制（瀏覽器上一頁不攔截）記入驗證報告。

## 實作備註

- 實作順序：store 與單元測試 → Provider／hook／對話框 → `ConfirmDialog`、`Sidebar` 擴充 → `AdminShell`／登出接線 → `BookingPolicyForm` 套用 → Browser 走查。
- 寫新程式碼前已確認不需要第三方函式庫（使用者已決定自製攔截、不新增套件）。
- 套用 `ai/skills/design-craft.md` 與 `ai/checklists/design-review-checklist.md`；套用 `ai/checklists/security-checklist.md`（本機制不保存表單內容、不記錄 log）。

## 驗證契約

- 單元測試：
  - `tests/lib/unsaved-changes.test.ts`：store（多 key、翻轉才通知、`clear`、`hasUnsaved`、取消訂閱）。
  - `tests/components/unsaved-changes-provider.test.tsx`：無 Provider 的 no-op；`confirmIfDirty` 有／無變更與 `key` 範圍（只看指定 key）；繼續編輯／放棄變更／Esc；待執行動作存 ref（StrictMode 不執行兩次）；`beforeunload` 註冊與移除；`guardNavigate` 同頁不攔截；`leavingRef`（放棄後 `beforeunload` 不再提示、路徑變更後重設）；`useIsUnsavedDirty` 在「A 已 dirty、B 才變 dirty」時仍會更新；StrictMode 的 設定→清除→設定；卸載清除；待執行動作丟例外時對話框已關閉。
  - `tests/components/logout-button.test.tsx`：有變更先提示、放棄後才 `signOut`；無變更直接登出。
  - `confirm-dialog.test.tsx`（`autoFocusCancel`）、`sidebar.test.tsx`（`onItemNavigate` 能穿過 `ListItemButton component={Link}` 傳到 `Link`、停用項目不觸發）、`admin-shell.test.tsx`（接線）、`booking-policy-form.test.tsx`（改欄位→dirty、改回原值→乾淨、儲存成功→乾淨）。
- 整合測試：不涉及資料層；既有整合套件不需重跑（本卡不動 migration、RPC、lib 資料層）。
- E2E 測試：Browser 走查預約規則：改→點側邊欄（繼續編輯／放棄變更）、改→登出提示、改回原值不提示、儲存後不提示、Ctrl 點擊不攔截；暗色與亮色；`beforeunload` 為手動項目。
- 型別檢查／Lint／Build：`npx tsc --noEmit`、`npm run lint`、`npm run build`（build 前先停 dev server）。
- 螢幕截圖：提示對話框（亮色、暗色）。
- 安全性檢查：機制只存 key 與布林，不存表單內容；無新的資料流、無新依賴。
- 審查關卡：architect 動工前審查已完成（2026-10-22，7 項 MUST FIX 已併入本卡）；實作後再審視一次攔截與卸載時序。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：
- 已知限制：瀏覽器上一頁／下一頁不攔截。
- 殘留風險（寫入驗證報告）：儲存進行中選「放棄變更」，寫入仍可能成功，文案會失準；若未來開啟 `cacheComponents`，路由會被 Activity 保留，「放棄變更」後回到原頁可能看到舊輸入（屆時需重新評估）。
- 後續任務：TASK-082、TASK-083
