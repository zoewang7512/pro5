// TASK-045：對真實 Supabase 專案執行的整合測試，驗證 TASK-038（帳號設定 架構基礎）建立的
// get_admin_profile／update_admin_profile RPC 與 admin-assets Storage bucket 的權限邊界，
// 以及 Supabase Auth mfa.* API 呼叫的基本行為（TASK-043 帳號設定頁 MFA 註冊／驗證/停用背後
// 呼叫的同一組 API）。沿用 tests/store-settings.integration.test.ts 已驗證過的撰寫慣例：
// afterAll 清除失敗要 throw、非管理員帳號用獨立隨機密碼、寫入結果核對受影響列數／回傳值
// 而非只看 error 是否為 null。
//
// 不放進預設 `npm test`，只透過 `npm run test:account` 執行——這個檔案不會在其他情境下被
// 跑到，所以缺設定時直接噴錯而非略過，避免「忘了填 .env.local 卻顯示測試通過」的誤導。
//
// MFA 測試刻意不使用 designer001（唯一的正式管理員帳號）：改用 service role 建立的拋棄式
// 非管理員 authenticated 使用者測試 mfa.enroll／challenge／verify／unenroll 的呼叫行為——
// MFA factor 管理是 Supabase Auth 的 per-user 功能，不依賴 is_admin()，用拋棄式帳號一樣能
// 驗證呼叫本身正確，且完全不會干擾 designer001 當下可能正在進行的真實 MFA 手動走查（本卡
// 同時進行的另一項驗證，見任務卡「驗證計畫」）。TOTP 驗證碼用 Node.js 內建 crypto 模組
// 自行實作 RFC 6238／HMAC-SHA1（未新增任何 npm 依賴），已在 TASK-044／TASK-059 的手動走查
// 中反覆驗證正確；本檔案的真實 Authenticator App 交叉驗證由使用者另外在自己的瀏覽器對
// designer001 帳號手動走查一次（見任務卡完成證據）。
import { randomUUID, createHmac } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const designerEmail = process.env.DESIGNER_EMAIL;
const designerPassword = process.env.DESIGNER_PASSWORD;

if (!url || !anonKey || !serviceRoleKey || !designerEmail || !designerPassword) {
  throw new Error(
    "[account.integration.test] 缺少 Supabase 專案設定或 DESIGNER_EMAIL/DESIGNER_PASSWORD，" +
      "請確認 .env.local 已填妥並已執行 npm run seed:designer。",
  );
}

const TEST_MARKER = `__TEST__account-${Date.now()}`;

// RFC 6238 TOTP（HMAC-SHA1，30 秒週期，6 位數）純函式實作，無外部依賴。
function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = input.replace(/=+$/, "").toUpperCase();
  let bits = "";
  for (const char of clean) {
    const idx = alphabet.indexOf(char);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function computeTotp(secretBase32: string, offsetSteps = 0): string {
  const key = base32Decode(secretBase32);
  const counter = Math.floor(Date.now() / 1000 / 30) + offsetSteps;
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (binCode % 1_000_000).toString().padStart(6, "0");
}

type AdminProfileRow = { display_name: string | null; avatar_url: string | null };

describe("帳號設定：get_admin_profile／update_admin_profile RPC 權限邊界（真實 Supabase 專案）", () => {
  let serviceRoleClient: SupabaseClient;
  let designerClient: SupabaseClient;
  let nonAdminClient: SupabaseClient;
  let nonAdminUserId: string | undefined;
  let designerUserId: string;
  let originalSnapshot: AdminProfileRow;

  beforeAll(async () => {
    serviceRoleClient = createClient(url!, serviceRoleKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    designerClient = createClient(url!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: signInData, error: signInError } = await designerClient.auth.signInWithPassword({
      email: designerEmail!,
      password: designerPassword!,
    });
    if (signInError || !signInData.user) throw signInError ?? new Error("designer 登入失敗");
    designerUserId = signInData.user.id;

    const nonAdminEmail = `${TEST_MARKER}-nonadmin@example.invalid`;
    const nonAdminPassword = `${randomUUID()}Aa1!`;
    const { data: createdNonAdmin, error: createNonAdminError } = await serviceRoleClient.auth.admin.createUser({
      email: nonAdminEmail,
      password: nonAdminPassword,
      email_confirm: true,
    });
    if (createNonAdminError) throw createNonAdminError;
    nonAdminUserId = createdNonAdmin.user.id;

    nonAdminClient = createClient(url!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: nonAdminSignInError } = await nonAdminClient.auth.signInWithPassword({
      email: nonAdminEmail,
      password: nonAdminPassword,
    });
    if (nonAdminSignInError) throw nonAdminSignInError;

    const { data: snapshot, error: snapshotError } = await serviceRoleClient
      .from("admins")
      .select("display_name, avatar_url")
      .eq("user_id", designerUserId)
      .single();
    if (snapshotError) throw snapshotError;
    originalSnapshot = snapshot as AdminProfileRow;
    console.log(`[account.integration.test] 原始 admins 個人資料快照（供中斷後人工還原用）：${JSON.stringify(originalSnapshot)}`);
  });

  afterAll(async () => {
    const cleanupErrors: unknown[] = [];

    try {
      await designerClient.auth.signOut();
      await nonAdminClient.auth.signOut();
    } catch (signOutError) {
      cleanupErrors.push(signOutError);
    }

    if (nonAdminUserId) {
      const { error: deleteNonAdminError } = await serviceRoleClient.auth.admin.deleteUser(nonAdminUserId);
      if (deleteNonAdminError) cleanupErrors.push(deleteNonAdminError);
    }

    if (originalSnapshot) {
      const { data: restored, error: restoreError } = await serviceRoleClient
        .from("admins")
        .update({ display_name: originalSnapshot.display_name, avatar_url: originalSnapshot.avatar_url })
        .eq("user_id", designerUserId)
        .select("user_id");
      if (restoreError || !restored || restored.length !== 1) {
        cleanupErrors.push(restoreError ?? new Error("admins 個人資料還原受影響列數與快照不符"));
      }
    }

    if (cleanupErrors.length > 0) {
      const messages = cleanupErrors.map((e) => (e instanceof Error ? e.message : JSON.stringify(e)));
      throw new Error(`[account.integration.test] afterAll 清除失敗，測試資料可能未被還原乾淨：${JSON.stringify(messages)}`);
    }
  });

  it("designer 可以讀取自己的個人資料", async () => {
    const { data, error } = await designerClient.rpc("get_admin_profile");
    expect(error).toBeNull();
    expect(Array.isArray(data) ? data.length : 0).toBeGreaterThan(0);
  });

  it("designer 可以更新自己的個人資料，寫入立即可讀回", async () => {
    const { data: updateOk, error: updateError } = await designerClient.rpc("update_admin_profile", {
      p_display_name: `${TEST_MARKER}-designer`,
      p_avatar_url: null,
    });
    expect(updateError).toBeNull();
    expect(updateOk).toBe(true);

    const { data: readBack } = await designerClient.rpc("get_admin_profile");
    const row = Array.isArray(readBack) ? readBack[0] : readBack;
    expect(row?.display_name).toBe(`${TEST_MARKER}-designer`);
  });

  it("update_admin_profile 對超過長度上限（50 字）的顯示名稱回傳 false，不寫入", async () => {
    const tooLong = "a".repeat(51);
    const { data: updateOk, error } = await designerClient.rpc("update_admin_profile", {
      p_display_name: tooLong,
      p_avatar_url: null,
    });
    expect(error).toBeNull();
    expect(updateOk).toBe(false);

    const { data: readBack } = await designerClient.rpc("get_admin_profile");
    const row = Array.isArray(readBack) ? readBack[0] : readBack;
    expect(row?.display_name).not.toBe(tooLong);
  });

  it("非管理員（已登入但不在 admins 表）呼叫 get_admin_profile 回傳空結果集，不報錯、不洩漏內部狀態", async () => {
    const { data, error } = await nonAdminClient.rpc("get_admin_profile");
    expect(error).toBeNull();
    expect(Array.isArray(data) ? data.length : 0).toBe(0);
  });

  it("非管理員呼叫 update_admin_profile 回傳 false，不影響 designer 自己的資料", async () => {
    const { data: updateOk, error } = await nonAdminClient.rpc("update_admin_profile", {
      p_display_name: `${TEST_MARKER}-nonadmin-should-fail`,
      p_avatar_url: null,
    });
    expect(error).toBeNull();
    expect(updateOk).toBe(false);

    const { data: designerProfile } = await serviceRoleClient
      .from("admins")
      .select("display_name")
      .eq("user_id", designerUserId)
      .single();
    expect(designerProfile?.display_name).not.toBe(`${TEST_MARKER}-nonadmin-should-fail`);
  });

  it("anon（無 session）呼叫 get_admin_profile／update_admin_profile 皆被拒絕（明確 revoke，非只靠 RLS）", async () => {
    const anonClient = createClient(url!, anonKey!, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error: getError } = await anonClient.rpc("get_admin_profile");
    expect(getError).not.toBeNull();

    const { error: updateError } = await anonClient.rpc("update_admin_profile", {
      p_display_name: "should-fail",
      p_avatar_url: null,
    });
    expect(updateError).not.toBeNull();
  });
});

describe("帳號設定：admin-assets Storage bucket 權限邊界（真實 Supabase 專案）", () => {
  let serviceRoleClient: SupabaseClient;
  let anonClient: SupabaseClient;
  let designerClient: SupabaseClient;
  let nonAdminClient: SupabaseClient;
  let nonAdminUserId: string | undefined;
  const uploadedObjectPaths: string[] = [];
  const testFileContent = Buffer.from("fake-avatar-bytes-for-integration-test");

  beforeAll(async () => {
    serviceRoleClient = createClient(url!, serviceRoleKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    anonClient = createClient(url!, anonKey!, { auth: { autoRefreshToken: false, persistSession: false } });
    designerClient = createClient(url!, anonKey!, { auth: { autoRefreshToken: false, persistSession: false } });

    const { error: signInError } = await designerClient.auth.signInWithPassword({
      email: designerEmail!,
      password: designerPassword!,
    });
    if (signInError) throw signInError;

    const nonAdminEmail = `${TEST_MARKER}-storage-nonadmin@example.invalid`;
    const nonAdminPassword = `${randomUUID()}Aa1!`;
    const { data: createdNonAdmin, error: createNonAdminError } = await serviceRoleClient.auth.admin.createUser({
      email: nonAdminEmail,
      password: nonAdminPassword,
      email_confirm: true,
    });
    if (createNonAdminError) throw createNonAdminError;
    nonAdminUserId = createdNonAdmin.user.id;

    nonAdminClient = createClient(url!, anonKey!, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error: nonAdminSignInError } = await nonAdminClient.auth.signInWithPassword({
      email: nonAdminEmail,
      password: nonAdminPassword,
    });
    if (nonAdminSignInError) throw nonAdminSignInError;
  });

  afterAll(async () => {
    const cleanupErrors: unknown[] = [];

    try {
      await designerClient.auth.signOut();
      await nonAdminClient.auth.signOut();
    } catch (signOutError) {
      cleanupErrors.push(signOutError);
    }

    if (nonAdminUserId) {
      const { error: deleteNonAdminError } = await serviceRoleClient.auth.admin.deleteUser(nonAdminUserId);
      if (deleteNonAdminError) cleanupErrors.push(deleteNonAdminError);
    }

    if (uploadedObjectPaths.length > 0) {
      const { error: removeError } = await serviceRoleClient.storage.from("admin-assets").remove(uploadedObjectPaths);
      if (removeError) cleanupErrors.push(removeError);
    }

    if (cleanupErrors.length > 0) {
      const messages = cleanupErrors.map((e) => (e instanceof Error ? e.message : JSON.stringify(e)));
      throw new Error(`[account.integration.test] afterAll 清除失敗，測試資料可能未被還原乾淨：${JSON.stringify(messages)}`);
    }
  });

  it("anon 無法上傳至 admin-assets", async () => {
    const path = `avatar/${TEST_MARKER}-anon-should-fail.png`;
    const { error } = await anonClient.storage.from("admin-assets").upload(path, testFileContent, {
      contentType: "image/png",
    });
    expect(error).not.toBeNull();
  });

  it("已登入但非 is_admin() 的 authenticated 使用者無法上傳至 admin-assets", async () => {
    const path = `avatar/${TEST_MARKER}-nonadmin-should-fail.png`;
    const { error } = await nonAdminClient.storage.from("admin-assets").upload(path, testFileContent, {
      contentType: "image/png",
    });
    expect(error).not.toBeNull();
  });

  it("designer（is_admin()）可以上傳至 admin-assets，且上傳後可被公開（未驗證）讀取", async () => {
    const path = `avatar/${TEST_MARKER}-designer-upload.png`;
    const { error: uploadError } = await designerClient.storage.from("admin-assets").upload(path, testFileContent, {
      contentType: "image/png",
    });
    expect(uploadError).toBeNull();
    uploadedObjectPaths.push(path);

    const { data: publicUrlData } = designerClient.storage.from("admin-assets").getPublicUrl(path);
    const response = await fetch(publicUrlData.publicUrl);
    expect(response.ok).toBe(true);
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.equals(testFileContent)).toBe(true);
  });

  it("designer 上傳不在 allowed_mime_types 白名單內的格式（text/plain）會被 bucket 層擋下", async () => {
    const path = `avatar/${TEST_MARKER}-wrong-mime.txt`;
    const { error } = await designerClient.storage.from("admin-assets").upload(path, Buffer.from("not an image"), {
      contentType: "text/plain",
    });
    expect(error).not.toBeNull();
  });

  it("designer 上傳到 avatar/ 以外的路徑前綴會被拒絕", async () => {
    const path = `other/${TEST_MARKER}-wrong-prefix.png`;
    const { error } = await designerClient.storage.from("admin-assets").upload(path, testFileContent, {
      contentType: "image/png",
    });
    expect(error).not.toBeNull();
  });

  it("anon 無法列出 admin-assets 底下的物件", async () => {
    const { data, error } = await anonClient.storage.from("admin-assets").list("avatar");
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });
});

describe("帳號設定：MFA（mfa.enroll／challenge／verify／unenroll）呼叫行為（真實 Supabase 專案，拋棄式使用者）", () => {
  let serviceRoleClient: SupabaseClient;
  let throwawayClient: SupabaseClient;
  let throwawayUserId: string | undefined;
  let enrolledFactorId: string | undefined;
  let enrolledSecret: string | undefined;
  let throwawayEmail: string;
  let throwawayPassword: string;

  beforeAll(async () => {
    serviceRoleClient = createClient(url!, serviceRoleKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 刻意不用 designer001：MFA factor 管理是 per-user 功能、不依賴 is_admin()，用拋棄式
    // authenticated 使用者一樣能驗證 mfa.* API 呼叫本身正確，且完全不干擾 designer001
    // 當下可能正在進行的真實 Authenticator App 手動走查（見本檔案檔頭說明）。
    throwawayEmail = `${TEST_MARKER}-mfa@example.invalid`;
    throwawayPassword = `${randomUUID()}Aa1!`;
    const { data: created, error: createError } = await serviceRoleClient.auth.admin.createUser({
      email: throwawayEmail,
      password: throwawayPassword,
      email_confirm: true,
    });
    if (createError) throw createError;
    throwawayUserId = created.user.id;

    throwawayClient = createClient(url!, anonKey!, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error: signInError } = await throwawayClient.auth.signInWithPassword({
      email: throwawayEmail,
      password: throwawayPassword,
    });
    if (signInError) throw signInError;
  });

  afterAll(async () => {
    const cleanupErrors: unknown[] = [];

    try {
      await throwawayClient.auth.signOut();
    } catch (signOutError) {
      cleanupErrors.push(signOutError);
    }

    // 不論測試中途 factor 是 verified 或 unverified、有沒有成功 unenroll，直接刪除整個
    // 拋棄式使用者即可一併清乾淨所有殘留 factor，不需要逐一 unenroll（比照本檔案其他
    // describe 區塊「刪除拋棄式使用者」的既有清理慣例）。
    if (throwawayUserId) {
      const { error: deleteError } = await serviceRoleClient.auth.admin.deleteUser(throwawayUserId);
      if (deleteError) cleanupErrors.push(deleteError);
    }

    if (cleanupErrors.length > 0) {
      const messages = cleanupErrors.map((e) => (e instanceof Error ? e.message : JSON.stringify(e)));
      throw new Error(`[account.integration.test] MFA afterAll 清除失敗：${JSON.stringify(messages)}`);
    }
  });

  it("mfa.enroll 回傳 unverified factor，含 QR code 與可手動輸入的密鑰", async () => {
    const { data, error } = await throwawayClient.auth.mfa.enroll({ factorType: "totp" });
    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();
    expect(data?.totp.qr_code).toBeTruthy();
    expect(data?.totp.secret).toBeTruthy();
    enrolledFactorId = data?.id;
    enrolledSecret = data?.totp.secret;
  });

  it("用錯誤的驗證碼呼叫 challenge／verify 會被拒絕，factor 仍為 unverified", async () => {
    if (!enrolledFactorId) throw new Error("前一個案例的 enroll 未成功，無法繼續");
    const { data: challenge, error: challengeError } = await throwawayClient.auth.mfa.challenge({
      factorId: enrolledFactorId,
    });
    expect(challengeError).toBeNull();

    const { error: verifyError } = await throwawayClient.auth.mfa.verify({
      factorId: enrolledFactorId,
      challengeId: challenge!.id,
      code: "000000",
    });
    expect(verifyError).not.toBeNull();
    expect(verifyError?.code).toBe("mfa_verification_failed");

    const { data: factorsAfter } = await throwawayClient.auth.mfa.listFactors();
    const factor = factorsAfter?.all.find((f) => f.id === enrolledFactorId);
    expect(factor?.status).toBe("unverified");
  });

  it("用本機以 RFC 6238 算出的正確驗證碼呼叫 challenge／verify 會成功，factor 轉為 verified（同時把目前 session 升級到 aal2——GoTrue 既有行為）", async () => {
    if (!enrolledFactorId || !enrolledSecret) throw new Error("前一個案例的 enroll 未成功，無法繼續");
    const code = computeTotp(enrolledSecret);
    const { data: challenge, error: challengeError } = await throwawayClient.auth.mfa.challenge({
      factorId: enrolledFactorId,
    });
    expect(challengeError).toBeNull();

    const { error: verifyError } = await throwawayClient.auth.mfa.verify({
      factorId: enrolledFactorId,
      challengeId: challenge!.id,
      code,
    });
    expect(verifyError).toBeNull();

    const { data: factorsAfter } = await throwawayClient.auth.mfa.listFactors();
    const verifiedFactor = factorsAfter?.all.find((f) => f.id === enrolledFactorId);
    expect(verifiedFactor?.status).toBe("verified");
  });

  it("verified factor 需要 aal2 才能 unenroll——重新用帳密登入取得的全新 session（aal1，尚未走 challenge/verify）呼叫 unenroll 會被 GoTrue 拒絕（422 insufficient_aal），對應 TASK-043 完成證據記錄的既有行為", async () => {
    if (!enrolledFactorId) throw new Error("前面案例未成功建立 verified factor，無法繼續");
    // 用同一個帳密重新登入，刻意取得一個「還沒走過 challenge/verify」的全新 aal1
    // session——不能沿用上一個案例已經因為 verify() 成功而被升級到 aal2 的
    // throwawayClient，那樣測不出「aal1 session 不能 unenroll」這個邊界（比照
    // lib/admin/account.ts unenrollMfaWithPasswordAndCode 的既有說明：signInWithPassword
        // 會核發一組全新的 aal1 session）。
    const freshAal1Client = createClient(url!, anonKey!, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error: signInError } = await freshAal1Client.auth.signInWithPassword({
      email: throwawayEmail,
      password: throwawayPassword,
    });
    if (signInError) throw signInError;

    const aal = await freshAal1Client.auth.mfa.getAuthenticatorAssuranceLevel();
    expect(aal.data?.currentLevel).toBe("aal1");
    expect(aal.data?.nextLevel).toBe("aal2");

    const { error } = await freshAal1Client.auth.mfa.unenroll({ factorId: enrolledFactorId });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("insufficient_aal");

    await freshAal1Client.auth.signOut();
  });

  it("升級到 aal2（用正確驗證碼再次 challenge／verify）後，unenroll 該 factor 會成功", async () => {
    if (!enrolledFactorId || !enrolledSecret) throw new Error("前面案例未成功建立 verified factor，無法繼續");
    const stepUpClient = createClient(url!, anonKey!, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error: signInError } = await stepUpClient.auth.signInWithPassword({
      email: throwawayEmail,
      password: throwawayPassword,
    });
    if (signInError) throw signInError;

    const code = computeTotp(enrolledSecret);
    const { data: challenge, error: challengeError } = await stepUpClient.auth.mfa.challenge({
      factorId: enrolledFactorId,
    });
    expect(challengeError).toBeNull();
    const { error: verifyError } = await stepUpClient.auth.mfa.verify({
      factorId: enrolledFactorId,
      challengeId: challenge!.id,
      code,
    });
    expect(verifyError).toBeNull();

    const { error: unenrollError } = await stepUpClient.auth.mfa.unenroll({ factorId: enrolledFactorId });
    expect(unenrollError).toBeNull();
    enrolledFactorId = undefined;

    await stepUpClient.auth.signOut();
  });
});
