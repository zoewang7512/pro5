# 驗證報告

## 摘要

- 任務：TASK-010 顧客預約流程 架構基礎（資料庫層）
- 結果：通過
- 驗證者：實作 agent（Claude Code）；計畫階段已過 `architect`／`security-reviewer`／
  `test-engineer` 三方審查（見 [feature-spec.md](../feature-spec.md) 與
  [decisions.md](../../../ai/context/decisions.md) 2026-08-05 的兩則決策）

## 指令

| 指令 | 結果 | 備註 |
|---|---|---|
| `0002_booking_flow.sql`（使用者手動貼到 Supabase SQL Editor） | 通過 | 專案無 CLI／DB 連線字串，沿用 TASK-003 既有限制 |
| `npm run seed:booking`（第一次） | 通過 | 建立 7 筆 business_hours、3 筆 services |
| `npm run seed:booking`（第二次） | 通過 | 全部略過重複資料，確認冪等 |
| `npx tsc --noEmit` | 通過 | |
| `npm run lint` | 通過 | |
| `npm run build` | 通過 | |

## 手動驗證（對真實 Supabase 專案，暫存腳本執行後已刪除、不進版控）

| 案例 | 結果 |
|---|---|
| anon 直接 `insert` appointments | ✓ 被拒絕（`permission denied for table appointments`） |
| `get_available_slots` 回傳未來日期的 30 分鐘格點可預約時段 | ✓ 正確（17 個時段） |
| `create_appointment` 首次呼叫建立預約 | ✓ 成功 |
| 同一時段第二次呼叫 | ✓ 回傳 `SLOT_CONFLICT`（exclusion constraint 擋下） |
| 同電話、不同不重疊時段第二次呼叫 | ✓ 成功，且顧客去重正確（同電話只有 1 筆 `customers` 記錄） |
| anon `select business_hours` | ✓ 成功（7 筆） |
| anon `update business_hours` | ✓ 實際被 RLS 阻擋（前後比對資料未變動；PostgREST 對 RLS 阻擋的 UPDATE 回傳「無錯誤但 0 筆」，非拋錯，驗證時已特別確認實際資料狀態而非只看 error 欄位） |

## 審查發現（計畫階段，已於實作中修正）

| 發現 | 嚴重程度 | 狀態 |
|---|---|---|
| TASK-003 既有 anon 直接 INSERT policy 與本 Epic 的 RPC-only 假設矛盾（architect／security-reviewer／test-engineer 三方獨立指出） | Critical | 已修復：`0002_booking_flow.sql` 撤銷該 policy 並 revoke 對應欄位授權，`tests/rls.integration.test.ts` 同步更新斷言 |
| 併發防護方案「exclusion constraint 或應用層鎖擇一」不安全，且鍵設計含 `service_id` 有誤 | Critical/High | 已修復：改為強制 exclusion constraint，鍵僅為 `tstzrange`，不分服務，排除 cancelled |
| 顧客去重回應可能成為 PII 列舉 oracle | High | 已修復：`create_appointment` 回傳值一律回顯輸入值，不回傳資料庫既有顧客記錄欄位 |
| 防濫用機制不足（僅前端鎖按鈕） | High | 已修復：RPC 內加入提前量／視野上限／同號碼預約數上限三項檢查 |
| TASK-010 檔案範圍與其驗證契約（要求自建 test:booking）矛盾 | Medium | 已修復：test:booking 全部收斂至 TASK-013，本卡改用手動驗證 |
| `lib/booking/`／`app/page.tsx` 在唯一消費者出現前被鎖死 | Medium | 已修復：移至 TASK-011 |
| 時區、錯誤契約、種子資料冪等性等規格缺口 | Medium | 已修復：明定 Asia/Taipei、統一 jsonb 錯誤格式、種子資料改用獨立腳本 |

## 殘留風險

- 併發（多請求同時搶同一時段）本卡只驗證循序呼叫的衝突擋下，正式 3-5 併發＋多輪測試
  由 TASK-013 負責。
- `npm run test:rls` 尚未針對本次修改重新執行，由 TASK-013 明確負責重跑並記錄。
- `create_appointment` 對 `customers` 表 unique constraint 的極低機率併發撞號情況，
  回傳通用 `INTERNAL_ERROR` 讓前端重試整個請求，非精準處理（已記錄為刻意的簡化取捨）。

## 人工核准

- 核准者：使用者
- 日期：2026-08-05
- 決定：驗證證據確認無誤，核准推進到「完成」。
