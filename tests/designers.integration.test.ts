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
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  countFutureAppointmentsForDesigner,
  createDesigner as createDesignerAdmin,
  listDesignerServiceIds,
  listDesigners,
  removeDesignerAvatar,
  setDesignerActive,
  setDesignerService,
  swapDesignerOrder,
  updateDesignerBasicInfo,
  uploadDesignerAvatar,
} from "@/lib/admin/designers";

// Node 環境沒有 canvas／createImageBitmap：重新編碼本身有單元測試（tests/lib/image-reencode.test.ts），
// 這裡只替換成固定輸出（1x1 PNG），讓上傳流程（Storage policy、CAS、刪舊檔）打真實專案。
vi.mock("@/lib/admin/image-reencode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/image-reencode")>()),
  reencodeImage: vi.fn(async () => ({
    ok: true as const,
    blob: new Blob(
      [
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
          "base64",
        ),
      ],
      { type: "image/png" },
    ),
    extension: "png",
  })),
}));

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
      // appointments.designer_id 沒有 cascade：先刪這些設計師的預約（0018 的 RPC 測試會建立預約），再刪顧客，最後才刪設計師。
      const { error: appointmentsError } = await serviceRoleClient.from("appointments").delete().in("designer_id", ids);
      if (appointmentsError) errors.push(appointmentsError);
      const { error: customersError } = await serviceRoleClient.from("customers").delete().like("name", `${prefix}%`);
      if (customersError) errors.push(customersError);
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

  describe("依設計師計算時段與建立預約（0018）", () => {
    // 這個 describe 對真實資料庫呼叫 get_available_slots／create_appointment，需要先套用 0018。
    // 每個案例各自建立專屬的 `__TEST__` 服務與設計師（makeScenario），不共用，避免互相干擾；
    // 「不指定」的候選清單是所有合格設計師，所以每個案例的服務只有該案例的設計師開啟。
    // 日期選離今天 86 天起（晚於其他套件使用的範圍，且仍在 90 天視野內）；時間依實際 business_hours 推算。
    // 注意：appointments 的 INSERT 有 Database Webhook trigger（customer_email 不為 null 才會觸發）。本區塊
    // 除了「email 上限：不計入已取消與已過期」這一個案例（會真的成立一筆帶 email 的預約，email 用
    // @example.invalid，Resend 於 API 層拒絕、不會真的寄出，見 feedback_integration_test_db_triggers），
    // 其餘建立預約一律不帶 email；需要「已有 email 的既有預約」時，先以 null 建立再只更新 customer_email
    // 這一欄（0012 的 WHEN 條件只在 status／start_at／end_at 改變時才成立）。
    type Envelope<T> = { ok: true; data: T } | { ok: false; error_code: string; message: string };
    type Slot = { start_at: string; end_at: string };
    type Created = {
      service_name: string;
      start_at: string;
      end_at: string;
      customer_name: string;
      customer_phone: string;
      designer_id: string;
      designer_name: string;
    };
    type DayInfo = { date: string; openMin: number; closeMin: number };

    const SLOT_CONFLICT = { ok: false, error_code: "SLOT_CONFLICT", message: "slot already booked" } as const;
    const TZ = "+08:00";
    const phoneRunSeed = String(Date.now() % 100_000).padStart(5, "0");
    let phoneSeq = 0;
    let scenarioSeq = 0;
    let hours: Map<number, { openMin: number; closeMin: number } | null>;
    let closedDates: Set<string>;

    function testPhone(): string {
      phoneSeq += 1;
      return `09${phoneRunSeed}${String(phoneSeq).padStart(3, "0")}`;
    }
    function taipeiToday(): string {
      return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
    }
    function addDays(dateStr: string, days: number): string {
      const [y, m, d] = dateStr.split("-").map(Number);
      return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
    }
    function weekdayOf(dateStr: string): number {
      return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
    }
    function at(dateStr: string, minutesFromMidnight: number): string {
      const hh = String(Math.floor(minutesFromMidnight / 60)).padStart(2, "0");
      const mm = String(minutesFromMidnight % 60).padStart(2, "0");
      return new Date(`${dateStr}T${hh}:${mm}:00${TZ}`).toISOString();
    }
    function toMinutes(time: string): number {
      const [h, m] = time.split(":").map(Number);
      return h * 60 + m;
    }
    // 從 startOffset 天後起，找第一個營業中、不在 closed_dates 的日期。
    // 預設結果不得超過第 89 天：get_available_slots 的視野到 today+90，超過一律回空陣列，會讓「時段查詢是空陣列」
    // 的斷言空洞通過。刻意要測 90 天外的案例才傳 beyondHorizon。
    function pickOpenDay(startOffset: number, options: { beyondHorizon?: boolean } = {}): DayInfo {
      for (let i = 0; i < 14; i++) {
        const date = addDays(taipeiToday(), startOffset + i);
        const h = hours.get(weekdayOf(date));
        if (h && !closedDates.has(date)) {
          if (!options.beyondHorizon && startOffset + i > 89) {
            throw new Error(`挑到的營業日在第 ${startOffset + i} 天，超過 get_available_slots 的視野（89 天）`);
          }
          return { date, ...h };
        }
      }
      throw new Error("找不到營業日");
    }
    // 指定日期的下一個營業日（同樣不得超過第 89 天）。
    function pickOpenDayAfter(day: DayInfo): DayInfo {
      const offset = Math.round(
        (Date.parse(`${day.date}T00:00:00Z`) - Date.parse(`${taipeiToday()}T00:00:00Z`)) / 86_400_000,
      );
      return pickOpenDay(offset + 1);
    }

    async function slots(client: SupabaseClient, serviceId: string, date: string, designerId?: string | null) {
      const { data, error } = await client.rpc("get_available_slots", {
        p_service_id: serviceId,
        p_date: date,
        ...(designerId === undefined ? {} : { p_designer_id: designerId }),
      });
      if (error) throw error;
      return data as Envelope<Slot[]>;
    }
    async function create(
      client: SupabaseClient,
      input: {
        serviceId: string;
        startAt: string;
        label: string;
        designerId?: string | null;
        phone?: string;
        email?: string | null;
      },
    ) {
      const { data, error } = await client.rpc("create_appointment", {
        p_service_id: input.serviceId,
        p_start_at: input.startAt,
        p_customer_name: `${TEST_MARKER} ${input.label}`,
        p_customer_phone: input.phone ?? testPhone(),
        p_customer_email: input.email ?? null,
        ...(input.designerId === undefined ? {} : { p_designer_id: input.designerId }),
      });
      if (error) throw error;
      return data as Envelope<Created>;
    }
    function startsOf(envelope: Envelope<Slot[]>): number[] {
      expect(envelope.ok).toBe(true);
      return envelope.ok ? envelope.data.map((s) => new Date(s.start_at).getTime()) : [];
    }
    function ms(iso: string): number {
      return new Date(iso).getTime();
    }

    // 建立一個 `__TEST__` 服務與數位設計師，並把服務對設計師開啟（link: false 的除外）。
    async function makeScenario(options: {
      designers: Array<{ id?: string; sortOrder?: number; isActive?: boolean; link?: boolean; leaveDate?: string }>;
      durationMinutes?: number;
      bufferMinutes?: number;
    }) {
      scenarioSeq += 1;
      const { data: service, error: serviceError } = await serviceRoleClient
        .from("services")
        .insert({
          name: `${TEST_MARKER} svc${scenarioSeq}`,
          price: 100,
          duration_minutes: options.durationMinutes ?? 30,
          buffer_minutes: options.bufferMinutes ?? 0,
          is_active: true,
        })
        .select("id")
        .single();
      if (serviceError) throw serviceError;

      const designerIds: string[] = [];
      for (const spec of options.designers) {
        const id = await createDesigner({
          ...(spec.id ? { id: spec.id } : {}),
          sort_order: spec.sortOrder ?? 0,
          is_active: spec.isActive ?? true,
        });
        designerIds.push(id);
        if (spec.link !== false) {
          const { error } = await serviceRoleClient
            .from("designer_services")
            .insert({ designer_id: id, service_id: service.id });
          if (error) throw error;
        }
        if (spec.leaveDate) {
          const { error } = await serviceRoleClient
            .from("designer_leaves")
            .insert({ designer_id: id, date: spec.leaveDate });
          if (error) throw error;
        }
      }
      return { serviceId: service.id as string, designers: designerIds };
    }

    // 另外建立一個 `__TEST__` 服務並對指定設計師開啟（用於「既有預約屬於另一個 buffer 不同的服務」這類案例）。
    async function makeExtraService(
      designerIds: string[],
      options: { durationMinutes?: number; bufferMinutes?: number },
    ) {
      scenarioSeq += 1;
      const { data: service, error } = await serviceRoleClient
        .from("services")
        .insert({
          name: `${TEST_MARKER} svc${scenarioSeq}`,
          price: 100,
          duration_minutes: options.durationMinutes ?? 30,
          buffer_minutes: options.bufferMinutes ?? 0,
          is_active: true,
        })
        .select("id")
        .single();
      if (error) throw error;
      for (const designerId of designerIds) {
        const { error: linkError } = await serviceRoleClient
          .from("designer_services")
          .insert({ designer_id: designerId, service_id: service.id });
        if (linkError) throw linkError;
      }
      return service.id as string;
    }

    // 直接以 service_role 建立既有預約（customer_email 先留 null，需要 email 時只更新那一欄）。
    async function seedAppointment(params: {
      serviceId: string;
      designerId: string;
      startAt: string;
      endAt: string;
      status?: "pending" | "confirmed" | "completed" | "cancelled";
      email?: string;
      phone?: string;
    }) {
      const { data, error } = await serviceRoleClient
        .from("appointments")
        .insert({
          service_id: params.serviceId,
          designer_id: params.designerId,
          customer_name: `${TEST_MARKER} seed`,
          customer_phone: params.phone ?? testPhone(),
          customer_email: null,
          start_at: params.startAt,
          end_at: params.endAt,
          status: params.status ?? "pending",
        })
        .select("id")
        .single();
      if (error) throw error;
      if (params.email !== undefined) {
        const { error: updateError } = await serviceRoleClient
          .from("appointments")
          .update({ customer_email: params.email })
          .eq("id", data.id);
        if (updateError) throw updateError;
      }
      return data.id as string;
    }

    beforeAll(async () => {
      const { data: rows, error } = await serviceRoleClient
        .from("business_hours")
        .select("weekday, open_time, close_time, is_closed");
      if (error) throw error;
      hours = new Map();
      for (const row of rows ?? []) {
        hours.set(
          row.weekday as number,
          row.is_closed || !row.open_time || !row.close_time
            ? null
            : { openMin: toMinutes(row.open_time as string), closeMin: toMinutes(row.close_time as string) },
        );
      }
      const { data: closed, error: closedError } = await serviceRoleClient.from("closed_dates").select("date");
      if (closedError) throw closedError;
      closedDates = new Set((closed ?? []).map((r) => r.date as string));

      const day = pickOpenDay(86);
      // 測試最晚用到 openMin + 240 起算的 30 分鐘時段，所以至少要 270 分鐘。
      if (day.closeMin - day.openMin < 270) {
        throw new Error("營業時間窗少於 4.5 小時，本區塊的測試時段會放不下");
      }
    });

    it("兩位設計師同一時段各成立一筆；同一位設計師同一時段第二筆 SLOT_CONFLICT；成功時回傳實際被指派的設計師", async () => {
      const day = pickOpenDay(86);
      const t = at(day.date, day.openMin + 60);
      const {
        serviceId,
        designers: [d1, d2],
      } = await makeScenario({ designers: [{ sortOrder: 1 }, { sortOrder: 2 }] });

      const first = await create(anonClient, { serviceId, startAt: t, label: "a1", designerId: d1 });
      expect(first.ok).toBe(true);
      if (first.ok) {
        expect(first.data.designer_id).toBe(d1);
        expect(first.data.designer_name).toContain(TEST_MARKER);
      }

      const second = await create(anonClient, { serviceId, startAt: t, label: "a2", designerId: d2 });
      expect(second.ok).toBe(true);
      if (second.ok) expect(second.data.designer_id).toBe(d2);

      expect(await create(anonClient, { serviceId, startAt: t, label: "a3", designerId: d1 })).toEqual(SLOT_CONFLICT);

      const { data: rows } = await serviceRoleClient
        .from("appointments")
        .select("designer_id")
        .eq("service_id", serviceId);
      expect((rows ?? []).map((r) => r.designer_id).sort()).toEqual([d1, d2].sort());
    });

    it("資料庫層級：同一位設計師同時段不能有第二筆有效預約（23P01），不同設計師可以，designer_id 不可為 null", async () => {
      const day = pickOpenDay(86);
      const t = at(day.date, day.openMin + 120);
      const end = at(day.date, day.openMin + 150);
      const {
        serviceId,
        designers: [d1, d2],
      } = await makeScenario({ designers: [{}, {}] });

      await seedAppointment({ serviceId, designerId: d1, startAt: t, endAt: end });
      const overlap = await serviceRoleClient.from("appointments").insert({
        service_id: serviceId,
        designer_id: d1,
        customer_name: `${TEST_MARKER} dup`,
        start_at: t,
        end_at: end,
      });
      expect(overlap.error?.code).toBe("23P01");
      expect(overlap.error?.message).toContain("appointments_no_overlap");

      await seedAppointment({ serviceId, designerId: d2, startAt: t, endAt: end });

      // 已取消的預約不佔用時段：同一位設計師同一時段可以先有一筆已取消、再有一筆有效的。
      const cancelledStart = at(day.date, day.openMin + 180);
      const cancelledEnd = at(day.date, day.openMin + 210);
      await seedAppointment({
        serviceId,
        designerId: d1,
        startAt: cancelledStart,
        endAt: cancelledEnd,
        status: "cancelled",
      });
      await seedAppointment({ serviceId, designerId: d1, startAt: cancelledStart, endAt: cancelledEnd });

      const noDesigner = await serviceRoleClient.from("appointments").insert({
        service_id: serviceId,
        customer_name: `${TEST_MARKER} nodesigner`,
        start_at: at(day.date, day.openMin + 30),
        end_at: at(day.date, day.openMin + 60),
      });
      expect(noDesigner.error?.code).toBe("23502");
    });

    it("指定設計師不合格（不存在／停用／沒開服務／請假）時：時段是空陣列，建立預約的回應完全相同；90 天外一律 VALIDATION_ERROR", async () => {
      const day = pickOpenDay(86);
      const t = at(day.date, day.openMin + 60);
      const {
        serviceId,
        designers: [eligible, inactive, noService, onLeave],
      } = await makeScenario({
        designers: [{}, { isActive: false }, { link: false }, { leaveDate: day.date }],
      });
      const ineligible = [inactive, noService, onLeave, randomUUID()];

      // 合格的設計師對照組：有時段。
      expect(startsOf(await slots(anonClient, serviceId, day.date, eligible)).length).toBeGreaterThan(0);

      for (const designerId of ineligible) {
        expect(await slots(anonClient, serviceId, day.date, designerId)).toEqual({ ok: true, data: [] });
        expect(await create(anonClient, { serviceId, startAt: t, label: "ine", designerId })).toEqual(SLOT_CONFLICT);
      }

      // 時段被佔滿的合格設計師，回應也和上面一樣（五種情況在單次回應中看起來完全一樣）。
      await seedAppointment({ serviceId, designerId: eligible, startAt: t, endAt: at(day.date, day.openMin + 90) });
      expect(await create(anonClient, { serviceId, startAt: t, label: "full", designerId: eligible })).toEqual(
        SLOT_CONFLICT,
      );

      // 90 天外：合格與不合格設計師都回同一個 VALIDATION_ERROR，不能拿來探測設計師狀態。
      const far = pickOpenDay(100, { beyondHorizon: true });
      const farStart = at(far.date, far.openMin + 60);
      for (const designerId of [eligible, ...ineligible]) {
        expect(await create(anonClient, { serviceId, startAt: farStart, label: "far", designerId })).toEqual({
          ok: false,
          error_code: "VALIDATION_ERROR",
          message: "start_at out of allowed range",
        });
      }
    });

    it("不指定成功後：資料列與回傳完全一致（designer_id、設計師名稱、時間、顧客、狀態）", async () => {
      const day = pickOpenDay(86);
      const t = at(day.date, day.openMin + 60);
      const {
        serviceId,
        designers: [d1],
      } = await makeScenario({ designers: [{}] });
      const phone = testPhone();

      const result = await create(anonClient, { serviceId, startAt: t, label: "readback", phone });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const { data: designer } = await serviceRoleClient.from("designers").select("name").eq("id", d1).single();
      expect(result.data.designer_id).toBe(d1);
      expect(result.data.designer_name).toBe(designer?.name);

      const { data: rows, error } = await serviceRoleClient
        .from("appointments")
        .select(
          "designer_id, service_id, customer_id, customer_name, customer_phone, customer_email, status, start_at, end_at",
        )
        .eq("service_id", serviceId);
      expect(error).toBeNull();
      expect(rows).toHaveLength(1);
      const row = rows![0];
      expect(row).toMatchObject({
        designer_id: d1,
        service_id: serviceId,
        customer_name: `${TEST_MARKER} readback`,
        customer_phone: phone,
        customer_email: null,
        status: "pending",
      });
      expect(row.customer_id).toBeTruthy();
      expect(ms(row.start_at)).toBe(ms(t));
      expect(ms(row.end_at)).toBe(ms(result.data.end_at));
      expect(ms(result.data.end_at) - ms(t)).toBe(30 * 60_000);

      const { data: customer } = await serviceRoleClient
        .from("customers")
        .select("name, phone")
        .eq("id", row.customer_id)
        .single();
      expect(customer).toEqual({ name: `${TEST_MARKER} readback`, phone });
    });

    describe("不指定且候選名單含不合格設計師（停用／沒開服務／請假）", () => {
      it("不合格者的 sort_order 最小也不會被指派；時段聯集等於合格設計師自己的時段；請假只擋請假那一天", async () => {
        const day = pickOpenDay(86);
        const day2 = pickOpenDayAfter(day);
        const t = at(day.date, day.openMin + 60);
        const {
          serviceId,
          designers: [inactive, noService, onLeave, eligible],
        } = await makeScenario({
          designers: [
            { sortOrder: 1, isActive: false },
            { sortOrder: 2, link: false },
            { sortOrder: 3, leaveDate: day.date },
            { sortOrder: 9 },
          ],
        });

        // 聯集：不合格者各自的空檔不能被算進去，結果必須等於合格設計師自己的時段。
        const union = startsOf(await slots(anonClient, serviceId, day.date));
        const own = startsOf(await slots(anonClient, serviceId, day.date, eligible));
        expect(union.length).toBeGreaterThan(0);
        expect(union).toEqual(own);
        for (const designerId of [inactive, noService, onLeave]) {
          expect(await slots(anonClient, serviceId, day.date, designerId)).toEqual({ ok: true, data: [] });
        }

        // 不指定建立預約：必須指派給唯一合格的設計師。
        const result = await create(anonClient, { serviceId, startAt: t, label: "elig" });
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.data.designer_id).toBe(eligible);

        // 該時段合格設計師已被佔滿 → 不指定時段聯集不含 t，再約 t 回 SLOT_CONFLICT（不能指派給不合格者）。
        expect(startsOf(await slots(anonClient, serviceId, day.date))).not.toContain(ms(t));
        expect(await create(anonClient, { serviceId, startAt: t, label: "elig2" })).toEqual(SLOT_CONFLICT);

        // 請假只擋請假那一天：隔天同一位設計師照常可預約（指定與不指定都可以）。
        expect(startsOf(await slots(anonClient, serviceId, day2.date, onLeave)).length).toBeGreaterThan(0);
        const nextDay = await create(anonClient, {
          serviceId,
          startAt: at(day2.date, day2.openMin + 60),
          label: "leave-next-day",
          designerId: onLeave,
        });
        expect(nextDay.ok).toBe(true);
        if (nextDay.ok) expect(nextDay.data.designer_id).toBe(onLeave);
      });

      it("候選全部不合格：時段聯集是空陣列，建立預約 SLOT_CONFLICT", async () => {
        const day = pickOpenDay(86);
        const { serviceId } = await makeScenario({
          designers: [{ isActive: false }, { link: false }, { leaveDate: day.date }],
        });

        expect(await slots(anonClient, serviceId, day.date)).toEqual({ ok: true, data: [] });
        expect(await create(anonClient, { serviceId, startAt: at(day.date, day.openMin + 60), label: "none" })).toEqual(
          SLOT_CONFLICT,
        );
      });
    });

    it("不指定：時段是聯集；指定時只看該設計師；回應只有時間、不含設計師資訊", async () => {
      const day = pickOpenDay(86);
      const t = at(day.date, day.openMin + 60);
      const {
        serviceId,
        designers: [d1, d2],
      } = await makeScenario({ designers: [{ sortOrder: 1 }, { sortOrder: 2 }] });

      expect(startsOf(await slots(anonClient, serviceId, day.date))).toContain(ms(t));

      await create(anonClient, { serviceId, startAt: t, label: "u1", designerId: d1 });
      expect(startsOf(await slots(anonClient, serviceId, day.date, d1))).not.toContain(ms(t));
      expect(startsOf(await slots(anonClient, serviceId, day.date, d2))).toContain(ms(t));
      expect(startsOf(await slots(anonClient, serviceId, day.date))).toContain(ms(t));

      await create(anonClient, { serviceId, startAt: t, label: "u2", designerId: d2 });
      expect(startsOf(await slots(anonClient, serviceId, day.date))).not.toContain(ms(t));

      const all = await slots(anonClient, serviceId, day.date);
      expect(all.ok).toBe(true);
      if (all.ok) {
        for (const slot of all.data) expect(Object.keys(slot).sort()).toEqual(["end_at", "start_at"]);
      }
      expect(Object.keys(all).sort()).toEqual(["data", "ok"]);
    });

    describe("不指定的自動指派規則：當天有效預約數 → sort_order → id", () => {
      it("當天預約數最少的設計師優先（即使 sort_order 較大）", async () => {
        const day = pickOpenDay(86);
        const {
          serviceId,
          designers: [d1, d2],
        } = await makeScenario({ designers: [{ sortOrder: 1 }, { sortOrder: 2 }] });
        await seedAppointment({
          serviceId,
          designerId: d1,
          startAt: at(day.date, day.openMin + 30),
          endAt: at(day.date, day.openMin + 60),
        });

        const result = await create(anonClient, {
          serviceId,
          startAt: at(day.date, day.openMin + 120),
          label: "fewest",
        });
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.data.designer_id).toBe(d2);
      });

      it("預約數相同時取 sort_order 較小者；已取消與已完成的預約不計入有效預約數", async () => {
        const day = pickOpenDay(86);
        const {
          serviceId,
          designers: [dLarge, dSmall],
        } = await makeScenario({ designers: [{ sortOrder: 2 }, { sortOrder: 1 }] });
        // dSmall 有一筆待服務預約（計入），dLarge 只有已取消與已完成（不計入）→ dLarge 的當天預約數較少。
        await seedAppointment({
          serviceId,
          designerId: dSmall,
          startAt: at(day.date, day.openMin + 30),
          endAt: at(day.date, day.openMin + 60),
        });
        await seedAppointment({
          serviceId,
          designerId: dLarge,
          startAt: at(day.date, day.openMin + 30),
          endAt: at(day.date, day.openMin + 60),
          status: "cancelled",
        });
        await seedAppointment({
          serviceId,
          designerId: dLarge,
          startAt: at(day.date, day.openMin + 90),
          endAt: at(day.date, day.openMin + 120),
          status: "completed",
        });

        const first = await create(anonClient, {
          serviceId,
          startAt: at(day.date, day.openMin + 180),
          label: "notcounted",
        });
        expect(first.ok).toBe(true);
        if (first.ok) expect(first.data.designer_id).toBe(dLarge);

        // 此時 dLarge 有 1 筆有效預約、dSmall 也是 1 筆 → 平手，取 sort_order 較小的 dSmall。
        const second = await create(anonClient, {
          serviceId,
          startAt: at(day.date, day.openMin + 210),
          label: "tiebreak",
        });
        expect(second.ok).toBe(true);
        if (second.ok) expect(second.data.designer_id).toBe(dSmall);
      });

      it("預約數與 sort_order 都相同時取 id 較小者", async () => {
        const day = pickOpenDay(86);
        // 建立順序刻意與 id 順序相反（先建 ffff…、最後建 0000…），這樣「取 id 較小者」不會因為碰巧等於建立順序而通過。
        const smallest = "00000000-0000-4000-8000-000000000001";
        const { serviceId } = await makeScenario({
          designers: [
            { id: "ffffffff-ffff-4fff-8fff-ffffffffffff", sortOrder: 5 },
            { id: "88888888-8888-4888-8888-888888888888", sortOrder: 5 },
            { id: smallest, sortOrder: 5 },
          ],
        });
        const expected = smallest;

        const result = await create(anonClient, { serviceId, startAt: at(day.date, day.openMin + 60), label: "byid" });
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.data.designer_id).toBe(expected);
      });
    });

    describe("併發", () => {
      it("兩筆「不指定」同時送同一時段、兩位候選 → 兩筆都成功且分屬不同設計師", async () => {
        const day = pickOpenDay(86);
        const t = at(day.date, day.openMin + 60);
        const { serviceId, designers } = await makeScenario({ designers: [{ sortOrder: 1 }, { sortOrder: 2 }] });

        const results = await Promise.all([
          create(anonClient, { serviceId, startAt: t, label: "p1" }),
          create(anonClient, { serviceId, startAt: t, label: "p2" }),
        ]);
        expect(results.every((r) => r.ok)).toBe(true);
        const assigned = results.map((r) => (r.ok ? r.data.designer_id : ""));
        expect(new Set(assigned).size).toBe(2);
        expect([...assigned].sort()).toEqual([...designers].sort());
      });

      it("三筆「不指定」同時送同一時段、兩位候選 → 兩筆成功、第三筆 SLOT_CONFLICT，而且 customers 沒有多出孤兒列", async () => {
        const day = pickOpenDay(86);
        const t = at(day.date, day.openMin + 60);
        const { serviceId } = await makeScenario({ designers: [{ sortOrder: 1 }, { sortOrder: 2 }] });

        const labels = ["q1", "q2", "q3"];
        const results = await Promise.all(labels.map((label) => create(anonClient, { serviceId, startAt: t, label })));
        expect(results.filter((r) => r.ok)).toHaveLength(2);
        const failed = results.map((r, i) => ({ r, label: labels[i] })).filter(({ r }) => !r.ok);
        expect(failed).toHaveLength(1);
        expect(failed[0].r).toEqual(SLOT_CONFLICT);

        const { data: loserCustomers } = await serviceRoleClient
          .from("customers")
          .select("id")
          .eq("name", `${TEST_MARKER} ${failed[0].label}`);
        expect(loserCustomers).toEqual([]);

        const { data: winnerCustomers } = await serviceRoleClient
          .from("customers")
          .select("id")
          .in(
            "name",
            labels.filter((l) => l !== failed[0].label).map((l) => `${TEST_MARKER} ${l}`),
          );
        expect(winnerCustomers).toHaveLength(2);
      });
    });

    describe("併發壓力", () => {
      it("同一時段同時送 8 筆「不指定」給 3 位設計師：恰好 3 筆成功且分屬不同設計師，其餘都是 SLOT_CONFLICT（沒有任何 INTERNAL_ERROR），沒有孤兒 customers", async () => {
        const day = pickOpenDay(86);
        const t = at(day.date, day.openMin + 60);
        const { serviceId, designers } = await makeScenario({
          designers: [{ sortOrder: 1 }, { sortOrder: 2 }, { sortOrder: 3 }],
        });

        const labels = Array.from({ length: 8 }, (_, i) => `s${i}`);
        const results = await Promise.all(labels.map((label) => create(anonClient, { serviceId, startAt: t, label })));

        const succeeded = results.filter((r) => r.ok);
        expect(succeeded).toHaveLength(3);
        const assigned = succeeded.map((r) => (r.ok ? r.data.designer_id : ""));
        expect([...assigned].sort()).toEqual([...designers].sort());

        // 失敗的必須全部是 SLOT_CONFLICT：漏接 deadlock_detected 之類的退化會在這裡變成 INTERNAL_ERROR。
        const failed = results.filter((r) => !r.ok);
        expect(failed).toHaveLength(5);
        for (const r of failed) expect(r).toEqual(SLOT_CONFLICT);

        const failedLabels = labels.filter((_, i) => !results[i].ok).map((l) => `${TEST_MARKER} ${l}`);
        const { data: orphans } = await serviceRoleClient.from("customers").select("id").in("name", failedLabels);
        expect(orphans).toEqual([]);
        const successLabels = labels.filter((_, i) => results[i].ok).map((l) => `${TEST_MARKER} ${l}`);
        const { data: kept } = await serviceRoleClient.from("customers").select("id").in("name", successLabels);
        expect(kept).toHaveLength(3);
      });
    });

    describe("與既有規則交叉：指定與不指定兩種模式都仍然生效", () => {
      async function expectBlockedBothModes(
        serviceId: string,
        designerId: string,
        date: string,
        startAt: string,
        expectedCreate: unknown,
      ) {
        for (const mode of [designerId, null]) {
          expect(await slots(anonClient, serviceId, date, mode)).toEqual({ ok: true, data: [] });
          expect(await create(anonClient, { serviceId, startAt, label: "blocked", designerId: mode })).toEqual(
            expectedCreate,
          );
        }
      }

      it("特殊公休日（closed_dates）", async () => {
        const day = pickOpenDay(60);
        const {
          serviceId,
          designers: [d1],
        } = await makeScenario({ designers: [{}] });
        // 對照組：公休前同一天有時段，證明之後的空陣列是因為公休，不是因為超出視野或其他原因。
        expect(startsOf(await slots(anonClient, serviceId, day.date, d1)).length).toBeGreaterThan(0);
        const { error } = await serviceRoleClient.from("closed_dates").insert({ date: day.date });
        if (error) throw error;
        try {
          await expectBlockedBothModes(serviceId, d1, day.date, at(day.date, day.openMin + 60), SLOT_CONFLICT);
        } finally {
          const { error: deleteError } = await serviceRoleClient.from("closed_dates").delete().eq("date", day.date);
          if (deleteError) throw deleteError;
        }
      });

      it("每週固定公休", async (ctx) => {
        let closedDate: string | undefined;
        // 只從視野內（60～89 天）挑公休日：超過第 90 天 get_available_slots 無論如何都回空陣列。
        for (let i = 60; i < 90 && !closedDate; i++) {
          const date = addDays(taipeiToday(), i);
          if (!hours.get(weekdayOf(date))) closedDate = date;
        }
        if (!closedDate) return ctx.skip();
        const {
          serviceId,
          designers: [d1],
        } = await makeScenario({ designers: [{}] });
        // 對照組：同一服務在營業日有時段。
        expect(startsOf(await slots(anonClient, serviceId, pickOpenDay(60).date, d1)).length).toBeGreaterThan(0);
        await expectBlockedBothModes(serviceId, d1, closedDate, at(closedDate, 11 * 60), SLOT_CONFLICT);
      });

      it("營業時間邊界：開門前與打烊後（含服務時長跨過打烊）都被拒", async () => {
        const day = pickOpenDay(86);
        const {
          serviceId,
          designers: [d1],
        } = await makeScenario({ designers: [{}] });
        for (const mode of [d1, null]) {
          expect(
            await create(anonClient, {
              serviceId,
              startAt: at(day.date, day.openMin - 30),
              label: "early",
              designerId: mode,
            }),
          ).toEqual(SLOT_CONFLICT);
          expect(
            await create(anonClient, {
              serviceId,
              startAt: at(day.date, day.closeMin - 15),
              label: "late",
              designerId: mode,
            }),
          ).toEqual(SLOT_CONFLICT);
        }
      });

      it("提前量：時段落在提前量內，時段查詢是空陣列、建立預約 VALIDATION_ERROR", async () => {
        const day = pickOpenDay(10);
        const {
          serviceId,
          designers: [d1],
        } = await makeScenario({ designers: [{}] });
        const { data: snapshot, error: snapshotError } = await serviceRoleClient
          .from("booking_policy")
          .select("min_lead_time_hours")
          .eq("id", 1)
          .single();
        if (snapshotError) throw snapshotError;
        // 印出原始值，供行程被強制中斷時人工還原（比照 tests/booking.integration.test.ts）。
        console.log(
          `[designers.integration.test] 原始 booking_policy.min_lead_time_hours = ${snapshot.min_lead_time_hours}`,
        );
        try {
          const { error } = await serviceRoleClient
            .from("booking_policy")
            .update({ min_lead_time_hours: 720 })
            .eq("id", 1);
          if (error) throw error;
          await expectBlockedBothModes(serviceId, d1, day.date, at(day.date, day.openMin + 60), {
            ok: false,
            error_code: "VALIDATION_ERROR",
            message: "start_at out of allowed range",
          });
        } finally {
          // 還原失敗就重試一次；仍失敗時錯誤訊息帶上原始值，方便人工還原（DB 會停在 720）。
          let restoreError: unknown = null;
          for (let attempt = 0; attempt < 2; attempt++) {
            const { error } = await serviceRoleClient
              .from("booking_policy")
              .update({ min_lead_time_hours: snapshot.min_lead_time_hours })
              .eq("id", 1);
            restoreError = error;
            if (!error) break;
          }
          if (restoreError) {
            throw new Error(
              `還原 booking_policy.min_lead_time_hours 失敗，請手動改回 ${snapshot.min_lead_time_hours}：${JSON.stringify(restoreError)}`,
            );
          }
        }
      });

      it("不指定、兩位候選、第一順位被 buffer 擋住：改派給另一位（不是 SLOT_CONFLICT）；時段聯集仍列出該時段", async () => {
        const day = pickOpenDay(86);
        const t = day.openMin + 60;
        const {
          serviceId,
          designers: [d1, d2],
        } = await makeScenario({
          designers: [{ sortOrder: 1 }, { sortOrder: 2 }],
          durationMinutes: 30,
          bufferMinutes: 30,
        });
        await seedAppointment({ serviceId, designerId: d1, startAt: at(day.date, t), endAt: at(day.date, t + 30) });

        // t+30 落在 d1 既有預約的 buffer 內，d2 空閒：d1 的時段沒有，聯集有。
        expect(startsOf(await slots(anonClient, serviceId, day.date, d1))).not.toContain(ms(at(day.date, t + 30)));
        expect(startsOf(await slots(anonClient, serviceId, day.date))).toContain(ms(at(day.date, t + 30)));

        const result = await create(anonClient, { serviceId, startAt: at(day.date, t + 30), label: "reroute" });
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.data.designer_id).toBe(d2);
      });

      it("buffer 與非 30 倍數的時長：45 分鐘＋30 分鐘 buffer，依序建立每個列出的時段都成功，直到清單變空", async () => {
        const day = pickOpenDay(86);
        const {
          serviceId,
          designers: [d1],
        } = await makeScenario({ designers: [{}], durationMinutes: 45, bufferMinutes: 30 });

        let created = 0;
        for (let i = 0; i < 40; i++) {
          const listed = await slots(anonClient, serviceId, day.date);
          expect(listed.ok).toBe(true);
          if (!listed.ok || listed.data.length === 0) break;
          const first = listed.data[0];
          const result = await create(anonClient, {
            serviceId,
            startAt: first.start_at,
            label: `b45-${i}`,
            designerId: i % 2 === 0 ? d1 : null,
          });
          expect(result.ok, first.start_at).toBe(true);
          created += 1;
        }
        expect(created).toBeGreaterThan(1);
        expect(await slots(anonClient, serviceId, day.date)).toEqual({ ok: true, data: [] });
      });

      it("跨服務的 buffer：既有預約屬於另一個 buffer 較大的服務，候選時段要避開「既有預約自己的 buffer」", async () => {
        const day = pickOpenDay(86);
        const t = day.openMin + 60;
        const {
          serviceId,
          designers: [d1],
        } = await makeScenario({ designers: [{}], durationMinutes: 30, bufferMinutes: 0 });
        const bigBufferService = await makeExtraService([d1], { durationMinutes: 30, bufferMinutes: 60 });
        // 既有預約屬於 bigBufferService：佔用 [t, t+30)，加上它自己的 60 分鐘 buffer 到 t+90。
        await seedAppointment({
          serviceId: bigBufferService,
          designerId: d1,
          startAt: at(day.date, t),
          endAt: at(day.date, t + 30),
        });

        const listed = startsOf(await slots(anonClient, serviceId, day.date, d1));
        expect(listed).not.toContain(ms(at(day.date, t + 30)));
        expect(listed).not.toContain(ms(at(day.date, t + 60)));
        expect(listed).toContain(ms(at(day.date, t + 90)));

        expect(
          await create(anonClient, { serviceId, startAt: at(day.date, t + 60), label: "xbuf", designerId: d1 }),
        ).toEqual(SLOT_CONFLICT);
        const ok = await create(anonClient, {
          serviceId,
          startAt: at(day.date, t + 90),
          label: "xbuf-ok",
          designerId: d1,
        });
        expect(ok.ok).toBe(true);
      });

      it("buffer：擠進既有預約的 buffer、或自己的 buffer 擠進既有預約，指定與不指定都 SLOT_CONFLICT；時段查詢與建立預約判斷一致", async () => {
        const day = pickOpenDay(86);
        const t = day.openMin + 60;
        const {
          serviceId,
          designers: [d1],
        } = await makeScenario({ designers: [{}], durationMinutes: 30, bufferMinutes: 30 });
        // 既有預約佔用 [t, t+30)，加上它自己的 buffer 到 t+60。
        await seedAppointment({ serviceId, designerId: d1, startAt: at(day.date, t), endAt: at(day.date, t + 30) });

        const listed = startsOf(await slots(anonClient, serviceId, day.date, d1));
        expect(listed).not.toContain(ms(at(day.date, t + 30)));
        expect(listed).toContain(ms(at(day.date, t + 60)));

        for (const mode of [d1, null]) {
          expect(
            await create(anonClient, { serviceId, startAt: at(day.date, t + 30), label: "inbuf", designerId: mode }),
          ).toEqual(SLOT_CONFLICT);
        }

        // 反方向：既有預約在 t+150，候選時段 t+120（含自己的 30 分鐘 buffer 到 t+180）會擠進去。
        await seedAppointment({
          serviceId,
          designerId: d1,
          startAt: at(day.date, t + 150),
          endAt: at(day.date, t + 180),
        });
        expect(startsOf(await slots(anonClient, serviceId, day.date, d1))).not.toContain(ms(at(day.date, t + 120)));
        for (const mode of [d1, null]) {
          expect(
            await create(anonClient, { serviceId, startAt: at(day.date, t + 120), label: "ownbuf", designerId: mode }),
          ).toEqual(SLOT_CONFLICT);
        }

        // 剛好貼齊 buffer 邊界（t+60）可以成立。
        const ok = await create(anonClient, {
          serviceId,
          startAt: at(day.date, t + 60),
          label: "edge",
          designerId: d1,
        });
        expect(ok.ok).toBe(true);
      });

      it("只有一位設計師、30 分鐘無 buffer 時，get_available_slots 列出的每個時段都能成功建立，建完之後時段清單變空", async () => {
        const day = pickOpenDay(87);
        const {
          serviceId,
          designers: [d1],
        } = await makeScenario({ designers: [{}] });

        const listed = await slots(anonClient, serviceId, day.date);
        expect(listed.ok).toBe(true);
        if (!listed.ok) return;
        expect(listed.data.length).toBeGreaterThan(0);

        let index = 0;
        for (const slot of listed.data) {
          const result = await create(anonClient, {
            serviceId,
            startAt: slot.start_at,
            label: `all${index}`,
            designerId: index % 2 === 0 ? d1 : null,
          });
          expect(result.ok, slot.start_at).toBe(true);
          index += 1;
        }
        expect(await slots(anonClient, serviceId, day.date)).toEqual({ ok: true, data: [] });
      });
    });

    describe("BOOKING_LIMIT：電話跨設計師合計；email 上限", () => {
      it("同電話對三位設計師各約一筆後，第四筆被拒（BOOKING_LIMIT_EXCEEDED）", async () => {
        const day = pickOpenDay(86);
        const t = at(day.date, day.openMin + 60);
        const {
          serviceId,
          designers: [d1, d2, d3],
        } = await makeScenario({ designers: [{}, {}, {}] });
        const phone = testPhone();

        for (const [i, designerId] of [d1, d2, d3].entries()) {
          const result = await create(anonClient, { serviceId, startAt: t, label: `ph${i}`, designerId, phone });
          expect(result.ok, `第 ${i + 1} 筆`).toBe(true);
        }
        const fourth = await create(anonClient, {
          serviceId,
          startAt: at(day.date, day.openMin + 120),
          label: "ph3",
          designerId: d1,
          phone,
        });
        expect(fourth).toEqual({
          ok: false,
          error_code: "BOOKING_LIMIT_EXCEEDED",
          message: "too many pending appointments",
        });
      });

      it("同 email 已有 3 筆未過期的待服務預約（大小寫與前後空白不同視為同一個）→ 第 4 筆被拒；未填 email 不受影響", async () => {
        const day = pickOpenDay(86);
        const email = `${TEST_MARKER.toLowerCase()}-lim@example.invalid`;
        const {
          serviceId,
          designers: [d1],
        } = await makeScenario({ designers: [{}] });

        // 既有預約的 email 刻意寫成不同的版本，驗證比對用的是正規化後的 key：大小寫、前後空白、`+標籤`、
        // 網域結尾的點都視為同一個 email。
        const local = email.split("@")[0];
        const variants = [email.toUpperCase(), `  ${email}  `, `${local}+promo@example.invalid.`];
        for (const [i, variant] of variants.entries()) {
          await seedAppointment({
            serviceId,
            designerId: d1,
            startAt: at(day.date, day.openMin + 30 * (i + 1)),
            endAt: at(day.date, day.openMin + 30 * (i + 2)),
            email: variant,
          });
        }

        const rejected = await create(anonClient, {
          serviceId,
          startAt: at(day.date, day.openMin + 240),
          label: "emaillimit",
          email: `${local}+other@Example.Invalid.`,
          designerId: d1,
        });
        expect(rejected).toEqual({
          ok: false,
          error_code: "BOOKING_LIMIT_EXCEEDED",
          message: "too many pending appointments",
        });

        // 「不指定」模式同樣受 email 上限限制。
        const rejectedUnspecified = await create(anonClient, {
          serviceId,
          startAt: at(day.date, day.openMin + 240),
          label: "emaillimit2",
          email,
        });
        expect(rejectedUnspecified).toEqual({
          ok: false,
          error_code: "BOOKING_LIMIT_EXCEEDED",
          message: "too many pending appointments",
        });

        // 未填 email（null）不受 email 上限影響；這筆不帶 email，不會觸發寄信 webhook。
        const noEmail = await create(anonClient, {
          serviceId,
          startAt: at(day.date, day.openMin + 240),
          label: "noemail",
          designerId: d1,
        });
        expect(noEmail.ok).toBe(true);
      });

      it("同一支電話同時送出多筆（不同設計師）：advisory lock 讓上限不會被併發繞過，正好 3 筆成功", async () => {
        const day = pickOpenDay(86);
        const t = at(day.date, day.openMin + 60);
        const { serviceId, designers } = await makeScenario({ designers: [{}, {}, {}, {}, {}] });
        const phone = testPhone();

        const results = await Promise.all(
          designers.map((designerId, i) =>
            create(anonClient, { serviceId, startAt: t, label: `pc${i}`, designerId, phone }),
          ),
        );
        expect(results.filter((r) => r.ok)).toHaveLength(3);
        const rejected = results.filter((r) => !r.ok);
        expect(rejected).toHaveLength(2);
        for (const r of rejected) {
          expect(r).toEqual({
            ok: false,
            error_code: "BOOKING_LIMIT_EXCEEDED",
            message: "too many pending appointments",
          });
        }
      });

      it("檢查順序（特徵化）：電話已達上限的人去約一個已被佔的時段，得到 SLOT_CONFLICT 而不是 BOOKING_LIMIT_EXCEEDED", async () => {
        // BOOKING_LIMIT 在設計師候選清單之後檢查（0018 檔頭、decisions.md 已記為殘留）；這個案例把順序釘住，
        // 日後誰調換順序、讓回應不同，會在這裡被抓到。
        const day = pickOpenDay(86);
        const t = at(day.date, day.openMin + 60);
        const {
          serviceId,
          designers: [d1, d2, d3],
        } = await makeScenario({ designers: [{}, {}, {}] });
        const phone = testPhone();
        for (const [i, designerId] of [d1, d2, d3].entries()) {
          expect((await create(anonClient, { serviceId, startAt: t, label: `ord${i}`, designerId, phone })).ok).toBe(
            true,
          );
        }
        // 三位設計師在 t 都被佔了；同一支電話（已達上限）再約 t：候選清單為空，先回 SLOT_CONFLICT。
        expect(await create(anonClient, { serviceId, startAt: t, label: "ord3", designerId: d1, phone })).toEqual(
          SLOT_CONFLICT,
        );
        expect(await create(anonClient, { serviceId, startAt: t, label: "ord4", phone })).toEqual(SLOT_CONFLICT);
      });

      it("email 上限跨設計師合計，而且 confirmed 也計入", async () => {
        const day = pickOpenDay(86);
        const email = `${TEST_MARKER.toLowerCase()}-xd@example.invalid`;
        const {
          serviceId,
          designers: [d1, d2, d3],
        } = await makeScenario({ designers: [{}, {}, {}] });
        const t = day.openMin + 30;
        await seedAppointment({
          serviceId,
          designerId: d1,
          startAt: at(day.date, t),
          endAt: at(day.date, t + 30),
          email,
        });
        await seedAppointment({
          serviceId,
          designerId: d2,
          startAt: at(day.date, t),
          endAt: at(day.date, t + 30),
          email,
          status: "confirmed",
        });
        await seedAppointment({
          serviceId,
          designerId: d3,
          startAt: at(day.date, t),
          endAt: at(day.date, t + 30),
          email,
        });

        for (const designerId of [d1, null]) {
          expect(
            await create(anonClient, { serviceId, startAt: at(day.date, t + 120), label: "xd", email, designerId }),
          ).toEqual({ ok: false, error_code: "BOOKING_LIMIT_EXCEEDED", message: "too many pending appointments" });
        }
      });

      it("email 上限只計未過期的待服務預約：已取消與已過期的不計入；不同 email 不會被誤判為同一個", async () => {
        const day = pickOpenDay(86);
        const email = `${TEST_MARKER.toLowerCase()}-ok@example.invalid`;
        const {
          serviceId,
          designers: [d1],
        } = await makeScenario({ designers: [{}] });
        const past = new Date(Date.now() - 2 * 86_400_000);
        const pastEnd = new Date(past.getTime() + 30 * 60_000);

        await seedAppointment({
          serviceId,
          designerId: d1,
          startAt: at(day.date, day.openMin + 30),
          endAt: at(day.date, day.openMin + 60),
          email,
        });
        await seedAppointment({
          serviceId,
          designerId: d1,
          startAt: at(day.date, day.openMin + 60),
          endAt: at(day.date, day.openMin + 90),
          email,
        });
        await seedAppointment({
          serviceId,
          designerId: d1,
          startAt: at(day.date, day.openMin + 90),
          endAt: at(day.date, day.openMin + 120),
          email,
          status: "cancelled",
        });
        await seedAppointment({
          serviceId,
          designerId: d1,
          startAt: past.toISOString(),
          endAt: pastEnd.toISOString(),
          email,
        });
        // 另一個不同信箱的待服務預約：若正規化過度（把不同 email 併成同一個 key），這裡會讓計數變成 3 而被拒。
        await seedAppointment({
          serviceId,
          designerId: d1,
          startAt: at(day.date, day.openMin + 120),
          endAt: at(day.date, day.openMin + 150),
          email: `${TEST_MARKER.toLowerCase()}-other@example.invalid`,
        });

        // 有效且未過期的只有 2 筆（< 3），所以這一筆會成立。這是本區塊唯一會真的成立一筆帶 email 的預約
        // （見上方說明）：email 是 @example.invalid，Resend 於 API 層拒絕，不會真的寄出。
        const result = await create(anonClient, {
          serviceId,
          startAt: at(day.date, day.openMin + 180),
          label: "emailok",
          email,
          designerId: d1,
        });
        expect(result.ok).toBe(true);
      });
    });

    describe("權限與效能證據", () => {
      it("anon、authenticated（店長 session）、service_role 都能呼叫兩支 RPC（套用前實測三者皆可；pg_proc.proacl 的前後比對見驗證報告）", async () => {
        const day = pickOpenDay(86);
        const { serviceId } = await makeScenario({ designers: [{}] });
        for (const [name, client] of [
          ["anon", anonClient],
          ["authenticated", adminClient],
          ["service_role", serviceRoleClient],
        ] as const) {
          const envelope = await slots(client, serviceId, day.date);
          expect(envelope.ok, `${name} get_available_slots`).toBe(true);
          // 姓名為空 → VALIDATION_ERROR：證明函式本身可呼叫，又不會寫入任何資料。
          const { data, error } = await client.rpc("create_appointment", {
            p_service_id: serviceId,
            p_start_at: at(day.date, day.openMin + 60),
            p_customer_name: "",
            p_customer_phone: "0912345678",
            p_customer_email: null,
          });
          expect(error, `${name} create_appointment`).toBeNull();
          expect((data as { error_code?: string }).error_code).toBe("VALIDATION_ERROR");
        }
      });

      it("anon 與 authenticated 不能直接呼叫兩支內部判斷函式（42501）", async () => {
        const args1 = { p_designer_id: randomUUID(), p_service_id: randomUUID(), p_date: "2099-01-01" };
        const args2 = {
          p_designer_id: randomUUID(),
          p_start_at: "2099-01-01T02:00:00Z",
          p_end_at: "2099-01-01T02:30:00Z",
          p_buffer_minutes: 0,
        };
        for (const client of [anonClient, adminClient]) {
          const eligible = await client.rpc("_designer_is_eligible", args1);
          expect(eligible.error?.code).toBe("42501");
          const free = await client.rpc("_designer_is_free", args2);
          expect(free.error?.code).toBe("42501");
        }
      });

      it("耗時記錄：三位設計師的「不指定」時段查詢（只記錄含網路往返的耗時，不是 explain analyze，見驗證報告）", async () => {
        const day = pickOpenDay(86);
        const { serviceId } = await makeScenario({ designers: [{}, {}, {}] });
        const started = Date.now();
        const envelope = await slots(anonClient, serviceId, day.date);
        const elapsed = Date.now() - started;
        console.log(
          `[designers.integration.test] get_available_slots（不指定、3 位設計師、${day.date}）耗時 ${elapsed} ms（含網路往返）`,
        );
        expect(envelope.ok).toBe(true);
        expect(elapsed).toBeLessThan(5000);
      });
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

  // TASK-069：後台寫入函式，用真實 admin session 打真實專案。隔離規則：只建立／修改本檔案的 `__TEST__dz-`
  // 設計師；排序只傳入本檔案建立的設計師清單（絕不把預設設計師放進去，否則「有重複值時整份重新編號」會改到他）；
  // 不建立任何 appointments。
  describe("TASK-069：後台設計師寫入函式（真實 admin session）", () => {
    const VALID = { name: "", instagram: "", specialties: [] as string[], bio: "" };

    async function readDesigner(id: string) {
      const { data, error } = await serviceRoleClient
        .from("designers")
        .select("name, bio, specialties, instagram_handle, avatar_url, is_active, sort_order")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    }

    async function defaultDesignerSnapshot() {
      const { data, error } = await serviceRoleClient
        .from("designers")
        .select("id, sort_order, is_active, avatar_url, name")
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(1)
        .single();
      if (error) throw error;
      return data;
    }

    async function statusOf(fileUrl: string): Promise<number> {
      const res = await fetch(fileUrl);
      await res.arrayBuffer();
      return res.status;
    }

    it("createDesigner：sort_order 排在目前最大值之後、預設啟用，欄位依規則清理（去 @、去空白、簡介空白轉 null）", async () => {
      const { data: last } = await serviceRoleClient
        .from("designers")
        .select("sort_order")
        .order("sort_order", { ascending: false })
        .limit(1)
        .single();

      const result = await createDesignerAdmin(adminClient, {
        name: `  ${TEST_MARKER}-w1  `,
        instagram: " @mei.hair_01 ",
        specialties: [" 韓系剪髮 ", "漸層染"],
        bio: "  ",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      track(result.data.id);

      expect(await readDesigner(result.data.id)).toMatchObject({
        name: `${TEST_MARKER}-w1`,
        instagram_handle: "mei.hair_01",
        specialties: ["韓系剪髮", "漸層染"],
        bio: null,
        avatar_url: null,
        is_active: true,
        sort_order: (last!.sort_order as number) + 1,
      });
    });

    it("createDesigner：資料庫 check constraint 擋下繞過前端的非法值（名稱空白、IG 含空白、標籤重複），回傳通用錯誤", async () => {
      const before = (await serviceRoleClient.from("designers").select("id")).data?.length;
      for (const bad of [
        { ...VALID, name: "   " },
        { ...VALID, name: `${TEST_MARKER}-bad`, instagram: "mei hair" },
        { ...VALID, name: `${TEST_MARKER}-bad`, specialties: ["重複", "重複"] },
        { ...VALID, name: `${TEST_MARKER}-bad`, specialties: ["1", "2", "3", "4", "5", "6"] },
        { ...VALID, name: `${TEST_MARKER}-bad`, bio: "字".repeat(201) },
      ]) {
        const result = await createDesignerAdmin(adminClient, bad);
        if (result.ok) track(result.data.id);
        expect(result.ok, JSON.stringify(bad)).toBe(false);
        if (!result.ok) expect(result.error.message).toBe("發生未預期的錯誤，請稍後再試。");
      }
      expect((await serviceRoleClient.from("designers").select("id")).data?.length).toBe(before);
    });

    it("createDesigner：非管理員被 RLS 擋下", async () => {
      const result = await createDesignerAdmin(nonAdminClient, { ...VALID, name: `${TEST_MARKER}-nonadmin-create` });
      if (result.ok) track(result.data.id);
      expect(result.ok).toBe(false);
    });

    it("updateDesignerBasicInfo：admin 可更新；只動基本資料欄位，不動頭像／啟用／順序", async () => {
      const id = await createDesigner({ sort_order: 190, avatar_url: null });
      const result = await updateDesignerBasicInfo(adminClient, id, {
        name: `${TEST_MARKER}-w2`,
        instagram: "@new.handle",
        specialties: ["燙髮"],
        bio: "第一行\r\n第二行",
      });
      expect(result.ok).toBe(true);
      expect(await readDesigner(id)).toMatchObject({
        name: `${TEST_MARKER}-w2`,
        instagram_handle: "new.handle",
        specialties: ["燙髮"],
        bio: "第一行\n第二行",
        is_active: true,
        sort_order: 190,
        avatar_url: null,
      });
    });

    it("updateDesignerBasicInfo：非管理員被擋下（0 列），資料不變；非法值被資料庫擋下", async () => {
      const before = await readDesigner(activeDesignerId);
      const blocked = await updateDesignerBasicInfo(nonAdminClient, activeDesignerId, {
        ...VALID,
        name: `${TEST_MARKER}-hacked`,
      });
      expect(blocked.ok).toBe(false);
      expect(await readDesigner(activeDesignerId)).toEqual(before);

      const invalid = await updateDesignerBasicInfo(adminClient, activeDesignerId, {
        ...VALID,
        name: `${TEST_MARKER}-ok`,
        instagram: "bad handle",
      });
      expect(invalid.ok).toBe(false);
      expect(await readDesigner(activeDesignerId)).toEqual(before);
    });

    it("setDesignerActive：admin 可停用再重新啟用；非管理員不能", async () => {
      const id = await createDesigner();
      expect((await setDesignerActive(adminClient, id, false)).ok).toBe(true);
      expect((await readDesigner(id)).is_active).toBe(false);
      expect((await setDesignerActive(adminClient, id, true)).ok).toBe(true);
      expect((await readDesigner(id)).is_active).toBe(true);

      expect((await setDesignerActive(nonAdminClient, id, false)).ok).toBe(false);
      expect((await readDesigner(id)).is_active).toBe(true);
    });

    it("countFutureAppointmentsForDesigner：新設計師為 0；欄位層級授權下 head count 可用（不是 42501）", async () => {
      const id = await createDesigner();
      expect(await countFutureAppointmentsForDesigner(adminClient, id)).toEqual({ ok: true, data: 0 });

      // 對預設設計師只做唯讀查詢，確認真實資料上的查詢也能執行。
      const defaultDesigner = await defaultDesignerSnapshot();
      const real = await countFutureAppointmentsForDesigner(adminClient, defaultDesigner.id as string);
      expect(real.ok).toBe(true);
    });

    it("swapDesignerOrder：交換相鄰兩位；第一位上移、最後一位下移不變；預設設計師完全不受影響", async () => {
      const a = await createDesigner({ sort_order: 201 });
      const b = await createDesigner({ sort_order: 202 });
      const c = await createDesigner({ sort_order: 203 });
      const defaultBefore = await defaultDesignerSnapshot();
      // 只傳入本檔案建立的設計師，不含預設設計師。
      const list = [
        { id: a, sort_order: 201 },
        { id: b, sort_order: 202 },
        { id: c, sort_order: 203 },
      ];

      expect((await swapDesignerOrder(adminClient, list, 1, "up")).ok).toBe(true);
      expect([(await readDesigner(a)).sort_order, (await readDesigner(b)).sort_order]).toEqual([202, 201]);
      expect((await readDesigner(c)).sort_order).toBe(203);

      const unchanged = [
        { id: b, sort_order: 201 },
        { id: a, sort_order: 202 },
        { id: c, sort_order: 203 },
      ];
      expect((await swapDesignerOrder(adminClient, unchanged, 0, "up")).ok).toBe(true);
      expect((await swapDesignerOrder(adminClient, unchanged, 2, "down")).ok).toBe(true);
      expect([(await readDesigner(a)).sort_order, (await readDesigner(b)).sort_order, (await readDesigner(c)).sort_order]).toEqual([202, 201, 203]);

      expect(await defaultDesignerSnapshot()).toEqual(defaultBefore);
    });

    it("swapDesignerOrder：非管理員被擋下，順序不變", async () => {
      const a = await createDesigner({ sort_order: 211 });
      const b = await createDesigner({ sort_order: 212 });
      const result = await swapDesignerOrder(
        nonAdminClient,
        [
          { id: a, sort_order: 211 },
          { id: b, sort_order: 212 },
        ],
        0,
        "down",
      );
      expect(result.ok).toBe(false);
      expect([(await readDesigner(a)).sort_order, (await readDesigner(b)).sort_order]).toEqual([211, 212]);
    });

    it("頭像：上傳 → 更換（舊檔真的被刪）→ 移除（檔案真的被刪），資料列隨之更新", async () => {
      const id = await createDesigner();
      const png = () => new File([TINY_PNG], "a.png", { type: "image/png" });

      const first = await uploadDesignerAvatar(adminClient, id, png());
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(first.data.cleanupWarning).toBe(false);
      expect(first.data.url).toContain(`/designer-assets/avatar/${id}/`);
      expect((await readDesigner(id)).avatar_url).toBe(first.data.url);
      expect(await listFolder(`avatar/${id}`)).toHaveLength(1);

      // 注意：不要在刪除前對「預期被刪的網址」發請求——CDN 會快取 200（TASK-067 已記載的殘留），
      // 之後的 400／404 斷言就會因快取而失敗。公開讀取成功的證據在最後一個案例。
      const second = await uploadDesignerAvatar(adminClient, id, png());
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.data.url).not.toBe(first.data.url);
      expect(second.data.cleanupWarning).toBe(false);
      expect((await readDesigner(id)).avatar_url).toBe(second.data.url);
      // 舊檔真的被刪：資料夾只剩新檔，舊網址回 400／404。
      expect(await listFolder(`avatar/${id}`)).toEqual([`avatar/${id}/${second.data.url.split("/").pop()}`]);
      expect([400, 404]).toContain(await statusOf(first.data.url));

      const removed = await removeDesignerAvatar(adminClient, id);
      expect(removed).toEqual({ ok: true, data: { cleanupWarning: false } });
      expect((await readDesigner(id)).avatar_url).toBeNull();
      expect([400, 404]).toContain(await statusOf(second.data.url));
      expect(await listFolder(`avatar/${id}`)).toEqual([]);
    });

    it("頭像：非管理員上傳被 Storage policy 擋下，資料列不變、不留下檔案", async () => {
      const before = await readDesigner(activeDesignerId);
      const result = await uploadDesignerAvatar(
        nonAdminClient,
        activeDesignerId,
        new File([TINY_PNG], "a.png", { type: "image/png" }),
      );
      expect(result.ok).toBe(false);
      expect(await readDesigner(activeDesignerId)).toEqual(before);
      expect(await listFolder(`avatar/${activeDesignerId}`)).toEqual([]);
    });

    it("頭像：舊網址被手動改成其他設計師的檔案時，只更新資料列、不會刪到別人的檔案（回傳警告）", async () => {
      const victim = await createDesigner();
      const owner = await createDesigner();
      const victimUpload = await uploadDesignerAvatar(adminClient, victim, new File([TINY_PNG], "a.png", { type: "image/png" }));
      expect(victimUpload.ok).toBe(true);
      if (!victimUpload.ok) return;

      // 模擬資料被竄改：owner 的 avatar_url 指向 victim 的檔案。
      const { error } = await serviceRoleClient.from("designers").update({ avatar_url: victimUpload.data.url }).eq("id", owner);
      expect(error).toBeNull();

      const replaced = await uploadDesignerAvatar(adminClient, owner, new File([TINY_PNG], "b.png", { type: "image/png" }));
      expect(replaced.ok).toBe(true);
      if (!replaced.ok) return;
      expect(replaced.data.cleanupWarning).toBe(true);
      expect(await statusOf(victimUpload.data.url)).toBe(200);
    });
  });

  // TASK-070：設計師服務開關（真實 admin／非管理員 session）。測試服務一律是 `__TEST__` 前綴且下架中（不會出現在
  // 前台、不影響真實顧客）；設計師是 service_role 建立的 `__TEST__` 設計師，絕不碰預設設計師的服務開關。
  describe("TASK-070：設計師服務開關（真實 admin session）", () => {
    let serviceA: string;
    let serviceB: string;

    beforeAll(async () => {
      const { data, error } = await serviceRoleClient
        .from("services")
        .insert([
          { name: `${TEST_MARKER} svc070-a`, price: 100, duration_minutes: 30, is_active: false },
          { name: `${TEST_MARKER} svc070-b`, price: 100, duration_minutes: 30, is_active: false },
        ])
        .select("id, name")
        .order("name", { ascending: true });
      if (error) throw error;
      serviceA = data![0].id as string;
      serviceB = data![1].id as string;
    });

    async function linkedServiceIds(designerId: string): Promise<string[]> {
      const { data, error } = await serviceRoleClient
        .from("designer_services")
        .select("service_id")
        .eq("designer_id", designerId);
      if (error) throw error;
      return (data ?? []).map((row) => row.service_id as string).sort();
    }

    it("admin 開啟：寫入一列；重複開啟冪等（仍只有一列）；listDesignerServiceIds 讀得到", async () => {
      const id = await createDesigner();

      expect(await setDesignerService(adminClient, id, serviceA, true)).toEqual({ ok: true, data: undefined });
      expect(await linkedServiceIds(id)).toEqual([serviceA]);

      expect(await setDesignerService(adminClient, id, serviceA, true)).toEqual({ ok: true, data: undefined });
      expect(await linkedServiceIds(id)).toEqual([serviceA]);

      expect(await listDesignerServiceIds(adminClient, id)).toEqual({ ok: true, data: [serviceA] });
    });

    it("admin 關閉：只刪掉那一列，同一位設計師的其他服務與其他設計師的同一項服務都不受影響", async () => {
      const first = await createDesigner();
      const second = await createDesigner();
      for (const [designerId, serviceId] of [
        [first, serviceA],
        [first, serviceB],
        [second, serviceA],
      ]) {
        expect((await setDesignerService(adminClient, designerId, serviceId, true)).ok).toBe(true);
      }

      expect(await setDesignerService(adminClient, first, serviceA, false)).toEqual({ ok: true, data: undefined });

      expect(await linkedServiceIds(first)).toEqual([serviceB]);
      expect(await linkedServiceIds(second)).toEqual([serviceA]);
    });

    it("關閉一項本來就沒開的服務（或已被別處關閉）：回失敗而不是成功（0 列），資料不變", async () => {
      const id = await createDesigner();
      expect((await setDesignerService(adminClient, id, serviceA, true)).ok).toBe(true);

      expect(await setDesignerService(adminClient, id, serviceB, false)).toEqual({
        ok: false,
        error: { message: "發生未預期的錯誤，請稍後再試。" },
      });
      expect(await linkedServiceIds(id)).toEqual([serviceA]);
    });

    it("admin 可以讀到停用中設計師的服務開關，也可以對停用中的設計師開關（先設定好再啟用）", async () => {
      const read = await listDesignerServiceIds(adminClient, inactiveDesignerId);
      expect(read).toEqual({ ok: true, data: [testServiceId] });

      const id = await createDesigner({ is_active: false });
      expect((await setDesignerService(adminClient, id, serviceA, true)).ok).toBe(true);
      expect(await linkedServiceIds(id)).toEqual([serviceA]);
    });

    it("不存在的設計師或服務（外鍵）：回通用錯誤，不寫入", async () => {
      const id = await createDesigner();
      const missing = randomUUID();

      expect(await setDesignerService(adminClient, id, missing, true)).toEqual({
        ok: false,
        error: { message: "發生未預期的錯誤，請稍後再試。" },
      });
      expect(await setDesignerService(adminClient, missing, serviceA, true)).toEqual({
        ok: false,
        error: { message: "發生未預期的錯誤，請稍後再試。" },
      });
      expect(await linkedServiceIds(id)).toEqual([]);
    });

    it("非管理員：開啟被 RLS 擋下（沒有寫入）；關閉被擋下時回失敗（0 列），既有的列仍在", async () => {
      const id = await createDesigner();

      expect((await setDesignerService(nonAdminClient, id, serviceA, true)).ok).toBe(false);
      expect(await linkedServiceIds(id)).toEqual([]);

      const { error } = await serviceRoleClient.from("designer_services").insert({ designer_id: id, service_id: serviceB });
      expect(error).toBeNull();
      expect((await setDesignerService(nonAdminClient, id, serviceB, false)).ok).toBe(false);
      expect(await linkedServiceIds(id)).toEqual([serviceB]);
    });

    it("anon 讀不到停用中設計師的 designer_services，讀得到啟用中的", async () => {
      const inactive = await anonClient.from("designer_services").select("service_id").eq("designer_id", inactiveDesignerId);
      expect(inactive.error).toBeNull();
      expect(inactive.data).toEqual([]);

      const active = await anonClient.from("designer_services").select("service_id").eq("designer_id", activeDesignerId);
      expect(active.error).toBeNull();
      expect(active.data).toEqual([{ service_id: testServiceId }]);
    });
  });
});
