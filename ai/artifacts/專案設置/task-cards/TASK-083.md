# AI-Ready 任務卡

## Metadata

- 任務：UI 設計系統 後台「未儲存變更」離開提示：設計師基本資料、頁籤圓點、服務項目對話框
- 上層規格：[`feature-spec-未儲存變更離開提示.md`](../feature-spec-未儲存變更離開提示.md)（人工已核准 2026-10-22）
- 畫面規格／mockup：[`screen-spec-未儲存變更離開提示.md`](../screen-spec-未儲存變更離開提示.md)、[`mockup-decision-未儲存變更離開提示.md`](../mockup-decision-未儲存變更離開提示.md)（**變體 B：對話框＋「基本資料」頁籤圓點**）
- 上層 Epic：專案設置
- 上層 User Story：UI 設計系統
- 分軌：前端
- 前置任務（dependsOn）：TASK-081（共用機制）
- 狀態：**已驗證，待人工驗收**（計畫已於 2026-10-22 經使用者核准；實作與驗證完成，見 [驗證報告](../verification/TASK-083.md)）
- 風險等級：中（前端互動；包含最複雜的一組：新增模式、專長標籤輸入中、麵包屑、對話框疊加）
- Agent owner：Claude Code
- 人工核准者：使用者
- 分支：`feat/task-081-unsaved-changes-guard`（與 TASK-081／082 同一分支，依序實作）

## 目標

套用共用機制到設計師編輯頁（基本資料含新增模式、麵包屑、頁籤圓點）與服務項目新增／編輯對話框。

## 情境包（Context Pack）

- 相關檔案：
  - `app/admin/_components/DesignerBasicInfoForm.tsx`（`hasChanges = isCreate || !sameFields(normalizeFields(fields), savedFields)`——**新增模式恆為 true，不能直接當 dirty 用**；專長標籤是 MUI `Autocomplete multiple freeSolo`，輸入框內文字目前**沒有被追蹤**）
  - `app/admin/_components/DesignerEditView.tsx`（頁籤以 `hidden` 保持面板掛載；兩處 `NextLink` 麵包屑；`Tabs` 的「基本資料」`Tab` 標籤；新增成功後 `router.replace`）
  - `app/admin/_components/ServiceFormDialog.tsx`（`<Dialog open onClose={submitting ? undefined : onClose}>`；「取消」鈕呼叫 `onClose`；表單是 `useState(() => toFormState(service))` 播種一次）
  - `app/admin/_components/ServicesTable.tsx`（只在對話框要開時才掛載 `ServiceFormDialog`）
  - 既有測試：`tests/components/designer-basic-info-form.test.tsx`、`designer-edit-view.test.tsx`、`service-form-dialog.test.tsx`
- 既有模式：同 TASK-081；圓點用 MUI `Badge variant="dot"`（直接用 MUI，不建 wrapper）。
- 假設：
  - 規格 A2：專長標籤輸入框內「已輸入但未按 Enter」的文字算變更。
  - 規格 A3（已選定變體 B）：切頁籤**不攔截**（面板保持掛載、輸入保留），改在「基本資料」標籤旁顯示未儲存圓點。
  - 設計師頁籤中其他三個（提供服務、作品集、請假）是即時儲存，不納入。
- 未知事項：無。實作時需先確認 `Autocomplete` 在 `autoSelect` 下失焦會把未完成文字轉成標籤（mousedown 點側邊欄就會失焦）：兩種路徑——文字已轉成標籤（由 `fields.specialties` 變動捕捉）與文字尚在輸入框（需新增的 `inputValue` 追蹤）——都要有測試。
- 允許變更的檔案：
  - `app/admin/_components/DesignerBasicInfoForm.tsx`、`DesignerEditView.tsx`、`ServiceFormDialog.tsx`
  - 測試：`tests/components/designer-basic-info-form.test.tsx`、`designer-edit-view.test.tsx`、`service-form-dialog.test.tsx`（擴充）
  - `ai/context/design-system.md`、`ai/context/project-map.md`（同步說明）
- 不得觸碰：設計師與服務的儲存邏輯、驗證、資料層；即時儲存的三個頁籤；共用機制本身（發現缺口時停下來回報）。

## 需求

設計師基本資料（key `designer-basic-info`）：

- WHEN 編輯模式下 `normalizeFields(fields)` 與已儲存值不同，或專長輸入框內有未提交的文字 THE SYSTEM SHALL 回報有變更；改回原值、儲存成功（`savedFields` 更新）後回報乾淨。
- WHEN 新增模式下名稱、Instagram、簡介、專長標籤任一非空，或專長輸入框有文字 THE SYSTEM SHALL 回報有變更；所有欄位皆空時回報乾淨（**不得沿用新增模式 `hasChanges` 恆為 true 的判定**，儲存鈕的啟用邏輯維持不變）。
- WHEN 新增成功後 THE SYSTEM SHALL **先**把 `isDirty` 設為 false（例如 `setCreated(true)`）**再**呼叫 `onCreated`（與規格「先標記為無變更再導覽」一致）。原因：`handleSubmit` 在 `onCreated()` 之後由 `finally` 才把 `submitting` 設回 false，從成功到新頁面 commit 之間若不先標記乾淨，圓點仍在、`beforeunload` 仍掛著、點側邊欄會誤提示。`router.replace` 是程式化導覽，不攔截。
  （另記錄一個**既有且不在本卡範圍**的問題：建立成功後按鈕會重新啟用，有重複建立的風險，列入驗證報告。）

麵包屑與頁籤：

- WHEN 使用者點擊 `DesignerEditView` 頂部麵包屑的「設計師」連結（`DesignerEditView.tsx:91`）且基本資料有變更 THE SYSTEM SHALL 套用 TASK-081 的 `guardNavigate`（`Link` 的 `onNavigate`）。「找不到這位設計師」提示裡的「回設計師列表」連結（約 `:101`）出現時表單根本沒掛載，**不需要攔截**。
- WHEN 基本資料有變更 THE SYSTEM SHALL 在「基本資料」標籤旁顯示 `warning` 色圓點（MUI `Badge variant="dot"`），不論目前在哪個頁籤；WHEN 無變更或儲存成功 THE SYSTEM SHALL 立即移除圓點。圓點用 `useIsUnsavedDirty("designer-basic-info")` 讀取；須有 tooltip，**並在 Tab 標籤內放視覺隱藏文字「有未儲存的變更」**（`aria-label` 加在沒有 role 的 Badge span 上，讀屏不一定會唸），不能只靠顏色。圓點是非文字元素，對比要求 3:1（比原寫的 4.5:1 寬，仍須在亮暗色皆可辨）。新增模式同樣適用。
- WHEN 使用者切換頁籤 THE SYSTEM SHALL NOT 顯示提示。

服務項目對話框（key `service-form`）：

- WHEN 對話框內容與初始值（新增：空白預設；編輯：該服務目前值）不同 THE SYSTEM SHALL 回報有變更。
- WHEN 有變更且使用者點背景、按 Esc 或按「取消」THE SYSTEM SHALL 以 `confirmIfDirty(onClose, { key: "service-form" })` 先提示（**只看 `service-form` 這個 key**，不被頁面上別的表單誤觸發），疊在服務對話框之上；選「繼續編輯」回到服務對話框、輸入不變、焦點還原到原輸入框；選「放棄變更」關閉兩層，**焦點須回到觸發的「新增服務／編輯」按鈕**（兩層同時卸載，焦點可能掉到 body，走查要確認）。
- WHEN 對話框處於儲存中（`submitting`）THE SYSTEM SHALL 維持現況（不可關閉、不提示）。
- WHEN 儲存成功 `onSuccess()` 關閉對話框 THE SYSTEM SHALL NOT 提示。

## 驗收標準

- 設計師編輯頁：改基本資料→切到「提供服務」→「基本資料」標籤旁有圓點→點麵包屑「設計師」→提示→繼續編輯停留且輸入不變／放棄變更後離開。
- 專長標籤：輸入文字未按 Enter 時點側邊欄會提示；按 Enter 變成標籤後同樣提示；全部刪回原樣不提示。
- 新增模式：什麼都沒填就離開不提示；填了任一欄位會提示；建立成功跳到編輯頁不提示、圓點不殘留。
- 服務對話框：新增與編輯皆有變更時點背景、Esc、取消都先提示；沒變更直接關閉；儲存中不可關閉；提示完整在視窗內且在最上層。
- 圓點在亮色與暗色模式皆清楚（`warning` 色對比 ≥ 4.5:1），有 tooltip 與 aria-label。
- 既有測試全數通過。

## 實作備註

- `DesignerBasicInfoForm`：新增 `isDirty`（獨立於 `hasChanges`）。專長輸入框**不要改成受控 `inputValue`**（`freeSolo`＋`autoSelect` 在 reset 時會清空輸入框，受控容易讓文字卡住）；只用 `Autocomplete` 的 `onInputChange` 記一個「輸入框有沒有文字」的布林即可。這條路徑主要給 `beforeunload` 用：點側邊欄時 mousedown 先觸發 blur，文字此時已被 `autoSelect` 轉成標籤，由 `fields.specialties` 變動捕捉。新增模式的 dirty 與空白初始值比對。
- `DesignerEditView`：以 `useIsUnsavedDirty("designer-basic-info")` 讀取反應式狀態驅動圓點；`Tab` 的 `label` 用 `Badge` 包住文字；注意現有 `label` 對有計數的頁籤用 `Stack`＋`Chip`，基本資料目前是純文字字串。
- `ServiceFormDialog`：初始值用 lazy `useState` 另存一份（`initialForm`），`dirty = !sameForm(form, initialForm)`；`Dialog onClose` 與「取消」鈕改走 `confirmIfDirty(onClose)`。
- 圓點是「補強」，不是主要提示；主要提示仍是離開時的對話框。

## 驗證契約

- 單元測試：
  - 設計師基本資料：新增模式空白／非空；編輯模式改回原值、儲存成功；專長輸入框有文字；`autoSelect` 失焦轉標籤的路徑。
  - `DesignerEditView`：圓點顯示／消失、tooltip 與視覺隱藏文字、切頁籤不提示、頂部麵包屑點擊攔截（not-found 提示的連結不攔截）、新增成功先標記乾淨再跳轉、`onCreated` 與 `finally` 之間不誤提示。
  - `ServiceFormDialog`：新增與編輯的 dirty、Esc／背景／取消在有變更時提示、無變更直接關閉、儲存中不可關閉、儲存成功不提示。
- 整合測試：不涉及資料層，不重跑。
- E2E 測試：Browser 走查：設計師編輯頁（圓點、麵包屑、新增模式）、服務對話框（新增與編輯、疊加提示）。
- 型別檢查／Lint／Build：`npx tsc --noEmit`、`npm run lint`、`npm run build`。
- 螢幕截圖：圓點（亮色、暗色）、疊在服務對話框之上的提示。
- 安全性檢查：同 TASK-081；不保存表單內容。
- 注意：Browser 走查會碰正式庫。新增設計師與服務只能用 `__TEST__` 前綴且**不儲存**；若需驗證「儲存成功後圓點消失」，只用 `__TEST__` 資料並於結束後清除（比照多位設計師走查守則：先下架、確認名下預約都是 `__TEST__` 才刪除）。

## 完成證據

- 變更的檔案、執行過的指令、測試輸出：見 [驗證報告](../verification/TASK-083.md)。
- 螢幕截圖：Browser 工具擷取，未存成專案檔案。
- 與任務卡的差異：亮色模式圓點改用 `warning.dark`（`warning.main` 實測只有 2.995:1，未達 3:1）；`ServiceFormDialog` 關閉後明確還原焦點到觸發按鈕（走查發現焦點掉到 body）。
- 未走查：新增設計師「建立成功→圓點不殘留」的真實瀏覽器驗證（需寫入正式庫，只以單元測試驗證）。
- 已知限制：瀏覽器上一頁／下一頁不攔截；建立成功後按鈕重新啟用有重複建立風險（既有，不在本卡範圍）。
- 後續任務：無（整個 TASK-081～083 完成後合併 master）
