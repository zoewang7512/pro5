// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithTheme as render, TestThemeWrapper } from "../test-utils";
import { ServiceFormDialog } from "@/app/admin/_components/ServiceFormDialog";
import {
  UnsavedChangesProvider,
  useIsUnsavedDirty,
  useUnsavedChangesGuard,
} from "@/app/admin/_components/UnsavedChangesProvider";
import { createService, updateService } from "@/lib/admin/services";
import type { AdminService } from "@/lib/booking/types";

const showToast = vi.hoisted(() => vi.fn());

// UnsavedChangesProvider（TASK-083 的未儲存變更測試）用到 useRouter／usePathname。
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/services",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

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

// TASK-083：key service-form 的 dirty 判定與關閉攔截。
describe("ServiceFormDialog 未儲存變更（TASK-083，key: service-form）", () => {
  function Probe() {
    const dirty = useIsUnsavedDirty("service-form");
    return <span data-testid="probe">{dirty ? "dirty" : "clean"}</span>;
  }

  // 模擬頁面上「別的表單」有變更（例如另一個 key），用來驗證 service-form 只看自己的 key。
  function OtherFormDirty() {
    useUnsavedChangesGuard("booking-policy", true);
    return null;
  }

  function renderGuarded(
    props: Partial<React.ComponentProps<typeof ServiceFormDialog>> = {},
    extra: React.ReactNode = null,
  ) {
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    const user = userEvent.setup({ delay: null });
    rtlRender(
      <UnsavedChangesProvider>
        <ServiceFormDialog mode="edit" service={EXISTING} onClose={onClose} onSuccess={onSuccess} {...props} />
        <Probe />
        {extra}
      </UnsavedChangesProvider>,
      { wrapper: TestThemeWrapper },
    );
    return { user, onClose, onSuccess };
  }

  const expectDirty = (value: "dirty" | "clean") => expect(screen.getByTestId("probe")).toHaveTextContent(value);
  // 提示對話框的標題；服務對話框本身的標題是「新增／編輯服務項目」。
  const unsavedPrompt = () => screen.queryByText("有尚未儲存的變更");

  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  describe("dirty 判定", () => {
    it("新增：空白預設值不算變更；填了任一欄位才算；清掉回到乾淨", () => {
      renderGuarded({ mode: "create", service: null });
      expectDirty("clean");
      fireEvent.change(screen.getByLabelText("名稱"), { target: { value: "新服務" } });
      expectDirty("dirty");
      fireEvent.change(screen.getByLabelText("名稱"), { target: { value: "" } });
      expectDirty("clean");
    });

    it("編輯：載入當下乾淨；改任一欄位為變更；改回原值回到乾淨", () => {
      renderGuarded();
      expectDirty("clean");
      fireEvent.change(screen.getByLabelText("價格（NT$）"), { target: { value: "900" } });
      expectDirty("dirty");
      fireEvent.change(screen.getByLabelText("價格（NT$）"), { target: { value: "800" } });
      expectDirty("clean");
    });

    it.each([
      ["名稱", "別的名字"],
      ["時長（分鐘）", "90"],
      ["緩衝時間（分鐘）", "10"],
      ["描述", "新的描述"],
    ])("編輯：改「%s」為變更", (label, value) => {
      renderGuarded();
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
      expectDirty("dirty");
    });

    it("對話框卸載後清除 dirty（Provider 仍在；不可殘留造成離不開頁面）", () => {
      const ui = (showDialog: boolean) => (
        <UnsavedChangesProvider>
          {showDialog && <ServiceFormDialog mode="edit" service={EXISTING} onClose={vi.fn()} onSuccess={vi.fn()} />}
          <Probe />
        </UnsavedChangesProvider>
      );
      const { rerender } = rtlRender(ui(true), { wrapper: TestThemeWrapper });
      fireEvent.change(screen.getByLabelText("名稱"), { target: { value: "別的名字" } });
      expectDirty("dirty");

      rerender(ui(false));

      expectDirty("clean");
    });
  });

  describe("關閉攔截", () => {
    it("有變更按「取消」：先提示，不關閉；「繼續編輯」回到對話框且輸入不變", async () => {
      const { user, onClose } = renderGuarded();
      fireEvent.change(screen.getByLabelText("名稱"), { target: { value: "別的名字" } });

      await user.click(screen.getByRole("button", { name: "取消" }));

      expect(await screen.findByText("有尚未儲存的變更")).toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: "繼續編輯" }));
      await waitFor(() => expect(unsavedPrompt()).toBeNull());
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByLabelText("名稱")).toHaveValue("別的名字");
      expect(screen.getByText("編輯服務項目")).toBeInTheDocument();
    });

    it("有變更 →「取消」→「放棄變更」：關閉服務對話框（呼叫 onClose）", async () => {
      const { user, onClose } = renderGuarded();
      fireEvent.change(screen.getByLabelText("名稱"), { target: { value: "別的名字" } });

      await user.click(screen.getByRole("button", { name: "取消" }));
      await user.click(await screen.findByRole("button", { name: "放棄變更" }));

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("有變更按 Esc：先提示、不關閉；再按 Esc 只關閉提示（最上層），服務對話框仍在", async () => {
      const { user, onClose } = renderGuarded();
      fireEvent.change(screen.getByLabelText("名稱"), { target: { value: "別的名字" } });

      await user.keyboard("{Escape}");
      expect(await screen.findByText("有尚未儲存的變更")).toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();

      await user.keyboard("{Escape}");
      await waitFor(() => expect(unsavedPrompt()).toBeNull());
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByText("編輯服務項目")).toBeInTheDocument();
      expect(screen.getByLabelText("名稱")).toHaveValue("別的名字");
    });

    it("有變更點背景：先提示、不關閉", async () => {
      const { user, onClose } = renderGuarded();
      fireEvent.change(screen.getByLabelText("名稱"), { target: { value: "別的名字" } });

      await user.click(document.querySelector(".MuiDialog-container") as HTMLElement);

      expect(await screen.findByText("有尚未儲存的變更")).toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
    });

    it("放棄變更後焦點回到觸發按鈕（兩層一起卸載時不可掉到 body）", async () => {
      const trigger = document.createElement("button");
      trigger.textContent = "觸發按鈕";
      document.body.appendChild(trigger);
      trigger.focus();
      try {
        const { user, onClose } = renderGuarded();
        fireEvent.change(screen.getByLabelText("名稱"), { target: { value: "別的名字" } });

        await user.click(screen.getByRole("button", { name: "取消" }));
        await user.click(await screen.findByRole("button", { name: "放棄變更" }));

        expect(onClose).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(trigger).toHaveFocus());
      } finally {
        trigger.remove();
      }
    });

    it("沒有變更：取消、Esc、點背景都直接關閉，不提示", async () => {
      const { user, onClose } = renderGuarded();

      await user.click(screen.getByRole("button", { name: "取消" }));
      expect(onClose).toHaveBeenCalledTimes(1);

      await user.keyboard("{Escape}");
      expect(onClose).toHaveBeenCalledTimes(2);

      await user.click(document.querySelector(".MuiDialog-container") as HTMLElement);
      expect(onClose).toHaveBeenCalledTimes(3);
      expect(unsavedPrompt()).toBeNull();
    });

    it("只看自己的 key：頁面上別的表單有變更、服務對話框沒變更時，取消直接關閉", async () => {
      const { user, onClose } = renderGuarded({}, <OtherFormDirty />);

      await user.click(screen.getByRole("button", { name: "取消" }));

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(unsavedPrompt()).toBeNull();
    });

    it("儲存中：不可關閉、也不提示（取消鈕停用、Esc 無效）", async () => {
      vi.mocked(updateService).mockReturnValue(new Promise(() => {}));
      const { user, onClose } = renderGuarded();
      fireEvent.change(screen.getByLabelText("名稱"), { target: { value: "別的名字" } });

      await user.click(screen.getByRole("button", { name: "儲存" }));
      await waitFor(() => expect(screen.getByRole("button", { name: "取消" })).toBeDisabled());

      await user.keyboard("{Escape}");
      expect(onClose).not.toHaveBeenCalled();
      expect(unsavedPrompt()).toBeNull();
    });

    it("儲存成功：onSuccess 關閉對話框時不提示", async () => {
      vi.mocked(updateService).mockResolvedValue({ ok: true, data: undefined });
      const { user, onSuccess, onClose } = renderGuarded();
      fireEvent.change(screen.getByLabelText("名稱"), { target: { value: "別的名字" } });

      await user.click(screen.getByRole("button", { name: "儲存" }));

      await waitFor(() => expect(onSuccess).toHaveBeenCalled());
      expect(onClose).not.toHaveBeenCalled();
      expect(unsavedPrompt()).toBeNull();
    });

    it("新增模式有變更按取消：同樣先提示", async () => {
      const { user, onClose } = renderGuarded({ mode: "create", service: null });
      fireEvent.change(screen.getByLabelText("名稱"), { target: { value: "新服務" } });

      await user.click(screen.getByRole("button", { name: "取消" }));

      expect(await screen.findByText("有尚未儲存的變更")).toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  it("沒有 Provider 時照常運作：取消直接關閉", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup({ delay: null });
    render(<ServiceFormDialog mode="edit" service={EXISTING} onClose={onClose} onSuccess={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("名稱"), { target: { value: "別的名字" } });

    await user.click(screen.getByRole("button", { name: "取消" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
