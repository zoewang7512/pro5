# AI-Ready 任務卡

## Metadata

- 任務：多位設計師 前台設計師全頁個人頁（仿 IG）、作品集九宮格與放大檢視、返回鍵行為
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：多位設計師
- 上層 User Story：顧客選擇設計師並查看詳細資訊
- 分軌：前端
- 前置任務（dependsOn）：TASK-071, TASK-073
- 狀態：待驗證，等人工驗收（實作與驗證見 [`verification/TASK-074.md`](../verification/TASK-074.md)；人工已於 2026-10-21 核准；動工前 architect／security-reviewer 審查已於 2026-10-22 完成並採納，見「動工前審查定案」）
- 風險等級：中（瀏覽器歷史紀錄操作，處理不好會讓顧客按返回鍵時離開預約頁、遺失進度）
- Agent owner：Claude Code
- 人工核准者：使用者

## 目標

實作 mockup Variant B 的全頁個人頁：AppBar（返回鍵＋IG 帳號或名字）、頭像＋數字列（作品／專長）、名字、
簡介、專長標籤、「前往 Instagram ↗」、滿版三欄九宮格、底部固定「選擇○○」，以及作品放大檢視。新做
`PortfolioGrid` 並登記回 inventory。

## 情境包（Context Pack）

- 相關檔案：
  - `ai/artifacts/多位設計師/mockups/customer-designer-variant-b.html`（畫面 3、4、5）
  - `ai/artifacts/多位設計師/mockup-decision-前台選擇設計師.md`（返回鍵要求、拿掉「年資」）
  - `app/_components/booking/DesignerPickerSection.tsx`（TASK-073 留下的開啟入口）
  - TASK-067 架構筆記 F（`Dialog fullScreen`＋`pushState`／`popstate`）
- 既有模式：MUI `Dialog`（`ConfirmDialog` 內部用法）、`Avatar`、`Chip`。
- 假設：作品集資料已由 TASK-073 的 `getDesignersForService` 一次取得全部（最多 12 張），開啟個人頁不再查詢。
- 未知事項：iOS Safari 的手勢返回在 `pushState` 下的行為，實作後用行動裝置模擬走查確認。
- 允許變更的檔案：
  - `app/_components/booking/DesignerProfileDialog.tsx`（新增）
  - `components/ui/PortfolioGrid.tsx`（新增，九宮格＋放大檢視，跨頁共用）
  - `app/_components/booking/DesignerPickerSection.tsx`（接上開啟入口）
  - `ai/context/design-system.md`（S4 inventory 登記 `PortfolioGrid`）
  - `tests/components/portfolio-grid.test.tsx`、`tests/components/designer-profile-dialog.test.tsx`
  - 〔審查補列〕`tests/components/designer-picker-section.test.tsx`（現有測試斷言「看完整作品集 ›」不做事，接上後必須改）、
    `ai/artifacts/多位設計師/verification/TASK-074.md`
- 不得觸碰：`BookingFlow.tsx` 的 state 結構（TASK-073 已定案；只能透過 props／callback 串接）。

## 需求

- 〔審查〕history state 只放設計師 id，不放任何個資；`popstate` 時只從 TASK-073 已取得的公開名單查找該 id，查不到就
  忽略；不從 URL 或 hash 讀設計師 id 決定畫面內容。實測 Next 16 App Router 遇到自訂 state 的 popstate 行為，以及
  重新整理後呼叫 `history.back()` 會不會離開預約頁（重新整理後個人頁不會開著，不應呼叫 `back()`）。
- 開啟：`history.pushState({ designerProfile: id }, "")`；`popstate` 時關閉；用 AppBar 返回或「選擇○○」關閉時呼叫
  `history.back()`，讓歷史紀錄保持乾淨。關閉後捲動位置回到設計師步驟。
- IG 按鈕：沿用既有 `instagramProfileUrl(handle)`（`lib/designers.ts`），回傳 null 就不顯示；`href = https://www.instagram.com/<handle>/`，
  `target="_blank" rel="noopener noreferrer"`。
- 簡介的換行用 `white-space: pre-line` 呈現，不得使用 `dangerouslySetInnerHTML`。
- 九宮格：2px 間距、正方形、`object-fit: cover`；載入前顯示 `grey.200` 底色；載入失敗保留底色。
- 放大檢視：左右切換（按鈕與左右方向鍵）、`Esc`／× 關閉、顯示目前張數；關閉放大檢視不會關閉個人頁。
- 空作品集：「尚無作品」空狀態。
- 「選擇○○」：關閉個人頁，並等同點選該設計師頭像。

## 驗收標準

- 在個人頁按瀏覽器返回鍵只會關閉個人頁，不會離開預約頁；已選的服務與設計師保留。
- 九宮格與放大檢視在 375px 與桌面寬度都正確顯示，暗色模式可讀。
- 數字列只有「作品／專長」兩格。

## 實作備註

- 〔審查〕不新增 `buildInstagramUrl`：`instagramProfileUrl` 已做格式驗證並回傳 `null`（TASK-073 驗證報告已指出重複），`lib/designers.ts` 不變更。

## 驗證契約

- 單元測試：`instagramProfileUrl`（既有，不重寫）；`PortfolioGrid` 空狀態、切換、`Esc` 關閉；個人頁開關時有呼叫 `pushState`／`back`。
- 整合測試：不適用（無新的資料存取）。
- E2E 測試：Browser 在 mobile preset 走查「開個人頁 → 放大第 3 張 → 右切 → Esc → 瀏覽器返回 → 確認仍在預約頁且服務還在」。
- 型別檢查／Lint／Build：`npx tsc --noEmit`、`npm run lint`、`npm run build`
- 螢幕截圖：個人頁（有作品、無 IG 且無作品）、放大檢視、暗色模式。
- 安全性檢查：IG 連結只由帳號組成固定網域網址、帶 `noopener noreferrer`；圖片網址經白名單。

## 動工前審查定案（architect／security-reviewer，2026-10-22，非人工核准）

History（`DesignerPickerSection.tsx` 檔內不 export 的 `useDesignerProfileHistory(designers)`，不抽共用檔、不放進 Dialog）
- state 形狀 `{ designerProfile: id, designerProfileSession: TOKEN }`，TOKEN 為模組層級、每次載入頁面產生一次的隨機值。popstate 要 token 相符、
  `typeof id === "string"` 且 `isDesignerId(id)` 且在 `designers` 用 `Array.find` 查得到才開，其他一律關閉（不得用物件當索引表）；掛載時絕不依
  `history.state` 開啟；關閉時 token 與 id 都相符才呼叫 `back()`（修正重新整理後殘留 state 讓個人頁關不掉）。
- 防重入：`pendingBackRef`，呼叫 `back()` 後到收到 popstate 前忽略所有開啟／關閉（含「選擇○○」，避免連點退兩頁與 `onSelect` 呼叫兩次）；
  目前已是本次載入的個人頁紀錄時開啟改用 `replaceState`（避免雙擊 push 兩筆）。
- AppBar 返回、「選擇○○」、Esc／Dialog `onClose` 走同一條關閉流程。`pushState` 只在 click 處理函式內同步呼叫、不帶第三個參數 url、以 try/catch
  包住（iOS 頻率上限，失敗時不寫 history 直接開啟）。popstate 監聽器以 `designers` 為依賴重新註冊並在 cleanup 移除。
- 關閉動畫：Dialog props 用 `open` + `designer`，淡出結束（`slotProps.transition.onExited`）才清掉 designer，避免內容空白；`profileId` 查不到設計師
  當成關閉且不呼叫 `back()`。`DesignerPickerSection` 改成單一 return（Fragment：摘要或展開＋Dialog），Dialog 位置固定。
- 捲回 `#designer-step` 與焦點：只在實測需要時才做；「選擇○○」使區塊收合、原連結被卸載時，onExited 把焦點移到 `#designer-step`（加 `tabIndex={-1}`）。
- 放大檢視不寫 history：開著時按瀏覽器返回會連個人頁一起關，已知行為。

元件
- `PortfolioGrid`（`components/ui/`，純展示）：`images: PortfolioGridImage[]`（`{ id, src }`，比照 `PortfolioManager` 命名；註解註明 src 必須是呼叫端已過
  `resolvePortfolioImageUrl` 的網址）、`ownerName`（組出 alt「林小美的作品 第 3 張，共 9 張」與放大檢視標題）。格子用 `ButtonBase`
  （`aria-label`「查看第 n 張作品」）。放大檢視黑底用 `common.black`＋透明度、文字 `common.white`，**不用 `grey.900`**（暗色模式 grey 反轉）；
  `object-fit: contain`、`no-referrer`；方向鍵只掛在放大檢視 Dialog 的 `onKeyDown`，忽略 alt／meta／ctrl／shift 與 `isComposing`，只在真的處理時才
  `preventDefault`；上一張／下一張有 aria-label，首尾停用；「n / total」`aria-live="polite"`；index 夾回範圍；`key={designer.id}` 換人時重置。
- 規格差異（screen-spec／mockup 寫「左右滑動＋點點」，任務卡寫「按鈕＋方向鍵＋張數」）：**兩者都做**——按鈕、方向鍵、張數、點點指示，再加
  不引入套件的簡易觸控滑動（touchstart／touchend 位移超過門檻切換）。
- `DesignerProfileDialog`：`Dialog fullScreen`、內容包 `Container maxWidth="sm"`（桌面寬度不讓格子變巨大）；Paper 用 flex column，AppBar `position=static`、
  `color="inherit"`＋`background.paper`＋divider，中間單一捲動區（`overscrollBehavior: contain`），底部「選擇○○」在 flex 流內（不用 fixed、不用 100vh），
  `pb: calc(12px + env(safe-area-inset-bottom, 0px))`；`aria-labelledby` 用 `React.useId()` 指向名字標題；返回鍵 `aria-label="關閉個人頁"`；IG 按鈕
  outlined（「選擇○○」是唯一 primary）並帶看不見的「（另開新分頁）」；名字、帳號、專長一律文字節點，AppBar 標題 ellipsis、Chip `maxWidth: 100%`、
  名字簡介 `overflowWrap: anywhere`；名字用 `<bdi>` 隔離方向；頭像 `slotProps.img` 帶 `referrerPolicy="no-referrer"`；IG href 一律取渲染當下
  `instagramProfileUrl()` 的回傳值，不用 `next/link`。
- 「選擇○○」傳給 `onSelect` 的 designer 必須是 `designers` 名單內的同一個物件。

測試補充
- jsdom 的 `window.history` 同檔共用，`beforeEach` 以 `history.replaceState(null, "")` 重置；以 `vi.spyOn(history, "back")`＋手動 dispatch `PopStateEvent`
  為主，另保留一個真的來回一次的測試。案例：連按開啟、連按關閉、Esc 關閉、舊 session token 的 state（模擬重新整理）、名單找不到該 id、
  `event.state` 為 null／數字／字串／陣列／非字串 id／`__proto__`／`constructor`／超長字串／名單外 uuid、前進重開、掛載時殘留 state 不開也不 `back()`、
  開關過程沒有 fetch／Storage 呼叫、卸載移除監聽。PortfolioGrid：img src 集合與輸入相同、Alt+←／Ctrl+→ 不切換、放大檢視未開時方向鍵不作用。
- 走查必須斷言 push 之後 `history.state.__NA === true`，並以 window 上的標記證明返回／前進沒有 reload；記錄「關閉後捲動位置」是否已滿足。

已知限制（登記，不處理）
- Next 在 refresh／server action 時會清掉自訂 history state（前台目前沒有這類呼叫，dev HMR 可能造成假警報）；清掉後關閉走「直接關閉」，留下一筆空歷史。
- 名字與專長只靠資料庫擋方向／零寬字元（`toPublicDesigner` 只處理簡介），另開卡；全站無 `Referrer-Policy`／CSP；IG 帳號允許 `..`（仍固定在 instagram.com）。
- LINE／IG 內建瀏覽器可能忽略 `target="_blank"`，iOS Safari 手勢返回動畫（快照＋淡出）未做實機走查。
- 全頁九宮格一次載入最多 12 張原圖（每張上限 5 MB），行動網路下載量偏大（效能，非安全）。

## 完成證據

- 變更的檔案：`app/_components/booking/DesignerProfileDialog.tsx`、`components/ui/PortfolioGrid.tsx`（新增）、`app/_components/booking/DesignerPickerSection.tsx`、
  `ai/context/design-system.md`、`tests/components/portfolio-grid.test.tsx`、`designer-profile-dialog.test.tsx`（新增）、`designer-picker-section.test.tsx`
- 執行過的指令、測試輸出、走查：見 [`verification/TASK-074.md`](../verification/TASK-074.md)（tsc、lint、build 通過；全套 vitest 934／934）
- 螢幕截圖：走查時的截圖在對話中（亮色／暗色個人頁、放大檢視、無 IG＋空作品集）
- 已知限制：見驗證報告「殘留風險與已知限制」
- 後續任務：無
