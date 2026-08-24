import { describe, expect, it } from "vitest";
import { wrapEmailBody } from "@/lib/email/templates/_layout";

describe("wrapEmailBody", () => {
  const baseInput = {
    bodyHtml: "<p>內文</p>",
  };

  it("有 storeLogoUrl 時 Header 顯示 <img>，alt 為店名", () => {
    const html = wrapEmailBody({
      ...baseInput,
      storeName: "路口理髮廳",
      storeLogoUrl: "https://example.invalid/storage/v1/object/public/store-assets/logo/abc.png",
    });
    expect(html).toContain('<img src="https://example.invalid/storage/v1/object/public/store-assets/logo/abc.png"');
    expect(html).toContain('alt="路口理髮廳"');
  });

  it("無 storeLogoUrl 時 Header 改顯示店名文字，不出現 <img>", () => {
    const html = wrapEmailBody({ ...baseInput, storeName: "路口理髮廳" });
    expect(html).not.toContain("<img");
    expect(html).toContain("路口理髮廳");
  });

  it("storeLogoUrl 為純空白字串時視為未提供", () => {
    const html = wrapEmailBody({ ...baseInput, storeName: "路口理髮廳", storeLogoUrl: "   " });
    expect(html).not.toContain("<img");
  });

  it("storeLogoUrl／storeName 含 HTML 特殊字元時必須 escape，避免 <img> 屬性注入", () => {
    const html = wrapEmailBody({
      ...baseInput,
      storeName: '"><script>alert(1)</script>',
      storeLogoUrl: '"><script>alert(2)</script>',
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("未提供 storeName 時 fallback 為「我們」（Header 與 Footer 皆是）", () => {
    const html = wrapEmailBody(baseInput);
    expect(html).toContain("我們");
  });

  it("storeName 為純空白字串時 fallback 為「我們」", () => {
    const html = wrapEmailBody({ ...baseInput, storeName: "   " });
    expect(html).toContain("我們");
  });

  it("Footer 簽章依序組出店名／電話／地址，用「・」分隔", () => {
    const html = wrapEmailBody({
      ...baseInput,
      storeName: "路口理髮廳",
      storePhone: "02-1234-5678",
      storeAddress: "台北市大安區忠孝東路四段1號",
    });
    expect(html).toContain("路口理髮廳・02-1234-5678・台北市大安區忠孝東路四段1號");
  });

  it("storePhone 缺值時 Footer 簽章省略該欄位，不留多餘分隔符號", () => {
    const html = wrapEmailBody({
      ...baseInput,
      storeName: "路口理髮廳",
      storeAddress: "台北市大安區忠孝東路四段1號",
    });
    expect(html).toContain("路口理髮廳・台北市大安區忠孝東路四段1號");
    expect(html).not.toContain("・・");
  });

  it("storeAddress 缺值時 Footer 簽章省略該欄位", () => {
    const html = wrapEmailBody({
      ...baseInput,
      storeName: "路口理髮廳",
      storePhone: "02-1234-5678",
    });
    expect(html).toContain("路口理髮廳・02-1234-5678");
    expect(html).not.toContain("・・");
  });

  it("storePhone／storeAddress 皆缺值時 Footer 只顯示店名", () => {
    const html = wrapEmailBody({ ...baseInput, storeName: "路口理髮廳" });
    const footerMatch = html.match(/padding:8px 32px 28px[^>]*>([^<]*)</);
    expect(footerMatch?.[1]).toBe("路口理髮廳");
  });

  it("storePhone／storeAddress 含 HTML 特殊字元時必須 escape", () => {
    const html = wrapEmailBody({
      ...baseInput,
      storeName: "路口理髮廳",
      storePhone: '<script>alert(1)</script>',
      storeAddress: '<script>alert(2)</script>',
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;script&gt;alert(2)&lt;/script&gt;");
  });

  it("bodyHtml 原樣內插，不做任何 escape（呼叫端已自行處理）", () => {
    const html = wrapEmailBody({ bodyHtml: "<p>已經是安全的內文</p>" });
    expect(html).toContain("<p>已經是安全的內文</p>");
  });
});
