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

  it("提供 storeLogoUrl／storeAddress 時，Header/Footer（TASK-060）正確帶入", () => {
    const { html } = buildConfirmationEmail({
      ...baseInput,
      storeName: "路口理髮廳",
      storePhone: "02-1234-5678",
      storeAddress: "台北市大安區忠孝東路四段1號",
      storeLogoUrl: "https://example.invalid/storage/v1/object/public/store-assets/logo/abc.png",
    });
    expect(html).toContain('<img src="https://example.invalid/storage/v1/object/public/store-assets/logo/abc.png"');
    expect(html).toContain("路口理髮廳・02-1234-5678・台北市大安區忠孝東路四段1號");
  });

  it("未提供 storeLogoUrl 時 Header 改顯示店名文字，既有內文邏輯不受影響", () => {
    const { html } = buildConfirmationEmail({ ...baseInput, storeName: "路口理髮廳" });
    expect(html).not.toContain("<img");
    expect(html).toContain("您在路口理髮廳的預約已成立");
  });

  describe("設計師名稱（TASK-076）", () => {
    it("提供 designerName 時輸出「設計師」一行，主旨不含名稱", () => {
      const { html, subject } = buildConfirmationEmail({ ...baseInput, designerName: "小美" });
      expect(html).toContain("<li>設計師：小美</li>");
      expect(subject).not.toContain("小美");
      expect(subject).toContain("預約確認");
    });

    it.each([undefined, null, "", "   "])("designerName 為 %j 時不輸出「設計師」一行，也不留下空的 <li>", (designerName) => {
      const { html } = buildConfirmationEmail({ ...baseInput, designerName });
      expect(html).not.toContain("設計師：");
      expect(html).not.toContain("<li></li>");
    });

    it("designerName 含 <script> 時必須 escape", () => {
      const { html } = buildConfirmationEmail({ ...baseInput, designerName: "<script>alert(1)</script>" });
      expect(html).not.toContain("<script>alert(1)</script>");
      expect(html).toContain("<li>設計師：&lt;script&gt;alert(1)&lt;/script&gt;</li>");
    });

    it("designerName 含雙引號、單引號與 & 時分別 escape 成 &quot;、&#39;、&amp;", () => {
      const { html } = buildConfirmationEmail({ ...baseInput, designerName: "A\"B'C&D" });
      expect(html).toContain("設計師：A&quot;B&#39;C&amp;D");
    });

    it("designerName 含換行時主旨不會出現換行（名稱不進主旨）", () => {
      const { subject, html } = buildConfirmationEmail({ ...baseInput, designerName: "小\n美" });
      expect(subject).not.toMatch(/[\r\n]/);
      expect(html).toContain("設計師：");
    });
  });
});
