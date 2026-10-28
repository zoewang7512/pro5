# 驗證報告

## 摘要

- 任務：TASK-088 儀表板與報表 報表資料層（`lib/admin/reports.ts`、`designer-filter.ts` 型別放寬、單元與整合測試）
- 結果：**通過**（單元 71 項、整合 19 項全數通過；`TZ=UTC`／`America/Los_Angeles`／`Asia/Taipei` 三個時區結果一致）
- 驗證者：實作 agent（Claude Code）。product 關卡已由使用者核准規格書與計畫；本卡風險低（唯讀、純函式為主、不改資料庫、無 UI），未另跑 security／architecture 子代理審查。人工驗收待使用者。

## 變更的檔案

| 檔案 | 內容 |
|---|---|
| `lib/admin/reports.ts`（新增） | 型別；`getReportPeriod`／`shiftReportPeriod`；`fetchReportAppointments`（分頁、欄位白名單、錯誤泛用）；`summarize`；`buildTrend`；`filterByDesigners`；`toReportAppointmentLike` |
| `lib/admin/designer-filter.ts` | 只放寬 `buildDesignerChips`／`countActiveAppointments` 的參數型別為 `Pick<WeekAppointment, "designer_id" \| "status">`，行為不變 |
| `tests/admin/reports.test.ts`（新增） | 40 項單元測試 |
| `tests/admin/designer-filter.test.ts` | 追加 2 項（以最小資料呼叫放寬後的函式） |
| `tests/reports.integration.test.ts` | 追加 8 項彙總案例（真實 Supabase） |
| `tools/kanban/cards/TASK-088.json`、本報表、任務卡 | 流程文件 |

## 指令

| 指令 | 結果 | 備註 |
|---|---|---|
| `npx vitest run tests/admin/reports.test.ts tests/admin/designer-filter.test.ts` | **71 項通過** | 40（reports）＋31（designer-filter，原 29＋新增 2） |
| 同上，`TZ=UTC` | 71 項通過 | 以 `new Date(...).getHours()` 確認時區確實切換（0） |
| 同上，`TZ=PST8PDT`（＝America/Los_Angeles） | 71 項通過 | 本機 Windows 的 Node **不認 IANA 名稱** `America/Los_Angeles`（會靜默退回系統時區），改用 POSIX 寫法 `PST8PDT` 並確認 `Intl` 回報 `America/Los_Angeles`、本地小時為 17 |
| 同上，`TZ=Asia/Taipei` | 71 項通過 | |
| `npm run test:reports` | **19 項通過**（原 11＋新增 8） | 真實 Supabase |
| `npx tsc --noEmit` | 通過 | 0 錯誤 |
| `npm run lint` | 通過 | 0 error |
| `npm run build` | 通過 | |
| `npx vitest run --maxWorkers=3`（全套） | 78 檔通過、1 檔 1 項失敗（1398／1399） | 見「審查發現」第 1 項 |
| 測試資料殘留檢查（service_role 查詢） | 通過 | `appointments`／`customers`／`services`／`designers` 皆無 `__TEST__` 資料 |

## 涵蓋範圍

**單元**
- 期間：日／週（週一～週日）／月；跨月、跨年、週跨月、閏年二月；`shiftReportPeriod` 前後移動與往返回到原期間；`isCurrent` 頭尾含；未傳 today 時以台北今天判斷（假時鐘 UTC 17:00＝台北隔天 01:00）。
- 彙總：各狀態組合、全部已取消（`booked = 0`、`cancelled = N`）、空陣列、浮點金額收斂（0.1＋0.2＝0.3）。
- 趨勢：月 31 格／週 7 格補零且加總等於彙總；台北 23:30、00:30、07:59 的日期歸屬；期間外預約不計入；日粒度預設 10–19 共 10 格，早於 10／晚於 19（含已取消）擴張；午夜小時為 0 而非 24；非當日預約不擴張範圍。
- 查詢：欄位清單精確比對且不含 `*`／`customer_*`／`access_token`；範圍含 `+08:00`、結束為隔日 00:00；排序 `start_at, id`；`price_at_booking` 為 null／空字串／非數字／NaN／Infinity、未知狀態皆回錯誤；分頁（2003 列取 3 頁）、剛好 1000／5000 列成功、5001 列回錯誤且不回傳部分資料；任一頁失敗或拋例外回泛用訊息且不含資料庫內容；期間日期不合法時不送出查詢。
- 設計師：`filterByDesigners`（空＝全部、單選、多選、不存在）；`toReportAppointmentLike` 餵給 `buildDesignerChips` 的 chip 數字不含已取消。

**整合（真實 Supabase，`__TEST__` 資料、`customer_email = null`）**
- 以 service_role 造出 8 筆預約（含：事後改價的快照 150.5、取消、兩位設計師、兩個服務、前一週日 23:59、週一 00:00、週日 23:30、下週一 00:00）。
- 店長帳號：期間取回 6 筆（含頭、不含尾）；`summarize`＝預約 5／完成 3／待完成 2／取消 1／營收 450.5／預估 350（手算）；週趨勢 `[1,0,3,0,0,0,1]` 與各格明細；日趨勢擴張到 21:00；設計師 A／B 篩選後彙總；前日 23:59 與次日 00:00 的預約只出現在各自的日。
- 非店長登入者：`{ ok: true, data: [] }`；anon：泛用錯誤。

## UI 證據

不適用（本卡沒有畫面）。

## 審查發現

| 發現 | 嚴重程度 | 狀態 |
|---|---|---|
| 1. 全套單元測試在預設並行度下大量 5 秒逾時（連跑兩次皆 39 項失敗，集中在 `account-settings-view`、`login-form`、`designer-*` 等 UI 元件測試）；`--maxWorkers=3` 下剩 `account-settings-view` 1 項逾時。**暫存我的改動後在乾淨基線上完整跑也失敗（54 項）**；兩個最常失敗的檔案單獨重跑（含我的改動）連續兩次 57 項全過。本卡沒有改動任何元件，判斷為與 TASK-087 報告相同的既有並行負載不穩定 | 低 | 已確認非本卡造成；與 TASK-087 發現 1 同一議題，建議另立任務（降低預設 `maxWorkers` 或加大 UI 測試逾時） |
| 2. 查詢多送一頁（第 6 次查詢）只為分辨「剛好 5000 列」與「超過 5000 列」；只在前五頁都滿時才發生，實務上不會觸發 | 資訊 | 設計取捨，單元測試覆蓋 |
| 3. `fetchReportAppointments` 遇到無法解析的列（價格非有限數、未知狀態）整批回錯誤而不是略過該列——與架構筆記「寧可失敗也不顯示不完整的數字」一致 | 資訊 | 符合規格 |
| 4. 服務 embed 缺漏（被擋或 null）時服務名稱以 `—`、`serviceIsActive = true` 呈現（`service_id` 為 not null 外鍵，正常不會發生） | 資訊 | 比照 `designerDisplayName` 的 `—` 慣例；排行卡（TASK-091）需決定缺名稱時的呈現 |

## 殘留風險與已知限制

- 單期間上限 5000 列，超過回錯誤（升級路徑見架構筆記 §9）。
- `ReportPeriod` 的 `isCurrent` 在建立當下計算；頁面開著跨午夜不會自動更新（切換期間或回到本期時重算）。
- 資料層只做運算，尚未被任何畫面使用；TASK-089／090／091 之後才會消費。
