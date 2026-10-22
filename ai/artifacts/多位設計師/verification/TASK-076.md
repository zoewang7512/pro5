# 驗證報告

## 摘要

- 任務：TASK-076 多位設計師 四種通知信顯示設計師名稱
- 結果：通過（有殘留風險，見下方）
- 驗證者：實作 agent（Claude Code）。動工前 architect、security-reviewer 的審查意見**不等同人工核准**；product／architecture／security／
  test／code_review 關卡待人工核准。**本卡沒有做實作後的 subagent 審查**（使用者只要求動工前審查）。

## 指令

| 指令 | 結果 | 備註 |
|---|---|---|
| `npx tsc --noEmit` | 通過 | |
| `npm run lint` | 通過 | 0 error、0 warning |
| `npm run build` | 通過 | 路由清單不變。**失誤記錄**：build 時沒有先停 dev server，兩者同時寫 `.next`，弄壞 `.next/dev/types/validator.ts`（被 git 忽略的產生檔），讓 `tsc` 出現 4 個 `.next/` 內的錯誤；已停掉 dev server、刪除該產生目錄並重啟，最終 `tsc --noEmit` 0 錯誤 |
| `npx vitest run tests/lib tests/admin/appointment-reminders.test.ts tests/api/appointment-events-webhook.test.ts tests/api/appointment-reminders-cron.test.ts` | 285／285 通過（18 個檔案） | 含四支範本、攤平函式、webhook、cron 本卡新增與擴充的案例（最終程式碼） |
| `npm run test:notifications`（真實 Supabase 專案） | 20／20 通過 | 含本卡新增 1 項與擴充 5 項（見下方），afterAll 清除無殘留 |
| `npm test`（全套） | 1003／1040 通過，37 項失敗全是 5 秒逾時 | 失敗檔案全在 `tests/components/*`（`login-form`、`account-settings-view`、`designer-*`、`appointment-detail-dialog`），**本卡沒有改任何元件**。單獨重跑那 6 個檔案：98／104 通過，6 項仍是 5 秒逾時。**暫存本卡變更、在乾淨的 HEAD 上跑同一批檔案：99／104 通過，5 項同樣是 5 秒逾時**，確認為既有的環境逾時，與本卡無關（TASK-069～075 報告已記載同一類逾時） |

本卡新增或擴充的測試（單位：項，含 `it.each` 展開）：

- 四支範本測試（`tests/lib/email-{confirmation,reminder,cancellation,reschedule}-template.test.ts`，各 +8，共 +32）：有 `designerName` 輸出 `<li>設計師：○○</li>` 且主旨不含名稱；
  `undefined`／`null`／`""`／全空白都不輸出該行也不留空的 `<li>`；`<script>` 被跳脫；雙引號、單引號、`&` 分別跳脫成 `&quot;`、`&#39;`、`&amp;`；名稱含換行時主旨不出現換行。
- `tests/api/appointment-events-webhook.test.ts`（+8）：mock 補 `designers` 表與 `designersThrows`；確認信帶入名稱且主旨不含；名稱 `<script>` 跳脫；`designers` 查無資料仍寄信；
  **`designers` 回 `{error}` 仍寄信且不釋放去重佔位**；**`designers` throw 時不寄信並釋放去重佔位（既有補償路徑）**；`designer_id` 為空不查 `designers`；
  取消信與改期信都帶入名稱；UPDATE 分支 `designers` 回 error 仍寄信。
- `tests/admin/appointment-reminders.test.ts`（擴充）：`designers` 物件、陣列、`null`、非字串（數字）四種形狀攤平成 `designer_name`。
- `tests/api/appointment-reminders-cron.test.ts`（+2）：提醒信帶入名稱且主旨不含、名稱跳脫；`designers` 內嵌為 `null` 仍寄信並省略該行。
- `tests/notifications.integration.test.ts`（真實 Supabase，+1 新項、5 項補斷言）：確認信、取消信、改期信內文含 `<li>設計師：${name}</li>`；
  **新增已停用（`is_active=false`）測試設計師**：webhook 確認信與 cron 提醒信（內嵌 `designers(name)`）以 service_role 仍讀得到名稱。
  停用設計師用 `createTestDesigner(..., { tag: "noff", isActive: false })`，納入 afterAll 的 `cleanupTestDesigners`；`customer_email` 沿用「先 null 再補」的既有防護，不驚動正式 trigger。

## 實際驗證的行為

- 查詢路徑對真實資料庫成立：`designers` 對 service_role 的 grant 足夠、停用設計師也讀得到、`appointments → designers` 內嵌沒有 FK 歧義（cron 整合測試通過）。
- 失敗模式如審查所要求：webhook 設計師查詢失敗不影響確認信；cron 內嵌失敗等同 claim 失敗（與 `services(name)` 相同，**已在任務卡與程式註解誠實記錄**）。

## 螢幕截圖

未擷取。任務卡把「確認信實際收信截圖」併入 TASK-077 的手動 E2E（正式流程送一筆預約）。本卡驗證的是範本輸出與寄送路徑（`sendEmail` 全程 mock，不實際寄信）。

## 已採納的動工前審查（詳見任務卡「動工前審查定案」）

- webhook claim 不內嵌 `designers`；名稱另查、失敗只記 log 並省略該行。
- 攤平函式與範本防禦非字串；空值或全空白整行省略。
- `reschedule.ts` 補 `.filter(Boolean)`；各信插入位置明確（取消信在「原預約時段」後、改期信在「新時段」後）。
- 不加 `is_active` 條件；整合測試以停用設計師釘成回歸。
- `route.ts` 檔頭補記「不能改派設計師」的前提。
- 未動 migration、trigger payload、`classifyAppointmentUpdate`、寄信觸發條件。

## 殘留風險

- cron 內嵌 `designers(name)` 失敗會讓當天整批提醒不寄（隔天重撈）；與既有 `services(name)` 相同的取捨。
- UPDATE 分支重讀 `designer_id` 依賴「預約不能改派設計師」；日後做改派要改讀 payload 快照（已寫在 `route.ts` 檔頭）。
- 設計師名稱可能是 `www.evil.tw` 這類字串，部分信箱會自動轉連結；輸入者為管理員、上限 30 字。
- 設計師查詢失敗時信件會缺少設計師一行（僅記 log，沒有告警機制）。
- 未做實作後 subagent 審查；實際收信截圖待 TASK-077。
