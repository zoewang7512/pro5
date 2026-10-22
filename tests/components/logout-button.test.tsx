// @vitest-environment jsdom
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithTheme as render } from "../test-utils";
import { LogoutButton } from "@/app/admin/logout-button";
import { UnsavedChangesProvider, useUnsavedChangesGuard } from "@/app/admin/_components/UnsavedChangesProvider";

const mocks = vi.hoisted(() => ({
  signOut: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/booking-policy",
  useRouter: () => ({ push: vi.fn(), replace: mocks.replace, refresh: mocks.refresh }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signOut: mocks.signOut } }),
}));

function DirtyForm({ dirty }: { dirty: boolean }) {
  useUnsavedChangesGuard("test-form", dirty);
  return null;
}

describe("LogoutButton（TASK-081 未儲存變更攔截）", () => {
  beforeEach(() => {
    mocks.signOut.mockReset().mockResolvedValue({ error: null });
    mocks.replace.mockReset();
    mocks.refresh.mockReset();
  });
  afterEach(() => {
    cleanup();
  });

  it("沒有 Provider（或沒有變更）時直接登出：signOut → router.replace(/login) → refresh", async () => {
    const user = userEvent.setup();
    render(<LogoutButton />);

    await user.click(screen.getByRole("button", { name: "登出" }));
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    expect(mocks.replace).toHaveBeenCalledWith("/login");
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("有 Provider 但沒有未儲存變更：不提示，直接登出", async () => {
    const user = userEvent.setup();
    render(
      <UnsavedChangesProvider>
        <DirtyForm dirty={false} />
        <LogoutButton />
      </UnsavedChangesProvider>,
    );

    await user.click(screen.getByRole("button", { name: "登出" }));
    expect(screen.queryByText("有尚未儲存的變更")).not.toBeInTheDocument();
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });

  it("有未儲存變更：先提示、不登出；選「繼續編輯」仍不登出", async () => {
    const user = userEvent.setup();
    render(
      <UnsavedChangesProvider>
        <DirtyForm dirty />
        <LogoutButton />
      </UnsavedChangesProvider>,
    );

    await user.click(screen.getByRole("button", { name: "登出" }));
    expect(screen.getByText("有尚未儲存的變更")).toBeInTheDocument();
    expect(mocks.signOut).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "繼續編輯" }));
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("有未儲存變更時選「放棄變更」：才登出並導向 /login", async () => {
    const user = userEvent.setup();
    render(
      <UnsavedChangesProvider>
        <DirtyForm dirty />
        <LogoutButton />
      </UnsavedChangesProvider>,
    );

    await user.click(screen.getByRole("button", { name: "登出" }));
    await user.click(screen.getByRole("button", { name: "放棄變更" }));

    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    expect(mocks.replace).toHaveBeenCalledWith("/login");
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
});
