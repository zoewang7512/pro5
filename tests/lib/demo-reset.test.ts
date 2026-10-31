import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// server-only 在 Vitest 的一般 Node 解析下會直接 throw，mock 成空模組（比照其他 demo 單元測試）。
vi.mock("server-only", () => ({}));

import baseJson from "@/lib/demo/seed-base.json";
import { listAuditLog } from "@/lib/admin/audit-log";
import { collectReferences, parseStorageUrl, runDemoReset, runDemoResetWithDeps, type DemoResetDeps } from "@/lib/demo/reset";
import type { DemoSeedBase } from "@/lib/demo/seed-types";

// 全部用假 client：不連任何 Supabase、不呼叫真實的 reset_demo_data。

const base = baseJson as unknown as DemoSeedBase;
const ORIGIN = new URL(base.store_settings.logo_url as string).origin;
const NOW = new Date("2026-10-31T06:00:00.000Z");
const START_MS = Date.parse("2026-10-31T06:00:00.000Z");
const OLD = "2026-01-01T00:00:00.000Z";
const NEW_AFTER_START = "2026-10-31T06:00:01.000Z";
const DEMO_ID = "11111111-1111-4111-8111-111111111111";
const DESIGNER001_ID = "22222222-2222-4222-8222-222222222222";
const SECRET_PASSWORD = "unit-test-demo-password-not-real-0123456789";
const SECRET_SERVICE_KEY = "unit-test-service-role-key-not-real";

type Row = { name: string; size: number; etag: string; created_at: string; owner_id: string | null };

function seedUrls(): string[] {
  const urls = [
    base.store_settings.logo_url,
    base.store_settings.cover_image_url,
    ...base.designers.map((d) => d.avatar_url),
    ...base.portfolio_images.map((i) => i.image_url),
  ];
  return urls.filter((u): u is string => typeof u === "string" && u !== "");
}
const SEED_REFS = [...collectReferences(seedUrls(), ORIGIN).refs.values()];

type FakeOptions = {
  users?: { id: string; app_metadata: Record<string, unknown> }[];
  admins?: { avatar_url: string | null }[];
  factors?: { id: string }[];
  resetError?: { code: string; message: string } | null;
  openGateError?: boolean;
  deleteFactorError?: boolean;
  revokeError?: boolean;
  removeError?: boolean;
  copyError?: boolean;
  removeThrows?: boolean;
  destEtagOnlyDifferent?: string[]; // 以 `bucket/path` 指定大小相同、只有 eTag 不同的物件
  listError?: string[]; // 這些 bucket 的 demo_list_storage_objects 回傳錯誤
  listTruncated?: string[]; // 這些 bucket 的 demo_list_storage_objects 剛好回 1000 筆
  listFactorsError?: boolean;
  manyUsers?: boolean; // 第 1 頁 200 個一般使用者、Demo 帳戶在第 2 頁
  onCopy?: () => void;
  seedMissing?: string[]; // 以 `bucket/path` 指定 demo-seed 缺少的物件
  destMissing?: string[]; // 以 `bucket/path` 指定公開 bucket 缺少的物件
  destDifferent?: string[]; // 以 `bucket/path` 指定公開 bucket 內容不同的物件
  onRemove?: () => void;
};

function makeFake(options: FakeOptions = {}) {
  const calls: string[] = [];
  const removes: { bucket: string; paths: string[] }[] = [];
  const resetArgs: { payload: Record<string, unknown>; dryRun: unknown }[] = [];

  const seedObjects = new Map<string, Row>();
  const buckets: Record<string, Map<string, Row>> = {
    "store-assets": new Map(),
    "designer-assets": new Map(),
    "admin-assets": new Map(),
  };
  for (const ref of SEED_REFS) {
    const key = `${ref.bucket}/${ref.path}`;
    const row = { size: 100, etag: '"e1"', created_at: OLD, owner_id: null };
    if (!options.seedMissing?.includes(key)) seedObjects.set(key, { name: key, ...row });
    if (!options.destMissing?.includes(key)) {
      const different = options.destDifferent?.includes(key);
      const etagOnly = options.destEtagOnlyDifferent?.includes(key);
      buckets[ref.bucket].set(ref.path, { name: ref.path, ...row, size: different ? 999 : 100, etag: etagOnly ? '"e2"' : row.etag });
    }
  }

  const listFor = (bucket: string): Row[] => {
    if (bucket === "demo-seed") return [...seedObjects.values()];
    return [...(buckets[bucket]?.values() ?? [])];
  };

  const client = {
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      calls.push(`rpc:${fn}`);
      if (fn === "demo_list_storage_objects") {
        const bucket = args?.p_bucket as string;
        if (options.listError?.includes(bucket)) return { data: null, error: { message: "x" } };
        if (options.listTruncated?.includes(bucket)) {
          return { data: Array.from({ length: 1000 }, (_, i) => ({ name: `t/${i}`, size: 1, etag: '"t"', created_at: OLD, owner_id: null })), error: null };
        }
        return { data: listFor(bucket), error: null };
      }
      if (fn === "reset_demo_data") {
        resetArgs.push({ payload: args?.p_payload as Record<string, unknown>, dryRun: args?.p_dry_run });
        if (options.resetError) return { data: null, error: options.resetError };
        return { data: { dry_run: args?.p_dry_run, counts: { appointments: 1 }, deleted: { appointments: 2 } }, error: null };
      }
      if (fn === "demo_reset_open_gate") return options.openGateError ? { data: null, error: { message: "x" } } : { data: "2026-10-31T06:10:00Z", error: null };
      if (fn === "demo_reset_close_gate") return { data: null, error: null };
      if (fn === "demo_revoke_sessions") return options.revokeError ? { data: null, error: { message: "x" } } : { data: 2, error: null };
      return { data: null, error: { message: `unexpected rpc ${fn}` } };
    },
    storage: {
      from: (bucket: string) => ({
        copy: async (from: string, to: string, opts?: { destinationBucket?: string }) => {
          const dest = opts?.destinationBucket ?? bucket;
          calls.push(`storage.copy ${bucket}/${from} -> ${dest}/${to}`);
          options.onCopy?.();
          if (options.copyError) return { data: null, error: { message: "copy failed" } };
          const source = bucket === "demo-seed" ? seedObjects.get(from) : buckets[bucket].get(from);
          if (!source) return { data: null, error: { message: "source missing" } };
          if (buckets[dest].has(to)) return { data: null, error: { message: "exists" } };
          buckets[dest].set(to, { ...source, name: to, created_at: NEW_AFTER_START });
          return { data: { path: to }, error: null };
        },
        remove: async (paths: string[]) => {
          calls.push(`storage.remove ${bucket} ${paths.join(",")}`);
          removes.push({ bucket, paths });
          options.onRemove?.();
          if (options.removeThrows) throw new Error("boom");
          if (options.removeError) return { data: null, error: { message: "x" } };
          const removed = paths.filter((path) => buckets[bucket]?.delete(path));
          return { data: removed.map((name) => ({ name })), error: null };
        },
      }),
    },
    auth: {
      admin: {
        listUsers: async (params?: { page?: number }) => {
          calls.push(`auth.listUsers page=${params?.page ?? 1}`);
          if (options.manyUsers) {
            const filler = Array.from({ length: 200 }, (_, i) => ({ id: `filler-${i}`, app_metadata: {} }));
            return { data: { users: params?.page === 2 ? [{ id: DEMO_ID, app_metadata: { is_demo: true } }] : filler }, error: null };
          }
          return { data: { users: options.users ?? [{ id: DEMO_ID, app_metadata: { is_demo: true } }, { id: DESIGNER001_ID, app_metadata: {} }] }, error: null };
        },
        mfa: {
          listFactors: async ({ userId }: { userId: string }) => {
            calls.push(`auth.mfa.listFactors user=${userId}`);
            if (options.listFactorsError) return { data: null, error: { message: "x" } };
            return { data: { factors: options.factors ?? [] }, error: null };
          },
          deleteFactor: async ({ id, userId }: { id: string; userId: string }) => {
            calls.push(`auth.mfa.deleteFactor ${id} user=${userId}`);
            return options.deleteFactorError ? { data: null, error: { message: "x" } } : { data: { id }, error: null };
          },
        },
      },
    },
    from: (table: string) => ({
      select: async () => {
        calls.push(`from:${table}.select`);
        return { data: options.admins ?? [{ avatar_url: null }], error: null };
      },
    }),
  };
  return { supabase: client as unknown as SupabaseClient, calls, removes, resetArgs, buckets, seedObjects };
}

type HealthBehaviour = { signInError?: boolean; isDemo?: boolean; userId?: string; nextLevel?: string; aalError?: boolean };

function makeHealth(behaviour: HealthBehaviour = {}, calls: string[] = []) {
  return () => ({
    auth: {
      signInWithPassword: async () => {
        calls.push("health.signIn");
        if (behaviour.signInError) return { data: { user: null, session: null }, error: { message: "bad" } };
        return {
          data: { user: { id: behaviour.userId ?? DEMO_ID, app_metadata: { is_demo: behaviour.isDemo ?? true } }, session: {} },
          error: null,
        };
      },
      signOut: async (opts?: { scope?: string }) => {
        calls.push(`health.signOut ${opts?.scope}`);
        return { error: null };
      },
      mfa: {
        getAuthenticatorAssuranceLevel: async () => {
          calls.push("health.aal");
          if (behaviour.aalError) return { data: null, error: { message: "x" } };
          return { data: { currentLevel: "aal1", nextLevel: behaviour.nextLevel ?? "aal1" }, error: null };
        },
      },
    },
  }) as unknown as ReturnType<NonNullable<DemoResetDeps["createHealthClient"]>>;
}

type RunOverrides = { dryRun: boolean; deadlineMs?: number; clock?: () => number; health?: HealthBehaviour; supabaseUrl?: string; base?: DemoSeedBase };
function run(fake: ReturnType<typeof makeFake>, overrides: RunOverrides) {
  return runDemoResetWithDeps(
    { supabase: fake.supabase, now: NOW, dryRun: overrides.dryRun, deadlineMs: overrides.deadlineMs ?? Number.MAX_SAFE_INTEGER },
    {
      base: overrides.base ?? base,
      supabaseUrl: overrides.supabaseUrl ?? ORIGIN,
      clock: overrides.clock ?? (() => START_MS),
      createHealthClient: makeHealth(overrides.health, fake.calls),
    },
  );
}

const WRITE_CALLS = /^(storage\.copy|storage\.remove|auth\.mfa\.deleteFactor|rpc:demo_revoke_sessions|rpc:demo_reset_open_gate|rpc:demo_reset_close_gate|health\.)/;

beforeEach(() => {
  process.env.DEMO_EMAIL = "demo@example.test";
  process.env.DEMO_PASSWORD = SECRET_PASSWORD;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SECRET_SERVICE_KEY;
});
afterEach(() => {
  delete process.env.DEMO_EMAIL;
  delete process.env.DEMO_PASSWORD;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

describe("parseStorageUrl／collectReferences", () => {
  it("本專案公開網址解析成 bucket 與路徑；空值與別的網域不算引用；格式不符為 invalid", () => {
    expect(parseStorageUrl(`${ORIGIN}/storage/v1/object/public/store-assets/logo/a.jpg`, ORIGIN)).toEqual({
      kind: "ours",
      ref: { bucket: "store-assets", path: "logo/a.jpg" },
    });
    expect(parseStorageUrl(null, ORIGIN)).toEqual({ kind: "none" });
    expect(parseStorageUrl("", ORIGIN)).toEqual({ kind: "none" });
    expect(parseStorageUrl("https://cdn.example.com/a.png", ORIGIN)).toEqual({ kind: "external" });
    for (const bad of [
      `${ORIGIN}/storage/v1/object/public/demo-seed/x.jpg`,
      `${ORIGIN}/storage/v1/object/public/unknown/x.jpg`,
      `${ORIGIN}/storage/v1/object/public/store-assets/logo%2F..%2Fx.jpg`,
      `${ORIGIN}/storage/v1/object/public/store-assets`,
      `${ORIGIN}/other/path.jpg`,
      "not a url",
    ]) {
      expect(parseStorageUrl(bad, ORIGIN).kind, bad).toBe("invalid");
    }
  });
});

describe("dry-run", () => {
  it("只做唯讀檢查與 dry-run：不複製、不刪除、不開閘門、不處理帳戶、不登入；p_dry_run 為 true、payload 帶 demo_user_id", async () => {
    const fake = makeFake({ destMissing: [`${SEED_REFS[0].bucket}/${SEED_REFS[0].path}`], destDifferent: [`${SEED_REFS[1].bucket}/${SEED_REFS[1].path}`] });
    const result = await run(fake, { dryRun: true });
    expect(result.ok).toBe(true);
    expect(fake.calls.filter((c) => WRITE_CALLS.test(c))).toEqual([]);
    expect(fake.resetArgs).toHaveLength(1);
    expect(fake.resetArgs[0].dryRun).toBe(true);
    expect(fake.resetArgs[0].payload.demo_user_id).toBe(DEMO_ID);
    expect(fake.resetArgs[0].payload.confirm).toBe("RESET_DEMO");
    if (result.ok) {
      expect(result.summary.dryRun).toBe(true);
      expect(result.summary.databaseRestored).toBe(false);
      expect(result.summary.sync).toMatchObject({ planned: { copy: 1, replace: 1 }, copied: 0, replaced: 0 }); // 只有計畫，沒有實際執行
      expect(result.summary.stages.cleanup_orphans?.status).toBe("skipped");
      expect(result.summary.stages.health_check?.status).toBe("skipped");
    }
  });

  it("dry-run 來源缺檔也失敗，且不呼叫 reset_demo_data", async () => {
    const missing = `${SEED_REFS[0].bucket}/${SEED_REFS[0].path}`;
    const fake = makeFake({ seedMissing: [missing] });
    const result = await run(fake, { dryRun: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe("sync_images");
      expect(result.error).toContain("missing_seed_objects");
      expect(result.error).toContain(missing);
    }
    expect(fake.resetArgs).toHaveLength(0);
  });
});

describe("輸入檢查", () => {
  it("dryRun 不是 boolean、now 不合法、deadlineMs 不是有限數字：直接丟錯，不呼叫任何 API", async () => {
    const fake = makeFake();
    const good = { supabase: fake.supabase, now: NOW, dryRun: true, deadlineMs: 1 };
    await expect(runDemoReset({ ...good, dryRun: "false" as never })).rejects.toThrow(/dryRun must be a boolean/);
    await expect(runDemoReset({ ...good, dryRun: undefined as never })).rejects.toThrow(/dryRun must be a boolean/);
    await expect(runDemoReset({ ...good, now: new Date("nope") })).rejects.toThrow(/now must be a valid Date/);
    await expect(runDemoReset({ ...good, deadlineMs: Number.NaN })).rejects.toThrow(/deadlineMs must be a finite number/);
    expect(fake.calls).toEqual([]);
  });
});

describe("prepare", () => {
  it("圖片網址的網域與目前專案對不上（例如環境變數不同）：失敗在 prepare，不讀 Storage、沒有任何 remove（避免引用集合變空而刪光公開 bucket）", async () => {
    const fake = makeFake();
    fake.buckets["store-assets"].set("logo/orphan-old.jpg", { name: "logo/orphan-old.jpg", size: 1, etag: '"o"', created_at: OLD, owner_id: null });
    for (const supabaseUrl of ["https://other-project.supabase.co", "http://ymbhlyhohzceyeppvyxv.supabase.co"]) {
      const result = await run(fake, { dryRun: false, supabaseUrl });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.stage).toBe("prepare");
        expect(result.error).toBe("seed_storage_urls_not_in_this_project");
      }
    }
    expect(fake.removes).toEqual([]);
    expect(fake.calls.filter((c) => c.startsWith("rpc:") || c.startsWith("storage."))).toEqual([]);
  });

  it("拿不到專案網址（沒有預設值）：失敗在 prepare", async () => {
    const saved = process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    try {
      const fake = makeFake();
      const result = await runDemoResetWithDeps({ supabase: fake.supabase, now: NOW, dryRun: false, deadlineMs: Number.MAX_SAFE_INTEGER }, { clock: () => START_MS });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("supabase_url_missing");
      expect(fake.calls.filter((c) => c.startsWith("rpc:") || c.startsWith("storage."))).toEqual([]);
    } finally {
      if (saved !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = saved;
    }
  });

  it("Demo 帳戶在第 2 頁使用者清單中也找得到（分頁）", async () => {
    const fake = makeFake({ manyUsers: true });
    const result = await run(fake, { dryRun: true });
    expect(result.ok).toBe(true);
    expect(fake.calls).toContain("auth.listUsers page=2");
    expect(fake.resetArgs[0].payload.demo_user_id).toBe(DEMO_ID);
  });

  it("seed 內有同網域但無法解析的圖片網址：失敗在 prepare，不讀 Storage、不呼叫 RPC", async () => {
    const broken = structuredClone(base);
    broken.store_settings.logo_url = `${ORIGIN}/storage/v1/object/public/unknown-bucket/logo.jpg`;
    const fake = makeFake();
    const result = await run(fake, { dryRun: true, base: broken });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe("prepare");
      expect(result.error).toBe("seed_has_unparseable_storage_url");
    }
    expect(fake.calls.filter((c) => c.startsWith("rpc:"))).toEqual([]);
  });

  it("找不到或有多個 is_demo 帳戶：失敗在 prepare，不呼叫任何 Storage 或 RPC", async () => {
    for (const users of [[], [{ id: DEMO_ID, app_metadata: { is_demo: true } }, { id: DESIGNER001_ID, app_metadata: { is_demo: true } }]]) {
      const fake = makeFake({ users });
      const result = await run(fake, { dryRun: false });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.stage).toBe("prepare");
      expect(fake.calls.filter((c) => c.startsWith("rpc:") || c.startsWith("storage."))).toEqual([]);
    }
  });
});

describe("步驟 1：圖片差異同步", () => {
  it("全部相同：0 次 copy、0 次 remove", async () => {
    const fake = makeFake();
    const result = await run(fake, { dryRun: false });
    expect(result.ok).toBe(true);
    expect(fake.calls.filter((c) => c.startsWith("storage.copy"))).toEqual([]);
    expect(fake.calls.filter((c) => c.startsWith("storage.remove"))).toEqual([]);
    expect(result.summary.sync).toMatchObject({ copied: 0, replaced: 0, unchanged: SEED_REFS.length });
  });

  it("缺少的補 copy；內容不同的先 remove 再 copy；兩者都發生在 reset_demo_data 之前", async () => {
    const missingKey = `${SEED_REFS[0].bucket}/${SEED_REFS[0].path}`;
    const diffKey = `${SEED_REFS[1].bucket}/${SEED_REFS[1].path}`;
    const fake = makeFake({ destMissing: [missingKey], destDifferent: [diffKey] });
    const result = await run(fake, { dryRun: false });
    expect(result.ok).toBe(true);
    const copies = fake.calls.filter((c) => c.startsWith("storage.copy"));
    expect(copies).toHaveLength(2);
    expect(copies).toContain(`storage.copy demo-seed/${missingKey} -> ${SEED_REFS[0].bucket}/${SEED_REFS[0].path}`);
    const removeIndex = fake.calls.indexOf(`storage.remove ${SEED_REFS[1].bucket} ${SEED_REFS[1].path}`);
    const copyDiffIndex = fake.calls.findIndex((c) => c === `storage.copy demo-seed/${diffKey} -> ${SEED_REFS[1].bucket}/${SEED_REFS[1].path}`);
    expect(removeIndex).toBeGreaterThan(-1);
    expect(copyDiffIndex).toBeGreaterThan(removeIndex);
    const resetIndex = fake.calls.indexOf("rpc:reset_demo_data");
    expect(Math.max(...copies.map((c) => fake.calls.indexOf(c)), removeIndex)).toBeLessThan(resetIndex);
    expect(result.summary.sync).toMatchObject({ copied: 1, replaced: 1 });
  });

  it("來源缺檔：失敗，沒有動任何資料（不 copy、不 remove、不呼叫 RPC reset／閘門）", async () => {
    const fake = makeFake({ seedMissing: [`${SEED_REFS[0].bucket}/${SEED_REFS[0].path}`] });
    const result = await run(fake, { dryRun: false });
    expect(result.ok).toBe(false);
    expect(fake.calls.filter((c) => WRITE_CALLS.test(c))).toEqual([]);
    expect(fake.resetArgs).toHaveLength(0);
  });

  it("列出的物件剛好 1000 筆視為可能被截斷：中止", async () => {
    const fake = makeFake();
    for (let i = 0; i < 1000; i += 1) fake.seedObjects.set(`extra/${i}`, { name: `extra/${i}`, size: 1, etag: '"x"', created_at: OLD, owner_id: null });
    const result = await run(fake, { dryRun: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("list_demo-seed_truncated");
    expect(fake.resetArgs).toHaveLength(0);
  });

  it("copy 失敗：失敗在 sync_images，不呼叫 reset_demo_data", async () => {
    const fake = makeFake({ destMissing: [`${SEED_REFS[0].bucket}/${SEED_REFS[0].path}`], copyError: true });
    const result = await run(fake, { dryRun: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.stage).toBe("sync_images");
    expect(fake.resetArgs).toHaveLength(0);
    expect(fake.calls).not.toContain("rpc:demo_reset_open_gate");
  });

  it("只有 eTag 不同（大小相同）也算內容不同：先 remove 再 copy", async () => {
    const key = `${SEED_REFS[0].bucket}/${SEED_REFS[0].path}`;
    const fake = makeFake({ destEtagOnlyDifferent: [key] });
    const result = await run(fake, { dryRun: false });
    expect(result.ok).toBe(true);
    expect(result.summary.sync).toMatchObject({ copied: 0, replaced: 1 });
    expect(fake.calls.indexOf(`storage.remove ${SEED_REFS[0].bucket} ${SEED_REFS[0].path}`)).toBeGreaterThan(-1);
  });

  it("內容不同時 remove 失敗：不 copy、不進入資料庫", async () => {
    const fake = makeFake({ destDifferent: [`${SEED_REFS[0].bucket}/${SEED_REFS[0].path}`], removeError: true });
    const result = await run(fake, { dryRun: false });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe("sync_images");
      expect(result.error).toContain("remove_failed");
    }
    expect(fake.calls.filter((c) => c.startsWith("storage.copy"))).toEqual([]);
    expect(fake.resetArgs).toHaveLength(0);
  });

  it("內容不同時 remove 成功但 copy 失敗：已知取捨（公開 bucket 暫時缺檔，下次執行自行補回）；失敗在 sync_images、不進入資料庫", async () => {
    const fake = makeFake({ destDifferent: [`${SEED_REFS[0].bucket}/${SEED_REFS[0].path}`], copyError: true });
    const result = await run(fake, { dryRun: false });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe("sync_images");
      expect(result.error).toContain("copy_failed");
    }
    expect(fake.calls.filter((c) => c.startsWith("storage.remove"))).toHaveLength(1);
    expect(fake.resetArgs).toHaveLength(0);
  });

  it.each(["store-assets", "designer-assets", "admin-assets"])("目的 bucket %s 列出失敗或剛好 1000 筆（可能被截斷）：中止，不進入資料庫", async (bucket) => {
    for (const variant of [{ listError: [bucket] }, { listTruncated: [bucket] }]) {
      const fake = makeFake(variant);
      const result = await run(fake, { dryRun: false });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.stage).toBe("sync_images");
        expect(result.error).toMatch(new RegExp(`^list_${bucket}_(failed|truncated)$`));
      }
      expect(fake.resetArgs).toHaveLength(0);
      expect(fake.calls.filter((c) => WRITE_CALLS.test(c))).toEqual([]);
    }
  });

  it("交易前最後一次時間檢查：複製期間預算用完，不開閘門、不呼叫 reset_demo_data", async () => {
    let now = START_MS;
    const fake = makeFake({ destMissing: [`${SEED_REFS[0].bucket}/${SEED_REFS[0].path}`], onCopy: () => void (now += 60_000) });
    const result = await run(fake, { dryRun: false, deadlineMs: START_MS + 30_000, clock: () => now });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe("sync_images");
      expect(result.error).toBe("deadline_before_database");
    }
    expect(fake.calls.filter((c) => c.startsWith("storage.copy"))).toHaveLength(1);
    expect(fake.calls).not.toContain("rpc:demo_reset_open_gate");
    expect(fake.resetArgs).toHaveLength(0);
  });

  describe("admin-assets 覆寫的擁有者規則", () => {
    const adminAvatarKey = "admin-assets/avatar/seed-demo.webp";
    const withAdminAvatar = () => {
      const modified = structuredClone(base);
      modified.demo_admin_profile.avatar_url = `${ORIGIN}/storage/v1/object/public/${adminAvatarKey}`;
      return modified;
    };
    const arrange = (destOwner: string | null) => {
      const fake = makeFake();
      fake.seedObjects.set(adminAvatarKey, { name: adminAvatarKey, size: 100, etag: '"e1"', created_at: OLD, owner_id: null });
      fake.buckets["admin-assets"].set("avatar/seed-demo.webp", { name: "avatar/seed-demo.webp", size: 999, etag: '"zz"', created_at: OLD, owner_id: destOwner });
      return fake;
    };

    it("目的物件屬於別的帳戶（例如 designer001）：拒絕覆寫，失敗在 sync_images，沒有任何寫入", async () => {
      const fake = arrange(DESIGNER001_ID);
      const result = await run(fake, { dryRun: false, base: withAdminAvatar() });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.stage).toBe("sync_images");
        expect(result.error).toContain("admin_asset_owned_by_other_account");
      }
      expect(fake.calls.filter((c) => WRITE_CALLS.test(c))).toEqual([]);
      expect(fake.resetArgs).toHaveLength(0);
    });

    it.each([null, DEMO_ID])("目的物件沒有擁有者或屬於 Demo（%s）：允許先 remove 再 copy", async (owner) => {
      const fake = arrange(owner);
      const result = await run(fake, { dryRun: false, base: withAdminAvatar() });
      expect(result.ok).toBe(true);
      expect(result.summary.sync).toMatchObject({ replaced: 1 });
    });
  });

  it("進入資料庫前剩餘時間不足預留值（15 秒）：中止在 sync_images；足夠時通過", async () => {
    const tooLate = makeFake({ destMissing: [`${SEED_REFS[0].bucket}/${SEED_REFS[0].path}`] });
    const refused = await run(tooLate, { dryRun: false, deadlineMs: START_MS + 10_000 });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toBe("deadline_before_database");
    expect(tooLate.resetArgs).toHaveLength(0);
    expect(tooLate.calls).not.toContain("rpc:demo_reset_open_gate");

    const enough = makeFake({ destMissing: [`${SEED_REFS[0].bucket}/${SEED_REFS[0].path}`] });
    expect((await run(enough, { dryRun: false, deadlineMs: START_MS + 20_000 })).ok).toBe(true);
  });

  it("時間預算用完：停在步驟 1，不進入資料庫", async () => {
    const fake = makeFake({ destMissing: [`${SEED_REFS[0].bucket}/${SEED_REFS[0].path}`] });
    const result = await run(fake, { dryRun: false, deadlineMs: START_MS });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe("sync_images");
      expect(result.error).toBe("deadline");
    }
    expect(fake.calls.filter((c) => c.startsWith("storage.copy"))).toEqual([]);
    expect(fake.resetArgs).toHaveLength(0);
  });
});

describe("步驟 2：資料庫", () => {
  it("真實還原：先開閘門、p_dry_run 為 false、finally 關閘門；順序正確", async () => {
    const fake = makeFake();
    const result = await run(fake, { dryRun: false });
    expect(result.ok).toBe(true);
    const order = ["rpc:demo_reset_open_gate", "rpc:reset_demo_data", "rpc:demo_reset_close_gate"].map((c) => fake.calls.indexOf(c));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(fake.resetArgs[0].dryRun).toBe(false);
    expect(result.summary.databaseRestored).toBe(true);
  });

  it("開閘門失敗：不呼叫 reset_demo_data，也不清理、不處理帳戶、不健康檢查，並盡力關閘門", async () => {
    const fake = makeFake({ openGateError: true });
    fake.buckets["store-assets"].set("logo/orphan-old.jpg", { name: "logo/orphan-old.jpg", size: 1, etag: '"o"', created_at: OLD, owner_id: null });
    const result = await run(fake, { dryRun: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.stage).toBe("reset_database");
    expect(fake.resetArgs).toHaveLength(0);
    expect(fake.removes).toEqual([]);
    expect(fake.calls).not.toContain("from:admins.select");
    expect(fake.calls).not.toContain("rpc:demo_revoke_sessions");
    // 只要呼叫過開門就會關門（開門的回應可能遺失，伺服器端其實已經開了）。
    expect(fake.calls).toContain("rpc:demo_reset_close_gate");
    expect(fake.calls.some((c) => c.startsWith("health."))).toBe(false);
  });

  it("reset_demo_data 失敗：停止，不清理、不處理帳戶、不健康檢查，且閘門被關閉", async () => {
    const fake = makeFake({ resetError: { code: "23P01", message: "overlap" } });
    // 放一個舊孤兒：若清理誤執行，removes 就不會是空的。
    fake.buckets["store-assets"].set("logo/orphan-old.jpg", { name: "logo/orphan-old.jpg", size: 1, etag: '"o"', created_at: OLD, owner_id: null });
    const result = await run(fake, { dryRun: false });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe("reset_database");
      expect(result.error).toContain("23P01");
      expect(result.summary.databaseRestored).toBe(false);
    }
    expect(fake.removes).toEqual([]);
    expect(fake.calls).not.toContain("from:admins.select");
    expect(fake.calls.filter((c) => c === "rpc:demo_list_storage_objects")).toHaveLength(4); // 只有同步階段的 4 次唯讀列出，沒有清理階段的
    expect(fake.calls).not.toContain(`auth.mfa.listFactors user=${DEMO_ID}`);
    expect(fake.calls).not.toContain("rpc:demo_revoke_sessions");
    expect(fake.calls.some((c) => c.startsWith("health."))).toBe(false);
    expect(fake.calls).toContain("rpc:demo_reset_close_gate");
  });
});

describe("步驟 3：孤兒清理", () => {
  const url = (bucket: string, p: string) => `${ORIGIN}/storage/v1/object/public/${bucket}/${p}`;
  const row = (name: string, created_at: string, owner_id: string | null = null): Row => ({ name, size: 1, etag: '"o"', created_at, owner_id });

  it("store-assets／designer-assets：刪除不被引用且早於還原開始的物件；被引用的與剛上傳的不碰", async () => {
    const fake = makeFake();
    fake.buckets["store-assets"].set("logo/orphan-old.jpg", row("logo/orphan-old.jpg", OLD));
    fake.buckets["store-assets"].set("logo/orphan-new.jpg", row("logo/orphan-new.jpg", NEW_AFTER_START));
    fake.buckets["designer-assets"].set("portfolio/x/orphan-old.webp", row("portfolio/x/orphan-old.webp", OLD));
    const result = await run(fake, { dryRun: false });
    expect(result.ok).toBe(true);
    const removed = fake.removes.flatMap((r) => r.paths.map((p) => `${r.bucket}/${p}`)).sort();
    expect(removed).toEqual(["designer-assets/portfolio/x/orphan-old.webp", "store-assets/logo/orphan-old.jpg"]);
    for (const ref of SEED_REFS) expect(removed).not.toContain(`${ref.bucket}/${ref.path}`);
  });

  it("admin-assets：只刪 Demo 擁有且不被任何 admins 引用的孤兒；designer001 的頭像、別人的、擁有者未知的都不碰", async () => {
    const fake = makeFake({
      admins: [{ avatar_url: url("admin-assets", "avatar/designer001.webp") }, { avatar_url: url("admin-assets", "avatar/demo-current.webp") }],
    });
    const a = fake.buckets["admin-assets"];
    a.set("avatar/designer001.webp", row("avatar/designer001.webp", OLD, DESIGNER001_ID));
    a.set("avatar/demo-current.webp", row("avatar/demo-current.webp", OLD, DEMO_ID));
    a.set("avatar/demo-orphan.webp", row("avatar/demo-orphan.webp", OLD, DEMO_ID));
    a.set("avatar/other-orphan.webp", row("avatar/other-orphan.webp", OLD, "33333333-3333-4333-8333-333333333333"));
    a.set("avatar/unknown-owner.webp", row("avatar/unknown-owner.webp", OLD, null));
    a.set("avatar/demo-new.webp", row("avatar/demo-new.webp", NEW_AFTER_START, DEMO_ID));
    const result = await run(fake, { dryRun: false });
    expect(result.ok).toBe(true);
    const removed = fake.removes.filter((r) => r.bucket === "admin-assets").flatMap((r) => r.paths);
    expect(removed).toEqual(["avatar/demo-orphan.webp"]);
  });

  it("引用網址解析失敗（同網域但格式不符）：整個清理跳過，沒有任何 remove", async () => {
    const fake = makeFake({ admins: [{ avatar_url: url("not-a-bucket", "avatar/x.webp") }] });
    fake.buckets["store-assets"].set("logo/orphan-old.jpg", row("logo/orphan-old.jpg", OLD));
    fake.buckets["admin-assets"].set("avatar/demo-orphan.webp", row("avatar/demo-orphan.webp", OLD, DEMO_ID));
    const result = await run(fake, { dryRun: false });
    expect(result.ok).toBe(true);
    expect(fake.removes).toEqual([]);
    expect(result.summary.warnings.join(",")).toContain("unparseable_admin_avatar_url");
    expect(result.summary.stages.cleanup_orphans?.status).toBe("skipped");
  });

  it("別的網域的頭像網址不算引用也不阻擋清理", async () => {
    const fake = makeFake({ admins: [{ avatar_url: "https://cdn.example.com/avatar.png" }] });
    fake.buckets["store-assets"].set("logo/orphan-old.jpg", row("logo/orphan-old.jpg", OLD));
    const result = await run(fake, { dryRun: false });
    expect(result.ok).toBe(true);
    expect(fake.removes.map((r) => r.bucket)).toEqual(["store-assets"]);
  });

  it("絕不對 demo-seed 發出刪除（即使裡面有一堆沒被引用的物件）", async () => {
    const fake = makeFake();
    for (let i = 0; i < 20; i += 1) fake.seedObjects.set(`store-assets/stray/${i}.jpg`, { name: `store-assets/stray/${i}.jpg`, size: 1, etag: '"s"', created_at: OLD, owner_id: null });
    fake.buckets["store-assets"].set("logo/orphan-old.jpg", row("logo/orphan-old.jpg", OLD));
    await run(fake, { dryRun: false });
    expect(fake.removes.length).toBeGreaterThan(0);
    expect(fake.removes.map((r) => r.bucket)).not.toContain("demo-seed");
    expect(fake.calls.filter((c) => c.startsWith("storage.remove demo-seed"))).toEqual([]);
  });

  it("時間預算用完：停止清理並標示 partial，其餘階段（帳戶處理、健康檢查）仍執行", async () => {
    let now = START_MS;
    const fake = makeFake({ onRemove: () => void (now += 60_000) });
    fake.buckets["store-assets"].set("logo/orphan-old.jpg", row("logo/orphan-old.jpg", OLD));
    fake.buckets["designer-assets"].set("portfolio/x/orphan-old.webp", row("portfolio/x/orphan-old.webp", OLD));
    const result = await run(fake, { dryRun: false, deadlineMs: START_MS + 30_000, clock: () => now });
    expect(result.ok).toBe(true);
    expect(result.summary.stages.cleanup_orphans?.status).toBe("partial");
    expect(result.summary.cleanup?.["store-assets"].removed).toBe(1);
    expect(result.summary.cleanup?.["designer-assets"]).toMatchObject({ removed: 0, skipped: "deadline" });
    expect(fake.calls).toContain("rpc:demo_revoke_sessions");
    expect(fake.calls).toContain("health.signIn");
  });

  it("清理丟出例外：回報 cleanup_orphans（cleanup_error），摘要保留 databaseRestored，帳戶處理與健康檢查仍執行", async () => {
    const fake = makeFake({ removeThrows: true });
    fake.buckets["store-assets"].set("logo/orphan-old.jpg", row("logo/orphan-old.jpg", OLD));
    const result = await run(fake, { dryRun: false });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe("cleanup_orphans");
      expect(result.error).toBe("cleanup_error");
    }
    expect(result.summary.databaseRestored).toBe(true);
    expect(fake.calls).toContain("rpc:demo_revoke_sessions");
    expect(fake.calls).toContain("health.signIn");
  });

  it("時鐘誤差邊際：還原開始前 60 秒內建立的物件不碰，更早的才刪", async () => {
    const fake = makeFake();
    const justBefore = new Date(START_MS - 30_000).toISOString();
    const longBefore = new Date(START_MS - 120_000).toISOString();
    fake.buckets["store-assets"].set("logo/just-before.jpg", row("logo/just-before.jpg", justBefore));
    fake.buckets["store-assets"].set("logo/long-before.jpg", row("logo/long-before.jpg", longBefore));
    const result = await run(fake, { dryRun: false });
    expect(result.ok).toBe(true);
    expect(fake.removes.flatMap((r) => r.paths)).toEqual(["logo/long-before.jpg"]);
  });

  it("清理階段列出某個 bucket 失敗：回報 cleanup_orphans，其他 bucket 與後續階段仍執行", async () => {
    const fake = makeFake();
    fake.buckets["store-assets"].set("logo/orphan-old.jpg", row("logo/orphan-old.jpg", OLD));
    // 同步階段（4 次列出）正常，清理階段的 designer-assets 才失敗。
    const realRpc = (fake.supabase as unknown as { rpc: (fn: string, args?: Record<string, unknown>) => Promise<unknown> }).rpc;
    let listCount = 0;
    (fake.supabase as unknown as { rpc: unknown }).rpc = async (fn: string, args?: Record<string, unknown>) => {
      if (fn === "demo_list_storage_objects") {
        listCount += 1;
        if (listCount > 4 && args?.p_bucket === "designer-assets") return { data: null, error: { message: "x" } };
      }
      return realRpc(fn, args);
    };
    const result = await run(fake, { dryRun: false });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe("cleanup_orphans");
      expect(result.error).toBe("list_designer-assets_failed");
    }
    expect(result.summary.cleanup?.["store-assets"].removed).toBe(1);
    expect(result.summary.cleanup?.["designer-assets"].skipped).toBe("list_designer-assets_failed");
    expect(fake.calls).toContain("rpc:demo_revoke_sessions");
    expect(fake.calls).toContain("health.signIn");
  });

  it("移除失敗：回報 cleanup_orphans 失敗，但帳戶處理與健康檢查仍執行", async () => {
    const fake = makeFake({ removeError: true });
    fake.buckets["store-assets"].set("logo/orphan-old.jpg", row("logo/orphan-old.jpg", OLD));
    const result = await run(fake, { dryRun: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.stage).toBe("cleanup_orphans");
    expect(result.summary.databaseRestored).toBe(true);
    expect(fake.calls).toContain("rpc:demo_revoke_sessions");
  });
});

describe("步驟 4：帳戶處理", () => {
  it("刪除 Demo 的 MFA factor 並撤銷 session", async () => {
    const fake = makeFake({ factors: [{ id: "f1" }, { id: "f2" }] });
    const result = await run(fake, { dryRun: false });
    expect(result.ok).toBe(true);
    expect(fake.calls).toContain(`auth.mfa.deleteFactor f1 user=${DEMO_ID}`);
    expect(fake.calls).toContain(`auth.mfa.deleteFactor f2 user=${DEMO_ID}`);
    expect(fake.calls.indexOf("rpc:demo_revoke_sessions")).toBeGreaterThan(fake.calls.indexOf(`auth.mfa.deleteFactor f2 user=${DEMO_ID}`));
    expect(result.summary.account).toEqual({ factorsRemoved: 2, sessionsRevoked: 2 });
  });

  it("列出 factor 失敗、撤銷 session 失敗：各自回報 revoke_account，健康檢查仍執行", async () => {
    for (const variant of [{ listFactorsError: true }, { revokeError: true }]) {
      const fake = makeFake(variant);
      const result = await run(fake, { dryRun: false });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.stage).toBe("revoke_account");
      expect(result.summary.databaseRestored).toBe(true);
      expect(fake.calls).toContain("health.signIn");
    }
  });

  it("刪除 factor 失敗：回報 revoke_account，資料已還原不回滾，健康檢查仍執行", async () => {
    const fake = makeFake({ factors: [{ id: "f1" }], deleteFactorError: true });
    const result = await run(fake, { dryRun: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.stage).toBe("revoke_account");
    expect(result.summary.databaseRestored).toBe(true);
    expect(fake.calls).toContain("health.signIn");
    // 刪 factor 失敗也要照樣撤銷 session。
    expect(fake.calls).toContain("rpc:demo_revoke_sessions");
  });
});

describe("步驟 5：健康檢查", () => {
  it("通過：用獨立 client 登入、檢查 is_demo 與 aal、只做本機登出", async () => {
    const fake = makeFake();
    const result = await run(fake, { dryRun: false });
    expect(result.ok).toBe(true);
    expect(result.summary.health).toEqual({ ok: true });
    expect(fake.calls).toContain("health.signOut local");
  });

  it.each([
    ["登入失敗", { signInError: true }, "sign_in_failed"],
    ["不是 Demo 帳戶", { isDemo: false }, "not_demo"],
    ["登入到別的帳戶", { userId: DESIGNER001_ID }, "unexpected_account"],
    ["仍有 MFA（需要 aal2）", { nextLevel: "aal2" }, "mfa_enrolled"],
    ["aal 讀取失敗", { aalError: true }, "aal_error"],
  ] as const)("失敗（%s）：回報 health_check，資料不變、不自動修復，仍做本機登出", async (_label, behaviour, error) => {
    const fake = makeFake();
    const result = await run(fake, { dryRun: false, health: behaviour });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe("health_check");
      expect(result.error).toBe(error);
    }
    expect(result.summary.databaseRestored).toBe(true);
    expect(fake.resetArgs).toHaveLength(1); // 沒有再次還原
    expect(fake.calls).toContain("health.signOut local");
  });

  it("缺少 DEMO_EMAIL／DEMO_PASSWORD：回報 credentials_missing，不嘗試登入", async () => {
    delete process.env.DEMO_PASSWORD;
    const fake = makeFake();
    const result = await run(fake, { dryRun: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("credentials_missing");
    expect(fake.calls).not.toContain("health.signIn");
  });
});

describe("摘要不含密碼與金鑰", () => {
  it("成功與各種失敗的摘要序列化後都不含 DEMO_PASSWORD、service role key、Email", async () => {
    const variants: Parameters<typeof makeFake>[0][] = [{}, { resetError: { code: "XX", message: "boom" } }, { deleteFactorError: true, factors: [{ id: "f" }] }];
    for (const variant of variants) {
      for (const dryRun of [true, false]) {
        const fake = makeFake(variant);
        const result = await run(fake, { dryRun, health: { signInError: true } });
        const text = JSON.stringify(result);
        expect(text).not.toContain(SECRET_PASSWORD);
        expect(text).not.toContain(SECRET_SERVICE_KEY);
        expect(text).not.toContain("demo@example.test");
      }
    }
  });
});

describe("稽核列表不依賴對應資料存在", () => {
  it("listAuditLog 只讀 audit_log，不查其他表：舊紀錄指向已刪除的預約／服務／設計師時仍可列出", async () => {
    const tables: string[] = [];
    const rows = [
      {
        id: 7,
        created_at: OLD,
        event_type: "appointment.cancelled",
        entity_type: "appointment",
        entity_id: "00000000-0000-4000-8000-00000000dead",
        summary: { service_name: "已不存在的服務", designer_name: "已不存在的設計師" },
        changes: { status: { from: "confirmed", to: "cancelled" } },
      },
    ];
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "order", "like", "not", "lt"]) chain[method] = () => chain;
    chain.limit = async () => ({ data: rows, error: null });
    const supabase = { from: (table: string) => (tables.push(table), chain) } as unknown as SupabaseClient;
    const result = await listAuditLog(supabase, {});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.rows).toHaveLength(1);
    expect(tables).toEqual(["audit_log"]);
  });
});
