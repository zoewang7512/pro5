// 對真實 Supabase 專案執行的整合測試，驗證 TASK-046（預約規則與政策設定 架構基礎）建立的
// booking_policy 資料表 RLS 邊界：anon／已登入但非管理員的 authenticated 使用者皆不能寫入
// booking_policy，只有 is_admin() 可以；anon 可讀取（供顧客前台後續消費）。security-reviewer
// 於 TASK-046 審查要求本卡現在就要有最低限度的邊界驗證證據，理由與 TASK-029 相同：RLS 阻擋
// UPDATE 時 PostgREST 預設回傳成功但 0 筆受影響（不是顯式錯誤），肉眼測試容易誤判為通過。
// 不放進預設 `npm test`，只透過 `npm run test:booking-policy` 執行——這個檔案不會在其他
// 情境下被跑到，所以缺設定時直接噴錯而非略過。沿用 tests/store-settings.integration.test.ts
// 已驗證過的撰寫細節：afterAll 清除失敗要 throw、非管理員帳號用獨立隨機密碼（不從
// TEST_MARKER 衍生）、寫入結果核對受影響列數而非只看 error 是否為 null。
//
// booking_policy 只有 1 列固定資料（id 恆為 1），比照 store_settings 既有做法：測試前記錄
// 原始 1 列快照、測試中短暫改動、afterAll 還原。這是全域唯一一份設定，測試期間會暫時影響
// 預約規則顯示，不要對正式環境高頻率重複執行。
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
    "[booking-policy.integration.test] 缺少 Supabase 專案設定或 DESIGNER_EMAIL/DESIGNER_PASSWORD，" +
      "請確認 .env.local 已填妥並已執行 npm run seed:designer。",
  );
}

const TEST_MARKER = `__TEST__booking-policy-${Date.now()}`;

type BookingPolicyRow = {
  id: number;
  min_lead_time_hours: number;
  cancel_window_hours: number | null;
};

describe("預約規則與政策設定：booking_policy 權限邊界（真實 Supabase 專案）", () => {
  let serviceRoleClient: SupabaseClient;
  let anonClient: SupabaseClient;
  let designerClient: SupabaseClient;
  let nonAdminClient: SupabaseClient;
  let nonAdminUserId: string | undefined;
  let originalSnapshot: BookingPolicyRow;

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
    // afterAll 刪除；密碼用獨立隨機值，不從 TEST_MARKER 衍生（比照 business-hours／
    // store-settings 既有教訓，避免留下可從公開資料反推的有效登入憑證）。
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
      .from("booking_policy")
      .select("id, min_lead_time_hours, cancel_window_hours")
      .eq("id", 1)
      .single();
    if (snapshotError) throw snapshotError;
    originalSnapshot = snapshot as BookingPolicyRow;

    console.log(`[booking-policy.integration.test] 原始 booking_policy 快照（供中斷後人工還原用）：${JSON.stringify(originalSnapshot)}`);
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
        .from("booking_policy")
        .update({
          min_lead_time_hours: originalSnapshot.min_lead_time_hours,
          cancel_window_hours: originalSnapshot.cancel_window_hours,
        })
        .eq("id", 1)
        .select("id");
      if (restoreError || !restored || restored.length !== 1) {
        cleanupErrors.push(restoreError ?? new Error("booking_policy 還原受影響列數與快照不符"));
      }
    }

    if (cleanupErrors.length > 0) {
      const messages = cleanupErrors.map((e) => (e instanceof Error ? e.message : JSON.stringify(e)));
      throw new Error(
        `[booking-policy.integration.test] afterAll 清除失敗，booking_policy 或測試資料可能未被還原乾淨：${JSON.stringify(messages)}`,
      );
    }
  });

  it("anon 可讀取 booking_policy（供顧客前台使用）", async () => {
    const { data, error } = await anonClient
      .from("booking_policy")
      .select("id, min_lead_time_hours")
      .eq("id", 1)
      .single();
    expect(error).toBeNull();
    expect(data?.id).toBe(1);
  });

  it("anon 無法 update booking_policy", async () => {
    const { data } = await anonClient
      .from("booking_policy")
      .update({ min_lead_time_hours: 999 })
      .eq("id", 1)
      .select("id");
    // RLS 沒有對應 policy 時，PostgREST 對 UPDATE 回傳成功但 0 筆受影響（不是顯式錯誤），
    // 因此同時斷言 data 為空陣列，不能只看 error 是否為 null（既有教訓，見檔頭註解）。
    expect(data ?? []).toEqual([]);

    const { data: unchanged } = await serviceRoleClient
      .from("booking_policy")
      .select("min_lead_time_hours")
      .eq("id", 1)
      .single();
    expect(unchanged?.min_lead_time_hours).not.toBe(999);
  });

  it("已登入但非 is_admin() 的 authenticated 使用者無法 update booking_policy", async () => {
    const { data } = await nonAdminClient
      .from("booking_policy")
      .update({ min_lead_time_hours: 998 })
      .eq("id", 1)
      .select("id");
    expect(data ?? []).toEqual([]);

    const { data: unchanged } = await serviceRoleClient
      .from("booking_policy")
      .select("min_lead_time_hours")
      .eq("id", 1)
      .single();
    expect(unchanged?.min_lead_time_hours).not.toBe(998);
  });

  it("designer（is_admin()）可以 update booking_policy", async () => {
    const { data, error } = await designerClient
      .from("booking_policy")
      .update({ min_lead_time_hours: 2, cancel_window_hours: 6 })
      .eq("id", 1)
      .select("id, min_lead_time_hours, cancel_window_hours");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.min_lead_time_hours).toBe(2);
    expect(data?.[0]?.cancel_window_hours).toBe(6);
  });

  it("非管理員無法 insert 第二列（booking_policy_singleton check constraint 與缺乏 insert policy 雙重防護）", async () => {
    const { data } = await anonClient.from("booking_policy").insert({ id: 2, min_lead_time_hours: 1 }).select("id");
    expect(data ?? []).toEqual([]);
  });

  it("min_lead_time_hours 超出合理範圍（>720）會被 constraint 擋下（伺服器端強制，非只靠前端驗證）", async () => {
    const { error } = await designerClient.from("booking_policy").update({ min_lead_time_hours: 721 }).eq("id", 1);
    expect(error).not.toBeNull();
  });
});
