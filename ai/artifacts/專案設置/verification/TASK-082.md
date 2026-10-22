# 驗證報告

## 摘要

- 任務：TASK-082 UI 設計系統 後台「未儲存變更」離開提示：商店基本資料、帳號設定、營業時間
- 結果：**通過**（有已知限制與殘留風險，見下方）
- 驗證者：實作 agent（Claude Code）。product／ui／architecture 關卡已由使用者核准計畫與變體 B；
  security／test／code_review 關卡待人工核准。**本卡沒有做實作後的 subagent 審查。**
- 分支：`feat/task-081-unsaved-changes-guard`（與 TASK-081／083 同一分支）

## 指令

| 指令 | 結果 | 備註 |
|---|---|---|
| `npx tsc --noEmit` | 通過 | 0 錯誤（中途抓到我 `it.each` 的型別問題，已修） |
| `npm run lint` | 通過 | 0 error、0 warning |
| `npm run build` | 通過 | build 前先停 dev server、build 後重啟 |
| `npx vitest run --maxWorkers=3`（全套） | 1160～1162／1163 通過 | 失敗的都是既有的 5 秒逾時（見下方「全套測試的逾時」），每次失敗的項目不同；本卡新增的測試在最後一次全套全數通過 |
| 整合測試 | 未重跑 | 本卡不動 migration、RPC、資料層，依任務卡驗證契約不需要 |

本卡新增的測試（共 41 項）：

- `tests/admin/business-hours.test.ts`（新增 7）：`hasBusinessHoursChanges`——相同、改公休、改開店、改打烊、七列任一不同（含週日 `weekday=0`）、改回原值、列數不同。
- `tests/components/business-hours-form.test.tsx`（新增 10）：載入完成／載入中／載入失敗皆乾淨；切換公休；改開店／打烊時間與改回原值；
  **連續編輯不洗掉 `savedRows`（防回歸，對應 `updateRow` 改成 `{ ...prev, rows }`）**；儲存成功重新載入後乾淨；儲存失敗維持有變更；沒有 Provider。
- `tests/components/store-settings-form.test.tsx`（新增 12）：載入完成／載入中／載入失敗；四個欄位各自改動；改回原值；儲存成功→乾淨、失敗→維持；
  **上傳 Logo（即時儲存）不計入變更**；沒有 Provider。
- `tests/components/account-settings-view.test.tsx`（新增 10）：兩個 key 各自獨立（只改名稱／只改 Email／兩者皆改）；改回原值；Email 只差大小寫與空白不算變更；
  **四個密碼欄位輸入都不計入**；**顯示名稱「Zoe 」儲存成功後乾淨（trim 比對）**；只輸入空白不算變更；沒有 Provider。

### 突變測試（驗證測試不是空轉）

暫時植入錯誤、確認對應測試會失敗，每次跑完還原並以 `cmp` 驗證檔案與備份一致：

| 突變 | 結果 |
|---|---|
| 顯示名稱 dirty 不 trim | 2 項失敗 ✅ |
| `updateRow` 洗掉 `savedRows` | 6 項失敗 ✅ |
| 密碼欄位誤接 guard（`account-email` 併入 `newPassword`） | 1 項失敗 ✅ |
| `hasBusinessHoursChanges` 忽略 `close_time` | 3 項失敗 ✅ |

## 瀏覽器走查（`localhost:3000`，登入後台，正式資料庫）

**守則**：全程**一律不按任何儲存鈕**，只在畫面上改了再離開；走查前記錄原值，走查後確認伺服器端沒變。
原值：店名「普洛午理髮廳」、電話 02-1234-5678、地址「台北市大安區忠孝東路四段1號」；營業時間週一至週六 10:00–19:00、週日公休；顯示名稱「店長」。

| 情境 | 結果 |
|---|---|
| 商店資料：店名加一個字 → 點側邊欄「營業時間」 | **被攔截**：網址不變、對話框出現、輸入仍是改過的值、**焦點在「繼續編輯」** ✅ |
| 商店資料：按「繼續編輯」 | 對話框關閉、停留原頁、輸入保留 ✅ |
| 商店資料：把字刪回原值 → 點側邊欄 | **不提示**、直接導覽到 `/admin/business-hours` ✅ |
| 營業時間：週一打烊改 20:00 → 點側邊欄「服務設定」 | 被攔截，網址不變，仍是 20:00，焦點在「繼續編輯」✅ |
| 營業時間：「放棄變更」 | 導覽到 `/admin/services`，無殘留對話框 ✅ |
| 帳號設定：只在密碼卡片的「新密碼」「確認新密碼」填假測試字串（18 字元，不是真實密碼、未送出）→ 點側邊欄 | **不提示**、直接導覽 ✅ |
| 帳號設定：顯示名稱加一個字 → 點側邊欄 | 被攔截，焦點在「繼續編輯」✅ |
| 帳號設定：Esc | 等同「繼續編輯」：對話框關閉、停留、輸入保留 ✅ |
| 帳號設定：再點側邊欄 →「放棄變更」 | 導覽到 `/admin/services`；重新取得 `/admin/account` 頁面與側邊欄都**沒有**改過的名稱（沒存）✅ |

截圖（Browser 工具擷取，**未存成專案檔案**）：商店基本資料、營業時間、帳號設定各一張有提示的畫面，皆為暗色模式。

**未走查**：亮色模式（提示對話框的亮／暗外觀已在 TASK-081 驗證，本卡沒有新增任何視覺元件，只重用同一個對話框）；
登入 Email 欄位的瀏覽器走查（由單元測試涵蓋：只改 Email、大小寫與空白、改回原值）；登出被攔截（TASK-081 已走查，本卡沒有改動登出接線）；
`beforeunload` 原生提示（無法自動化）。

## 發現的問題

1. **任務卡寫的測試路徑不存在**：卡上寫 `tests/lib/business-hours.test.ts`（擴充），但實際既有檔案是 `tests/admin/business-hours.test.ts`。已擴充後者；未新增錯誤路徑的檔案。
2. **全套測試的逾時（既有環境問題，非本卡造成）**：全套並行時會有 1～3 項 5 秒逾時，每次失敗的項目不同（`account-settings-view`「新密碼與確認密碼不一致」、`login-form` 兩項）。
   我把變更暫存（stash）還原到基準後重跑，**同一項「新密碼與確認密碼不一致」在沒有我的變更時一樣逾時**（單獨跑該檔也會，約 5.5 秒）；TASK-069～081 報告也都記載過。
   我自己新增的「密碼欄位」測試原本也因逐字 `user.type` 四個欄位而逾時，已改用 `fireEvent.change`，並重新確認突變仍被抓到。
3. **我在驗證過程中差點造成混亂的一步**：為了確認「基準是否也會逾時」而用了 `git stash`，但未追蹤的新測試檔不會被 stash，所以基準跑出 14 項失敗是新測試在沒有功能時失敗（符合預期），不是回歸。已確認 stash 清空、變更完整還原（`git stash list` 為空、`cmp` 驗證一致）。

## 已知限制與殘留風險

- **瀏覽器上一頁／下一頁不攔截**（已決定）。
- **`beforeunload` 的原生對話框無法自動化驗證**（同 TASK-081）。
- **密碼區塊不計入變更**（規格 A1，已決定）：使用者只在密碼欄位打字就離開，不會被提示。
- **顯示名稱儲存成功後仍可能被判定有變更**：`refresh()` 內 `getAdminProfile` 失敗時 `displayName` 不會更新（`AdminProfileContext.tsx`），儲存成功後輸入與基準值仍不同。屬任務卡已列的殘留風險，本卡不處理。
- 營業時間：儲存進行中選「放棄變更」，寫入仍可能成功，提示文案會失準；`handleSubmit` 先查「受影響預約」再寫入，期間表單被 `submitting` 鎖住，但側邊欄仍可點。
- 營業時間「儲存變更」後需等 `loadRows()` 重新載入才會乾淨；若重新載入失敗，頁面會切成錯誤狀態（本來就是既有行為），此時 guard 回報乾淨。
- **`ClosedDatesSection`（公休日）、Logo／封面圖上傳、頭像更換**是即時儲存的動作型控制項，刻意不納入。

## 變更的檔案

- 修改：`app/admin/_components/StoreSettingsForm.tsx`（`BasicInfoCard` 加一行 guard）、`AccountSettingsView.tsx`（兩行 guard，名稱用 trim 後的新布林、不動 `hasNameChanges`）、
  `BusinessHoursForm.tsx`（`LoadState.loaded` 加 `savedRows`、`updateRow` 改為 `{ ...prev, rows }`、一行 guard）、`lib/admin/business-hours.ts`（新增 `hasBusinessHoursChanges`）、
  `tests/admin/business-hours.test.ts`、`tests/components/account-settings-view.test.tsx`（補 `next/navigation` mock）、`ai/context/project-map.md`
- 新增：`tests/components/store-settings-form.test.tsx`、`tests/components/business-hours-form.test.tsx`
- 未觸碰：各表單的儲存邏輯與驗證規則、資料層、圖片上傳控制項、密碼區塊、`ClosedDatesSection`、TASK-081 的共用機制。
