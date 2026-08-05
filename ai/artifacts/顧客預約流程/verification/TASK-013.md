# 驗證報告

## 摘要

- 任務：TASK-013 顧客預約流程 前後端串接驗證與端到端測試
- 結果：通過
- 驗證者：實作 agent（Claude Code）；因風險等級高，額外請 `architect`／`security-reviewer`
  agent 各自獨立審查 `tests/booking.integration.test.ts`

## 指令

| 指令 | 結果 | 備註 |
|---|---|---|
| `npx tsc --noEmit` | 通過 | |
| `npm run lint` | 通過 | |
| `npm test`（預設） | 通過 | 34/34，確認未被 `test:booking` 汙染 |
| `npm run build` | 通過 | |
| `npm run test:booking` | 通過 | 連續執行穩定 19/19（含審查修正後重跑 2 次） |
| `npm run test:rls` | 通過 | 6/6，無回歸 |

## 整合測試涵蓋（`tests/booking.integration.test.ts`，19 案例）

| 分類 | 案例數 | 涵蓋內容 |
|---|---|---|
| `get_available_slots` | 4 | 已佔用／非營業時間／空閒（18 格）／超出 90 天視野 |
| `create_appointment` 成功與去重 | 3 | 基本成功回顯、同 phone 兩次同一 `customer_id`、phone 命中 A／email 命中 B 以 A 為準（含防列舉斷言） |
| 併發衝突防護 | 3 | 3 輪 × 4 併發請求搶同一時段，恰好 1 筆成功 |
| Exclusion constraint 邊界 | 2 | 相鄰時段皆成功、重疊 1 分鐘被拒絕 |
| 提前量／視野上限 | 2 | 早於 1 小時、晚於 90 天皆 `VALIDATION_ERROR` |
| 同號碼上限 | 1 | 第 4 筆 `BOOKING_LIMIT_EXCEEDED` |
| RLS 邊界 | 4 | select（非恆真）／insert（精確錯誤代碼＋確認未寫入）／update／delete 皆被拒 |

## 手動驗證（Browser 工具，行動裝置 375×812，對真實 Supabase 專案）

| 案例 | 結果 |
|---|---|
| 完整成功路徑：服務列表→選時段→填資訊→成功頁 | ✓ |
| 錯誤路徑：模擬真實並發搶單，`SLOT_CONFLICT` Toast 於 436ms 內正確顯示，欄位未清空 | ✓ |
| 手動驗證資料（含 race 測試資料）事後已用 service role 清除 | ✓ |

## 審查發現與處理

### architect（見完整審查回覆，摘要如下）

| 發現 | 嚴重程度 | 狀態 |
|---|---|---|
| 同號碼上限測試原用 08:00/09:00，落在營業時間外 | 中 | 已修復：改用 10:00/10:30/11:00/11:30 |
| `afterAll` 清除 customers 用的 `like` pattern 未跳脫 `TEST_MARKER` 內的 `_`（LIKE 萬用字元） | 中 | 已修復：新增 `escapeLikePattern` |
| `appointments_no_overlap` 為全域 exclusion constraint，測試會暫時佔用真實時段 | 低（設計限制） | 緩解：日期池移到接近 90 天視野上限，並於 `project-map.md` 加註提醒 |

### security-reviewer（見完整審查回覆，摘要如下）

| 發現 | 嚴重程度 | 狀態 |
|---|---|---|
| 防列舉去重測試未實際比對回傳 `customer_name` 是否為請求值 | 高 | 已修復：補上明確斷言 |
| anon insert 被拒的斷言只比對「有 error」，太鬆 | 中 | 已修復：精確比對 `42501`，並用 service role 確認未寫入 |
| anon select 被拒的斷言可能恆真 | 中 | 已修復：先用 service role 確認底下確實有資料 |
| 缺少 anon delete 邊界測試 | 中 | 已修復：新增對應測試案例 |
| `Promise.all` 無法區分真正平行與網路層序列化；同電話併發撞號路徑未涵蓋 | 低（記錄殘留風險） | 記錄為已知限制，不擴大本卡範圍（該路徑已由 TASK-010 記錄為刻意簡化取捨） |

全部「必須修」與「應該修」項目修正後，重新執行 `npx tsc --noEmit`／`npm run test:booking`（2 次，19/19 穩定）／`npm run test:rls`，皆通過。

## feature-spec 驗收標準逐項核對

全部 7 項驗收標準（完整流程走查、已佔用/非營業時段不可選、anon 直接寫入被拒、併發多輪驗證、
customer_id 去重正確、business_hours/services 種子資料存在、六項指令皆通過）逐一核對，全部打勾，
詳見 [TASK-013.md](../task-cards/TASK-013.md) 完成證據。

## 殘留風險

- 併發測試每輪使用不同電話，未涵蓋同電話併發撞號觸發 `customers_phone_key` 導致
  `INTERNAL_ERROR`（TASK-010 已記錄為刻意簡化取捨，非本卡新增風險）。
- `get_available_slots` 空閒營業日回傳 18 格的斷言依賴當下無其他資料落在該日期；已移到
  接近 90 天視野降低機率，但全域 exclusion constraint 的既有設計無法完全消除此風險。

## 人工核准

- 核准者：使用者
- 日期：2026-08-05
- 決定：完成證據（含 architect／security-reviewer 審查與修正記錄）確認無問題，核准推進到
  「完成」。顧客預約流程 Epic 三個 User Story 端到端驗證通過，`feature-spec.md` 狀態已更新為
  「已實作」。
