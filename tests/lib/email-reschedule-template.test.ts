import { describe, expect, it } from "vitest";
import { buildRescheduleEmail } from "@/lib/email/templates/reschedule";

describe("buildRescheduleEmail", () => {
  const baseInput = {
    customerName: "王小明",
    serviceName: "剪髮",
    oldStartAt: "2026-08-24T09:00:00+08:00",
    newStartAt: "2026-08-26T13:30:00+08:00",
  };

  it("主旨格式為「預約已改期：{新日期} {新時間}」（不含舊時段）", () => {
    const { subject } = buildRescheduleEmail(baseInput);
    expect(subject).toBe("預約已改期：2026/08/26（三）13:30");
    expect(subject).not.toContain("08/24");
  });

  it("內文包含顧客姓名、服務名稱、原時段與新時段對照", () => {
    const { html } = buildRescheduleEmail(baseInput);
    expect(html).toContain("王小明");
    expect(html).toContain("剪髮");
    expect(html).toContain("2026/08/24（一）09:00");
    expect(html).toContain("2026/08/26（三）13:30");
  });

  it("customerName 含 HTML 特殊字元時必須 escape", () => {
    const { html } = buildRescheduleEmail({
      ...baseInput,
      customerName: '"><script>alert(1)</script>',
    });
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("未提供 storeName 時使用預設值「我們」，未提供 storePhone 時仍顯示不含電話的聯絡提示", () => {
    const { html } = buildRescheduleEmail(baseInput);
    expect(html).toContain("您在我們的預約時段已異動");
    expect(html).toContain("若新時段不方便，請與我們聯繫調整。");
  });

  it("提供 storeName／storePhone 時帶入信件內容並 escape", () => {
    const { html } = buildRescheduleEmail({ ...baseInput, storeName: "測試髮廊", storePhone: "0912-345-678" });
    expect(html).toContain("您在測試髮廊的預約時段已異動");
    expect(html).toContain("若新時段不方便，歡迎聯絡我們調整：0912-345-678");
  });
});
