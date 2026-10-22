# AI-Ready 任務卡

## Metadata

- 任務：多位設計師 前台「選擇設計師」步驟（頭像列＋預覽卡）、服務列表過濾、時段與送出串接、成功頁顯示設計師
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：多位設計師
- 上層 User Story：顧客選擇設計師並查看詳細資訊
- 分軌：前後端串接
- 前置任務（dependsOn）：TASK-067, TASK-068, TASK-070
- 狀態：待人工驗收（實作與驗證完成，見 [`verification/TASK-073.md`](../verification/TASK-073.md)；人工已於 2026-10-21 核准；動工前 architect／security-reviewer 審查已於 2026-10-22 完成並採納，見「動工前審查定案」）
- 風險等級：中（改動顧客端主要預約流程的狀態管理）
- Agent owner：Claude Code
- 人工核准者：使用者

## 目標

在 `BookingFlow` 的服務與時段之間插入「選擇設計師」步驟（mockup Variant B：橫向頭像列＋預覽卡），把選擇
結果傳給 `get_available_slots`／`create_appointment`，並在成功頁顯示設計師。全頁個人頁與作品集放大檢視由
TASK-074 負責，本卡的「看完整作品集 ›」先只呼叫一個由 TASK-074 實作的開啟函式（本卡先留空實作）。

## 情境包（Context Pack）

- 相關檔案：
  - `ai/artifacts/多位設計師/screen-spec-前台選擇設計師.md`、`mockup-decision-前台選擇設計師.md`
  - `ai/artifacts/多位設計師/mockups/customer-designer-variant-b.html`（畫面 1、2、6）
  - `app/_components/booking/BookingFlow.tsx`、`ServiceListSection.tsx`、`SlotPickerSection.tsx`、
    `SuccessSection.tsx`、`SectionChrome.tsx`
  - `lib/booking/api.ts`（`getServices`；`getAvailableSlots`／`createAppointment` 已由 TASK-068 加參數）
  - `lib/designers.ts`（TASK-067 的型別與白名單）
- 既有模式：區塊完成後收合成摘要列加「修改」；每個區塊各自管理 loading／error；`Result<T>`。
- 假設：
  - 〔審查〕服務列表過濾用 PostgREST 內嵌 `designer_services!inner(designers!inner(is_active))`，並對內嵌的
    `designers.is_active` 加 `eq` 過濾，另外保留 `services.is_active` 的過濾。原假設「RLS 已保證只看得到啟用中設計師」
    在店長登入 session 下不成立（admin policy 會放行停用中的設計師），所以要在查詢上明確過濾。
    `getDesignersForService` 同樣明確過濾 `designers.is_active`。
  - 〔審查〕設計師名單（含**全部**作品，最多 12 張）在選完服務後一次讀取，同一個服務不重複讀取；預覽卡只顯示前 4 張，
    TASK-074 的個人頁直接使用同一份資料（與 TASK-074 的假設一致）。
  - 〔審查〕所有前台查詢一律列出明確欄位，不得用 `*` 或 `designers(*)`（anon 只有欄位層級 grant，會 42501）。
- 未知事項：無。
- 允許變更的檔案：
  - `lib/booking/api.ts`（只改 `getServices`，新增 `getDesignersForService`）
  - `lib/booking/types.ts`（前台設計師型別）
  - `app/_components/booking/BookingFlow.tsx`（設計師 state 與重置規則）
  - `app/_components/booking/DesignerPickerSection.tsx`（新增）
  - `components/ui/DesignerAvatarRail.tsx`（新增，跨頁共用元件）
  - `app/_components/booking/SuccessSection.tsx`
  - `ai/context/design-system.md`（S4 inventory 登記 `DesignerAvatarRail`）
  - `tests/booking/api.test.ts`、`tests/components/designer-avatar-rail.test.tsx`、`tests/booking/booking-flow-state.test.ts`（新增）
  - 〔審查補列〕`app/_components/booking/SlotPickerSection.tsx`（步驟編號 2→3）、`ContactFormSection.tsx`
    （步驟編號 3→4）——screen-spec 明寫「原本的步驟 2～4 往後順延」，只改數字常數；
    `lib/booking/booking-flow-state.ts`（新增，重置規則與區塊顯示規則的純函式）；
    `tests/designers.integration.test.ts`（真實 Supabase，新增前台查詢案例）；
    〔人工 2026-10-22 決定納入〕`lib/booking/error-messages.ts`（`BOOKING_LIMIT_EXCEEDED` 改通用文案）、`tests/booking/error-messages.test.ts`（新增）
- 不得觸碰：全頁個人頁、`PortfolioGrid`（TASK-074）；RPC（TASK-068）。

## 需求

- 依 screen-spec「互動」表：預設選取「不指定」；點頭像切換選取並更新預覽卡；選擇後展開選時段。
- 換服務 → 清除設計師與時段；換設計師 → 清除時段。
- 送出時：指定設計師傳 `designerId`；不指定傳 `null`。
- 成功頁：顯示設計師（頭像＋名字）；不指定時加一行「你選擇了「不指定設計師」，系統已為你安排○○。」
- 讀取設計師失敗：error Alert，不阻擋回頭改服務。
- 頭像列右側要露出半個頭像，暗示可以橫向捲動；鍵盤可以用 Tab 與 Enter 選擇（每個頭像都是 button）。

## 驗收標準

- 沒有任何設計師提供的服務不出現在服務列表。
- 指定設計師時，時段只有該設計師的空檔；不指定時是聯集（依 TASK-068 的 RPC）。
- 送出後成功頁顯示的設計師與資料庫一致。

## 實作備註

- 設計師 state 建議用 `{ kind: "any" } | { kind: "designer"; designer: PublicDesigner }`，避免用 `null` 同時代表「未選」與「不指定」。

## 動工前審查定案（architect／security-reviewer，2026-10-22，非人工核准）

資料層
- `getServices`、`getDesignersForService` 都包 try/catch，錯誤直接回 `INTERNAL_ERROR` 常數，不帶 message／details／code。
  `getDesignersForService` 的 select 由 `DESIGNER_PUBLIC_COLUMNS` 組出；`PublicDesigner = Omit<Designer, "is_active"> & { portfolio }`。
- 排序：設計師 `sort_order, id`（anon 沒有 `designers.created_at` 權限）；與後台 `sort_order, created_at` 在 sort_order 重複時
  順序可能不同，登記為已知限制。作品在資料庫端 `created_at desc, id desc` 並 `limit(12)`（referencedTable），前端過白名單後仍截 12 張。
- 〔安全〕`getDesignersForService` 也要求服務上架中（`designer_services!inner(service_id, services!inner(is_active))`＋巢狀 `eq`）。
- 〔安全〕用明確欄位逐一組出 `PublicDesigner`，不用 `...row`；`name` 非字串的列丟掉；`specialties` 過濾非字串元素；
  `bio` 去掉方向控制字元（資料庫 constraint 另開卡補，見 TASK-069 L2）；內嵌的 `designer_services`／`is_active` 不進 state。
- `serviceId` 用 `isDesignerId`（借用 uuid 檢查，加註解說明語意）；不把 id 拼進 `.or()`／`.filter()`／select 字串。
- 〔安全〕所有設計師圖片加 `referrerPolicy="no-referrer"`（Avatar 用 `slotProps.img`），作品圖加 `loading="lazy"`、`decoding="async"`，
  載入失敗保留 `grey.200` 底色。

State 與版面
- 〔審查〕時段 key 改成 `服務|日期|設計師 id 或 any`，effect 依賴推導出的字串 id，不依賴物件；設計師名單存「結果＋serviceId key」並檢查
  cancelled、加 `.catch`，比照既有 servicesResult／slotsResult。
- 重置規則與區塊顯示規則抽成 `lib/booking/booking-flow-state.ts` 的純函式（不改成 `useReducer`）：
  換服務（id 不同）→ 設計師回 any、清時段、`editingDesigner`／`editingSlot` 歸 false；換設計師（id 不同）→ 清時段；
  選回同一位 → 只把 `editingDesigner` 設 false（詮釋：真的換了人才清時段，與 `handleSelectService` 既有模式一致，
  screen-spec:58 字面是按「修改」當下清除，此為有意的詮釋，請人工在走查時確認）。
- 區塊顯示：設計師步驟＝`selectedService && !editingService`；時段步驟＝設計師步驟且名單載入成功且不是空；
  聯絡表單＝`selectedSlot && !editingService && !editingDesigner && !editingSlot`。設計師步驟在「已選時段且不在編輯」時收合。
- 名單讀取失敗或為空時只顯示 Alert，不顯示時段（「不指定」其實不需要名單，但這樣多了一個會擋住預約的故障點；
  依 screen-spec 錯誤列照做，登記為已知限制請人工確認）。
- 〔審查〕與 TASK-074 的介面：`DesignerPickerSection` props 定案為 `status`、`designers`（完整名單含全部作品）、`selection`、
  `onSelect`、`collapsed`、`onEdit`；「看完整作品集 ›」的開啟處理函式留在元件**內部**（先為空函式），BookingFlow 不傳入
  `onOpenProfile`，TASK-074 只在元件內加 state；收合摘要與展開畫面由同一個元件 render（TASK-074 的 Dialog 才不會在
  `history.back()` 前被卸載）；區塊最外層給固定 `id="designer-step"`，供關閉個人頁後捲回。
- `SuccessSection` 收窄 props：`designer: { name, avatarUrl } | null`、`requestedAny`。BookingFlow 用 `confirmation.designer_id`
  在已載入名單查頭像，找不到退回首字頭像；`designer_name` 為空時不顯示設計師列；一律以資料庫回傳值顯示。
- `DesignerAvatarRail` 不把負 margin 寫死在元件裡，由呼叫端用 `sx` 處理；外層 `role="group"` 與 `aria-label`。

測試
- 整合測試涵蓋 anon／admin／非 admin 三種 session（admin 要先斷言 `is_admin()` 為真，避免 MFA aal1 時靜默退化）：
  唯一設計師停用的服務在 admin 下也看不到、有一位啟用一位停用的服務看得到、下架服務看不到；`getDesignersForService` 不回停用或
  沒開該服務的設計師；回傳 key 完全等於白名單；不合格作品網址被丟掉；非法 serviceId 不送請求；竄改 designerId 的 slots 為空陣列。
  不建立會觸發寄信的預約（`customer_email` 一律 null）。
- `tests/booking/api.test.ts` 的假 client 改成可記錄呼叫、可無限串接的假物件。

已知限制（登記，不處理）
- 名單載入後設計師才被停用：時段變空，送出回 `SLOT_CONFLICT`。
- `BOOKING_LIMIT_EXCEEDED` 文案「這支電話…」對 email 觸發的上限有誤導（`decisions.md` 寫留給本卡，但 `error-messages.ts` 不在允許清單，
  改時必須維持通用說法、不能區分電話或 email）——請人工決定是否納入本卡。
- 全站沒有 CSP、停用設計師的 public bucket 圖片仍可用原網址存取（既有殘留，建議另開卡）。
- TASK-074 卡片的 `buildInstagramUrl` 與現有 `instagramProfileUrl`（`lib/designers.ts`）重複，TASK-074 動工前要改成直接使用現有函式。

## 驗證契約

- 單元測試：state 重置規則（換服務、換設計師）；`getServices` 的 select 字串與過濾；`getDesignersForService` 的白名單處理。
- 整合測試：anon 透過 `getServices` 看不到沒有設計師的服務；`getDesignersForService` 只回啟用中且有開該服務的設計師。
- E2E 測試：Browser 在 375px 寬度走查「選服務 → 指定設計師 → 選時段 → 送出」與「不指定」各一次，確認成功頁與後台資料一致。
- 型別檢查／Lint／Build：`npx tsc --noEmit`、`npm run lint`、`npm run build`
- 螢幕截圖：設計師步驟（預設、選取某位、載入中、錯誤）、成功頁（指定與不指定）、暗色模式。
- 安全性檢查：頭像與作品網址只信任 `designer-assets`。

## 完成證據

- 變更的檔案：`lib/booking/{api,types,booking-flow-state}.ts`（後者新增）、`app/_components/booking/{BookingFlow,DesignerPickerSection（新增）,SuccessSection,SlotPickerSection,ContactFormSection}.tsx`、
  `components/ui/DesignerAvatarRail.tsx`（新增）、`ai/context/{design-system,project-map}.md`；測試 `tests/booking/{api,booking-flow-state}.test.ts`、
  `tests/components/{designer-avatar-rail,designer-picker-section,success-section}.test.tsx`、`tests/designers.integration.test.ts`
- 執行過的指令、測試輸出、螢幕截圖、已知限制：見 [`verification/TASK-073.md`](../verification/TASK-073.md)
- 後續任務：TASK-074（個人頁；動工前要把 `buildInstagramUrl` 改成直接用 `instagramProfileUrl`）
