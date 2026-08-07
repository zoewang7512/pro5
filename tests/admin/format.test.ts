import { describe, expect, it } from "vitest";
import { formatDateSlash } from "@/lib/admin/format";

describe("formatDateSlash", () => {
  it("把 YYYY-MM-DD 轉成 YYYY/MM/DD", () => {
    expect(formatDateSlash("2026-08-14")).toBe("2026/08/14");
  });

  it("補零後的月份/日期原樣保留（不去除前導零）", () => {
    expect(formatDateSlash("2026-01-05")).toBe("2026/01/05");
  });
});
