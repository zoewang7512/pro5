// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithTheme as render } from "../test-utils";
import { PasswordStrengthMeter } from "@/components/ui/PasswordStrengthMeter";

afterEach(cleanup);

describe("PasswordStrengthMeter", () => {
  it("密碼為空字串時不渲染任何內容", () => {
    const { container } = render(<PasswordStrengthMeter password="" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("弱密碼顯示「弱」標籤", () => {
    render(<PasswordStrengthMeter password="abc" />);
    expect(screen.getByText("密碼強度：弱")).toBeInTheDocument();
  });

  it("中等強度密碼顯示「中」標籤", () => {
    render(<PasswordStrengthMeter password="abcdefg1" />);
    expect(screen.getByText("密碼強度：中")).toBeInTheDocument();
  });

  it("強密碼顯示「強」標籤", () => {
    render(<PasswordStrengthMeter password="Abcdefgh123!" />);
    expect(screen.getByText("密碼強度：強")).toBeInTheDocument();
  });
});
