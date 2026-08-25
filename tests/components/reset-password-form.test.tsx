// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithTheme as render } from "../test-utils";
import { ResetPasswordForm } from "@/app/reset-password/reset-password-form";

afterEach(cleanup);

const { getUserMock, getAssuranceLevelMock, updateUserMock, signOutMock, routerReplaceMock, routerRefreshMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  getAssuranceLevelMock: vi.fn(),
  updateUserMock: vi.fn(),
  signOutMock: vi.fn(),
  routerReplaceMock: vi.fn(),
  routerRefreshMock: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: getUserMock,
      mfa: { getAuthenticatorAssuranceLevel: getAssuranceLevelMock },
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
  signOutMock.mockResolvedValue({ error: null });
  // 預設 getUser() 成功（比照 lib/auth/aal.ts 的既有安全前提：先驗證 token 合法，才信任
  // 之後本地解碼的 amr claim）；個別測試案例可覆寫模擬 getUser() 失敗的情境。
  getUserMock.mockResolvedValue({ data: { user: { id: "designer-1" } }, error: null });
});

// TASK-058：元件掛載時改呼叫 getAuthenticatorAssuranceLevel()，其 currentAuthenticationMethods
// 是從已簽章驗證的 JWT amr claim 解碼而來（見 reset-password-form.tsx 的實作註解），不再監聽
// PASSWORD_RECOVERY 事件。實測確認 method 值是 "otp"（不是 "recovery"），見 TASK-058 任務卡。
function mockAssuranceLevel(currentAuthenticationMethods: { method: string; timestamp: number }[]) {
  getAssuranceLevelMock.mockResolvedValue({
    data: { currentLevel: "aal1", nextLevel: "aal1", currentAuthenticationMethods },
    error: null,
  });
}

function nowSeconds(): number {
  return Date.now() / 1000;
}

async function renderInValidState() {
  mockAssuranceLevel([{ method: "otp", timestamp: nowSeconds() }]);
  render(<ResetPasswordForm />);
  await screen.findByLabelText(/^新密碼/);
}

describe("ResetPasswordForm", () => {
  it("session 的 amr 含新鮮的 otp 方法時顯示新密碼表單", async () => {
    await renderInValidState();
    expect(screen.getByLabelText(/^新密碼/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^確認新密碼/)).toBeInTheDocument();
  });

  it("session 的 amr 只有 password 方法（一般已登入 session，未經過忘記密碼流程）時判定為無效連結（不能單憑「有 session」就放行改密碼，否則已登入的人或偷到 session 的人可以繞過忘記密碼流程）", async () => {
    mockAssuranceLevel([{ method: "password", timestamp: nowSeconds() }]);
    render(<ResetPasswordForm />);

    expect(await screen.findByText("連結已逾時或已使用，請重新申請忘記密碼。")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^新密碼/)).not.toBeInTheDocument();
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("amr 含 otp 方法但時間戳超過新鮮度窗口（20 分鐘前）時判定為無效連結", async () => {
    mockAssuranceLevel([{ method: "otp", timestamp: nowSeconds() - 21 * 60 }]);
    render(<ResetPasswordForm />);

    expect(await screen.findByText("連結已逾時或已使用，請重新申請忘記密碼。")).toBeInTheDocument();
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("currentAuthenticationMethods 為空陣列（無任何驗證方法紀錄）時判定為無效連結", async () => {
    mockAssuranceLevel([]);
    render(<ResetPasswordForm />);

    expect(await screen.findByText("連結已逾時或已使用，請重新申請忘記密碼。")).toBeInTheDocument();
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("getAuthenticatorAssuranceLevel 回傳錯誤時判定為無效連結，不呼叫 updateUser", async () => {
    getAssuranceLevelMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    render(<ResetPasswordForm />);

    expect(await screen.findByText("連結已逾時或已使用，請重新申請忘記密碼。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "重新申請" })).toHaveAttribute("href", "/login?mode=forgot-password");
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  // security-reviewer 於本卡總覽審查發現的 MUST FIX 迴歸測試：getAuthenticatorAssuranceLevel()
  // 本身只是本地解碼、不驗簽，元件必須先用 getUser() 確認 access_token 通過伺服器驗證才能信任
  // 之後解碼出的 amr claim（比照 lib/auth/aal.ts 的既有安全前提）。這裡即使
  // getAuthenticatorAssuranceLevel 回傳看起來合法的 otp 方法，只要 getUser() 本身失敗，就必須
  // fail closed，不能因為後面的檢查「看起來通過」就放行。
  it("getUser() 失敗時（access_token 無法通過伺服器驗證）判定為無效連結，即使 amr 看起來合法也不放行，不呼叫 getAuthenticatorAssuranceLevel", async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: { message: "invalid token" } });
    mockAssuranceLevel([{ method: "otp", timestamp: nowSeconds() }]);
    render(<ResetPasswordForm />);

    expect(await screen.findByText("連結已逾時或已使用，請重新申請忘記密碼。")).toBeInTheDocument();
    expect(getAssuranceLevelMock).not.toHaveBeenCalled();
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("有效連結下兩次新密碼不一致時阻擋送出，顯示行內錯誤，不呼叫 updateUser", async () => {
    const user = userEvent.setup();
    await renderInValidState();

    await user.type(screen.getByLabelText(/^新密碼/), "Abc12345");
    await user.type(screen.getByLabelText(/^確認新密碼/), "Abc99999");
    await user.click(screen.getByRole("button", { name: "設定新密碼" }));

    expect(await screen.findByText("兩次輸入的密碼不一致")).toBeInTheDocument();
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("有效連結下新密碼長度不足時阻擋送出並顯示錯誤，不呼叫 updateUser", async () => {
    const user = userEvent.setup();
    await renderInValidState();

    await user.type(screen.getByLabelText(/^新密碼/), "abc");
    await user.type(screen.getByLabelText(/^確認新密碼/), "abc");
    await user.click(screen.getByRole("button", { name: "設定新密碼" }));

    expect(await screen.findByText("密碼至少需要 6 個字元。")).toBeInTheDocument();
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("updateUser 回傳錯誤時顯示通用失敗文案，不呼叫 signOut", async () => {
    updateUserMock.mockResolvedValue({ error: { message: "weak password" } });
    const user = userEvent.setup();
    await renderInValidState();

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
    await renderInValidState();

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
    await renderInValidState();

    await user.type(screen.getByLabelText(/^新密碼/), "Abc12345");
    await user.type(screen.getByLabelText(/^確認新密碼/), "Abc12345");
    await user.click(screen.getByRole("button", { name: "設定新密碼" }));

    expect(await screen.findByText("密碼已設定成功，即將導向登入頁。")).toBeInTheDocument();
    await waitFor(() => expect(routerReplaceMock).toHaveBeenCalledWith("/login"), { timeout: 2500 });
  });
});
