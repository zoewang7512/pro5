// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithTheme as render } from "../test-utils";
import { ServiceFormDialog } from "@/app/admin/_components/ServiceFormDialog";
import { createService, updateService } from "@/lib/admin/services";
import type { AdminService } from "@/lib/booking/types";

const showToast = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({}),
}));

vi.mock("@/components/ui/ToastProvider", () => ({
  useToast: () => ({ showToast }),
}));

// 驗證函式用真的，只替換會碰資料庫的寫入函式。
vi.mock("@/lib/admin/services", async () => {
  const actual = await vi.importActual<typeof import("@/lib/admin/services")>("@/lib/admin/services");
  return { ...actual, createService: vi.fn(), updateService: vi.fn() };
});

const EXISTING: AdminService = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "韓系剪髮",
  description: null,
  price: 800,
  duration_minutes: 60,
  buffer_minutes: 0,
  is_active: true,
  sort_order: 0,
};

// 用 fireEvent.change 直接填值：逐字 user.type 在整份測試並行時容易接近逾時。
function fillCreateForm() {
  fireEvent.change(screen.getByLabelText("名稱"), { target: { value: "新服務" } });
  fireEvent.change(screen.getByLabelText("價格（NT$）"), { target: { value: "500" } });
  fireEvent.change(screen.getByLabelText("時長（分鐘）"), { target: { value: "30" } });
}

describe("ServiceFormDialog 成功提示（TASK-070）", () => {
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it("新增成功：提示新服務預設不開給任何設計師，並引導到設計師頁", async () => {
    vi.mocked(createService).mockResolvedValue({ ok: true, data: undefined });
    const onSuccess = vi.fn();
    const user = userEvent.setup({ delay: null });
    render(<ServiceFormDialog mode="create" service={null} onClose={vi.fn()} onSuccess={onSuccess} />);

    fillCreateForm();
    await user.click(screen.getByRole("button", { name: "新增" }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(showToast).toHaveBeenCalledWith("已新增服務。新服務預設不開給任何設計師，請到「設計師」頁開啟。", "success");
  });

  it("編輯成功：維持原本的「服務項目已更新」", async () => {
    vi.mocked(updateService).mockResolvedValue({ ok: true, data: undefined });
    const onSuccess = vi.fn();
    const user = userEvent.setup({ delay: null });
    render(<ServiceFormDialog mode="edit" service={EXISTING} onClose={vi.fn()} onSuccess={onSuccess} />);

    await user.click(screen.getByRole("button", { name: "儲存" }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(showToast).toHaveBeenCalledWith("服務項目已更新", "success");
  });

  it("新增失敗：不顯示成功提示", async () => {
    vi.mocked(createService).mockResolvedValue({ ok: false, error: { message: "boom" } });
    const user = userEvent.setup({ delay: null });
    render(<ServiceFormDialog mode="create" service={null} onClose={vi.fn()} onSuccess={vi.fn()} />);

    fillCreateForm();
    await user.click(screen.getByRole("button", { name: "新增" }));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith("操作失敗，請稍後再試", "error"));
    expect(showToast).not.toHaveBeenCalledWith(expect.stringContaining("已新增服務"), "success");
  });
});
