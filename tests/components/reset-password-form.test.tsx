// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithTheme as render } from "../test-utils";
import { ResetPasswordForm } from "@/app/reset-password/reset-password-form";

afterEach(cleanup);

const { onAuthStateChangeMock, updateUserMock, signOutMock, routerReplaceMock, routerRefreshMock } = vi.hoisted(() => ({
  onAuthStateChangeMock: vi.fn(),
  updateUserMock: vi.fn(),
  signOutMock: vi.fn(),
  routerReplaceMock: vi.fn(),
  routerRefreshMock: vi.fn(),
}));

// 刻意不 mock getSession：reset-password-form.tsx 只信任 PASSWORD_RECOVERY 事件本身，
// 不會用「有沒有任何既有 session」判斷連結是否有效（見下方「既有 session 但沒有收到
// PASSWORD_RECOVERY 事件」的迴歸測試），所以元件邏輯本來就不會呼叫 getSession()。
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: onAuthStateChangeMock,
      updateUser: updateUserMock,
      signOut: signOutMock,
    },
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplaceMock, refresh: routerRefreshMock }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  onAuthStateChangeMock.mockImplementation(() => ({ data: { subscription: { unsubscribe: vi.fn() } } }));
  signOutMock.mockResolvedValue({ error: null });
});

// 元件掛載時用 onAuthStateChange 監聽 PASSWORD_RECOVERY 事件才會切到「連結有效」狀態
// （見 reset-password-form.tsx 的實作註解）；測試裡直接同步觸發這個事件模擬「使用者透過
// 有效的重設密碼連結造訪」，不需要真的等待或建立真實 Supabase session。
function renderInValidState() {
  let authCallback: (event: string) => void = () => {};
  onAuthStateChangeMock.mockImplementation((callback: (event: string) => void) => {
    authCallback = callback;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  });

  render(<ResetPasswordForm />);
  act(() => {
    authCallback("PASSWORD_RECOVERY");
  });
}

describe("ResetPasswordForm", () => {
  it("收到 PASSWORD_RECOVERY 事件時顯示新密碼表單", () => {
    renderInValidState();
    expect(screen.getByLabelText(/^新密碼/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^確認新密碼/)).toBeInTheDocument();
  });

  it("既有 session 但沒有收到 PASSWORD_RECOVERY 事件時，逾時後仍判定為無效連結（不能單憑「有 session」就放行改密碼，否則已登入的人或偷到 session 的人可以繞過忘記密碼流程）", () => {
    vi.useFakeTimers();
    try {
      // onAuthStateChange 的 callback 完全不呼叫（模擬使用者是透過已登入的 session
      // 直接造訪這個頁面，不是透過信件裡的一次性 recovery 連結），驗證元件不會誤判為有效。
      render(<ResetPasswordForm />);
      act(() => {
        vi.advanceTimersByTime(4000);
      });

      expect(screen.getByText("連結已逾時或已使用，請重新申請忘記密碼。")).toBeInTheDocument();
      expect(screen.queryByLabelText(/^新密碼/)).not.toBeInTheDocument();
      expect(updateUserMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("逾時仍未收到 PASSWORD_RECOVERY 時，顯示連結已逾時或已使用，且不呼叫 updateUser", () => {
    vi.useFakeTimers();
    try {
      render(<ResetPasswordForm />);
      act(() => {
        // 與 reset-password-form.tsx 的 RECOVERY_EVENT_TIMEOUT_MS 一致；若之後調整該常數，
        // 這裡也要跟著調整（未匯出常數是刻意的，避免為了測試把內部實作細節公開成公開 API）。
        vi.advanceTimersByTime(4000);
      });

      expect(screen.getByText("連結已逾時或已使用，請重新申請忘記密碼。")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "重新申請" })).toHaveAttribute("href", "/login?mode=forgot-password");
      expect(updateUserMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("有效連結下兩次新密碼不一致時阻擋送出，顯示行內錯誤，不呼叫 updateUser", async () => {
    const user = userEvent.setup();
    renderInValidState();

    await user.type(screen.getByLabelText(/^新密碼/), "Abc12345");
    await user.type(screen.getByLabelText(/^確認新密碼/), "Abc99999");
    await user.click(screen.getByRole("button", { name: "設定新密碼" }));

    expect(await screen.findByText("兩次輸入的密碼不一致")).toBeInTheDocument();
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("有效連結下新密碼長度不足時阻擋送出並顯示錯誤，不呼叫 updateUser", async () => {
    const user = userEvent.setup();
    renderInValidState();

    await user.type(screen.getByLabelText(/^新密碼/), "abc");
    await user.type(screen.getByLabelText(/^確認新密碼/), "abc");
    await user.click(screen.getByRole("button", { name: "設定新密碼" }));

    expect(await screen.findByText("密碼至少需要 6 個字元。")).toBeInTheDocument();
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("updateUser 回傳錯誤時顯示通用失敗文案，不呼叫 signOut", async () => {
    updateUserMock.mockResolvedValue({ error: { message: "weak password" } });
    const user = userEvent.setup();
    renderInValidState();

    await user.type(screen.getByLabelText(/^新密碼/), "Abc12345");
    await user.type(screen.getByLabelText(/^確認新密碼/), "Abc12345");
    await user.click(screen.getByRole("button", { name: "設定新密碼" }));

    expect(await screen.findByText("設定失敗，請重新申請忘記密碼。")).toBeInTheDocument();
    expect(signOutMock).not.toHaveBeenCalled();
    expect(routerReplaceMock).not.toHaveBeenCalled();
  });

  // 這兩個「延遲後導向」案例刻意不用 vi.useFakeTimers()：user.type／user.click 本身內部
  // 也依賴計時器模擬按鍵延遲與事件派送，混用 fake timers 時容易與 Testing Library
  // findByText/waitFor 的內部輪詢機制互相卡住（曾實際測到整個案例卡到 5 秒逾時）。改用
  // 真實時間等待固定的 1500ms（與元件內的延遲一致），换取測試穩定度，代價是這兩個案例
  // 各多跑約 1.5 秒。
  it("updateUser 成功時顯示成功訊息、呼叫 signOut，並在延遲後導向 /login", async () => {
    updateUserMock.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    renderInValidState();

    await user.type(screen.getByLabelText(/^新密碼/), "Abc12345");
    await user.type(screen.getByLabelText(/^確認新密碼/), "Abc12345");
    await user.click(screen.getByRole("button", { name: "設定新密碼" }));

    expect(await screen.findByText("密碼已設定成功，即將導向登入頁。")).toBeInTheDocument();
    expect(updateUserMock).toHaveBeenCalledWith({ password: "Abc12345" });
    expect(signOutMock).toHaveBeenCalledTimes(1);
    expect(routerReplaceMock).not.toHaveBeenCalled();

    await waitFor(() => expect(routerReplaceMock).toHaveBeenCalledWith("/login"), { timeout: 2500 });
    expect(routerRefreshMock).toHaveBeenCalledTimes(1);
  });

  it("即使 signOut() 呼叫失敗，仍會顯示成功訊息並在延遲後導向 /login（不讓使用者卡在成功畫面）", async () => {
    updateUserMock.mockResolvedValue({ error: null });
    signOutMock.mockRejectedValue(new Error("network error"));
    const user = userEvent.setup();
    renderInValidState();

    await user.type(screen.getByLabelText(/^新密碼/), "Abc12345");
    await user.type(screen.getByLabelText(/^確認新密碼/), "Abc12345");
    await user.click(screen.getByRole("button", { name: "設定新密碼" }));

    expect(await screen.findByText("密碼已設定成功，即將導向登入頁。")).toBeInTheDocument();
    await waitFor(() => expect(routerReplaceMock).toHaveBeenCalledWith("/login"), { timeout: 2500 });
  });
});
