// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithTheme as render } from "../test-utils";
import { DesignersTable } from "@/app/admin/_components/DesignersTable";
import { listDesigners, type AdminDesigner } from "@/lib/admin/designers";

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({}),
}));

vi.mock("@/lib/admin/designers", () => ({
  listDesigners: vi.fn(),
}));

const BASE_URL = "https://project-ref.supabase.co";

function designer(overrides: Partial<AdminDesigner>): AdminDesigner {
  return {
    id: "d1",
    name: "林小美",
    bio: null,
    specialties: [],
    instagram_handle: null,
    avatar_url: null,
    is_active: true,
    sort_order: 0,
    service_count: 0,
    ...overrides,
  };
}

describe("DesignersTable", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", BASE_URL);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("載入中顯示 Skeleton，新增設計師按鈕停用", () => {
    vi.mocked(listDesigners).mockReturnValue(new Promise(() => {}));
    const { container } = render(<DesignersTable />);
    expect(container.querySelectorAll(".MuiSkeleton-root").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /新增設計師/ })).toBeDisabled();
  });

  it("讀取失敗顯示錯誤提示", async () => {
    vi.mocked(listDesigners).mockResolvedValue({ ok: false, error: { message: "x" } });
    render(<DesignersTable />);
    expect(await screen.findByText("無法載入設計師資料，請重新整理頁面再試一次。")).toBeInTheDocument();
  });

  it("沒有設計師時顯示空狀態", async () => {
    vi.mocked(listDesigners).mockResolvedValue({ ok: true, data: { designers: [], totalServices: 0 } });
    render(<DesignersTable />);
    expect(await screen.findByText("還沒有設計師，新增第一位設計師開始接受預約。")).toBeInTheDocument();
  });

  it("列出設計師的名字、專長、提供服務數與狀態；沒有頭像時顯示名字首字", async () => {
    vi.mocked(listDesigners).mockResolvedValue({
      ok: true,
      data: {
        totalServices: 6,
        designers: [
          designer({ id: "d1", name: "林小美", specialties: ["韓系剪髮", "漸層染"], service_count: 5 }),
          designer({ id: "d2", name: "張小芸", is_active: false, sort_order: 1, service_count: 2 }),
        ],
      },
    });
    render(<DesignersTable />);

    expect(await screen.findByText("林小美")).toBeInTheDocument();
    expect(screen.getByText("韓系剪髮")).toBeInTheDocument();
    expect(screen.getByText("漸層染")).toBeInTheDocument();
    expect(screen.getByText("5 / 6 項")).toBeInTheDocument();
    expect(screen.getByText("2 / 6 項")).toBeInTheDocument();
    expect(screen.getByText("啟用中")).toBeInTheDocument();
    expect(screen.getByText("已停用")).toBeInTheDocument();
    expect(screen.getByText("林")).toBeInTheDocument();
    expect(screen.getByText("張")).toBeInTheDocument();
  });

  it("本卡操作按鈕全部停用（唯讀骨架）", async () => {
    vi.mocked(listDesigners).mockResolvedValue({
      ok: true,
      data: { totalServices: 1, designers: [designer({}), designer({ id: "d2", is_active: false })] },
    });
    render(<DesignersTable />);

    await screen.findByText("啟用中");
    for (const name of ["編輯", "停用", "重新啟用"]) {
      for (const button of screen.getAllByRole("button", { name })) {
        expect(button).toBeDisabled();
      }
    }
  });

  it("頭像網址在 designer-assets 白名單內時渲染圖片", async () => {
    const avatarUrl = `${BASE_URL}/storage/v1/object/public/designer-assets/avatar/d1/abc.webp`;
    vi.mocked(listDesigners).mockResolvedValue({
      ok: true,
      data: { totalServices: 0, designers: [designer({ avatar_url: avatarUrl })] },
    });
    const { container } = render(<DesignersTable />);

    await screen.findByText("林小美");
    expect(container.querySelector("img")?.getAttribute("src")).toBe(avatarUrl);
  });

  it("順序欄依列表順序顯示 1、2、3，停用中的設計師名字用停用顏色", async () => {
    vi.mocked(listDesigners).mockResolvedValue({
      ok: true,
      data: {
        totalServices: 0,
        designers: [
          designer({ id: "d1", name: "甲甲" }),
          designer({ id: "d2", name: "乙乙", is_active: false }),
          designer({ id: "d3", name: "丙丙" }),
        ],
      },
    });
    const { container } = render(<DesignersTable />);

    await screen.findByText("乙乙");
    const rows = Array.from(container.querySelectorAll("tbody tr"));
    expect(rows.map((row) => row.querySelector("td")?.textContent)).toEqual(["1", "2", "3"]);
    expect(screen.getByText("乙乙")).toHaveStyle({ color: "rgba(0, 0, 0, 0.38)" });
    expect(screen.getByText("甲甲")).not.toHaveStyle({ color: "rgba(0, 0, 0, 0.38)" });
  });

  it("頭像網址不在 designer-assets 白名單內時不渲染圖片（退回名字首字）", async () => {
    vi.mocked(listDesigners).mockResolvedValue({
      ok: true,
      data: {
        totalServices: 0,
        designers: [designer({ avatar_url: "https://evil.example.com/a.png" })],
      },
    });
    const { container } = render(<DesignersTable />);

    await screen.findByText("林小美");
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("林")).toBeInTheDocument();
  });
});
