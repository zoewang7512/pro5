// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithTheme as render } from "../test-utils";
import { DesignerPortfolioTab } from "@/app/admin/_components/DesignerPortfolioTab";
import {
  deletePortfolioImage,
  listPortfolio,
  removePortfolioFile,
  uploadPortfolioImage,
  type PortfolioImage,
} from "@/lib/admin/designers";

const showToast = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({}),
}));

vi.mock("@/components/ui/ToastProvider", () => ({
  useToast: () => ({ showToast }),
}));

vi.mock("@/lib/admin/designers", () => ({
  listPortfolio: vi.fn(),
  uploadPortfolioImage: vi.fn(),
  deletePortfolioImage: vi.fn(),
  removePortfolioFile: vi.fn(),
}));

const BASE_URL = "https://project-ref.supabase.co";
const DESIGNER_ID = "3f2b8c1e-9d4a-4e6f-8a7b-1c2d3e4f5a6b";
const GENERIC = { ok: false as const, error: { message: "發生未預期的錯誤，請稍後再試。" } };

function image(n: number, overrides: Partial<PortfolioImage> = {}): PortfolioImage {
  const uuid = `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
  return {
    id: `0000000${n}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
    image_url: `${BASE_URL}/storage/v1/object/public/designer-assets/portfolio/${DESIGNER_ID}/${uuid}.webp`,
    created_at: `2026-10-2${n}T00:00:00Z`,
    ...overrides,
  };
}

function arrange(images: PortfolioImage[] = [image(2), image(1)]) {
  vi.mocked(listPortfolio).mockResolvedValue({ ok: true, data: images });
  const onCountChange = vi.fn();
  render(<DesignerPortfolioTab designerId={DESIGNER_ID} onCountChange={onCountChange} />);
  return { onCountChange };
}

const input = () => screen.getByTestId("portfolio-file-input") as HTMLInputElement;
const png = () => new File(["x"], "a.png", { type: "image/png" });

async function confirmDelete(user: ReturnType<typeof userEvent.setup>, position: number) {
  await user.click(screen.getByRole("button", { name: `刪除第 ${position} 張作品` }));
  await user.click(await screen.findByRole("button", { name: "刪除" }));
}

describe("DesignerPortfolioTab", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", BASE_URL);
  });
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
    vi.unstubAllEnvs();
  });

  it("載入後依資料庫順序顯示作品、「N / 12 張」，並回報張數；說明文字提醒快取與停用不刪檔", async () => {
    const { onCountChange } = arrange();

    expect(await screen.findByText("2 / 12 張")).toBeInTheDocument();
    expect(screen.getAllByRole("img")).toHaveLength(2);
    expect(onCountChange).toHaveBeenLastCalledWith(2);
    expect(listPortfolio).toHaveBeenCalledWith(expect.anything(), DESIGNER_ID);
    expect(screen.getByText(/照片最多約 5 分鐘內仍可能被看到/)).toBeInTheDocument();
    expect(screen.getByText(/停用設計師不會刪除檔案/)).toBeInTheDocument();
  });

  it("沒有作品：空狀態文案，回報 0", async () => {
    const { onCountChange } = arrange([]);

    expect(await screen.findByText("還沒有作品，上傳第一張吧")).toBeInTheDocument();
    expect(onCountChange).toHaveBeenLastCalledWith(0);
  });

  it("網址沒通過白名單的列（例如帶 query 指到別人的頭像）：畫成佔位格，仍算進張數", async () => {
    const tampered = image(1, {
      image_url: `${BASE_URL}/storage/v1/object/public/designer-assets/avatar/${DESIGNER_ID}/x.webp?portfolio/${DESIGNER_ID}/y.webp`,
    });
    const { onCountChange } = arrange([image(2), tampered]);

    expect(await screen.findByText("2 / 12 張")).toBeInTheDocument();
    expect(screen.getByText("圖片無法顯示")).toBeInTheDocument();
    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(onCountChange).toHaveBeenLastCalledWith(2);
  });

  it("載入失敗：顯示錯誤 Alert，不畫上傳格也不回報張數", async () => {
    vi.mocked(listPortfolio).mockResolvedValue(GENERIC);
    const onCountChange = vi.fn();
    render(<DesignerPortfolioTab designerId={DESIGNER_ID} onCountChange={onCountChange} />);

    expect(await screen.findByText("無法載入作品集，請重新整理頁面再試一次。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "上傳作品" })).toBeNull();
    expect(onCountChange).not.toHaveBeenCalled();
  });

  it("上傳成功：新作品出現在最前面，張數更新，不需重讀", async () => {
    const user = userEvent.setup({ delay: null });
    const { onCountChange } = arrange([image(1)]);
    await screen.findByText("1 / 12 張");
    const added = image(3);
    vi.mocked(uploadPortfolioImage).mockResolvedValue({ ok: true, data: added });
    const file = png();

    await user.upload(input(), file);

    expect(await screen.findByText("2 / 12 張")).toBeInTheDocument();
    expect(uploadPortfolioImage).toHaveBeenCalledWith(expect.anything(), DESIGNER_ID, file);
    const srcs = screen.getAllByRole("img").map((img) => img.getAttribute("src"));
    expect(srcs[0]).toBe(added.image_url);
    expect(onCountChange).toHaveBeenLastCalledWith(2);
    expect(listPortfolio).toHaveBeenCalledTimes(1);
  });

  it("上傳失敗（例如被 trigger 擋下第 13 張）：顯示文案並重讀清單，以資料庫為準", async () => {
    const user = userEvent.setup({ delay: null });
    const { onCountChange } = arrange([image(1)]);
    await screen.findByText("1 / 12 張");
    vi.mocked(uploadPortfolioImage).mockResolvedValue({
      ok: false,
      error: { message: "已達 12 張上限，請先刪除舊作品" },
    });
    // 重讀時發現別的分頁已經上傳到 3 張。
    vi.mocked(listPortfolio).mockResolvedValue({ ok: true, data: [image(3), image(2), image(1)] });

    await user.upload(input(), png());

    expect(await screen.findByRole("alert")).toHaveTextContent("已達 12 張上限，請先刪除舊作品");
    expect(await screen.findByText("3 / 12 張")).toBeInTheDocument();
    expect(onCountChange).toHaveBeenLastCalledWith(3);
    expect(listPortfolio).toHaveBeenCalledTimes(2);
  });

  it("刪除成功且檔案也刪掉：那張消失、張數更新，沒有警告", async () => {
    const user = userEvent.setup({ delay: null });
    const target = image(2);
    const { onCountChange } = arrange([target, image(1)]);
    await screen.findByText("2 / 12 張");
    vi.mocked(deletePortfolioImage).mockResolvedValue({ ok: true, data: { cleanupWarning: false, retryPath: null } });

    await confirmDelete(user, 1);

    expect(await screen.findByText("1 / 12 張")).toBeInTheDocument();
    expect(deletePortfolioImage).toHaveBeenCalledWith(expect.anything(), DESIGNER_ID, target.id);
    expect(onCountChange).toHaveBeenLastCalledWith(1);
    expect(screen.queryByText(/仍可透過原網址存取/)).toBeNull();
  });

  it("刪除失敗：顯示文案並重讀清單", async () => {
    const user = userEvent.setup({ delay: null });
    arrange([image(2), image(1)]);
    await screen.findByText("2 / 12 張");
    vi.mocked(deletePortfolioImage).mockResolvedValue({
      ok: false,
      error: { message: "這張作品已不存在，請重新整理頁面。" },
    });
    vi.mocked(listPortfolio).mockResolvedValue({ ok: true, data: [image(1)] });

    await confirmDelete(user, 1);

    expect(await screen.findByRole("alert")).toHaveTextContent("這張作品已不存在，請重新整理頁面。");
    expect(await screen.findByText("1 / 12 張")).toBeInTheDocument();
  });

  it("資料列已刪但檔案沒刪成功：頁籤內常駐警告（不是 Toast），按「重試刪除檔案」成功後警告消失", async () => {
    const user = userEvent.setup({ delay: null });
    arrange([image(1)]);
    await screen.findByText("1 / 12 張");
    const retryPath = `portfolio/${DESIGNER_ID}/00000001-0000-4000-8000-000000000000.webp`;
    vi.mocked(deletePortfolioImage).mockResolvedValue({ ok: true, data: { cleanupWarning: true, retryPath } });
    vi.mocked(removePortfolioFile).mockResolvedValue({ ok: true, data: undefined });

    await confirmDelete(user, 1);

    expect(await screen.findByText(/圖片已從作品集移除，但檔案可能仍可透過原網址存取，請點「重試刪除檔案」或聯絡管理者/)).toBeInTheDocument();
    expect(showToast).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "重試刪除檔案" }));
    await waitFor(() => expect(screen.queryByText(/仍可透過原網址存取/)).toBeNull());
    expect(removePortfolioFile).toHaveBeenCalledWith(expect.anything(), DESIGNER_ID, retryPath);
    expect(showToast).toHaveBeenCalledWith("已刪除檔案", "success");
  });

  it("重試仍失敗：警告留著並提示；警告可手動關閉", async () => {
    const user = userEvent.setup({ delay: null });
    arrange([image(1)]);
    await screen.findByText("1 / 12 張");
    const retryPath = `portfolio/${DESIGNER_ID}/00000001-0000-4000-8000-000000000000.webp`;
    vi.mocked(deletePortfolioImage).mockResolvedValue({ ok: true, data: { cleanupWarning: true, retryPath } });
    vi.mocked(removePortfolioFile).mockResolvedValue(GENERIC);

    await confirmDelete(user, 1);
    await user.click(await screen.findByRole("button", { name: "重試刪除檔案" }));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith("仍無法刪除檔案，請稍後再試或聯絡管理者", "error"));
    expect(screen.getByText(/仍可透過原網址存取/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "關閉" }));
    await waitFor(() => expect(screen.queryByText(/仍可透過原網址存取/)).toBeNull());
  });

  it("警告沒有可重試的路徑（路徑驗證沒過）：不給重試按鈕，只請聯絡管理者", async () => {
    const user = userEvent.setup({ delay: null });
    arrange([image(1)]);
    await screen.findByText("1 / 12 張");
    vi.mocked(deletePortfolioImage).mockResolvedValue({ ok: true, data: { cleanupWarning: true, retryPath: null } });

    await confirmDelete(user, 1);

    expect(await screen.findByText(/仍可透過原網址存取，請聯絡管理者/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重試刪除檔案" })).toBeNull();
  });
});
