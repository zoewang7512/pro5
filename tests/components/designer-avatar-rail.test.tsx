// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithTheme as render } from "../test-utils";
import { DesignerAvatarRail, type DesignerAvatarRailItem } from "@/components/ui/DesignerAvatarRail";

afterEach(cleanup);

const items: DesignerAvatarRailItem[] = [
  { key: "any", label: "不指定", variant: "any" },
  { key: "a", label: "林小美", avatarUrl: null, variant: "person" },
  { key: "b", label: "一位名字真的非常非常長的設計師", avatarUrl: null, variant: "person" },
];

describe("DesignerAvatarRail", () => {
  it("每個頭像都是 button，群組有無障礙名稱，只有選取的那顆 aria-pressed=true", () => {
    render(<DesignerAvatarRail items={items} selectedKey="a" onSelect={() => {}} ariaLabel="選擇設計師" />);

    expect(screen.getByRole("group", { name: "選擇設計師" })).toBeInTheDocument();
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(3);
    expect(screen.getByRole("button", { name: /不指定/ })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: /林小美/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("點頭像與按 Enter 都會用該項目的 key 呼叫 onSelect", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<DesignerAvatarRail items={items} selectedKey="any" onSelect={onSelect} ariaLabel="選擇設計師" />);

    await user.click(screen.getByRole("button", { name: /林小美/ }));
    expect(onSelect).toHaveBeenLastCalledWith("a");

    await user.tab();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it("名字完整顯示（不截斷）；沒有頭像時顯示名字首字，「不指定」顯示 ✦", () => {
    render(<DesignerAvatarRail items={items} selectedKey="any" onSelect={() => {}} ariaLabel="選擇設計師" />);

    expect(screen.getByText("一位名字真的非常非常長的設計師")).toBeInTheDocument();
    expect(screen.getByText("林")).toBeInTheDocument();
    expect(screen.getByText("✦")).toBeInTheDocument();
  });
});
