// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithTheme as render } from "../test-utils";
import { BrandHeaderSection } from "@/app/_components/booking/BrandHeaderSection";

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

describe("BrandHeaderSection", () => {
  it("品牌列會渲染明暗模式切換圖示（TASK-063），不影響店名／簡介顯示", () => {
    mockMatchMedia();
    render(
      <BrandHeaderSection
        display={{
          hasBrand: true,
          name: "普洛午理髮廳",
          description: "質感沉靜・預約體驗",
          logoUrl: null,
          coverImageUrl: null,
          address: null,
          phone: null,
        }}
      />,
    );
    expect(screen.getByRole("heading", { name: "普洛午理髮廳" })).toBeInTheDocument();
    expect(screen.getByText("質感沉靜・預約體驗")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /切換為(亮|暗)色模式/ }),
    ).toBeInTheDocument();
  });
});
