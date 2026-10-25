# AI-Ready 任務卡

## Metadata

- 任務：`write-excel-file` 名稱為 `constructor`／`__proto__` 等時匯出檔寫壞的問題（重現、上游回報草稿、選定因應方式）
- 來源：TASK-093 security-reviewer 審查 L-1（Low）與 Epic 總覽審查確認；目前列為「已知限制」。
- 上層規格：[`feature-spec.md`](../feature-spec.md)（匯出需求）、[`architecture-notes.md`](../architecture-notes.md)（§5 匯出）
- 上層 Epic：儀表板與報表
- 上層 User Story：匯出報表為 Excel
- 分軌：前後端串接（套件缺陷處理）
- 前置任務（dependsOn）：TASK-093
- 狀態：草稿
- 風險等級：低（只影響匯出檔完整性；名稱只有店長能寫；不是注入）
- Agent owner：Claude Code
- 人工核准者：待使用者核准計畫

## 目標

把上游缺陷說清楚、可重現，交由使用者回報；並在「等上游修」「本地 patch」「匯出端防呆」之間做出決定，使這個已知限制有明確的處置而不是無限期擱置。

## 情境包（Context Pack）

- 缺陷（security-reviewer 實測）：`write-excel-file@4.1.1` 的 `modules/xlsx/initializeSharedStrings.js`（約第 3 行）把共用字串表寫成一般物件 `{}`。字串剛好等於 `Object.prototype` 成員（`constructor`、`toString`、`hasOwnProperty`、`valueOf`、`__proto__`…）時，查表得到的是原型上的函式或物件而不是 `undefined`，該儲存格被寫成 `function Object() { [native code] }` 或 `[object Object]` 之類的內容，且該字串不會進 `sharedStrings.xml`。Excel 開檔會跳修復對話框、那格變空白或內容錯誤。
- 影響範圍：只影響完整性與可用性；**不是** prototype pollution（程式只讀不寫）、不是 XML／公式注入。觸發來源是服務名稱與設計師名稱（`reports-export.ts` 的 `text(row.name)`、選了單一設計師時的 `designerLabel`），只有店長能寫入這些欄位。
- 套件資訊：MIT、唯一相依 `fflate`；上游倉庫為 GitLab（`catamphetamine/write-excel-file`，以 `package.json` 的 `repository` 欄位為準）。
- 既有紀錄：`ai/context/decisions.md` 的 TASK-093 段「已知限制」。
- 允許變更的檔案：
  - `ai/artifacts/儀表板與報表/upstream-issue-write-excel-file.md`（新增：最小重現、預期與實際、環境、建議修法的上游回報草稿）
  - `ai/artifacts/儀表板與報表/verification/TASK-096.md`（新增）
  - `ai/context/decisions.md`（記錄選定的因應方式；若選「等上游」只更新已知限制的狀態）
  - **僅在使用者選定方案 B 或 C 時**才可另動：`package.json`／`package-lock.json`／`patches/`（方案 B）、`lib/admin/reports-export.ts` 與 `tests/admin/reports-export.test.ts`（方案 C）
- 不得觸碰：`lib/admin/reports.ts`／`reports-ranking.ts`、面板與圖表元件、其他匯出行為與口徑。

## 需求

1. **最小重現**：寫一支獨立的最小腳本（放在 scratchpad 或草稿檔內，不進 repo 程式碼）：以 `write-excel-file/node` 寫出含 `constructor`、`__proto__`、`toString`、`hasOwnProperty`、`valueOf` 的儲存格，解開 xlsx 證明 `sharedStrings.xml` 缺字串、儲存格內容錯誤；同時附上正常字串（如 `剪髮`）作對照。
2. **上游回報草稿**：整理成可直接貼到上游 issue 的文字（標題、版本、重現步驟、預期與實際、根因位置與建議以 `Map` 或 `Object.create(null)` 修正）。**實際送出由使用者自行決定與操作**（對外發布內容不由 agent 代為送出）。
3. **決定因應方式**（提出建議，由使用者選定）：

| 方案 | 做法 | 優點 | 缺點 |
|---|---|---|---|
| A. 等上游修，維持已知限制 | 只回報、更新 decisions | 零程式變更、零新增相依 | 在上游修好前，名稱為這幾個字的店長會遇到壞檔 |
| B. 本地 patch | 用 `patch-package`（新增 devDependency＋`postinstall`）把 `{}` 改成 `Object.create(null)`，並補讀回測試 | 立即修好 | 新增相依與 install script（供應鏈與維護成本）；升級套件時 patch 可能失效 |
| C. 匯出端防呆 | 寫入前偵測這些保留名稱，以不改變可見內容的方式處理（例如在前面加一個不可見的零寬字元會違反「內容原樣」，所以更可能是改為拒絕匯出並提示店長改名） | 不碰第三方程式碼 | 改變匯出行為或內容，要先經使用者同意；需要維護保留名稱清單 |

   建議：**方案 A**（影響極小、名稱幾乎不會是這些字），除非使用者希望立即消除風險。
4. 依選定方案更新 `decisions.md`；若選 B 或 C，補對應讀回測試（名稱為 `constructor` 的服務，匯出後解開仍為共用字串且內容原樣），並走完整驗證契約。

## 驗收標準

- 最小重現腳本能穩定重現缺陷（含對照組），輸出附在驗證報告。
- 上游回報草稿完整（版本、步驟、預期／實際、根因位置、建議修法），使用者可直接送出。
- 使用者已選定方案，`decisions.md` 與 TASK-093 的已知限制狀態同步。
- 若選 B：套件升級流程與 patch 失效時的處理寫入 decisions；讀回測試通過；`npm audit` 無新增問題；security-reviewer 複審新增相依與 install script。
- 若選 C：新增測試涵蓋保留名稱；匯出內容的變動經使用者核准；`tsc`／`lint`／`build` 與既有匯出測試全過。
- 若選 A：不改任何程式碼與相依。

## 實作備註

- 本卡不自動向外部服務發佈任何內容；回報草稿只存在 repo 內供使用者取用。
- 不順便處理匯出日期欄加年份等其他延後事項（見 TASK-094 的 README 優化項目）。

## 驗證契約

- 單元測試：方案 A 不適用；方案 B／C 為 `npx vitest run tests/admin/reports-export.test.ts tests/admin/reports-export-download.test.ts` 與 `npm test` 回歸。
- 整合測試：不適用。
- E2E 測試：不適用。
- 型別檢查：`npx tsc --noEmit`；Lint：`npm run lint`；Build：`npm run build`（方案 B／C）。
- 螢幕截圖：不適用（方案 C 若新增提示文案則補）。
- 安全性檢查：方案 B 需 security-reviewer 複審；`npm audit --omit=dev`。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：
- 已知限制：
- 後續任務：
