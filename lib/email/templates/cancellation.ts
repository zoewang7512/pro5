import { escapeHtml, formatAppointmentDateTime } from "@/lib/email/format";

// 取消通知信的內容組成純函式（TASK-053）。

export type CancellationEmailInput = {
  customerName: string;
  serviceName: string;
  startAt: string;
  storeName?: string | null;
  storePhone?: string | null;
};

export type CancellationEmailContent = { subject: string; html: string };

const DEFAULT_STORE_NAME = "我們";

// 主旨依 feature-spec 固定格式「預約已取消：{原服務名稱} {原日期} {原時間}」。
export function buildCancellationEmail(input: CancellationEmailInput): CancellationEmailContent {
  const dateTimeLabel = formatAppointmentDateTime(input.startAt);
  const subject = `預約已取消：${input.serviceName} ${dateTimeLabel}`.replace(/[\r\n]+/g, " ");

  // customerName 來自顧客未登入即可送出的預約表單，內插進 HTML 前必須 escape
  // （見 lib/email/format.ts escapeHtml 檔頭說明，比照 TASK-052 confirmation.ts
  // 的既有紀律）。serviceName／dateTimeLabel／storeName／storePhone 雖然是系統
  // 計算/後台可信輸入，仍一併 escape，維持縱深防禦。
  const safeCustomerName = escapeHtml(input.customerName);
  const safeServiceName = escapeHtml(input.serviceName);
  const safeDateTimeLabel = escapeHtml(dateTimeLabel);
  const safeStoreName = escapeHtml(input.storeName?.trim() || DEFAULT_STORE_NAME);
  // 有聯絡方式時提供，讓顧客知道可以怎麼詢問或改約——與 TASK-052 confirmation.ts
  // 的既有模式一致（architect 於本卡審查提出的 NICE TO HAVE：取消/改期信原本
  // 缺聯絡資訊，與確認信的既有模式偏移，getStoreSettings 已在 route.ts 匯入，
  // 補上成本很低）。
  const contactLine = input.storePhone?.trim()
    ? `<p>如需重新預約或有任何問題，歡迎聯絡我們：${escapeHtml(input.storePhone.trim())}</p>`
    : "";

  const html = [
    `<p>${safeCustomerName} 您好，</p>`,
    `<p>您在${safeStoreName}的以下預約已取消：</p>`,
    "<ul>",
    `<li>服務項目：${safeServiceName}</li>`,
    `<li>原預約時段：${safeDateTimeLabel}</li>`,
    "</ul>",
    contactLine,
    "<p>如需重新預約，歡迎再次前來預約。</p>",
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html };
}
