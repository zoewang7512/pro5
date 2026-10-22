// @vitest-environment jsdom
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render as rtlRender, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TestThemeWrapper } from "../test-utils";
import { StoreSettingsForm } from "@/app/admin/_components/StoreSettingsForm";
import { UnsavedChangesProvider, useIsUnsavedDirty } from "@/app/admin/_components/UnsavedChangesProvider";
import { getStoreSettings, updateStoreSettingsBasicInfo, uploadStoreImage } from "@/lib/store-settings";

const showToast = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/store",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({}),
}));

vi.mock("@/components/ui/ToastProvider", () => ({
  useToast: () => ({ showToast }),
}));

// 驗證函式用真的（純函式）；只 mock 打資料庫／儲存空間的函式。
vi.mock("@/lib/store-settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/store-settings")>();
  return {
    ...actual,
    getStoreSettings: vi.fn(),
    updateStoreSettingsBasicInfo: vi.fn(),
    uploadStoreImage: vi.fn(),
  };
});

// jsdom 沒有 URL.createObjectURL／revokeObjectURL（ImageUploadField 上傳中預覽會用到）。
if (!URL.createObjectURL) URL.createObjectURL = vi.fn(() => "blob:mock");
if (!URL.revokeObjectURL) URL.revokeObjectURL = vi.fn();

function render(ui: React.ReactElement) {
  return rtlRender(ui, { wrapper: TestThemeWrapper });
}

function Probe() {
  const dirty = useIsUnsavedDirty("store-basic-info");
  return <span data-testid="probe">{dirty ? "dirty" : "clean"}</span>;
}

async function renderLoaded() {
  const user = userEvent.setup();
  render(
    <UnsavedChangesProvider>
      <StoreSettingsForm />
      <Probe />
    </UnsavedChangesProvider>,
  );
  const name = await screen.findByLabelText("店名");
  return {
    user,
    name,
    phone: screen.getByLabelText("電話"),
    address: screen.getByLabelText("地址"),
    description: screen.getByLabelText("簡介"),
  };
}

describe("StoreSettingsForm 未儲存變更回報（TASK-082，key: store-basic-info）", () => {
  beforeEach(() => {
    showToast.mockReset();
    vi.mocked(getStoreSettings).mockResolvedValue({
      ok: true,
      data: {
        name: "Studio",
        address: "台北市",
        phone: "0912345678",
        description: "簡介",
        logo_url: null,
        cover_image_url: null,
      },
    });
    vi.mocked(updateStoreSettingsBasicInfo).mockReset();
    vi.mocked(uploadStoreImage).mockReset();
  });
  afterEach(() => {
    cleanup();
  });

  it("載入完成、沒有改動：乾淨", async () => {
    await renderLoaded();
    expect(screen.getByTestId("probe")).toHaveTextContent("clean");
  });

  it("載入中：乾淨（骨架畫面不計入變更）", () => {
    vi.mocked(getStoreSettings).mockReturnValue(new Promise(() => {}));
    render(
      <UnsavedChangesProvider>
        <StoreSettingsForm />
        <Probe />
      </UnsavedChangesProvider>,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("clean");
  });

  it("載入失敗：乾淨", async () => {
    vi.mocked(getStoreSettings).mockResolvedValue({ ok: false, error: { message: "x" } });
    render(
      <UnsavedChangesProvider>
        <StoreSettingsForm />
        <Probe />
      </UnsavedChangesProvider>,
    );
    expect(await screen.findByText("無法載入商店設定，請重新整理再試一次。")).toBeInTheDocument();
    expect(screen.getByTestId("probe")).toHaveTextContent("clean");
  });

  it.each(["店名", "電話", "地址", "簡介"])("改「%s」：有變更", async (label) => {
    const { user } = await renderLoaded();
    await user.type(screen.getByLabelText(label), "x");
    expect(screen.getByTestId("probe")).toHaveTextContent("dirty");
  });

  it("改了再改回原值：回到乾淨", async () => {
    const { user, name } = await renderLoaded();
    await user.type(name, "X");
    expect(screen.getByTestId("probe")).toHaveTextContent("dirty");
    await user.type(name, "{Backspace}");
    expect(screen.getByTestId("probe")).toHaveTextContent("clean");
  });

  it("儲存成功：回到乾淨", async () => {
    vi.mocked(updateStoreSettingsBasicInfo).mockResolvedValue({ ok: true, data: undefined });
    const { user, name } = await renderLoaded();
    await user.type(name, "X");
    expect(screen.getByTestId("probe")).toHaveTextContent("dirty");
    await user.click(screen.getByRole("button", { name: "儲存" }));
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("clean"));
    expect(updateStoreSettingsBasicInfo).toHaveBeenCalledTimes(1);
  });

  it("儲存失敗：維持有變更", async () => {
    vi.mocked(updateStoreSettingsBasicInfo).mockResolvedValue({ ok: false, error: { message: "x" } });
    const { user, name } = await renderLoaded();
    await user.type(name, "X");
    await user.click(screen.getByRole("button", { name: "儲存" }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("操作失敗，請稍後再試", "error"));
    expect(screen.getByTestId("probe")).toHaveTextContent("dirty");
  });

  it("上傳 Logo（即時儲存）不會讓表單被視為有變更", async () => {
    vi.mocked(uploadStoreImage).mockResolvedValue({ ok: true, data: "https://example.invalid/logo.png" });
    const { user } = await renderLoaded();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(["bytes"], "logo.png", { type: "image/png" }));
    await waitFor(() => expect(uploadStoreImage).toHaveBeenCalledTimes(1));
    await screen.findByRole("img", { name: "Logo" });
    expect(screen.getByTestId("probe")).toHaveTextContent("clean");
  });

  it("沒有 Provider 時照常運作（既有行為不變）", async () => {
    render(<StoreSettingsForm />);
    expect(await screen.findByLabelText("店名")).toHaveValue("Studio");
  });
});
