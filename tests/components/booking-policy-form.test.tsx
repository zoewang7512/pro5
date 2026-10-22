// @vitest-environment jsdom
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render as rtlRender, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TestThemeWrapper } from "../test-utils";
import { BookingPolicyForm } from "@/app/admin/_components/BookingPolicyForm";
import { UnsavedChangesProvider, useIsUnsavedDirty } from "@/app/admin/_components/UnsavedChangesProvider";
import { getBookingPolicy, updateBookingPolicy } from "@/lib/booking-policy";

const showToast = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/booking-policy",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({}),
}));

vi.mock("@/components/ui/ToastProvider", () => ({
  useToast: () => ({ showToast }),
}));

// 驗證函式用真的（純函式）；只 mock 打資料庫的兩支。
vi.mock("@/lib/booking-policy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/booking-policy")>();
  return { ...actual, getBookingPolicy: vi.fn(), updateBookingPolicy: vi.fn() };
});

function render(ui: React.ReactElement) {
  return rtlRender(ui, { wrapper: TestThemeWrapper });
}

// 讀取 "booking-policy" key 的狀態，讓測試能直接斷言「表單回報了什麼」。
function Probe() {
  const dirty = useIsUnsavedDirty("booking-policy");
  return <span data-testid="probe">{dirty ? "dirty" : "clean"}</span>;
}

async function renderLoaded() {
  const user = userEvent.setup();
  render(
    <UnsavedChangesProvider>
      <BookingPolicyForm />
      <Probe />
    </UnsavedChangesProvider>,
  );
  const minLead = await screen.findByLabelText("最短提前預約時間（小時）");
  const cancelWindow = screen.getByLabelText("可取消／改期時限（小時）");
  return { user, minLead, cancelWindow };
}

describe("BookingPolicyForm 未儲存變更回報（TASK-081）", () => {
  beforeEach(() => {
    showToast.mockReset();
    vi.mocked(getBookingPolicy).mockResolvedValue({
      ok: true,
      data: { id: 1, min_lead_time_hours: 1, cancel_window_hours: null, updated_at: "2026-10-22T00:00:00Z" } as never,
    });
    vi.mocked(updateBookingPolicy).mockReset();
  });
  afterEach(() => {
    cleanup();
  });

  it("載入完成、沒有改動：乾淨", async () => {
    await renderLoaded();
    expect(screen.getByTestId("probe")).toHaveTextContent("clean");
  });

  it("載入中：乾淨（骨架畫面不計入變更）", () => {
    vi.mocked(getBookingPolicy).mockReturnValue(new Promise(() => {}));
    render(
      <UnsavedChangesProvider>
        <BookingPolicyForm />
        <Probe />
      </UnsavedChangesProvider>,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("clean");
  });

  it("改了任一欄位：回報有變更", async () => {
    const { user, minLead } = await renderLoaded();
    await user.clear(minLead);
    await user.type(minLead, "24");
    expect(screen.getByTestId("probe")).toHaveTextContent("dirty");
  });

  it("只改第二個欄位（可取消／改期時限）也算變更", async () => {
    const { user, cancelWindow } = await renderLoaded();
    await user.type(cancelWindow, "48");
    expect(screen.getByTestId("probe")).toHaveTextContent("dirty");
  });

  it("改回原值：回到乾淨", async () => {
    const { user, minLead } = await renderLoaded();
    await user.clear(minLead);
    await user.type(minLead, "24");
    expect(screen.getByTestId("probe")).toHaveTextContent("dirty");

    await user.clear(minLead);
    await user.type(minLead, "1");
    expect(screen.getByTestId("probe")).toHaveTextContent("clean");
  });

  it("儲存成功：回到乾淨", async () => {
    vi.mocked(updateBookingPolicy).mockResolvedValue({ ok: true, data: undefined as never });
    const { user, minLead } = await renderLoaded();
    await user.clear(minLead);
    await user.type(minLead, "24");
    expect(screen.getByTestId("probe")).toHaveTextContent("dirty");

    await user.click(screen.getByRole("button", { name: "儲存" }));
    await screen.findByText("clean");
    expect(updateBookingPolicy).toHaveBeenCalledTimes(1);
  });

  it("儲存失敗：維持有變更（使用者的輸入還沒存）", async () => {
    vi.mocked(updateBookingPolicy).mockResolvedValue({ ok: false, error: { message: "x" } });
    const { user, minLead } = await renderLoaded();
    await user.clear(minLead);
    await user.type(minLead, "24");

    await user.click(screen.getByRole("button", { name: "儲存" }));
    await vi.waitFor(() => expect(showToast).toHaveBeenCalledWith("操作失敗，請稍後再試", "error"));
    expect(screen.getByTestId("probe")).toHaveTextContent("dirty");
  });

  it("沒有 Provider 時（既有情境）表單照常運作，不報錯", async () => {
    render(<BookingPolicyForm />);
    const minLead = await screen.findByLabelText("最短提前預約時間（小時）");
    await userEvent.setup().type(minLead, "0");
    expect(minLead).toBeInTheDocument();
  });
});
