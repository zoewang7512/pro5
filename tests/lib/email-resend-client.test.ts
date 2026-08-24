import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// server-only 的 package.json 用 "react-server" resolve condition 區分伺服器/
// client 兩種 export（Next.js 建置時才會設定這個 condition），Vitest 走一般 Node
// 解析一律拿到會直接 throw 的 index.js。這裡 mock 成空模組讓測試能執行到真正要測的
// 業務邏輯——建置時的「僅限伺服器端」保護仍由 Next.js 實際建置流程把關，不受此
// 測試層級 mock 影響。
vi.mock("server-only", () => ({}));

// mock 整個 resend 套件：不需要真的打 Resend API 就能驗證參數組裝與 Result 形狀
// （test-engineer 於 TASK-051 審查認定 MUST FIX：任務卡驗收標準明訂「型別與參數
// 正確」，原本完全沒有任何自動化證據）。
const sendMock = vi.fn();
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: sendMock },
  })),
}));

describe("sendEmail", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    sendMock.mockReset();
    process.env.EMAIL_API_KEY = "re_test_key";
    process.env.EMAIL_FROM_ADDRESS = "noreply@example.invalid";
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("缺少 EMAIL_API_KEY 時直接回傳 MISSING_CONFIG，不呼叫 Resend API", async () => {
    delete process.env.EMAIL_API_KEY;
    const { sendEmail } = await import("../../lib/email/resend-client");

    const result = await sendEmail({ to: "customer@example.invalid", subject: "測試", html: "<p>內容</p>" });

    expect(result).toEqual({
      ok: false,
      error: { message: "發生未預期的錯誤，請稍後再試。", code: "MISSING_CONFIG" },
    });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("缺少 EMAIL_FROM_ADDRESS 時直接回傳 MISSING_CONFIG，不呼叫 Resend API", async () => {
    delete process.env.EMAIL_FROM_ADDRESS;
    const { sendEmail } = await import("../../lib/email/resend-client");

    const result = await sendEmail({ to: "customer@example.invalid", subject: "測試", html: "<p>內容</p>" });

    expect(result).toEqual({
      ok: false,
      error: { message: "發生未預期的錯誤，請稍後再試。", code: "MISSING_CONFIG" },
    });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("成功時正確組裝呼叫參數（from 來自環境變數而非 input），回傳 ok:true 與 id", async () => {
    sendMock.mockResolvedValue({ data: { id: "email-123" }, error: null });
    const { sendEmail } = await import("../../lib/email/resend-client");

    const result = await sendEmail({
      to: "customer@example.invalid",
      subject: "預約確認",
      html: "<p>您的預約已確認</p>",
    });

    expect(sendMock).toHaveBeenCalledWith({
      from: "noreply@example.invalid",
      to: "customer@example.invalid",
      subject: "預約確認",
      html: "<p>您的預約已確認</p>",
    });
    expect(result).toEqual({ ok: true, data: { id: "email-123" } });
  });

  it("Resend API 回傳 error 時回傳通用錯誤，不外洩原始錯誤內容（可能含收件人等個資）", async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { name: "validation_error", statusCode: 422, message: "customer@example.invalid 格式錯誤的原始訊息" },
    });
    const { sendEmail } = await import("../../lib/email/resend-client");

    const result = await sendEmail({ to: "customer@example.invalid", subject: "測試", html: "<p>內容</p>" });

    expect(result).toEqual({
      ok: false,
      error: { message: "發生未預期的錯誤，請稍後再試。", code: "SEND_FAILED" },
    });
    // 確認回傳給呼叫端的錯誤物件裡，任何欄位都不包含原始 Resend 錯誤訊息內容。
    expect(JSON.stringify(result)).not.toContain("customer@example.invalid");
  });

  it("呼叫 Resend API 拋出例外時回傳 INTERNAL_ERROR，不讓例外往外傳", async () => {
    sendMock.mockRejectedValue(new Error("network error"));
    const { sendEmail } = await import("../../lib/email/resend-client");

    const result = await sendEmail({ to: "customer@example.invalid", subject: "測試", html: "<p>內容</p>" });

    expect(result).toEqual({
      ok: false,
      error: { message: "發生未預期的錯誤，請稍後再試。", code: "INTERNAL_ERROR" },
    });
  });
});
