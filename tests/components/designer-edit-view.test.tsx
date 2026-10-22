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

// 提供服務頁籤有自己的測試：這裡換成簡單替身，只驗證常駐掛載與頁籤標籤上的開啟數。
vi.mock("@/app/admin/_components/DesignerServicesTab", () => ({
  DesignerServicesTab: (props: { designerId: string; onCountChange: (count: number) => void }) => (
    <div data-testid="services-tab">
      <span>{`服務：${props.designerId}`}</span>
      <button onClick={() => props.onCountChange(5)}>模擬回報五項</button>
    </div>
  ),
}));

// 作品集頁籤有自己的測試：這裡換成簡單替身，只驗證常駐掛載與頁籤標籤上的張數。
vi.mock("@/app/admin/_components/DesignerPortfolioTab", () => ({
  DesignerPortfolioTab: (props: { designerId: string; onCountChange: (count: number) => void }) => (
    <div data-testid="portfolio-tab">
      <span>{`作品集：${props.designerId}`}</span>
      <button onClick={() => props.onCountChange(8)}>模擬回報八張</button>
    </div>
  ),
}));

// 請假頁籤有自己的測試：這裡換成簡單替身，只驗證常駐掛載、傳入的名稱與頁籤標籤上的請假日數。
vi.mock("@/app/admin/_components/DesignerLeavesTab", () => ({
  DesignerLeavesTab: (props: { designerId: string; designerName: string; onCountChange: (count: number) => void }) => (
    <div data-testid="leaves-tab">
      <span>{`請假：${props.designerId}／${props.designerName}`}</span>
      <button onClick={() => props.onCountChange(2)}>模擬回報兩天</button>
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

  it("切到「請假」頁籤顯示請假面板；「基本資料」面板保持掛載（未儲存的輸入不會不見）", async () => {
    vi.mocked(getDesigner).mockResolvedValue({ ok: true, data: DESIGNER });
    const user = userEvent.setup({ delay: null });
    render(<DesignerEditView designerId={ID} />);
    await screen.findByText("表單：林小美");

    await user.type(screen.getByLabelText("未儲存的輸入"), "草稿");
    await user.click(screen.getByRole("tab", { name: "請假" }));
    expect(screen.getByTestId("leaves-tab")).toBeVisible();
    expect(screen.getByTestId("basic-form")).not.toBeVisible();

    await user.click(screen.getByRole("tab", { name: "基本資料" }));
    expect(screen.getByTestId("basic-form")).toBeVisible();
    expect(screen.getByLabelText("未儲存的輸入")).toHaveValue("草稿");
  });

  it("「提供服務」面板載入後就常駐掛載（隱藏），用資料庫回傳的設計師 id；切頁籤不卸載", async () => {
    vi.mocked(getDesigner).mockResolvedValue({ ok: true, data: DESIGNER });
    const user = userEvent.setup({ delay: null });
    render(<DesignerEditView designerId={ID.toUpperCase()} />);

    expect(await screen.findByText(`服務：${ID}`)).toBeInTheDocument();
    expect(screen.getByTestId("services-tab")).not.toBeVisible();

    await user.click(screen.getByRole("tab", { name: "提供服務" }));
    expect(screen.getByTestId("services-tab")).toBeVisible();
    await user.click(screen.getByRole("tab", { name: "基本資料" }));
    expect(screen.getByTestId("services-tab")).toBeInTheDocument();
  });

  it("新增模式不掛載「提供服務」面板", () => {
    render(<DesignerEditView designerId={null} />);
    expect(screen.queryByTestId("services-tab")).toBeNull();
  });

  it("「提供服務」頁籤標籤在回報前沒有數字，回報後顯示開啟數（還沒點進該頁籤就看得到）", async () => {
    vi.mocked(getDesigner).mockResolvedValue({ ok: true, data: DESIGNER });
    const user = userEvent.setup({ delay: null });
    render(<DesignerEditView designerId={ID} />);
    await screen.findByText("表單：林小美");

    expect(screen.getByRole("tab", { name: "提供服務" })).toBeInTheDocument();

    // 面板隱藏中（hidden），所以要指定 hidden: true 才找得到替身按鈕。
    await user.click(screen.getByRole("button", { name: "模擬回報五項", hidden: true }));

    const tab = screen.getByRole("tab", { name: /提供服務/ });
    expect(tab).toHaveTextContent("提供服務5");
    expect(screen.getByLabelText("已開啟 5 項")).toBeInTheDocument();
  });

  it("「作品集」面板載入後常駐掛載（隱藏），用資料庫回傳的設計師 id；切頁籤不卸載；新增模式不掛載", async () => {
    vi.mocked(getDesigner).mockResolvedValue({ ok: true, data: DESIGNER });
    const user = userEvent.setup({ delay: null });
    render(<DesignerEditView designerId={ID.toUpperCase()} />);

    expect(await screen.findByText(`作品集：${ID}`)).toBeInTheDocument();
    expect(screen.getByTestId("portfolio-tab")).not.toBeVisible();

    await user.click(screen.getByRole("tab", { name: "作品集" }));
    expect(screen.getByTestId("portfolio-tab")).toBeVisible();
    await user.click(screen.getByRole("tab", { name: "基本資料" }));
    expect(screen.getByTestId("portfolio-tab")).toBeInTheDocument();

    cleanup();
    render(<DesignerEditView designerId={null} />);
    expect(screen.queryByTestId("portfolio-tab")).toBeNull();
  });

  it("「作品集」頁籤標籤在回報前沒有數字，回報後顯示張數；與「提供服務」的數字互不影響，無障礙名稱各自不同", async () => {
    vi.mocked(getDesigner).mockResolvedValue({ ok: true, data: DESIGNER });
    const user = userEvent.setup({ delay: null });
    render(<DesignerEditView designerId={ID} />);
    await screen.findByText("表單：林小美");
    expect(screen.queryByLabelText(/共 d+ 張作品/)).toBeNull();

    await user.click(screen.getByRole("button", { name: "模擬回報八張", hidden: true }));
    expect(screen.getByRole("tab", { name: /作品集/ })).toHaveTextContent("作品集8");
    expect(screen.getByLabelText("共 8 張作品")).toBeInTheDocument();
    expect(screen.queryByLabelText(/已開啟/)).toBeNull();

    await user.click(screen.getByRole("button", { name: "模擬回報五項", hidden: true }));
    expect(screen.getByLabelText("已開啟 5 項")).toBeInTheDocument();
    expect(screen.getByLabelText("共 8 張作品")).toBeInTheDocument();
  });

  it("「請假」面板載入後常駐掛載（隱藏），傳入資料庫回傳的設計師 id 與名稱；切頁籤不卸載；新增模式不掛載", async () => {
    vi.mocked(getDesigner).mockResolvedValue({ ok: true, data: DESIGNER });
    const user = userEvent.setup({ delay: null });
    render(<DesignerEditView designerId={ID.toUpperCase()} />);

    expect(await screen.findByText(`請假：${ID}／林小美`)).toBeInTheDocument();
    expect(screen.getByTestId("leaves-tab")).not.toBeVisible();

    await user.click(screen.getByRole("tab", { name: "請假" }));
    expect(screen.getByTestId("leaves-tab")).toBeVisible();
    await user.click(screen.getByRole("tab", { name: "基本資料" }));
    expect(screen.getByTestId("leaves-tab")).toBeInTheDocument();

    cleanup();
    render(<DesignerEditView designerId={null} />);
    expect(screen.queryByTestId("leaves-tab")).toBeNull();
  });

  it("「請假」頁籤標籤回報後顯示請假日數，無障礙名稱獨立，不影響其他頁籤的數字", async () => {
    vi.mocked(getDesigner).mockResolvedValue({ ok: true, data: DESIGNER });
    const user = userEvent.setup({ delay: null });
    render(<DesignerEditView designerId={ID} />);
    await screen.findByText("表單：林小美");
    expect(screen.queryByLabelText(/已排/)).toBeNull();

    await user.click(screen.getByRole("button", { name: "模擬回報兩天", hidden: true }));
    expect(screen.getByRole("tab", { name: /請假/ })).toHaveTextContent("請假2");
    expect(screen.getByLabelText("已排 2 個請假日")).toBeInTheDocument();
    expect(screen.queryByLabelText(/已開啟|張作品/)).toBeNull();
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
