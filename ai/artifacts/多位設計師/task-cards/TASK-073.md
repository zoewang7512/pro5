# AI-Ready 任務卡

## Metadata

- 任務：多位設計師 前台「選擇設計師」步驟（頭像列＋預覽卡）、服務列表過濾、時段與送出串接、成功頁顯示設計師
- 上層規格：[`feature-spec.md`](../feature-spec.md)
- 上層 Epic：多位設計師
- 上層 User Story：顧客選擇設計師並查看詳細資訊
- 分軌：前後端串接
- 前置任務（dependsOn）：TASK-067, TASK-068, TASK-070
- 狀態：就緒前審查中（人工已於 2026-10-21 核准；動工前先完成 architect／security-reviewer 架構審查）
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

## 驗證契約

- 單元測試：state 重置規則（換服務、換設計師）；`getServices` 的 select 字串與過濾；`getDesignersForService` 的白名單處理。
- 整合測試：anon 透過 `getServices` 看不到沒有設計師的服務；`getDesignersForService` 只回啟用中且有開該服務的設計師。
- E2E 測試：Browser 在 375px 寬度走查「選服務 → 指定設計師 → 選時段 → 送出」與「不指定」各一次，確認成功頁與後台資料一致。
- 型別檢查／Lint／Build：`npx tsc --noEmit`、`npm run lint`、`npm run build`
- 螢幕截圖：設計師步驟（預設、選取某位、載入中、錯誤）、成功頁（指定與不指定）、暗色模式。
- 安全性檢查：頭像與作品網址只信任 `designer-assets`。

## 完成證據

- 變更的檔案：
- 執行過的指令：
- 測試輸出：
- 螢幕截圖：
- 已知限制：
- 後續任務：TASK-074
