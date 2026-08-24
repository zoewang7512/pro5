import { describe, expect, it } from "vitest";
import { buildCancellationEmail } from "@/lib/email/templates/cancellation";

describe("buildCancellationEmail", () => {
  const baseInput = {
    customerName: "王小明",
    serviceName: "剪髮",
    startAt: "2026-08-24T09:00:00+08:00",
  };

  it("主旨格式為「預約已取消：{服務名稱} {日期} {時間}」", () => {
    const { subject } = buildCancellationEmail(baseInput);
    expect(subject).toBe("預約已取消：剪髮 2026/08/24（一）09:00");
  });

  it("內文包含顧客姓名、服務名稱、原時段", () => {
    const { html } = buildCancellationEmail(baseInput);
    expect(html).toContain("王小明");
    expect(html).toContain("剪髮");
    expect(html).toContain("2026/08/24（一）09:00");
  });

  it("customerName 含 HTML 特殊字元時必須 escape", () => {
    const { html } = buildCancellationEmail({
      ...baseInput,
      customerName: '<img src=x onerror=alert(1)>',
    });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("未提供 storeName 時使用預設值「我們」，未提供 storePhone 時不出現聯絡方式段落", () => {
    const { html } = buildCancellationEmail(baseInput);
    expect(html).toContain("您在我們的以下預約已取消");
    expect(html).not.toContain("如需重新預約或有任何問題");
  });

  it("提供 storeName／storePhone 時帶入信件內容並 escape", () => {
    const { html } = buildCancellationEmail({ ...baseInput, storeName: "測試髮廊", storePhone: "0912-345-678" });
    expect(html).toContain("您在測試髮廊的以下預約已取消");
    expect(html).toContain("如需重新預約或有任何問題，歡迎聯絡我們：0912-345-678");
  });
});
