import { escapeHtml, formatAppointmentDateTime } from "@/lib/email/format";
import { wrapEmailBody } from "@/lib/email/templates/_layout";

// 改期通知信的內容組成純函式（TASK-053；Header/Footer 版型 TASK-060）。

export type RescheduleEmailInput = {
  customerName: string;
  serviceName: string;
  oldStartAt: string;
  newStartAt: string;
  storeName?: string | null;
  storePhone?: string | null;
  storeLogoUrl?: string | null;
  storeAddress?: string | null;
};

export type RescheduleEmailContent = { subject: string; html: string };

const DEFAULT_STORE_NAME = "我們";

// 主旨依 feature-spec 固定格式「預約已改期：{新日期} {新時間}」。
export function buildRescheduleEmail(input: RescheduleEmailInput): RescheduleEmailContent {
  const oldDateTimeLabel = formatAppointmentDateTime(input.oldStartAt);
  const newDateTimeLabel = formatAppointmentDateTime(input.newStartAt);
  const subject = `預約已改期：${newDateTimeLabel}`.replace(/[\r\n]+/g, " ");

  // 同 cancellation.ts：customerName 為顧客輸入，必須 escape；其餘欄位縱深防禦
  // 一併 escape。
  const safeCustomerName = escapeHtml(input.customerName);
  const safeServiceName = escapeHtml(input.serviceName);
  const safeOldDateTimeLabel = escapeHtml(oldDateTimeLabel);
  const safeNewDateTimeLabel = escapeHtml(newDateTimeLabel);
  const safeStoreName = escapeHtml(input.storeName?.trim() || DEFAULT_STORE_NAME);
  // 比照 cancellation.ts：補上聯絡方式，讓「若新時段不方便」這句話真的有辦法
  // 聯絡（architect 於本卡審查提出的 NICE TO HAVE，與 TASK-052 confirmation.ts
  // 既有模式一致）。
  const contactLine = input.storePhone?.trim()
    ? `<p>若新時段不方便，歡迎聯絡我們調整：${escapeHtml(input.storePhone.trim())}</p>`
    : "<p>若新時段不方便，請與我們聯繫調整。</p>";

  const bodyHtml = [
    `<p>${safeCustomerName} 您好，</p>`,
    `<p>您在${safeStoreName}的預約時段已異動：</p>`,
    "<ul>",
    `<li>服務項目：${safeServiceName}</li>`,
    `<li>原時段：${safeOldDateTimeLabel}</li>`,
    `<li>新時段：${safeNewDateTimeLabel}</li>`,
    "</ul>",
    contactLine,
  ].join("\n");

  const html = wrapEmailBody({
    storeName: input.storeName,
    storeLogoUrl: input.storeLogoUrl,
    storePhone: input.storePhone,
    storeAddress: input.storeAddress,
    bodyHtml,
  });

  return { subject, html };
}
