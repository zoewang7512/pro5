// TASK-102（Demo 體驗帳戶）：對真實 Supabase 專案執行的整合測試，驗證 0022_demo_entry_rate_limit.sql 的
// demo_entry_attempts 資料表與 demo_entry_check RPC。
//
// 不放進預設 `npm test`，只透過 `npm run test:demo-rate-limit` 執行（缺設定時直接噴錯，不略過）。
//
// 只使用 `__TEST__` 前綴的 bucket 並在前後清除，不碰正式的 `global` 與 `ip:` bucket，所以不會佔用正式的限流額度。
// 「授權」案例需要一個 authenticated 身分：建立一個拋棄式帳號（app_metadata.demoratelimit_test = true，
// Email 含 demoratelimit，雙重條件才會被清除，且不是 is_demo），用完刪除；登出只用 scope: "local"，不做全域 signOut。
// 不讀取、登入或修改 designer001 與真實 Demo 帳戶。
//
// 時間窗案例用本機時鐘對齊 6 秒時間窗（資料庫以自己的時鐘計算，兩邊通常相差不到 1 秒），並留 0.5 秒以上的餘裕，
// 所以約需 10～15 秒；其餘案例用 3600 秒（RPC 允許的最長）時間窗，並避開整點前後 45 秒，避免跨窗造成誤判。
//
// 回滾驗證：套用 0022_demo_entry_rate_limit_down.sql 後，所有案例都應該失敗（函式與資料表不存在）。
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceRoleKey) {
  throw new Error(
    "[demo-rate-limit.integration.test] 缺少 NEXT_PUBLIC_SUPABASE_URL／NEXT_PUBLIC_SUPABASE_ANON_KEY／" +
      "SUPABASE_SERVICE_ROLE_KEY，請確認 .env.local 已填妥。",
  );
}

const clientOptions = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(url, serviceRoleKey, clientOptions);
const anon = createClient(url, anonKey, clientOptions);

const HOUR = 3600; // RPC 允許的最長時間窗
const TABLE = "demo_entry_attempts";
const usedBuckets: string[] = [];
const newBucket = (label: string) => {
  const bucket = `__TEST__rl-${label}-${randomUUID().slice(0, 8)}`;
  usedBuckets.push(bucket);
  return bucket;
};

const check = (bucket: string, limit: number, windowSeconds: number) =>
  admin.rpc("demo_entry_check", { p_bucket: bucket, p_limit: limit, p_window_seconds: windowSeconds });

async function allowed(bucket: string, limit: number, windowSeconds: number): Promise<boolean> {
  const { data, error } = await check(bucket, limit, windowSeconds);
  if (error) throw new Error(`demo_entry_check 失敗：${error.code} ${error.message}`);
  return data as boolean;
}

// `_` 在 LIKE 是萬用字元；正式 bucket 只有 'global' 與 'ip:<hex>'，不可能符合 `__TEST__%`，所以掃描安全。
async function sweep() {
  const { error } = await admin.from(TABLE).delete().like("bucket", "__TEST__%");
  if (error) throw new Error(`清除測試列失敗：${error.message}`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// 3600 秒時間窗以整點為界；若現在離整點前後 45 秒內就先等過去，讓使用長時間窗的案例不會跨窗。
async function avoidHourBoundary() {
  const margin = 45_000;
  const msIntoHour = () => Date.now() % (HOUR * 1000);
  while (msIntoHour() < margin || msIntoHour() > HOUR * 1000 - margin) await sleep(1000);
}

let authUser: { id: string; email: string; password: string } | null = null;
let authenticated: SupabaseClient | null = null;

beforeAll(async () => {
  await avoidHourBoundary();
  await sweep();

  const email = `delivered+demoratelimit-${randomUUID().slice(0, 8)}@resend.dev`;
  const password = `${randomUUID()}${randomUUID().slice(0, 8)}aA1!`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { demoratelimit_test: true },
    user_metadata: { name: "__TEST__demoratelimit" },
  });
  if (error || !data.user) throw new Error(`建立拋棄式帳號失敗：${error?.message ?? "沒有回傳使用者"}`);
  authUser = { id: data.user.id, email, password };

  authenticated = createClient(url, anonKey, clientOptions);
  const signIn = await authenticated.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`拋棄式帳號登入失敗：${signIn.error.message}`);
}, 60000);

afterAll(async () => {
  const failures: string[] = [];
  try {
    await authenticated?.auth.signOut({ scope: "local" });
  } catch (e) {
    failures.push(`登出：${(e as Error).message}`);
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
  if (failures.length > 0) throw new Error(`清除失敗，請手動處理：${failures.join("；")}`);
}, 60000);

describe("授權", () => {
  it("anon 呼叫 RPC 被拒絕（42501）", async () => {
    const { data, error } = await anon.rpc("demo_entry_check", {
      p_bucket: newBucket("anon"),
      p_limit: 5,
      p_window_seconds: HOUR,
    });
    expect(error?.code).toBe("42501");
    expect(data).toBeNull();
  });

  it("authenticated 呼叫 RPC 被拒絕（42501）", async () => {
    const { data, error } = await authenticated!.rpc("demo_entry_check", {
      p_bucket: newBucket("authed"),
      p_limit: 5,
      p_window_seconds: HOUR,
    });
    expect(error?.code).toBe("42501");
    expect(data).toBeNull();
  });

  it("被拒絕的呼叫沒有留下任何計數", async () => {
    const { count, error } = await admin
      .from(TABLE)
      .select("bucket", { count: "exact", head: true })
      .in("bucket", usedBuckets);
    expect(error).toBeNull();
    expect(count).toBe(0);
  });

  it("anon／authenticated 對資料表沒有任何權限（讀、寫、刪都被拒）", async () => {
    for (const client of [anon, authenticated!]) {
      const read = await client.from(TABLE).select("bucket").limit(1);
      expect(read.error?.code).toBe("42501");

      const insert = await client
        .from(TABLE)
        .insert({ bucket: newBucket("direct"), window_start: new Date().toISOString(), count: 0 });
      expect(insert.error?.code).toBe("42501");

      const del = await client.from(TABLE).delete().like("bucket", "__TEST__%");
      expect(del.error?.code).toBe("42501");
    }
  });

  it("service_role 可以呼叫", async () => {
    await expect(allowed(newBucket("svc"), 1, HOUR)).resolves.toBe(true);
  });
});

describe("計數與上限", () => {
  it("同一 bucket 在時間窗內前 N 次回 true，第 N+1 次起回 false", async () => {
    const bucket = newBucket("limit");
    const results = [];
    for (let i = 0; i < 5; i += 1) results.push(await allowed(bucket, 3, HOUR));
    expect(results).toEqual([true, true, true, false, false]);
  });

  it("不同 bucket 互不影響", async () => {
    const a = newBucket("iso-a");
    const b = newBucket("iso-b");
    expect(await allowed(a, 1, HOUR)).toBe(true);
    expect(await allowed(a, 1, HOUR)).toBe(false);
    expect(await allowed(b, 1, HOUR)).toBe(true);
  });

  it("lib 用的呼叫形式（rpc + abortSignal，參數名 p_*）對真實 PostgREST 可用，回傳為布林", async () => {
    const bucket = newBucket("lib-shape");
    const { data, error } = await admin
      .rpc("demo_entry_check", { p_bucket: bucket, p_limit: 1, p_window_seconds: HOUR })
      .abortSignal(AbortSignal.timeout(3000));
    expect(error).toBeNull();
    expect(data).toBe(true);
  });

  it("上限為 1 時第一次 true、第二次 false", async () => {
    const bucket = newBucket("one");
    expect(await allowed(bucket, 1, HOUR)).toBe(true);
    expect(await allowed(bucket, 1, HOUR)).toBe(false);
  });

  it("進入下一個時間窗後恢復 true（並留下兩列）", async () => {
    const windowSeconds = 6;
    const windowMs = windowSeconds * 1000;
    const bucket = newBucket("window");

    // 等本機時鐘落在時間窗前段，讓接下來幾次呼叫不會跨窗。
    while (!(Date.now() % windowMs >= 500 && Date.now() % windowMs < 1500)) await sleep(100);

    expect(await allowed(bucket, 2, windowSeconds)).toBe(true);
    expect(await allowed(bucket, 2, windowSeconds)).toBe(true);
    expect(await allowed(bucket, 2, windowSeconds)).toBe(false);

    // 睡到下一個時間窗起點再多 1 秒。
    await sleep(windowMs - (Date.now() % windowMs) + 1000);

    expect(await allowed(bucket, 2, windowSeconds)).toBe(true);

    const { data, error } = await admin.from(TABLE).select("window_start, count").eq("bucket", bucket);
    expect(error).toBeNull();
    expect(data).toHaveLength(2);
    expect(data!.map((r) => r.count).sort()).toEqual([1, 3]);
  }, 60000);

  it("平行 20 個請求，被允許的次數恰好等於上限（原子性）", async () => {
    const bucket = newBucket("atomic");
    const limit = 7;
    const results = await Promise.all(Array.from({ length: 20 }, () => allowed(bucket, limit, HOUR)));

    expect(results.filter(Boolean)).toHaveLength(limit);

    const { data, error } = await admin.from(TABLE).select("count").eq("bucket", bucket);
    expect(error).toBeNull();
    expect(data).toEqual([{ count: 20 }]);
  });
});

describe("清除過期列", () => {
  it("每次呼叫刪除兩小時前的列，保留較新的列", async () => {
    const old = newBucket("old");
    const recent = newBucket("recent");
    const hours = (h: number) => new Date(Date.now() - h * 3600 * 1000).toISOString();

    const seed = await admin.from(TABLE).insert([
      { bucket: old, window_start: hours(5), count: 1 },
      { bucket: old + "-b", window_start: hours(2.5), count: 1 },
      { bucket: recent, window_start: hours(1), count: 1 },
    ]);
    expect(seed.error).toBeNull();
    usedBuckets.push(old + "-b");

    await allowed(newBucket("trigger-cleanup"), 5, HOUR);

    const { data, error } = await admin.from(TABLE).select("bucket").in("bucket", [old, old + "-b", recent]);
    expect(error).toBeNull();
    expect(data).toEqual([{ bucket: recent }]);
  });

  it("進行中的 3600 秒時間窗不會被清掉", async () => {
    const bucket = newBucket("long-window");
    expect(await allowed(bucket, 1, HOUR)).toBe(true);
    await allowed(newBucket("trigger-cleanup-2"), 5, HOUR);
    expect(await allowed(bucket, 1, HOUR)).toBe(false);
  });
});

describe("參數驗證（不合法就出錯，呼叫端會視為不允許）", () => {
  it.each([
    ["空 bucket", { p_bucket: "", p_limit: 5, p_window_seconds: 60 }],
    ["超長 bucket", { p_bucket: "x".repeat(201), p_limit: 5, p_window_seconds: 60 }],
    ["limit 為 0", { p_bucket: "__TEST__bad-limit", p_limit: 0, p_window_seconds: 60 }],
    ["limit 過大", { p_bucket: "__TEST__bad-limit", p_limit: 1000001, p_window_seconds: 60 }],
    ["窗長為 0", { p_bucket: "__TEST__bad-window", p_limit: 5, p_window_seconds: 0 }],
    ["窗長超過一小時", { p_bucket: "__TEST__bad-window", p_limit: 5, p_window_seconds: HOUR + 1 }],
    ["bucket 為 null", { p_bucket: null, p_limit: 5, p_window_seconds: 60 }],
  ])("%s", async (_label, args) => {
    const { data, error } = await admin.rpc("demo_entry_check", args);
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });
});

describe("資料表內容", () => {
  it("沒有任何明文 IP：每個 bucket 只會是 global、ip:<64 位十六進位>，或測試用的 __TEST__", async () => {
    const { data, error } = await admin.from(TABLE).select("bucket");
    expect(error).toBeNull();

    const ipv4 = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/;
    const ipv6 = /[0-9a-f]{1,4}(:[0-9a-f]{0,4}){2,7}/i;
    for (const { bucket } of data ?? []) {
      expect(bucket).toMatch(/^(global|ip:[0-9a-f]{64}|__TEST__.+)$/);
      if (!bucket.startsWith("__TEST__")) {
        expect(bucket).not.toMatch(ipv4);
        expect(bucket.replace(/^ip:/, "")).not.toMatch(ipv6);
      }
    }
  });
});
