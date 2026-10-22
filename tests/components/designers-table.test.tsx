// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithTheme as render } from "../test-utils";
import { DesignersTable } from "@/app/admin/_components/DesignersTable";
import {
  countFutureAppointmentsForDesigner,
  listDesigners,
  setDesignerActive,
  swapDesignerOrder,
  type AdminDesigner,
} from "@/lib/admin/designers";

const showToast = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({}),
}));

vi.mock("@/components/ui/ToastProvider", () => ({
  useToast: () => ({ showToast }),
}));

vi.mock("@/lib/admin/designers", () => ({
  listDesigners: vi.fn(),
  setDesignerActive: vi.fn(),
  swapDesignerOrder: vi.fn(),
  countFutureAppointmentsForDesigner: vi.fn(),
}));

const BASE_URL = "https://project-ref.supabase.co";

function designer(overrides: Partial<AdminDesigner>): AdminDesigner {
  return {
    id: "d1",
    name: "林小美",
    bio: null,
    specialties: [],
    instagram_handle: null,
    avatar_url: null,
    is_active: true,
    sort_order: 0,
    service_count: 0,
    ...overrides,
  };
}

function loaded(designers: AdminDesigner[], totalServices = 0) {
  vi.mocked(listDesigners).mockResolvedValue({ ok: true, data: { totalServices, designers } });
}

describe("DesignersTable", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", BASE_URL);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.resetAllMocks();
  });

  it("載入中顯示 Skeleton，新增設計師按鈕停用", () => {
    vi.mocked(listDesigners).mockReturnValue(new Promise(() => {}));
    const { container } = render(<DesignersTable />);
    expect(container.querySelectorAll(".MuiSkeleton-root").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /新增設計師/ })).toBeDisabled();
  });

  it("讀取失敗顯示錯誤提示", async () => {
    vi.mocked(listDesigners).mockResolvedValue({ ok: false, error: { message: "x" } });
    render(<DesignersTable />);
    expect(await screen.findByText("無法載入設計師資料，請重新整理頁面再試一次。")).toBeInTheDocument();
  });

  it("沒有設計師時顯示空狀態", async () => {
    loaded([]);
    render(<DesignersTable />);
    expect(await screen.findByText("還沒有設計師，新增第一位設計師開始接受預約。")).toBeInTheDocument();
  });

  it("列出設計師的名字、專長、提供服務數與狀態；沒有頭像時顯示名字首字", async () => {
    loaded(
      [
        designer({ id: "d1", name: "林小美", specialties: ["韓系剪髮", "漸層染"], service_count: 5 }),
        designer({ id: "d2", name: "張小芸", is_active: false, sort_order: 1, service_count: 2 }),
      ],
      6,
    );
    render(<DesignersTable />);

    expect(await screen.findByText("林小美")).toBeInTheDocument();
    expect(screen.getByText("韓系剪髮")).toBeInTheDocument();
    expect(screen.getByText("漸層染")).toBeInTheDocument();
    expect(screen.getByText("5 / 6 項")).toBeInTheDocument();
    expect(screen.getByText("2 / 6 項")).toBeInTheDocument();
    expect(screen.getByText("啟用中")).toBeInTheDocument();
    expect(screen.getByText("已停用")).toBeInTheDocument();
    expect(screen.getByText("林")).toBeInTheDocument();
    expect(screen.getByText("張")).toBeInTheDocument();
  });

  it("頭像網址在 designer-assets 白名單內時渲染圖片", async () => {
    const avatarUrl = `${BASE_URL}/storage/v1/object/public/designer-assets/avatar/d1/abc.webp`;
    loaded([designer({ avatar_url: avatarUrl })]);
    const { container } = render(<DesignersTable />);

    await screen.findByText("林小美");
    expect(container.querySelector("img")?.getAttribute("src")).toBe(avatarUrl);
  });

  it("順序欄依列表順序顯示 1、2、3，停用中的設計師名字用停用顏色", async () => {
    loaded([
      designer({ id: "d1", name: "甲甲" }),
      designer({ id: "d2", name: "乙乙", is_active: false }),
      designer({ id: "d3", name: "丙丙" }),
    ]);
    const { container } = render(<DesignersTable />);

    await screen.findByText("乙乙");
    const rows = Array.from(container.querySelectorAll("tbody tr"));
    expect(rows.map((row) => row.querySelector("td")?.textContent?.replace(/[▲▼]/g, ""))).toEqual(["1", "2", "3"]);
    expect(screen.getByText("乙乙")).toHaveStyle({ color: "rgba(0, 0, 0, 0.38)" });
    expect(screen.getByText("甲甲")).not.toHaveStyle({ color: "rgba(0, 0, 0, 0.38)" });
  });

  it("頭像網址不在 designer-assets 白名單內時不渲染圖片（退回名字首字）", async () => {
    loaded([designer({ avatar_url: "https://evil.example.com/a.png" })]);
    const { container } = render(<DesignersTable />);

    await screen.findByText("林小美");
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("林")).toBeInTheDocument();
  });

  it("「新增設計師」連到 /admin/designers/new，「編輯」連到各自的編輯頁", async () => {
    loaded([designer({ id: "d1" }), designer({ id: "d2", name: "張小芸", sort_order: 1 })]);
    render(<DesignersTable />);

    await screen.findByText("林小美");
    expect(screen.getByRole("link", { name: /新增設計師/ })).toHaveAttribute("href", "/admin/designers/new");
    const edits = screen.getAllByRole("link", { name: "編輯" });
    expect(edits.map((link) => link.getAttribute("href"))).toEqual(["/admin/designers/d1", "/admin/designers/d2"]);
  });

  it("順序箭頭：第一列不能上移、最後一列不能下移", async () => {
    loaded([designer({ id: "d1", name: "甲甲" }), designer({ id: "d2", name: "乙乙", sort_order: 1 })]);
    render(<DesignersTable />);

    await screen.findByText("甲甲");
    expect(screen.getByRole("button", { name: "上移 甲甲" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "下移 甲甲" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "上移 乙乙" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "下移 乙乙" })).toBeDisabled();
  });

  it("點下移：呼叫 swapDesignerOrder 後重新讀取列表（不做樂觀更新）", async () => {
    const list = [designer({ id: "d1", name: "甲甲" }), designer({ id: "d2", name: "乙乙", sort_order: 1 })];
    loaded(list);
    vi.mocked(swapDesignerOrder).mockResolvedValue({ ok: true, data: undefined });
    const user = userEvent.setup({ delay: null });
    render(<DesignersTable />);

    await user.click(await screen.findByRole("button", { name: "下移 甲甲" }));

    await waitFor(() => expect(listDesigners).toHaveBeenCalledTimes(2));
    const args = vi.mocked(swapDesignerOrder).mock.calls[0];
    expect(args.slice(2)).toEqual([0, "down"]);
    expect((args[1] as AdminDesigner[]).map((d) => d.id)).toEqual(["d1", "d2"]);
    expect(showToast).not.toHaveBeenCalled();
  });

  it("排序失敗：顯示通用錯誤 Toast，並重新讀取列表還原畫面", async () => {
    loaded([designer({ id: "d1", name: "甲甲" }), designer({ id: "d2", name: "乙乙", sort_order: 1 })]);
    vi.mocked(swapDesignerOrder).mockResolvedValue({ ok: false, error: { message: "x" } });
    const user = userEvent.setup({ delay: null });
    render(<DesignersTable />);

    await user.click(await screen.findByRole("button", { name: "下移 甲甲" }));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith("操作失敗，請稍後再試", "error"));
    await waitFor(() => expect(listDesigners).toHaveBeenCalledTimes(2));
  });

  it("寫入在途時，所有箭頭與停用按鈕都停用（避免交錯的 update）", async () => {
    loaded([designer({ id: "d1", name: "甲甲" }), designer({ id: "d2", name: "乙乙", sort_order: 1 })]);
    vi.mocked(swapDesignerOrder).mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup({ delay: null });
    render(<DesignersTable />);

    await user.click(await screen.findByRole("button", { name: "下移 甲甲" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "上移 乙乙" })).toBeDisabled());
    for (const button of screen.getAllByRole("button", { name: "停用" })) expect(button).toBeDisabled();
    expect(screen.getByRole("button", { name: "下移 甲甲" })).toBeDisabled();
  });

  it("停用：先二次確認並顯示未來有效預約筆數，確認後才寫入", async () => {
    loaded([designer({ id: "d1", name: "甲甲" }), designer({ id: "d2", name: "乙乙", sort_order: 1 })]);
    vi.mocked(countFutureAppointmentsForDesigner).mockResolvedValue({ ok: true, data: 3 });
    vi.mocked(setDesignerActive).mockResolvedValue({ ok: true, data: undefined });
    const user = userEvent.setup({ delay: null });
    render(<DesignersTable />);

    await user.click((await screen.findAllByRole("button", { name: "停用" }))[0]);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("確定要停用「甲甲」？")).toBeInTheDocument();
    expect(await within(dialog).findByText(/還有 3 筆未來的有效預約/)).toBeInTheDocument();
    expect(within(dialog).queryByText("停用後前台將沒有任何可預約的設計師。")).toBeNull();
    expect(setDesignerActive).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "停用" }));

    await waitFor(() => expect(setDesignerActive).toHaveBeenCalledWith(expect.anything(), "d1", false));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("「甲甲」已停用", "success"));
    await waitFor(() => expect(listDesigners).toHaveBeenCalledTimes(2));
  });

  it("停用最後一位啟用中的設計師時額外警告", async () => {
    loaded([designer({ id: "d1", name: "甲甲" }), designer({ id: "d2", name: "乙乙", is_active: false, sort_order: 1 })]);
    vi.mocked(countFutureAppointmentsForDesigner).mockResolvedValue({ ok: true, data: 0 });
    const user = userEvent.setup({ delay: null });
    render(<DesignersTable />);

    await user.click(await screen.findByRole("button", { name: "停用" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("停用後前台將沒有任何可預約的設計師。")).toBeInTheDocument();
    expect(await within(dialog).findByText("這位設計師目前沒有未來的有效預約。")).toBeInTheDocument();
  });

  it("查不到未來預約筆數時不顯示 0，仍可確認停用", async () => {
    loaded([designer({ id: "d1", name: "甲甲" }), designer({ id: "d2", name: "乙乙", sort_order: 1 })]);
    vi.mocked(countFutureAppointmentsForDesigner).mockResolvedValue({ ok: false, error: { message: "x" } });
    const user = userEvent.setup({ delay: null });
    render(<DesignersTable />);

    await user.click((await screen.findAllByRole("button", { name: "停用" }))[0]);

    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("無法取得未來預約筆數，仍可繼續停用。")).toBeInTheDocument();
    expect(within(dialog).queryByText(/沒有未來的有效預約/)).toBeNull();
    expect(within(dialog).getByRole("button", { name: "停用" })).toBeEnabled();
  });

  it("按「取消」關閉確認對話框，不寫入", async () => {
    loaded([designer({ id: "d1", name: "甲甲" }), designer({ id: "d2", name: "乙乙", sort_order: 1 })]);
    vi.mocked(countFutureAppointmentsForDesigner).mockResolvedValue({ ok: true, data: 0 });
    const user = userEvent.setup({ delay: null });
    render(<DesignersTable />);

    await user.click((await screen.findAllByRole("button", { name: "停用" }))[0]);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "取消" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(setDesignerActive).not.toHaveBeenCalled();
  });

  it("停用寫入失敗：顯示通用錯誤 Toast，對話框保持開啟可重試", async () => {
    loaded([designer({ id: "d1", name: "甲甲" }), designer({ id: "d2", name: "乙乙", sort_order: 1 })]);
    vi.mocked(countFutureAppointmentsForDesigner).mockResolvedValue({ ok: true, data: 0 });
    vi.mocked(setDesignerActive).mockResolvedValue({ ok: false, error: { message: "x" } });
    const user = userEvent.setup({ delay: null });
    render(<DesignersTable />);

    await user.click((await screen.findAllByRole("button", { name: "停用" }))[0]);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "停用" }));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith("操作失敗，請稍後再試", "error"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("已停用的設計師顯示「重新啟用」，點了直接執行（不二次確認）", async () => {
    loaded([designer({ id: "d1", name: "甲甲" }), designer({ id: "d2", name: "乙乙", is_active: false, sort_order: 1 })]);
    vi.mocked(setDesignerActive).mockResolvedValue({ ok: true, data: undefined });
    const user = userEvent.setup({ delay: null });
    render(<DesignersTable />);

    await user.click(await screen.findByRole("button", { name: "重新啟用" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(setDesignerActive).toHaveBeenCalledWith(expect.anything(), "d2", true));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("「乙乙」已重新啟用", "success"));
  });
});
