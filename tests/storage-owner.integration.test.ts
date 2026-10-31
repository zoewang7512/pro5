// TASK-113（Demo 體驗帳戶）：對真實 Supabase 專案執行的整合測試，驗證 0025_storage_owner_and_demo_caps.sql：
//   * admin-assets 的 update／delete 限擁有者（RESTRICTIVE policy）；
//   * Demo 帳戶完全不能 update（含 move、upsert 覆寫；RESTRICTIVE policy）；
//   * Demo 在三個公開 bucket 的擁有物件數上限 30（BEFORE INSERT 觸發器：簽名上傳網址與並行上傳也擋得住）。
//
// 不放進預設 `npm test`，只透過 `npm run test:storage-owner` 執行（缺設定時直接噴錯，不略過）。
//
// 只建立與刪除自己的拋棄式帳號（app_metadata.storageowner_test = true，Email 含 storageowner，雙重條件才會被清除）：
// 兩位一般管理員 A、B 與一位 Demo（app_metadata.is_demo = true），都暫時登記進 admins（is_admin() 為真）。
// A 在這裡扮演 designer001（頭像擁有者）。不讀取、登入或修改 designer001 與真實 Demo 帳戶，不碰任何真實物件；
// 測試物件都用拋棄式帳號當擁有者（或測試內自己用 service role 上傳並自己刪除），結尾（與開頭）依擁有者清除；
// 登出只用 scope: "local"。前後各記錄三個公開 bucket 的物件清單，結尾比對相同（證明沒有留下或動到任何真實物件）。
//
// 注意：測試期間系統內會暫時多一個 is_demo 帳戶，此時 Demo 還原函式（0024）／demo_revoke_sessions／upload-demo-images 會因
// 「不是剛好 1 個 Demo 帳戶」而拒絕執行；開啟排程還原後，請避開台北 03:00–04:00 跑 test:*。
//
// 兩種模式（驗收標準：套用 _down.sql 後行為恢復）：
//   預設（保護生效中）：npm run test:storage-owner
//   套用 _down.sql 之後：PowerShell  $env:STORAGE_OWNER_EXPECT="off"; npm run test:storage-owner
//                       Bash         STORAGE_OWNER_EXPECT=off npm run test:storage-owner
//   off 模式下：B 能刪除與搬動 A 的物件、Demo 沒有上限也可以 update。
//   鑑別力：每個「生效中被擋」的斷言在 off 模式都有對應的「沒被擋」斷言；沒有保護時預設模式會失敗。
//
// 限流提醒：每輪 3 次密碼登入，Supabase 預設每 IP 每 5 分鐘 30 次。
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceRoleKey) {
  throw new Error(
    "[storage-owner.integration.test] 缺少 NEXT_PUBLIC_SUPABASE_URL／NEXT_PUBLIC_SUPABASE_ANON_KEY／" +
      "SUPABASE_SERVICE_ROLE_KEY，請確認 .env.local 已填妥。",
  );
}

const policyActive = process.env.STORAGE_OWNER_EXPECT !== "off";
const CAP = 30;
const BUCKETS = ["admin-assets", "store-assets", "designer-assets"] as const;
type Bucket = (typeof BUCKETS)[number];

const clientOptions = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(url, serviceRoleKey, clientOptions);

// 1×1 透明 PNG（68 bytes）。
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const BIGGER_PNG = Buffer.concat([TINY_PNG, Buffer.from("x")]); // 內容不同，用來驗證「覆寫是否發生」

type TestUser = { id: string; email: string; password: string; client: SupabaseClient };

// 符合既有 insert policy 的路徑（admin-assets: avatar/；store-assets: logo/；designer-assets: avatar/<uuid>/<uuid>.png）
function testPath(bucket: Bucket, label: string): string {
  const id = randomUUID();
  if (bucket === "admin-assets") return `avatar/__TEST__${label}-${id}.png`;
  if (bucket === "store-assets") return `logo/__TEST__${label}-${id}.png`;
  return `avatar/${randomUUID()}/${id}.png`;
}

async function listObjects(bucket: Bucket) {
  const out: Array<{ name: string; size: number | null; owner_id: string | null }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.rpc("demo_list_storage_objects", { p_bucket: bucket }).range(from, from + 999);
    if (error) throw new Error(`列出 ${bucket} 失敗：${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function snapshot() {
  const snap: Record<string, string[]> = {};
  for (const bucket of BUCKETS) {
    snap[bucket] = (await listObjects(bucket)).map((o) => `${o.name}|${o.size}|${o.owner_id}`).sort();
  }
  return snap;
}

async function listTestUsers() {
  const found = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`列出使用者失敗：${error.message}`);
    found.push(...data.users);
    if (data.users.length < 200) break;
  }
  return found.filter((u) => u.app_metadata?.storageowner_test === true && u.email?.includes("storageowner"));
}

// 先清擁有者是拋棄式帳號的物件，再刪 admins 登記與帳號。
async function cleanup() {
  const users = await listTestUsers();
  const ids = new Set(users.map((u) => u.id));
  for (const bucket of BUCKETS) {
    const mine = (await listObjects(bucket)).filter((o) => o.owner_id && ids.has(o.owner_id)).map((o) => o.name);
    for (let i = 0; i < mine.length; i += 100) {
      const { error } = await admin.storage.from(bucket).remove(mine.slice(i, i + 100));
      if (error) throw new Error(`清除 ${bucket} 測試物件失敗：${error.message}`);
    }
  }
  const failures: string[] = [];
  for (const user of users) {
    const { error: adminsError } = await admin.from("admins").delete().eq("user_id", user.id);
    if (adminsError) failures.push(`admins ${user.id}：${adminsError.message}`);
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) failures.push(`${user.id}：${error.message}`);
  }
  if (failures.length > 0) throw new Error(`清除拋棄式帳號失敗：${failures.join("；")}`);
  const leftover = await listTestUsers();
  if (leftover.length > 0) throw new Error(`清除後仍殘留 ${leftover.length} 個拋棄式帳號`);
  for (const bucket of BUCKETS) {
    const left = (await listObjects(bucket)).filter((o) => o.owner_id && ids.has(o.owner_id));
    if (left.length > 0) throw new Error(`清除後 ${bucket} 仍殘留 ${left.length} 個測試物件`);
  }
}

async function createAdminUser(kind: "a" | "b" | "demo"): Promise<TestUser> {
  const email = `delivered+storageowner-${kind}-${randomUUID().slice(0, 8)}@resend.dev`;
  const password = `${randomUUID()}${randomUUID().slice(0, 8)}aA1!`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: kind === "demo" ? { storageowner_test: true, is_demo: true } : { storageowner_test: true },
    user_metadata: { name: `__TEST__storageowner-${kind}` },
  });
  if (error || !data.user) throw new Error(`建立 ${kind} 拋棄式帳號失敗：${error?.message ?? "沒有回傳使用者"}`);
  const { error: regError } = await admin.from("admins").insert({ user_id: data.user.id });
  if (regError) throw new Error(`登記 ${kind} 進 admins 失敗：${regError.message}`);
  const client = createClient(url!, anonKey!, clientOptions);
  const { data: signIn, error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError || !signIn.session) throw new Error(`登入 ${kind} 失敗：${signInError?.message ?? "沒有 session"}`);
  return { id: data.user.id, email, password, client };
}

async function findObject(bucket: Bucket, name: string) {
  return (await listObjects(bucket)).find((o) => o.name === name) ?? null;
}

async function ownedBy(user: TestUser, bucket: Bucket) {
  return (await listObjects(bucket)).filter((o) => o.owner_id === user.id);
}

async function upload(user: TestUser, bucket: Bucket, name: string, body: Buffer = TINY_PNG, upsert = false) {
  return user.client.storage.from(bucket).upload(name, body, { contentType: "image/png", upsert });
}

// 讓 user 在 bucket 內擁有至少 count 個物件（每批 5 個，總數不超過 count，Demo 在上限內不會被擋）。
async function ensureOwned(user: TestUser, bucket: Bucket, count: number) {
  let have = (await ownedBy(user, bucket)).length;
  while (have < count) {
    const batch = Array.from({ length: Math.min(5, count - have) }, () => testPath(bucket, "fill"));
    const results = await Promise.all(batch.map((name) => upload(user, bucket, name)));
    results.forEach((r) => expect(r.error, `${bucket} 上傳失敗：${r.error?.message}`).toBeNull());
    have += batch.length;
  }
}

async function clearOwned(user: TestUser, bucket: Bucket) {
  const mine = (await ownedBy(user, bucket)).map((o) => o.name);
  if (mine.length === 0) return;
  const { error } = await admin.storage.from(bucket).remove(mine);
  expect(error).toBeNull();
}

describe(`Storage 擁有者限制與 Demo 上傳上限（${policyActive ? "保護生效中" : "off：已套用 _down.sql"}）`, () => {
  let before: Record<string, string[]> | undefined;
  let a: TestUser; // 一般管理員 A（扮演 designer001：頭像擁有者）
  let b: TestUser; // 一般管理員 B
  let demo: TestUser;

  beforeAll(async () => {
    await cleanup(); // 清掉先前中斷留下的殘留
    before = await snapshot();
    a = await createAdminUser("a");
    b = await createAdminUser("b");
    demo = await createAdminUser("demo");
  }, 120000);

  afterAll(async () => {
    for (const user of [a, b, demo]) await user?.client.auth.signOut({ scope: "local" });
    await cleanup();
    if (before) expect(await snapshot()).toEqual(before); // 前後物件清單完全相同
  }, 120000);

  describe("admin-assets：update／delete 限擁有者", () => {
    it("擁有者 A 可以覆寫（upsert）與刪除自己的物件", async () => {
      const name = testPath("admin-assets", "own");
      expect((await upload(a, "admin-assets", name)).error).toBeNull();
      const overwrite = await upload(a, "admin-assets", name, BIGGER_PNG, true);
      expect(overwrite.error, `A 覆寫自己的物件應成功：${overwrite.error?.message}`).toBeNull();
      expect((await findObject("admin-assets", name))?.size).toBe(BIGGER_PNG.length);
      const removed = await a.client.storage.from("admin-assets").remove([name]);
      expect(removed.error).toBeNull();
      expect(removed.data).toHaveLength(1);
      expect(await findObject("admin-assets", name)).toBeNull();
    });

    it(policyActive ? "另一位管理員 B 無法刪除 A 的物件" : "off：B 可以刪除 A 的物件", async () => {
      const name = testPath("admin-assets", "del");
      expect((await upload(a, "admin-assets", name)).error).toBeNull();
      // Storage 的 remove 被 RLS 擋下時不回錯誤，只回空陣列，所以同時斷言回傳與「物件是否還在」。
      const removed = await b.client.storage.from("admin-assets").remove([name]);
      const still = await findObject("admin-assets", name);
      if (policyActive) {
        expect(removed.error).toBeNull();
        expect(removed.data ?? [], "被 RLS 擋下應回空陣列").toHaveLength(0);
        expect(still, "B 不應能刪除 A 的物件").not.toBeNull();
        expect(still?.owner_id).toBe(a.id);
      } else {
        expect(still, "off 模式下 B 能刪除").toBeNull();
      }
    });

    it(policyActive ? "B 無法用 upsert 覆寫 A 的物件（內容與擁有者不變）" : "off：B 可以覆寫 A 的物件", async () => {
      const name = testPath("admin-assets", "ovr");
      expect((await upload(a, "admin-assets", name, TINY_PNG)).error).toBeNull();
      const result = await upload(b, "admin-assets", name, BIGGER_PNG, true);
      const after = await findObject("admin-assets", name);
      if (policyActive) {
        expect(result.error, "B 的覆寫應被擋下").not.toBeNull();
        expect(after?.size).toBe(TINY_PNG.length);
        expect(after?.owner_id).toBe(a.id);
      } else {
        expect(result.error).toBeNull();
        expect(after?.size).toBe(BIGGER_PNG.length);
      }
    });

    it(policyActive ? "B 無法 move（搬動／改名）A 的物件" : "off：B 可以 move A 的物件", async () => {
      const name = testPath("admin-assets", "mvsrc");
      const target = testPath("admin-assets", "mvdst");
      expect((await upload(a, "admin-assets", name)).error).toBeNull();
      const moved = await b.client.storage.from("admin-assets").move(name, target);
      if (policyActive) {
        expect(moved.error, "B 的 move 應被擋下").not.toBeNull();
        expect((await findObject("admin-assets", name))?.owner_id).toBe(a.id);
        expect(await findObject("admin-assets", target)).toBeNull();
      } else {
        expect(moved.error, `off 模式 B 可 move：${moved.error?.message}`).toBeNull();
        expect(await findObject("admin-assets", target)).not.toBeNull();
      }
    });

    it(policyActive ? "Demo 無法刪除 A（扮演 designer001）的頭像" : "off：Demo 可以刪除 A 的頭像", async () => {
      const name = testPath("admin-assets", "demo");
      expect((await upload(a, "admin-assets", name)).error).toBeNull();
      const removed = await demo.client.storage.from("admin-assets").remove([name]);
      const still = await findObject("admin-assets", name);
      if (policyActive) {
        expect(removed.data ?? []).toHaveLength(0);
        expect(still?.owner_id).toBe(a.id);
      } else {
        expect(still).toBeNull();
      }
    });

    it("Demo 可以刪除自己上傳的 admin-assets 物件（頭像更換流程）", async () => {
      const name = testPath("admin-assets", "demoown");
      expect((await upload(demo, "admin-assets", name)).error).toBeNull();
      const removed = await demo.client.storage.from("admin-assets").remove([name]);
      expect(removed.error).toBeNull();
      expect(removed.data).toHaveLength(1);
      expect(await findObject("admin-assets", name)).toBeNull();
    });

    it("其他 bucket 的刪除不受擁有者限制：B 仍可刪除 A 在 store-assets 上傳的物件（既有行為不變）", async () => {
      const name = testPath("store-assets", "other");
      expect((await upload(a, "store-assets", name)).error).toBeNull();
      await b.client.storage.from("store-assets").remove([name]);
      expect(await findObject("store-assets", name)).toBeNull();
    });

    it(
      policyActive
        ? "擁有者為 null 的物件（service role 上傳，例如還原複製進來的 seed）：一般管理員與 Demo 都刪不掉"
        : "off：擁有者為 null 的物件，一般管理員可以刪除",
      async () => {
        const name = testPath("admin-assets", "nullowner");
        const seeded = await admin.storage.from("admin-assets").upload(name, TINY_PNG, { contentType: "image/png" });
        expect(seeded.error).toBeNull();
        try {
          expect((await findObject("admin-assets", name))?.owner_id, "service role 上傳的物件擁有者應為 null").toBeNull();
          await a.client.storage.from("admin-assets").remove([name]);
          await demo.client.storage.from("admin-assets").remove([name]);
          const still = await findObject("admin-assets", name);
          if (policyActive) expect(still, "null 擁有者的物件不應被刪除").not.toBeNull();
          else expect(still).toBeNull();
        } finally {
          await admin.storage.from("admin-assets").remove([name]); // service role 不受影響，也用來證明清理路徑可用
          expect(await findObject("admin-assets", name)).toBeNull();
        }
      },
    );
  });

  describe("Demo 不能 update", () => {
    it(policyActive ? "Demo 無法用 move 把自己的物件跨 bucket 搬進 admin-assets（繞過上限的路徑）" : "off：Demo 可以跨 bucket move", async () => {
      const name = testPath("store-assets", "xmove");
      const target = testPath("admin-assets", "xmoved");
      expect((await upload(demo, "store-assets", name)).error).toBeNull();
      const moved = await demo.client.storage.from("store-assets").move(name, target, { destinationBucket: "admin-assets" });
      if (policyActive) {
        expect(moved.error, "Demo 的跨 bucket move 應被擋下").not.toBeNull();
        expect(await findObject("store-assets", name)).not.toBeNull();
        expect(await findObject("admin-assets", target)).toBeNull();
      } else {
        expect(moved.error, `off 模式可 move：${moved.error?.message}`).toBeNull();
      }
      await clearOwned(demo, "store-assets");
      await clearOwned(demo, "admin-assets");
    });

    it(policyActive ? "Demo 無法用 upsert 覆寫自己的物件" : "off：Demo 可以 upsert 覆寫自己的物件", async () => {
      const name = testPath("store-assets", "demoovr");
      expect((await upload(demo, "store-assets", name, TINY_PNG)).error).toBeNull();
      const result = await upload(demo, "store-assets", name, BIGGER_PNG, true);
      if (policyActive) {
        expect(result.error).not.toBeNull();
        expect((await findObject("store-assets", name))?.size).toBe(TINY_PNG.length);
      } else {
        expect(result.error).toBeNull();
      }
      await clearOwned(demo, "store-assets");
    });
  });

  describe(`Demo 上傳物件數上限（${CAP}，觸發器）`, () => {
    for (const bucket of BUCKETS) {
      it(
        policyActive
          ? `Demo 在 ${bucket} 上傳第 ${CAP + 1} 個被拒絕；刪掉一個後又能上傳`
          : `off：Demo 在 ${bucket} 上傳第 ${CAP + 1} 個仍成功（沒有上限）`,
        async () => {
          await ensureOwned(demo, bucket, CAP);
          const extra = await upload(demo, bucket, testPath(bucket, "cap31"));
          if (policyActive) {
            expect(extra.error, `${bucket} 第 ${CAP + 1} 個應被拒絕`).not.toBeNull();
            expect(extra.error?.message ?? "").toMatch(/row-level security|violates|policy|Unauthorized/i);
            expect(await ownedBy(demo, bucket)).toHaveLength(CAP);
            const first = (await ownedBy(demo, bucket))[0].name;
            const removed = await demo.client.storage.from(bucket).remove([first]);
            expect(removed.data?.length ?? 0, "Demo 應能刪除自己的物件").toBe(1);
            expect((await upload(demo, bucket, testPath(bucket, "cap-again"))).error).toBeNull();
          } else {
            expect(extra.error, `off 模式第 ${CAP + 1} 個應成功：${extra.error?.message}`).toBeNull();
          }
          await clearOwned(demo, bucket);
        },
        120000,
      );
    }

    it(
      policyActive
        ? "每個 bucket 獨立計數：store-assets 滿 30 後，Demo 仍可上傳到 admin-assets 與 designer-assets"
        : "off：沒有上限",
      async () => {
        await ensureOwned(demo, "store-assets", CAP);
        const others = await Promise.all([upload(demo, "admin-assets", testPath("admin-assets", "ind")), upload(demo, "designer-assets", testPath("designer-assets", "ind"))]);
        others.forEach((r) => expect(r.error, `不應受 store-assets 的數量影響：${r.error?.message}`).toBeNull());
        await clearOwned(demo, "store-assets");
        await clearOwned(demo, "admin-assets");
        await clearOwned(demo, "designer-assets");
      },
      120000,
    );

    it(
      policyActive
        ? "簽名上傳網址繞不過上限：物件數為 0 時簽出 35 個網址再逐一上傳，最多只有 30 個成功"
        : "off：簽名網址上傳 35 個全部成功（沒有上限）",
      async () => {
        const store = demo.client.storage.from("store-assets");
        const signed: Array<{ name: string; token: string }> = [];
        for (let i = 0; i < CAP + 5; i += 1) {
          const name = testPath("store-assets", "signed");
          const r = await store.createSignedUploadUrl(name);
          if (r.data?.token) signed.push({ name, token: r.data.token });
        }
        let ok = 0;
        for (const s of signed) {
          const r = await store.uploadToSignedUrl(s.name, s.token, TINY_PNG, { contentType: "image/png" });
          if (!r.error) ok += 1;
        }
        const owned = (await ownedBy(demo, "store-assets")).length;
        if (policyActive) {
          expect(owned, "Demo 實際擁有的物件數不得超過上限").toBe(CAP);
          expect(ok).toBe(CAP);
        } else {
          expect(owned).toBe(CAP + 5);
        }
        await clearOwned(demo, "store-assets");
      },
      120000,
    );

    it(
      policyActive
        ? "並行上傳繞不過上限：物件數為 0 時同時送出 40 個，剛好 30 個成功"
        : "off：並行上傳 40 個全部成功",
      async () => {
        const results = await Promise.all(Array.from({ length: 40 }, () => upload(demo, "store-assets", testPath("store-assets", "par"))));
        const ok = results.filter((r) => !r.error).length;
        const owned = (await ownedBy(demo, "store-assets")).length;
        expect(owned).toBe(ok);
        if (policyActive) expect(ok, "硬上限：不得超過 30").toBe(CAP);
        else expect(ok).toBe(40);
        await clearOwned(demo, "store-assets");
      },
      120000,
    );

    it(policyActive ? "滿 30 後 copy 自己的物件也被拒絕" : "off：滿 30 後 copy 成功", async () => {
      await ensureOwned(demo, "store-assets", CAP);
      const source = (await ownedBy(demo, "store-assets"))[0].name;
      const copied = await demo.client.storage.from("store-assets").copy(source, testPath("store-assets", "copy"));
      if (policyActive) expect(copied.error).not.toBeNull();
      else expect(copied.error).toBeNull();
      await clearOwned(demo, "store-assets");
    }, 120000);

    it(`非 Demo 管理員不受上限約束：B 在 store-assets 擁有超過 ${CAP} 個，並可繼續上傳`, async () => {
      await ensureOwned(b, "store-assets", CAP);
      const extra = await upload(b, "store-assets", testPath("store-assets", "b31"));
      expect(extra.error, `非 Demo 不應受上限：${extra.error?.message}`).toBeNull();
      expect((await ownedBy(b, "store-assets")).length).toBeGreaterThan(CAP);
    }, 120000);

    it("上限只算自己的：B 已有超過 30 個物件，Demo 仍可上傳（不被其他帳號的物件佔用額度）", async () => {
      await ensureOwned(b, "store-assets", CAP + 1);
      expect((await listObjects("store-assets")).filter((o) => o.owner_id === b.id).length).toBeGreaterThan(CAP);
      await clearOwned(demo, "store-assets");
      const first = await upload(demo, "store-assets", testPath("store-assets", "mine"));
      expect(first.error, `Demo 不應被其他帳號的物件佔用額度：${first.error?.message}`).toBeNull();
      await clearOwned(demo, "store-assets");
    }, 120000);
  });
});
