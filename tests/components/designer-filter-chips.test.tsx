// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithTheme as render } from "../test-utils";
import { DesignerAvatar, DesignerFilterChips, DesignerLabel } from "@/app/admin/_components/DesignerFilterChips";
import type { DesignerChip } from "@/lib/admin/designer-filter";

const SUPABASE_URL = "https://example.supabase.co";
const LIN = "00000000-0000-4000-8000-000000000001";
const CHEN = "00000000-0000-4000-8000-000000000002";
const ALLOWED_AVATAR = `${SUPABASE_URL}/storage/v1/object/public/designer-assets/avatar/${LIN}/a.webp`;

const CHIPS: DesignerChip[] = [
  { id: LIN, name: "林小美", avatarUrl: ALLOWED_AVATAR, isActive: true, count: 6 },
  { id: CHEN, name: "陳阿傑", avatarUrl: null, isActive: false, count: 2 },
];

function renderChips(overrides: Partial<React.ComponentProps<typeof DesignerFilterChips>> = {}) {
  const props = {
    loading: false,
    chips: CHIPS,
    selectedIds: [] as string[],
    totalCount: 8,
    onToggle: vi.fn(),
    onClear: vi.fn(),
    ...overrides,
  };
  render(<DesignerFilterChips {...props} />);
  return props;
}

describe("DesignerFilterChips", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it("預設：「全部 · N」亮起，每位設計師帶名字與本週預約數，沒有「清除篩選」", () => {
    renderChips();
    expect(screen.getByRole("button", { name: "全部 · 8" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /林小美.*6/ })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("button", { name: "清除篩選" })).not.toBeInTheDocument();
  });

  it("停用中的設計師標示「已停用」，啟用中的沒有", () => {
    renderChips();
    expect(screen.getByRole("button", { name: /陳阿傑.*已停用/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /林小美/ })).not.toHaveTextContent("已停用");
  });

  it("勾選：Chip 加 ✓ 與 aria-pressed、「全部」取消亮起、出現「清除篩選」；可複選", () => {
    renderChips({ selectedIds: [LIN, CHEN] });
    expect(screen.getByRole("button", { name: "全部 · 8" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: /林小美/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /林小美/ })).toHaveTextContent("✓");
    expect(screen.getByRole("button", { name: /陳阿傑/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "清除篩選" })).toBeInTheDocument();
  });

  it("點設計師 Chip 回報 id；點「全部」與「清除篩選」都呼叫 onClear", async () => {
    const user = userEvent.setup();
    const props = renderChips({ selectedIds: [LIN] });

    await user.click(screen.getByRole("button", { name: /陳阿傑/ }));
    expect(props.onToggle).toHaveBeenCalledWith(CHEN);

    await user.click(screen.getByRole("button", { name: "全部 · 8" }));
    await user.click(screen.getByRole("button", { name: "清除篩選" }));
    expect(props.onClear).toHaveBeenCalledTimes(2);
  });

  it("載入中只顯示 Skeleton，不顯示 Chip", () => {
    renderChips({ loading: true });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(document.querySelectorAll(".MuiSkeleton-root").length).toBeGreaterThan(0);
  });

  it("沒有任何 chip（例如設計師清單讀取失敗）時整列不顯示", () => {
    renderChips({ chips: [] });
    expect(screen.queryByRole("group", { name: "設計師篩選" })).not.toBeInTheDocument();
  });

  it("名字用 <bdi> 隔離方向，計數是獨立的元素", () => {
    renderChips();
    const chip = screen.getByRole("button", { name: /林小美/ });
    expect(chip.querySelector("bdi")).toHaveTextContent("林小美");
    expect(chip.querySelector("bdi")).not.toHaveTextContent("6");
  });

  it("Chip 的頭像 <img> 帶 referrerpolicy=no-referrer（Chip 的 avatar prop 有把設定傳到 <img>）", () => {
    renderChips();
    const img = screen.getByRole("button", { name: /林小美/ }).querySelector("img");
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("referrerpolicy", "no-referrer");
  });
});

describe("DesignerAvatar", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it("白名單內的網址才渲染 <img>，並帶 no-referrer", () => {
    const { container } = render(<DesignerAvatar name="林小美" avatarUrl={ALLOWED_AVATAR} />);
    const img = container.querySelector("img");
    expect(img).toHaveAttribute("src", ALLOWED_AVATAR);
    expect(img).toHaveAttribute("referrerpolicy", "no-referrer");
  });

  it.each([
    ["別的網域", "https://evil.example.com/storage/v1/object/public/designer-assets/avatar/x.webp"],
    ["同網域但不是 designer-assets", `${SUPABASE_URL}/storage/v1/object/public/other/x.webp`],
    ["javascript: 網址", "javascript:alert(1)"],
    ["帶帳密", "https://user:pw@example.supabase.co/storage/v1/object/public/designer-assets/x.webp"],
  ])("網址為%s：不渲染 <img>，顯示名字首字", (_label, url) => {
    const { container } = render(<DesignerAvatar name="林小美" avatarUrl={url} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container).toHaveTextContent("林");
  });

  it("沒有頭像時顯示名字首字", () => {
    const { container } = render(<DesignerAvatar name="陳阿傑" avatarUrl={null} />);
    expect(container).toHaveTextContent("陳");
  });
});

describe("DesignerLabel", () => {
  afterEach(() => cleanup());

  it("名字用 <bdi> 包起來，超長名稱靠容器裁切（不撐破版面）", () => {
    const longName = "長".repeat(30);
    const { container } = render(<DesignerLabel name={longName} avatarUrl={null} />);
    expect(container.querySelector("bdi")).toHaveTextContent(longName);
    const label = container.querySelector("bdi")!.parentElement!;
    expect(getComputedStyle(label).overflow).toBe("hidden");
    expect(getComputedStyle(label).textOverflow).toBe("ellipsis");
  });
});
