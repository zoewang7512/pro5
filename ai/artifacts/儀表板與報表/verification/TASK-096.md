# 驗證報告

## 摘要

- 任務：TASK-096 `write-excel-file` 名稱為 `constructor`／`__proto__` 等時匯出檔寫壞的問題（重現、上游回報草稿、選定因應方式）
- 結果：**通過，使用者人工驗收通過 2026-10-28**。上游回報是否送出由使用者自行決定。
- 選定方案：**A「等上游修，維持已知限制」**（agent 建議，使用者選定，2026-10-28）。不改任何程式碼與相依。
- 驗證者：實作 agent（Claude Code）。agent 輸出不等於人工核准。
- 開發分支：`feat/task-096-excel-name-guard`（從 `master` 建立，依使用者指示）。

## 變更的檔案

| 檔案 | 內容 |
|---|---|
| `ai/artifacts/儀表板與報表/upstream-issue-write-excel-file.md` | 新增：可直接貼到上游的英文 issue 草稿（標題、版本、描述、根因位置、重現腳本、預期／實際、建議修法） |
| `ai/context/decisions.md` | 新增 TASK-096 段；TASK-093 已知限制加註狀態 |
| `README.md` | 「回報 write-excel-file 缺陷」改為「等上游修」並說明影響與因應 |
| `ai/artifacts/儀表板與報表/verification/TASK-096.md`、任務卡、看板卡 | 流程文件 |

未觸碰：任何程式碼、測試、`package.json`、`package-lock.json`、`patches/`（方案 A 的要求）。重現腳本與暫存的已修補副本都放在 scratchpad，不進 repo；中途寫過一個一次性探測測試，跑完立即刪除，`git status` 確認沒有殘留。

## 最小重現（需求 1）

腳本：`write-excel-file@4.1.1`、Node v24.18.0，寫出 9 個字串（5 個 `Object.prototype` 成員＋4 個對照），解開 xlsx 逐格比對。**連跑兩次輸出完全相同**。

```text
輸入 9 個字串；sharedStrings.xml 內有 4 個： ["剪髮","染髮","Constructor","constructors"]

BROKEN 問題字串 "constructor"      -> 儲存格 t="s" <v>function Object() { [native code] }</v>  讀回：undefined
BROKEN 問題字串 "__proto__"        -> 儲存格 t="s" <v>[object Object]</v>  讀回：undefined
BROKEN 問題字串 "toString"         -> 儲存格 t="s" <v>function toString() { [native code] }</v>  讀回：undefined
BROKEN 問題字串 "hasOwnProperty"   -> 儲存格 t="s" <v>function hasOwnProperty() { [native code] }</v>  讀回：undefined
BROKEN 問題字串 "valueOf"          -> 儲存格 t="s" <v>function valueOf() { [native code] }</v>  讀回：undefined
OK     對照組   "剪髮"               -> 儲存格 t="s" <v>0</v>
OK     對照組   "染髮"               -> 儲存格 t="s" <v>1</v>
OK     對照組   "Constructor"      -> 儲存格 t="s" <v>2</v>
OK     對照組   "constructors"     -> 儲存格 t="s" <v>3</v>

結果：5 / 9 個儲存格內容錯誤
```

結論：問題字串全壞、對照組（含大小寫不同、加字尾）全好，且壞字串不進 `sharedStrings.xml`。與任務卡描述一致。

## 比任務卡更精確的查證

- **受影響名稱共 12 個**（`Object.prototype` 的全部自有屬性）：`constructor`、`__proto__`、`toString`、`valueOf`、`hasOwnProperty`、`isPrototypeOf`、`propertyIsEnumerable`、`toLocaleString`、`__defineGetter__`、`__defineSetter__`、`__lookupGetter__`、`__lookupSetter__`。任務卡只列 5 個。
- **ESM 與 CommonJS 兩份建置都有同一個缺陷**（`modules/xlsx/initializeSharedStrings.js`、`commonjs/xlsx/initializeSharedStrings.js`）。本專案的瀏覽器端（`browser/index.js` → `modules/`）與測試用的是 ESM。
- **其他 lookup table 不受影響**：`initializeStyles.js` 的 format／font／fill／border 對照表，鍵由程式本身產生，不是使用者文字；只有共用字串表會被使用者文字打到。
- **上游沒有修**：`write-excel-file` 4.1.1 是 npm 目前 latest（`time.modified` 2026-06-08），沒有可升級的版本。回報位置為 GitLab：`https://gitlab.com/catamphetamine/write-excel-file/issues`（取自套件的 `bugs.url`）。

## 真實匯出管線實測

以 `buildExportSheets` 組出真實三張工作表，設計師篩選名稱設為 `toString`、其中一個服務名稱設為 `constructor`，用 `write-excel-file/node` 產出後解開：

- `sharedStrings.xml` **不含** `constructor`、`toString`，**含**正常服務 `剪髮`。
- 壞掉的儲存格：「彙總」表 `B3`（設計師篩選名稱，內容變成 `function toString() { [native code] }`）、「熱門服務排行」表 `B3`（服務名稱，內容變成 `function Object() { [native code] }`）。
- 確認：缺陷確實會在本專案的真實匯出內容出現，觸發來源與任務卡所述一致（服務名稱、設計師篩選名稱）。

## 建議修法的驗證

在 scratchpad 的**暫存副本**（不是 repo 的 `node_modules`）把共用字串表改為 `Map`，兩份建置都改：

- 長重現腳本：**0 / 9** 個儲存格錯誤（原本 5 / 9），5 個問題字串與 4 個對照都讀回正確。
- 上游草稿內的精簡腳本（7 個字串）：`sharedStrings.xml` 含全部 7 個，每格指向自己的索引。
- 另外驗證了草稿中的精簡腳本在**未修補**的 repo 版本上跑，輸出與草稿的「Actual」一致（只有 `foo`、`Constructor` 進共用字串表）。

這個驗證同時說明了方案 B 的成本：patch 必須涵蓋 ESM 與 CommonJS 兩個檔案。

## 方案比較與選定

| 方案 | 結論 |
|---|---|
| **A. 等上游修** | **選定。** 影響極小：只影響匯出檔完整性，不是注入或 prototype pollution，名稱只有店長能寫，且店長幾乎不會把服務取成這些字。零程式變更、零新增相依。 |
| B. 本地 patch | 未選。要 patch 兩個檔案並新增 devDependency 與 postinstall 安裝腳本，供應鏈與維護成本高於效益；升級套件時 patch 可能失效。 |
| C. 匯出端防呆 | 未選。要改匯出行為與文案、維護保留名稱清單，並讓店長因冷門限制無法匯出。 |

## 驗證契約

| 項目 | 結果 |
|---|---|
| 單元測試、整合測試、E2E | 不適用（方案 A，不改程式碼） |
| `tsc`／`lint`／`build` | 不適用（方案 A，沒有任何程式碼變動）；`git status` 確認只有文件變動 |
| 螢幕截圖 | 不適用 |
| 安全性檢查 | 不適用（方案 B 才需 security-reviewer 複審與 `npm audit`）；本卡沒有新增相依或 install script |
| 驗收標準逐項 | 重現腳本穩定重現含對照組（見上）；上游草稿完整（版本、步驟、預期／實際、根因位置、建議修法）；使用者已選定方案 A，`decisions.md` 與 TASK-093 已知限制同步；方案 A 未改任何程式碼與相依 |

## 已知限制與殘留風險

- 在上游修好前，名稱為上述 12 個字之一的服務或設計師，匯出檔該格內容會錯、Excel 開檔會跳修復對話框。因應：避免用這些字當名稱。
- **上游回報尚未送出**：草稿在 repo 內，由使用者自行決定是否送出。agent 沒有對外發布任何內容。
- 本專案不自動追蹤上游狀態；日後評估升級依賴時需要自己看一眼。

## 後續任務

- 上游修好後：精確版本單獨升級 `write-excel-file`，補一則讀回測試（名稱為 `constructor` 的服務，匯出後解開仍是共用字串且內容原樣），關閉此已知限制。（尚未立卡，等上游有動靜再立。）
