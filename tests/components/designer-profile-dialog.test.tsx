// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithTheme as render } from "../test-utils";
import { DesignerProfileDialog } from "@/app/_components/booking/DesignerProfileDialog";
import type { PublicDesigner } from "@/lib/booking/types";

afterEach(cleanup);

const ID = "11111111-1111-4111-8111-111111111111";

function makeDesigner(overrides: Partial<PublicDesigner> = {}): PublicDesigner {
  return {
    id: ID,
    name: "林小美",
    bio: "第一行\n第二行",
    specialties: ["韓系剪髮", "漸層染", "空氣感燙"],
    instagram_handle: "mei.hair_01",
    avatar_url: null,
    sort_order: 0,
    portfolio: Array.from({ length: 9 }, (_, i) => ({
      id: `img${i}`,
      image_url: `https://project-ref.supabase.co/storage/v1/object/public/designer-assets/portfolio/${ID}/${i}.webp`,
      created_at: "2026-10-01",
    })),
    ...overrides,
  };
}

function renderDialog(designer: PublicDesigner | null = makeDesigner(), open = true) {
  const onClose = vi.fn();
  const onSelect = vi.fn();
  const view = render(<DesignerProfileDialog open={open} designer={designer} onClose={onClose} onSelect={onSelect} />);
  return { onClose, onSelect, ...view };
}

describe("DesignerProfileDialog", () => {
  it("關閉時不渲染內容", () => {
    renderDialog(makeDesigner(), false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("名字、簡介（保留換行）、專長標籤；Dialog 的名稱指向名字標題", () => {
    renderDialog();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAccessibleName("林小美");
    expect(screen.getByText(/第一行/)).toHaveStyle({ whiteSpace: "pre-line" });
    expect(screen.getByText("韓系剪髮")).toBeInTheDocument();
    expect(screen.getByText("漸層染")).toBeInTheDocument();
    expect(screen.getByText("空氣感燙")).toBeInTheDocument();
  });

  it("數字列只有「作品／專長」兩格（沒有年資）", () => {
    renderDialog();
    expect(screen.getByText("作品").previousElementSibling).toHaveTextContent("9");
    expect(screen.getByText("專長").previousElementSibling).toHaveTextContent("3");
    expect(screen.queryByText("年資")).not.toBeInTheDocument();
  });

  it("AppBar 標題：有合格 IG 帳號顯示帳號，沒有就顯示名字", () => {
    const { unmount } = renderDialog();
    expect(screen.getByText("mei.hair_01")).toBeInTheDocument();
    unmount();

    renderDialog(makeDesigner({ instagram_handle: null }));
    const banner = screen.getByRole("banner");
    expect(banner).toHaveTextContent("林小美");
  });

  it("IG 連結：固定網域、新分頁、noopener noreferrer；帳號當純文字", () => {
    renderDialog();
    const link = screen.getByRole("link", { name: /前往 Instagram/ });
    expect(link).toHaveAttribute("href", "https://www.instagram.com/mei.hair_01/");
    expect(link).toHaveAttribute("target", "_blank");
    const rel = link.getAttribute("rel") ?? "";
    expect(rel).toContain("noopener");
    expect(rel).toContain("noreferrer");
    expect(link).toHaveAccessibleName(/另開新分頁/);
  });

  it.each([null, "javascript:alert(1)", "evil.com/x", "a b", ""])("instagram_handle=%j：不渲染任何外連", (handle) => {
    renderDialog(makeDesigner({ instagram_handle: handle }));
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("簡介、名字、專長是 HTML 字串時一律以純文字顯示", () => {
    const { baseElement } = renderDialog(
      makeDesigner({
        name: "<i>名字</i>",
        bio: "<img src=x onerror=alert(1)>",
        specialties: ["<b>標籤</b>"],
      }),
    );
    expect(baseElement.querySelector('img[src="x"]')).toBeNull();
    expect(baseElement.querySelector("i, b")).toBeNull();
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(screen.getByText("<b>標籤</b>")).toBeInTheDocument();
  });

  it("作品集空：顯示空狀態，數字列作品為 0", () => {
    renderDialog(makeDesigner({ portfolio: [] }));
    expect(screen.getByText("尚無作品")).toBeInTheDocument();
    expect(screen.getByText("作品").previousElementSibling).toHaveTextContent("0");
  });

  it("作品集有圖：九宮格縮圖數量正確，點縮圖開啟放大檢視（巢狀 Dialog），Esc 只關放大檢視", async () => {
    const { onClose } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "查看第 3 張作品" }));
    // 巢狀 Dialog 開著時底層的個人頁會被設成 aria-hidden，所以計數要帶 hidden: true。
    expect(screen.getAllByRole("dialog", { hidden: true })).toHaveLength(2);
    expect(screen.getByText("3 / 9")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await vi.waitFor(() => expect(screen.getAllByRole("dialog", { hidden: true })).toHaveLength(1));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "選擇林小美" })).toBeInTheDocument();
  });

  it("返回鍵與 Esc 呼叫 onClose", () => {
    const { onClose } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "關閉個人頁" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("「選擇○○」呼叫 onSelect 並傳入同一個設計師物件；它是唯一的 primary 按鈕", () => {
    const designer = makeDesigner();
    const { onSelect } = renderDialog(designer);
    const choose = screen.getByRole("button", { name: "選擇林小美" });
    fireEvent.click(choose);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).toBe(designer);
    expect(choose.className).toMatch(/contained/);
    expect(screen.getByRole("link", { name: /前往 Instagram/ }).className).not.toMatch(/contained/);
  });
});
