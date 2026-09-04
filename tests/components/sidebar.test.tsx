// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithTheme as render } from "../test-utils";
import { Sidebar } from "@/components/ui/Sidebar";

// jsdom 沒有內建 matchMedia，Sidebar 內嵌的 ColorModeToggle 用到 MUI useColorScheme
// 判斷系統偏好時會呼叫它。
function mockMatchMedia() {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

describe("Sidebar", () => {
  afterEach(() => {
    cleanup();
  });

  it("profileName 有傳入時，個人資料區塊內會渲染明暗模式切換圖示（TASK-063）", () => {
    mockMatchMedia();
    render(
      <Sidebar
        title="理髮廳後台"
        items={[{ label: "預約", href: "/admin", active: true }]}
        profileName="王設計師"
      />,
    );
    expect(screen.getByText("王設計師")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /切換為(亮|暗)色模式/ }),
    ).toBeInTheDocument();
  });

  it("profileName 未傳入（尚未載入完成）時，整個個人資料區塊不渲染，含切換圖示", () => {
    mockMatchMedia();
    render(
      <Sidebar title="理髮廳後台" items={[{ label: "預約", href: "/admin", active: true }]} />,
    );
    expect(screen.queryByRole("button", { name: /切換為(亮|暗)色模式/ })).not.toBeInTheDocument();
  });

  it("導覽項目傳入 icon 時會渲染該圖示（TASK-064）", () => {
    mockMatchMedia();
    const { container } = render(
      <Sidebar
        title="理髮廳後台"
        items={[
          {
            label: "預約",
            href: "/admin",
            active: true,
            icon: (
              <svg data-testid="nav-icon-booking" viewBox="0 0 24 24">
                <rect x="3" y="5" width="18" height="16" />
              </svg>
            ),
          },
        ]}
      />,
    );
    expect(screen.getByTestId("nav-icon-booking")).toBeInTheDocument();
    expect(container.querySelectorAll("svg")).toHaveLength(1);
  });

  it("導覽項目未傳入 icon 時仍正常渲染文字，不報錯", () => {
    mockMatchMedia();
    render(
      <Sidebar title="理髮廳後台" items={[{ label: "服務設定", href: "/admin/services" }]} />,
    );
    expect(screen.getByText("服務設定")).toBeInTheDocument();
  });
});
