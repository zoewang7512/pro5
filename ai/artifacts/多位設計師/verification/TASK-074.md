# 驗證報告

## 摘要

- 任務：TASK-074 多位設計師 前台設計師全頁個人頁（仿 IG）、作品集九宮格與放大檢視、返回鍵行為
- 結果：通過（有殘留風險與待人工確認事項，見下方）
- 驗證者：實作 agent（Claude Code）。動工前 architect、security-reviewer 的審查意見**不等同人工核准**；product／ui／architecture／
  security／test／code_review 關卡待人工核准。**本卡沒有做實作後的 subagent 審查**（任務卡風險等級為中，使用者只要求動工前審查）。

## 指令

| 指令 | 結果 | 備註 |
|---|---|---|
| `npx tsc --noEmit` | 通過 | |
| `npm run lint` | 通過 | 0 error、0 warning |
| `npm run build` | 通過 | 路由清單不變。build 前先停掉 dev server，build 後重啟 |
| `npx vitest run --maxWorkers=3`（全套） | 934／934 通過（65 個檔案） | stderr 的錯誤輸出是 `email-resend-client` 測試預期的記錄 |
| `npx vitest run` 本卡三個測試檔 | 49／49 通過 | 見下方 |
| 瀏覽器走查（Browser 工具，攔截 fetch 的模擬資料，**沒有寫入正式資料庫**） | 通過 | 見下方「走查」 |

本卡新增或擴充的測試：

- `tests/components/portfolio-grid.test.tsx`（新增，11 項）：空狀態；縮圖 src 集合與輸入完全相同、`no-referrer`、lazy、alt；縮圖載入失敗保留格子；
  點格子開放大檢視與「n / total」；方向鍵切換且首尾不越界；Alt／Ctrl／Meta／Shift 與輸入法組字中不切換、也不 `preventDefault`；放大檢視沒開時方向鍵不作用；
  觸控滑動（含門檻）；Esc 與 × 只關放大檢視；放大檢視裡圖片載入失敗；作品數變少不當掉。
- `tests/components/designer-profile-dialog.test.tsx`（新增，14 項）：關閉時不渲染；名字／簡介（保留換行）／專長、Dialog 名稱指向名字；數字列只有「作品／專長」；
  AppBar 標題（帳號或名字）；IG 連結 href／target／rel／無障礙名稱；`null`、`javascript:alert(1)`、`evil.com/x`、`a b`、空字串都不渲染外連；
  HTML 字串一律純文字；作品集空；巢狀放大檢視 Esc 只關放大檢視；返回鍵與 Esc 呼叫 `onClose`；「選擇○○」傳入同一個物件且是唯一的 primary 按鈕。
- `tests/components/designer-picker-section.test.tsx`（擴充，原 10 項改 uuid 設計師 id、移除「作品集連結不做事」，新增 14 項 history 案例）：
  `pushState` 一次（兩個參數、沒有 url、state 只有 id 與 session）；連點開啟只 push 一次（第二次 `replaceState`）；AppBar 返回鍵 `back()` 一次後才關閉（真的來回）；
  連點關閉（返回鍵×2＋Esc）只 `back()` 一次；Esc 走 `back()`；「選擇○○」`onSelect` 收到名單裡同一個物件且連點只呼叫一次；瀏覽器返回關閉、前進重開；
  13 種不合格 `popstate` state（null／數字／字串／陣列／空物件／非字串 id／`__proto__`／`constructor`／10 萬字／名單外 uuid／舊 session／缺 session）一律關閉不拋例外；
  名單內的 id 才開；重新整理後殘留舊 entry（掛載時不開、不 `back()`，之後開啟是新 push、關閉只需一次 `back()`）；`pushState` 拋例外仍可開關；
  名單換掉後找不到設計師當成已關閉；區塊收合時個人頁不被卸載也不重新 push；開關期間沒有 `fetch`、卸載移除 `popstate` 監聽。
- 發現並修正一個測試問題：`renderWithTheme` 的 `rerender` 沒有 ThemeProvider 包裝會整棵重新掛載（使「名單換掉」「區塊收合」兩個案例假通過），
  改用受控 Harness 更新 props。

## 走查（Browser 工具）

隔離做法：不寫入正式資料庫。先到 `/admin` 裝好 `window.fetch` 攔截（只回傳 `designers` 查詢的模擬資料：三位設計師，其中一位 9 張作品＋IG、一位無 IG 無作品、
一位 5 張作品）與設計師圖片改成 canvas 漸層，再用 Next client-side 導覽回 `/`，讓預約頁在攔截生效後才建立 Supabase client。其他請求（服務、營業時間、時段）仍走真實專案，
所以模擬設計師的假 id 會讓 `get_available_slots` 回 400／409（走查假資料的副作用，不是程式問題）。

- 375px：選服務 → 選林小美 → 預覽卡 → 「看完整作品集 ›」開啟全頁個人頁。`history.state` 含 `designerProfile`、`designerProfileSession` 與 Next 補上的 **`__NA: true`**；
  網址沒變；window 上預先放的標記在整個流程（開、返回、前進）都還在，證明**沒有 reload**。
- 個人頁：AppBar（IG 帳號）、頭像＋數字列「9 作品／3 專長」（沒有年資）、名字、簡介換行、專長標籤、「前往 Instagram ↗」、三欄 2px 九宮格、底部「選擇林小美」。
- 放大檢視：點第 3 張 → 方向鍵右切為 4 / 9 → Esc 只關放大檢視（個人頁仍在、`history.length` 沒變）→ 瀏覽器返回只關個人頁，停在預約頁，
  已選的服務與設計師保留。
- 前進重新開啟個人頁成功；連點關閉鈕三次只退一步（仍在 `/`、標記在，沒有退到上一個 entry `/admin`）。
- 「選擇王大明」連點兩次：選取態變成王大明、個人頁關閉、只退一步、焦點回到按鈕。
- 無 IG＋作品集空（王大明）：沒有 IG 按鈕、顯示「尚無作品／這位設計師還沒有上傳作品」；桌面寬度內容限制在 `maxWidth="sm"`。
- 暗色模式（用 App 的切換鈕）：個人頁與放大檢視（固定黑底、白字、點點與按鈕可讀）都正常。
- 走查中發現 AppBar 底部被主題的 Paper 圓角蓋過（`square` 無效），已改 `sx={{ borderRadius: 0 }}`，量測 `borderRadius` 為 `0px`。
- 主控台：只有 dev server 的 HMR WebSocket 錯誤（既有）、上述假資料造成的 400／409、我第一版攔截函式的 bug（Next 傳 `URL` 物件，已修）；
  另有一次 `DesignerProfileDialog is not defined`，發生在我分段編輯 `DesignerPickerSection.tsx` 時 Fast Refresh 撞到半成品，完成編輯後沒有再出現，`npm run build` 通過。

## 已採納的動工前審查（詳見任務卡「動工前審查定案」）

- 不新增 `buildInstagramUrl`，沿用 `instagramProfileUrl`（TASK-073 殘留風險已指出重複）；`lib/designers.ts`、`tests/lib/designers.test.ts` 不變更。
- history：每次載入的 session token（修正重新整理後殘留 state 讓個人頁關不掉）、`pendingBackRef` 防連點退兩頁、已在個人頁 entry 時改用 `replaceState`、
  Esc／返回／「選擇○○」同一條關閉流程、`pushState` 只在 click 內同步呼叫並 try/catch、popstate 讀值先檢查型別與 `isDesignerId` 再用 `Array.find`、檔內 hook 不抽共用檔。
- `open`＋`designer` 分開並在 `onExited` 清除；單一 return 讓 Dialog 位置固定；`#designer-step` 加 `tabIndex={-1}` 作為焦點回退。
- `PortfolioGrid`：`{ id, src }` 命名、放大檢視用 `common.black`／`common.white`、方向鍵掛在 Dialog 且排除修飾鍵與 `isComposing`、`key={designer.id}` 重置。
- 範圍擴張：允許清單補 `tests/components/designer-picker-section.test.tsx` 與本驗證報告；移除 `lib/designers.ts`、`tests/lib/designers.test.ts`；`ai/context/design-system.md`
  除了 `PortfolioGrid` 另登記全頁個人頁。
- 規格差異的處理：screen-spec／mockup 要求「左右滑動＋點點」，任務卡寫「按鈕＋方向鍵＋張數」，**兩者都做**（另加簡易觸控滑動）。

## 殘留風險與已知限制

- **觸控滑動只有單元測試**（模擬 touchstart／touchend），沒有在實體手機或觸控模擬上走查；iOS Safari 手勢返回（快照動畫接 Dialog 淡出，看起來可能像兩段動畫）與 LINE／IG 內建瀏覽器
  （可能忽略 `target="_blank"` 而導離預約頁）**未走查**。
- 「關閉後捲動位置回到設計師步驟」：走查資料下頁面不足一屏，無法觀察捲動還原。實作上沒有呼叫 `scrollIntoView`（MUI 的 Dialog 鎖定 body 捲動，Next 的 traverse 不重設捲動），
  只在原連結被卸載（「選擇○○」使區塊收合）時把焦點移到 `#designer-step`（`preventScroll`）。若人工在長頁面發現捲動跑掉，另開卡處理。
- 放大檢視開著時按瀏覽器返回會連個人頁一起關（放大檢視不寫 history，已知行為）。
- Next 在 refresh／server action 時會清掉自訂 history state（前台目前沒有這類呼叫；dev HMR 可能造成假警報）；清掉後關閉走「直接關閉」，留下一筆空歷史。
- 名字與專長只靠資料庫擋方向／零寬字元（`toPublicDesigner` 只處理簡介），另開卡（可併入 TASK-069 L2 的簡介 constraint 卡）；個人頁已用 `<bdi>` 隔離名字方向。
  全站仍無 `Referrer-Policy`／CSP；IG 帳號格式允許 `..`（組出的網址仍固定在 instagram.com，只是連到首頁）。
- 全頁九宮格一次載入最多 12 張原圖（每張上限 5 MB），行動網路下載量偏大（效能，非安全）。
- `ai/context/project-map.md` 第 102 行仍寫「TASK-074 在此加個人頁」，不在本卡允許變更範圍，未更新，建議下次更新專案地圖時一併改。
- 走查途中遇到一次使用量上限中斷，恢復後從放大檢視步驟接著做，已重新確認狀態（頁面標記、history、dialog 數量），沒有遺漏步驟。

## 人工核准

- 核准者：使用者
- 日期：2026-10-22
- 備註：驗收通過。殘留風險與已知限制維持原記錄（觸控滑動、iOS Safari 手勢返回、LINE／IG 內建瀏覽器未實機走查等）。
