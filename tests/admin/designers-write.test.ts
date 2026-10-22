import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  countFutureAppointmentsForDesigner,
  createDesigner,
  getDesigner,
  listDesignerServiceIds,
  parseDesignerAvatarPath,
  planDesignerOrderSwap,
  removeDesignerAvatar,
  setDesignerActive,
  setDesignerService,
  swapDesignerOrder,
  toBasicInfoPayload,
  updateDesignerBasicInfo,
  uploadDesignerAvatar,
  validateDesignerImageFile,
} from "@/lib/admin/designers";
import { reencodeImage } from "@/lib/admin/image-reencode";

// TASK-069：設計師寫入函式。讀取函式（listDesigners）的測試在 designers.test.ts。

vi.mock("@/lib/admin/image-reencode", async () => {
  const actual = await vi.importActual<typeof import("@/lib/admin/image-reencode")>("@/lib/admin/image-reencode");
  return { ...actual, reencodeImage: vi.fn() };
});

const ID = "3f2b8c1e-9d4a-4e6f-8a7b-1c2d3e4f5a6b";
const OTHER_ID = "11111111-2222-4333-8444-555555555555";
const UUID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const BASE_URL = "https://project-ref.supabase.co";
const GENERIC = "發生未預期的錯誤，請稍後再試。";
const BLANK = { name: "A", instagram: "", specialties: [] as string[], bio: "" };

const DESIGNER_ROW = {
  id: ID,
  name: "預設設計師",
  bio: null,
  specialties: [],
  instagram_handle: null,
  avatar_url: null,
  is_active: true,
  sort_order: 0,
};

type Step = { data?: unknown; error?: unknown; count?: number | null };
type RecordedCall = { table: string; method: string; args: unknown[] };
type StorageMocks = {
  upload?: ReturnType<typeof vi.fn>;
  remove?: ReturnType<typeof vi.fn>;
};

// 依表名依序消耗預先排好的結果；所有鏈式方法都記錄呼叫參數並回傳自己（可 await）。
// 另提供 storage.from(bucket) 的 upload／remove／getPublicUrl 假實作。
function recordingClient(plan: Record<string, Step[]>, storage?: StorageMocks) {
  const calls: RecordedCall[] = [];
  const queues = Object.fromEntries(Object.entries(plan).map(([table, steps]) => [table, [...steps]]));
  const buckets: string[] = [];
  const client = {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "insert", "update", "delete", "eq", "is", "in", "gt", "order", "limit", "maybeSingle"]) {
        chain[method] = (...args: unknown[]) => (calls.push({ table, method, args }), chain);
      }
      chain.then = (resolve: (value: Step) => unknown, reject: (reason: unknown) => unknown) => {
        const step = queues[table]?.shift();
        if (step === undefined) return reject(new Error(`no planned result for ${table}`));
        return resolve({ data: null, error: null, count: null, ...step });
      };
      return chain;
    },
    storage: {
      from(bucket: string) {
        buckets.push(bucket);
        return {
          upload: storage?.upload ?? vi.fn(async () => ({ error: null })),
          remove: storage?.remove ?? vi.fn(async () => ({ data: [{}], error: null })),
          getPublicUrl: (path: string) => ({
            data: { publicUrl: `${BASE_URL}/storage/v1/object/public/designer-assets/${path}` },
          }),
        };
      },
    },
  } as unknown as SupabaseClient;
  return { client, calls, buckets };
}

const updates = (calls: RecordedCall[]) => calls.filter((c) => c.method === "update").map((c) => c.args[0]);

describe("getDesigner", () => {
  it("id 格式錯誤時不送查詢，回傳 ok(null)", async () => {
    const { client, calls } = recordingClient({});
    expect(await getDesigner(client, "new")).toEqual({ ok: true, data: null });
    expect(calls).toHaveLength(0);
  });

  it("查不到回傳 ok(null)，和讀取失敗分開", async () => {
    const { client } = recordingClient({ designers: [{ data: null }] });
    expect(await getDesigner(client, ID)).toEqual({ ok: true, data: null });
  });

  it("查詢失敗回傳通用錯誤", async () => {
    const { client } = recordingClient({ designers: [{ error: { message: "boom", code: "XX000" } }] });
    expect(await getDesigner(client, ID)).toEqual({ ok: false, error: { message: GENERIC } });
  });

  it("查到時回傳設計師，select 列出明確欄位", async () => {
    const { client, calls } = recordingClient({ designers: [{ data: DESIGNER_ROW }] });
    expect(await getDesigner(client, ID)).toEqual({ ok: true, data: DESIGNER_ROW });
    expect(calls.find((c) => c.method === "select")?.args[0]).toBe(
      "id, name, bio, specialties, instagram_handle, avatar_url, is_active, sort_order",
    );
  });
});

describe("toBasicInfoPayload", () => {
  it("只含被欄位層級 GRANT 授權的 4 個基本資料欄位（不含 id／created_at／avatar_url／is_active）", () => {
    const payload = toBasicInfoPayload({ name: "林小美", instagram: "", specialties: [], bio: "" });
    expect(Object.keys(payload).sort()).toEqual(["bio", "instagram_handle", "name", "specialties"]);
  });

  it("名稱與專長去前後空白、IG 去 @、簡介空白轉 null", () => {
    expect(
      toBasicInfoPayload({
        name: "  林小美\t",
        instagram: " @mei.hair ",
        specialties: [" 韓系剪髮 ", "", "漸層染"],
        bio: "  \n ",
      }),
    ).toEqual({ name: "林小美", bio: null, specialties: ["韓系剪髮", "漸層染"], instagram_handle: "mei.hair" });
  });

  it("空 IG 轉 null；簡介換行統一成 \\n", () => {
    expect(toBasicInfoPayload({ name: "A", instagram: "@", specialties: [], bio: "a\r\nb" })).toMatchObject({
      instagram_handle: null,
      bio: "a\nb",
    });
  });

  it("名稱與專長做 NFC 正規化", () => {
    const payload = toBasicInfoPayload({ name: "é", instagram: "", specialties: ["é"], bio: "" });
    expect(payload.name).toBe("é");
    expect(payload.specialties).toEqual(["é"]);
  });
});

describe("createDesigner", () => {
  it("sort_order 取目前最大值＋1，預設啟用，只送被授權的欄位", async () => {
    const { client, calls } = recordingClient({
      designers: [{ data: [{ sort_order: 4 }] }, { data: [{ id: "new-id" }] }],
    });
    const result = await createDesigner(client, { name: "新人", instagram: "@x", specialties: ["燙髮"], bio: "" });

    expect(result).toEqual({ ok: true, data: { id: "new-id" } });
    expect(calls.find((c) => c.method === "order")?.args).toEqual(["sort_order", { ascending: false }]);
    const inserted = calls.find((c) => c.method === "insert")?.args[0] as Record<string, unknown>;
    expect(inserted).toEqual({
      name: "新人",
      bio: null,
      specialties: ["燙髮"],
      instagram_handle: "x",
      sort_order: 5,
      is_active: true,
    });
    expect(Object.keys(inserted)).not.toContain("id");
    expect(Object.keys(inserted)).not.toContain("created_at");
    expect(Object.keys(inserted)).not.toContain("avatar_url");
  });

  it("沒有任何設計師時 sort_order 從 0 開始", async () => {
    const { client, calls } = recordingClient({ designers: [{ data: [] }, { data: [{ id: "a" }] }] });
    await createDesigner(client, BLANK);
    expect((calls.find((c) => c.method === "insert")?.args[0] as { sort_order: number }).sort_order).toBe(0);
  });

  it("讀取最大值失敗：回傳通用錯誤且不呼叫 insert", async () => {
    const { client, calls } = recordingClient({ designers: [{ error: { message: "x" } }] });
    expect(await createDesigner(client, BLANK)).toEqual({ ok: false, error: { message: GENERIC } });
    expect(calls.some((c) => c.method === "insert")).toBe(false);
  });

  it("寫入失敗回傳通用錯誤，不外洩 constraint 名稱", async () => {
    const { client } = recordingClient({
      designers: [{ data: [] }, { error: { message: 'new row violates check constraint "designers_name_valid"' } }],
    });
    expect(await createDesigner(client, BLANK)).toEqual({ ok: false, error: { message: GENERIC } });
  });

  it("insert 沒有回傳剛好 1 列時視為失敗", async () => {
    const { client } = recordingClient({ designers: [{ data: [] }, { data: [] }] });
    expect((await createDesigner(client, BLANK)).ok).toBe(false);
  });
});

describe("updateDesignerBasicInfo／setDesignerActive", () => {
  it("更新只送 4 個基本資料欄位，並用 id 過濾", async () => {
    const { client, calls } = recordingClient({ designers: [{ data: [{ id: ID }] }] });
    expect((await updateDesignerBasicInfo(client, ID, BLANK)).ok).toBe(true);

    expect(Object.keys(updates(calls)[0] as object).sort()).toEqual(["bio", "instagram_handle", "name", "specialties"]);
    expect(calls.find((c) => c.method === "eq")?.args).toEqual(["id", ID]);
  });

  it("RLS 悄悄擋下（0 列）或出錯時回傳通用錯誤，不外洩原始錯誤", async () => {
    const blocked = recordingClient({ designers: [{ data: [] }] });
    expect((await updateDesignerBasicInfo(blocked.client, ID, BLANK)).ok).toBe(false);

    const failed = recordingClient({ designers: [{ error: { message: "Failing row contains (secret)" } }] });
    expect(await updateDesignerBasicInfo(failed.client, ID, BLANK)).toEqual({ ok: false, error: { message: GENERIC } });
  });

  it("setDesignerActive 只送 is_active", async () => {
    const { client, calls } = recordingClient({ designers: [{ data: [{ id: ID }] }] });
    expect((await setDesignerActive(client, ID, false)).ok).toBe(true);
    expect(updates(calls)[0]).toEqual({ is_active: false });
  });

  it("setDesignerActive 0 列或錯誤時失敗", async () => {
    expect((await setDesignerActive(recordingClient({ designers: [{ data: [] }] }).client, ID, true)).ok).toBe(false);
    expect(
      (await setDesignerActive(recordingClient({ designers: [{ error: { code: "42501" } }] }).client, ID, true)).ok,
    ).toBe(false);
  });
});

describe("countFutureAppointmentsForDesigner", () => {
  it("只查 pending／confirmed 且未來的預約，head count 且只 select id（不用 *）", async () => {
    const { client, calls } = recordingClient({ appointments: [{ count: 3 }] });
    expect(await countFutureAppointmentsForDesigner(client, ID)).toEqual({ ok: true, data: 3 });

    expect(calls.find((c) => c.method === "select")?.args).toEqual(["id", { count: "exact", head: true }]);
    expect(calls.find((c) => c.method === "eq")?.args).toEqual(["designer_id", ID]);
    expect(calls.find((c) => c.method === "in")?.args).toEqual(["status", ["pending", "confirmed"]]);
    expect(calls.find((c) => c.method === "gt")?.args[0]).toBe("start_at");
  });

  it("查詢失敗不回傳 0，回傳失敗讓畫面顯示「無法取得」", async () => {
    const failed = recordingClient({ appointments: [{ error: { code: "42501" } }] });
    expect((await countFutureAppointmentsForDesigner(failed.client, ID)).ok).toBe(false);
    const noCount = recordingClient({ appointments: [{ count: null }] });
    expect((await countFutureAppointmentsForDesigner(noCount.client, ID)).ok).toBe(false);
  });
});

describe("planDesignerOrderSwap", () => {
  const distinct = [
    { id: "a", sort_order: 0 },
    { id: "b", sort_order: 1 },
    { id: "c", sort_order: 5 },
  ];

  it("sort_order 都不同時只交換相鄰兩列的值", () => {
    expect(planDesignerOrderSwap(distinct, 1, "up")).toEqual([
      { id: "b", sort_order: 0 },
      { id: "a", sort_order: 1 },
    ]);
    expect(planDesignerOrderSwap(distinct, 1, "down")).toEqual([
      { id: "b", sort_order: 5 },
      { id: "c", sort_order: 1 },
    ]);
  });

  it("有重複的 sort_order 時整份依新順序重新編號，只列出值有變的列", () => {
    const tied = [
      { id: "a", sort_order: 0 },
      { id: "b", sort_order: 0 },
      { id: "c", sort_order: 0 },
    ];
    // 把 c 上移：新順序 a, c, b → 0, 1, 2；a 已是 0 不用寫。
    expect(planDesignerOrderSwap(tied, 2, "up")).toEqual([
      { id: "c", sort_order: 1 },
      { id: "b", sort_order: 2 },
    ]);
  });

  it("相鄰兩列不同值、但別處有重複時也要重新編號（避免交換後與第三列同值排錯）", () => {
    const list = [
      { id: "a", sort_order: 1 },
      { id: "b", sort_order: 2 },
      { id: "c", sort_order: 2 },
    ];
    // 新順序 b, a, c → 0, 1, 2；a、c 的值已經正確，只需要寫 b。
    expect(planDesignerOrderSwap(list, 0, "down")).toEqual([{ id: "b", sort_order: 0 }]);
  });

  it("第一列不能上移、最後一列不能下移、索引越界都回傳空陣列", () => {
    expect(planDesignerOrderSwap(distinct, 0, "up")).toEqual([]);
    expect(planDesignerOrderSwap(distinct, 2, "down")).toEqual([]);
    expect(planDesignerOrderSwap(distinct, -1, "down")).toEqual([]);
    expect(planDesignerOrderSwap(distinct, 9, "up")).toEqual([]);
    expect(planDesignerOrderSwap([], 0, "down")).toEqual([]);
  });
});

describe("swapDesignerOrder", () => {
  const list = [
    { id: "a", sort_order: 0 },
    { id: "b", sort_order: 1 },
  ];

  it("成功時依序寫入兩列，且只送 sort_order", async () => {
    const { client, calls } = recordingClient({ designers: [{ data: [{ id: "x" }] }, { data: [{ id: "x" }] }] });
    expect((await swapDesignerOrder(client, list, 1, "up")).ok).toBe(true);
    expect(updates(calls)).toEqual([{ sort_order: 0 }, { sort_order: 1 }]);
  });

  it("第一次寫入失敗：回傳失敗，不繼續寫第二列", async () => {
    const { client, calls } = recordingClient({ designers: [{ error: { code: "42501" } }] });
    expect(await swapDesignerOrder(client, list, 1, "up")).toEqual({ ok: false, error: { message: GENERIC } });
    expect(updates(calls)).toHaveLength(1);
  });

  it("第二次寫入失敗：盡力把第一列改回原值，仍回傳失敗", async () => {
    const { client, calls } = recordingClient({
      designers: [{ data: [{ id: "x" }] }, { data: [] }, { data: [{ id: "x" }] }],
    });
    expect((await swapDesignerOrder(client, list, 1, "up")).ok).toBe(false);
    // 先寫 b→0，再寫 a→1 失敗，補償：b 改回原值 1。
    expect(updates(calls)).toEqual([{ sort_order: 0 }, { sort_order: 1 }, { sort_order: 1 }]);
  });

  it("沒有可移動的方向時不呼叫資料庫", async () => {
    const { client, calls } = recordingClient({});
    expect(await swapDesignerOrder(client, list, 0, "up")).toEqual({ ok: true, data: undefined });
    expect(calls).toHaveLength(0);
  });
});

describe("validateDesignerImageFile", () => {
  it("jpg／png／webp 且 5MB 內通過（邊界）", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      expect(validateDesignerImageFile(new File(["x"], "a", { type }))).toBeNull();
    }
    const exactly = new File([new Uint8Array(5 * 1024 * 1024)], "a.png", { type: "image/png" });
    expect(validateDesignerImageFile(exactly)).toBeNull();
  });

  it("其他格式或超過 5MB 回傳錯誤", () => {
    expect(validateDesignerImageFile(new File(["x"], "a.gif", { type: "image/gif" }))).toBe("檔案格式需為 JPG／PNG／WebP");
    expect(validateDesignerImageFile(new File(["x"], "a", { type: "constructor" }))).toBe("檔案格式需為 JPG／PNG／WebP");
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "a.png", { type: "image/png" });
    expect(validateDesignerImageFile(big)).toBe("檔案大小需小於 5MB");
  });
});

describe("parseDesignerAvatarPath", () => {
  const prefix = `${BASE_URL}/storage/v1/object/public/designer-assets`;
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", BASE_URL);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("這位設計師自己的頭像網址解析出物件路徑", () => {
    expect(parseDesignerAvatarPath(`${prefix}/avatar/${ID}/${UUID}.webp`, ID)).toBe(`avatar/${ID}/${UUID}.webp`);
    expect(parseDesignerAvatarPath(`${prefix}/avatar/${ID}/${UUID}.jpg`, ID)).toBe(`avatar/${ID}/${UUID}.jpg`);
  });

  it.each([
    ["其他設計師的頭像", `${prefix}/avatar/${OTHER_ID}/${UUID}.webp`],
    ["同一位設計師的作品集檔案", `${prefix}/portfolio/${ID}/${UUID}.webp`],
    ["其他 bucket", `${BASE_URL}/storage/v1/object/public/store-assets/avatar/${ID}/${UUID}.webp`],
    ["外部網域", `https://evil.example.com/storage/v1/object/public/designer-assets/avatar/${ID}/${UUID}.webp`],
    ["帶 query", `${prefix}/avatar/${ID}/${UUID}.webp?x=1`],
    ["帶 hash", `${prefix}/avatar/${ID}/${UUID}.webp#x`],
    ["路徑穿越", `${prefix}/avatar/${ID}/../${OTHER_ID}/${UUID}.webp`],
    ["編碼斜線", `${prefix}/avatar/${ID}%2F${UUID}.webp`],
    ["檔名不是 uuid", `${prefix}/avatar/${ID}/photo.webp`],
    ["副檔名不在白名單", `${prefix}/avatar/${ID}/${UUID}.gif`],
    ["多一層目錄", `${prefix}/avatar/${ID}/x/${UUID}.webp`],
    ["不是網址", "avatar/foo"],
  ])("%s 不解析（回傳 null，呼叫端就不刪檔）", (_label, url) => {
    expect(parseDesignerAvatarPath(url, ID)).toBeNull();
  });

  it("null 網址或非小寫 uuid 的 designerId 回傳 null", () => {
    expect(parseDesignerAvatarPath(null, ID)).toBeNull();
    expect(parseDesignerAvatarPath(`${prefix}/avatar/${ID}/${UUID}.webp`, ID.toUpperCase())).toBeNull();
    expect(parseDesignerAvatarPath(`${prefix}/avatar/x/${UUID}.webp`, "x")).toBeNull();
  });
});

describe("uploadDesignerAvatar／removeDesignerAvatar", () => {
  const oldUrl = `${BASE_URL}/storage/v1/object/public/designer-assets/avatar/${ID}/${UUID}.webp`;
  const newPath = `avatar/${ID}/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.webp`;
  const newUrl = `${BASE_URL}/storage/v1/object/public/designer-assets/${newPath}`;
  const pngFile = () => new File(["x"], "a.png", { type: "image/png" });

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", BASE_URL);
    vi.mocked(reencodeImage).mockResolvedValue({
      ok: true,
      blob: new Blob(["y"], { type: "image/webp" }),
      extension: "webp",
    });
    vi.spyOn(crypto, "randomUUID").mockReturnValue("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.mocked(reencodeImage).mockReset();
  });

  it("成功：上傳重新編碼後的 blob 到 avatar/<id>/<uuid>.webp，CAS 更新，刪掉舊檔", async () => {
    const upload = vi.fn(async () => ({ error: null }));
    const remove = vi.fn(async () => ({ data: [{ name: "old" }], error: null }));
    const { client, calls, buckets } = recordingClient(
      { designers: [{ data: { avatar_url: oldUrl } }, { data: [{ id: ID }] }] },
      { upload, remove },
    );

    const result = await uploadDesignerAvatar(client, ID, pngFile());

    expect(result).toEqual({ ok: true, data: { url: newUrl, cleanupWarning: false } });
    expect(buckets.every((b) => b === "designer-assets")).toBe(true);
    const [path, body, options] = upload.mock.calls[0] as unknown as [string, Blob, Record<string, unknown>];
    expect(path).toBe(newPath);
    expect(body.type).toBe("image/webp");
    expect(options).toEqual({ contentType: "image/webp", upsert: false });
    // CAS：舊值用 eq 比對。
    expect(calls.some((c) => c.method === "eq" && c.args[0] === "avatar_url" && c.args[1] === oldUrl)).toBe(true);
    expect(updates(calls)[0]).toEqual({ avatar_url: newUrl });
    expect(remove).toHaveBeenCalledWith([`avatar/${ID}/${UUID}.webp`]);
  });

  it("原本沒有頭像：CAS 用 is null，沒有舊檔要刪也不需警告", async () => {
    const remove = vi.fn();
    const { client, calls } = recordingClient(
      { designers: [{ data: { avatar_url: null } }, { data: [{ id: ID }] }] },
      { remove },
    );
    const result = await uploadDesignerAvatar(client, ID, pngFile());

    expect(result).toEqual({ ok: true, data: { url: newUrl, cleanupWarning: false } });
    expect(calls.some((c) => c.method === "is" && c.args[0] === "avatar_url" && c.args[1] === null)).toBe(true);
    expect(remove).not.toHaveBeenCalled();
  });

  it("重新編碼失敗：中止，不上傳任何檔案（不退回上傳原檔）", async () => {
    vi.mocked(reencodeImage).mockResolvedValue({ ok: false, message: "圖片解析度過大，請換一張較小的圖片" });
    const upload = vi.fn();
    const { client } = recordingClient({}, { upload });

    const result = await uploadDesignerAvatar(client, ID, pngFile());
    expect(result).toEqual({ ok: false, error: { message: "圖片解析度過大，請換一張較小的圖片" } });
    expect(upload).not.toHaveBeenCalled();
  });

  it("前置驗證失敗（格式）：不重新編碼、不上傳", async () => {
    const { client } = recordingClient({});
    const result = await uploadDesignerAvatar(client, ID, new File(["x"], "a.gif", { type: "image/gif" }));
    expect(result).toEqual({ ok: false, error: { message: "檔案格式需為 JPG／PNG／WebP" } });
    expect(reencodeImage).not.toHaveBeenCalled();
  });

  it("designerId 不是小寫 uuid 時拒絕（不組出會被 Storage policy 擋下的路徑）", async () => {
    const { client } = recordingClient({});
    expect((await uploadDesignerAvatar(client, ID.toUpperCase(), pngFile())).ok).toBe(false);
    expect((await uploadDesignerAvatar(client, "../x", pngFile())).ok).toBe(false);
    expect(reencodeImage).not.toHaveBeenCalled();
  });

  it("Storage 上傳失敗：回傳通用錯誤，不更新資料列", async () => {
    const upload = vi.fn(async () => ({ error: { message: "bucket path secret" } }));
    const { client, calls } = recordingClient({ designers: [{ data: { avatar_url: null } }] }, { upload });

    expect(await uploadDesignerAvatar(client, ID, pngFile())).toEqual({ ok: false, error: { message: GENERIC } });
    expect(updates(calls)).toHaveLength(0);
  });

  it("CAS 0 列（資料已被別處改過）：補刪剛上傳的新檔，提示重新整理，不刪舊檔", async () => {
    const remove = vi.fn(async () => ({ data: [{}], error: null }));
    const { client } = recordingClient({ designers: [{ data: { avatar_url: oldUrl } }, { data: [] }] }, { remove });

    const result = await uploadDesignerAvatar(client, ID, pngFile());
    expect(result).toEqual({ ok: false, error: { message: "頭像已被其他操作變更，請重新整理頁面後再試。" } });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith([newPath]);
  });

  it("結果不明的失敗但重讀發現已寫入：視為成功，絕不補刪正在使用的新檔", async () => {
    const remove = vi.fn(async () => ({ data: [{}], error: null }));
    const { client } = recordingClient(
      {
        designers: [
          { data: { avatar_url: oldUrl } },
          { error: { message: "network", code: "" } }, // 更新：結果不明
          { data: { avatar_url: newUrl } }, // 重讀：其實已寫入
        ],
      },
      { remove },
    );

    expect((await uploadDesignerAvatar(client, ID, pngFile())).ok).toBe(true);
    expect(remove).not.toHaveBeenCalledWith([newPath]);
    expect(remove).toHaveBeenCalledWith([`avatar/${ID}/${UUID}.webp`]); // 只刪舊檔
  });

  it("結果不明且重讀確認沒寫入：補刪新檔並回傳失敗", async () => {
    const remove = vi.fn(async () => ({ data: [{}], error: null }));
    const { client } = recordingClient(
      {
        designers: [
          { data: { avatar_url: oldUrl } },
          { error: { message: "network", code: "" } },
          { data: { avatar_url: oldUrl } },
        ],
      },
      { remove },
    );

    expect(await uploadDesignerAvatar(client, ID, pngFile())).toEqual({ ok: false, error: { message: GENERIC } });
    expect(remove).toHaveBeenCalledWith([newPath]);
  });

  it("結果不明且重讀也失敗：不補刪（寧可留下孤兒檔，也不刪可能正在使用的檔案）", async () => {
    const remove = vi.fn();
    const { client } = recordingClient(
      {
        designers: [
          { data: { avatar_url: oldUrl } },
          { error: { message: "network", code: "" } },
          { error: { message: "network" } },
        ],
      },
      { remove },
    );
    expect((await uploadDesignerAvatar(client, ID, pngFile())).ok).toBe(false);
    expect(remove).not.toHaveBeenCalled();
  });

  it("舊頭像網址無法安全解析（被手動改過）：資料列照更新，不刪檔，回傳警告", async () => {
    const remove = vi.fn();
    const tampered = `${BASE_URL}/storage/v1/object/public/designer-assets/avatar/${OTHER_ID}/${UUID}.webp`;
    const { client } = recordingClient(
      { designers: [{ data: { avatar_url: tampered } }, { data: [{ id: ID }] }] },
      { remove },
    );

    expect(await uploadDesignerAvatar(client, ID, pngFile())).toEqual({
      ok: true,
      data: { url: newUrl, cleanupWarning: true },
    });
    expect(remove).not.toHaveBeenCalled();
  });

  it("刪舊檔沒刪到恰好 1 個（例如缺 select 權限回空陣列）：成功但回傳警告", async () => {
    const remove = vi.fn(async () => ({ data: [], error: null }));
    const { client } = recordingClient(
      { designers: [{ data: { avatar_url: oldUrl } }, { data: [{ id: ID }] }] },
      { remove },
    );
    expect(await uploadDesignerAvatar(client, ID, pngFile())).toEqual({
      ok: true,
      data: { url: newUrl, cleanupWarning: true },
    });
  });

  it("移除頭像：先 CAS 改成 null，成功才刪檔", async () => {
    const remove = vi.fn(async () => ({ data: [{}], error: null }));
    const { client, calls } = recordingClient(
      { designers: [{ data: { avatar_url: oldUrl } }, { data: [{ id: ID }] }] },
      { remove },
    );

    expect(await removeDesignerAvatar(client, ID)).toEqual({ ok: true, data: { cleanupWarning: false } });
    expect(updates(calls)[0]).toEqual({ avatar_url: null });
    expect(remove).toHaveBeenCalledWith([`avatar/${ID}/${UUID}.webp`]);
  });

  it("移除頭像：CAS 失敗（0 列）時不刪檔", async () => {
    const remove = vi.fn();
    const { client } = recordingClient({ designers: [{ data: { avatar_url: oldUrl } }, { data: [] }] }, { remove });
    expect((await removeDesignerAvatar(client, ID)).ok).toBe(false);
    expect(remove).not.toHaveBeenCalled();
  });

  it("移除頭像：本來就沒有頭像時直接成功，不寫入", async () => {
    const { client, calls } = recordingClient({ designers: [{ data: { avatar_url: null } }] });
    expect(await removeDesignerAvatar(client, ID)).toEqual({ ok: true, data: { cleanupWarning: false } });
    expect(updates(calls)).toHaveLength(0);
  });
});

// TASK-070：設計師服務開關。
const SERVICE_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const eqArgs = (calls: RecordedCall[]) => calls.filter((c) => c.method === "eq").map((c) => c.args);

describe("listDesignerServiceIds", () => {
  it("只查這位設計師的 service_id，回傳 id 陣列", async () => {
    const { client, calls } = recordingClient({
      designer_services: [{ data: [{ service_id: SERVICE_ID }, { service_id: UUID }] }],
    });

    expect(await listDesignerServiceIds(client, ID)).toEqual({ ok: true, data: [SERVICE_ID, UUID] });
    expect(calls.find((c) => c.method === "select")?.args).toEqual(["service_id"]);
    expect(eqArgs(calls)).toEqual([["designer_id", ID]]);
  });

  it("格式錯誤的 id 不送查詢；查詢失敗回通用訊息", async () => {
    const none = recordingClient({});
    expect((await listDesignerServiceIds(none.client, "bad")).ok).toBe(false);
    expect(none.calls).toHaveLength(0);

    const { client } = recordingClient({ designer_services: [{ error: { message: "relation boom" } }] });
    expect(await listDesignerServiceIds(client, ID)).toEqual({ ok: false, error: { message: GENERIC } });
  });
});

describe("setDesignerService", () => {
  it("開啟＝insert 剛好 designer_id／service_id 兩個欄位，不用 upsert 也不帶 select", async () => {
    const { client, calls } = recordingClient({ designer_services: [{}] });

    expect(await setDesignerService(client, ID, SERVICE_ID, true)).toEqual({ ok: true, data: undefined });
    const insert = calls.find((c) => c.method === "insert");
    expect(insert?.args[0]).toEqual({ designer_id: ID, service_id: SERVICE_ID });
    expect(calls.map((c) => c.method)).toEqual(["insert"]);
  });

  it("開啟時主鍵衝突（23505）視為成功（冪等）", async () => {
    const { client } = recordingClient({ designer_services: [{ error: { code: "23505", message: "duplicate" } }] });
    expect(await setDesignerService(client, ID, SERVICE_ID, true)).toEqual({ ok: true, data: undefined });
  });

  it("開啟時其他錯誤（23503 外鍵、42501 權限）回通用訊息，不外洩原始訊息", async () => {
    for (const code of ["23503", "42501", "22P02"]) {
      const { client } = recordingClient({
        designer_services: [{ error: { code, message: "boom", details: "Key (service_id)=(x)" } }],
      });
      const result = await setDesignerService(client, ID, SERVICE_ID, true);
      expect(result).toEqual({ ok: false, error: { message: GENERIC } });
    }
  });

  it("只比對 code：message 含 duplicate 但 code 不是 23505 不算成功", async () => {
    const { client } = recordingClient({ designer_services: [{ error: { code: "XX000", message: "23505 duplicate key" } }] });
    expect((await setDesignerService(client, ID, SERVICE_ID, true)).ok).toBe(false);
  });

  it("關閉＝delete 且剛好兩個 eq（designer_id、service_id），刪到 1 列才成功", async () => {
    const { client, calls } = recordingClient({ designer_services: [{ data: [{ service_id: SERVICE_ID }] }] });

    expect(await setDesignerService(client, ID, SERVICE_ID, false)).toEqual({ ok: true, data: undefined });
    expect(calls.map((c) => c.method)).toEqual(["delete", "eq", "eq", "select"]);
    expect(eqArgs(calls)).toEqual([
      ["designer_id", ID],
      ["service_id", SERVICE_ID],
    ]);
    expect(calls.find((c) => c.method === "select")?.args).toEqual(["service_id"]);
  });

  it("關閉時刪到 0 列（被 RLS 擋下或別處已關閉）不當成功；多於 1 列、錯誤也失敗", async () => {
    for (const step of [
      { data: [] },
      { data: null },
      { data: [{ service_id: SERVICE_ID }, { service_id: UUID }] },
      { error: { code: "42501", message: "boom" } },
    ]) {
      const { client } = recordingClient({ designer_services: [step] });
      expect(await setDesignerService(client, ID, SERVICE_ID, false)).toEqual({ ok: false, error: { message: GENERIC } });
    }
  });

  it("id 格式錯誤（空字串、非 uuid）不送任何請求", async () => {
    const { client, calls } = recordingClient({});
    for (const [designerId, serviceId] of [
      [ID, ""],
      ["", SERVICE_ID],
      [ID, "not-a-uuid"],
      ["not-a-uuid", SERVICE_ID],
    ]) {
      expect((await setDesignerService(client, designerId, serviceId, false)).ok).toBe(false);
      expect((await setDesignerService(client, designerId, serviceId, true)).ok).toBe(false);
    }
    expect(calls).toHaveLength(0);
  });

  it("請求丟出例外（網路中斷）時回通用訊息，不往外拋", async () => {
    const client = {
      from: () => {
        throw new Error("fetch failed");
      },
    } as unknown as SupabaseClient;
    expect(await setDesignerService(client, ID, SERVICE_ID, true)).toEqual({ ok: false, error: { message: GENERIC } });
    expect(await setDesignerService(client, ID, SERVICE_ID, false)).toEqual({ ok: false, error: { message: GENERIC } });
  });
});
