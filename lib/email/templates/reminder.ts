import { escapeHtml, formatAppointmentDateTime } from "@/lib/email/format";

// 預約前提醒信的內容組成純函式（TASK-054）。

export type ReminderEmailInput = {
  customerName: string;
  serviceName: string;
  startAt: string;
  storeName?: string | null;
  storePhone?: string | null;
};

export type ReminderEmailContent = { subject: string; html: string };

const DEFAULT_STORE_NAME = "我們";

// 主旨格式比照 TASK-052/053 已確立的慣例「{狀態}：{服務名稱} {日期} {時間}」，
// 用「預約提醒」而非 feature-spec 使用者旅程範例的「提醒您明天有預約」——本卡
// 實際寄送時間受 Vercel Hobby 方案每日一次的限制影響，提前量可能是 20～48 小時
// 之間的任何值（見 lib/admin/appointment-reminders.ts 的時間窗設計），不保證
// 剛好是「明天」，用固定格式的主旨較不會誤導顧客。
export function buildReminderEmail(input: ReminderEmailInput): ReminderEmailContent {
  const dateTimeLabel = formatAppointmentDateTime(input.startAt);
  const subject = `預約提醒：${input.serviceName} ${dateTimeLabel}`.replace(/[\r\n]+/g, " ");

  // customerName 來自顧客未登入即可送出的預約表單，內插進 HTML 前必須 escape
  // （見 lib/email/format.ts escapeHtml 檔頭說明，比照 TASK-052/053 的既有紀律）。
  const safeCustomerName = escapeHtml(input.customerName);
  const safeServiceName = escapeHtml(input.serviceName);
  const safeDateTimeLabel = escapeHtml(dateTimeLabel);
  const safeStoreName = escapeHtml(input.storeName?.trim() || DEFAULT_STORE_NAME);
  const contactLine = input.storePhone?.trim()
    ? `<p>如有問題，歡迎聯絡我們：${escapeHtml(input.storePhone.trim())}</p>`
    : "";

  const html = [
    `<p>${safeCustomerName} 您好，</p>`,
    `<p>提醒您在${safeStoreName}的預約即將到來：</p>`,
    "<ul>",
    `<li>服務項目：${safeServiceName}</li>`,
    `<li>預約時段：${safeDateTimeLabel}</li>`,
    "</ul>",
    contactLine,
    "<p>期待您的光臨。</p>",
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html };
}
