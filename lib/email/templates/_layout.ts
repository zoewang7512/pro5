import { escapeHtml } from "@/lib/email/format";

// 四種通知信共用的 Header／Footer 版型（TASK-060）。Header 用店家 Logo banner，
// Footer 用一行小字簽章（店名／電話／地址）。純函式、不做 I/O，供
// confirmation.ts／cancellation.ts／reschedule.ts／reminder.ts 呼叫，各自只負責
// 組出自己的 `bodyHtml`（既有段落／清單／contactLine 邏輯不變）。
//
// 版型細節（padding／字級／色碼）直接對齊已核准的 mockup：
// ai/artifacts/Email 通知與提醒/mockups/confirmation-email-selected.html
// （Header 採變體 C 樣式、Footer 採變體 B 樣式，見該 Epic 的 mockup-decision-
// 確認信版型.md）。

export const DEFAULT_STORE_NAME = "我們";

export type EmailShellInput = {
  storeName?: string | null;
  storeLogoUrl?: string | null;
  storePhone?: string | null;
  storeAddress?: string | null;
  bodyHtml: string;
};

// storeName／storeLogoUrl／storePhone／storeAddress 皆視為未經 escape 的原始值，
// 内部一律呼叫 escapeHtml 才內插——呼叫端（各範本檔案）不需要、也不應該預先 escape
// 這幾個欄位再傳進來（比照 lib/email/format.ts escapeHtml 檔頭說明的既有紀律：
// escape 在「內插進 HTML 前」的最後一步做，不讓已 escape 過的字串在函式之間流動）。
//
// storeLogoUrl 的信任邊界不在這裡處理：呼叫端必須傳入已經過
// lib/store-settings.ts resolveStoreDisplay()（trustedAssetUrl 白名單）處理過的
// 網址，這裡只負責把收到的字串 escape 後放進 <img src>，不重新驗證網址來源。
export function wrapEmailBody(input: EmailShellInput): string {
  const safeStoreName = escapeHtml(input.storeName?.trim() || DEFAULT_STORE_NAME);
  const trimmedLogoUrl = input.storeLogoUrl?.trim();

  // Header：有 Logo 用圖片（width/height 明確寫死，避免圖片被信箱客戶端封鎖時版面
  // 塌陷）；無 Logo 時退回大字店名，維持相同的 primary.50 品牌色塊，不留空白區塊。
  const headerHtml = trimmedLogoUrl
    ? `<img src="${escapeHtml(trimmedLogoUrl)}" alt="${safeStoreName}" width="160" style="max-height:64px;width:auto;height:64px;display:inline-block;" />`
    : `<div style="font-family:Georgia,'Noto Serif TC','PingFang TC','Microsoft JhengHei',serif;font-size:22px;font-weight:700;color:#6F531E;letter-spacing:0;">${safeStoreName}</div>`;

  // Footer：店名／電話／地址用「・」分隔，缺值欄位省略，不留下多餘分隔符號。
  const signatureParts = [
    safeStoreName,
    input.storePhone?.trim() ? escapeHtml(input.storePhone.trim()) : null,
    input.storeAddress?.trim() ? escapeHtml(input.storeAddress.trim()) : null,
  ].filter((part): part is string => !!part);

  return [
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;background:#FFFFFF;border:1px solid #E4DDD1;border-radius:12px;overflow:hidden;">`,
    `<tr><td style="padding:32px 32px;text-align:center;background:#FBF4E2;">${headerHtml}</td></tr>`,
    `<tr><td style="padding:28px 32px 8px;font-size:14px;line-height:1.7;color:#2B2622;">${input.bodyHtml}</td></tr>`,
    `<tr><td style="padding:8px 32px 28px;font-size:12px;line-height:1.6;color:#6B6259;">${signatureParts.join("・")}</td></tr>`,
    `</table>`,
  ].join("\n");
}
