// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithTheme as render } from "../test-utils";
import { LoginForm } from "@/app/login/login-form";

afterEach(cleanup);
// signInWithPasswordMock／routerReplaceMock／routerRefreshMock 由 vi.hoisted 建立、跨測試
// 共用同一個 vi.fn() 實例，若不清空呼叫紀錄，後面案例的 toHaveBeenCalledTimes 斷言會把前
// 面案例的呼叫次數也算進去。
beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks 只清呼叫紀錄，不會還原個別測試用 mockReturnValue 設定的回傳值，
  // 這裡每個案例開始前重設回預設的空 URLSearchParams，避免前一個案例設定的
  // ?mode=forgot-password 外溢到下一個案例。
  useSearchParamsMock.mockReturnValue(new URLSearchParams());
  // 預設「未啟用 MFA」（currentLevel === nextLevel）：既有登入測試案例（TASK-039）都是
  // 針對未啟用 MFA 帳號寫的，不應該因為 TASK-044 新增的 AAL 檢查而需要逐一改寫；MFA 相關
  // 案例各自用 mockResolvedValueOnce／mockResolvedValue 覆寫這個預設值。
  getAuthenticatorAssuranceLevelMock.mockResolvedValue({
    data: { currentLevel: "aal1", nextLevel: "aal1" },
    error: null,
  });
  signOutMock.mockResolvedValue({ error: null });
});

const {
  signInWithPasswordMock,
  resetPasswordForEmailMock,
  getAuthenticatorAssuranceLevelMock,
  listFactorsMock,
  challengeMock,
  verifyMock,
  signOutMock,
  routerReplaceMock,
  routerRefreshMock,
  useSearchParamsMock,
} = vi.hoisted(() => ({
  signInWithPasswordMock: vi.fn(),
  resetPasswordForEmailMock: vi.fn(),
  getAuthenticatorAssuranceLevelMock: vi.fn(),
  listFactorsMock: vi.fn(),
  challengeMock: vi.fn(),
  verifyMock: vi.fn(),
  signOutMock: vi.fn(),
  routerReplaceMock: vi.fn(),
  routerRefreshMock: vi.fn(),
  // 預設回傳空的 URLSearchParams（mode 讀不到值 → 初始為 login 模式）；個別測試可用
  // useSearchParamsMock.mockReturnValue(new URLSearchParams(...)) 覆寫，驗證 ?mode=
  // 初始狀態的行為。
  useSearchParamsMock: vi.fn(() => new URLSearchParams()),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: signInWithPasswordMock,
      resetPasswordForEmail: resetPasswordForEmailMock,
      signOut: signOutMock,
      mfa: {
        getAuthenticatorAssuranceLevel: getAuthenticatorAssuranceLevelMock,
        listFactors: listFactorsMock,
        challenge: challengeMock,
        verify: verifyMock,
      },
    },
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplaceMock, refresh: routerRefreshMock }),
  useSearchParams: () => useSearchParamsMock(),
}));

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Email", { exact: false }), "designer@example.com");
  await user.type(screen.getByLabelText("密碼", { exact: false }), "wrong-or-right");
  await user.click(screen.getByRole("button", { name: "登入" }));
}

describe("LoginForm", () => {
  it("登入失敗時顯示既有錯誤文案，且不導向 /admin", async () => {
    signInWithPasswordMock.mockResolvedValue({ error: { message: "Invalid login credentials" } });
    const user = userEvent.setup();
    render(<LoginForm />);

    await fillAndSubmit(user);

    expect(await screen.findByText("帳號或密碼錯誤，請再試一次。")).toBeInTheDocument();
    expect(routerReplaceMock).not.toHaveBeenCalled();
    expect(routerRefreshMock).not.toHaveBeenCalled();
  });

  it("登入成功時呼叫 signInWithPassword 並導向 /admin", async () => {
    signInWithPasswordMock.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(<LoginForm />);

    await fillAndSubmit(user);

    await waitFor(() => expect(routerReplaceMock).toHaveBeenCalledWith("/admin"));
    expect(routerRefreshMock).toHaveBeenCalledTimes(1);
    expect(signInWithPasswordMock).toHaveBeenCalledWith({
      email: "designer@example.com",
      password: "wrong-or-right",
    });
  });

  it("送出中登入按鈕停用，防止重複送出觸發第二次 signInWithPassword 呼叫", async () => {
    let resolveSignIn!: (value: { error: null }) => void;
    signInWithPasswordMock.mockImplementation(
      () => new Promise((resolve) => { resolveSignIn = resolve; }),
    );
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText("Email", { exact: false }), "designer@example.com");
    await user.type(screen.getByLabelText("密碼", { exact: false }), "some-password");

    const submitButton = screen.getByRole("button", { name: "登入" });
    await user.click(submitButton);

    await waitFor(() => expect(submitButton).toBeDisabled());
    // userEvent.click 會因為 pointer-events:none（disabled 的既有行為）拒絕互動，
    // 這本身就是防重複送出生效的證據；改用 fireEvent 直接派送 click 事件，確認 React
    // 層級的 disabled 屬性同樣擋下第二次送出（不只是視覺上看起來擋住而已）。
    fireEvent.click(submitButton);
    expect(signInWithPasswordMock).toHaveBeenCalledTimes(1);

    resolveSignIn({ error: null });
    await waitFor(() => expect(routerReplaceMock).toHaveBeenCalledWith("/admin"));
  });

  it("點擊「忘記密碼？」切換為忘記密碼表單，送出後顯示固定成功文案，不論帳號是否存在", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000");
    resetPasswordForEmailMock.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.click(screen.getByRole("button", { name: "忘記密碼？" }));
    expect(screen.getByRole("heading", { name: "重設密碼" })).toBeInTheDocument();

    await user.type(screen.getByLabelText("Email", { exact: false }), "someone@example.com");
    await user.click(screen.getByRole("button", { name: "寄送重設信" }));

    expect(
      await screen.findByText(/若此 email 對應既有帳號，重設密碼信已寄出，請至信箱查收。/),
    ).toBeInTheDocument();
    // 明確斷言完整網址（而非 stringContaining），避免 NEXT_PUBLIC_SITE_URL 未設定時
    // redirectTo 退化成 "undefined/reset-password" 也能通過測試。
    expect(resetPasswordForEmailMock).toHaveBeenCalledWith("someone@example.com", {
      redirectTo: "http://localhost:3000/reset-password",
    });
    vi.unstubAllEnvs();
  });

  it("忘記密碼送出遇到服務層級錯誤時顯示通用失敗文案", async () => {
    resetPasswordForEmailMock.mockResolvedValue({ error: { message: "rate limited" } });
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.click(screen.getByRole("button", { name: "忘記密碼？" }));
    await user.type(screen.getByLabelText("Email", { exact: false }), "someone@example.com");
    await user.click(screen.getByRole("button", { name: "寄送重設信" }));

    expect(await screen.findByText("發生未預期的錯誤，請稍後再試。")).toBeInTheDocument();
  });

  it("忘記密碼表單點「← 返回登入」切回登入表單，且先前輸入的登入欄位仍保留", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText("Email", { exact: false }), "designer@example.com");
    await user.type(screen.getByLabelText("密碼", { exact: false }), "some-password");

    await user.click(screen.getByRole("button", { name: "忘記密碼？" }));
    await user.click(screen.getByRole("button", { name: "← 返回登入" }));

    expect(screen.getByRole("heading", { name: "設計師登入" })).toBeInTheDocument();
    // mode 切換不會重置登入表單欄位（backToLogin 只重置忘記密碼相關 state），
    // 這裡明確斷言現況行為，避免之後改動時在沒有測試涵蓋下意外變動。
    expect(screen.getByLabelText("Email", { exact: false })).toHaveValue("designer@example.com");
    expect(screen.getByLabelText("密碼", { exact: false })).toHaveValue("some-password");
  });

  it("忘記密碼表單第二次送出時，前一次的結果訊息會先被清空（不會同時顯示新舊訊息）", async () => {
    resetPasswordForEmailMock
      .mockResolvedValueOnce({ error: { message: "rate limited" } })
      .mockResolvedValueOnce({ error: null });
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.click(screen.getByRole("button", { name: "忘記密碼？" }));
    await user.type(screen.getByLabelText("Email", { exact: false }), "someone@example.com");
    await user.click(screen.getByRole("button", { name: "寄送重設信" }));
    expect(await screen.findByText("發生未預期的錯誤，請稍後再試。")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "寄送重設信" }));
    expect(
      await screen.findByText(/若此 email 對應既有帳號，重設密碼信已寄出，請至信箱查收。/),
    ).toBeInTheDocument();
    expect(screen.queryByText("發生未預期的錯誤，請稍後再試。")).not.toBeInTheDocument();
  });

  it("造訪 /login?mode=forgot-password 時初始就顯示忘記密碼表單（供 /reset-password 逾時後的「重新申請」連結使用）", () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams("mode=forgot-password"));
    render(<LoginForm />);

    expect(screen.getByRole("heading", { name: "重設密碼" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "設計師登入" })).not.toBeInTheDocument();
  });
});

// OtpInput 每一格都是獨立的受控輸入框（aria-label「驗證碼第 N 碼」），逐格填入比逐字元
// userEvent.type 更貼近元件實際的 onChange 介面（比照 account-settings-view.test.tsx
// 既有的 fillOtpInput 慣例）。
function fillOtpInput(code: string) {
  const boxes = screen.getAllByLabelText(/驗證碼第 \d 碼/);
  code.split("").forEach((digit, index) => {
    fireEvent.change(boxes[index], { target: { value: digit } });
  });
}

describe("LoginForm - MFA 挑戰步驟（TASK-044）", () => {
  it("帳密正確且已啟用 MFA 時，顯示驗證碼輸入步驟，不直接導向 /admin", async () => {
    signInWithPasswordMock.mockResolvedValue({ error: null });
    getAuthenticatorAssuranceLevelMock.mockResolvedValue({
      data: { currentLevel: "aal1", nextLevel: "aal2" },
      error: null,
    });
    listFactorsMock.mockResolvedValue({
      data: { all: [{ id: "factor-1", factor_type: "totp", status: "verified" }] },
      error: null,
    });
    const user = userEvent.setup();
    render(<LoginForm />);

    await fillAndSubmit(user);

    expect(await screen.findByRole("heading", { name: "輸入驗證碼" })).toBeInTheDocument();
    expect(routerReplaceMock).not.toHaveBeenCalled();
  });

  it("讀不到有效的 AAL（currentLevel／nextLevel 皆為 null）時 fail closed：登出、顯示通用錯誤、不導向 /admin", async () => {
    signInWithPasswordMock.mockResolvedValue({ error: null });
    getAuthenticatorAssuranceLevelMock.mockResolvedValue({
      data: { currentLevel: null, nextLevel: null },
      error: null,
    });
    const user = userEvent.setup();
    render(<LoginForm />);

    await fillAndSubmit(user);

    expect(await screen.findByText("發生未預期的錯誤，請稍後再試。")).toBeInTheDocument();
    expect(signOutMock).toHaveBeenCalledWith({ scope: "local" });
    expect(routerReplaceMock).not.toHaveBeenCalled();
  });

  it("判斷需要 MFA 但找不到已驗證的 factor 時 fail closed：登出、顯示通用錯誤、不導向 /admin", async () => {
    signInWithPasswordMock.mockResolvedValue({ error: null });
    getAuthenticatorAssuranceLevelMock.mockResolvedValue({
      data: { currentLevel: "aal1", nextLevel: "aal2" },
      error: null,
    });
    listFactorsMock.mockResolvedValue({ data: { all: [] }, error: null });
    const user = userEvent.setup();
    render(<LoginForm />);

    await fillAndSubmit(user);

    expect(await screen.findByText("發生未預期的錯誤，請稍後再試。")).toBeInTheDocument();
    expect(signOutMock).toHaveBeenCalledWith({ scope: "local" });
    expect(routerReplaceMock).not.toHaveBeenCalled();
  });

  async function submitToMfaStep(user: ReturnType<typeof userEvent.setup>) {
    signInWithPasswordMock.mockResolvedValue({ error: null });
    getAuthenticatorAssuranceLevelMock.mockResolvedValue({
      data: { currentLevel: "aal1", nextLevel: "aal2" },
      error: null,
    });
    listFactorsMock.mockResolvedValue({
      data: { all: [{ id: "factor-1", factor_type: "totp", status: "verified" }] },
      error: null,
    });
    render(<LoginForm />);
    await fillAndSubmit(user);
    await screen.findByRole("heading", { name: "輸入驗證碼" });
  }

  it("驗證碼錯誤時清空輸入、顯示錯誤提示，不導向 /admin", async () => {
    challengeMock.mockResolvedValue({ data: { id: "challenge-1" }, error: null });
    verifyMock.mockResolvedValue({ error: { code: "mfa_verification_failed" } });
    const user = userEvent.setup();
    await submitToMfaStep(user);

    fillOtpInput("000000");
    await user.click(screen.getByRole("button", { name: "驗證並登入" }));

    expect(await screen.findByText("驗證碼錯誤，請重新輸入。")).toBeInTheDocument();
    expect(routerReplaceMock).not.toHaveBeenCalled();
    expect(screen.getAllByLabelText(/驗證碼第 \d 碼/).map((box) => (box as HTMLInputElement).value)).toEqual([
      "",
      "",
      "",
      "",
      "",
      "",
    ]);
  });

  it("驗證碼正確時導向 /admin", async () => {
    challengeMock.mockResolvedValue({ data: { id: "challenge-1" }, error: null });
    verifyMock.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    await submitToMfaStep(user);

    fillOtpInput("123456");
    await user.click(screen.getByRole("button", { name: "驗證並登入" }));

    await waitFor(() => expect(routerReplaceMock).toHaveBeenCalledWith("/admin"));
    expect(routerRefreshMock).toHaveBeenCalledTimes(1);
    expect(verifyMock).toHaveBeenCalledWith({ factorId: "factor-1", challengeId: "challenge-1", code: "123456" });
  });

  it("點擊「改用其他方式登入」會以 local scope 登出、回到帳密登入畫面", async () => {
    const user = userEvent.setup();
    await submitToMfaStep(user);

    await user.click(screen.getByRole("button", { name: "改用其他方式登入" }));

    await waitFor(() => expect(signOutMock).toHaveBeenCalledWith({ scope: "local" }));
    expect(await screen.findByRole("heading", { name: "設計師登入" })).toBeInTheDocument();
  });
});
