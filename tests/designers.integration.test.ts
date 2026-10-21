// 對真實 Supabase 專案執行的整合測試，驗證多位設計師 Epic 的資料基礎（TASK-067／0017）：
// designers／designer_services／designer_leaves／designer_portfolio_images 四張表的 RLS 與
// GRANT 邊界、check constraint（斷言 constraint 名稱，避免因別的原因被擋而誤通過）、作品集 12 張
// 上限 trigger（單列、並行、多列單一 insert、非管理員不能探測），以及 designer-assets Storage bucket
// 的 policy；最後用真實 admin session 跑一次 lib/admin/designers.ts 的 listDesigners。
// 需要先套用 0017_designers.sql。不放進預設 `npm test`，只透過 `npm run test:designers` 執行——缺設定時
// 直接噴錯而非略過，避免「忘了填 .env.local 卻顯示測試通過」的誤導。
//
// 單一資料庫資料隔離規則（見 TASK-067 任務卡架構筆記 A）：
//   - 本檔案建立的設計師與服務一律以 TEST_MARKER（`__TEST__dz-` 開頭）命名，測試設計師只對 `__TEST__`
//     服務開啟（而且該服務是下架狀態，不會出現在前台）。「預期被擋下」的 insert 如果意外成功，也會被
//     追蹤並清除（名稱不帶標記的案例靠 id 追蹤）。
//   - 不修改「預設設計師」（唯一的真實設計師）的任何資料；不建立任何 appointments——appointments 的
//     INSERT/UPDATE 有 Database Webhook trigger 會真的寄信（見 feedback_integration_test_db_triggers），
//     本檔案驗證 appointments.designer_id 權限時只用「不存在的 id」觸發權限檢查，不會有資料列被更新。
//   - beforeAll 先掃除前次被中斷的測試殘留；afterAll 刪除測試設計師（cascade 帶走服務開關、請假、作品集
//     資料列）、Storage 檔案、測試服務與測試帳號，清除失敗要 throw。
//   - 前提：DESIGNER_EMAIL 帳號沒有啟用 MFA。若日後對它啟用 MFA，is_admin() 會要求 aal2，本檔案以密碼
//     登入只有 aal1，所有 admin 寫入案例都會失敗（失敗是明顯的，不會靜默通過）。
//
// 若測試被強制中斷，下次執行的 beforeAll 會自動掃除；要手動清除可以在 SQL Editor 執行：
//   delete from public.designers where name like '\_\_TEST\_\_dz-%';
//   delete from public.services where name like '\_\_TEST\_\_dz-%';
// （Storage 檔案要在 Dashboard 的 designer-assets bucket 刪除；測試帳號 email 以 `__TEST__dz-` 開頭，
// 到 Authentication → Users 刪除。）
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listDesigners } from "@/lib/admin/designers";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const designerEmail = process.env.DESIGNER_EMAIL;
const designerPassword = process.env.DESIGNER_PASSWORD;

if (!url || !anonKey || !serviceRoleKey || !designerEmail || !designerPassword) {
  throw new Error(
    "[designers.integration.test] 缺少 Supabase 專案設定或 DESIGNER_EMAIL/DESIGNER_PASSWORD，" +
      "請確認 .env.local 已填妥並已執行 npm run seed:designer。",
  );
}

const RESIDUE_PREFIX = "__TEST__dz-";
// 設計師名稱上限 30 字：標記要夠短，才放得下尾碼。
const TEST_MARKER = `${RESIDUE_PREFIX}${Date.now()}`;
const BUCKET = "designer-assets";
const PUBLIC_COLUMNS = "id, name, bio, specialties, instagram_handle, avatar_url, sort_order, is_active";

// 1x1 透明 PNG，上傳 Storage 用。
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const RLS_MESSAGE = "new row violates row-level security policy";

function publicUrl(path: string): string {
  return `${url}/storage/v1/object/public/${BUCKET}/${path}`;
}

// 作品集資料列：image_url 與 storage_path 一致，這樣每個 constraint 案例只會違反它想測的那一條。
function portfolioRow(designerId: string, path?: string) {
  const storagePath = path ?? `portfolio/${designerId}/${randomUUID()}.webp`;
  return { designer_id: designerId, image_url: publicUrl(storagePath), storage_path: storagePath };
}

type PostgrestLikeError = { code?: string; message?: string } | null;

// 斷言是「指定的 check constraint」擋下，不是別的原因（PostgREST 訊息含 violates check constraint "<name>"）。
function expectCheckViolation(error: PostgrestLikeError, constraintName: string, label?: string) {
  expect(error?.code, label).toBe("23514");
  expect(error?.message, label).toContain(`"${constraintName}"`);
}

describe("多位設計師資料基礎：RLS／GRANT／constraint／trigger／Storage（真實 Supabase 專案）", () => {
  let serviceRoleClient: SupabaseClient;
  let anonClient: SupabaseClient;
  let adminClient: SupabaseClient;
  let nonAdminClient: SupabaseClient;

  let activeDesignerId: string;
  let inactiveDesignerId: string;
  let testServiceId: string;
  const createdDesignerIds: string[] = [];
  const createdStoragePaths: string[] = [];

  function track(id: string | undefined | null) {
    if (id) createdDesignerIds.push(id);
  }

  async function createDesigner(overrides: Record<string, unknown> = {}): Promise<string> {
    const { data, error } = await serviceRoleClient
      .from("designers")
      .insert({ name: `${TEST_MARKER}-${createdDesignerIds.length}`, ...overrides })
      .select("id")
      .single();
    if (error) throw error;
    track(data.id);
    return data.id;
  }

  async function listFolder(path: string): Promise<string[]> {
    const { data, error } = await serviceRoleClient.storage.from(BUCKET).list(path);
    if (error) throw error;
    return (data ?? []).map((file) => `${path}/${file.name}`);
  }

  // 掃除以 prefix 開頭的測試資料：設計師（cascade 帶走服務開關／請假／作品集）、其 Storage 檔案、
  // 測試服務、測試帳號。beforeAll 用通用前綴清前次殘留，afterAll 用本次標記清漏網之魚。
  async function sweep(prefix: string) {
    const errors: unknown[] = [];

    const { data: designers, error: designersError } = await serviceRoleClient
      .from("designers")
      .select("id")
      .like("name", `${prefix}%`);
    if (designersError) errors.push(designersError);

    const ids = [...new Set([...(designers ?? []).map((d) => d.id as string), ...createdDesignerIds])];
    const paths: string[] = [];
    for (const id of ids) {
      for (const folder of [`avatar/${id}`, `portfolio/${id}`]) {
        try {
          paths.push(...(await listFolder(folder)));
        } catch (error) {
          errors.push(error);
        }
      }
    }
    if (paths.length > 0) {
      const { error } = await serviceRoleClient.storage.from(BUCKET).remove(paths);
      if (error) errors.push(error);
    }
    if (ids.length > 0) {
      const { error } = await serviceRoleClient.from("designers").delete().in("id", ids);
      if (error) errors.push(error);
    }

    const { error: servicesError } = await serviceRoleClient.from("services").delete().like("name", `${prefix}%`);
    if (servicesError) errors.push(servicesError);

    const { data: users, error: usersError } = await serviceRoleClient.auth.admin.listUsers({ perPage: 200 });
    if (usersError) errors.push(usersError);
    for (const user of (users?.users ?? []).filter((u) => u.email?.startsWith(prefix))) {
      const { error } = await serviceRoleClient.auth.admin.deleteUser(user.id);
      if (error) errors.push(error);
    }

    if (errors.length > 0) {
      const messages = errors.map((e) => (e instanceof Error ? e.message : JSON.stringify(e)));
      throw new Error(`[designers.integration.test] 清除失敗，測試資料可能未被清乾淨：${JSON.stringify(messages)}`);
    }
  }

  beforeAll(async () => {
    const authOptions = { auth: { autoRefreshToken: false, persistSession: false } };
    serviceRoleClient = createClient(url!, serviceRoleKey!, authOptions);
    anonClient = createClient(url!, anonKey!, authOptions);
    adminClient = createClient(url!, anonKey!, authOptions);
    nonAdminClient = createClient(url!, anonKey!, authOptions);

    await sweep(RESIDUE_PREFIX);

    const { error: signInError } = await adminClient.auth.signInWithPassword({
      email: designerEmail!,
      password: designerPassword!,
    });
    if (signInError) throw signInError;

    const nonAdminEmail = `${TEST_MARKER}-nonadmin@example.invalid`;
    const nonAdminPassword = `${randomUUID()}Aa1!`;
    // 測試帳號 email 以 TEST_MARKER 開頭，由 sweep() 依前綴刪除。
    const { error: createNonAdminError } = await serviceRoleClient.auth.admin.createUser({
      email: nonAdminEmail,
      password: nonAdminPassword,
      email_confirm: true,
    });
    if (createNonAdminError) throw createNonAdminError;
    const { error: nonAdminSignInError } = await nonAdminClient.auth.signInWithPassword({
      email: nonAdminEmail,
      password: nonAdminPassword,
    });
    if (nonAdminSignInError) throw nonAdminSignInError;

    // 下架中的測試服務：不會出現在前台，測試設計師只對它開啟。
    const { data: service, error: serviceError } = await serviceRoleClient
      .from("services")
      .insert({ name: `${TEST_MARKER} service`, price: 100, duration_minutes: 30, is_active: false })
      .select("id")
      .single();
    if (serviceError) throw serviceError;
    testServiceId = service.id;

    activeDesignerId = await createDesigner({
      bio: "active bio",
      specialties: ["漸層染"],
      instagram_handle: "mei.hair",
    });
    inactiveDesignerId = await createDesigner({ is_active: false });

    for (const designerId of [activeDesignerId, inactiveDesignerId]) {
      const { error: linkError } = await serviceRoleClient
        .from("designer_services")
        .insert({ designer_id: designerId, service_id: testServiceId });
      if (linkError) throw linkError;
      const { error: portfolioError } = await serviceRoleClient
        .from("designer_portfolio_images")
        .insert(portfolioRow(designerId));
      if (portfolioError) throw portfolioError;
      const { error: leaveError } = await serviceRoleClient
        .from("designer_leaves")
        .insert({ designer_id: designerId, date: "2099-01-01" });
      if (leaveError) throw leaveError;
    }
  });

  afterAll(async () => {
    const cleanupErrors: unknown[] = [];

    try {
      // scope: local 只結束這個 client 的 session；預設的 global 會撤銷正式管理員在所有裝置的登入。
      await adminClient.auth.signOut({ scope: "local" });
      await nonAdminClient.auth.signOut({ scope: "local" });
    } catch (signOutError) {
      cleanupErrors.push(signOutError);
    }

    if (createdStoragePaths.length > 0) {
      const { error } = await serviceRoleClient.storage.from(BUCKET).remove(createdStoragePaths);
      if (error) cleanupErrors.push(error);
    }

    try {
      // 追蹤到的 id、名稱帶本次標記的設計師、測試服務與測試帳號一併清除（含意外成功而漏網的）。
      await sweep(TEST_MARKER);
    } catch (sweepError) {
      cleanupErrors.push(sweepError);
    }

    if (createdDesignerIds.length > 0) {
      const { data, error } = await serviceRoleClient.from("designers").select("id").in("id", createdDesignerIds);
      if (error) cleanupErrors.push(error);
      else if ((data ?? []).length > 0) cleanupErrors.push(new Error(`仍有 ${data!.length} 位測試設計師沒被刪除`));
    }

    if (cleanupErrors.length > 0) {
      const messages = cleanupErrors.map((e) => (e instanceof Error ? e.message : JSON.stringify(e)));
      throw new Error(
        `[designers.integration.test] afterAll 清除失敗，測試資料可能未被清乾淨：${JSON.stringify(messages)}`,
      );
    }
  });

  describe("預設設計師（0017 回填結果，唯讀檢查）", () => {
    it("最早建立的設計師不是測試資料，而且在它建立之前的所有預約都有 designer_id", async () => {
      const { data: first, error } = await serviceRoleClient
        .from("designers")
        .select("id, name, created_at")
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(1)
        .single();
      expect(error).toBeNull();
      expect(first?.name.startsWith("__TEST__")).toBe(false);

      // 不能直接斷言「全部預約都非 null」：0018 之前舊 RPC 寫入的新預約 designer_id 會是 null。
      const { data: orphans, error: orphansError } = await serviceRoleClient
        .from("appointments")
        .select("id")
        .is("designer_id", null)
        .lt("created_at", first!.created_at);
      expect(orphansError).toBeNull();
      expect(orphans).toEqual([]);
    });
  });

  describe("anon 邊界", () => {
    it("只讀得到啟用中設計師的公開欄位，讀不到停用中的", async () => {
      const { data, error } = await anonClient
        .from("designers")
        .select(PUBLIC_COLUMNS)
        .in("id", [activeDesignerId, inactiveDesignerId]);
      expect(error).toBeNull();
      expect(data?.map((d) => d.id)).toEqual([activeDesignerId]);
      expect(data?.[0]).toMatchObject({ name: expect.stringContaining(TEST_MARKER), bio: "active bio" });
    });

    it("select * 與非公開欄位（created_at／updated_at）被拒（42501）", async () => {
      const star = await anonClient.from("designers").select("*");
      expect(star.error?.code).toBe("42501");
      const createdAt = await anonClient.from("designers").select("created_at");
      expect(createdAt.error?.code).toBe("42501");
    });

    it("讀得到啟用中設計師的 designer_services（欄位 grant 隱藏依賴的回歸），讀不到停用中的", async () => {
      const { data, error } = await anonClient
        .from("designer_services")
        .select("designer_id, service_id")
        .in("designer_id", [activeDesignerId, inactiveDesignerId]);
      expect(error).toBeNull();
      expect(data).toEqual([{ designer_id: activeDesignerId, service_id: testServiceId }]);
    });

    it("讀得到啟用中設計師的作品集公開欄位，讀不到停用中的，也讀不到 storage_path", async () => {
      const { data, error } = await anonClient
        .from("designer_portfolio_images")
        .select("id, designer_id, image_url, created_at")
        .in("designer_id", [activeDesignerId, inactiveDesignerId]);
      expect(error).toBeNull();
      expect(data?.map((d) => d.designer_id)).toEqual([activeDesignerId]);

      const storagePath = await anonClient.from("designer_portfolio_images").select("storage_path");
      expect(storagePath.error?.code).toBe("42501");
      const star = await anonClient.from("designer_portfolio_images").select("*");
      expect(star.error?.code).toBe("42501");
    });

    it("讀不到 designer_leaves（42501）", async () => {
      const { error } = await anonClient.from("designer_leaves").select("designer_id, date");
      expect(error?.code).toBe("42501");
    });

    it("不能寫入任何設計師資料表（insert／update／delete 皆 42501）", async () => {
      const results = [
        await anonClient.from("designers").insert({ name: `${TEST_MARKER}-x` }),
        await anonClient.from("designers").update({ name: "x" }).eq("id", activeDesignerId),
        await anonClient.from("designers").delete().eq("id", activeDesignerId),
        await anonClient.from("designer_services").insert({ designer_id: activeDesignerId, service_id: testServiceId }),
        await anonClient
          .from("designer_services")
          .update({ service_id: testServiceId })
          .eq("designer_id", activeDesignerId),
        await anonClient.from("designer_services").delete().eq("designer_id", activeDesignerId),
        await anonClient.from("designer_leaves").insert({ designer_id: activeDesignerId, date: "2099-02-01" }),
        await anonClient.from("designer_leaves").update({ date: "2099-02-02" }).eq("designer_id", activeDesignerId),
        await anonClient.from("designer_leaves").delete().eq("designer_id", activeDesignerId),
        await anonClient.from("designer_portfolio_images").insert(portfolioRow(activeDesignerId)),
        await anonClient
          .from("designer_portfolio_images")
          .update({ image_url: "x" })
          .eq("designer_id", activeDesignerId),
        await anonClient.from("designer_portfolio_images").delete().eq("designer_id", activeDesignerId),
      ];
      results.forEach((result, index) => expect(result.error?.code, `案例 ${index}`).toBe("42501"));
    });

    it("讀不到 appointments.designer_id（42501）", async () => {
      const { error } = await anonClient.from("appointments").select("designer_id").limit(1);
      expect(error?.code).toBe("42501");
    });
  });

  describe("非管理員 authenticated 邊界", () => {
    it("讀得到啟用中設計師，讀不到停用中的", async () => {
      const { data, error } = await nonAdminClient
        .from("designers")
        .select(PUBLIC_COLUMNS)
        .in("id", [activeDesignerId, inactiveDesignerId]);
      expect(error).toBeNull();
      expect(data?.map((d) => d.id)).toEqual([activeDesignerId]);
    });

    it("讀不到停用中設計師的 designer_services 與作品集", async () => {
      const services = await nonAdminClient
        .from("designer_services")
        .select("designer_id")
        .eq("designer_id", inactiveDesignerId);
      expect(services.error).toBeNull();
      expect(services.data).toEqual([]);
      const portfolio = await nonAdminClient
        .from("designer_portfolio_images")
        .select("id")
        .eq("designer_id", inactiveDesignerId);
      expect(portfolio.error).toBeNull();
      expect(portfolio.data).toEqual([]);
    });

    it("designer_leaves 一律讀到空陣列（policy 要求 is_admin()）", async () => {
      const { data, error } = await nonAdminClient.from("designer_leaves").select("designer_id, date");
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("不能寫入四張表（RLS 擋下，42501）", async () => {
      const results = [
        await nonAdminClient.from("designers").insert({ name: `${TEST_MARKER}-y` }),
        await nonAdminClient
          .from("designer_services")
          .insert({ designer_id: activeDesignerId, service_id: testServiceId }),
        await nonAdminClient.from("designer_leaves").insert({ designer_id: activeDesignerId, date: "2099-02-01" }),
        await nonAdminClient.from("designer_portfolio_images").insert(portfolioRow(activeDesignerId)),
      ];
      results.forEach((result, index) => expect(result.error?.code, `案例 ${index}`).toBe("42501"));
    });

    it("update／delete 不會影響任何資料列", async () => {
      const { data: updated } = await nonAdminClient
        .from("designers")
        .update({ name: `${TEST_MARKER}-h` })
        .eq("id", activeDesignerId)
        .select("id");
      expect(updated ?? []).toEqual([]);

      const { data: deletedServices } = await nonAdminClient
        .from("designer_services")
        .delete()
        .eq("designer_id", activeDesignerId)
        .select("designer_id");
      expect(deletedServices ?? []).toEqual([]);

      const { data: row } = await serviceRoleClient
        .from("designers")
        .select("name")
        .eq("id", activeDesignerId)
        .single();
      expect(row?.name).not.toMatch(/-h$/);
      const { data: links } = await serviceRoleClient
        .from("designer_services")
        .select("designer_id")
        .eq("designer_id", activeDesignerId);
      expect(links?.length).toBe(1);
    });

    it("對已有 12 張作品的設計師 insert，得到 42501 而不是 PORTFOLIO_LIMIT（不能用張數 trigger 探測）", async () => {
      const designerId = await createDesigner({ is_active: false });
      const { error: seedError } = await serviceRoleClient
        .from("designer_portfolio_images")
        .insert(Array.from({ length: 12 }, () => portfolioRow(designerId)));
      expect(seedError).toBeNull();

      const { error } = await nonAdminClient.from("designer_portfolio_images").insert(portfolioRow(designerId));
      expect(error?.code).toBe("42501");
      expect(error?.message).not.toContain("PORTFOLIO_LIMIT");
    });
  });

  describe("管理員（admin）權限", () => {
    it("可以讀到停用中設計師、他的服務開關、作品集與請假日", async () => {
      const designers = await adminClient
        .from("designers")
        .select("id, is_active")
        .in("id", [activeDesignerId, inactiveDesignerId]);
      expect(designers.error).toBeNull();
      expect(designers.data?.map((d) => d.id).sort()).toEqual([activeDesignerId, inactiveDesignerId].sort());

      const services = await adminClient
        .from("designer_services")
        .select("designer_id")
        .eq("designer_id", inactiveDesignerId);
      expect(services.error).toBeNull();
      expect(services.data?.length).toBe(1);

      const portfolio = await adminClient
        .from("designer_portfolio_images")
        .select("id, storage_path")
        .eq("designer_id", inactiveDesignerId);
      expect(portfolio.error).toBeNull();
      expect(portfolio.data?.length).toBe(1);

      const leaves = await adminClient
        .from("designer_leaves")
        .select("designer_id")
        .in("designer_id", [activeDesignerId, inactiveDesignerId]);
      expect(leaves.error).toBeNull();
      expect(leaves.data?.length).toBe(2);
    });

    it("可以新增與更新設計師（含專長陣列，證明 authenticated 可執行 check constraint 的驗證函式）", async () => {
      const { data, error } = await adminClient
        .from("designers")
        .insert({
          name: `${TEST_MARKER}-a`,
          bio: "bio",
          specialties: ["韓系剪髮", "漸層染"],
          instagram_handle: "admin_test",
          is_active: false,
        })
        .select("id")
        .single();
      expect(error).toBeNull();
      track(data!.id);

      const { data: updated, error: updateError } = await adminClient
        .from("designers")
        .update({ name: `${TEST_MARKER}-b`, is_active: false, sort_order: 9, specialties: ["護髮"] })
        .eq("id", data!.id)
        .select("id, name, is_active, sort_order, specialties");
      expect(updateError).toBeNull();
      expect(updated).toEqual([
        { id: data!.id, name: `${TEST_MARKER}-b`, is_active: false, sort_order: 9, specialties: ["護髮"] },
      ]);
    });

    it("update 會透過 trigger 刷新 updated_at", async () => {
      const designerId = await createDesigner({ is_active: false });
      const { data: before } = await serviceRoleClient
        .from("designers")
        .select("updated_at")
        .eq("id", designerId)
        .single();

      const { error } = await adminClient.from("designers").update({ sort_order: 7 }).eq("id", designerId);
      expect(error).toBeNull();

      const { data: after } = await serviceRoleClient
        .from("designers")
        .select("updated_at")
        .eq("id", designerId)
        .single();
      expect(new Date(after!.updated_at).getTime()).toBeGreaterThan(new Date(before!.updated_at).getTime());
    });

    it("insert 不能自訂 id 或 created_at，update 不能改 id 與 created_at（欄位層級 grant）", async () => {
      const insertCreatedAt = await adminClient
        .from("designers")
        .insert({ name: `${TEST_MARKER}-t`, created_at: "1970-01-01T00:00:00Z", is_active: false });
      expect(insertCreatedAt.error?.code).toBe("42501");
      const insertId = await adminClient
        .from("designers")
        .insert({ id: randomUUID(), name: `${TEST_MARKER}-t`, is_active: false });
      expect(insertId.error?.code).toBe("42501");

      const updateId = await adminClient.from("designers").update({ id: randomUUID() }).eq("id", activeDesignerId);
      expect(updateId.error?.code).toBe("42501");
      const updateCreatedAt = await adminClient
        .from("designers")
        .update({ created_at: new Date().toISOString() })
        .eq("id", activeDesignerId);
      expect(updateCreatedAt.error?.code).toBe("42501");
    });

    it("不能刪除設計師（authenticated 不 grant delete），資料列仍在", async () => {
      const { error } = await adminClient.from("designers").delete().eq("id", activeDesignerId);
      expect(error?.code).toBe("42501");
      const { data } = await serviceRoleClient.from("designers").select("id").eq("id", activeDesignerId);
      expect(data?.length).toBe(1);
    });

    it("可以開關服務（insert／delete），但不能 update designer_services", async () => {
      const designerId = await createDesigner({ is_active: false });
      const insert = await adminClient
        .from("designer_services")
        .insert({ designer_id: designerId, service_id: testServiceId });
      expect(insert.error).toBeNull();

      const update = await adminClient
        .from("designer_services")
        .update({ service_id: testServiceId })
        .eq("designer_id", designerId);
      expect(update.error?.code).toBe("42501");

      const { data, error } = await adminClient
        .from("designer_services")
        .delete()
        .eq("designer_id", designerId)
        .select("designer_id");
      expect(error).toBeNull();
      expect(data?.length).toBe(1);
    });

    it("可以新增與刪除請假日，同一天重複新增被主鍵擋下（23505），但不能 update", async () => {
      const designerId = await createDesigner({ is_active: false });
      const first = await adminClient.from("designer_leaves").insert({ designer_id: designerId, date: "2099-03-03" });
      expect(first.error).toBeNull();
      const duplicate = await adminClient
        .from("designer_leaves")
        .insert({ designer_id: designerId, date: "2099-03-03" });
      expect(duplicate.error?.code).toBe("23505");

      const update = await adminClient
        .from("designer_leaves")
        .update({ date: "2099-03-04" })
        .eq("designer_id", designerId);
      expect(update.error?.code).toBe("42501");

      const { data, error } = await adminClient
        .from("designer_leaves")
        .delete()
        .eq("designer_id", designerId)
        .select("designer_id");
      expect(error).toBeNull();
      expect(data?.length).toBe(1);
    });

    it("作品集可以新增與刪除，但不能 update", async () => {
      const designerId = await createDesigner({ is_active: false });
      const row = portfolioRow(designerId);
      expect((await adminClient.from("designer_portfolio_images").insert(row)).error).toBeNull();

      const update = await adminClient
        .from("designer_portfolio_images")
        .update({ image_url: row.image_url })
        .eq("designer_id", designerId);
      expect(update.error?.code).toBe("42501");

      const { data, error } = await adminClient
        .from("designer_portfolio_images")
        .delete()
        .eq("storage_path", row.storage_path)
        .select("id");
      expect(error).toBeNull();
      expect(data?.length).toBe(1);
    });

    it("可以讀 appointments.designer_id，但不能更新（不能改派）", async () => {
      const read = await adminClient.from("appointments").select("id, designer_id").limit(1);
      expect(read.error).toBeNull();

      // 用不存在的 id：欄位層級權限在解析階段就檢查，不會有任何資料列被更新（也就不會觸發寄信 trigger）。
      const update = await adminClient
        .from("appointments")
        .update({ designer_id: activeDesignerId })
        .eq("id", randomUUID());
      expect(update.error?.code).toBe("42501");
    });
  });

  describe("service_role", () => {
    it("可以讀寫（含 update）四張表並刪除設計師", async () => {
      const designerId = await createDesigner({ is_active: false });
      const service = await serviceRoleClient
        .from("designer_services")
        .insert({ designer_id: designerId, service_id: testServiceId });
      expect(service.error).toBeNull();
      const leave = await serviceRoleClient
        .from("designer_leaves")
        .insert({ designer_id: designerId, date: "2099-04-04" });
      expect(leave.error).toBeNull();
      const portfolio = await serviceRoleClient.from("designer_portfolio_images").insert(portfolioRow(designerId));
      expect(portfolio.error).toBeNull();

      const updateDesigner = await serviceRoleClient
        .from("designers")
        .update({ sort_order: 5 })
        .eq("id", designerId)
        .select("id");
      expect(updateDesigner.error).toBeNull();
      expect(updateDesigner.data?.length).toBe(1);
      const updateLeave = await serviceRoleClient
        .from("designer_leaves")
        .update({ date: "2099-04-05" })
        .eq("designer_id", designerId)
        .select("designer_id");
      expect(updateLeave.error).toBeNull();
      expect(updateLeave.data?.length).toBe(1);

      const { data, error } = await serviceRoleClient.from("designers").delete().eq("id", designerId).select("id");
      expect(error).toBeNull();
      expect(data?.length).toBe(1);

      const { data: remaining } = await serviceRoleClient
        .from("designer_services")
        .select("designer_id")
        .eq("designer_id", designerId);
      expect(remaining).toEqual([]);
    });
  });

  describe("check constraint（資料庫層最終防線，以 service_role 寫入繞過 RLS 也擋得住）", () => {
    // 預期被擋下；萬一意外成功（constraint 退化），回傳的 id 也會被追蹤並清除。名稱案例無法帶標記，
    // 只能靠 id 追蹤。所有成功的案例一律建成停用，不會出現在前台。
    async function insertDesigner(fields: Record<string, unknown>) {
      const result = await serviceRoleClient
        .from("designers")
        .insert({ name: `${TEST_MARKER}-c`, is_active: false, ...fields })
        .select("id");
      track(result.data?.[0]?.id);
      return result;
    }

    it("名稱：空白（含全形空白）、超過 30 字、含控制字元或方向覆寫字元被擋下", async () => {
      for (const bad of ["   ", "　　", "a".repeat(31), "a\u0001b", "a‮b", "a​b"]) {
        expectCheckViolation((await insertDesigner({ name: bad })).error, "designers_name_valid", JSON.stringify(bad));
      }
    });

    it("名稱：剛好 1 字與 30 字通過", async () => {
      expect((await insertDesigner({ name: "a" })).error).toBeNull();
      expect((await insertDesigner({ name: "林".repeat(30) })).error).toBeNull();
    });

    it("簡介：超過 200 字被擋下，200 字通過", async () => {
      expectCheckViolation((await insertDesigner({ bio: "a".repeat(201) })).error, "designers_bio_length");
      expect((await insertDesigner({ bio: "a".repeat(200) })).error).toBeNull();
    });

    it("IG 帳號：含空白、@、網址、超過 30 字、空字串被擋下，合法格式與 30 字通過", async () => {
      for (const bad of [
        "bad handle",
        "@mei",
        "https://instagram.com/mei",
        "javascript:alert(1)",
        "a".repeat(31),
        "",
      ]) {
        expectCheckViolation(
          (await insertDesigner({ instagram_handle: bad })).error,
          "designers_instagram_handle_format",
          bad,
        );
      }
      expect((await insertDesigner({ instagram_handle: "mei.hair_01" })).error).toBeNull();
      expect((await insertDesigner({ instagram_handle: "a".repeat(30) })).error).toBeNull();
    });

    it("專長：超過 5 個、重複、超過 12 字、空白標籤、前後有空白、控制字元、方向覆寫字元、NULL 元素被擋下", async () => {
      const bad: unknown[][] = [
        ["a", "b", "c", "d", "e", "f"],
        ["a", "a"],
        ["a".repeat(13)],
        [""],
        [" a"],
        ["　"],
        ["a\u0001"],
        ["a‮b"],
        ["a​b"],
        [null],
      ];
      for (const specialties of bad) {
        expectCheckViolation(
          (await insertDesigner({ specialties })).error,
          "designers_specialties_valid",
          JSON.stringify(specialties),
        );
      }
      expect((await insertDesigner({ specialties: ["a".repeat(12), "b", "c", "d", "e"] })).error).toBeNull();
    });

    it("avatar_url：超過 2048 字被擋下，2048 字通過", async () => {
      expectCheckViolation(
        (await insertDesigner({ avatar_url: "x".repeat(2049) })).error,
        "designers_avatar_url_length",
      );
      expect((await insertDesigner({ avatar_url: "x".repeat(2048) })).error).toBeNull();
    });

    it("作品集：每個案例只違反它想測的那一條 constraint", async () => {
      const designerId = await createDesigner({ is_active: false });
      const otherId = await createDesigner({ is_active: false });
      const insert = (row: Record<string, unknown>) => serviceRoleClient.from("designer_portfolio_images").insert(row);

      // storage_path 格式（image_url 與 storage_path 一致，所以不會同時違反 image_url_valid）。
      const badPaths = [
        `portfolio/${otherId}/${randomUUID()}.webp`, // 別人的 designer_id
        `avatar/${designerId}/${randomUUID()}.webp`, // 不是 portfolio 前綴
        `portfolio/${designerId}/${randomUUID()}.svg`, // 不允許的副檔名
        `portfolio/${designerId}/not-a-uuid.webp`, // 檔名不是 uuid
      ];
      for (const path of badPaths) {
        expectCheckViolation(
          (await insert(portfolioRow(designerId, path))).error,
          "designer_portfolio_images_storage_path_format",
          path,
        );
      }

      const good = portfolioRow(designerId);
      // image_url 必須以 storage_path 結尾。
      expectCheckViolation(
        (await insert({ ...good, image_url: "https://evil.example.com/a.webp" })).error,
        "designer_portfolio_images_image_url_valid",
      );
      // image_url 超過 2048 字（結尾仍然正確）。
      expectCheckViolation(
        (await insert({ ...good, image_url: "x".repeat(2049 - good.storage_path.length) + good.storage_path })).error,
        "designer_portfolio_images_image_url_valid",
      );

      // 剛好 2048 字通過；storage_path 重複被 unique 擋下（23505）。
      const boundary = portfolioRow(designerId);
      expect(
        (
          await insert({
            ...boundary,
            image_url: "x".repeat(2048 - boundary.storage_path.length) + boundary.storage_path,
          })
        ).error,
      ).toBeNull();
      const duplicate = await insert(boundary);
      expect(duplicate.error?.code).toBe("23505");
    });
  });

  describe("作品集 12 張上限（trigger）", () => {
    function expectPortfolioLimit(error: PostgrestLikeError) {
      expect(error?.code).toBe("P0001");
      expect(error?.message).toContain("PORTFOLIO_LIMIT");
    }

    async function countImages(designerId: string): Promise<number> {
      const { count, error } = await serviceRoleClient
        .from("designer_portfolio_images")
        .select("id", { count: "exact", head: true })
        .eq("designer_id", designerId);
      if (error) throw error;
      return count ?? 0;
    }

    it("第 13 張被擋下（P0001＋PORTFOLIO_LIMIT）且張數維持 12，刪除一張後可再新增", async () => {
      const designerId = await createDesigner({ is_active: false });
      const rows = Array.from({ length: 12 }, () => portfolioRow(designerId));
      expect((await adminClient.from("designer_portfolio_images").insert(rows)).error).toBeNull();

      const thirteenth = await adminClient.from("designer_portfolio_images").insert(portfolioRow(designerId));
      expectPortfolioLimit(thirteenth.error);
      expect(await countImages(designerId)).toBe(12);

      const { data: deleted, error: deleteError } = await adminClient
        .from("designer_portfolio_images")
        .delete()
        .eq("storage_path", rows[0].storage_path)
        .select("id");
      expect(deleteError).toBeNull();
      expect(deleted?.length).toBe(1);

      expect((await adminClient.from("designer_portfolio_images").insert(portfolioRow(designerId))).error).toBeNull();
    });

    it("並行上傳不會超過 12 張（trigger 鎖住設計師列後才數張數），失敗的都是 PORTFOLIO_LIMIT 而不是死結等其他錯誤", async () => {
      const designerId = await createDesigner({ is_active: false });
      const results = await Promise.all(
        Array.from({ length: 14 }, () =>
          adminClient.from("designer_portfolio_images").insert(portfolioRow(designerId)),
        ),
      );
      const failures = results.filter((r) => r.error !== null);
      expect(results.length - failures.length).toBe(12);
      expect(failures.length).toBe(2);
      failures.forEach((r) => expectPortfolioLimit(r.error));
      expect(await countImages(designerId)).toBe(12);
    });

    it("單一 insert 一次送 14 列也會被擋下，整個語句回滾（張數維持 0）", async () => {
      const designerId = await createDesigner({ is_active: false });
      const { error } = await adminClient
        .from("designer_portfolio_images")
        .insert(Array.from({ length: 14 }, () => portfolioRow(designerId)));
      expectPortfolioLimit(error);
      expect(await countImages(designerId)).toBe(0);
    });
  });

  describe("Storage：designer-assets bucket", () => {
    function newPath(prefix: "avatar" | "portfolio", designerId = activeDesignerId, ext = "png"): string {
      const path = `${prefix}/${designerId}/${randomUUID()}.${ext}`;
      createdStoragePaths.push(path);
      return path;
    }

    function expectStorageRls(error: { message?: string; statusCode?: string } | null, label?: string) {
      expect(error?.statusCode, label).toBe("403");
      expect(error?.message, label).toBe(RLS_MESSAGE);
    }

    it("bucket 設定：public、5MB、只允許 jpeg／png／webp", async () => {
      const { data, error } = await serviceRoleClient.storage.getBucket(BUCKET);
      expect(error).toBeNull();
      expect(data?.public).toBe(true);
      expect(data?.file_size_limit).toBe(5242880);
      expect([...(data?.allowed_mime_types ?? [])].sort()).toEqual(["image/jpeg", "image/png", "image/webp"]);
    });

    it("admin 可以上傳到 avatar／portfolio 路徑，公開網址可讀取", async () => {
      const avatarPath = newPath("avatar");
      const portfolioPath = newPath("portfolio");

      for (const path of [avatarPath, portfolioPath]) {
        const { error } = await adminClient.storage.from(BUCKET).upload(path, TINY_PNG, { contentType: "image/png" });
        expect(error).toBeNull();
      }
      const response = await fetch(publicUrl(avatarPath));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("image/png");
    });

    it("anon 與非管理員 authenticated 不能上傳（403＋RLS）", async () => {
      for (const client of [anonClient, nonAdminClient]) {
        const { error } = await client.storage
          .from(BUCKET)
          .upload(newPath("avatar"), TINY_PNG, { contentType: "image/png" });
        expectStorageRls(error);
      }
    });

    it("路徑不合法時，admin 也不能上傳（403＋RLS）：前綴、第二段、層數、副檔名", async () => {
      const id = activeDesignerId;
      const badPaths = [
        `evil/${id}/${randomUUID()}.png`, // 第一段不是 avatar／portfolio
        `avatar/not-a-uuid/${randomUUID()}.png`, // 第二段不像 uuid
        `${randomUUID()}.png`, // 沒有資料夾
        `avatar/${id}/sub/${randomUUID()}.png`, // 三層
        `avatar/${id}/${randomUUID()}.html`, // 副檔名不允許（Content-Type 宣告成 image/png 也一樣）
        `avatar/${id}/${randomUUID()}.PNG`, // 副檔名大小寫不符
      ];
      for (const path of badPaths) {
        createdStoragePaths.push(path);
        const { error } = await adminClient.storage.from(BUCKET).upload(path, TINY_PNG, { contentType: "image/png" });
        expectStorageRls(error, path);
      }
    });

    it("bucket 擋下不允許的 MIME 類型（svg，415）", async () => {
      const { error } = await adminClient.storage
        .from(BUCKET)
        .upload(newPath("avatar", activeDesignerId, "svg"), Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"), {
          contentType: "image/svg+xml",
        });
      expect(error?.statusCode).toBe("415");
      expect(error?.message).toContain("mime type");
    });

    it("沒有任何角色可以覆寫或搬移既有檔案（不建 update policy）", async () => {
      const path = newPath("avatar");
      const first = await adminClient.storage.from(BUCKET).upload(path, TINY_PNG, { contentType: "image/png" });
      expect(first.error).toBeNull();

      const overwrite = await adminClient.storage
        .from(BUCKET)
        .upload(path, TINY_PNG, { contentType: "image/png", upsert: true });
      expectStorageRls(overwrite.error);

      const destination = newPath("avatar");
      const move = await adminClient.storage.from(BUCKET).move(path, destination);
      expect(move.error).not.toBeNull();

      const names = await listFolder(`avatar/${activeDesignerId}`);
      expect(names).toContain(path);
      expect(names).not.toContain(destination);
    });

    it("anon 無法列舉檔案（service_role 對照組看得到）", async () => {
      const path = newPath("portfolio");
      const upload = await adminClient.storage.from(BUCKET).upload(path, TINY_PNG, { contentType: "image/png" });
      expect(upload.error).toBeNull();

      expect(await listFolder(`portfolio/${activeDesignerId}`)).toContain(path);
      const { data } = await anonClient.storage.from(BUCKET).list(`portfolio/${activeDesignerId}`);
      expect(data ?? []).toEqual([]);
    });

    it("admin 刪除檔案：remove() 回傳 1 筆，之後公開網址回 400 或 404", async () => {
      const path = newPath("portfolio");
      const upload = await adminClient.storage.from(BUCKET).upload(path, TINY_PNG, { contentType: "image/png" });
      expect(upload.error).toBeNull();

      const { data, error } = await adminClient.storage.from(BUCKET).remove([path]);
      expect(error).toBeNull();
      // 缺 select policy 時 remove() 不會報錯、只回空陣列，檔案根本沒被刪（見 0017 說明）。
      expect(data?.length).toBe(1);

      // 刻意不在刪除前 fetch 這個網址，避免 CDN 先快取了 200。
      const response = await fetch(publicUrl(path));
      expect([400, 404]).toContain(response.status);
    });

    it("anon 與非管理員不能刪除檔案，檔案仍在", async () => {
      const path = newPath("portfolio");
      const upload = await adminClient.storage.from(BUCKET).upload(path, TINY_PNG, { contentType: "image/png" });
      expect(upload.error).toBeNull();

      for (const client of [anonClient, nonAdminClient]) {
        const { data } = await client.storage.from(BUCKET).remove([path]);
        expect(data ?? []).toEqual([]);
      }
      expect(await listFolder(`portfolio/${activeDesignerId}`)).toContain(path);
    });
  });

  describe("listDesigners（真實 admin session 的後台列表查詢）", () => {
    it("依 sort_order 排序、包含停用中的設計師、服務數只計上架中的服務", async () => {
      const second = await createDesigner({ name: `${TEST_MARKER}-s2`, sort_order: 92, is_active: false });
      const first = await createDesigner({ name: `${TEST_MARKER}-s1`, sort_order: 91, is_active: false });

      const result = await listDesigners(adminClient);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const { designers, totalServices } = result.data;
      const sortOrders = designers.map((d) => d.sort_order);
      expect(sortOrders).toEqual([...sortOrders].sort((a, b) => a - b));
      expect(designers.findIndex((d) => d.id === first)).toBeLessThan(designers.findIndex((d) => d.id === second));

      // 停用中的設計師也列出；他只對下架中的測試服務開啟，所以服務數是 0。
      const inactive = designers.find((d) => d.id === inactiveDesignerId);
      expect(inactive).toMatchObject({ is_active: false, service_count: 0 });

      // 對照 service_role 直接查出的結果：上架中服務總數、預設設計師的服務數。
      const { data: activeServices } = await serviceRoleClient.from("services").select("id").eq("is_active", true);
      expect(totalServices).toBe(activeServices?.length);

      const { data: defaultDesigner } = await serviceRoleClient
        .from("designers")
        .select("id")
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(1)
        .single();
      const { data: links } = await serviceRoleClient
        .from("designer_services")
        .select("service_id")
        .eq("designer_id", defaultDesigner!.id);
      const activeIds = new Set((activeServices ?? []).map((s) => s.id));
      const expectedCount = (links ?? []).filter((l) => activeIds.has(l.service_id)).length;
      expect(designers.find((d) => d.id === defaultDesigner!.id)?.service_count).toBe(expectedCount);
    });
  });
});
