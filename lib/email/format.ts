// Email 內容組成用的共用格式化純函式，供 TASK-052（確認信）／TASK-053（取消/改期
// 通知信）／TASK-054（提醒信）三種信件範本共用，避免時間格式在不同信件中不一致。
// 這裡刻意不 import lib/admin/week-range.ts 的 WEEKDAY_LABELS，維持 lib/email/
// 自成一個不依賴其他網域模組的獨立單元（本模組只在伺服器端 API Route 執行，不受
// 「顧客前台不 import lib/admin/*」這條分層規則約束，但獨立小常數重複一份的成本
// 遠低於建立跨模組依賴）。

const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// "2026/08/24（一）17:00"，供信件內文顯示預約時段。全程以 Asia/Taipei 當地時間為準
// （比照既有 lib/admin/format.ts toTaipeiDate／formatTaipeiTime 的既有慣例：直接切
// ISO 字串取到的是 UTC 日期，跨時區會顯示錯誤的日期/星期幾）。
export function formatAppointmentDateTime(iso: string): string {
  const date = new Date(iso);
  // 資料來源保證是資料庫查出來的合法 timestamptz，這裡仍防禦性擋一下無效輸入——
  // 不擋的話 Intl.DateTimeFormat.formatToParts 在部分 runtime 會直接 throw
  // RangeError，在 TASK-054 批次寄送提醒信的迴圈中，單筆髒資料會讓整批中止
  // （architect／security-reviewer 於 TASK-051 審查提出）。
  if (Number.isNaN(date.getTime())) {
    throw new Error(`formatAppointmentDateTime: 無效的時間字串 "${iso}"`);
  }

  // hourCycle: "h23" 明確要求 0-23 小時制——只給 hour12: false 在部分 ICU 實作上會把
  // 午夜算成 "24:00" 而非 "00:00"（既有教訓，見 lib/admin/business-hours.ts
  // toTaipeiTimeOfDay 的同一個既知怪癖說明）。
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const year = get("year");
  const month = get("month");
  const day = get("day");
  const hour = get("hour");
  const minute = get("minute");

  // 星期幾用 en-CA 的 YYYY-MM-DD 字串重新組成一個 UTC 日期物件推算 getUTCDay()，
  // 避免直接對原始 iso 用 date.getDay()／toLocaleDateString 在跨時區時算出錯誤的
  // 星期幾（同樣的既有教訓見 lib/admin/format.ts formatAppointmentDateLabel）。
  const weekday = new Date(`${year}-${month}-${day}T00:00:00Z`).getUTCDay();

  return `${year}/${month}/${day}（${WEEKDAY_LABELS[weekday]}）${pad(Number(hour))}:${pad(Number(minute))}`;
}

// `lib/email/resend-client.ts` 的 `sendEmail` 把 `html` 參數視為已信任的最終 HTML，
// 不會做任何 escape——TASK-052／053／054 組信件內容時，任何非系統計算的值（顧客
// 姓名、服務名稱、備註等使用者輸入）在內插進 HTML 之前都必須先呼叫這支函式。
// 這不是理論風險：`create_appointment`（0002_booking_flow.sql）對 customer_name
// 只檢查非空與長度 ≤ 50，不做任何字元過濾，且該值來自未登入的公開預約表單——
// 50 字元足以塞入 `<a href="...">...</a>` 這類標籤。若確認信直接把姓名內插進
// HTML，等於讓任何人都能透過填寫預約表單，在由店家已驗證網域寄出的信件裡插入
// 任意連結或內容，形成高可信度的釣魚管道（security-reviewer 於 TASK-051 審查
// 發現的 MUST FIX，本函式是該修正的一部分）。
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
