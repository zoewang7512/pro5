// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render as rtlRender, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithTheme as render, TestThemeWrapper } from "../test-utils";
import { DesignerBasicInfoForm } from "@/app/admin/_components/DesignerBasicInfoForm";
import { UnsavedChangesProvider, useIsUnsavedDirty } from "@/app/admin/_components/UnsavedChangesProvider";
import {
  createDesigner,
  removeDesignerAvatar,
  updateDesignerBasicInfo,
  uploadDesignerAvatar,
} from "@/lib/admin/designers";
import type { Designer } from "@/lib/designers";

const showToast = vi.hoisted(() => vi.fn());

// UnsavedChangesProvider（TASK-083 的未儲存變更測試）用到 useRouter／usePathname。
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/designers/x",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({}),
}));

vi.mock("@/components/ui/ToastProvider", () => ({
  useToast: () => ({ showToast }),
}));

vi.mock("@/lib/admin/designers", () => ({
  createDesigner: vi.fn(),
  updateDesignerBasicInfo: vi.fn(),
  uploadDesignerAvatar: vi.fn(),
  removeDesignerAvatar: vi.fn(),
}));

if (!URL.createObjectURL) URL.createObjectURL = vi.fn(() => "blob:mock");
if (!URL.revokeObjectURL) URL.revokeObjectURL = vi.fn();

const BASE_URL = "https://project-ref.supabase.co";
const ID = "3f2b8c1e-9d4a-4e6f-8a7b-1c2d3e4f5a6b";

const EXISTING: Designer = {
  id: ID,
  name: "林小美",
  bio: "入行 8 年",
  specialties: ["韓系剪髮"],
  instagram_handle: "mei.hair",
  avatar_url: null,
  is_active: true,
  sort_order: 0,
};

function renderForm(designer: Designer | null = null) {
  const handlers = { onCreated: vi.fn(), onSaved: vi.fn(), onAvatarChange: vi.fn() };
  render(<DesignerBasicInfoForm designer={designer} {...handlers} />);
  return handlers;
}

describe("DesignerBasicInfoForm", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", BASE_URL);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.resetAllMocks();
  });

  it("頁面上方顯示「這些資料會公開顯示在顧客預約頁」提示，IG 輸入框前綴顯示 @", () => {
    renderForm();
    expect(screen.getByText("這些資料會公開顯示在顧客預約頁。")).toBeInTheDocument();
    expect(screen.getByText("@")).toBeInTheDocument();
  });

  it("新增模式：頭像先停用並提示儲存後才能上傳，主要按鈕是「建立設計師」", () => {
    renderForm();
    expect(screen.getByText("儲存設計師資料後，即可上傳頭像。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "上傳頭像" })).toBeNull();
    expect(screen.getByRole("button", { name: "建立設計師" })).toBeEnabled();
  });

  it("名稱空白時阻擋送出並顯示錯誤文案", async () => {
    const user = userEvent.setup({ delay: null });
    renderForm();

    await user.click(screen.getByRole("button", { name: "建立設計師" }));

    expect(await screen.findByText("請輸入 1～30 字的名稱")).toBeInTheDocument();
    expect(createDesigner).not.toHaveBeenCalled();
  });

  it("IG 格式錯誤、簡介超過 200 字都阻擋送出並顯示對應文案", async () => {
    const user = userEvent.setup({ delay: null });
    renderForm();

    await user.type(screen.getByLabelText(/名稱/), "新人");
    await user.type(screen.getByLabelText("Instagram 帳號"), "mei hair");
    await user.click(screen.getByLabelText("簡介"));
    await user.paste("字".repeat(201));
    await user.click(screen.getByRole("button", { name: "建立設計師" }));

    expect(await screen.findByText("只能使用英文、數字、底線和句點")).toBeInTheDocument();
    expect(screen.getByText("200 字以內")).toBeInTheDocument();
    expect(createDesigner).not.toHaveBeenCalled();
  });

  it("專長標籤：Enter 新增、顯示計數；重複的標籤不會被加入", async () => {
    const user = userEvent.setup({ delay: null });
    renderForm();
    const input = screen.getByRole("combobox");

    await user.type(input, "韓系剪髮{Enter}");
    expect(screen.getByText("韓系剪髮")).toBeInTheDocument();
    expect(screen.getByText(/1 \/ 5/)).toBeInTheDocument();

    // MUI freeSolo 多選本來就不會加入重複值；「標籤不能重複」驗證是第二道防線（單元測試涵蓋）。
    await user.type(input, "韓系剪髮{Enter}");
    expect(screen.getAllByText("韓系剪髮")).toHaveLength(1);
    expect(screen.getByText(/1 \/ 5/)).toBeInTheDocument();
  });

  it("專長標籤超過 5 個：顯示「最多 5 個標籤」並阻擋送出", async () => {
    const user = userEvent.setup({ delay: null });
    renderForm();
    const input = screen.getByRole("combobox");

    await user.type(input, "甲{Enter}乙{Enter}丙{Enter}丁{Enter}戊{Enter}己{Enter}");
    await user.type(screen.getByLabelText(/名稱/), "新人");
    await user.click(screen.getByRole("button", { name: "建立設計師" }));

    expect(await screen.findByText("最多 5 個標籤")).toBeInTheDocument();
    expect(createDesigner).not.toHaveBeenCalled();
  });

  it("打了標籤但沒按 Enter 就按建立：標籤不會默默消失（autoSelect）", async () => {
    vi.mocked(createDesigner).mockResolvedValue({ ok: true, data: { id: "new-id" } });
    const user = userEvent.setup({ delay: null });
    const { onCreated } = renderForm();

    await user.type(screen.getByLabelText(/名稱/), "新人");
    await user.type(screen.getByRole("combobox"), "護髮");
    await user.click(screen.getByRole("button", { name: "建立設計師" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("new-id"));
    expect(vi.mocked(createDesigner).mock.calls[0][1]).toMatchObject({ specialties: ["護髮"] });
  });

  it("建立成功：呼叫 createDesigner、顯示成功 Toast、通知父層導向編輯頁", async () => {
    vi.mocked(createDesigner).mockResolvedValue({ ok: true, data: { id: "new-id" } });
    const user = userEvent.setup({ delay: null });
    const { onCreated } = renderForm();

    await user.type(screen.getByLabelText(/名稱/), "新人");
    await user.type(screen.getByLabelText("Instagram 帳號"), "@x_y");
    await user.click(screen.getByRole("button", { name: "建立設計師" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("new-id"));
    expect(createDesigner).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: "新人", instagram: "@x_y", specialties: [], bio: "" }),
    );
    expect(showToast).toHaveBeenCalledWith("設計師已新增", "success");
  });

  it("建立失敗：顯示通用錯誤 Toast，不導向", async () => {
    vi.mocked(createDesigner).mockResolvedValue({ ok: false, error: { message: "x" } });
    const user = userEvent.setup({ delay: null });
    const { onCreated } = renderForm();

    await user.type(screen.getByLabelText(/名稱/), "新人");
    await user.click(screen.getByRole("button", { name: "建立設計師" }));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith("操作失敗，請稍後再試", "error"));
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("編輯模式：帶入既有資料，沒有變更時儲存鈕停用", () => {
    renderForm(EXISTING);
    expect(screen.getByLabelText(/名稱/)).toHaveValue("林小美");
    expect(screen.getByLabelText("Instagram 帳號")).toHaveValue("mei.hair");
    expect(screen.getByLabelText("簡介")).toHaveValue("入行 8 年");
    expect(screen.getByText("韓系剪髮")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "儲存" })).toBeDisabled();
  });

  it("編輯模式：修改後儲存，呼叫 updateDesignerBasicInfo 並通知父層更新名稱", async () => {
    vi.mocked(updateDesignerBasicInfo).mockResolvedValue({ ok: true, data: undefined });
    const user = userEvent.setup({ delay: null });
    const { onSaved } = renderForm(EXISTING);

    const nameInput = screen.getByLabelText(/名稱/);
    await user.clear(nameInput);
    await user.type(nameInput, "  林大美  ");
    await user.click(screen.getByRole("button", { name: "儲存" }));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith("已儲存", "success"));
    expect(updateDesignerBasicInfo).toHaveBeenCalledWith(
      expect.anything(),
      ID,
      expect.objectContaining({ name: "  林大美  " }),
    );
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ name: "林大美", instagram_handle: "mei.hair" }));
    // 儲存後欄位改成實際寫入的樣子，且回到沒有變更的狀態。
    expect(screen.getByLabelText(/名稱/)).toHaveValue("林大美");
    expect(screen.getByRole("button", { name: "儲存" })).toBeDisabled();
  });

  it("編輯模式：儲存失敗顯示通用錯誤 Toast，保留使用者輸入", async () => {
    vi.mocked(updateDesignerBasicInfo).mockResolvedValue({ ok: false, error: { message: "x" } });
    const user = userEvent.setup({ delay: null });
    const { onSaved } = renderForm(EXISTING);

    await user.type(screen.getByLabelText("簡介"), "！");
    await user.click(screen.getByRole("button", { name: "儲存" }));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith("操作失敗，請稍後再試", "error"));
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByLabelText("簡介")).toHaveValue("入行 8 年！");
  });

  it("編輯模式：頭像區塊可上傳；只有 designer-assets 白名單內的網址才當作目前頭像顯示", () => {
    renderForm({ ...EXISTING, avatar_url: "https://evil.example.com/a.png" });
    expect(screen.queryByRole("img", { name: "頭像" })).toBeNull();
    expect(screen.getByRole("button", { name: "上傳頭像" })).toBeInTheDocument();
    expect(screen.getByText("頭像上傳或移除後立即生效，不需要按「儲存」。")).toBeInTheDocument();
  });

  it("頭像上傳成功：通知父層更新頭像；舊檔清除失敗時顯示警告 Toast", async () => {
    const url = `${BASE_URL}/storage/v1/object/public/designer-assets/avatar/${ID}/x.webp`;
    vi.mocked(uploadDesignerAvatar).mockResolvedValue({ ok: true, data: { url, cleanupWarning: true } });
    const user = userEvent.setup({ delay: null });
    const { onAvatarChange } = renderForm(EXISTING);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(["x"], "a.png", { type: "image/png" }));

    await waitFor(() => expect(onAvatarChange).toHaveBeenCalledWith(url));
    expect(uploadDesignerAvatar).toHaveBeenCalledWith(expect.anything(), ID, expect.any(File));
    expect(showToast).toHaveBeenCalledWith("頭像已更新，但舊的頭像檔案未能清除", "warning");
  });

  it("頭像上傳失敗：行內顯示 lib 回傳的整理過的訊息", async () => {
    vi.mocked(uploadDesignerAvatar).mockResolvedValue({
      ok: false,
      error: { message: "圖片解析度過大，請換一張較小的圖片" },
    });
    const user = userEvent.setup({ delay: null });
    renderForm(EXISTING);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(["x"], "a.png", { type: "image/png" }));

    expect(await screen.findByText("圖片解析度過大，請換一張較小的圖片")).toBeInTheDocument();
  });

  it("移除頭像：呼叫 removeDesignerAvatar 並通知父層", async () => {
    const url = `${BASE_URL}/storage/v1/object/public/designer-assets/avatar/${ID}/x.webp`;
    vi.mocked(removeDesignerAvatar).mockResolvedValue({ ok: true, data: { cleanupWarning: false } });
    const user = userEvent.setup({ delay: null });
    const { onAvatarChange } = renderForm({ ...EXISTING, avatar_url: url });

    await user.click(screen.getByRole("button", { name: "移除" }));

    await waitFor(() => expect(onAvatarChange).toHaveBeenCalledWith(null));
    expect(removeDesignerAvatar).toHaveBeenCalledWith(expect.anything(), ID);
  });
});

// TASK-083：key designer-basic-info 的 dirty 判定。
describe("DesignerBasicInfoForm 未儲存變更回報（TASK-083，key: designer-basic-info）", () => {
  function Probe() {
    const dirty = useIsUnsavedDirty("designer-basic-info");
    return <span data-testid="probe">{dirty ? "dirty" : "clean"}</span>;
  }

  function renderGuarded(designer: Designer | null = null) {
    const handlers = { onCreated: vi.fn(), onSaved: vi.fn(), onAvatarChange: vi.fn() };
    rtlRender(
      <UnsavedChangesProvider>
        <DesignerBasicInfoForm designer={designer} {...handlers} />
        <Probe />
      </UnsavedChangesProvider>,
      { wrapper: TestThemeWrapper },
    );
    return handlers;
  }

  const expectDirty = (value: "dirty" | "clean") => expect(screen.getByTestId("probe")).toHaveTextContent(value);
  const specialtyInput = () => screen.getByLabelText("專長標籤", { exact: false });

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", BASE_URL);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.resetAllMocks();
  });

  describe("新增模式", () => {
    it("什麼都沒填：乾淨，但「建立設計師」鈕的啟用邏輯不變（仍啟用）", () => {
      renderGuarded();
      expectDirty("clean");
      expect(screen.getByRole("button", { name: "建立設計師" })).toBeEnabled();
    });

    it("名稱只有空白：乾淨（normalize 後仍是空）", async () => {
      const user = userEvent.setup({ delay: null });
      renderGuarded();
      await user.type(screen.getByLabelText("名稱", { exact: false }), "   ");
      expectDirty("clean");
    });

    it.each([
      ["名稱", "小美"],
      ["Instagram 帳號", "mei.hair"],
      ["簡介", "入行 8 年"],
    ])("填了「%s」：有變更；清空後回到乾淨", async (label, text) => {
      const user = userEvent.setup({ delay: null });
      renderGuarded();
      const field = screen.getByLabelText(label, { exact: false });
      await user.type(field, text);
      expectDirty("dirty");
      await user.clear(field);
      expectDirty("clean");
    });

    it("專長標籤按 Enter 變成標籤：有變更", async () => {
      const user = userEvent.setup({ delay: null });
      renderGuarded();
      await user.type(specialtyInput(), "韓系剪髮{Enter}");
      expect(screen.getByText("韓系剪髮")).toBeInTheDocument();
      expectDirty("dirty");
    });

    it("專長輸入框有文字但沒按 Enter：有變更（輸入框內文字也算）", async () => {
      const user = userEvent.setup({ delay: null });
      renderGuarded();
      await user.type(specialtyInput(), "打到一半");
      expectDirty("dirty");
    });

    it("專長輸入框的文字清掉：回到乾淨", async () => {
      const user = userEvent.setup({ delay: null });
      renderGuarded();
      await user.type(specialtyInput(), "打到一半");
      await user.clear(specialtyInput());
      expectDirty("clean");
    });

    it("建立成功：先標記乾淨再跳轉——在 onCreated 呼叫後、新頁面 commit 前就已乾淨", async () => {
      vi.mocked(createDesigner).mockResolvedValue({ ok: true, data: { id: ID } } as never);
      const user = userEvent.setup({ delay: null });
      const { onCreated } = renderGuarded();
      await user.type(screen.getByLabelText("名稱", { exact: false }), "小美");
      expectDirty("dirty");

      await user.click(screen.getByRole("button", { name: "建立設計師" }));

      await waitFor(() => expect(onCreated).toHaveBeenCalledWith(ID));
      // onCreated 是 mock（沒有真的換頁），畫面仍停在新增表單，這正是「成功到新頁面 commit 之間」的狀態。
      expectDirty("clean");
    });

    it("建立失敗：維持有變更", async () => {
      vi.mocked(createDesigner).mockResolvedValue({ ok: false, error: { message: "x" } } as never);
      const user = userEvent.setup({ delay: null });
      const { onCreated } = renderGuarded();
      await user.type(screen.getByLabelText("名稱", { exact: false }), "小美");
      await user.click(screen.getByRole("button", { name: "建立設計師" }));
      await waitFor(() => expect(showToast).toHaveBeenCalledWith("操作失敗，請稍後再試", "error"));
      expect(onCreated).not.toHaveBeenCalled();
      expectDirty("dirty");
    });
  });

  describe("編輯模式", () => {
    it("沒有改動：乾淨", () => {
      renderGuarded(EXISTING);
      expectDirty("clean");
    });

    it("改名稱：有變更；改回原值：乾淨", async () => {
      const user = userEvent.setup({ delay: null });
      renderGuarded(EXISTING);
      const name = screen.getByLabelText("名稱", { exact: false });
      await user.type(name, "X");
      expectDirty("dirty");
      await user.type(name, "{Backspace}");
      expectDirty("clean");
    });

    it("Instagram 只差 @ 與空白（normalize 後相同）：不算變更", async () => {
      const user = userEvent.setup({ delay: null });
      renderGuarded(EXISTING);
      const ig = screen.getByLabelText("Instagram 帳號", { exact: false });
      await user.clear(ig);
      await user.type(ig, " @mei.hair ");
      expectDirty("clean");
    });

    it("專長輸入框有文字但沒按 Enter：有變更", async () => {
      const user = userEvent.setup({ delay: null });
      renderGuarded(EXISTING);
      await user.type(specialtyInput(), "打到一半");
      expectDirty("dirty");
    });

    it("專長輸入框的文字失焦：autoSelect 轉成標籤，仍是有變更；把新標籤刪掉：回到乾淨", async () => {
      const user = userEvent.setup({ delay: null });
      renderGuarded(EXISTING);
      await user.type(specialtyInput(), "染髮");
      await user.tab(); // 點側邊欄時 mousedown 先 blur：autoSelect 會把未完成的文字收成標籤
      expect(screen.getByText("染髮")).toBeInTheDocument();
      expectDirty("dirty");

      const chip = screen.getByText("染髮").closest(".MuiChip-root") as HTMLElement;
      await user.click(chip.querySelector("svg") as SVGElement);
      expect(screen.queryByText("染髮")).toBeNull();
      expectDirty("clean");
    });

    it("儲存成功：回到乾淨", async () => {
      vi.mocked(updateDesignerBasicInfo).mockResolvedValue({ ok: true, data: undefined } as never);
      const user = userEvent.setup({ delay: null });
      const { onSaved } = renderGuarded(EXISTING);
      await user.type(screen.getByLabelText("名稱", { exact: false }), "X");
      expectDirty("dirty");
      await user.click(screen.getByRole("button", { name: "儲存" }));
      await waitFor(() => expect(onSaved).toHaveBeenCalled());
      expectDirty("clean");
    });

    it("儲存失敗：維持有變更", async () => {
      vi.mocked(updateDesignerBasicInfo).mockResolvedValue({ ok: false, error: { message: "x" } } as never);
      const user = userEvent.setup({ delay: null });
      renderGuarded(EXISTING);
      await user.type(screen.getByLabelText("名稱", { exact: false }), "X");
      await user.click(screen.getByRole("button", { name: "儲存" }));
      await waitFor(() => expect(showToast).toHaveBeenCalledWith("操作失敗，請稍後再試", "error"));
      expectDirty("dirty");
    });
  });

  it("沒有 Provider 時照常運作（既有行為不變）", () => {
    renderForm(EXISTING);
    expect(screen.getByLabelText("名稱", { exact: false })).toHaveValue("林小美");
  });
});
