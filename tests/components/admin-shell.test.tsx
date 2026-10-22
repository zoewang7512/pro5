// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithAppRouter, renderWithTheme as render } from "../test-utils";
import { useUnsavedChangesGuard } from "@/app/admin/_components/UnsavedChangesProvider";
import { AdminShell, isNavItemActive } from "@/app/admin/_components/AdminShell";

const pathnameMock = vi.hoisted(() => ({ value: "/admin" }));
const routerMock = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameMock.value,
  // UnsavedChangesProvider（TASK-081）用 useRouter；AdminShell 現在包著它。
  useRouter: () => ({ push: routerMock.push, replace: vi.fn(), refresh: vi.fn() }),
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

// 放在 AdminShell 裡的測試表單：回報有／沒有未儲存變更（TASK-081）。
function GuardedForm({ dirty }: { dirty: boolean }) {
  useUnsavedChangesGuard("test-form", dirty);
  return <div>表單內容</div>;
}

describe("AdminShell 未儲存變更攔截（TASK-081）", () => {
  afterEach(() => {
    cleanup();
    pathnameMock.value = "/admin";
    routerMock.push.mockReset();
  });

  it("有未儲存變更時點側邊欄：先提示、不導覽；選「放棄變更」後才 router.push 到目標", async () => {
    const user = userEvent.setup();
    const { router } = renderWithAppRouter(
      <AdminShell>
        <GuardedForm dirty />
      </AdminShell>,
    );

    await user.click(screen.getByRole("link", { name: "服務設定" }));
    expect(screen.getByText("有尚未儲存的變更")).toBeInTheDocument();
    expect(routerMock.push).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "放棄變更" }));
    expect(routerMock.push).toHaveBeenCalledWith("/admin/services");
    expect(screen.queryByText("有尚未儲存的變更")).not.toBeInTheDocument();
  });

  it("選「繼續編輯」：停留在原頁，表單內容仍在、不導覽", async () => {
    const user = userEvent.setup();
    renderWithAppRouter(
      <AdminShell>
        <GuardedForm dirty />
      </AdminShell>,
    );

    await user.click(screen.getByRole("link", { name: "服務設定" }));
    await user.click(screen.getByRole("button", { name: "繼續編輯" }));
    expect(screen.getByText("表單內容")).toBeInTheDocument();
    expect(routerMock.push).not.toHaveBeenCalled();
  });

  it("沒有未儲存變更：不提示，由 Next 照常導覽", async () => {
    const user = userEvent.setup();
    const { router } = renderWithAppRouter(
      <AdminShell>
        <GuardedForm dirty={false} />
      </AdminShell>,
    );

    await user.click(screen.getByRole("link", { name: "服務設定" }));
    expect(screen.queryByText("有尚未儲存的變更")).not.toBeInTheDocument();
    expect(router.push).toHaveBeenCalled();
  });

  it("點目前所在頁的導覽項目：就算有變更也不提示（沒有實際導覽）", async () => {
    pathnameMock.value = "/admin/booking-policy";
    const user = userEvent.setup();
    renderWithAppRouter(
      <AdminShell>
        <GuardedForm dirty />
      </AdminShell>,
    );

    await user.click(screen.getByRole("link", { name: "預約規則" }));
    expect(screen.queryByText("有尚未儲存的變更")).not.toBeInTheDocument();
  });
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
