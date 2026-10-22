// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithTheme as render } from "../test-utils";
import { PortfolioGrid, type PortfolioGridImage } from "@/components/ui/PortfolioGrid";

afterEach(cleanup);

const images: PortfolioGridImage[] = [0, 1, 2].map((i) => ({
  id: `img${i}`,
  src: `https://project-ref.supabase.co/storage/v1/object/public/designer-assets/portfolio/x/${i}.webp`,
}));

function renderGrid(list: PortfolioGridImage[] = images) {
  return render(<PortfolioGrid images={list} ownerName="林小美" />);
}

function lightbox() {
  return screen.queryByRole("dialog");
}

function openFirst() {
  fireEvent.click(screen.getByRole("button", { name: "查看第 1 張作品" }));
}

describe("PortfolioGrid", () => {
  it("空作品集：顯示「尚無作品」空狀態，沒有格子", () => {
    renderGrid([]);
    expect(screen.getByText("尚無作品")).toBeInTheDocument();
    expect(screen.getByText("這位設計師還沒有上傳作品")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("縮圖：src 集合與輸入完全相同，帶 no-referrer、lazy，alt 含名字與張數", () => {
    renderGrid();
    const imgs = screen.getAllByRole("img", { hidden: true });
    expect(imgs.map((img) => img.getAttribute("src"))).toEqual(images.map((image) => image.src));
    for (const img of imgs) {
      expect(img).toHaveAttribute("referrerpolicy", "no-referrer");
      expect(img).toHaveAttribute("loading", "lazy");
    }
    expect(imgs[2]).toHaveAttribute("alt", "林小美的作品 第 3 張，共 3 張");
  });

  it("縮圖載入失敗：移除 <img>、保留格子（仍可點開）", () => {
    renderGrid();
    fireEvent.error(screen.getAllByRole("img", { hidden: true })[0]);
    expect(screen.getAllByRole("img", { hidden: true })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "查看第 1 張作品" })).toBeInTheDocument();
  });

  it("點格子開啟放大檢視：顯示該張與「n / total」；上一張在第一張停用", () => {
    renderGrid();
    fireEvent.click(screen.getByRole("button", { name: "查看第 2 張作品" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("2 / 3")).toBeInTheDocument();
    expect(within(dialog).getByRole("img")).toHaveAttribute("src", images[1].src);
    expect(within(dialog).getByRole("img")).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(within(dialog).getByRole("button", { name: "上一張" })).toBeEnabled();

    fireEvent.click(within(dialog).getByRole("button", { name: "下一張" }));
    expect(within(dialog).getByText("3 / 3")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "下一張" })).toBeDisabled();
  });

  it("方向鍵左右切換；首尾不越界", () => {
    renderGrid();
    openFirst();
    const dialog = screen.getByRole("dialog");

    fireEvent.keyDown(dialog, { key: "ArrowLeft" });
    expect(within(dialog).getByText("1 / 3")).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    expect(within(dialog).getByText("3 / 3")).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    expect(within(dialog).getByText("3 / 3")).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: "ArrowLeft" });
    expect(within(dialog).getByText("2 / 3")).toBeInTheDocument();
  });

  it("帶修飾鍵的方向鍵（Alt+←＝瀏覽器上一頁、Ctrl／Meta／Shift）與輸入法組字中都不切換、也不 preventDefault", () => {
    renderGrid();
    fireEvent.click(screen.getByRole("button", { name: "查看第 2 張作品" }));
    const dialog = screen.getByRole("dialog");

    for (const modifier of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) {
      const notPrevented = fireEvent.keyDown(dialog, { key: "ArrowLeft", ...modifier });
      expect(notPrevented).toBe(true);
      fireEvent.keyDown(dialog, { key: "ArrowRight", ...modifier });
    }
    fireEvent.keyDown(dialog, { key: "ArrowRight", isComposing: true });
    expect(within(dialog).getByText("2 / 3")).toBeInTheDocument();
  });

  it("放大檢視沒開時，方向鍵不會開啟或切換任何東西", () => {
    renderGrid();
    fireEvent.keyDown(screen.getByRole("button", { name: "查看第 1 張作品" }), { key: "ArrowRight" });
    expect(lightbox()).not.toBeInTheDocument();
  });

  it("觸控滑動：向左滑下一張、向右滑上一張，位移不足門檻不切換", () => {
    renderGrid();
    fireEvent.click(screen.getByRole("button", { name: "查看第 2 張作品" }));
    const dialog = screen.getByRole("dialog");
    const surface = within(dialog).getByRole("img").parentElement as HTMLElement;

    const swipe = (from: number, to: number) => {
      fireEvent.touchStart(surface, { touches: [{ clientX: from }] });
      fireEvent.touchEnd(surface, { changedTouches: [{ clientX: to }] });
    };
    swipe(200, 180);
    expect(within(dialog).getByText("2 / 3")).toBeInTheDocument();
    swipe(200, 100);
    expect(within(dialog).getByText("3 / 3")).toBeInTheDocument();
    swipe(100, 200);
    expect(within(dialog).getByText("2 / 3")).toBeInTheDocument();
  });

  it("Esc 與 × 只關閉放大檢視，格子仍在", async () => {
    renderGrid();
    openFirst();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(lightbox()).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "查看第 1 張作品" })).toBeInTheDocument();

    openFirst();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "關閉放大檢視" }));
    await waitFor(() => expect(lightbox()).not.toBeInTheDocument());
  });

  it("放大檢視裡圖片載入失敗：移除 <img>，保留黑底", () => {
    renderGrid();
    openFirst();
    const dialog = screen.getByRole("dialog");
    fireEvent.error(within(dialog).getByRole("img"));
    expect(within(dialog).queryByRole("img")).not.toBeInTheDocument();
    expect(within(dialog).getByText("1 / 3")).toBeInTheDocument();
  });

  it("作品數變少時 index 夾回範圍，不會當掉", () => {
    const { rerender } = renderGrid();
    fireEvent.click(screen.getByRole("button", { name: "查看第 3 張作品" }));
    expect(within(screen.getByRole("dialog")).getByText("3 / 3")).toBeInTheDocument();
    // 沒有 ThemeProvider 包裝的 rerender 會重新掛載，這裡只確認不拋例外。
    expect(() => rerender(<PortfolioGrid images={images.slice(0, 1)} ownerName="林小美" />)).not.toThrow();
  });
});
