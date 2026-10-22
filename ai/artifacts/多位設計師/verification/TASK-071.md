# 驗證報告

## 摘要

- 任務：TASK-071 多位設計師 「作品集」頁籤（上傳、刪除、12 張上限）
- 結果：通過（有殘留風險，見下方）
- 驗證者：實作 agent（Claude Code）。動工前 architect、security-reviewer 兩份審查意見**不等同人工核准**；
  product／ui／architecture／security／test／code_review 關卡待人工核准。**尚未做實作後的 security／test 審查**
  （是否補做由人工決定）。

## 指令

| 指令 | 結果 | 備註 |
|---|---|---|
| `npx tsc --noEmit` | 通過 | |
| `npm run lint` | 通過 | 0 error、0 warning |
| `npm run build` | 通過 | 路由清單不變。build 前先停掉 dev server，build 後重啟 |
| `npx vitest run --maxWorkers=3`（全套） | 771／774 通過，3 項逾時失敗 | 失敗全在 `tests/components/account-settings-view.test.tsx`（5 秒逾時），沒改到的檔案；該檔單獨跑 33 項全過。與 TASK-069／070 報告記載的「預設並行度下無關檔案偶發逾時」同一類，判斷為機器負載 |
| `npm run test:designers -- -t "TASK-071"`（真實 Supabase 專案） | 通過 | 11 項（見下方），afterAll 的清除斷言通過，無殘留 |
| 瀏覽器走查（登入後台，真實專案） | 通過 | 見下方「走查」 |

本卡新增的測試：

- `tests/admin/designers-write.test.ts`（擴充，新增 25 項）：
  - `parsePortfolioStoragePath`、`listPortfolio`（明確欄位不含 `storage_path`、`created_at desc, id desc`）。
  - `uploadPortfolioImage`：成功（長邊 1600、`upsert:false`、`cacheControl:"300"`、insert 剛好三個欄位）；驗證／編碼失敗不上傳（不退回原檔）；
    Storage 上傳失敗清檔；第 13 張（`P0001`＋前綴）回上限文案並補刪；`P0001` 無前綴、前綴但 code 不對不算上限；SQLSTATE 確定失敗；
    **結果不明**（`code` 為 `""`、`"20"`、undefined、沒有 error 但不是 1 列）一律重讀，列在就當成功、不補刪；重讀確定沒有才補刪；
    重讀失敗或例外一律不刪檔。
  - `deletePortfolioImage`：先讀 `storage_path` 再 delete（兩個 eq）再刪檔；找不到／0 列不呼叫 remove；`remove` 失敗回警告與可重試路徑；
    路徑被竄改（別位設計師）仍刪資料列但不 remove；delete 結果不明時重讀（列已不在照樣刪檔、列還在或重讀失敗不動檔案）；大寫 id／非 uuid 不送請求。
  - `removePortfolioFile`。
- `tests/lib/designers.test.ts`（新增 6 項）：`resolvePortfolioImageUrl`（自己的 jpg／png／webp 通過；query／hash、別位設計師、頭像路徑、
  多一層資料夾、副檔名、編碼斜線、路徑穿越、外部網域、大寫 designerId 一律拒絕）、`portfolioLimitMessage`。
- `tests/lib/image-reencode.test.ts`（新增 3 項）：`maxDimension` 1600／預設 1024／不放寬原圖上限。
- `tests/components/portfolio-manager.test.tsx`（新增，11 項）：空狀態、有作品、佔位格、達上限（點擊與拖放都不上傳）、上傳中鎖定、
  上傳失敗行內文案、例外、拖放多檔只取第一張、二次確認、刪除失敗、刪除中鎖定上傳。
- `tests/components/designer-portfolio-tab.test.tsx`（新增，11 項）：載入、空狀態、佔位格計入張數、載入失敗、上傳成功最新在前且不重讀、
  上傳失敗重讀、刪除成功、刪除失敗重讀、檔案沒刪成功的常駐警告與「重試刪除檔案」、重試失敗與關閉、沒有重試路徑。
- `tests/components/designer-edit-view.test.tsx`（擴充，新增 2 項、改 1 項）：作品集面板常駐掛載且用資料庫回傳的小寫 id、新增模式不掛載；
  頁籤張數回報與兩個頁籤的無障礙名稱各自不同；原「占位內容」案例改成「請假」。
- `tests/designers.integration.test.ts`（擴充，新增 11 項，真實 Supabase）：
  上傳後 `image_url` 等於 `getPublicUrl(storage_path)`、公開網址 200、`cache-control: max-age=300`、`listPortfolio` 最新在前；
  第 13 張經函式被拒且資料列與檔案仍是 12 個（沒有誤刪既有檔案）；已有 11 張時並行上傳兩張，剛好一張成功；
  直接打 API 的第 13 張被 trigger 擋下（`P0001`＋`PORTFOLIO_LIMIT`）；刪除後資料列與檔案消失（公開網址 400／404）而同設計師與別位設計師的檔案都在；
  預熱快取後刪除（見殘留風險）；A 的 id 搭配 B 的作品 id 刪除失敗；刪除不存在的作品；非管理員與 anon 上傳失敗且不留檔案或資料列、
  非管理員刪除失敗（0 列）；`removePortfolioFile` 的權限與路徑白名單；**資料庫放行被竄改的 `image_url`（帶 query 指到別人的檔案），
  顯示層的 `resolvePortfolioImageUrl` 拒絕它**（證明洞存在、也證明防線有效）。

## 走查（Browser 工具，正式資料庫）

隔離做法：以 service_role 建立 `__TEST__走查071` 設計師，**建立時就是停用狀態**（停用的設計師不會被指派預約、anon 也讀不到），
沒有碰「預設設計師」與「小狗」。走查完以 service_role 刪除設計師與 12 個 Storage 檔案，查詢確認只剩「預設設計師」「小狗」、
`designers` 無 `__TEST__` 殘留、`portfolio/` 資料夾已空。

- 空狀態：「0 / 12 張」、虛線上傳格、「還沒有作品，上傳第一張吧」；頁籤標籤在點進去之前就顯示數字（「作品集 0」）。
- 上傳（以瀏覽器 canvas 產生 2400×1600、1200×1800、800×800 三張 PNG，經檔案 input 觸發 change）：看到「上傳中」spinner；
  上傳後三張都是 **webp**（真實 canvas 重新編碼），長邊縮到 **1600**（1600×1067、1067×1600、800×800），`cache-control: public, max-age=300`；
  新作品在最前面，標籤數字 3。
- 上傳中（攔截 Storage POST 延遲 8 秒）：新格子 spinner、上傳格變暗停用、既有格的刪除鈕停用；完成後恢復，張數 3。
- 刪除：點 × 出現「刪除這張作品？」；確認後那張消失、標籤數字 3→2、資料列與 Storage 檔案都消失（service_role 列資料夾只剩 2 個）；
  繞過快取（`no-store`＋查詢參數）請求已刪網址回 **400**。**未繞過快取直接請求仍回 200**——是我自己在上一步 `fetch` 讀 header 時預熱了
  瀏覽器快取，正是下方記載的快取殘留。
- 重新整理後作品與張數保留；補到 12 張後：「12 / 12 張」，上傳格停用並顯示「已達 12 張上限，請先刪除舊作品」，標籤數字 12。
- 768px 寬度：無橫向捲動，格子 4 欄排列。主控台只有 dev server 的 HMR WebSocket 連線錯誤（既有）與我刻意請求已刪網址的那一次 400。

## 螢幕截圖

由 Browser 工具擷取，未存成專案檔案：空狀態、3 張作品、刪除確認對話框、上傳中、12／12 達上限（桌面與 768px）。
**未擷取／未走查**：亮色模式；「檔案沒刪成功」警告與重試按鈕的實際畫面（元件測試涵蓋，真實專案很難製造）；網址未通過白名單的佔位格畫面
（元件測試與整合測試涵蓋）；已啟用 MFA 但只有 aal1 的 admin 情境（`test:mfa-rls` 尚未涵蓋新表，同 TASK-067／070 登記的殘留）。

## 已採納的動工前審查（詳見任務卡「動工前審查定案」）

- 「結果不明」不看 error 有沒有 code：`PORTFOLIO_LIMIT` 與 5 碼 SQLSTATE 才算確定沒寫入，其餘先用 `storage_path` 重讀，重讀失敗不刪檔。
- 刪除先讀回 `storage_path`、delete 要求剛好 1 列、結果不明時重讀、成功後才刪檔且 `remove()` 要剛好 1 個。
- 網址未通過白名單的列不濾掉，畫成可刪除的佔位格並計入張數。
- 新增 `resolvePortfolioImageUrl`（無 query／hash、pathname 完整錨定為該設計師自己的 `portfolio/`）於 `lib/designers.ts`，前台 TASK-074 重用。
- `PortfolioManager` 為純展示元件，單一 busy 鎖（上傳或刪除中一律停用）；警告用常駐 Alert 加「重試刪除檔案」；`cacheControl` 300 秒；
  作品集長邊 1600；頁籤數字改成通用 `counts` 結構。
- 人工決定四項：1600px、納入 `lib/designers.ts`、重試按鈕、300 秒。

## 實作中發現並修正

- MUI `Alert` 只要給了 `action` 就不會渲染內建關閉鈕，「有重試按鈕的警告無法關閉」；改成把「關閉」也放進 `action`（元件測試抓到）。

## 殘留風險與已知限制

- **刪除後公開網址仍可能被讀到**：整合測試實測，先讀過網址（預熱快取）再刪除，刪除後公開網址仍回 200。`cacheControl` 已從預設 3600 降到 300 秒，
  頁籤文案明講「最多約 5 分鐘」；CDN／訪客瀏覽器／爬蟲已存的副本無法收回。停用設計師不會刪除檔案，文案已提醒。
- 孤兒檔沒有清理機制：上傳成功但資料列結果不明且重讀也失敗、刪除結果不明且重讀也失敗（此時資料列可能已刪、檔案沒刪，且畫面只會顯示失敗後重讀的清單）、
  刪檔失敗後重新整理頁面。建議另開掃除卡（service_role 比對 `portfolio/<id>/` 與資料列）。
- 伺服器端不檢查檔案內容：admin 直接打 Storage API 可上傳未重新編碼的原檔（帶 EXIF）；「去 EXIF」只對 UI 路徑成立。Storage 物件數沒有上限。
- `createImageBitmap` 在檢查解析度之前就解碼整張圖（5MB 的 PNG 可以是 30000×30000），惡意圖可能讓店長的分頁崩潰；需先解析檔頭才能避免，未做。
- `image_url` 的資料庫 constraint 仍只驗結尾；本卡只在顯示層擋下，建議另開卡收緊（`substring(...) = storage_path`）。TASK-074 前台必須使用 `resolvePortfolioImageUrl`。
- 張數上限的正確性前提是 READ COMMITTED（PostgREST 預設）。
- 兩個分頁同時操作：後到的刪除回失敗並重讀；兩邊同時刪同一張且一方結果不明時，雙方都可能去刪檔，其中一方可能看到一次多餘的警告（檔案確實已刪）。
- 刪除確認文案寫「這張照片也會從預約頁移除」，前台作品集要等 TASK-073／074 才會顯示；停用中的設計師在前台本來就不顯示。
- 全套測試在預設並行度下的逾時不穩定（`account-settings-view`），非本卡引入。

## 人工核准

- 核准者：使用者
- 日期：2026-10-22
- 備註：驗收通過。實作後的 security／test 審查未做；殘留風險（快取、孤兒檔、伺服器端不檢查檔案內容等）維持已知限制。
