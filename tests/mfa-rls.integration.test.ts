// TASK-079：對真實 Supabase 專案執行的整合測試，驗證 0016_is_admin_require_aal2.sql——
// 已啟用 MFA（有 verified factor）的管理員，只有 aal2 session 的 is_admin() 才為 true，
// aal1（只輸入帳密）直接呼叫 PostgREST／RPC／Storage 一律被拒絕。
//
// 不使用 designer001（唯一的正式管理員，且目前未啟用 MFA）：改用 service role 建立的拋棄式
// 帳號，並暫時加入 admins 表。**風險**：測試期間正式資料庫會短暫存在額外的管理員帳號
// （隨機密碼，只有本測試程式持有；其中 plain-admin 沒有 MFA、aal1 即具管理員權限）。
// afterAll 一定會先刪資料、再刪 admins 列、最後刪使用者；若測試被強制中斷導致清除沒跑到，
// 下一次執行的 beforeAll 會先自動掃除前次殘留，也可手動清除：
//   1. Supabase SQL Editor：delete from public.admins where user_id in ('<beforeAll 印出的 id>');
//   2. Authentication → Users 刪除 email 以 `__TEST__mfa-rls-` 開頭、結尾 @example.invalid 的帳號
//      （admins.user_id 有 on delete cascade，直接刪使用者也會一併移除 admins 列）。
//   3. appointments 表刪除 customer_name 以 `__TEST__mfa-rls-` 開頭的列（要先於步驟 4）。
//   4. services 表刪除 name 以 `__TEST__mfa-rls-` 開頭的列。
//   5. Storage → admin-assets → avatar/ 刪除檔名以 `__TEST__mfa-rls-` 開頭的檔案。
//   （SQL 的 like 要把底線跳脫：like '\_\_TEST\_\_mfa-rls-%' escape '\'）
//
// TOTP 驗證碼用 Node.js 內建 crypto 自行實作 RFC 6238（與 tests/account.integration.test.ts
// 相同寫法，未新增 npm 依賴）。Supabase 不接受同一個 factor 重複使用同一個時間窗的驗證碼，
// 所以以「絕對 counter」記錄用過的時間窗，並讓每個帳號全檔只做最少次數的 TOTP 驗證
// （mfa-admin 2 次、mfa-nonadmin 1 次），其餘測試共用已建立好的 aal2 session。
// 若連續重跑時因 TOTP 重用或限流失敗，等 30 秒再試。
//
// appointments 的測試資料刻意不帶 customer_email：0011 的 insert webhook trigger 只在
// customer_email 非 null 時觸發，避免測試打到正式環境寄信。
//
// 不放進預設 `npm test`，只透過 `npm run test:mfa-rls` 執行；缺設定時直接噴錯而非略過。
import { randomUUID, createHmac } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceRoleKey) {
  throw new Error(
    "[mfa-rls.integration.test] 缺少 Supabase 專案設定，請確認 .env.local 已填妥 " +
      "NEXT_PUBLIC_SUPABASE_URL／NEXT_PUBLIC_SUPABASE_ANON_KEY／SUPABASE_SERVICE_ROLE_KEY。",
  );
}

const MARKER_PREFIX = "__TEST__mfa-rls-";
const TEST_MARKER = `${MARKER_PREFIX}${Date.now()}`;

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

function computeTotpForCounter(secretBase32: string, counter: number): string {
  const key = base32Decode(secretBase32);
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

const clientOptions = { auth: { autoRefreshToken: false, persistSession: false } };

type TestUser = { id: string; email: string; password: string };

describe("資料庫層強制 MFA：is_admin() 對已啟用 MFA 的帳號要求 aal2（真實 Supabase 專案）", () => {
  let serviceRoleClient: SupabaseClient;
  const createdUserIds: string[] = [];
  const adminUserIds: string[] = [];
  const uploadedObjectPaths: string[] = [];
  let serviceId: string | undefined;
  let appointmentId: string | undefined;

  let mfaAdmin: TestUser;
  let plainAdmin: TestUser;
  let mfaNonAdmin: TestUser;
  let mfaAdminFactorId: string;
  let mfaNonAdminFactorId: string;
  // 全檔共用的 aal2 session（避免每個 it 都消耗一次 TOTP 時間窗）。
  let mfaAdminAal2: SupabaseClient;
  let mfaNonAdminAal2: SupabaseClient;
  const serviceOriginalName = `${TEST_MARKER}-service`;
  // 已用過的 TOTP 絕對 counter（key = factorId:counter）。
  const usedCounters = new Set<string>();

  // 清除前次中斷後殘留的拋棄式測試資料（只動 MARKER_PREFIX 開頭的資料）。
  async function sweepLeftovers() {
    const { data: usersPage } = await serviceRoleClient.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const leftoverUsers = (usersPage?.users ?? []).filter(
      (u) => u.email?.startsWith(MARKER_PREFIX) && u.email.endsWith("@example.invalid"),
    );
    await serviceRoleClient.from("appointments").delete().like("customer_name", `${MARKER_PREFIX}%`);
    await serviceRoleClient.from("services").delete().like("name", `${MARKER_PREFIX}%`);
    const { data: objects } = await serviceRoleClient.storage.from("admin-assets").list("avatar", { limit: 1000 });
    const leftoverPaths = (objects ?? []).filter((o) => o.name.startsWith(MARKER_PREFIX)).map((o) => `avatar/${o.name}`);
    if (leftoverPaths.length > 0) await serviceRoleClient.storage.from("admin-assets").remove(leftoverPaths);
    for (const u of leftoverUsers) {
      await serviceRoleClient.from("admins").delete().eq("user_id", u.id);
      await serviceRoleClient.auth.admin.deleteUser(u.id);
    }
    if (leftoverUsers.length > 0) {
      console.log(`[mfa-rls.integration.test] 已掃除前次殘留的測試使用者 ${leftoverUsers.length} 位`);
    }
  }

  async function createUser(label: string): Promise<TestUser> {
    const email = `${TEST_MARKER}-${label}@example.invalid`;
    const password = `${randomUUID()}Aa1!`;
    const { data, error } = await serviceRoleClient.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) throw error ?? new Error(`建立測試使用者 ${label} 失敗`);
    createdUserIds.push(data.user.id);
    console.log(`[mfa-rls.integration.test] 建立拋棄式測試使用者 ${label}：${data.user.id}（供中斷後人工清除用）`);
    return { id: data.user.id, email, password };
  }

  async function addToAdmins(user: TestUser) {
    const { error } = await serviceRoleClient.from("admins").insert({ user_id: user.id });
    if (error) throw error;
    adminUserIds.push(user.id);
  }

  async function signIn(user: TestUser): Promise<SupabaseClient> {
    const client = createClient(url!, anonKey!, clientOptions);
    const { error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
    if (error) throw error;
    return client;
  }

  // 對指定 factor 做 challenge＋verify，挑尚未用過的絕對 counter；成功後該 client 的 session 為 aal2。
  async function verifyTotp(client: SupabaseClient, factorId: string, secret: string) {
    const baseCounter = Math.floor(Date.now() / 1000 / 30);
    let lastError: unknown;
    for (const offset of [0, 1, -1]) {
      const counter = baseCounter + offset;
      const key = `${factorId}:${counter}`;
      if (usedCounters.has(key)) continue;
      const { data: challenge, error: challengeError } = await client.auth.mfa.challenge({ factorId });
      if (challengeError || !challenge) throw challengeError ?? new Error("mfa.challenge 失敗");
      usedCounters.add(key);
      const { error: verifyError } = await client.auth.mfa.verify({
        factorId,
        challengeId: challenge.id,
        code: computeTotpForCounter(secret, counter),
      });
      if (!verifyError) return;
      lastError = verifyError;
    }
    throw lastError ?? new Error("所有 TOTP 時間窗皆已用過或驗證失敗");
  }

  // 註冊並驗證 TOTP factor；回傳 factor 資訊與（verify 後已升級為 aal2 的）註冊用 client。
  async function enrollAndVerify(user: TestUser) {
    const client = await signIn(user);
    const { data, error } = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: TEST_MARKER });
    if (error || !data) throw error ?? new Error("mfa.enroll 失敗");
    const factorId = data.id;
    const secret = data.totp.secret;
    await verifyTotp(client, factorId, secret);
    return { factorId, secret, client };
  }

  async function aal1Session(user: TestUser) {
    const client = await signIn(user);
    const { data } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    expect(data?.currentLevel).toBe("aal1");
    return client;
  }

  async function expectAal2(client: SupabaseClient) {
    const { data } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    expect(data?.currentLevel).toBe("aal2");
  }

  async function adminAssetsExists(path: string): Promise<boolean> {
    const slash = path.lastIndexOf("/");
    const folder = path.slice(0, slash);
    const name = path.slice(slash + 1);
    const { data, error } = await serviceRoleClient.storage.from("admin-assets").list(folder, { search: name });
    if (error) throw error;
    return (data ?? []).some((o) => o.name === name);
  }

  beforeAll(async () => {
    serviceRoleClient = createClient(url!, serviceRoleKey!, clientOptions);
    await sweepLeftovers();

    mfaAdmin = await createUser("mfa-admin");
    plainAdmin = await createUser("plain-admin");
    mfaNonAdmin = await createUser("mfa-nonadmin");
    await addToAdmins(mfaAdmin);
    await addToAdmins(plainAdmin);

    // mfa-admin：註冊＋驗證 factor（TOTP 第 1 次），再走一次「帳密登入 → TOTP」取得共用 aal2 session（第 2 次）。
    const adminEnroll = await enrollAndVerify(mfaAdmin);
    mfaAdminFactorId = adminEnroll.factorId;
    mfaAdminAal2 = await signIn(mfaAdmin);
    await verifyTotp(mfaAdminAal2, mfaAdminFactorId, adminEnroll.secret);

    // mfa-nonadmin：註冊用 client 在 verify 後即為 aal2，直接共用。
    const nonAdminEnroll = await enrollAndVerify(mfaNonAdmin);
    mfaNonAdminFactorId = nonAdminEnroll.factorId;
    mfaNonAdminAal2 = nonAdminEnroll.client;

    const { data: service, error: serviceError } = await serviceRoleClient
      .from("services")
      .insert({ name: serviceOriginalName, price: 100, duration_minutes: 30, is_active: false })
      .select("id")
      .single();
    if (serviceError || !service) throw serviceError ?? new Error("建立測試服務項目失敗");
    serviceId = service.id;

    // customer_email 刻意留 null（見檔頭說明），日期放在遙遠的未來避免與真實預約的 exclusion constraint 衝突。
    const { data: appointment, error: appointmentError } = await serviceRoleClient
      .from("appointments")
      .insert({
        service_id: serviceId,
        customer_name: `${TEST_MARKER}-customer`,
        start_at: "2099-01-01T10:00:00Z",
        end_at: "2099-01-01T10:30:00Z",
      })
      .select("id")
      .single();
    if (appointmentError || !appointment) throw appointmentError ?? new Error("建立測試預約失敗");
    appointmentId = appointment.id;
  }, 90000);

  afterAll(async () => {
    const cleanupErrors: unknown[] = [];

    if (uploadedObjectPaths.length > 0) {
      const { error } = await serviceRoleClient.storage.from("admin-assets").remove(uploadedObjectPaths);
      if (error) cleanupErrors.push(error);
    }

    if (appointmentId) {
      const { error } = await serviceRoleClient.from("appointments").delete().eq("id", appointmentId);
      if (error) cleanupErrors.push(error);
    }

    if (serviceId) {
      const { error } = await serviceRoleClient.from("services").delete().eq("id", serviceId);
      if (error) cleanupErrors.push(error);
    }

    // 先刪 admins 列，確認管理員身分已移除，再刪使用者。
    if (adminUserIds.length > 0) {
      const { error } = await serviceRoleClient.from("admins").delete().in("user_id", adminUserIds);
      if (error) cleanupErrors.push(error);
    }

    for (const id of createdUserIds) {
      const { error } = await serviceRoleClient.auth.admin.deleteUser(id);
      if (error) cleanupErrors.push(error);
    }

    if (adminUserIds.length > 0) {
      const { data: leftover, error } = await serviceRoleClient
        .from("admins")
        .select("user_id")
        .in("user_id", adminUserIds);
      if (error) cleanupErrors.push(error);
      else if (leftover && leftover.length > 0) cleanupErrors.push(new Error("admins 仍殘留拋棄式測試管理員"));
    }

    if (cleanupErrors.length > 0) {
      const messages = cleanupErrors.map((e) => (e instanceof Error ? e.message : JSON.stringify(e)));
      throw new Error(
        `[mfa-rls.integration.test] afterAll 清除失敗，正式資料庫可能殘留測試管理員，請依檔案開頭說明手動清除：${JSON.stringify(messages)}`,
      );
    }
  }, 60000);

  describe("情境 1：沒有 verified factor 的管理員，行為與原本相同", () => {
    it("aal1 session 的 is_admin() 為 true", async () => {
      const client = await aal1Session(plainAdmin);
      const { data, error } = await client.rpc("is_admin");
      expect(error).toBeNull();
      expect(data).toBe(true);
    });

    it("aal1 session 可讀寫自己的個人資料（get_admin_profile／update_admin_profile）", async () => {
      const client = await aal1Session(plainAdmin);
      const { data: ok, error: updateError } = await client.rpc("update_admin_profile", {
        p_display_name: `${TEST_MARKER}-plain`,
        p_avatar_url: null,
      });
      expect(updateError).toBeNull();
      expect(ok).toBe(true);

      const { data: profile, error: profileError } = await client.rpc("get_admin_profile");
      expect(profileError).toBeNull();
      expect(profile).toHaveLength(1);
      expect(profile[0].display_name).toBe(`${TEST_MARKER}-plain`);
    });

    it("註冊中（unverified）的 factor 不算已啟用 MFA：is_admin() 仍為 true", async () => {
      const client = await aal1Session(plainAdmin);
      const { data: enrolled, error: enrollError } = await client.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `${TEST_MARKER}-unverified`,
      });
      expect(enrollError).toBeNull();
      try {
        const { data, error } = await client.rpc("is_admin");
        expect(error).toBeNull();
        expect(data).toBe(true);
      } finally {
        if (enrolled) await client.auth.mfa.unenroll({ factorId: enrolled.id });
      }
    });
  });

  describe("情境 2：有 verified factor、session 為 aal1 → is_admin() 為 false", () => {
    it("is_admin() 回傳 false", async () => {
      const client = await aal1Session(mfaAdmin);
      const { data, error } = await client.rpc("is_admin");
      expect(error).toBeNull();
      expect(data).toBe(false);
    });

    it("前提：aal1 session 無法替自己再註冊一個新 factor 來升級成 aal2（否則 DB 層保護可被繞過）", async () => {
      const client = await aal1Session(mfaAdmin);
      const { data, error } = await client.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `${TEST_MARKER}-attacker`,
      });
      try {
        expect(error).not.toBeNull();
      } finally {
        // 萬一 Supabase 行為改變而註冊成功，立刻移除，並讓上面的斷言失敗。
        if (data) await serviceRoleClient.auth.admin.mfa.deleteFactor({ userId: mfaAdmin.id, id: data.id });
      }
      const { data: isAdmin } = await client.rpc("is_admin");
      expect(isAdmin).toBe(false);
    });

    it("繞過路徑 1：直接用 PostgREST 更新 services，受影響列數為 0、資料未變", async () => {
      const client = await aal1Session(mfaAdmin);
      const { data, error, count } = await client
        .from("services")
        .update({ name: `${TEST_MARKER}-hacked` }, { count: "exact" })
        .eq("id", serviceId!)
        .select("id");
      expect(error).toBeNull();
      expect(data).toEqual([]);
      expect(count).toBe(0);

      const { data: row } = await serviceRoleClient.from("services").select("name").eq("id", serviceId!).single();
      expect(row?.name).toBe(serviceOriginalName);
    });

    it("繞過路徑 2：呼叫 update_admin_profile 回傳 false，個人資料維持原值", async () => {
      const { data: before } = await serviceRoleClient
        .from("admins")
        .select("display_name")
        .eq("user_id", mfaAdmin.id)
        .single();

      const client = await aal1Session(mfaAdmin);
      const { data, error } = await client.rpc("update_admin_profile", {
        p_display_name: `${TEST_MARKER}-hacked`,
        p_avatar_url: null,
      });
      expect(error).toBeNull();
      expect(data).toBe(false);

      const { data: after } = await serviceRoleClient
        .from("admins")
        .select("display_name")
        .eq("user_id", mfaAdmin.id)
        .single();
      expect(after?.display_name).toBe(before?.display_name);
    });

    it("get_admin_profile 回傳空結果集（不洩漏個人資料）", async () => {
      const client = await aal1Session(mfaAdmin);
      const { data, error } = await client.rpc("get_admin_profile");
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("繞過路徑 3：上傳 admin-assets 被拒絕，物件確實不存在", async () => {
      const client = await aal1Session(mfaAdmin);
      const path = `avatar/${TEST_MARKER}-aal1-upload.png`;
      const { error } = await client.storage
        .from("admin-assets")
        .upload(path, Buffer.from("fake-avatar-bytes"), { contentType: "image/png" });
      uploadedObjectPaths.push(path);
      expect(error).not.toBeNull();
      expect(await adminAssetsExists(path)).toBe(false);
    });

    it("Storage 刪除被拒絕：既有物件仍在", async () => {
      const path = `avatar/${TEST_MARKER}-remove-target-aal1.png`;
      const { error: seedError } = await serviceRoleClient.storage
        .from("admin-assets")
        .upload(path, Buffer.from("fake-avatar-bytes"), { contentType: "image/png" });
      expect(seedError).toBeNull();
      uploadedObjectPaths.push(path);

      const client = await aal1Session(mfaAdmin);
      const { data } = await client.storage.from("admin-assets").remove([path]);
      expect(data ?? []).toHaveLength(0);
      expect(await adminAssetsExists(path)).toBe(true);
    });

    it("讀取被拒絕：aal1 查不到 appointments（含顧客個資），資料確實存在", async () => {
      const { data: viaService } = await serviceRoleClient.from("appointments").select("id").eq("id", appointmentId!);
      expect(viaService).toHaveLength(1);

      const client = await aal1Session(mfaAdmin);
      const { data, error } = await client.from("appointments").select("id").eq("id", appointmentId!);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  });

  describe("情境 3：同一帳號完成 TOTP、session 為 aal2 → is_admin() 為 true", () => {
    it("is_admin() 回傳 true", async () => {
      await expectAal2(mfaAdminAal2);
      const { data, error } = await mfaAdminAal2.rpc("is_admin");
      expect(error).toBeNull();
      expect(data).toBe(true);
    });

    it("aal2 可更新 services（資料確實改變）", async () => {
      const newName = `${TEST_MARKER}-service-aal2-updated`;
      const { data, error, count } = await mfaAdminAal2
        .from("services")
        .update({ name: newName }, { count: "exact" })
        .eq("id", serviceId!)
        .select("id");
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(count).toBe(1);

      const { data: row } = await serviceRoleClient.from("services").select("name").eq("id", serviceId!).single();
      expect(row?.name).toBe(newName);
    });

    it("aal2 可呼叫 update_admin_profile／get_admin_profile，寫入立即可讀回", async () => {
      const { data: ok, error: updateError } = await mfaAdminAal2.rpc("update_admin_profile", {
        p_display_name: `${TEST_MARKER}-aal2`,
        p_avatar_url: null,
      });
      expect(updateError).toBeNull();
      expect(ok).toBe(true);

      const { data: profile, error: profileError } = await mfaAdminAal2.rpc("get_admin_profile");
      expect(profileError).toBeNull();
      expect(profile).toHaveLength(1);
      expect(profile[0].display_name).toBe(`${TEST_MARKER}-aal2`);
    });

    it("aal2 可上傳與刪除 admin-assets", async () => {
      const path = `avatar/${TEST_MARKER}-aal2-upload.png`;
      const { error: uploadError } = await mfaAdminAal2.storage
        .from("admin-assets")
        .upload(path, Buffer.from("fake-avatar-bytes"), { contentType: "image/png" });
      uploadedObjectPaths.push(path);
      expect(uploadError).toBeNull();
      expect(await adminAssetsExists(path)).toBe(true);

      const { data: removed, error: removeError } = await mfaAdminAal2.storage.from("admin-assets").remove([path]);
      expect(removeError).toBeNull();
      expect(removed).toHaveLength(1);
      expect(await adminAssetsExists(path)).toBe(false);
    });

    it("aal2 可讀取 appointments", async () => {
      const { data, error } = await mfaAdminAal2.from("appointments").select("id").eq("id", appointmentId!);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it("session refresh 後仍是 aal2，is_admin() 仍為 true", async () => {
      const { error: refreshError } = await mfaAdminAal2.auth.refreshSession();
      expect(refreshError).toBeNull();
      await expectAal2(mfaAdminAal2);
      const { data, error } = await mfaAdminAal2.rpc("is_admin");
      expect(error).toBeNull();
      expect(data).toBe(true);
    });
  });

  describe("情境 4：非管理員（不在 admins 表）不論 aal 都是 false", () => {
    it("有 verified factor 的非管理員，aal1 → false", async () => {
      const client = await aal1Session(mfaNonAdmin);
      const { data, error } = await client.rpc("is_admin");
      expect(error).toBeNull();
      expect(data).toBe(false);
    });

    it("有 verified factor 的非管理員，aal2 → 仍是 false", async () => {
      await expectAal2(mfaNonAdminAal2);
      const { data, error } = await mfaNonAdminAal2.rpc("is_admin");
      expect(error).toBeNull();
      expect(data).toBe(false);
      expect(mfaNonAdminFactorId).toBeTruthy();
    });

    it("anon（無 session）→ false", async () => {
      const client = createClient(url!, anonKey!, clientOptions);
      const { data, error } = await client.rpc("is_admin");
      expect(error).toBeNull();
      expect(data).toBe(false);
    });
  });
});
