// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithTheme as render } from "../test-utils";
import { ImageUploadField } from "@/components/ui/ImageUploadField";

// vitest.config.ts 沒有開 `test.globals`，@testing-library/react 的自動 cleanup（依賴
// 偵測全域 afterEach）偵測不到，需要在這裡手動註冊，否則同一檔案內多個 it() 的渲染結果會
// 疊加在同一個 document.body，讓後面的 getByText 因為「找到多個符合的元素」而失敗。
afterEach(cleanup);

const { uploadStoreImageMock, removeStoreImageMock } = vi.hoisted(() => ({
  uploadStoreImageMock: vi.fn(),
  removeStoreImageMock: vi.fn(),
}));

vi.mock("@/lib/store-settings", async () => {
  const actual = await vi.importActual<typeof import("@/lib/store-settings")>("@/lib/store-settings");
  return {
    ...actual,
    uploadStoreImage: uploadStoreImageMock,
    removeStoreImage: removeStoreImageMock,
  };
});

// jsdom 沒有實作 URL.createObjectURL／revokeObjectURL，元件內部呼叫這兩個函式做本地
// 上傳中預覽，測試環境需要補上假實作（模組載入時執行一次即可，不需要放進 beforeEach）。
if (!URL.createObjectURL) {
  URL.createObjectURL = vi.fn(() => "blob:mock");
}
if (!URL.revokeObjectURL) {
  URL.revokeObjectURL = vi.fn();
}

const fakeSupabase = {} as never;

function pngFile(name = "logo.png") {
  return new File(["fake-bytes"], name, { type: "image/png" });
}

describe("ImageUploadField", () => {
  it("預設（未上傳）顯示拖放提示", () => {
    render(<ImageUploadField label="Logo" kind="logo" initialUrl={null} supabase={fakeSupabase} />);
    expect(screen.getByText("點擊或拖曳圖片上傳")).toBeInTheDocument();
  });

  it("已有圖片時顯示縮圖與「更換」「移除」按鈕", () => {
    render(
      <ImageUploadField label="Logo" kind="logo" initialUrl="https://example.invalid/logo.png" supabase={fakeSupabase} />,
    );
    expect(screen.getByRole("img", { name: "Logo" })).toBeInTheDocument();
    expect(screen.getByText("更換")).toBeInTheDocument();
    expect(screen.getByText("移除")).toBeInTheDocument();
  });

  it("選擇不允許的格式顯示行內錯誤，不呼叫 uploadStoreImage", async () => {
    render(<ImageUploadField label="Logo" kind="logo" initialUrl={null} supabase={fakeSupabase} />);

    // 用 fireEvent 直接觸發 change（而非 userEvent.upload），因為 userEvent.upload 會
    // 依 <input accept> 屬性過濾檔案、根本不會送出這個測試想驗證的不合法檔案；
    // accept 只是瀏覽器選檔對話框的 UI 提示，不是真正的安全邊界（拖放路徑就完全不受它
    // 限制），驗證邏輯本身（validateStoreImageFile）才是這裡真正要測試的防線。
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const badFile = new File(["not an image"], "note.txt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [badFile] } });

    expect(await screen.findByText("檔案格式需為 JPG／PNG／WebP")).toBeInTheDocument();
    expect(uploadStoreImageMock).not.toHaveBeenCalled();
  });

  it("選擇合法圖片成功上傳後切換為預覽態", async () => {
    uploadStoreImageMock.mockResolvedValueOnce({ ok: true, data: "https://example.invalid/uploaded.png" });
    const user = userEvent.setup();
    render(<ImageUploadField label="Logo" kind="logo" initialUrl={null} supabase={fakeSupabase} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, pngFile());

    await waitFor(() => expect(screen.getByRole("img", { name: "Logo" })).toBeInTheDocument());
    expect(uploadStoreImageMock).toHaveBeenCalledWith(fakeSupabase, "logo", expect.any(File));
  });

  it("上傳失敗時顯示通用錯誤，維持未上傳狀態", async () => {
    uploadStoreImageMock.mockResolvedValueOnce({ ok: false, error: { message: "x" } });
    const user = userEvent.setup();
    render(<ImageUploadField label="Logo" kind="logo" initialUrl={null} supabase={fakeSupabase} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, pngFile());

    expect(await screen.findByText("操作失敗，請稍後再試")).toBeInTheDocument();
    expect(screen.getByText("點擊或拖曳圖片上傳")).toBeInTheDocument();
  });

  it("點擊「移除」呼叫 removeStoreImage，成功後切換回未上傳狀態", async () => {
    removeStoreImageMock.mockResolvedValueOnce({ ok: true, data: undefined });
    const user = userEvent.setup();
    render(
      <ImageUploadField label="Logo" kind="logo" initialUrl="https://example.invalid/logo.png" supabase={fakeSupabase} />,
    );

    await user.click(screen.getByText("移除"));

    await waitFor(() => expect(screen.getByText("點擊或拖曳圖片上傳")).toBeInTheDocument());
    expect(removeStoreImageMock).toHaveBeenCalledWith(fakeSupabase, "logo");
  });
});
