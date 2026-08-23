// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithTheme as render } from "../test-utils";
import { ToastProvider } from "@/components/ui/ToastProvider";
import { AdminProfileProvider } from "@/app/admin/_components/AdminProfileContext";
import { AccountSettingsView } from "@/app/admin/_components/AccountSettingsView";

afterEach(cleanup);

const {
  updateAdminPasswordMock,
  updateAdminEmailMock,
  listMfaFactorsMock,
  enrollMfaMock,
  verifyMfaEnrollmentMock,
  cancelMfaEnrollmentMock,
  unenrollMfaWithPasswordAndCodeMock,
  rpcMock,
  getUserMock,
} = vi.hoisted(() => ({
  updateAdminPasswordMock: vi.fn(),
  updateAdminEmailMock: vi.fn(),
  listMfaFactorsMock: vi.fn(),
  enrollMfaMock: vi.fn(),
  verifyMfaEnrollmentMock: vi.fn(),
  cancelMfaEnrollmentMock: vi.fn(),
  unenrollMfaWithPasswordAndCodeMock: vi.fn(),
  rpcMock: vi.fn(),
  getUserMock: vi.fn(),
}));

// AdminProfileContext.refresh()（未被 mock，維持真實實作）在個人資料／email 卡片存檔成功後
// 會被呼叫，內部會打 supabase.rpc()（get_admin_profile）與 supabase.auth.getUser()
// （讀 user.new_email 判斷是否有待確認的 email 變更）；沒有這兩支就會直接拋錯，所以這裡
// 提供最小可用的假實作，預設回傳「無待確認 email 變更」，個別測試可用
// getUserMock.mockResolvedValue(...) 覆寫。
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    rpc: rpcMock,
    auth: { getUser: getUserMock },
  }),
}));

// 只替換會打真實 Supabase 的 updateAdminPassword／updateAdminEmail，其餘（驗證用的純函式、
// resolveAdminDisplayName 等）維持真實實作，比照 tests/components/image-upload-field.test.tsx
// 的 importOriginal 部分 mock 既有慣例。
// MFA（TASK-043）四支函式也在這裡替換掉，不用另外把假 supabase client 的 auth.mfa
// 補齊——比照 updateAdminPassword／updateAdminEmail 既有的「在函式層級 mock，不模擬到
// transport 層」慣例。
vi.mock("@/lib/admin/account", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin/account")>();
  return {
    ...actual,
    updateAdminPassword: updateAdminPasswordMock,
    updateAdminEmail: updateAdminEmailMock,
    listMfaFactors: listMfaFactorsMock,
    enrollMfa: enrollMfaMock,
    verifyMfaEnrollment: verifyMfaEnrollmentMock,
    cancelMfaEnrollment: cancelMfaEnrollmentMock,
    unenrollMfaWithPasswordAndCode: unenrollMfaWithPasswordAndCodeMock,
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  rpcMock.mockResolvedValue({ data: [{ display_name: "Alex", avatar_url: null }], error: null });
  // AdminProfileContext.refresh() 現在也會用這支回傳值更新 email（不只 pendingEmail）——
  // 沒有給 email 欄位的話，任何測試呼叫 refresh() 後 email 會被設成 ""，讓後續斷言的
  // designer@example.com 全部對不上。
  getUserMock.mockResolvedValue({ data: { user: { email: "designer@example.com", new_email: null } }, error: null });
  // 預設「未啟用」，密碼／Email 卡片相關測試不需要關心 MFA 卡片的初始載入狀態。
  listMfaFactorsMock.mockResolvedValue({ ok: true, data: [] });
});

function renderView() {
  return render(
    <AdminProfileProvider
      initialDisplayName="Alex"
      initialAvatarUrl={null}
      email="designer@example.com"
      initialPendingEmail={null}
    >
      <ToastProvider>
        <AccountSettingsView />
      </ToastProvider>
    </AdminProfileProvider>,
  );
}

// 「目前密碼」這個 label 在密碼卡片與登入 Email 卡片（TASK-042 修正 F2：email 變更也要求
// 重新驗證目前密碼）各出現一次，getByLabelText 對這個文字無法唯一命中，改用 getAll 依 DOM
// 順序取用（密碼卡片在前，索引 0；登入 Email 卡片在後，索引 1）。
function getPasswordCardCurrentPasswordField() {
  return screen.getAllByLabelText("目前密碼", { exact: false })[0];
}
function getEmailCardCurrentPasswordField() {
  return screen.getAllByLabelText("目前密碼", { exact: false })[1];
}
// MFA 停用二次確認對話框開啟後，畫面上會同時存在三個「目前密碼」欄位（密碼卡片／Email
// 卡片／對話框），取最後一個。
function getMfaUnenrollPasswordField() {
  const fields = screen.getAllByLabelText("目前密碼", { exact: false });
  return fields[fields.length - 1];
}

describe("AccountSettingsView - 密碼", () => {
  it("新密碼與確認密碼不一致時阻擋送出，顯示行內錯誤，不呼叫 updateAdminPassword", async () => {
    const user = userEvent.setup({ delay: null });
    renderView();

    await user.type(getPasswordCardCurrentPasswordField(), "old-pass");
    await user.type(screen.getByLabelText(/^新密碼/), "Abc12345");
    await user.type(screen.getByLabelText(/^確認新密碼/), "Abc99999");
    await user.click(screen.getByRole("button", { name: "更新密碼" }));

    expect(await screen.findByText("兩次輸入的密碼不一致")).toBeInTheDocument();
    expect(updateAdminPasswordMock).not.toHaveBeenCalled();
  });

  it("目前密碼欄位為空時阻擋送出並 focus 該欄位，不呼叫 updateAdminPassword", async () => {
    const user = userEvent.setup({ delay: null });
    renderView();

    await user.type(screen.getByLabelText(/^新密碼/), "Abc12345");
    await user.type(screen.getByLabelText(/^確認新密碼/), "Abc12345");
    await user.click(screen.getByRole("button", { name: "更新密碼" }));

    expect(updateAdminPasswordMock).not.toHaveBeenCalled();
    expect(getPasswordCardCurrentPasswordField()).toHaveFocus();
  });

  it("新密碼與確認密碼皆空白時顯示「新密碼為必填」，不是誤導性的「不一致」", async () => {
    const user = userEvent.setup({ delay: null });
    renderView();

    await user.type(getPasswordCardCurrentPasswordField(), "old-pass");
    await user.click(screen.getByRole("button", { name: "更新密碼" }));

    expect(await screen.findByText("新密碼為必填。")).toBeInTheDocument();
    expect(screen.queryByText("兩次輸入的密碼不一致")).not.toBeInTheDocument();
    expect(updateAdminPasswordMock).not.toHaveBeenCalled();
  });

  it("新密碼長度不足時顯示錯誤，不呼叫 updateAdminPassword", async () => {
    const user = userEvent.setup({ delay: null });
    renderView();

    await user.type(getPasswordCardCurrentPasswordField(), "old-pass");
    await user.type(screen.getByLabelText(/^新密碼/), "abc");
    await user.type(screen.getByLabelText(/^確認新密碼/), "abc");
    await user.click(screen.getByRole("button", { name: "更新密碼" }));

    expect(await screen.findByText("新密碼至少需要 6 個字元。")).toBeInTheDocument();
    expect(updateAdminPasswordMock).not.toHaveBeenCalled();
  });

  it("目前密碼錯誤時顯示行內錯誤", async () => {
    updateAdminPasswordMock.mockResolvedValue({ ok: false, reason: "wrong_password" });
    const user = userEvent.setup({ delay: null });
    renderView();

    await user.type(getPasswordCardCurrentPasswordField(), "wrong-pass");
    await user.type(screen.getByLabelText(/^新密碼/), "Abc12345");
    await user.type(screen.getByLabelText(/^確認新密碼/), "Abc12345");
    await user.click(screen.getByRole("button", { name: "更新密碼" }));

    expect(await screen.findByText("目前密碼錯誤，請再試一次。")).toBeInTheDocument();
  });

  it("新密碼太弱（weak_password）時顯示對應表單錯誤", async () => {
    updateAdminPasswordMock.mockResolvedValue({ ok: false, reason: "weak_password" });
    const user = userEvent.setup({ delay: null });
    renderView();

    await user.type(getPasswordCardCurrentPasswordField(), "old-pass");
    await user.type(screen.getByLabelText(/^新密碼/), "Abc12345");
    await user.type(screen.getByLabelText(/^確認新密碼/), "Abc12345");
    await user.click(screen.getByRole("button", { name: "更新密碼" }));

    expect(await screen.findByText("新密碼強度不足，請換一個更複雜的密碼。")).toBeInTheDocument();
  });

  it("新密碼與目前密碼相同（same_password）時顯示對應表單錯誤", async () => {
    updateAdminPasswordMock.mockResolvedValue({ ok: false, reason: "same_password" });
    const user = userEvent.setup({ delay: null });
    renderView();

    await user.type(getPasswordCardCurrentPasswordField(), "old-pass");
    await user.type(screen.getByLabelText(/^新密碼/), "Abc12345");
    await user.type(screen.getByLabelText(/^確認新密碼/), "Abc12345");
    await user.click(screen.getByRole("button", { name: "更新密碼" }));

    expect(await screen.findByText("新密碼不能與目前密碼相同。")).toBeInTheDocument();
  });

  it("成功時呼叫 updateAdminPassword（不帶 email 參數），並清空三個欄位、顯示成功 Toast", async () => {
    updateAdminPasswordMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup({ delay: null });
    renderView();

    await user.type(getPasswordCardCurrentPasswordField(), "old-pass");
    await user.type(screen.getByLabelText(/^新密碼/), "Abc12345");
    await user.type(screen.getByLabelText(/^確認新密碼/), "Abc12345");
    await user.click(screen.getByRole("button", { name: "更新密碼" }));

    await waitFor(() =>
      expect(updateAdminPasswordMock).toHaveBeenCalledWith(expect.anything(), "old-pass", "Abc12345"),
    );
    expect(await screen.findByText("密碼已更新，其他裝置的登入已登出，請重新登入")).toBeInTheDocument();
    await waitFor(() => expect(getPasswordCardCurrentPasswordField()).toHaveValue(""));
    expect(screen.getByLabelText(/^新密碼/)).toHaveValue("");
    expect(screen.getByLabelText(/^確認新密碼/)).toHaveValue("");
  });

  it("已啟用 MFA 時，密碼更新成功的 Toast 額外提醒需要重新登入完成驗證（TASK-045 發現：reauthenticateAdmin 會把 session 降回 aal1，不會自動補回 aal2）", async () => {
    listMfaFactorsMock.mockResolvedValue({ ok: true, data: [{ id: "factor-1", status: "verified" }] });
    updateAdminPasswordMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup({ delay: null });
    renderView();
    await screen.findByText("已啟用");

    await user.type(getPasswordCardCurrentPasswordField(), "old-pass");
    await user.type(screen.getByLabelText(/^新密碼/), "Abc12345");
    await user.type(screen.getByLabelText(/^確認新密碼/), "Abc12345");
    await user.click(screen.getByRole("button", { name: "更新密碼" }));

    expect(
      await screen.findByText("密碼已更新，其他裝置的登入已登出；已啟用雙重驗證，請重新登入以完成驗證"),
    ).toBeInTheDocument();
  });

  it("送出中「更新密碼」按鈕停用，防止重複送出觸發第二次 updateAdminPassword 呼叫", async () => {
    let resolveUpdate!: (value: { ok: true }) => void;
    updateAdminPasswordMock.mockImplementation(() => new Promise((resolve) => { resolveUpdate = resolve; }));
    const user = userEvent.setup({ delay: null });
    renderView();

    await user.type(getPasswordCardCurrentPasswordField(), "old-pass");
    await user.type(screen.getByLabelText(/^新密碼/), "Abc12345");
    await user.type(screen.getByLabelText(/^確認新密碼/), "Abc12345");

    const submitButton = screen.getByRole("button", { name: "更新密碼" });
    await user.click(submitButton);

    await waitFor(() => expect(submitButton).toBeDisabled());
    // userEvent.click 會因為 pointer-events:none（disabled 的既有行為）拒絕互動，本身就是
    // 防重複送出生效的證據；改用 fireEvent 直接派送 click 事件，確認 React 層級的 disabled
    // 屬性同樣擋下第二次送出（比照 tests/components/login-form.test.tsx 的既有做法）。
    fireEvent.click(submitButton);
    expect(updateAdminPasswordMock).toHaveBeenCalledTimes(1);

    resolveUpdate({ ok: true });
    await waitFor(() => expect(submitButton).not.toBeDisabled());
  });
});

describe("AccountSettingsView - 登入 Email", () => {
  it("Email 未變更時「更新 Email」按鈕停用", () => {
    renderView();
    expect(screen.getByRole("button", { name: "更新 Email" })).toBeDisabled();
  });

  it("Email 格式不正確時阻擋送出，顯示行內錯誤，不呼叫 updateAdminEmail", async () => {
    const user = userEvent.setup({ delay: null });
    renderView();

    const emailField = screen.getByLabelText("目前 Email", { exact: false });
    await user.clear(emailField);
    await user.type(emailField, "not-an-email");
    await user.click(screen.getByRole("button", { name: "更新 Email" }));

    expect(await screen.findByText("Email 格式不正確")).toBeInTheDocument();
    expect(updateAdminEmailMock).not.toHaveBeenCalled();
  });

  it("目前密碼欄位為空時阻擋送出並 focus 該欄位，不呼叫 updateAdminEmail", async () => {
    const user = userEvent.setup({ delay: null });
    renderView();

    const emailField = screen.getByLabelText("目前 Email", { exact: false });
    await user.clear(emailField);
    await user.type(emailField, "new@example.com");
    await user.click(screen.getByRole("button", { name: "更新 Email" }));

    expect(updateAdminEmailMock).not.toHaveBeenCalled();
    expect(getEmailCardCurrentPasswordField()).toHaveFocus();
  });

  it("目前密碼錯誤時顯示行內錯誤，不呼叫 refresh／不顯示待確認提示", async () => {
    updateAdminEmailMock.mockResolvedValue({ ok: false, reason: "wrong_password" });
    const user = userEvent.setup({ delay: null });
    renderView();

    const emailField = screen.getByLabelText("目前 Email", { exact: false });
    await user.clear(emailField);
    await user.type(emailField, "new@example.com");
    await user.type(getEmailCardCurrentPasswordField(), "wrong-pass");
    await user.click(screen.getByRole("button", { name: "更新 Email" }));

    expect(await screen.findByText("目前密碼錯誤，請再試一次。")).toBeInTheDocument();
    expect(screen.queryByText(/已寄出確認信/)).not.toBeInTheDocument();
  });

  it("Email 只有大小寫不同時視為未變更，「更新 Email」按鈕仍停用（避免消耗寄信配額送出無效變更）", async () => {
    const user = userEvent.setup({ delay: null });
    renderView();

    const emailField = screen.getByLabelText("目前 Email", { exact: false });
    await user.clear(emailField);
    await user.type(emailField, "Designer@Example.com");

    expect(screen.getByRole("button", { name: "更新 Email" })).toBeDisabled();
  });

  it("成功送出後顯示待確認提示，內容來自 AdminProfileContext 的 refresh() 讀到的伺服器狀態，不是 updateAdminEmail 呼叫本身回傳的 pendingEmail（避免測試變成套套邏輯，見 test-engineer TASK-042 審查發現）", async () => {
    // 這兩個值刻意設成不同：updateAdminEmailMock 的 pendingEmail 是「呼叫當下」的回傳值，
    // getUserMock 的 new_email 代表「refresh() 之後從伺服器重新查到」的狀態。畫面應該顯示
    // 後者，證明元件確實是透過 context 的 refresh() 取得待確認狀態，不是直接使用
    // updateAdminEmail 呼叫結果裡的 pendingEmail（AccountSettingsView.tsx 也確實沒有讀
    // 那個欄位）。
    updateAdminEmailMock.mockResolvedValue({ ok: true, pendingEmail: "ignored-return-value@example.com" });
    getUserMock.mockResolvedValue({
      data: { user: { email: "designer@example.com", new_email: "server-state@example.com" } },
      error: null,
    });
    const user = userEvent.setup({ delay: null });
    renderView();

    const emailField = screen.getByLabelText("目前 Email", { exact: false });
    const emailPasswordField = getEmailCardCurrentPasswordField();
    await user.clear(emailField);
    await user.type(emailField, "new@example.com");
    await user.type(emailPasswordField, "old-pass");
    await user.click(screen.getByRole("button", { name: "更新 Email" }));

    expect(
      await screen.findByText(
        "已寄出確認信至 server-state@example.com，請點擊信中連結完成變更；完成前登入 email 維持原值。",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/ignored-return-value@example.com/)).not.toBeInTheDocument();
    expect(updateAdminEmailMock).toHaveBeenCalledWith(expect.anything(), "old-pass", "new@example.com");
    expect(rpcMock).toHaveBeenCalled();
    expect(getUserMock).toHaveBeenCalled();
    await waitFor(() => expect(emailField).toHaveValue("designer@example.com"));
    expect(emailPasswordField).toHaveValue("");
  });

  it("已啟用 MFA 時，Email 變更成功額外顯示 Toast 提醒需要重新登入完成驗證（TASK-045 發現：reauthenticateAdmin 會把 session 降回 aal1，不會自動補回 aal2）", async () => {
    listMfaFactorsMock.mockResolvedValue({ ok: true, data: [{ id: "factor-1", status: "verified" }] });
    updateAdminEmailMock.mockResolvedValue({ ok: true, pendingEmail: null });
    const user = userEvent.setup({ delay: null });
    renderView();
    await screen.findByText("已啟用");

    const emailField = screen.getByLabelText("目前 Email", { exact: false });
    const emailPasswordField = getEmailCardCurrentPasswordField();
    await user.clear(emailField);
    await user.type(emailField, "new@example.com");
    await user.type(emailPasswordField, "old-pass");
    await user.click(screen.getByRole("button", { name: "更新 Email" }));

    expect(
      await screen.findByText("Email 變更請求已送出；已啟用雙重驗證，請重新登入以完成驗證"),
    ).toBeInTheDocument();
  });

  it("送出失敗（非目前密碼錯誤）時顯示通用錯誤 Toast，不顯示待確認提示", async () => {
    updateAdminEmailMock.mockResolvedValue({ ok: false, reason: "internal_error" });
    const user = userEvent.setup({ delay: null });
    renderView();

    const emailField = screen.getByLabelText("目前 Email", { exact: false });
    await user.clear(emailField);
    await user.type(emailField, "new@example.com");
    await user.type(getEmailCardCurrentPasswordField(), "old-pass");
    await user.click(screen.getByRole("button", { name: "更新 Email" }));

    expect(await screen.findByText("操作失敗，請稍後再試")).toBeInTheDocument();
    expect(screen.queryByText(/已寄出確認信/)).not.toBeInTheDocument();
  });

  it("送出中「更新 Email」按鈕停用，防止重複送出觸發第二次 updateAdminEmail 呼叫", async () => {
    let resolveUpdate!: (value: { ok: true; pendingEmail: string }) => void;
    updateAdminEmailMock.mockImplementation(
      () => new Promise((resolve) => { resolveUpdate = resolve; }),
    );
    const user = userEvent.setup({ delay: null });
    renderView();

    const emailField = screen.getByLabelText("目前 Email", { exact: false });
    await user.clear(emailField);
    await user.type(emailField, "new@example.com");
    await user.type(getEmailCardCurrentPasswordField(), "old-pass");

    const submitButton = screen.getByRole("button", { name: "更新 Email" });
    await user.click(submitButton);

    await waitFor(() => expect(submitButton).toBeDisabled());
    fireEvent.click(submitButton);
    expect(updateAdminEmailMock).toHaveBeenCalledTimes(1);

    // 成功後元件會把 emailInput 重置回原本的 email，hasEmailChanges 因此變回 false，
    // 按鈕依既有邏輯（disabled={!hasEmailChanges}）會維持停用——這是正確行為（沒有變更
    // 可送出時本來就不該讓按鈕可點），不是「還在 loading」，所以這裡不斷言按鈕變回可點，
    // 只確認 resolve 後沒有拋出未處理的錯誤，且送出過程中只呼叫了一次。
    resolveUpdate({ ok: true, pendingEmail: "new@example.com" });
    await waitFor(() => expect(updateAdminEmailMock).toHaveBeenCalledTimes(1));
  });
});

// OtpInput 每一格都是獨立的受控輸入框（aria-label「驗證碼第 N 碼」），逐格填入比逐字元
// userEvent.type 更貼近元件實際的 onChange 介面，也避免依賴 jsdom 對 maxLength 截斷輸入的
// 模擬行為是否與瀏覽器一致。
function fillOtpInput(code: string) {
  const boxes = screen.getAllByLabelText(/驗證碼第 \d 碼/);
  code.split("").forEach((digit, index) => {
    fireEvent.change(boxes[index], { target: { value: digit } });
  });
}

describe("AccountSettingsView - 雙重驗證（MFA）", () => {
  it("未啟用時顯示「未啟用」徽章與啟用按鈕", async () => {
    renderView();

    expect(await screen.findByText("未啟用")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "啟用雙重驗證" })).toBeInTheDocument();
  });

  it("已啟用時（listMfaFactors 回傳 verified factor）顯示「已啟用」徽章與停用按鈕", async () => {
    listMfaFactorsMock.mockResolvedValue({ ok: true, data: [{ id: "factor-1", status: "verified" }] });
    renderView();

    expect(await screen.findByText("已啟用")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "停用雙重驗證" })).toBeInTheDocument();
  });

  it("點擊「啟用雙重驗證」呼叫 enrollMfa，顯示 QR Code／密鑰／OtpInput，確認啟用按鈕預設停用", async () => {
    enrollMfaMock.mockResolvedValue({
      ok: true,
      data: { factorId: "factor-1", qrCode: "data:image/svg+xml;...", secret: "JBSWY3DPEHPK3PXP" },
    });
    const user = userEvent.setup({ delay: null });
    renderView();

    await user.click(await screen.findByRole("button", { name: "啟用雙重驗證" }));

    expect(enrollMfaMock).toHaveBeenCalled();
    expect(await screen.findByText("JBSWY3DPEHPK3PXP")).toBeInTheDocument();
    expect(screen.getByAltText("MFA 驗證 QR Code")).toHaveAttribute("src", "data:image/svg+xml;...");
    expect(screen.getByRole("button", { name: "確認啟用" })).toBeDisabled();
  });

  it("輸入 6 碼驗證碼後點擊確認啟用成功，呼叫 verifyMfaEnrollment，卡片切回「已啟用」", async () => {
    enrollMfaMock.mockResolvedValue({
      ok: true,
      data: { factorId: "factor-1", qrCode: "data:image/svg+xml;...", secret: "JBSWY3DPEHPK3PXP" },
    });
    verifyMfaEnrollmentMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup({ delay: null });
    renderView();

    await user.click(await screen.findByRole("button", { name: "啟用雙重驗證" }));
    await screen.findByText("JBSWY3DPEHPK3PXP");
    fillOtpInput("481212");

    const confirmButton = screen.getByRole("button", { name: "確認啟用" });
    expect(confirmButton).not.toBeDisabled();
    await user.click(confirmButton);

    expect(verifyMfaEnrollmentMock).toHaveBeenCalledWith(expect.anything(), "factor-1", "481212");
    expect(await screen.findByText("雙重驗證已啟用")).toBeInTheDocument();
    expect(await screen.findByText("已啟用")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "確認啟用" })).not.toBeInTheDocument();
  });

  it("驗證碼錯誤時顯示行內錯誤，停留在註冊畫面（不呼叫 cancelMfaEnrollment）", async () => {
    enrollMfaMock.mockResolvedValue({
      ok: true,
      data: { factorId: "factor-1", qrCode: "data:image/svg+xml;...", secret: "JBSWY3DPEHPK3PXP" },
    });
    verifyMfaEnrollmentMock.mockResolvedValue({ ok: false, reason: "invalid_code" });
    const user = userEvent.setup({ delay: null });
    renderView();

    await user.click(await screen.findByRole("button", { name: "啟用雙重驗證" }));
    await screen.findByText("JBSWY3DPEHPK3PXP");
    fillOtpInput("000000");
    await user.click(screen.getByRole("button", { name: "確認啟用" }));

    expect(await screen.findByText("驗證碼錯誤，請再試一次。")).toBeInTheDocument();
    expect(screen.getByText("JBSWY3DPEHPK3PXP")).toBeInTheDocument();
    expect(cancelMfaEnrollmentMock).not.toHaveBeenCalled();
  });

  it("註冊流程中點擊「取消」呼叫 cancelMfaEnrollment 移除未驗證 factor，卡片恢復「未啟用」", async () => {
    enrollMfaMock.mockResolvedValue({
      ok: true,
      data: { factorId: "factor-1", qrCode: "data:image/svg+xml;...", secret: "JBSWY3DPEHPK3PXP" },
    });
    cancelMfaEnrollmentMock.mockResolvedValue({ ok: true, data: undefined });
    const user = userEvent.setup({ delay: null });
    renderView();

    await user.click(await screen.findByRole("button", { name: "啟用雙重驗證" }));
    await screen.findByText("JBSWY3DPEHPK3PXP");
    await user.click(screen.getByRole("button", { name: "取消" }));

    expect(cancelMfaEnrollmentMock).toHaveBeenCalledWith(expect.anything(), "factor-1");
    expect(await screen.findByRole("button", { name: "啟用雙重驗證" })).toBeInTheDocument();
    expect(screen.queryByText("JBSWY3DPEHPK3PXP")).not.toBeInTheDocument();
  });

  it("取消失敗時保留註冊畫面（不靜默回到「未啟用」，避免殘留 factor 卻沒有畫面線索）", async () => {
    enrollMfaMock.mockResolvedValue({
      ok: true,
      data: { factorId: "factor-1", qrCode: "data:image/svg+xml;...", secret: "JBSWY3DPEHPK3PXP" },
    });
    cancelMfaEnrollmentMock.mockResolvedValue({ ok: false, error: { message: "internal error" } });
    const user = userEvent.setup({ delay: null });
    renderView();

    await user.click(await screen.findByRole("button", { name: "啟用雙重驗證" }));
    await screen.findByText("JBSWY3DPEHPK3PXP");
    await user.click(screen.getByRole("button", { name: "取消" }));

    expect(await screen.findByText("取消失敗，請再試一次")).toBeInTheDocument();
    expect(screen.getByText("JBSWY3DPEHPK3PXP")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消" })).not.toBeDisabled();
  });

  it("已啟用時點擊「停用雙重驗證」開啟二次確認，密碼欄位空白時阻擋確認，不呼叫 unenrollMfaWithPasswordAndCode", async () => {
    listMfaFactorsMock.mockResolvedValue({ ok: true, data: [{ id: "factor-1", status: "verified" }] });
    const user = userEvent.setup({ delay: null });
    renderView();

    await user.click(await screen.findByRole("button", { name: "停用雙重驗證" }));
    expect(await screen.findByText("確定要停用雙重驗證？")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "確認停用" }));

    expect(await screen.findByText("請輸入目前密碼。")).toBeInTheDocument();
    expect(unenrollMfaWithPasswordAndCodeMock).not.toHaveBeenCalled();
  });

  it("密碼已填、驗證碼未滿 6 碼時阻擋確認，不呼叫 unenrollMfaWithPasswordAndCode", async () => {
    listMfaFactorsMock.mockResolvedValue({ ok: true, data: [{ id: "factor-1", status: "verified" }] });
    const user = userEvent.setup({ delay: null });
    renderView();

    await user.click(await screen.findByRole("button", { name: "停用雙重驗證" }));
    await screen.findByText("確定要停用雙重驗證？");
    await user.type(getMfaUnenrollPasswordField(), "current-pass");
    await user.click(screen.getByRole("button", { name: "確認停用" }));

    expect(await screen.findByText("請輸入 6 位數驗證碼。")).toBeInTheDocument();
    expect(unenrollMfaWithPasswordAndCodeMock).not.toHaveBeenCalled();
  });

  it("目前密碼錯誤時顯示行內錯誤，維持「已啟用」狀態，不呼叫 challenge／verify", async () => {
    listMfaFactorsMock.mockResolvedValue({ ok: true, data: [{ id: "factor-1", status: "verified" }] });
    unenrollMfaWithPasswordAndCodeMock.mockResolvedValue({ ok: false, reason: "wrong_password" });
    const user = userEvent.setup({ delay: null });
    renderView();

    await user.click(await screen.findByRole("button", { name: "停用雙重驗證" }));
    await screen.findByText("確定要停用雙重驗證？");
    await user.type(getMfaUnenrollPasswordField(), "wrong-pass");
    fillOtpInput("481212");
    await user.click(screen.getByRole("button", { name: "確認停用" }));

    expect(await screen.findByText("目前密碼錯誤，請再試一次。")).toBeInTheDocument();
    expect(screen.getAllByText("已啟用").length).toBeGreaterThan(0);
  });

  it("驗證碼錯誤時顯示行內錯誤，維持「已啟用」狀態", async () => {
    listMfaFactorsMock.mockResolvedValue({ ok: true, data: [{ id: "factor-1", status: "verified" }] });
    unenrollMfaWithPasswordAndCodeMock.mockResolvedValue({ ok: false, reason: "invalid_code" });
    const user = userEvent.setup({ delay: null });
    renderView();

    await user.click(await screen.findByRole("button", { name: "停用雙重驗證" }));
    await screen.findByText("確定要停用雙重驗證？");
    await user.type(getMfaUnenrollPasswordField(), "current-pass");
    fillOtpInput("000000");
    await user.click(screen.getByRole("button", { name: "確認停用" }));

    expect(await screen.findByText("驗證碼錯誤，請再試一次。")).toBeInTheDocument();
    expect(screen.getAllByText("已啟用").length).toBeGreaterThan(0);
  });

  it("密碼與驗證碼皆正確時呼叫 unenrollMfaWithPasswordAndCode，關閉對話框並顯示「未啟用」", async () => {
    listMfaFactorsMock.mockResolvedValue({ ok: true, data: [{ id: "factor-1", status: "verified" }] });
    unenrollMfaWithPasswordAndCodeMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup({ delay: null });
    renderView();

    await user.click(await screen.findByRole("button", { name: "停用雙重驗證" }));
    await screen.findByText("確定要停用雙重驗證？");
    await user.type(getMfaUnenrollPasswordField(), "current-pass");
    fillOtpInput("481212");
    await user.click(screen.getByRole("button", { name: "確認停用" }));

    expect(unenrollMfaWithPasswordAndCodeMock).toHaveBeenCalledWith(
      expect.anything(),
      "current-pass",
      "factor-1",
      "481212",
    );
    expect(await screen.findByText("雙重驗證已停用")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("確定要停用雙重驗證？")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "啟用雙重驗證" })).toBeInTheDocument();
  });

  it("讀取 MFA 狀態失敗時顯示錯誤與重試按鈕，不顯示可操作的啟用/停用按鈕（避免誤判目前狀態）", async () => {
    listMfaFactorsMock.mockResolvedValue({ ok: false, error: { message: "network error" } });
    renderView();

    expect(await screen.findByText("無法讀取雙重驗證狀態，請重試。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "啟用雙重驗證" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "停用雙重驗證" })).not.toBeInTheDocument();
  });

  it("讀取失敗後點擊「重試」，成功則正常顯示狀態", async () => {
    listMfaFactorsMock
      .mockResolvedValueOnce({ ok: false, error: { message: "network error" } })
      .mockResolvedValueOnce({ ok: true, data: [] });
    const user = userEvent.setup({ delay: null });
    renderView();

    await user.click(await screen.findByRole("button", { name: "重試" }));

    expect(await screen.findByRole("button", { name: "啟用雙重驗證" })).toBeInTheDocument();
    expect(listMfaFactorsMock).toHaveBeenCalledTimes(2);
  });
});
