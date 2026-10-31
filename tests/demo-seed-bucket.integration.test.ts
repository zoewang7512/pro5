// TASK-107（Demo 體驗帳戶）：對真實 Supabase 專案執行的整合測試，驗證 0023_demo_seed_bucket.sql 建立的私有
// demo-seed bucket，以及 scripts/upload-demo-images.mjs 的防呆行為。
//
// 不放進預設 `npm test`，只透過 `npm run test:demo-seed-bucket` 執行（缺設定時直接噴錯，不略過）。
//
// 物件只用 `__TEST__/` 前綴並在前後清除，不碰 demo-seed 內由腳本匯入的正式 seed 圖片（`store-assets/`、
// `designer-assets/`、`admin-assets/`）。「授權」案例需要一個 authenticated 身分：建立拋棄式帳號
// （app_metadata.demoseedbucket_test = true，Email 含 demoseedbucket，不是 is_demo），用完刪除；
// 登出只用 scope: "local"，不做全域 signOut。不讀取、登入或修改 designer001 與真實 Demo 帳戶。
//
// 腳本案例只測「會在複製之前中止」的路徑（缺 --from-public、來源缺檔、外部網址、dry-run），
// 所以不會寫入 demo-seed；真正的匯入與重跑由人工實跑並記錄在驗證報告。
//
// 回滾驗證：套用 0023_demo_seed_bucket_down.sql 後，bucket 相關案例都應該失敗（bucket 不存在）。
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceRoleKey) {
  throw new Error(
    "[demo-seed-bucket.integration.test] 缺少 NEXT_PUBLIC_SUPABASE_URL／NEXT_PUBLIC_SUPABASE_ANON_KEY／" +
      "SUPABASE_SERVICE_ROLE_KEY，請確認 .env.local 已填妥。",
  );
}

const BUCKET = "demo-seed";
const TEST_PREFIX = "__TEST__";
const SCRIPT = path.resolve(__dirname, "..", "scripts", "upload-demo-images.mjs");

const clientOptions = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(url, serviceRoleKey, clientOptions);
const anon = createClient(url, anonKey, clientOptions);

// 1×1 透明 PNG（68 bytes）。
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

let authUser: { id: string; email: string; password: string } | null = null;
let authenticated: SupabaseClient | null = null;
// 暫時登記進 admins 的拋棄式帳號（is_admin() 為真，模擬 Demo 帳戶的身分）。
let adminUser: { id: string; email: string; password: string } | null = null;
let adminClient: SupabaseClient | null = null;
let tmpDir: string | null = null;
const uploaded: string[] = [];

async function listAll(prefix: string): Promise<string[]> {
  const { data, error } = await admin.storage.from(BUCKET).list(prefix, { limit: 1000 });
  if (error) throw new Error(`列出 ${BUCKET}/${prefix} 失敗：${error.message}`);
  return (data ?? []).map((o) => o.name).sort();
}

async function sweep() {
  const names = await listAll(TEST_PREFIX);
  if (names.length > 0) {
    const { error } = await admin.storage.from(BUCKET).remove(names.map((n) => `${TEST_PREFIX}/${n}`));
    if (error) throw new Error(`清除測試物件失敗：${error.message}`);
  }
}

// 遞迴列出 demo-seed 內（排除 __TEST__/）所有物件的路徑，用來比對腳本前後沒有寫入。
async function snapshotBucket() {
  const files: string[] = [];
  const walk = async (prefix: string) => {
    const { data, error } = await admin.storage.from(BUCKET).list(prefix, { limit: 1000 });
    if (error) throw new Error(`列出 ${BUCKET}/${prefix} 失敗：${error.message}`);
    for (const entry of data ?? []) {
      const full = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (full === TEST_PREFIX) continue;
      if (entry.id === null) await walk(full);
      else files.push(`${full}|${entry.metadata?.size}`);
    }
  };
  await walk("");
  return JSON.stringify(files.sort());
}

function runScript(args: string[], env: NodeJS.ProcessEnv = process.env) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { env, encoding: "utf8", timeout: 50000 });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

function writeBase(name: string, overrides: Record<string, unknown>) {
  const file = path.join(tmpDir!, name);
  writeFileSync(
    file,
    JSON.stringify({
      store_settings: { logo_url: null, cover_image_url: null },
      demo_admin_profile: { display_name: "Demo帳號", avatar_url: null },
      designers: [],
      portfolio_images: [],
      ...overrides,
    }),
  );
  return file;
}

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "demo-seed-bucket-"));
  await sweep();

  const email = `delivered+demoseedbucket-${randomUUID().slice(0, 8)}@resend.dev`;
  const password = `${randomUUID()}${randomUUID().slice(0, 8)}aA1!`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { demoseedbucket_test: true },
    user_metadata: { name: "__TEST__demoseedbucket" },
  });
  if (error || !data.user) throw new Error(`建立拋棄式帳號失敗：${error?.message ?? "沒有回傳使用者"}`);
  authUser = { id: data.user.id, email, password };

  authenticated = createClient(url, anonKey, clientOptions);
  const signIn = await authenticated.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`拋棄式帳號登入失敗：${signIn.error.message}`);

  const adminEmail = `delivered+demoseedbucket-admin-${randomUUID().slice(0, 8)}@resend.dev`;
  const adminPassword = `${randomUUID()}${randomUUID().slice(0, 8)}aA1!`;
  const created = await admin.auth.admin.createUser({
    email: adminEmail,
    password: adminPassword,
    email_confirm: true,
    app_metadata: { demoseedbucket_test: true },
    user_metadata: { name: "__TEST__demoseedbucket-admin" },
  });
  if (created.error || !created.data.user) throw new Error(`建立管理員拋棄式帳號失敗：${created.error?.message ?? "沒有回傳使用者"}`);
  adminUser = { id: created.data.user.id, email: adminEmail, password: adminPassword };
  const registered = await admin.from("admins").insert({ user_id: adminUser.id, display_name: "__TEST__demoseedbucket" });
  if (registered.error) throw new Error(`登記 admins 失敗：${registered.error.message}`);
  adminClient = createClient(url, anonKey, clientOptions);
  const adminSignIn = await adminClient.auth.signInWithPassword({ email: adminEmail, password: adminPassword });
  if (adminSignIn.error) throw new Error(`管理員拋棄式帳號登入失敗：${adminSignIn.error.message}`);
}, 60000);

afterAll(async () => {
  const failures: string[] = [];
  try {
    await authenticated?.auth.signOut({ scope: "local" });
  } catch (e) {
    failures.push(`登出：${(e as Error).message}`);
  }
  try {
    await adminClient?.auth.signOut({ scope: "local" });
  } catch (e) {
    failures.push(`管理員帳號登出：${(e as Error).message}`);
  }
  if (adminUser) {
    const removed = await admin.from("admins").delete().eq("user_id", adminUser.id);
    if (removed.error) failures.push(`移除 admins 列 ${adminUser.id}：${removed.error.message}`);
    const { error } = await admin.auth.admin.deleteUser(adminUser.id);
    if (error) failures.push(`刪除管理員拋棄式帳號 ${adminUser.id}：${error.message}`);
  }
  if (authUser) {
    const { error } = await admin.auth.admin.deleteUser(authUser.id);
    if (error) failures.push(`刪除拋棄式帳號 ${authUser.id}：${error.message}`);
  }
  try {
    await sweep();
  } catch (e) {
    failures.push((e as Error).message);
  }
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  if (failures.length > 0) throw new Error(`清除失敗，請手動處理：${failures.join("；")}`);
}, 60000);

describe("bucket 設定", () => {
  it("demo-seed 存在、是私有、5MB 上限、MIME 只允許 jpg／png／webp", async () => {
    const { data, error } = await admin.storage.getBucket(BUCKET);
    expect(error).toBeNull();
    expect(data?.public).toBe(false);
    expect(data?.file_size_limit).toBe(5242880);
    expect([...(data?.allowed_mime_types ?? [])].sort()).toEqual(["image/jpeg", "image/png", "image/webp"]);
  });
});

describe("私有性：只有 service role 能存取", () => {
  const objectPath = `${TEST_PREFIX}/${randomUUID()}.png`;

  it("service role 可以上傳與讀取", async () => {
    const upload = await admin.storage.from(BUCKET).upload(objectPath, TINY_PNG, { contentType: "image/png" });
    expect(upload.error).toBeNull();
    uploaded.push(objectPath);
    const download = await admin.storage.from(BUCKET).download(objectPath);
    expect(download.error).toBeNull();
    expect(download.data?.size).toBe(TINY_PNG.length);
  });

  it("公開網址讀不到（私有 bucket 不提供 /object/public/）", async () => {
    const { data } = anon.storage.from(BUCKET).getPublicUrl(objectPath);
    const response = await fetch(data.publicUrl);
    expect(response.ok).toBe(false);
    expect(await response.text()).not.toContain("PNG");
  });

  it("匿名：下載、列出、簽名網址、上傳都被拒絕", async () => {
    expect((await anon.storage.from(BUCKET).download(objectPath)).error).not.toBeNull();
    const listed = await anon.storage.from(BUCKET).list(TEST_PREFIX);
    expect(listed.error !== null || (listed.data ?? []).length === 0).toBe(true);
    expect((await anon.storage.from(BUCKET).createSignedUrl(objectPath, 60)).error).not.toBeNull();
    const upload = await anon.storage.from(BUCKET).upload(`${TEST_PREFIX}/${randomUUID()}.png`, TINY_PNG, { contentType: "image/png" });
    expect(upload.error).not.toBeNull();
  });

  it("authenticated（非 Demo 的拋棄式帳號）：下載、列出、簽名網址、上傳都被拒絕", async () => {
    const client = authenticated!;
    expect((await client.storage.from(BUCKET).download(objectPath)).error).not.toBeNull();
    const listed = await client.storage.from(BUCKET).list(TEST_PREFIX);
    expect(listed.error !== null || (listed.data ?? []).length === 0).toBe(true);
    expect((await client.storage.from(BUCKET).createSignedUrl(objectPath, 60)).error).not.toBeNull();
    const upload = await client.storage.from(BUCKET).upload(`${TEST_PREFIX}/${randomUUID()}.png`, TINY_PNG, { contentType: "image/png" });
    expect(upload.error).not.toBeNull();
    const removal = await client.storage.from(BUCKET).remove([objectPath]);
    expect(removal.data ?? []).toHaveLength(0);
    // 物件仍在。
    expect((await admin.storage.from(BUCKET).download(objectPath)).error).toBeNull();
  });

  it("is_admin() 為真的帳號（Demo 帳戶的身分）：對 demo-seed 下載、列出、簽名網址、上傳、刪除都被拒絕，對 store-assets 則可列出", async () => {
    const client = adminClient!;
    const control = await client.storage.from("store-assets").list("logo");
    expect(control.error).toBeNull();
    expect((control.data ?? []).length).toBeGreaterThan(0);

    expect((await client.storage.from(BUCKET).download(objectPath)).error).not.toBeNull();
    const listed = await client.storage.from(BUCKET).list(TEST_PREFIX);
    expect(listed.error !== null || (listed.data ?? []).length === 0).toBe(true);
    expect((await client.storage.from(BUCKET).createSignedUrl(objectPath, 60)).error).not.toBeNull();
    const upload = await client.storage.from(BUCKET).upload(`${TEST_PREFIX}/${randomUUID()}.png`, TINY_PNG, { contentType: "image/png" });
    expect(upload.error).not.toBeNull();
    const removal = await client.storage.from(BUCKET).remove([objectPath]);
    expect(removal.data ?? []).toHaveLength(0);
    expect((await admin.storage.from(BUCKET).download(objectPath)).error).toBeNull();
  });

  it("MIME 白名單：service role 上傳 SVG 被拒絕", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const upload = await admin.storage.from(BUCKET).upload(`${TEST_PREFIX}/${randomUUID()}.svg`, svg, { contentType: "image/svg+xml" });
    expect(upload.error).not.toBeNull();
  });
});

describe("scripts/upload-demo-images.mjs：Demo 上線中拒絕執行（用不引用任何圖片的基底，只測護欄、不複製）", () => {
  let demoLike: { id: string } | null = null;

  afterAll(async () => {
    if (!demoLike) return;
    await admin.from("admins").delete().eq("user_id", demoLike.id);
    const { error } = await admin.auth.admin.deleteUser(demoLike.id);
    if (error) throw new Error(`刪除 Demo 樣態拋棄式帳號 ${demoLike.id} 失敗：${error.message}`);
  });

  it("DEMO_ENABLED=true 時拒絕；加 --allow-while-demo-live 才執行；--dry-run 不受影響", () => {
    const empty = writeBase("empty.json", {});
    const env = { ...process.env, DEMO_ENABLED: "true" };
    const refused = runScript(["--from-public", "--base", empty], env);
    expect(refused.status).toBe(1);
    expect(refused.output).toContain("Demo 上線中");
    expect(runScript(["--from-public", "--base", empty, "--allow-while-demo-live"], env).status).toBe(0);
    expect(runScript(["--from-public", "--base", empty, "--dry-run"], env).status).toBe(0);
  });

  it("is_demo 帳戶仍登記在 admins 時拒絕；停用（移除 admins 列）後允許", async () => {
    const empty = writeBase("empty2.json", {});
    const email = `delivered+demoseedbucket-demo-${randomUUID().slice(0, 8)}@resend.dev`;
    const created = await admin.auth.admin.createUser({
      email,
      password: `${randomUUID()}${randomUUID().slice(0, 8)}aA1!`,
      email_confirm: true,
      app_metadata: { demoseedbucket_test: true, is_demo: true },
      user_metadata: { name: "__TEST__demoseedbucket-demo" },
    });
    if (created.error || !created.data.user) throw new Error(`建立 Demo 樣態拋棄式帳號失敗：${created.error?.message}`);
    demoLike = { id: created.data.user.id };
    const env = { ...process.env, DEMO_ENABLED: "false" };

    // 帳戶存在但沒登記在 admins（Demo 已停用）→ 允許。
    expect(runScript(["--from-public", "--base", empty], env).status).toBe(0);

    const registered = await admin.from("admins").insert({ user_id: demoLike.id, display_name: "__TEST__demoseedbucket" });
    expect(registered.error).toBeNull();
    const refused = runScript(["--from-public", "--base", empty], env);
    expect(refused.status).toBe(1);
    expect(refused.output).toContain("Demo 上線中");
    expect(runScript(["--from-public", "--base", empty, "--allow-while-demo-live"], env).status).toBe(0);

    expect((await admin.from("admins").delete().eq("user_id", demoLike.id)).error).toBeNull();
    expect(runScript(["--from-public", "--base", empty], env).status).toBe(0);
  });
});

describe("scripts/upload-demo-images.mjs 的防呆（都在複製之前中止，不寫入 demo-seed）", () => {
  it("沒帶 --from-public 時拒絕執行", () => {
    const result = runScript([]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("--from-public");
  });

  it("來源缺檔：列出清單、結束碼非 0，且 demo-seed 沒有任何變動", async () => {
    const base = writeBase("missing.json", {
      store_settings: { logo_url: `${url}/storage/v1/object/public/store-assets/logo/${randomUUID()}.jpg`, cover_image_url: null },
      designers: [],
      portfolio_images: [],
    });
    const before = await snapshotBucket();
    const result = runScript(["--from-public", "--base", base]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("來源缺檔");
    expect(result.output).toContain("store-assets/logo/");
    expect(await snapshotBucket()).toBe(before);
  });

  it("網址不是本專案的 Storage 公開網址時中止", () => {
    const base = writeBase("foreign.json", {
      store_settings: { logo_url: "https://example.com/storage/v1/object/public/store-assets/logo/x.jpg", cover_image_url: null },
    });
    const result = runScript(["--from-public", "--base", base]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("不是本專案的 Storage 公開網址");
  });

  it("不在允許清單的 bucket（含 demo-seed 自己）與路徑穿越都中止", () => {
    const own = writeBase("own.json", {
      store_settings: { logo_url: `${url}/storage/v1/object/public/demo-seed/x.jpg`, cover_image_url: null },
    });
    const ownResult = runScript(["--from-public", "--base", own]);
    expect(ownResult.status).toBe(1);
    expect(ownResult.output).toContain("不在允許範圍");
    const traversal = writeBase("traversal.json", {
      store_settings: { logo_url: `${url}/storage/v1/object/public/store-assets/logo/../../x.jpg`, cover_image_url: null },
    });
    const traversalResult = runScript(["--from-public", "--base", traversal]);
    expect(traversalResult.status).toBe(1);
    expect(traversalResult.output).toContain("不在允許範圍");
    // 編碼斜線：先 split 再 decode 時 `..` 會藏在同一段裡。
    const encoded = writeBase("encoded.json", {
      store_settings: { logo_url: `${url}/storage/v1/object/public/store-assets/logo%2F..%2F..%2Fadmin-assets%2Fx.jpg`, cover_image_url: null },
    });
    const encodedResult = runScript(["--from-public", "--base", encoded]);
    expect(encodedResult.status).toBe(1);
    expect(encodedResult.output).toContain("不在允許範圍");
  });

  it("--dry-run 對真實 seed-base 只報告計畫，demo-seed 沒有任何變動", async () => {
    const before = await snapshotBucket();
    const result = runScript(["--from-public", "--dry-run"]);
    expect(result.status).toBe(0);
    expect(result.output).toContain("dry-run");
    expect(await snapshotBucket()).toBe(before);
  });
});
