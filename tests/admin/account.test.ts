import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  cancelMfaEnrollment,
  enrollMfa,
  getAdminProfile,
  listMfaFactors,
  removeAdminAvatar,
  resolveAdminAvatarUrl,
  resolveAdminDisplayName,
  unenrollMfaWithPasswordAndCode,
  updateAdminEmail,
  updateAdminPassword,
  updateAdminProfile,
  uploadAdminAvatar,
  validateAdminAvatarFile,
  validateAdminDisplayName,
  validateAdminEmail,
  verifyMfaEnrollment,
} from "@/lib/admin/account";

function fakeRpcClient(result: { data: unknown; error: unknown }): SupabaseClient {
  return { rpc: vi.fn().mockResolvedValue(result) } as unknown as SupabaseClient;
}

function pngFile(name = "avatar.png", size = 1024) {
  const file = new File([new Uint8Array(size)], name, { type: "image/png" });
  return file;
}

describe("getAdminProfile", () => {
  it("有資料列時回傳對應的 displayName／avatarUrl", async () => {
    const client = fakeRpcClient({ data: [{ display_name: "Alex", avatar_url: "https://x/y.png" }], error: null });
    const result = await getAdminProfile(client);
    expect(result).toEqual({ ok: true, data: { displayName: "Alex", avatarUrl: "https://x/y.png" } });
  });

  it("空結果集（非管理員或未設定）時兩個欄位皆為 null，不是錯誤", async () => {
    const client = fakeRpcClient({ data: [], error: null });
    const result = await getAdminProfile(client);
    expect(result).toEqual({ ok: true, data: { displayName: null, avatarUrl: null } });
  });

  it("RPC 呼叫本身失敗時回傳 INTERNAL_ERROR，不外洩底層訊息", async () => {
    const client = fakeRpcClient({ data: null, error: { message: "connection refused" } });
    const result = await getAdminProfile(client);
    expect(result.ok).toBe(false);
  });
});

describe("resolveAdminAvatarUrl", () => {
  // 這裡刻意用 vi.stubEnv 固定一組假的 Supabase URL，不依賴 .env.local 是否已載入
  // （預設 `npm test` 不連線真實 Supabase，process.env.NEXT_PUBLIC_SUPABASE_URL 在這個
  // 情境下可能未設定；資料庫層的白名單邊界改由 test:services 等整合測試涵蓋）。
  const base = "https://project-ref.supabase.co";
  const validUrl = `${base}/storage/v1/object/public/admin-assets/avatar/abc.png`;

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", base);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("admin-assets bucket 底下的網址通過白名單", () => {
    expect(resolveAdminAvatarUrl(validUrl)).toBe(validUrl);
  });

  it("null 回傳 null", () => {
    expect(resolveAdminAvatarUrl(null)).toBeNull();
  });

  it("空白字串回傳 null", () => {
    expect(resolveAdminAvatarUrl("   ")).toBeNull();
  });

  it("外部網域回傳 null（即使路徑長得像合法路徑）", () => {
    expect(resolveAdminAvatarUrl(`https://evil.example.com/storage/v1/object/public/admin-assets/avatar/abc.png`)).toBeNull();
  });

  it("同網域但 bucket 名稱前綴相似（非精確匹配）回傳 null", () => {
    expect(resolveAdminAvatarUrl(`${base}/storage/v1/object/public/admin-assets-evil/avatar/abc.png`)).toBeNull();
  });

  it("同網域但走 store-assets bucket（不同 bucket）回傳 null", () => {
    expect(resolveAdminAvatarUrl(`${base}/storage/v1/object/public/store-assets/logo/abc.png`)).toBeNull();
  });

  it("非法網址字串（無法解析）回傳 null，不拋錯", () => {
    expect(resolveAdminAvatarUrl("not a url")).toBeNull();
  });

  it("javascript: 偽協定回傳 null", () => {
    expect(resolveAdminAvatarUrl("javascript:alert(1)")).toBeNull();
  });

  it("NEXT_PUBLIC_SUPABASE_URL 未設定時一律回傳 null（避免退化成字面 undefined/… 前綴誤判通過）", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect(resolveAdminAvatarUrl(validUrl)).toBeNull();
  });
});

describe("resolveAdminDisplayName", () => {
  it("有值時原樣回傳", () => {
    expect(resolveAdminDisplayName("Alex")).toBe("Alex");
  });

  it("null 時回傳預設文字「設計師」", () => {
    expect(resolveAdminDisplayName(null)).toBe("設計師");
  });

  it("純空白字串時回傳預設文字「設計師」", () => {
    expect(resolveAdminDisplayName("   ")).toBe("設計師");
  });
});

describe("validateAdminDisplayName", () => {
  it("trim 後非空、未超過 50 字時通過", () => {
    expect(validateAdminDisplayName("Alex")).toBeNull();
  });

  it("空字串或純空白時回傳必填錯誤", () => {
    expect(validateAdminDisplayName("")).toBe("顯示名稱為必填");
    expect(validateAdminDisplayName("   ")).toBe("顯示名稱為必填");
  });

  it("trim 後超過 50 字時回傳長度錯誤（與 admins_display_name_length constraint 對齊）", () => {
    expect(validateAdminDisplayName("a".repeat(51))).toBe("顯示名稱長度須在 50 字以內");
  });

  it("剛好 50 字時通過", () => {
    expect(validateAdminDisplayName("a".repeat(50))).toBeNull();
  });
});

describe("updateAdminProfile", () => {
  it("成功時（RPC 回傳 true）回傳 ok，且用 trim 前的原始參數呼叫 RPC（呼叫端負責 trim）", async () => {
    const rpcMock = vi.fn().mockResolvedValue({ data: true, error: null });
    const client = { rpc: rpcMock } as unknown as SupabaseClient;

    const result = await updateAdminProfile(client, "Alex", "https://x/avatar.png");

    expect(result).toEqual({ ok: true, data: undefined });
    expect(rpcMock).toHaveBeenCalledWith("update_admin_profile", {
      p_display_name: "Alex",
      p_avatar_url: "https://x/avatar.png",
    });
  });

  it("允許 displayName／avatarUrl 皆為 null（保留欄位既有的未設定狀態）", async () => {
    const rpcMock = vi.fn().mockResolvedValue({ data: true, error: null });
    const client = { rpc: rpcMock } as unknown as SupabaseClient;

    await updateAdminProfile(client, null, null);

    expect(rpcMock).toHaveBeenCalledWith("update_admin_profile", {
      p_display_name: null,
      p_avatar_url: null,
    });
  });

  it("RPC 回傳 false（非管理員或更新 0 筆）時回傳失敗，不外洩細節", async () => {
    const client = fakeRpcClient({ data: false, error: null });
    const result = await updateAdminProfile(client, "Alex", null);
    expect(result.ok).toBe(false);
  });

  it("RPC 呼叫本身失敗時回傳失敗，不外洩底層訊息", async () => {
    const client = fakeRpcClient({ data: null, error: { message: "connection refused" } });
    const result = await updateAdminProfile(client, "Alex", null);
    expect(result.ok).toBe(false);
  });
});

describe("validateAdminAvatarFile", () => {
  it("jpg／png／webp 且在 5MB 內時通過", () => {
    expect(validateAdminAvatarFile(pngFile("a.png", 1024))).toBeNull();
  });

  it("不允許的格式回傳錯誤", () => {
    const file = new File(["not an image"], "note.txt", { type: "text/plain" });
    expect(validateAdminAvatarFile(file)).toBe("檔案格式需為 JPG／PNG／WebP");
  });

  it("超過 5MB 回傳錯誤", () => {
    const file = pngFile("big.png", 5 * 1024 * 1024 + 1);
    expect(validateAdminAvatarFile(file)).toBe("檔案大小需小於 5MB");
  });
});

describe("uploadAdminAvatar", () => {
  function fakeStorageClient(options: {
    uploadError?: unknown;
    publicUrl?: string;
    rpcResult?: { data: unknown; error: unknown };
  }) {
    const uploadMock = vi.fn().mockResolvedValue({ error: options.uploadError ?? null });
    const getPublicUrlMock = vi.fn().mockReturnValue({ data: { publicUrl: options.publicUrl ?? "https://x/avatar/new.png" } });
    const rpcMock = vi.fn().mockResolvedValue(options.rpcResult ?? { data: true, error: null });

    const client = {
      storage: { from: vi.fn().mockReturnValue({ upload: uploadMock, getPublicUrl: getPublicUrlMock }) },
      rpc: rpcMock,
    } as unknown as SupabaseClient;

    return { client, uploadMock, rpcMock };
  }

  it("驗證失敗時直接回傳錯誤，不呼叫 storage 或 RPC", async () => {
    const { client, uploadMock, rpcMock } = fakeStorageClient({});
    const badFile = new File(["x"], "note.txt", { type: "text/plain" });

    const result = await uploadAdminAvatar(client, "Alex", badFile);

    expect(result).toEqual({ ok: false, error: { message: "檔案格式需為 JPG／PNG／WebP" } });
    expect(uploadMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("成功時上傳到 admin-assets bucket 的 avatar/ 前綴，並用目前 displayName 呼叫 update_admin_profile 保留該欄位", async () => {
    const { client, rpcMock } = fakeStorageClient({ publicUrl: "https://x/avatar/new.png" });

    const result = await uploadAdminAvatar(client, "Alex", pngFile());

    expect(result).toEqual({ ok: true, data: "https://x/avatar/new.png" });
    expect(rpcMock).toHaveBeenCalledWith("update_admin_profile", {
      p_display_name: "Alex",
      p_avatar_url: "https://x/avatar/new.png",
    });
  });

  it("Storage 上傳失敗時回傳失敗，不呼叫 RPC", async () => {
    const { client, rpcMock } = fakeStorageClient({ uploadError: { message: "network error" } });

    const result = await uploadAdminAvatar(client, "Alex", pngFile());

    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("上傳成功但 update_admin_profile 失敗時回傳失敗", async () => {
    const { client } = fakeStorageClient({ rpcResult: { data: false, error: null } });

    const result = await uploadAdminAvatar(client, "Alex", pngFile());

    expect(result.ok).toBe(false);
  });
});

describe("removeAdminAvatar", () => {
  it("呼叫 update_admin_profile 把 avatar_url 設為 null，保留目前 displayName", async () => {
    const rpcMock = vi.fn().mockResolvedValue({ data: true, error: null });
    const client = { rpc: rpcMock } as unknown as SupabaseClient;

    const result = await removeAdminAvatar(client, "Alex");

    expect(result).toEqual({ ok: true, data: undefined });
    expect(rpcMock).toHaveBeenCalledWith("update_admin_profile", {
      p_display_name: "Alex",
      p_avatar_url: null,
    });
  });
});

// updateAdminPassword／updateAdminEmail 皆先透過 supabase.auth.getUser() 現查目前登入者
// 的 email 才重新驗證（不接受呼叫端傳入 email，見 lib/admin/account.ts 的說明），所以
// fake client 一律要準備 getUser／signInWithPassword／updateUser 三支。
function fakeReauthClient(options: {
  getUserEmail?: string | null;
  reauthErrorCode?: string;
  updateError?: { code?: string; message?: string } | null;
  updateUserData?: unknown;
}) {
  const getUserMock = vi.fn().mockResolvedValue({
    data: { user: options.getUserEmail === undefined ? { email: "designer@example.com" } : options.getUserEmail ? { email: options.getUserEmail } : null },
    error: null,
  });
  const signInWithPasswordMock = vi.fn().mockResolvedValue({
    error: options.reauthErrorCode ? { code: options.reauthErrorCode, message: "reauth failed" } : null,
  });
  const updateUserMock = vi.fn().mockResolvedValue({
    error: options.updateError ?? null,
    data: options.updateUserData ?? { user: {} },
  });
  const client = {
    auth: { getUser: getUserMock, signInWithPassword: signInWithPasswordMock, updateUser: updateUserMock },
  } as unknown as SupabaseClient;
  return { client, getUserMock, signInWithPasswordMock, updateUserMock };
}

describe("updateAdminPassword", () => {
  it("目前密碼正確時，先用 getUser() 現查的 email 重新驗證身分，再呼叫 updateUser 變更密碼", async () => {
    const { client, getUserMock, signInWithPasswordMock, updateUserMock } = fakeReauthClient({});

    const result = await updateAdminPassword(client, "old-pass", "new-pass-123");

    expect(result).toEqual({ ok: true });
    expect(getUserMock).toHaveBeenCalledTimes(1);
    expect(signInWithPasswordMock).toHaveBeenCalledWith({ email: "designer@example.com", password: "old-pass" });
    expect(updateUserMock).toHaveBeenCalledWith({ password: "new-pass-123" });
  });

  it("目前密碼錯誤（invalid_credentials）時回傳 wrong_password，不呼叫 updateUser", async () => {
    const { client, updateUserMock } = fakeReauthClient({ reauthErrorCode: "invalid_credentials" });

    const result = await updateAdminPassword(client, "wrong-pass", "new-pass-123");

    expect(result).toEqual({ ok: false, reason: "wrong_password" });
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("signInWithPassword 因限流等非密碼錯誤失敗時回傳 internal_error（不誤判成目前密碼錯誤）", async () => {
    const { client, updateUserMock } = fakeReauthClient({ reauthErrorCode: "over_request_rate_limit" });

    const result = await updateAdminPassword(client, "old-pass", "new-pass-123");

    expect(result).toEqual({ ok: false, reason: "internal_error" });
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("getUser() 查不到目前登入者 email 時回傳 internal_error，不呼叫 signInWithPassword／updateUser", async () => {
    const { client, signInWithPasswordMock, updateUserMock } = fakeReauthClient({ getUserEmail: null });

    const result = await updateAdminPassword(client, "old-pass", "new-pass-123");

    expect(result).toEqual({ ok: false, reason: "internal_error" });
    expect(signInWithPasswordMock).not.toHaveBeenCalled();
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("重新驗證成功但 updateUser 回傳 weak_password 時回傳對應 reason", async () => {
    const { client } = fakeReauthClient({ updateError: { code: "weak_password", message: "weak" } });

    const result = await updateAdminPassword(client, "old-pass", "abc");

    expect(result).toEqual({ ok: false, reason: "weak_password" });
  });

  it("重新驗證成功但 updateUser 回傳 same_password 時回傳對應 reason", async () => {
    const { client } = fakeReauthClient({ updateError: { code: "same_password", message: "same" } });

    const result = await updateAdminPassword(client, "old-pass", "old-pass");

    expect(result).toEqual({ ok: false, reason: "same_password" });
  });

  it("updateUser 其他未知錯誤時回傳 internal_error", async () => {
    const { client } = fakeReauthClient({ updateError: { message: "network error" } });

    const result = await updateAdminPassword(client, "old-pass", "new-pass-123");

    expect(result).toEqual({ ok: false, reason: "internal_error" });
  });
});

describe("validateAdminEmail", () => {
  it("格式正確時通過", () => {
    expect(validateAdminEmail("designer@example.com")).toBeNull();
  });

  it("空字串時回傳必填錯誤（與顧客訂位表單的選填語意不同）", () => {
    expect(validateAdminEmail("")).toBe("Email 為必填");
    expect(validateAdminEmail("   ")).toBe("Email 為必填");
  });

  it("格式不正確時回傳格式錯誤", () => {
    expect(validateAdminEmail("not-an-email")).toBe("Email 格式不正確");
  });
});

describe("updateAdminEmail", () => {
  it("目前密碼正確時，先重新驗證身分，再呼叫 updateUser({ email }) 並回傳 pendingEmail", async () => {
    const { client, signInWithPasswordMock, updateUserMock } = fakeReauthClient({
      updateUserData: { user: { new_email: "new@example.com" } },
    });

    const result = await updateAdminEmail(client, "old-pass", "new@example.com");

    expect(result).toEqual({ ok: true, pendingEmail: "new@example.com" });
    expect(signInWithPasswordMock).toHaveBeenCalledWith({ email: "designer@example.com", password: "old-pass" });
    expect(updateUserMock).toHaveBeenCalledWith({ email: "new@example.com" });
  });

  it("目前密碼錯誤時回傳 wrong_password，不呼叫 updateUser", async () => {
    const { client, updateUserMock } = fakeReauthClient({ reauthErrorCode: "invalid_credentials" });

    const result = await updateAdminEmail(client, "wrong-pass", "new@example.com");

    expect(result).toEqual({ ok: false, reason: "wrong_password" });
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("重新驗證成功但 updateUser 失敗時回傳通用錯誤，不外洩底層訊息", async () => {
    const { client } = fakeReauthClient({ updateError: { message: "email_address_invalid" } });

    const result = await updateAdminEmail(client, "old-pass", "new@example.com");

    expect(result).toEqual({ ok: false, reason: "internal_error" });
  });

  // 與 updateAdminPassword 的對應案例重複，刻意保留：兩者共用同一個 reauthenticateAdmin
  // 私有函式，目前重複是因為呼叫端相同、無條件分支；若未來 updateAdminEmail 改成不透過
  // 共用函式（例如額外檢查新 email 是否與目前 email 相同），這裡的重複案例能立刻抓到
  // 共用邏輯掉隊的情況，不會因為兩邊測試各自簡化而悄悄漏掉（test-engineer TASK-042
  // 審查建議）。
  it("signInWithPassword 因限流等非密碼錯誤失敗時回傳 internal_error，不呼叫 updateUser", async () => {
    const { client, updateUserMock } = fakeReauthClient({ reauthErrorCode: "over_request_rate_limit" });

    const result = await updateAdminEmail(client, "old-pass", "new@example.com");

    expect(result).toEqual({ ok: false, reason: "internal_error" });
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("getUser() 查不到目前登入者 email 時回傳 internal_error，不呼叫 signInWithPassword／updateUser", async () => {
    const { client, signInWithPasswordMock, updateUserMock } = fakeReauthClient({ getUserEmail: null });

    const result = await updateAdminEmail(client, "old-pass", "new@example.com");

    expect(result).toEqual({ ok: false, reason: "internal_error" });
    expect(signInWithPasswordMock).not.toHaveBeenCalled();
    expect(updateUserMock).not.toHaveBeenCalled();
  });
});

// MFA（TASK-043）：以下皆為 supabase.auth.mfa.* 的薄封裝，fake client 只需要準備測試案例
// 實際用到的那幾支方法。

describe("listMfaFactors", () => {
  it("只回傳 totp 類型的 factor，忽略其他類型", async () => {
    const listFactorsMock = vi.fn().mockResolvedValue({
      data: {
        all: [
          { id: "totp-1", factor_type: "totp", status: "verified" },
          { id: "phone-1", factor_type: "phone", status: "verified" },
        ],
      },
      error: null,
    });
    const client = { auth: { mfa: { listFactors: listFactorsMock } } } as unknown as SupabaseClient;

    const result = await listMfaFactors(client);

    expect(result).toEqual({ ok: true, data: [{ id: "totp-1", status: "verified" }] });
  });

  it("空清單時回傳空陣列（不是錯誤）", async () => {
    const client = {
      auth: { mfa: { listFactors: vi.fn().mockResolvedValue({ data: { all: [] }, error: null }) } },
    } as unknown as SupabaseClient;

    const result = await listMfaFactors(client);

    expect(result).toEqual({ ok: true, data: [] });
  });

  it("RPC 呼叫失敗時回傳失敗，不外洩底層訊息", async () => {
    const client = {
      auth: { mfa: { listFactors: vi.fn().mockResolvedValue({ data: null, error: { message: "network error" } }) } },
    } as unknown as SupabaseClient;

    const result = await listMfaFactors(client);

    expect(result.ok).toBe(false);
  });
});

describe("enrollMfa", () => {
  // enrollMfa 內部會先呼叫 listFactors() 清除殘留的 unverified factor，再呼叫 enroll()
  // （security-reviewer TASK-043 審查發現：不清理會累積到撞上 Supabase 的裝置數量上限），
  // 所以 fake client 一律要準備 listFactors／unenroll／enroll 三支。
  function fakeEnrollClient(options: {
    existingFactors?: Array<{ id: string; factor_type: string; status: string }>;
    enrollError?: { code?: string; message?: string } | null;
  }) {
    const listFactorsMock = vi.fn().mockResolvedValue({ data: { all: options.existingFactors ?? [] }, error: null });
    const unenrollMock = vi.fn().mockResolvedValue({ error: null });
    const enrollMock = vi.fn().mockResolvedValue(
      options.enrollError
        ? { data: null, error: options.enrollError }
        : { data: { id: "factor-1", totp: { qr_code: "data:image/svg+xml;...", secret: "JBSWY3DPEHPK3PXP" } }, error: null },
    );
    const client = {
      auth: { mfa: { listFactors: listFactorsMock, unenroll: unenrollMock, enroll: enrollMock } },
    } as unknown as SupabaseClient;
    return { client, listFactorsMock, unenrollMock, enrollMock };
  }

  it("成功時回傳 factorId／qrCode／secret", async () => {
    const { client, enrollMock } = fakeEnrollClient({});

    const result = await enrollMfa(client);

    expect(result).toEqual({
      ok: true,
      data: { factorId: "factor-1", qrCode: "data:image/svg+xml;...", secret: "JBSWY3DPEHPK3PXP" },
    });
    expect(enrollMock).toHaveBeenCalledWith({ factorType: "totp" });
  });

  it("建立新 factor 前，先清除既有的 unverified factor（避免累積撞上裝置數量上限）", async () => {
    const { client, unenrollMock } = fakeEnrollClient({
      existingFactors: [
        { id: "stale-1", factor_type: "totp", status: "unverified" },
        { id: "stale-2", factor_type: "totp", status: "unverified" },
        { id: "verified-1", factor_type: "totp", status: "verified" },
      ],
    });

    await enrollMfa(client);

    expect(unenrollMock).toHaveBeenCalledWith({ factorId: "stale-1" });
    expect(unenrollMock).toHaveBeenCalledWith({ factorId: "stale-2" });
    expect(unenrollMock).not.toHaveBeenCalledWith({ factorId: "verified-1" });
    expect(unenrollMock).toHaveBeenCalledTimes(2);
  });

  it("已達裝置數量上限（too_many_enrolled_mfa_factors）時回傳專屬訊息", async () => {
    const { client } = fakeEnrollClient({ enrollError: { code: "too_many_enrolled_mfa_factors", message: "too many" } });

    const result = await enrollMfa(client);

    expect(result).toEqual({
      ok: false,
      error: { message: "已達雙重驗證裝置數量上限，請洽系統管理者協助清除既有設定。" },
    });
  });

  it("其他失敗時回傳通用失敗，不外洩底層訊息", async () => {
    const { client } = fakeEnrollClient({ enrollError: { message: "network error" } });

    const result = await enrollMfa(client);

    expect(result.ok).toBe(false);
  });
});

describe("verifyMfaEnrollment", () => {
  function fakeMfaVerifyClient(options: { challengeError?: unknown; verifyErrorCode?: string }) {
    const challengeMock = vi.fn().mockResolvedValue(
      options.challengeError
        ? { data: null, error: options.challengeError }
        : { data: { id: "challenge-1" }, error: null },
    );
    const verifyMock = vi.fn().mockResolvedValue({
      error: options.verifyErrorCode ? { code: options.verifyErrorCode, message: "verify failed" } : null,
    });
    const client = { auth: { mfa: { challenge: challengeMock, verify: verifyMock } } } as unknown as SupabaseClient;
    return { client, challengeMock, verifyMock };
  }

  it("驗證碼正確時，先 challenge() 再 verify()，回傳成功", async () => {
    const { client, challengeMock, verifyMock } = fakeMfaVerifyClient({});

    const result = await verifyMfaEnrollment(client, "factor-1", "481212");

    expect(result).toEqual({ ok: true });
    expect(challengeMock).toHaveBeenCalledWith({ factorId: "factor-1" });
    expect(verifyMock).toHaveBeenCalledWith({ factorId: "factor-1", challengeId: "challenge-1", code: "481212" });
  });

  it("驗證碼錯誤（mfa_verification_failed）時回傳 invalid_code", async () => {
    const { client } = fakeMfaVerifyClient({ verifyErrorCode: "mfa_verification_failed" });

    const result = await verifyMfaEnrollment(client, "factor-1", "000000");

    expect(result).toEqual({ ok: false, reason: "invalid_code" });
  });

  it("限流（over_request_rate_limit）時回傳 rate_limited，不誤判成驗證碼錯誤", async () => {
    const { client } = fakeMfaVerifyClient({ verifyErrorCode: "over_request_rate_limit" });

    const result = await verifyMfaEnrollment(client, "factor-1", "481212");

    expect(result).toEqual({ ok: false, reason: "rate_limited" });
  });

  it("其他驗證錯誤（例如 challenge 過期）時回傳 internal_error，不誤判成驗證碼錯誤", async () => {
    const { client } = fakeMfaVerifyClient({ verifyErrorCode: "mfa_challenge_expired" });

    const result = await verifyMfaEnrollment(client, "factor-1", "481212");

    expect(result).toEqual({ ok: false, reason: "internal_error" });
  });

  it("challenge() 本身失敗時回傳 internal_error，不呼叫 verify()", async () => {
    const { client, verifyMock } = fakeMfaVerifyClient({ challengeError: { message: "network error" } });

    const result = await verifyMfaEnrollment(client, "factor-1", "481212");

    expect(result).toEqual({ ok: false, reason: "internal_error" });
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it("challenge() 因限流失敗時回傳 rate_limited", async () => {
    const { client } = fakeMfaVerifyClient({ challengeError: { code: "over_request_rate_limit", message: "rate limited" } });

    const result = await verifyMfaEnrollment(client, "factor-1", "481212");

    expect(result).toEqual({ ok: false, reason: "rate_limited" });
  });
});

describe("cancelMfaEnrollment", () => {
  // 呼叫前必須先用 listFactors() 確認目標 factor 真的是 unverified，不能只信任呼叫端傳入
  // 的 factorId（security-reviewer TASK-043 審查發現：否則誤用一個 verified factorId 呼叫
  // 這支函式，等同零驗證移除已啟用的 MFA）。
  function fakeCancelClient(options: { factors?: Array<{ id: string; status: string }>; unenrollError?: unknown }) {
    const listFactorsMock = vi.fn().mockResolvedValue({
      data: { all: (options.factors ?? []).map((f) => ({ ...f, factor_type: "totp" })) },
      error: null,
    });
    const unenrollMock = vi.fn().mockResolvedValue({ error: options.unenrollError ?? null });
    const client = { auth: { mfa: { listFactors: listFactorsMock, unenroll: unenrollMock } } } as unknown as SupabaseClient;
    return { client, listFactorsMock, unenrollMock };
  }

  it("目標 factor 存在且為 unverified 時，呼叫 mfa.unenroll() 移除，不需要重新驗證身分", async () => {
    const { client, unenrollMock } = fakeCancelClient({ factors: [{ id: "factor-1", status: "unverified" }] });

    const result = await cancelMfaEnrollment(client, "factor-1");

    expect(result).toEqual({ ok: true, data: undefined });
    expect(unenrollMock).toHaveBeenCalledWith({ factorId: "factor-1" });
  });

  it("目標 factor 是 verified 時拒絕，不呼叫 mfa.unenroll()（防止零驗證移除已啟用的 MFA）", async () => {
    const { client, unenrollMock } = fakeCancelClient({ factors: [{ id: "factor-1", status: "verified" }] });

    const result = await cancelMfaEnrollment(client, "factor-1");

    expect(result.ok).toBe(false);
    expect(unenrollMock).not.toHaveBeenCalled();
  });

  it("找不到指定 factorId 時拒絕，不呼叫 mfa.unenroll()", async () => {
    const { client, unenrollMock } = fakeCancelClient({ factors: [{ id: "other-factor", status: "unverified" }] });

    const result = await cancelMfaEnrollment(client, "factor-1");

    expect(result.ok).toBe(false);
    expect(unenrollMock).not.toHaveBeenCalled();
  });

  it("listFactors() 失敗時回傳失敗，不呼叫 mfa.unenroll()", async () => {
    const client = {
      auth: { mfa: { listFactors: vi.fn().mockResolvedValue({ data: null, error: { message: "network error" } }), unenroll: vi.fn() } },
    } as unknown as SupabaseClient;

    const result = await cancelMfaEnrollment(client, "factor-1");

    expect(result.ok).toBe(false);
  });

  it("mfa.unenroll() 本身失敗時回傳失敗", async () => {
    const { client } = fakeCancelClient({
      factors: [{ id: "factor-1", status: "unverified" }],
      unenrollError: { message: "network error" },
    });

    const result = await cancelMfaEnrollment(client, "factor-1");

    expect(result.ok).toBe(false);
  });
});

// unenrollMfaWithPasswordAndCode：實作期對真實 Supabase 專案走查發現，mfa.unenroll() 移除
// 一個 verified factor 時要求 session 處於 aal2，純密碼重新驗證（signInWithPassword 只會
// 建立 aal1 session）永遠會被伺服器端拒絕（422 insufficient_aal），因此必須改用 TOTP
// 驗證碼升級 aal2；同時採納 security-reviewer 審查建議，額外要求「目前密碼」也要通過
// （只驗證碼等於只驗證持有物，不驗證知識）。呼叫順序：先密碼重新驗證，再
// challenge()／verify() 升級 aal2，最後才 unenroll()——見 lib/admin/account.ts 該函式的
// 完整說明。fake client 因此要準備 getUser／signInWithPassword（密碼重新驗證）＋
// challenge／verify／unenroll（MFA 相關）。
describe("unenrollMfaWithPasswordAndCode", () => {
  function fakeMfaUnenrollClient(options: {
    reauthErrorCode?: string;
    challengeError?: unknown;
    verifyErrorCode?: string;
    unenrollError?: unknown;
  }) {
    const getUserMock = vi.fn().mockResolvedValue({ data: { user: { email: "designer@example.com" } }, error: null });
    const signInWithPasswordMock = vi.fn().mockResolvedValue({
      error: options.reauthErrorCode ? { code: options.reauthErrorCode, message: "reauth failed" } : null,
    });
    const challengeMock = vi.fn().mockResolvedValue(
      options.challengeError
        ? { data: null, error: options.challengeError }
        : { data: { id: "challenge-1" }, error: null },
    );
    const verifyMock = vi.fn().mockResolvedValue({
      error: options.verifyErrorCode ? { code: options.verifyErrorCode, message: "verify failed" } : null,
    });
    const unenrollMock = vi.fn().mockResolvedValue({ error: options.unenrollError ?? null });
    const client = {
      auth: {
        getUser: getUserMock,
        signInWithPassword: signInWithPasswordMock,
        mfa: { challenge: challengeMock, verify: verifyMock, unenroll: unenrollMock },
      },
    } as unknown as SupabaseClient;
    return { client, getUserMock, signInWithPasswordMock, challengeMock, verifyMock, unenrollMock };
  }

  it("密碼與驗證碼皆正確時，先驗證密碼、再 challenge()／verify() 升級 aal2、最後才 mfa.unenroll()", async () => {
    const { client, signInWithPasswordMock, challengeMock, verifyMock, unenrollMock } = fakeMfaUnenrollClient({});

    const result = await unenrollMfaWithPasswordAndCode(client, "current-pass", "factor-1", "481212");

    expect(result).toEqual({ ok: true });
    expect(signInWithPasswordMock).toHaveBeenCalledWith({ email: "designer@example.com", password: "current-pass" });
    expect(challengeMock).toHaveBeenCalledWith({ factorId: "factor-1" });
    expect(verifyMock).toHaveBeenCalledWith({ factorId: "factor-1", challengeId: "challenge-1", code: "481212" });
    expect(unenrollMock).toHaveBeenCalledWith({ factorId: "factor-1" });
    // 呼叫順序：密碼驗證必須先於驗證碼升級 aal2（順序寫反會被 insufficient_aal 擋下）。
    const signInOrder = signInWithPasswordMock.mock.invocationCallOrder[0];
    const challengeOrder = challengeMock.mock.invocationCallOrder[0];
    expect(signInOrder).toBeLessThan(challengeOrder);
  });

  it("目前密碼錯誤時回傳 wrong_password，不呼叫 challenge()／verify()／mfa.unenroll()", async () => {
    const { client, challengeMock, unenrollMock } = fakeMfaUnenrollClient({ reauthErrorCode: "invalid_credentials" });

    const result = await unenrollMfaWithPasswordAndCode(client, "wrong-pass", "factor-1", "481212");

    expect(result).toEqual({ ok: false, reason: "wrong_password" });
    expect(challengeMock).not.toHaveBeenCalled();
    expect(unenrollMock).not.toHaveBeenCalled();
  });

  it("密碼正確但驗證碼錯誤時回傳 invalid_code，不呼叫 mfa.unenroll()（阻擋停用，維持已啟用狀態）", async () => {
    const { client, unenrollMock } = fakeMfaUnenrollClient({ verifyErrorCode: "mfa_verification_failed" });

    const result = await unenrollMfaWithPasswordAndCode(client, "current-pass", "factor-1", "000000");

    expect(result).toEqual({ ok: false, reason: "invalid_code" });
    expect(unenrollMock).not.toHaveBeenCalled();
  });

  it("驗證碼限流時回傳 rate_limited", async () => {
    const { client } = fakeMfaUnenrollClient({ verifyErrorCode: "over_request_rate_limit" });

    const result = await unenrollMfaWithPasswordAndCode(client, "current-pass", "factor-1", "481212");

    expect(result).toEqual({ ok: false, reason: "rate_limited" });
  });

  it("challenge() 本身失敗時回傳 internal_error，不呼叫 verify()／mfa.unenroll()", async () => {
    const { client, verifyMock, unenrollMock } = fakeMfaUnenrollClient({ challengeError: { message: "network error" } });

    const result = await unenrollMfaWithPasswordAndCode(client, "current-pass", "factor-1", "481212");

    expect(result).toEqual({ ok: false, reason: "internal_error" });
    expect(verifyMock).not.toHaveBeenCalled();
    expect(unenrollMock).not.toHaveBeenCalled();
  });

  it("密碼與驗證碼皆正確（aal2 升級成功）但 mfa.unenroll() 失敗時回傳 internal_error", async () => {
    const { client } = fakeMfaUnenrollClient({ unenrollError: { message: "insufficient_aal" } });

    const result = await unenrollMfaWithPasswordAndCode(client, "current-pass", "factor-1", "481212");

    expect(result).toEqual({ ok: false, reason: "internal_error" });
  });
});
