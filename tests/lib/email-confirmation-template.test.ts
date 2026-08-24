import { describe, expect, it } from "vitest";
import { buildConfirmationEmail } from "@/lib/email/templates/confirmation";

describe("buildConfirmationEmail", () => {
  const baseInput = {
    customerName: "王小明",
    serviceName: "剪髮",
    startAt: "2026-08-24T09:00:00+08:00",
  };

  it("主旨格式為「預約確認：{服務名稱} {日期} {時間}」", () => {
    const { subject } = buildConfirmationEmail(baseInput);
    expect(subject).toBe("預約確認：剪髮 2026/08/24（一）09:00");
  });

  it("內文包含顧客姓名、服務名稱、時段", () => {
    const { html } = buildConfirmationEmail(baseInput);
    expect(html).toContain("王小明");
    expect(html).toContain("剪髮");
    expect(html).toContain("2026/08/24（一）09:00");
  });

  it("customerName 含 HTML 特殊字元時必須 escape，避免 email HTML injection", () => {
    const { html } = buildConfirmationEmail({
      ...baseInput,
      customerName: '<a href="https://evil.example">click</a>',
    });
    expect(html).not.toContain("<a href=\"https://evil.example\">");
    expect(html).toContain("&lt;a href=&quot;https://evil.example&quot;&gt;");
  });

  it("未提供 storeName 時使用預設值「我們」", () => {
    const { html } = buildConfirmationEmail(baseInput);
    expect(html).toContain("您在我們的預約已成立");
  });

  it("提供 storeName 時帶入信件內容並 escape", () => {
    const { html } = buildConfirmationEmail({ ...baseInput, storeName: "<b>測試髮廊</b>" });
    expect(html).toContain("您在&lt;b&gt;測試髮廊&lt;/b&gt;的預約已成立");
  });

  it("未提供 storePhone 時不出現聯絡方式段落", () => {
    const { html } = buildConfirmationEmail(baseInput);
    expect(html).not.toContain("如需異動預約");
  });

  it("提供 storePhone 時出現聯絡方式段落並 escape", () => {
    const { html } = buildConfirmationEmail({ ...baseInput, storePhone: "0912-345-678" });
    expect(html).toContain("如需異動預約，歡迎聯絡我們：0912-345-678");
  });

  it("storeName／storePhone 為純空白字串時視為未提供", () => {
    const { html } = buildConfirmationEmail({ ...baseInput, storeName: "   ", storePhone: "   " });
    expect(html).toContain("您在我們的預約已成立");
    expect(html).not.toContain("如需異動預約");
  });
});
