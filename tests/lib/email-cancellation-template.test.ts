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

  it("提供 storeLogoUrl／storeAddress 時，Header/Footer（TASK-060）正確帶入", () => {
    const { html } = buildCancellationEmail({
      ...baseInput,
      storeName: "路口理髮廳",
      storePhone: "02-1234-5678",
      storeAddress: "台北市大安區忠孝東路四段1號",
      storeLogoUrl: "https://example.invalid/storage/v1/object/public/store-assets/logo/abc.png",
    });
    expect(html).toContain('<img src="https://example.invalid/storage/v1/object/public/store-assets/logo/abc.png"');
    expect(html).toContain("路口理髮廳・02-1234-5678・台北市大安區忠孝東路四段1號");
  });

  describe("設計師名稱（TASK-076）", () => {
    it("提供 designerName 時輸出「設計師」一行，主旨不含名稱", () => {
      const { html, subject } = buildCancellationEmail({ ...baseInput, designerName: "小美" });
      expect(html).toContain("<li>設計師：小美</li>");
      expect(subject).not.toContain("小美");
      expect(subject).toContain("預約已取消");
    });

    it.each([undefined, null, "", "   "])("designerName 為 %j 時不輸出「設計師」一行，也不留下空的 <li>", (designerName) => {
      const { html } = buildCancellationEmail({ ...baseInput, designerName });
      expect(html).not.toContain("設計師：");
      expect(html).not.toContain("<li></li>");
    });

    it("designerName 含 <script> 時必須 escape", () => {
      const { html } = buildCancellationEmail({ ...baseInput, designerName: "<script>alert(1)</script>" });
      expect(html).not.toContain("<script>alert(1)</script>");
      expect(html).toContain("<li>設計師：&lt;script&gt;alert(1)&lt;/script&gt;</li>");
    });

    it("designerName 含雙引號、單引號與 & 時分別 escape 成 &quot;、&#39;、&amp;", () => {
      const { html } = buildCancellationEmail({ ...baseInput, designerName: "A\"B'C&D" });
      expect(html).toContain("設計師：A&quot;B&#39;C&amp;D");
    });

    it("designerName 含換行時主旨不會出現換行（名稱不進主旨）", () => {
      const { subject, html } = buildCancellationEmail({ ...baseInput, designerName: "小\n美" });
      expect(subject).not.toMatch(/[\r\n]/);
      expect(html).toContain("設計師：");
    });
  });
});
