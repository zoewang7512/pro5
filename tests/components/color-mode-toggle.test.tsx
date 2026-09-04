// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@mui/material/styles";
import { theme } from "@/lib/theme";
import { ColorModeToggle } from "@/components/ui/ColorModeToggle";

// jsdom 沒有內建 matchMedia，MUI useColorScheme 判斷系統偏好時會呼叫它，
// 需要本地 mock（不動全域 tests/setup.ts，避免影響其他不需要這個 API 的測試檔）。
function mockMatchMedia(prefersDark: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: prefersDark && query.includes("dark"),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

function renderToggle() {
  return render(
    <ThemeProvider theme={theme}>
      <ColorModeToggle />
    </ThemeProvider>,
  );
}

describe("ColorModeToggle", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove("light", "dark");
  });

  afterEach(() => {
    // 明確呼叫 cleanup：本檔會連續 render 多次 ColorModeToggle，若沒清掉前一個測試
    // 掛載的 <button>，後面測試用 aria-label 查詢會因為同名按鈕重複而找到多個元素。
    cleanup();
    document.documentElement.classList.remove("light", "dark");
  });

  it("系統偏好亮色、尚未手動選過時，掛載後顯示「切換為暗色模式」（可切到暗色）", () => {
    mockMatchMedia(false);
    renderToggle();
    expect(screen.getByRole("button", { name: "切換為暗色模式" })).toBeInTheDocument();
  });

  it("系統偏好暗色、尚未手動選過時，掛載後顯示「切換為亮色模式」（可切回亮色）", () => {
    mockMatchMedia(true);
    renderToggle();
    expect(screen.getByRole("button", { name: "切換為亮色模式" })).toBeInTheDocument();
  });

  it("點擊後切換為暗色、圖示與 aria-label 隨之更新，並把選擇存入 localStorage 供下次造訪套用", async () => {
    mockMatchMedia(false);
    const user = userEvent.setup();
    renderToggle();

    await user.click(screen.getByRole("button", { name: "切換為暗色模式" }));

    expect(screen.getByRole("button", { name: "切換為亮色模式" })).toBeInTheDocument();
    expect(window.localStorage.getItem("mui-mode")).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("再次點擊可切回亮色，localStorage 同步更新", async () => {
    mockMatchMedia(false);
    const user = userEvent.setup();
    renderToggle();

    await user.click(screen.getByRole("button", { name: "切換為暗色模式" }));
    await user.click(screen.getByRole("button", { name: "切換為亮色模式" }));

    expect(screen.getByRole("button", { name: "切換為暗色模式" })).toBeInTheDocument();
    expect(window.localStorage.getItem("mui-mode")).toBe("light");
    expect(document.documentElement.classList.contains("light")).toBe(true);
  });
});
