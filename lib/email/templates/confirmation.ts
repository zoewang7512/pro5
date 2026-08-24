import { escapeHtml, formatAppointmentDateTime } from "@/lib/email/format";

// 預約成立確認信的內容組成純函式（TASK-052）。不做任何 I/O，方便單元測試；
// 呼叫端（app/api/webhooks/appointment-events/route.ts）負責查詢服務名稱／店家
// 資訊後傳入這裡組裝。

export type ConfirmationEmailInput = {
  customerName: string;
  serviceName: string;
  startAt: string;
  storeName?: string | null;
  storePhone?: string | null;
};

export type ConfirmationEmailContent = { subject: string; html: string };

const DEFAULT_STORE_NAME = "我們";

// 主旨依 feature-spec 固定格式「預約確認：{服務名稱} {日期} {時間}」；serviceName
// 來自 services 表（僅限已登入設計師可寫入，非公開表單輸入），不需要走 escapeHtml
// （那是給 HTML 內文用的，主旨是純文字 email header，兩者風險模型不同）。
export function buildConfirmationEmail(input: ConfirmationEmailInput): ConfirmationEmailContent {
  const dateTimeLabel = formatAppointmentDateTime(input.startAt);
  // serviceName 目前僅限已登入設計師可寫入（見下方 escape 說明），理論風險低，仍
  // 剝除換行字元：subject 是 email header，換行字元有 header injection 的疑慮，
  // 這裡的防禦成本近乎零（security-reviewer 於本卡審查建議）。
  const subject = `預約確認：${input.serviceName} ${dateTimeLabel}`.replace(/[\r\n]+/g, " ");

  // customerName 來自顧客未登入即可送出的預約表單（create_appointment 只檢查長度，
  // 不過濾字元），內插進 HTML 前必須 escape（lib/email/format.ts escapeHtml 檔頭
  // 說明的既有風險）。serviceName／storeName／storePhone 雖然是後台可信輸入，仍一併
  // escape：多一層防禦成本很低，且避免日後這幾個欄位的資料來源變動時被遺漏。
  const safeCustomerName = escapeHtml(input.customerName);
  const safeServiceName = escapeHtml(input.serviceName);
  const safeDateTimeLabel = escapeHtml(dateTimeLabel);
  const safeStoreName = escapeHtml(input.storeName?.trim() || DEFAULT_STORE_NAME);
  const contactLine = input.storePhone?.trim()
    ? `<p>如需異動預約，歡迎聯絡我們：${escapeHtml(input.storePhone.trim())}</p>`
    : "";

  const html = [
    `<p>${safeCustomerName} 您好，</p>`,
    `<p>您在${safeStoreName}的預約已成立：</p>`,
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
