# AI-Ready 任務卡

## Metadata

- 任務：多位設計師 前台設計師全頁個人頁（仿 IG）、作品集九宮格與放大檢視、返回鍵行為
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：多位設計師
- 上層 User Story：顧客選擇設計師並查看詳細資訊
- 分軌：前端
- 前置任務（dependsOn）：TASK-071, TASK-073
- 狀態：就緒前審查中（人工已於 2026-10-21 核准；動工前先完成 architect／security-reviewer 架構審查）
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
  - `lib/designers.ts`（新增 `buildInstagramUrl(handle)`）
  - `ai/context/design-system.md`（S4 inventory 登記 `PortfolioGrid`）
  - `tests/components/portfolio-grid.test.tsx`、`tests/components/designer-profile-dialog.test.tsx`、`tests/lib/designers.test.ts`
- 不得觸碰：`BookingFlow.tsx` 的 state 結構（TASK-073 已定案；只能透過 props／callback 串接）。

## 需求

- 〔審查〕history state 只放設計師 id，不放任何個資；`popstate` 時只從 TASK-073 已取得的公開名單查找該 id，查不到就
  忽略；不從 URL 或 hash 讀設計師 id 決定畫面內容。實測 Next 16 App Router 遇到自訂 state 的 popstate 行為，以及
  重新整理後呼叫 `history.back()` 會不會離開預約頁（重新整理後個人頁不會開著，不應呼叫 `back()`）。
- 開啟：`history.pushState({ designerProfile: id }, "")`；`popstate` 時關閉；用 AppBar 返回或「選擇○○」關閉時呼叫
  `history.back()`，讓歷史紀錄保持乾淨。關閉後捲動位置回到設計師步驟。
- IG 按鈕：有 `instagram_handle` 才顯示；`href = https://www.instagram.com/<handle>/`，`target="_blank" rel="noopener noreferrer"`。
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

- `buildInstagramUrl` 只接受已通過格式驗證的帳號，不合格時回傳 `null`（防禦性，資料庫已有 check constraint）。

## 驗證契約

- 單元測試：`buildInstagramUrl`；`PortfolioGrid` 空狀態、切換、`Esc` 關閉；個人頁開關時有呼叫 `pushState`／`back`。
- 整合測試：不適用（無新的資料存取）。
- E2E 測試：Browser 在 mobile preset 走查「開個人頁 → 放大第 3 張 → 右切 → Esc → 瀏覽器返回 → 確認仍在預約頁且服務還在」。
- 型別檢查／Lint／Build：`npx tsc --noEmit`、`npm run lint`、`npm run build`
- 螢幕截圖：個人頁（有作品、無 IG 且無作品）、放大檢視、暗色模式。
- 安全性檢查：IG 連結只由帳號組成固定網域網址、帶 `noopener noreferrer`；圖片網址經白名單。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：
- 已知限制：
- 後續任務：無
