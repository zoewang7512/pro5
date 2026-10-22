// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithTheme as render } from "../test-utils";
import { PortfolioManager, type PortfolioItem } from "@/components/ui/PortfolioManager";

const OK = { ok: true as const };
const fail = (message: string) => ({ ok: false as const, error: { message } });

function items(count: number, overrides: Record<number, Partial<PortfolioItem>> = {}): PortfolioItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `id-${index + 1}`,
    src: `https://cdn.example.com/p${index + 1}.webp`,
    ...overrides[index],
  }));
}

function arrange(props: Partial<React.ComponentProps<typeof PortfolioManager>> = {}) {
  const onUpload = vi.fn().mockResolvedValue(OK);
  const onDelete = vi.fn().mockResolvedValue(OK);
  render(<PortfolioManager items={[]} maxImages={12} onUpload={onUpload} onDelete={onDelete} {...props} />);
  return { onUpload, onDelete };
}

const input = () => screen.getByTestId("portfolio-file-input") as HTMLInputElement;
const png = (name = "a.png") => new File(["x"], name, { type: "image/png" });

// 讓 onUpload／onDelete 停在「進行中」，測試 busy 狀態。
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("PortfolioManager", () => {
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it("空狀態：標題 0 / 12 張、只有上傳格、顯示引導文案；<input> 不加 multiple", () => {
    arrange();

    expect(screen.getByText("0 / 12 張")).toBeInTheDocument();
    expect(screen.getByText("還沒有作品，上傳第一張吧")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上傳作品" })).toHaveAttribute("aria-disabled", "false");
    expect(screen.queryAllByRole("img")).toHaveLength(0);
    expect(input().multiple).toBe(false);
    expect(screen.getByText(/JPG／PNG／WebP，單張 5MB 以內/)).toBeInTheDocument();
  });

  it("有作品：依傳入順序畫格子（alt、no-referrer），每格有編號的刪除按鈕", () => {
    arrange({ items: items(3) });

    expect(screen.getByText("3 / 12 張")).toBeInTheDocument();
    expect(screen.queryByText("還沒有作品，上傳第一張吧")).toBeNull();
    const images = screen.getAllByRole("img");
    expect(images.map((img) => img.getAttribute("alt"))).toEqual(["作品 1", "作品 2", "作品 3"]);
    expect(images[0]).toHaveAttribute("src", "https://cdn.example.com/p1.webp");
    expect(images[0]).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(screen.getByRole("button", { name: "刪除第 2 張作品" })).toBeInTheDocument();
  });

  it("網址沒通過白名單（src 為 null）：畫成「圖片無法顯示」的佔位格，仍算進張數、仍可刪除", async () => {
    const user = userEvent.setup({ delay: null });
    const { onDelete } = arrange({ items: items(2, { 1: { src: null } }) });

    expect(screen.getByText("2 / 12 張")).toBeInTheDocument();
    expect(screen.getByText("圖片無法顯示")).toBeInTheDocument();
    expect(screen.getAllByRole("img")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "刪除第 2 張作品" }));
    await user.click(await screen.findByRole("button", { name: "刪除" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("id-2"));
  });

  it("達上限：上傳格停用並顯示上限文案，點擊與拖放都不會上傳", async () => {
    const user = userEvent.setup({ delay: null });
    const { onUpload } = arrange({ items: items(12) });

    const add = screen.getByRole("button", { name: "上傳作品" });
    expect(add).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("已達 12 張上限，請先刪除舊作品")).toBeInTheDocument();
    expect(screen.getByText("12 / 12 張")).toBeInTheDocument();

    await user.click(add);
    fireEvent.drop(add, { dataTransfer: { files: [png()] } });
    expect(onUpload).not.toHaveBeenCalled();
  });

  it("選檔上傳：呼叫 onUpload 並顯示 spinner；進行中上傳格與所有刪除按鈕停用，完成後恢復", async () => {
    const user = userEvent.setup({ delay: null });
    const pending = deferred<typeof OK>();
    const { onUpload } = arrange({ items: items(2) });
    onUpload.mockReturnValue(pending.promise);
    const file = png();

    await user.upload(input(), file);

    expect(onUpload).toHaveBeenCalledWith(file);
    expect(screen.getByLabelText("上傳中")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上傳作品" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "刪除第 1 張作品" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "刪除第 2 張作品" })).toBeDisabled();

    pending.resolve(OK);
    await waitFor(() => expect(screen.queryByLabelText("上傳中")).toBeNull());
    expect(screen.getByRole("button", { name: "上傳作品" })).toHaveAttribute("aria-disabled", "false");
    expect(screen.getByRole("button", { name: "刪除第 1 張作品" })).toBeEnabled();
  });

  it("上傳失敗：行內顯示呼叫端給的文案（role=alert）；下次上傳開始時清掉", async () => {
    const user = userEvent.setup({ delay: null });
    const { onUpload } = arrange();
    onUpload.mockResolvedValueOnce(fail("檔案大小需小於 5MB")).mockResolvedValueOnce(OK);

    await user.upload(input(), png());
    expect(await screen.findByRole("alert")).toHaveTextContent("檔案大小需小於 5MB");

    await user.upload(input(), png("b.png"));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("onUpload 丟出例外：顯示通用文案，不卡在上傳中", async () => {
    const user = userEvent.setup({ delay: null });
    const { onUpload } = arrange();
    onUpload.mockRejectedValue(new Error("boom"));

    await user.upload(input(), png());

    expect(await screen.findByRole("alert")).toHaveTextContent("操作失敗，請稍後再試");
    expect(screen.queryByLabelText("上傳中")).toBeNull();
    expect(screen.queryByText(/boom/)).toBeNull();
  });

  it("拖放多個檔案：只上傳第一張並提示", async () => {
    const { onUpload } = arrange();
    const first = png("first.png");

    fireEvent.drop(screen.getByRole("button", { name: "上傳作品" }), {
      dataTransfer: { files: [first, png("second.png")] },
    });

    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1));
    expect(onUpload).toHaveBeenCalledWith(first);
    expect(await screen.findByText("一次只能上傳一張，已使用第一張")).toBeInTheDocument();
  });

  it("刪除要二次確認：取消不會呼叫 onDelete；確認後呼叫並關閉對話框", async () => {
    const user = userEvent.setup({ delay: null });
    const { onDelete } = arrange({ items: items(2) });

    await user.click(screen.getByRole("button", { name: "刪除第 1 張作品" }));
    expect(await screen.findByText("刪除這張作品？")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByText("刪除這張作品？")).toBeNull());
    expect(onDelete).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "刪除第 2 張作品" }));
    await user.click(await screen.findByRole("button", { name: "刪除" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("id-2"));
    await waitFor(() => expect(screen.queryByText("刪除這張作品？")).toBeNull());
  });

  it("刪除失敗：行內顯示呼叫端給的文案", async () => {
    const user = userEvent.setup({ delay: null });
    const { onDelete } = arrange({ items: items(1) });
    onDelete.mockResolvedValue(fail("這張作品已不存在，請重新整理頁面。"));

    await user.click(screen.getByRole("button", { name: "刪除第 1 張作品" }));
    await user.click(await screen.findByRole("button", { name: "刪除" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("這張作品已不存在，請重新整理頁面。");
  });

  it("刪除進行中：上傳格停用，不能同時開始上傳", async () => {
    const user = userEvent.setup({ delay: null });
    const pending = deferred<typeof OK>();
    const { onDelete, onUpload } = arrange({ items: items(1) });
    onDelete.mockReturnValue(pending.promise);

    await user.click(screen.getByRole("button", { name: "刪除第 1 張作品" }));
    await user.click(await screen.findByRole("button", { name: "刪除" }));

    await waitFor(() => expect(screen.getByLabelText("刪除中")).toBeInTheDocument());
    // 確認對話框開著時背景被標成 aria-hidden，所以要 hidden: true 才找得到上傳格。
    const add = screen.getByRole("button", { name: "上傳作品", hidden: true });
    expect(add).toHaveAttribute("aria-disabled", "true");
    fireEvent.drop(add, { dataTransfer: { files: [png()] } });
    expect(onUpload).not.toHaveBeenCalled();

    pending.resolve(OK);
    await waitFor(() => expect(screen.queryByLabelText("刪除中")).toBeNull());
  });
});
