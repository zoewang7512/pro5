// 對真實 Supabase 專案執行的整合測試，驗證 TASK-123（0029）對 services 與 store_settings 六個文字欄位加的長度 CHECK：
//   services.name 60、description 500；store_settings.name 200、address 200、logo_url 2048、cover_image_url 2048。
// 兩種模式（環境變數 TEXT_LENGTH_EXPECT）：
//   預設（on）：已套用 0029。上限剛好的值成功；上限 + 1 以 23514（check_violation，訊息帶 constraint 名稱）拒絕，資料不變。
//   TEXT_LENGTH_EXPECT=off：未套用 0029（或已執行 _down）。上限 + 1 的值也能寫入。
// 每個「on 被擋」的斷言在 off 模式都有對應的「沒被擋」斷言，兩種模式都有鑑別力；套用前先跑 off 取得基準線。
// 主要用 service role（CHECK 對所有角色一視同仁，不看 RLS）；另外以真實店長帳號（authenticated、經 RLS 與 PostgREST 的正常路徑）
// 驗證 +1 被拒、剛好上限成功。店長帳號只登入、不呼叫 signOut：signOut 預設是全域登出，會踢掉使用者瀏覽器上的登入。
//
// 資料安全：
//   * services：測試列一律 is_active = false、名稱以固定前綴 TEST_MARKER 開頭，並記錄 id，afterAll 逐一刪除（失敗要 throw）；
//     beforeAll 也會掃除上次被強制中斷時殘留的同前綴列（它們會出現在後台服務清單，也會被 export-demo-base 收進種子）。
//   * store_settings 是固定單例（id = 1），沒辦法用標記隔離：測試前記錄快照並印出（供中斷後人工還原），測試中短暫改動，
//     afterAll 以快照還原並核對（覆寫式：測試期間若店長在後台改了設定會被舊快照蓋掉；updated_at 無法還原）。
//     全域唯一一份設定，測試期間商店名稱／圖片網址會暫時變成測試值而影響前台顯示：不要高頻率重複執行、
//     不要與其他會改 store_settings 的測試（test:store-settings、test:demo-reset）並行、避開台北 03:00–04:00 的每日還原窗口。
// 不放進預設 `npm test`，只透過 `npm run test:text-length` 執行；缺設定時直接噴錯而非略過。
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const designerEmail = process.env.DESIGNER_EMAIL;
const designerPassword = process.env.DESIGNER_PASSWORD;

if (!url || !anonKey || !serviceRoleKey || !designerEmail || !designerPassword) {
  throw new Error(
    "[text-length-checks.integration.test] 缺少 Supabase 專案設定或 DESIGNER_EMAIL/DESIGNER_PASSWORD，" +
      "請確認 .env.local 已填妥並已執行 npm run seed:designer。",
  );
}

const checksActive = process.env.TEXT_LENGTH_EXPECT !== "off";
// 固定前綴（不含時間戳）：beforeAll 才掃得到上次殘留。要保持很短，才能做出「總長剛好 60 字元」的全形字／表情符號案例。
const TEST_MARKER = "__TEST__tl-";

type StoreRow = {
  name: string;
  address: string | null;
  logo_url: string | null;
  cover_image_url: string | null;
  phone: string | null;
  description: string | null;
};
const STORE_COLUMNS = "name, address, phone, description, logo_url, cover_image_url";

// 使用者核准的上限（2026-11-01）；與 supabase/migrations/0029_text_length_checks.sql 一致。
const SERVICES_NAME = { cap: 60, constraint: "services_name_length" };
const SERVICES_DESCRIPTION = { cap: 500, constraint: "services_description_length" };
const STORE_COLUMN_CAPS = [
  { column: "name", cap: 200, constraint: "store_settings_name_length" },
  { column: "address", cap: 200, constraint: "store_settings_address_length" },
  { column: "logo_url", cap: 2048, constraint: "store_settings_logo_url_length" },
  { column: "cover_image_url", cap: 2048, constraint: "store_settings_cover_image_url_length" },
] as const;

// 補到剛好 total 個字元（碼點）：前綴是 ASCII 的 TEST_MARKER，其餘用 filler 重複。
function padTo(total: number, filler = "a"): string {
  return TEST_MARKER + filler.repeat(total - TEST_MARKER.length);
}
const codePoints = (value: string) => Array.from(value).length;

function expectCheckViolation(error: { code?: string; message?: string } | null, constraint: string) {
  expect(error, `預期 ${constraint} 拒絕，但沒有錯誤`).not.toBeNull();
  expect(error?.code).toBe("23514");
  expect(error?.message ?? "").toContain(constraint);
}

describe(`文字欄位長度 CHECK（TASK-123，${checksActive ? "on：已套用 0029" : "off：未套用／已回滾"}；真實 Supabase 專案）`, () => {
  let admin: SupabaseClient;
  let designer: SupabaseClient;
  let storeSnapshot: StoreRow;
  const createdServiceIds: string[] = [];

  beforeAll(async () => {
    admin = createClient(url!, serviceRoleKey!, { auth: { autoRefreshToken: false, persistSession: false } });
    designer = createClient(url!, anonKey!, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error: signInError } = await designer.auth.signInWithPassword({ email: designerEmail!, password: designerPassword! });
    if (signInError) throw signInError;

    const { data, error } = await admin.from("store_settings").select(STORE_COLUMNS).eq("id", 1).single();
    if (error) throw error;
    storeSnapshot = data as StoreRow;
    // store_settings 沒有標記可以事後掃描復原；測試被強制中斷時，這份快照是人工還原的唯一依據。
    // 只印本測試會改動的欄位（不印電話與簡介：本測試不會動它們，避免真實電話進終端機或 CI 記錄）。
    const printable = {
      name: storeSnapshot.name,
      address: storeSnapshot.address,
      logo_url: storeSnapshot.logo_url,
      cover_image_url: storeSnapshot.cover_image_url,
    };
    console.log(`[text-length-checks] 原始 store_settings 快照（會被改動的欄位，供中斷後人工還原用）：${JSON.stringify(printable)}`);

    // 掃除上次被強制中斷時殘留的測試列（固定前綴；底線在 LIKE 是萬用字元，要跳脫；只刪下架中的列，雙重保險）。
    const { error: sweepError } = await admin
      .from("services")
      .delete()
      .like("name", `${TEST_MARKER.replaceAll("_", "\\_")}%`)
      .eq("is_active", false);
    if (sweepError) throw sweepError;
  });

  afterAll(async () => {
    const cleanupErrors: unknown[] = [];

    if (createdServiceIds.length > 0) {
      const { error } = await admin.from("services").delete().in("id", createdServiceIds);
      if (error) cleanupErrors.push(error);
    }

    if (storeSnapshot) {
      const { data: restored, error } = await admin
        .from("store_settings")
        .update({
          name: storeSnapshot.name,
          address: storeSnapshot.address,
          phone: storeSnapshot.phone,
          description: storeSnapshot.description,
          logo_url: storeSnapshot.logo_url,
          cover_image_url: storeSnapshot.cover_image_url,
        })
        .eq("id", 1)
        .select(STORE_COLUMNS);
      if (error || !restored || restored.length !== 1) {
        cleanupErrors.push(error ?? new Error("store_settings 還原受影響列數與快照不符"));
      } else if (JSON.stringify(restored[0]) !== JSON.stringify(storeSnapshot)) {
        cleanupErrors.push(new Error(`store_settings 還原後與快照不一致：${JSON.stringify(restored[0])}`));
      }
    }

    if (createdServiceIds.length > 0) {
      const { data: remaining, error } = await admin.from("services").select("id").in("id", createdServiceIds);
      if (error) cleanupErrors.push(error);
      else if (remaining && remaining.length > 0) cleanupErrors.push(new Error(`services 測試列未清乾淨：${remaining.length} 列`));
    }

    if (cleanupErrors.length > 0) {
      throw new Error(`[text-length-checks] 清除失敗：${cleanupErrors.map(String).join("; ")}`);
    }
  });

  // ---------- services ----------

  async function insertService(fields: { name: string; description?: string | null }) {
    const result = await admin
      .from("services")
      .insert({ name: fields.name, description: fields.description ?? null, price: 0, duration_minutes: 30, is_active: false })
      .select("id, name, description");
    for (const row of result.data ?? []) createdServiceIds.push(row.id as string);
    return result;
  }

  async function countServicesNamed(name: string) {
    const { data, error } = await admin.from("services").select("id").eq("name", name);
    if (error) throw error;
    return data?.length ?? 0;
  }

  describe("services.name（60）", () => {
    it("剛好 60 字元：成功", async () => {
      const name = padTo(SERVICES_NAME.cap);
      const { data, error } = await insertService({ name });
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(codePoints(data![0].name)).toBe(60);
    });

    it("61 字元：" + (checksActive ? "以 23514 拒絕，沒有新增列" : "off 模式不擋（上限不存在）"), async () => {
      const name = padTo(SERVICES_NAME.cap + 1, "b");
      const { data, error } = await insertService({ name });
      if (checksActive) {
        expectCheckViolation(error, SERVICES_NAME.constraint);
        expect(data).toBeNull();
        expect(await countServicesNamed(name)).toBe(0);
      } else {
        expect(error).toBeNull();
        expect(data).toHaveLength(1);
      }
    });

    // 總長以碼點計剛好 60／61（前綴 11 個 ASCII 字元 + 全形字或表情符號）；位元組與 UTF-16 單位都遠超過 60，
    // 若資料庫改用位元組（octet_length）或 UTF-16 單位計算，「60」的案例就會失敗。
    it.each([
      ["全形字", "剪", 3],
      ["表情符號", "😀", 4],
    ])("以碼點計，不是位元組或 UTF-16 單位（%s）：總長 60 字元成功；61 字元" + (checksActive ? "被拒絕" : "在 off 模式不擋"), async (_label, filler, bytesPerChar) => {
      const exact = padTo(SERVICES_NAME.cap, filler);
      expect(codePoints(exact)).toBe(60);
      expect(Buffer.byteLength(exact, "utf8")).toBe(TEST_MARKER.length + (60 - TEST_MARKER.length) * bytesPerChar);
      expect(exact.length).toBeGreaterThanOrEqual(60); // UTF-16 單位數 >= 60（表情符號為 2 單位）
      expect((await insertService({ name: exact })).error).toBeNull();

      const tooLong = await insertService({ name: padTo(SERVICES_NAME.cap + 1, filler) });
      if (checksActive) expectCheckViolation(tooLong.error, SERVICES_NAME.constraint);
      else expect(tooLong.error).toBeNull();
    });

    it("update 路徑（直接 PATCH 既有列）同樣受限，被拒絕時原值不變", async () => {
      const original = padTo(40, "c");
      const { data: created, error: createError } = await insertService({ name: original });
      expect(createError).toBeNull();
      const id = created![0].id as string;

      const tooLong = padTo(SERVICES_NAME.cap + 1, "d");
      const { error } = await admin.from("services").update({ name: tooLong }).eq("id", id).select("id");
      const { data: after } = await admin.from("services").select("name").eq("id", id).single();
      if (checksActive) {
        expectCheckViolation(error, SERVICES_NAME.constraint);
        expect(after?.name).toBe(original);
      } else {
        expect(error).toBeNull();
        expect(after?.name).toBe(tooLong);
      }

      // 剛好 60 的 update 兩種模式都成功。
      const exact = padTo(SERVICES_NAME.cap, "e");
      const { error: exactError } = await admin.from("services").update({ name: exact }).eq("id", id).select("id");
      expect(exactError).toBeNull();
    });
  });

  describe("services.description（500，可為 null）", () => {
    it("null、空字串、剛好 500 字元：成功", async () => {
      expect((await insertService({ name: padTo(30, "f"), description: null })).error).toBeNull();
      expect((await insertService({ name: padTo(31, "f"), description: "" })).error).toBeNull();
      const exact = await insertService({ name: padTo(32, "f"), description: "字".repeat(SERVICES_DESCRIPTION.cap) });
      expect(exact.error).toBeNull();
      expect(codePoints(exact.data![0].description as string)).toBe(500);
    });

    it("501 字元：" + (checksActive ? "以 23514 拒絕，沒有新增列" : "off 模式不擋"), async () => {
      const name = padTo(33, "g");
      const { data, error } = await insertService({ name, description: "字".repeat(SERVICES_DESCRIPTION.cap + 1) });
      if (checksActive) {
        expectCheckViolation(error, SERVICES_DESCRIPTION.constraint);
        expect(data).toBeNull();
        expect(await countServicesNamed(name)).toBe(0);
      } else {
        expect(error).toBeNull();
      }
    });

    it("update 路徑：501 字元" + (checksActive ? "被拒絕、原值不變" : "在 off 模式可寫入"), async () => {
      const { data: created } = await insertService({ name: padTo(34, "h"), description: "原描述" });
      const id = created![0].id as string;

      const { error } = await admin
        .from("services")
        .update({ description: "字".repeat(SERVICES_DESCRIPTION.cap + 1) })
        .eq("id", id)
        .select("id");
      const { data: after } = await admin.from("services").select("description").eq("id", id).single();
      if (checksActive) {
        expectCheckViolation(error, SERVICES_DESCRIPTION.constraint);
        expect(after?.description).toBe("原描述");
      } else {
        expect(error).toBeNull();
        expect(codePoints(after?.description as string)).toBe(SERVICES_DESCRIPTION.cap + 1);
      }
    });
  });

  // ---------- store_settings ----------

  async function readStore(): Promise<StoreRow> {
    const { data, error } = await admin.from("store_settings").select(STORE_COLUMNS).eq("id", 1).single();
    if (error) throw error;
    return data as StoreRow;
  }

  describe.each(STORE_COLUMN_CAPS)("store_settings.$column（$cap）", ({ column, cap, constraint }) => {
    it("剛好上限字元：成功", async () => {
      const value = "z".repeat(cap);
      const { data, error } = await admin.from("store_settings").update({ [column]: value }).eq("id", 1).select(column);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(codePoints((data![0] as unknown as Record<string, string>)[column])).toBe(cap);
    });

    it("上限 + 1：" + (checksActive ? "以 23514 拒絕，資料不變" : "off 模式不擋"), async () => {
      const before = await readStore();
      const { data, error } = await admin
        .from("store_settings")
        .update({ [column]: "y".repeat(cap + 1) })
        .eq("id", 1)
        .select(column);
      const after = await readStore();
      if (checksActive) {
        expectCheckViolation(error, constraint);
        expect(data).toBeNull();
        expect(after).toEqual(before);
      } else {
        expect(error).toBeNull();
        expect(codePoints((after as unknown as Record<string, string>)[column])).toBe(cap + 1);
      }
    });
  });

  it("store_settings：同一個 update 裡一個欄位超過上限，整句被拒絕，其他欄位也不會被改（沒有部分寫入）", async () => {
    // 先還原到已知狀態，避免前面案例留下的值影響比對。
    await admin.from("store_settings").update({ name: storeSnapshot.name, address: storeSnapshot.address }).eq("id", 1);
    const before = await readStore();

    const { error } = await admin
      .from("store_settings")
      .update({ name: "部分寫入測試", address: "x".repeat(201) })
      .eq("id", 1)
      .select("id");
    const after = await readStore();

    if (checksActive) {
      expectCheckViolation(error, "store_settings_address_length");
      expect(after).toEqual(before);
    } else {
      expect(error).toBeNull();
      expect(after.name).toBe("部分寫入測試");
      expect(after.address).toHaveLength(201); // off 模式：兩個欄位一起寫入（與 on 模式「都不寫」對稱）
    }
  });

  it("store_settings：可為 null 的欄位設為 null 成功（兩種模式）；name 允許空字串（seed 列本來就是空字串）", async () => {
    const { error } = await admin
      .from("store_settings")
      .update({ address: null, logo_url: null, cover_image_url: null, name: "" })
      .eq("id", 1)
      .select("id");
    expect(error).toBeNull();
  });

  it("store_settings：0006 既有的 description 500／phone 20 上限仍然有效（0029 沒有動到）", async () => {
    const description = await admin.from("store_settings").update({ description: "d".repeat(501) }).eq("id", 1).select("id");
    expectCheckViolation(description.error, "store_settings_description_length");
    const phone = await admin.from("store_settings").update({ phone: "1".repeat(21) }).eq("id", 1).select("id");
    expectCheckViolation(phone.error, "store_settings_phone_length");
  });

  // ---------- 店長身分（authenticated，經 RLS 與 PostgREST 的正常寫入路徑） ----------
  // 先證明店長這條路徑本來就寫得進去（剛好上限成功），才能確認被拒絕的是 CHECK 而不是 RLS。

  describe("店長身分（authenticated）", () => {
    it("services：剛好 60 字元成功；61 字元" + (checksActive ? "以 23514 拒絕" : "在 off 模式不擋"), async () => {
      const ok = await designer
        .from("services")
        .insert({ name: padTo(SERVICES_NAME.cap, "m"), price: 0, duration_minutes: 30, is_active: false })
        .select("id");
      for (const row of ok.data ?? []) createdServiceIds.push(row.id as string);
      expect(ok.error).toBeNull();
      expect(ok.data).toHaveLength(1);

      const tooLong = await designer
        .from("services")
        .insert({ name: padTo(SERVICES_NAME.cap + 1, "n"), price: 0, duration_minutes: 30, is_active: false })
        .select("id");
      for (const row of tooLong.data ?? []) createdServiceIds.push(row.id as string);
      if (checksActive) expectCheckViolation(tooLong.error, SERVICES_NAME.constraint);
      else expect(tooLong.error).toBeNull();
    });

    it("store_settings.name：剛好 200 字元成功；201 字元" + (checksActive ? "以 23514 拒絕、資料不變" : "在 off 模式不擋"), async () => {
      const ok = await designer.from("store_settings").update({ name: "s".repeat(200) }).eq("id", 1).select("id");
      expect(ok.error).toBeNull();
      expect(ok.data).toHaveLength(1); // 不是被 RLS 悄悄擋成 0 列

      const before = await readStore();
      const tooLong = await designer.from("store_settings").update({ name: "t".repeat(201) }).eq("id", 1).select("id");
      const after = await readStore();
      if (checksActive) {
        expectCheckViolation(tooLong.error, "store_settings_name_length");
        expect(after).toEqual(before);
      } else {
        expect(tooLong.error).toBeNull();
        expect(codePoints(after.name)).toBe(201);
      }
    });
  });
});
