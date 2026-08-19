import { describe, expect, it } from "vitest";
import { calculatePasswordStrength, passwordsMatch, MIN_PASSWORD_LENGTH } from "@/lib/auth/password-strength";

describe("calculatePasswordStrength", () => {
  it("空字串或過短的密碼視為弱", () => {
    expect(calculatePasswordStrength("")).toBe("weak");
    expect(calculatePasswordStrength("ab1")).toBe("weak");
  });

  it("只有小寫字母，即使夠長仍是弱（種類數不足）", () => {
    expect(calculatePasswordStrength("abcdefghijkl")).toBe("weak");
  });

  it("長度達 8 且至少兩種字元種類視為中", () => {
    expect(calculatePasswordStrength("abcdefg1")).toBe("medium");
  });

  it("長度達 12 且至少三種字元種類視為強", () => {
    expect(calculatePasswordStrength("Abcdefgh123!")).toBe("strong");
  });

  it("長度達 12 但只有兩種字元種類，仍只算中（不因長度單獨升到強）", () => {
    expect(calculatePasswordStrength("abcdefghijk1")).toBe("medium");
  });

  it("長度 7（未達中的門檻 8），即使兩種字元種類仍是弱", () => {
    expect(calculatePasswordStrength("abcdefg")).toBe("weak");
    expect(calculatePasswordStrength("abcdef1")).toBe("weak");
  });

  it("長度 11（未達強的門檻 12），即使三種字元種類仍只算中", () => {
    expect(calculatePasswordStrength("Abcdefgh12!")).toBe("medium");
  });

  it("長度 8 且三種字元種類，仍只算中（種類再多也不會單獨升到強，需同時滿足長度 12）", () => {
    expect(calculatePasswordStrength("Abcdef1!")).toBe("medium");
  });

  it("符號視為獨立的字元種類（與英文字母、數字分開計算）", () => {
    expect(calculatePasswordStrength("abcdefg!")).toBe("medium");
  });
});

describe("passwordsMatch", () => {
  it("兩次輸入相同且非空字串時回傳 true", () => {
    expect(passwordsMatch("Abc12345", "Abc12345")).toBe(true);
  });

  it("兩次輸入不同時回傳 false", () => {
    expect(passwordsMatch("Abc12345", "Abc12346")).toBe(false);
  });

  it("兩者皆為空字串時回傳 false（避免尚未輸入就顯示「一致」）", () => {
    expect(passwordsMatch("", "")).toBe(false);
  });

  it("其中一邊為空字串、另一邊非空時回傳 false", () => {
    expect(passwordsMatch("Abc12345", "")).toBe(false);
    expect(passwordsMatch("", "Abc12345")).toBe(false);
  });
});

describe("MIN_PASSWORD_LENGTH", () => {
  it("與 Supabase 專案預設的最短密碼長度一致", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(6);
  });
});
