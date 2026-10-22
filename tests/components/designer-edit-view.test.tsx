// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithTheme as render } from "../test-utils";
import { DesignerEditView } from "@/app/admin/_components/DesignerEditView";
import { getDesigner } from "@/lib/admin/designers";
import type { Designer } from "@/lib/designers";

const replace = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({}),
}));

vi.mock("@/lib/admin/designers", () => ({
  getDesigner: vi.fn(),
}));

// 基本資料表單有自己的測試：這裡換成簡單替身，只驗證編輯頁的載入、頁籤與父子溝通。
vi.mock("@/app/admin/_components/DesignerBasicInfoForm", () => ({
  DesignerBasicInfoForm: (props: {
    designer: Designer | null;
    onCreated: (id: string) => void;
    onSaved: (fields: Partial<Designer>) => void;
    onAvatarChange: (url: string | null) => void;
  }) => (
    <div data-testid="basic-form">
      <span>{props.designer ? `表單：${props.designer.name}` : "表單：新增"}</span>
      <input aria-label="未儲存的輸入" />
      <button onClick={() => props.onCreated("new-id")}>模擬建立</button>
      <button onClick={() => props.onSaved({ name: "新名字" })}>模擬儲存</button>
    </div>
  ),
}));

const ID = "3f2b8c1e-9d4a-4e6f-8a7b-1c2d3e4f5a6b";
const DESIGNER: Designer = {
  id: ID,
  name: "林小美",
  bio: null,
  specialties: [],
  instagram_handle: null,
  avatar_url: null,
  is_active: true,
  sort_order: 0,
};

describe("DesignerEditView", () => {
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it("新增模式：麵包屑與標題顯示「新增設計師」，只有「基本資料」頁籤可用，不查詢資料庫", () => {
    render(<DesignerEditView designerId={null} />);

    expect(screen.getByRole("link", { name: "設計師" })).toHaveAttribute("href", "/admin/designers");
    expect(screen.getAllByText("新增設計師").length).toBeGreaterThan(0);
    expect(screen.getByRole("tab", { name: "基本資料" })).toBeEnabled();
    for (const name of ["提供服務", "作品集", "請假"]) {
      expect(screen.getByRole("tab", { name })).toBeDisabled();
    }
    expect(screen.getByText("表單：新增")).toBeInTheDocument();
    expect(getDesigner).not.toHaveBeenCalled();
  });

  it("新增模式建立成功：用 router.replace 導向 /admin/designers/<id>（不留空白表單在上一頁）", async () => {
    const user = userEvent.setup({ delay: null });
    render(<DesignerEditView designerId={null} />);

    await user.click(screen.getByRole("button", { name: "模擬建立" }));
    expect(replace).toHaveBeenCalledWith("/admin/designers/new-id");
  });

  it("編輯模式：載入完成後顯示名稱、啟用狀態與四個頁籤", async () => {
    vi.mocked(getDesigner).mockResolvedValue({ ok: true, data: DESIGNER });
    render(<DesignerEditView designerId={ID} />);

    expect(await screen.findByText("表單：林小美")).toBeInTheDocument();
    expect(getDesigner).toHaveBeenCalledWith(expect.anything(), ID);
    expect(screen.getByText("啟用中")).toBeInTheDocument();
    expect(screen.getAllByText("林小美").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["基本資料", "提供服務", "作品集", "請假"]);
  });

  it("已停用的設計師顯示「已停用」徽章", async () => {
    vi.mocked(getDesigner).mockResolvedValue({ ok: true, data: { ...DESIGNER, is_active: false } });
    render(<DesignerEditView designerId={ID} />);
    expect(await screen.findByText("已停用")).toBeInTheDocument();
  });

  it("切到其他頁籤顯示占位內容；「基本資料」面板保持掛載（未儲存的輸入不會不見）", async () => {
    vi.mocked(getDesigner).mockResolvedValue({ ok: true, data: DESIGNER });
    const user = userEvent.setup({ delay: null });
    render(<DesignerEditView designerId={ID} />);
    await screen.findByText("表單：林小美");

    await user.type(screen.getByLabelText("未儲存的輸入"), "草稿");
    await user.click(screen.getByRole("tab", { name: "作品集" }));
    expect(screen.getByText("作品集管理即將開放。")).toBeInTheDocument();
    expect(screen.getByTestId("basic-form")).not.toBeVisible();

    await user.click(screen.getByRole("tab", { name: "基本資料" }));
    expect(screen.getByTestId("basic-form")).toBeVisible();
    expect(screen.getByLabelText("未儲存的輸入")).toHaveValue("草稿");
  });

  it("基本資料儲存後，麵包屑與標題同步更新名稱", async () => {
    vi.mocked(getDesigner).mockResolvedValue({ ok: true, data: DESIGNER });
    const user = userEvent.setup({ delay: null });
    render(<DesignerEditView designerId={ID} />);
    await screen.findByText("表單：林小美");

    await user.click(screen.getByRole("button", { name: "模擬儲存" }));

    await waitFor(() => expect(screen.getAllByText("新名字").length).toBeGreaterThan(0));
    expect(screen.queryByText("林小美")).toBeNull();
  });

  it("查不到設計師：顯示「找不到這位設計師」與回列表連結", async () => {
    vi.mocked(getDesigner).mockResolvedValue({ ok: true, data: null });
    render(<DesignerEditView designerId={ID} />);

    expect(await screen.findByText("找不到這位設計師。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "回設計師列表" })).toHaveAttribute("href", "/admin/designers");
    expect(screen.queryByTestId("basic-form")).toBeNull();
  });

  it("網址的 id 不是 uuid：直接顯示找不到，不送查詢", () => {
    render(<DesignerEditView designerId="not-a-uuid" />);
    expect(screen.getByText("找不到這位設計師。")).toBeInTheDocument();
    expect(getDesigner).not.toHaveBeenCalled();
  });

  it("讀取失敗：顯示通用錯誤，不渲染原始錯誤訊息", async () => {
    vi.mocked(getDesigner).mockResolvedValue({ ok: false, error: { message: 'relation "designers" boom' } });
    render(<DesignerEditView designerId={ID} />);

    expect(await screen.findByText("無法載入設計師資料，請重新整理頁面再試一次。")).toBeInTheDocument();
    expect(screen.queryByText(/boom/)).toBeNull();
  });
});
