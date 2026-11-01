# 驗證報告

## 摘要

- 任務：TASK-111 文件、營運指令（`demo:disable`／`demo:enable`）與公開入口：README、決策紀錄、營運手冊
- 結果：**實作與自動化驗證完成，待使用者人工驗收。**`demo:disable`／`demo:enable` 對拋棄式 Demo 帳號實測通過（整合 8 項、單元 22 項）；`tsc`、`lint`、`build` 通過；`tests/lib` 全部 510 項通過。**營運手冊裡有幾組 SQL（Auth 不可用時刪 admins、檢視、輪換密碼、稽核清理、物件清單）agent 無法實跑**，已在手冊標明，需使用者第一次使用時確認（見「待你確認」）。
- 驗證者：實作 agent（Claude Code）。任務卡寫明「一般程式碼審查即可」，本卡**未啟動子代理審查**；審查關卡請使用者決定。
- 日期：2026-11-01。對正式庫只建立並刪除拋棄式帳號，已驗證無殘留（`is_demo` 帳戶 0 個、`admins` 仍 1 列）；沒有碰 `designer001`，沒有任何真實還原。

## 變更的檔案

| 檔案 | 說明 |
|---|---|
| `scripts/disable-demo.mjs` | 新增：`--disable`／`--enable`，預設預覽，`--yes` 才寫入；匯出純函式供測試 |
| `package.json` | 新增 `demo:disable`、`demo:enable`、`test:demo-disable` |
| `tests/lib/demo-disable-script.test.ts` | 新增：22 項單元測試（假 client） |
| `tests/demo-disable.integration.test.ts`、`vitest.demo-disable.config.ts` | 新增：對拋棄式帳號的整合測試（子行程跑真正的指令）；比照其他 `test:*` 慣例，是驗證契約要求的測試產物（任務卡「允許變更」清單沒列，已告知） |
| `docs/demo-account.md` | 新增：營運手冊（9 節） |
| `README.md` | 「線上體驗」加入體驗帳號說明與限制；環境變數表、指令表、專案架構補列 Demo 項目 |
| `ai/context/decisions.md` | 新增 TASK-111 條目（Epic 總決策、緊急開關、殘留風險） |
| `ai/context/project-map.md` | 新增「Demo 體驗帳戶」段落；常用指令表與 `scripts/` 列補充 |
| `ai/artifacts/顧客預約流程/task-cards/TASK-080.md` | 只改一處註記：確認信開啟、Demo 發動的改期／取消不寄信（TASK-114） |
| `.env.example` | 只改說明文字：`DEMO_RATE_LIMIT_SECRET` 補「至少 32 字元」（`lib/demo/rate-limit.ts` 的 `MIN_SECRET_LENGTH`）、緊急關閉提示 `demo:disable`；沒有改變數名稱 |
| `ai/artifacts/Demo 體驗帳戶/architecture-notes.md` | D12 補一句順序調整說明（不在任務卡允許清單內，比照 TASK-100 前例，已告知） |
| `tools/kanban/cards/TASK-111.json`、`task-cards/TASK-111.md`、本報告 | 看板與文件 |

## 與任務卡／架構筆記的差異（請確認）

1. **`demo:disable` 的順序**：任務卡與 D12 寫「刪 `admins` → 撤銷 session → 封鎖」。實作改為「刪 `admins` → **封鎖 → 撤銷 session**」。原因：先撤銷的話，封鎖前的空檔訪客還能重新登入拿到新 session，日後 `demo:enable` 重新登記 `admins` 後這個 session 會變回管理員。TASK-100 的審查已建議過「先 ban 再撤銷」。另外每一步獨立執行（一步失敗不阻止後面），符合 TASK-100 審查另一項建議。
2. **整合測試必須在沒有真實 Demo 帳戶時執行**：TASK-100 驗證報告預告過「以拋棄式 Demo 實測 `demo:disable` 會因筆數為 2 而必定失敗」。目前正式庫沒有真實 Demo 帳戶（TASK-112 才建立），所以拋棄式帳號剛好是唯一一個，指令與 `demo_revoke_sessions()` 的「剛好 1 個」規則都滿足。TASK-112 建立真實帳戶之後，這個整合測試會直接丟錯中止（不會動真實帳戶），回歸改由單元測試擔任。
3. **手冊情境 A 的步驟**：每日還原與手動還原都要求 Demo 已登記在 `admins`，所以「止血後要清掉被竄改的資料」必須先 `demo:enable`（入口已關、舊 session 已撤銷時才安全）再 `demo:reset`。已寫進手冊 §4。

## 指令與輸出

| 指令 | 結果 |
|---|---|
| `npx vitest run tests/lib/demo-disable-script.test.ts` | 22 項通過 |
| `npm run test:demo-disable`（對正式庫，拋棄式帳號） | **8 項通過**（約 20 秒），結束後拋棄式帳號清除、`admins` 筆數與測試前相同 |
| `npx vitest run tests/lib` | 26 檔 510 項通過（含 `demo-reset-test-scan` 全 repo 掃描；第一版測試檔因出現還原函式名稱被掃描擋下，已改寫） |
| `npx tsc --noEmit` | 0 錯誤 |
| `npm run lint` | 0 錯誤、0 警告（第一版有 1 個未使用參數警告，已修） |
| `npm run build` | 成功 |
| 文件掃描（`grep`：Email、`eyJ`／`sk_`／`re_`／32 位以上 hex、`hair_demo`、Supabase 專案代號） | README、`docs/demo-account.md`、`scripts/disable-demo.mjs`、`.env.example` 皆無命中 |

### 真實指令輸出（拋棄式 Demo 帳號，`DEMO_EMAIL` 指向它）

```text
$ demo:disable（預覽）
[demo-switch] Demo 帳戶 c36a9190…：admins 已登記，未封鎖。
[demo-switch] 模式：緊急關閉（disable）。將執行：
  1. 刪除 Demo 帳戶在 admins 的那一列（已發出的 session 立刻失去管理權限）
  2. 封鎖 Demo 帳戶（ban_duration 876000h，無法登入與 refresh）
  3. 呼叫 demo_revoke_sessions() 撤銷 Demo 的全部 session
[demo-switch] 這只是預覽，沒有寫入任何東西。…      exit 0

$ demo:disable -- --yes
  [OK] 刪除 admins 登記：已刪除 1 列
  [OK] 封鎖帳戶：已封鎖
  [OK] 撤銷 session：已撤銷 0 個 session
  [OK] 事後檢查：admins 已無登記、帳戶處於封鎖狀態      exit 0

$ demo:enable -- --yes
  [OK] 解除封鎖：已解除封鎖
  [OK] 重新登記 admins：已登記，顯示名稱「Demo帳號」
  [OK] 事後檢查：admins 已登記、帳戶未被封鎖            exit 0
```

（「撤銷 0 個 session」是因為這次直接跑指令的帳號沒有登入過；整合測試中有登入過的 session，見下表。）

## 驗收標準對照

| 驗收標準 | 結果 | 證據 |
|---|---|---|
| `demo:disable` 對拋棄式 Demo 實測：`admins` 列被刪、session 被撤銷、無法再登入；`demo:enable` 後恢復 | **通過** | 整合測試「`--disable --yes`」：`admins` 讀回為 null、`banned_until` 有值；**舊 access token 的 `is_admin()` 回 false**（證明立即失效）；舊 refresh token `refreshSession` 失敗；密碼正確也 `signInWithPassword` 失敗；對照組（另一個一般管理員）`admins` 列與封鎖狀態完全不變。「`--enable --yes`」：`admins` 重新登記且顯示名稱「Demo帳號」、`banned_until` 為 null、可再登入且 `is_admin()` 為 true；舊 refresh token 仍失效（恢復不讓舊 session 復活） |
| README 與手冊中沒有任何帳密、金鑰、真實 Email | **通過** | 上方文件掃描；手冊一律用 `<DEMO_EMAIL>`、`<新密碼>`、`<站台主機>` 佔位 |
| 手冊的每個指令與 SQL 都曾實跑或有對應測試證據 | **部分通過** | 指令全部有測試或實跑證據；SQL 中 §7.4 兩行 `drop trigger`、§7.5 單項停用與各 `_down.sql` 內語句相同（已實跑）。**§4 的 Auth 不可用時刪 `admins`、§7.1 檢視、§7.2 輪換密碼、§7.3 稽核清理、§7.6 物件清單查詢未實跑**（agent 沒有 SQL Editor／資料庫連線），手冊每處都標「⚠️ 未實跑」並寫了第一次使用的驗證方式。這一項我不宣稱完全達成 |
| `decisions.md` 條目包含日期與影響 | **通過** | 「TASK-111」條目：日期 2026-11-01、決策 10 項、考慮過的替代方案、影響與殘留風險 |
| `TASK-080` 註記已更新且不改變該卡其餘內容 | **通過** | `git diff` 該檔只有 3 行新增（註記）、1 行改動 |
| `demo:disable` 對非 Demo 帳號拒絕執行（安全性檢查） | **通過** | 指令不接受命令列指定帳號；目標只由「`is_demo` 嚴格為 `true` 且剛好 1 個」決定；單元測試涵蓋 0 個、2 個、字串 `"true"`、缺鍵、Email 不符、讀取時目標無標記；整合測試涵蓋「`DEMO_EMAIL` 不符」與「出現第二個 Demo」，兩者皆 exit 1 且兩個帳戶都沒有變更 |
| 指令需 `--yes` | **通過** | 整合測試「沒有 --yes」：exit 0、輸出含「預覽」、`admins`／封鎖狀態／舊 session 皆不變；`--enable` 亦同 |

## 手冊要求的額外事項核對

| 任務卡／看板留言要求 | 位置 |
|---|---|
| 更新展示內容流程（含整理前先關 `DEMO_RESET_ENABLED`） | §6；另加「先 `demo:disable`」，因為 `upload-demo-images.mjs` 在 Demo 上線中會拒絕執行（讀程式確認） |
| Auth 升級後登入全面回 500 → 只貼兩行 `drop trigger`，不用 `_down.sql` | §7.4 |
| 沒設 `DESIGNER_EMAIL` 時 Email 比對無作用 | §1 補充 |
| `DEMO_EMAIL` 是公開的，必須是作者控制的信箱 | §1 表格 |
| 寄信行為、各表筆數上限、備份流程與 `restore.sql`、備份檔何時可刪 | §8、§5 |
| TASK-117：`demo:backup -- --yes`、`.partial` 不算有效、還原只走 `restore.sql`、真實還原前重跑備份 | §5 |
| TASK-113：Storage 額度共用、手動清理、`drop trigger demo_storage_cap_guard`、`0025_down` 是安全降級、避開 03:00–04:00 跑 `test:*`、0023 檔頭「11 列」現為 14 列 | §7.5、§7.6、§8（0023 檔頭的驗證查詢：本卡不改 migration，見「殘留」） |
| TASK-116：緊急停用單表上限、惡意使用者可填滿額度 | §7.5、§8 |
| TASK-103：殘留測試帳號會讓 `demo:disable` 失敗、Auth 寄信額度與 passkey 監控 | §4、§8 |

## 殘留風險與待辦

1. **待你確認（SQL）**：TASK-112 建立真實 Demo 帳戶後，請在 SQL Editor 實際跑一次 §7.1，確認回傳剛好 1 列；§7.2 的輪換密碼建議在「還沒開放入口、先建立好帳戶」的階段演練一次（輪換成同一組新密碼，並同步 Vercel `DEMO_PASSWORD` 與 Redeploy，再用登入頁「進入體驗帳號」實測）。若 `extensions.crypt` 在你的專案報錯，改成不加 `extensions.` 前綴再試，並回報我更新手冊。
2. **README 的說明會在入口開放後才成立**：README 現在寫的是入口開啟後的行為，並註明「若沒有按鈕代表目前暫時關閉」。入口要等 TASK-112 通過驗收、你同意後才會開；README 隨 `master` 合併部署時，登入頁尚無按鈕屬預期。
3. **`0023` 檔頭驗證查詢寫 11 列、現為 14 列**（TASK-113 留言）：本卡「不得觸碰 migration」，未改。這只是註解文字，若要更正請另開小卡或同意我在 TASK-112 順手改。
4. **README 截圖**（登入頁入口）依任務卡留給 TASK-112（入口開放後才有畫面可拍）。
5. **開啟入口前的前置**：TASK-122（`audit_log` 上限）、TASK-123（欄位長度）仍在 backlog，已列於手冊 §8 與 `decisions.md`。
6. `demo:disable` 在 Supabase Auth 無法連線時四步都會失敗；手冊 §4 已補「連 Auth 都不能用時」的 SQL Editor 做法（只刪 `admins` 登記，⚠️ 未實跑，語句等同指令第 1 步）。
