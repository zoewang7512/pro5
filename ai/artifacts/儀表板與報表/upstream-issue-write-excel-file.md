# 上游回報草稿：write-excel-file 共用字串表被 Object.prototype 成員污染

> 這份草稿由 TASK-096 產出，**尚未送出**。是否送出、用哪個帳號送，由使用者自行決定與操作（agent 不對外發布內容）。
>
> - 送出位置：<https://gitlab.com/catamphetamine/write-excel-file/issues>（以 `package.json` 的 `bugs.url` 為準）
> - 以下「---」之間的英文內容可直接貼上；標題與內文皆已用 `write-excel-file@4.1.1`（npm 目前 latest，2026-10-28 查證）實測。
> - 內文刻意不提本專案、不含任何客戶或店家資料。

---

**Title:** Cell text equal to an `Object.prototype` member (`constructor`, `toString`, `__proto__`, …) is written as `function Object() { [native code] }` and is missing from `sharedStrings.xml`

**Version:** `write-excel-file@4.1.1` (latest on npm), Node.js v24.18.0. Both the `browser` and `node` entry points go through the same code (`modules/xlsx/initializeSharedStrings.js` in the ESM build, `commonjs/xlsx/initializeSharedStrings.js` in the CommonJS build), so all entry points are affected.

## Description

When a `String` cell's value is exactly the name of a property that exists on `Object.prototype`, the cell is written with the stringified prototype member as its shared-string index (e.g. `<v>function Object() { [native code] }</v>` with `t="s"`), and the real string is never added to `xl/sharedStrings.xml`. The resulting file is invalid: Excel shows the "We found a problem with some content… Do you want us to try to recover" dialog and the affected cells come back empty or wrong.

Affected values (every own property name of `Object.prototype`):
`constructor`, `__proto__`, `toString`, `valueOf`, `hasOwnProperty`, `isPrototypeOf`, `propertyIsEnumerable`, `toLocaleString`, `__defineGetter__`, `__defineSetter__`, `__lookupGetter__`, `__lookupSetter__`.

This is not a security issue as far as I can tell (the code only reads from the table with these keys; for `__proto__` assigning a number is a no-op), but it silently corrupts user data. Any value that comes from user input, such as a product, category or person name, can trigger it.

## Root cause

`modules/xlsx/initializeSharedStrings.js` (source: `initializeSharedStrings.js`) keeps the lookup table in a plain object:

```js
var sharedStringIdByString = {};
...
var id = sharedStringIdByString[string];
if (id === undefined) {
  id = sharedStrings.length;
  sharedStringIdByString[string] = id;
  sharedStrings.push(string);
}
return id;
```

For `string === 'constructor'`, `sharedStringIdByString[string]` is `Object` (inherited), not `undefined`, so the "not found" branch is skipped and the inherited function is returned as the id.

## Reproduction

Standalone script (needs `write-excel-file` and `fflate`, which is already its dependency). Run it as an ES module from a directory where both are installed:

```js
import writeXlsxFile from 'write-excel-file/node'
import { unzipSync, strFromU8 } from 'fflate'

const values = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'foo', 'Constructor']
const buffer = await writeXlsxFile([
  { sheet: 'repro', data: values.map((value) => [{ value, type: String }]) }
]).toBuffer()

const files = unzipSync(new Uint8Array(buffer))
console.log('sharedStrings.xml:\n' + strFromU8(files['xl/sharedStrings.xml']))
console.log('sheet1.xml:\n' + strFromU8(files['xl/worksheets/sheet1.xml']))
```

## Expected

All seven strings appear in `sharedStrings.xml`, and each cell is `<c r="A1" t="s"><v>0</v></c>`, `<v>1</v>`, … pointing at its own entry.

## Actual

`sharedStrings.xml` contains only the two strings that are not `Object.prototype` members (`foo`, `Constructor`). The affected cells are written like:

```xml
<c r="A1" t="s"><v>function Object() { [native code] }</v></c>
<c r="A2" t="s"><v>[object Object]</v></c>
<c r="A3" t="s"><v>function toString() { [native code] }</v></c>
```

## Suggested fix

Use a structure without a prototype for the lookup table, in `initializeSharedStrings.js`:

```js
var sharedStringIdByString = new Map()
...
var id = sharedStringIdByString.get(string)
if (id === undefined) {
  id = sharedStrings.length
  sharedStringIdByString.set(string, id)
  sharedStrings.push(string)
}
```

(`Object.create(null)` also works, though a `Map` avoids any `__proto__` special-casing.) I applied this change to both builds in a local copy and the example above then writes all seven strings to `sharedStrings.xml` and every cell points at its own entry. A regression test that writes the twelve names above and reads `sharedStrings.xml` back would cover it.

---

## 給使用者的備註（不要貼到上游）

- 本專案的因應方式見 `ai/context/decisions.md` 的 TASK-096 段與 `verification/TASK-096.md`。
- 重現腳本（含對照組與自動比對）在 TASK-096 驗證報告中有輸出；上面貼給上游的是更精簡、不依賴本專案路徑的版本。
- 其他 lookup table（`initializeStyles.js` 的 format／font／fill／border 對照）的鍵由程式本身產生，不是使用者輸入，所以沒有同樣問題；回報只針對共用字串表。
