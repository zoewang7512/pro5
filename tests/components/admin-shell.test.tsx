// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithTheme as render } from "../test-utils";
import { AdminShell, isNavItemActive } from "@/app/admin/_components/AdminShell";

const pathnameMock = vi.hoisted(() => ({ value: "/admin" }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameMock.value,
}));

vi.mock("@/app/admin/_components/AdminProfileContext", () => ({
  useAdminProfile: () => ({ displayName: null, avatarUrl: null }),
}));

vi.mock("@/app/admin/logout-button", () => ({
  LogoutButton: () => <button type="button">登出</button>,
}));

describe("AdminShell 導覽項目", () => {
  afterEach(() => {
    cleanup();
    pathnameMock.value = "/admin";
  });

  it("「設計師」排在「預約」之後、「服務設定」之前，連到 /admin/designers", () => {
    render(<AdminShell>content</AdminShell>);

    const links = screen.getAllByRole("link");
    const labels = links.map((link) => link.textContent);
    expect(labels.indexOf("設計師")).toBe(labels.indexOf("預約") + 1);
    expect(labels.indexOf("服務設定")).toBe(labels.indexOf("設計師") + 1);
    expect(screen.getByRole("link", { name: "設計師" })).toHaveAttribute("href", "/admin/designers");
  });

  it("在 /admin/designers 時只有「設計師」是使用中的導覽項目", () => {
    pathnameMock.value = "/admin/designers";
    render(<AdminShell>content</AdminShell>);

    expect(screen.getByRole("link", { name: "設計師" })).toHaveClass("Mui-selected");
    expect(screen.getByRole("link", { name: "預約" })).not.toHaveClass("Mui-selected");
  });

  it.each(["/admin/designers/new", "/admin/designers/3f2b8c1e-9d4a-4e6f-8a7b-1c2d3e4f5a6b"])(
    "在 %s（子路徑）時「設計師」仍是使用中的導覽項目",
    (path) => {
      pathnameMock.value = path;
      render(<AdminShell>content</AdminShell>);

      expect(screen.getByRole("link", { name: "設計師" })).toHaveClass("Mui-selected");
      expect(screen.getByRole("link", { name: "預約" })).not.toHaveClass("Mui-selected");
    },
  );
});

describe("isNavItemActive", () => {
  it("/admin 只完全比對（否則會吃掉所有後台頁面）", () => {
    expect(isNavItemActive("/admin", "/admin")).toBe(true);
    expect(isNavItemActive("/admin/designers", "/admin")).toBe(false);
  });
  it("其他項目：完全相同或其子路徑才算，名稱相近的兄弟路徑不算", () => {
    expect(isNavItemActive("/admin/designers", "/admin/designers")).toBe(true);
    expect(isNavItemActive("/admin/designers/new", "/admin/designers")).toBe(true);
    expect(isNavItemActive("/admin/designers-archive", "/admin/designers")).toBe(false);
    expect(isNavItemActive("/admin/services", "/admin/designers")).toBe(false);
  });
});
