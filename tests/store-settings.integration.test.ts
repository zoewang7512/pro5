// 對真實 Supabase 專案執行的整合測試，驗證 TASK-029（商店基本資料設定 架構基礎）建立的
// store_settings 資料表 RLS 邊界與 store-assets Storage bucket 權限邊界：anon／已登入但
// 非管理員的 authenticated 使用者皆不能寫入 store_settings 或上傳至 store-assets，只有
// is_admin() 可以；已上傳的物件可被公開讀取（不需驗證的 GET）；bucket 層的
// allowed_mime_types 限制確實擋下不允許的檔案格式。architect 於 TASK-029 審查要求本卡
// 現在就要有最低限度的邊界驗證證據，不能全部押到 TASK-033（後續整合驗證任務）才驗證——
// 本檔案之後由 TASK-033 視需要擴充（例如涵蓋 TASK-030／TASK-031 實際的寫入/上傳函式）。
// 不放進預設 `npm test`，只透過 `npm run test:store-settings` 執行——這個檔案不會在其他
// 情境下被跑到，所以缺設定時直接噴錯而非略過，避免「忘了填 .env.local 卻顯示測試通過」的
// 誤導。沿用 tests/business-hours.integration.test.ts 已驗證過的撰寫細節：afterAll 清除
// 失敗要 throw（且分開嘗試多個清除步驟）、非管理員帳號用獨立隨機密碼（不從 TEST_MARKER
// 衍生）、寫入結果核對受影響列數而非只看 error 是否為 null。
//
// store_settings 只有 1 列固定資料（id 恆為 1），不像 appointments／services 能用
// TEST_MARKER 前綴隔離＋刪除。本檔案採「測試前記錄原始 1 列快照、測試中短暫改動、afterAll
// 還原」的模式，比照 business_hours 既有做法；這是全域唯一一份設定，測試期間會暫時影響
// 商店設定顯示，不要對正式環境高頻率重複執行。
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const designerEmail = process.env.DESIGNER_EMAIL;
const designerPassword = process.env.DESIGNER_PASSWORD;

if (!url || !anonKey || !serviceRoleKey || !designerEmail || !designerPassword) {
  throw new Error(
    "[store-settings.integration.test] 缺少 Supabase 專案設定或 DESIGNER_EMAIL/DESIGNER_PASSWORD，" +
      "請確認 .env.local 已填妥並已執行 npm run seed:designer。",
  );
}

const TEST_MARKER = `__TEST__store-settings-${Date.now()}`;

type StoreSettingsRow = {
  id: number;
  name: string;
  address: string | null;
  phone: string | null;
  description: string | null;
  logo_url: string | null;
  cover_image_url: string | null;
};

describe("商店基本資料設定：store_settings／store-assets 權限邊界（真實 Supabase 專案）", () => {
  let serviceRoleClient: SupabaseClient;
  let anonClient: SupabaseClient;
  let designerClient: SupabaseClient;
  let nonAdminClient: SupabaseClient;
  let nonAdminUserId: string | undefined;
  let originalSnapshot: StoreSettingsRow;
  const uploadedObjectPaths: string[] = [];

  beforeAll(async () => {
    serviceRoleClient = createClient(url!, serviceRoleKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    anonClient = createClient(url!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    designerClient = createClient(url!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error: signInError } = await designerClient.auth.signInWithPassword({
      email: designerEmail!,
      password: designerPassword!,
    });
    if (signInError) throw signInError;

    // 用 service role 的 admin API 自建一個拋棄式、非管理員的 authenticated 使用者，測完在
    // afterAll 刪除；密碼用獨立隨機值，不從 TEST_MARKER 衍生（比照 business-hours 既有教訓，
    // 避免留下可從公開資料反推的有效登入憑證）。
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

    // 記錄原始那唯一一列的快照，afterAll 會用這份快照還原——不能假設目前一定是 migration
    // seed 的預設值（可能已被後台設定頁調整過），一律以「測試開始當下的實際資料」為還原基準。
    const { data: snapshot, error: snapshotError } = await serviceRoleClient
      .from("store_settings")
      .select("id, name, address, phone, description, logo_url, cover_image_url")
      .eq("id", 1)
      .single();
    if (snapshotError) throw snapshotError;
    originalSnapshot = snapshot as StoreSettingsRow;

    // store_settings 沒有 TEST_MARKER 可以事後掃描復原，若程序在測試中途被強制中斷，
    // afterAll 不會執行，這份快照是唯一能讓人工用 service role 手動 update 還原的紀錄。
    console.log(`[store-settings.integration.test] 原始 store_settings 快照（供中斷後人工還原用）：${JSON.stringify(originalSnapshot)}`);
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
        .from("store_settings")
        .update({
          name: originalSnapshot.name,
          address: originalSnapshot.address,
          phone: originalSnapshot.phone,
          description: originalSnapshot.description,
          logo_url: originalSnapshot.logo_url,
          cover_image_url: originalSnapshot.cover_image_url,
        })
        .eq("id", 1)
        .select("id");
      if (restoreError || !restored || restored.length !== 1) {
        cleanupErrors.push(restoreError ?? new Error("store_settings 還原受影響列數與快照不符"));
      }
    }

    if (uploadedObjectPaths.length > 0) {
      const { error: removeError } = await serviceRoleClient.storage.from("store-assets").remove(uploadedObjectPaths);
      if (removeError) cleanupErrors.push(removeError);
    }

    if (cleanupErrors.length > 0) {
      const messages = cleanupErrors.map((e) => (e instanceof Error ? e.message : JSON.stringify(e)));
      throw new Error(
        `[store-settings.integration.test] afterAll 清除失敗，store_settings 或測試資料可能未被還原乾淨：${JSON.stringify(messages)}`,
      );
    }
  });

  describe("store_settings 寫入權限邊界：designer 可直接寫入，anon／非管理員 authenticated 皆被 RLS 拒絕", () => {
    it("anon 可讀取 store_settings（供顧客前台使用）", async () => {
      const { data, error } = await anonClient
        .from("store_settings")
        .select("id, name")
        .eq("id", 1)
        .single();
      expect(error).toBeNull();
      expect(data?.id).toBe(1);
    });

    it("anon 無法 update store_settings", async () => {
      const { data } = await anonClient
        .from("store_settings")
        .update({ name: `${TEST_MARKER} anon-should-fail` })
        .eq("id", 1)
        .select("id");
      // RLS 沒有對應 policy 時，PostgREST 對 UPDATE 回傳成功但 0 筆受影響（不是顯式錯誤），
      // 因此同時斷言 data 為空陣列，不能只看 error 是否為 null（既有教訓，見檔頭註解）。
      expect(data ?? []).toEqual([]);

      const { data: unchanged } = await serviceRoleClient.from("store_settings").select("name").eq("id", 1).single();
      expect(unchanged?.name).not.toBe(`${TEST_MARKER} anon-should-fail`);
    });

    it("已登入但非 is_admin() 的 authenticated 使用者無法 update store_settings（anon 測試只證明「沒有對應 policy 時被拒」，store_settings 對 authenticated 角色本身沒有整體 revoke，唯一防線是 is_admin() policy predicate，需要這個角色才能真正驗證該防線本身有效）", async () => {
      const { data } = await nonAdminClient
        .from("store_settings")
        .update({ name: `${TEST_MARKER} nonadmin-should-fail` })
        .eq("id", 1)
        .select("id");
      expect(data ?? []).toEqual([]);

      const { data: unchanged } = await serviceRoleClient.from("store_settings").select("name").eq("id", 1).single();
      expect(unchanged?.name).not.toBe(`${TEST_MARKER} nonadmin-should-fail`);
    });

    it("designer（is_admin()）可以 update store_settings", async () => {
      const { data, error } = await designerClient
        .from("store_settings")
        .update({ name: `${TEST_MARKER} designer-update` })
        .eq("id", 1)
        .select("id, name");
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data?.[0]?.name).toBe(`${TEST_MARKER} designer-update`);
    });

    it("非管理員無法 insert 第二列（store_settings_singleton check constraint 與缺乏 insert policy 雙重防護）", async () => {
      const { data } = await anonClient.from("store_settings").insert({ id: 2, name: "should-fail" }).select("id");
      expect(data ?? []).toEqual([]);
    });
  });

  describe("store-assets Storage bucket 權限邊界：designer 可上傳，anon／非管理員 authenticated 皆被拒絕，已上傳物件可公開讀取", () => {
    const testFileContent = Buffer.from("fake-image-bytes-for-integration-test");

    it("anon 無法上傳至 store-assets", async () => {
      const path = `logo/${TEST_MARKER}-anon-should-fail.png`;
      const { error } = await anonClient.storage.from("store-assets").upload(path, testFileContent, {
        contentType: "image/png",
      });
      expect(error).not.toBeNull();
    });

    it("已登入但非 is_admin() 的 authenticated 使用者無法上傳至 store-assets", async () => {
      const path = `logo/${TEST_MARKER}-nonadmin-should-fail.png`;
      const { error } = await nonAdminClient.storage.from("store-assets").upload(path, testFileContent, {
        contentType: "image/png",
      });
      expect(error).not.toBeNull();
    });

    it("designer（is_admin()）可以上傳至 store-assets，且上傳後可被公開（未驗證）讀取", async () => {
      const path = `logo/${TEST_MARKER}-designer-upload.png`;
      const { error: uploadError } = await designerClient.storage.from("store-assets").upload(path, testFileContent, {
        contentType: "image/png",
      });
      expect(uploadError).toBeNull();
      uploadedObjectPaths.push(path);

      const { data: publicUrlData } = designerClient.storage.from("store-assets").getPublicUrl(path);
      const response = await fetch(publicUrlData.publicUrl);
      expect(response.ok).toBe(true);
      const bytes = Buffer.from(await response.arrayBuffer());
      expect(bytes.equals(testFileContent)).toBe(true);
    });

    it("designer 上傳不在 allowed_mime_types 白名單內的格式（text/plain）會被 bucket 層擋下（伺服器端強制，非只靠前端驗證）", async () => {
      const path = `logo/${TEST_MARKER}-wrong-mime.txt`;
      const { error } = await designerClient.storage.from("store-assets").upload(path, Buffer.from("not an image"), {
        contentType: "text/plain",
      });
      expect(error).not.toBeNull();
    });

    it("designer 上傳到 logo／cover 以外的路徑前綴會被拒絕（storage.foldername 路徑前綴限制）", async () => {
      const path = `other/${TEST_MARKER}-wrong-prefix.png`;
      const { error } = await designerClient.storage.from("store-assets").upload(path, testFileContent, {
        contentType: "image/png",
      });
      expect(error).not.toBeNull();
    });

    it("anon 無法列出 store-assets 底下的物件（narrow 過的 select policy 只留給 is_admin()，公開讀取走 public bucket 端點、不需要這條 policy）", async () => {
      const { data, error } = await anonClient.storage.from("store-assets").list("logo");
      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);
    });
  });
});
