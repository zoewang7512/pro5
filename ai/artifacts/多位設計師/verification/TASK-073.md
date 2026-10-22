# 驗證報告

## 摘要

- 任務：TASK-073 多位設計師 前台「選擇設計師」步驟、服務列表過濾、時段與送出串接、成功頁設計師
- 結果：通過（有殘留風險與待人工確認事項，見下方）
- 驗證者：實作 agent（Claude Code）。動工前 architect、security-reviewer 的審查意見**不等同人工核准**；product／ui／architecture／
  security／test／code_review 關卡待人工核准。**本卡沒有做實作後的 subagent 審查**（任務卡風險等級為中，使用者只要求動工前審查）。

## 指令

| 指令 | 結果 | 備註 |
|---|---|---|
| `npx tsc --noEmit` | 通過 | |
| `npm run lint` | 通過 | 0 error、0 warning |
| `npm run build` | 通過 | 路由清單不變。build 前先停掉 dev server，build 後重啟 |
| `npx vitest run --maxWorkers=3`（全套） | 893／894 通過，1 項失敗在 `account-settings-view`（5 秒逾時） | 沒改到的檔案，與 TASK-069～072 報告記載的逾時同一類 |
| `npm run test:designers -- -t "TASK-073"`（真實 Supabase 專案） | 通過 | 7 項（見下方），afterAll 清除斷言通過 |
| 變異檢查：拿掉 `getServices` 的 `.eq("designer_services.designers.is_active", true)` 後重跑整合測試 | 測試如預期失敗（admin：多出「唯一設計師停用」的服務） | 已還原；證明 admin 那一格真的在驗巢狀過濾 |
| 瀏覽器走查（真實專案，`__TEST__` 暫時資料） | 通過 | 見下方「走查」 |

本卡新增或擴充的測試：

- `tests/booking/api.test.ts`（12→25，新增 13 項；假 client 改成可記錄呼叫、可無限串接的 Proxy）：`getServices`（select 字串、兩個 `eq`、排序、剝掉內嵌欄位、例外回通用錯誤）；
  `getDesignersForService`（select 明確欄位且無 `*`、四個過濾與兩層排序、referencedTable 的 limit 12、非 uuid 的 serviceId 不送請求、
  欄位剛好是白名單、頭像與作品網址白名單（外部網域／query 夾帶／別位設計師路徑）、12 張上限、簡介去方向控制字元但保留換行、
  IG 帳號格式錯誤與非字串專長清理、name 非字串或 id 非 uuid 整列丟掉、資料庫錯誤與例外都回通用錯誤、空陣列不是錯誤）。
- `tests/booking/booking-flow-state.test.ts`（新增，13 項）：重置規則（換服務、換設計師、選回同一個）與六種區塊顯示組合
  （未選服務、名單載入中／失敗／空、已選時段、設計師「修改」、時段「修改」、服務「修改」）。
- `tests/components/designer-avatar-rail.test.tsx`（新增，3 項）：button／`aria-pressed`／群組名稱；點擊與 Enter；名字完整顯示、首字與 ✦。
- `tests/components/designer-picker-section.test.tsx`（新增，10 項）：預設、選取設計師的預覽卡（純文字簡介、專長、前 4 張作品）、作品圖
  `no-referrer`／lazy／載入失敗後移除、無作品／簡介／專長不畫區塊、`onSelect` 回傳完整物件、作品集連結本卡不做事、載入中／錯誤／空名單、
  收合摘要與固定 id。
- `tests/components/success-section.test.tsx`（新增，5 項）：指定與不指定的文案、首字頭像、`designer` 為 null 不顯示、名字當純文字渲染。
- `tests/designers.integration.test.ts`（新增 7 項，真實 Supabase，anon／admin／非管理員三種 session）：
  前提（admin 讀得到停用設計師與下架服務，anon 讀不到）；`getServices` 三種 session 一致（只有 s1，s2「唯一設計師停用」、s3 下架、s4 無設計師都不列）
  且欄位剛好是 Service；同一服務多位設計師只出現一次；`getDesignersForService(s1)` 三種 session 只回啟用中且有開服務的設計師、欄位剛好是白名單、
  不合格作品（query 夾帶、外部網域）被丟掉、新的在前；s2／s3／s4 回空陣列（admin 也是）；非 uuid 的 serviceId 回通用錯誤；
  竄改 designerId（停用中、沒開服務、不存在）時段都是空陣列、預約都是 `SLOT_CONFLICT` 且沒有建立預約。`customer_email` 一律 null。

## 走查（Browser 工具，正式資料庫）

隔離做法：以 service_role 建立 `__TEST__走查073服務`（上架）與 5 位 `__TEST__走查073-…` 設計師（啟用；含頭像、作品 PNG、一位超長名字、一位無頭像無簡介），
走查完以 service_role 清除（預約、顧客、Storage 檔案、設計師、服務），查詢確認只剩「預設設計師」「小狗」、`__TEST__` 服務／預約 0 筆。
**暫時資料是啟用狀態，走查期間（約 10 分鐘）正式前台列表看得到這個測試服務。** 預約的 `customer_email` 為 null，不觸發寄信。

- 375px（暗色）：選服務 → 服務收合摘要、設計師步驟出現骨架屏（4 個圓形＋圓角方塊）→ 載入後「不指定」預設選取（2px primary 外框）、預覽卡顯示說明文字、
  步驟 3「選擇時段」立刻展開；頭像列滿版（左右都貼到螢幕邊緣，`scrollWidth 492 > clientWidth 375`，第 5 位頭像在右緣露出一半），頁面無橫向捲動。
  長名字（27 字）在 72px 寬的標籤內換行、不截斷。
- 點選某位設計師：外框與名字加粗移到該位，預覽卡顯示名字、「看完整作品集 ›」、簡介（換行保留）、專長標籤、前 4 張作品；時段重新載入。
  頭像與作品圖皆帶 `referrerpolicy="no-referrer"`，作品圖 `loading="lazy"`。
- 選時段後：設計師步驟收合成「✓設計師　修改　名字」、時段收合、出現步驟 4「填寫資訊」。
  按設計師「修改」：頭像列展開、時段摘要保留、聯絡表單隱藏；選回同一位 → 回到收合且時段仍在；改選另一位 → 時段清除並回到「選擇時段」。
- 指定設計師送出（王大明）：成功頁顯示設計師列（頭像＋名字），沒有「不指定」說明；資料庫的預約 `designer` 是王大明。
- 不指定送出：成功頁顯示「你選擇了「不指定設計師」，系統已為你安排…林小美。」；資料庫的預約 `designer` 是林小美，與成功頁一致。
- 錯誤狀態（攔截 `/rest/v1/designers?` 回 500）：顯示「無法載入設計師名單，請重新整理頁面再試一次。」，不顯示時段，服務摘要列「修改」仍可用。
- 亮色模式與桌面寬度：頭像列、預覽卡、作品縮圖、時段區都正常。主控台只有 dev server 的 HMR WebSocket 連線錯誤（既有）。

## 已採納的動工前審查（詳見任務卡「動工前審查定案」）

- 時段 key 加入設計師，並以服務 id 當名單 key（security／architect）。
- 「看完整作品集 ›」處理函式留在 `DesignerPickerSection` 內部，不由 BookingFlow 傳入（architect：否則 TASK-074 必須改 BookingFlow）。
- 整合測試涵蓋 admin session（architect／security 都指出 anon 下 RLS 本來就會過濾，單測 anon 驗不到巢狀 `eq` 有沒有寫對）。
- 成功頁收窄 props、`designer_name` 為空時不顯示、一律用資料庫回傳值（security）。
- 所有設計師圖片 `no-referrer`、作品 lazy、載入失敗保留底色（security）。
- 簡介去方向控制字元、逐欄位白名單組出 `PublicDesigner`、`getDesignersForService` 也要求服務上架（security）。
- 範圍擴張：`SlotPickerSection`／`ContactFormSection`（步驟編號）、`lib/booking/booking-flow-state.ts`、整合測試檔；另外新增
  `tests/components/designer-picker-section.test.tsx`、`success-section.test.tsx`（任務卡只列了前三個測試檔）。

## 殘留風險與已知限制

- 名單載入失敗或為空時完全不顯示時段，即使「不指定」其實不需要名單——多了一個會擋住預約的故障點（照 screen-spec 錯誤列實作）。**人工 2026-10-22 確認維持現狀。**
- 「修改」設計師後只有「真的換了人」才清時段（選回同一位保留）；screen-spec:58 字面是按「修改」當下清除。**人工 2026-10-22 確認維持現狀。**
- 「看完整作品集 ›」本卡是空函式（任務卡指定留給 TASK-074），目前點了沒有反應。
- `BOOKING_LIMIT_EXCEEDED` 文案原本「這支電話…」對 email 觸發的上限有誤導。**人工 2026-10-22 決定納入本卡，已改為「你的聯絡資訊目前有太多筆待確認的預約，請稍後再試或聯繫我們協助處理。」**
  （通用說法，不區分電話或 email；`lib/booking/error-messages.ts`，新增 `tests/booking/error-messages.test.ts`）。只做單元測試，沒有再走查畫面。
- 設計師名單載入後才被停用／下架：時段變空，送出回 `SLOT_CONFLICT`。
- 設計師排序用 `sort_order, id`（anon 沒有 `designers.created_at` 權限），後台用 `sort_order, created_at`，`sort_order` 重複時前後台順序可能不同。
- 頭像列每位設計師各預載一張頭像（MUI `Avatar` 用 `new Image()` 預載，`loading="lazy"` 無效）；設計師人數沒有上限。
- 全站沒有 CSP；停用設計師的 public bucket 圖片仍可用原網址存取（既有殘留，建議另開卡）。
- TASK-074 卡片的 `buildInstagramUrl` 與現有 `instagramProfileUrl`（`lib/designers.ts`）重複，TASK-074 動工前要改。
- 走查期間正式前台短暫看得到 `__TEST__` 服務（約 10 分鐘，已清除）。
- 未走查：iOS Safari 實機；設計師 6 位以上的頭像列；實際寄信（預約都用 null email）。

## 人工核准

- 核准者：使用者
- 日期：2026-10-22
- 備註：驗收通過。三項待確認事項已決定：名單載入失敗時不顯示時段（維持現狀）、修改設計師只有真的換人才清時段（維持現狀）、
  `BOOKING_LIMIT_EXCEEDED` 文案改通用說法（已改）。殘留風險維持已知限制。
