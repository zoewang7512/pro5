import { describe, expect, it } from "vitest";
import { normalizePhone, validateEmail, validateName, validatePhone } from "@/lib/booking/validation";

describe("validateName", () => {
  it("拒絕空白（含只有空格）", () => {
    expect(validateName("")).toEqual({ valid: false, message: "請輸入姓名" });
    expect(validateName("   ")).toEqual({ valid: false, message: "請輸入姓名" });
  });

  it("拒絕超過 50 字", () => {
    const result = validateName("a".repeat(51));
    expect(result.valid).toBe(false);
  });

  it("接受並回傳去除前後空白的值", () => {
    expect(validateName("  王小美  ")).toEqual({ valid: true, value: "王小美" });
  });
});

describe("normalizePhone", () => {
  it("去除空格、破折號等非數字字元", () => {
    expect(normalizePhone("09-1234 5678")).toBe("0912345678");
    expect(normalizePhone("(02)1234-5678")).toBe("0212345678");
  });
});

describe("validatePhone", () => {
  it("拒絕空白", () => {
    expect(validatePhone("")).toEqual({ valid: false, message: "請輸入電話" });
  });

  it("拒絕不以 0 開頭", () => {
    const result = validatePhone("912345678");
    expect(result.valid).toBe(false);
  });

  it("拒絕長度不足 8 碼或超過 10 碼", () => {
    expect(validatePhone("0912345").valid).toBe(false); // 7 碼
    expect(validatePhone("091234567890").valid).toBe(false); // 12 碼
  });

  it("接受台灣手機格式，含破折號／空格會先正規化", () => {
    expect(validatePhone("0912-345-678")).toEqual({ valid: true, value: "0912345678" });
    expect(validatePhone("0912 345 678")).toEqual({ valid: true, value: "0912345678" });
  });

  it("接受市話格式（8 碼）", () => {
    expect(validatePhone("02123456")).toEqual({ valid: true, value: "02123456" });
  });
});

describe("validateEmail", () => {
  it("空白視為有效（選填欄位）", () => {
    expect(validateEmail("")).toEqual({ valid: true, value: "" });
    expect(validateEmail("   ")).toEqual({ valid: true, value: "" });
  });

  it("拒絕不符合基本格式的 email", () => {
    expect(validateEmail("not-an-email").valid).toBe(false);
    expect(validateEmail("missing@domain").valid).toBe(false);
    expect(validateEmail("@nodomain.com").valid).toBe(false);
  });

  it("接受符合格式的 email，回傳去除前後空白的值", () => {
    expect(validateEmail("  user@example.com  ")).toEqual({ valid: true, value: "user@example.com" });
  });
});
