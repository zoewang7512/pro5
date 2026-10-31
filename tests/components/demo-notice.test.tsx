// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithTheme as render } from "../test-utils";
import { DemoNotice } from "@/app/admin/_components/DemoNotice";

const state = vi.hoisted(() => ({ isDemo: true, resetLabel: "每日凌晨 3 點左右" }));

vi.mock("@/app/admin/_components/AdminProfileContext", () => ({
  useAdminProfile: () => ({ isDemo: state.isDemo }),
}));

// 還原時間缺值的降級案例要能在同一個檔案裡切換 DEMO_RESET_LABEL，其餘文案維持真實值。
vi.mock("@/lib/demo/notice-copy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/demo/notice-copy")>();
  return {
    ...actual,
    get DEMO_RESET_LABEL() {
      return state.resetLabel;
    },
  };
});

const BANNER_LEAD = "您正在使用體驗帳號。";
const BANNER_REST = "不開放改密碼、改 Email、啟用 MFA；資料每日凌晨 3 點左右還原。";

beforeEach(() => {
  state.isDemo = true;
  state.resetLabel = "每日凌晨 3 點左右";
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe("DemoNotice（TASK-105）", () => {
  it("非 Demo：完全不渲染橫幅與視窗，也不碰 sessionStorage 旗標", () => {
    state.isDemo = false;
    sessionStorage.setItem("demo-welcome-pending", "1");

    const { container } = render(<DemoNotice />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(BANNER_LEAD)).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(sessionStorage.getItem("demo-welcome-pending")).toBe("1");
  });

  it("Demo 且沒有旗標：顯示橫幅（三件事）與「了解更多」、「關閉提示」，不彈視窗", () => {
    render(<DemoNotice />);

    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent(`${BANNER_LEAD}${BANNER_REST}`);
    expect(screen.getByText(BANNER_LEAD).tagName).toBe("B");
    expect(screen.getByRole("button", { name: "了解更多" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "關閉提示" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("橫幅是常駐資訊而非錯誤：不使用 role=alert", () => {
    render(<DemoNotice />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("Demo 且有 demo-welcome-pending：彈出說明視窗、旗標被清除；重新整理（重新掛載）不再彈出", async () => {
    sessionStorage.setItem("demo-welcome-pending", "1");

    const first = render(<DemoNotice />);

    const dialog = await screen.findByRole("dialog", { name: "您正在使用體驗帳號" });
    expect(dialog).toBeInTheDocument();
    expect(sessionStorage.getItem("demo-welcome-pending")).toBeNull();

    first.unmount();
    render(<DemoNotice />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("說明視窗內容：可以體驗與不開放兩份清單與「開始體驗」，沒有副標", async () => {
    sessionStorage.setItem("demo-welcome-pending", "1");
    render(<DemoNotice />);

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("可以體驗");
    expect(dialog).toHaveTextContent("預約週曆、改期、取消、標記完成");
    expect(dialog).toHaveTextContent("設計師、作品集、請假與服務設定");
    expect(dialog).toHaveTextContent("營業時間、公休日、儀表板與報表");
    expect(dialog).toHaveTextContent("不開放");
    expect(dialog).toHaveTextContent("修改密碼、登入 Email");
    expect(dialog).toHaveTextContent("啟用／停用雙重驗證（MFA）");
    expect(screen.getByRole("button", { name: "開始體驗" })).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent("公開的展示帳號");
    expect(screen.getAllByRole("list")).toHaveLength(2);
  });

  it("「開始體驗」與 Esc 都能關閉視窗", async () => {
    sessionStorage.setItem("demo-welcome-pending", "1");
    const user = userEvent.setup();
    render(<DemoNotice />);

    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "開始體驗" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "了解更多" }));
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("「了解更多」開啟同一份視窗，關閉後焦點回到「了解更多」", async () => {
    const user = userEvent.setup();
    render(<DemoNotice />);

    const learnMore = screen.getByRole("button", { name: "了解更多" });
    await user.click(learnMore);
    const dialog = await screen.findByRole("dialog", { name: "您正在使用體驗帳號" });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(learnMore).toHaveFocus();
  });

  it("✕ 關閉橫幅並記下旗標：同一分頁重新掛載不再顯示；沒有旗標的新分頁會顯示", async () => {
    const user = userEvent.setup();
    const first = render(<DemoNotice />);

    await user.click(screen.getByRole("button", { name: "關閉提示" }));
    expect(screen.queryByText(BANNER_LEAD)).not.toBeInTheDocument();
    expect(sessionStorage.getItem("demo-banner-dismissed")).toBe("1");

    first.unmount();
    render(<DemoNotice />);
    await waitFor(() => expect(screen.queryByText(BANNER_LEAD)).not.toBeInTheDocument());
    cleanup();

    sessionStorage.clear();
    render(<DemoNotice />);
    expect(screen.getByText(BANNER_LEAD)).toBeInTheDocument();
  });

  it("橫幅關閉後仍可用 demo-welcome-pending 彈出視窗（兩個旗標互不影響）", async () => {
    sessionStorage.setItem("demo-banner-dismissed", "1");
    sessionStorage.setItem("demo-welcome-pending", "1");
    render(<DemoNotice />);

    await screen.findByRole("dialog");
    expect(screen.queryByText(BANNER_LEAD, { selector: "b" })).not.toBeInTheDocument();
  });

  it("缺少還原時間：橫幅降級為不含時間的簡短版，不顯示錯誤", () => {
    state.resetLabel = "";
    render(<DemoNotice />);

    expect(screen.getByRole("status")).toHaveTextContent(BANNER_LEAD);
    expect(screen.queryByText(/還原/)).not.toBeInTheDocument();
    expect(screen.queryByText(/不開放改密碼/)).not.toBeInTheDocument();
  });

  describe("sessionStorage 不可用", () => {
    it("讀取拋例外：橫幅照常顯示，且視為第一次進後台而彈出視窗", async () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new DOMException("denied", "SecurityError");
      });
      render(<DemoNotice />);

      expect(screen.getByText(BANNER_LEAD)).toBeInTheDocument();
      expect(await screen.findByRole("dialog")).toBeInTheDocument();
    });

    it("寫入拋例外：點 ✕ 仍能在目前畫面隱藏橫幅，不報錯", async () => {
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new DOMException("denied", "SecurityError");
      });
      const user = userEvent.setup();
      render(<DemoNotice />);

      await user.click(screen.getByRole("button", { name: "關閉提示" }));

      expect(screen.queryByText(BANNER_LEAD)).not.toBeInTheDocument();
    });
  });
});
