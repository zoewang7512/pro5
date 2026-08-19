import { describe, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";
import { isAalSatisfied } from "@/lib/auth/aal";

function fakeSupabase(response: { data?: { currentLevel: string | null } | null; error?: unknown }) {
  return {
    auth: {
      mfa: {
        getAuthenticatorAssuranceLevel: vi.fn().mockResolvedValue({
          data: response.data ? { ...response.data, nextLevel: null, currentAuthenticationMethods: [] } : null,
          error: response.error ?? null,
        }),
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function throwingSupabase() {
  return {
    auth: {
      mfa: {
        getAuthenticatorAssuranceLevel: vi.fn().mockRejectedValue(new Error("解碼 session 失敗")),
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

// user 由呼叫端的 getUser() 提供，是伺服器驗證過的權威資料——只需要 factors 欄位，其餘
// User 型別必要欄位補最小假值即可。
function fakeUser(factors: Array<{ factor_type: string; status: string }>): User {
  return {
    id: "user-1",
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: "2026-01-01T00:00:00Z",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    factors: factors as any,
  } as User;
}

const noFactors = fakeUser([]);
const verifiedTotpFactor = fakeUser([{ factor_type: "totp", status: "verified" }]);
const unverifiedTotpFactor = fakeUser([{ factor_type: "totp", status: "unverified" }]);

describe("isAalSatisfied", () => {
  it("未啟用 MFA（user.factors 為空）時，aal1 即視為已滿足", async () => {
    const supabase = fakeSupabase({ data: { currentLevel: "aal1" } });
    expect(await isAalSatisfied(supabase, noFactors)).toBe(true);
  });

  it("只有 unverified 的 factor（尚未完成註冊）不算已啟用 MFA，aal1 即視為已滿足", async () => {
    const supabase = fakeSupabase({ data: { currentLevel: "aal1" } });
    expect(await isAalSatisfied(supabase, unverifiedTotpFactor)).toBe(true);
  });

  it("已啟用 MFA（verified totp factor）且 currentLevel 為 aal2 時視為已滿足", async () => {
    const supabase = fakeSupabase({ data: { currentLevel: "aal2" } });
    expect(await isAalSatisfied(supabase, verifiedTotpFactor)).toBe(true);
  });

  it("已啟用 MFA 但 currentLevel 仍為 aal1（尚未通過 TOTP 驗證）時視為未滿足", async () => {
    const supabase = fakeSupabase({ data: { currentLevel: "aal1" } });
    expect(await isAalSatisfied(supabase, verifiedTotpFactor)).toBe(false);
  });

  it("攻擊者竄改本地 cookie 讓 user.factors 看似為空，但這裡的 user 來自呼叫端 getUser() 的伺服器權威資料，不受影響——已啟用 MFA 帳號仍會被正確要求 aal2", async () => {
    // 對應 security-reviewer 發現的攻擊路徑：舊實作用 SDK 的 nextLevel（本地未驗簽
    // cookie 算出），可被竄改；新實作改吃呼叫端 getUser() 拿到的 user，這裡直接用
    // 「真實已啟用」的 user 物件呼叫，驗證不會被本地 aal 判斷的 currentLevel=aal1
    // 誤放行。
    const supabase = fakeSupabase({ data: { currentLevel: "aal1" } });
    expect(await isAalSatisfied(supabase, verifiedTotpFactor)).toBe(false);
  });

  it("呼叫 getAuthenticatorAssuranceLevel() 本身報錯時 fail closed，視為未滿足", async () => {
    const supabase = fakeSupabase({ data: null, error: { message: "boom" } });
    expect(await isAalSatisfied(supabase, noFactors)).toBe(false);
  });

  it("data 為 null 時 fail closed，視為未滿足", async () => {
    const supabase = fakeSupabase({ data: null, error: null });
    expect(await isAalSatisfied(supabase, noFactors)).toBe(false);
  });

  it("currentLevel 為 null 時 fail closed，視為未滿足（不能被誤判為已滿足）", async () => {
    const supabase = fakeSupabase({ data: { currentLevel: null } });
    expect(await isAalSatisfied(supabase, noFactors)).toBe(false);
  });

  it("呼叫本身拋出例外時 fail closed，視為未滿足（不能讓例外往上冒，否則 middleware 會變成 500 而非導向 /login，architect 審查發現）", async () => {
    const supabase = throwingSupabase();
    await expect(isAalSatisfied(supabase, noFactors)).resolves.toBe(false);
  });
});
