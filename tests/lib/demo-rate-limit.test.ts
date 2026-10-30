import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// server-only 在 Vitest 的一般 Node 解析下會直接 throw，mock 成空模組
// （比照 tests/lib/demo-config.test.ts）。
vi.mock("server-only", () => ({}));

const rpcMock = vi.fn();
const createClientMock = vi.fn();
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => createClientMock(),
}));

import {
  checkDemoEntryLimit,
  DEMO_ENTRY_GLOBAL_LIMIT,
  DEMO_ENTRY_GLOBAL_WINDOW_SECONDS,
  DEMO_ENTRY_IP_LIMIT,
  DEMO_ENTRY_IP_WINDOW_SECONDS,
  GLOBAL_BUCKET,
  getClientIp,
  ipBucket,
  normalizeIp,
} from "@/lib/demo/rate-limit";

const SECRET = "unit-test-secret-not-a-real-one-0123456789";

// 模擬 supabase-js 的 rpc(...).abortSignal(...) 鏈：記下傳入的 signal；
// 結果為 Error → reject；為 HANG → 永不 resolve、只在 signal 被中止時 reject（模擬卡住的連線）。
const HANG = Symbol("hang");
const receivedSignals: AbortSignal[] = [];
function fakeRpcResult(result: unknown) {
  return {
    abortSignal: (signal: AbortSignal) => {
      receivedSignals.push(signal);
      if (result === HANG) {
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason));
        });
      }
      return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
    },
  };
}

describe("normalizeIp", () => {
  it("IPv4 原樣回傳，不同位址得到不同結果", () => {
    expect(normalizeIp("203.0.113.5")).toBe("203.0.113.5");
    expect(normalizeIp("203.0.113.6")).not.toBe(normalizeIp("203.0.113.5"));
  });

  it("同一個 /64 內的兩個 IPv6 位址得到同一個結果", () => {
    expect(normalizeIp("2001:db8:aaaa:bbbb::1")).toBe(normalizeIp("2001:db8:aaaa:bbbb:1234:5678:9abc:def0"));
  });

  it("不同 /64 的 IPv6 位址得到不同結果", () => {
    expect(normalizeIp("2001:db8:aaaa:bbbb::1")).not.toBe(normalizeIp("2001:db8:aaaa:bbbc::1"));
  });

  it("大小寫與壓縮寫法不影響結果", () => {
    expect(normalizeIp("2001:DB8::1")).toBe(normalizeIp("2001:db8:0:0:0:0:0:2"));
    expect(normalizeIp("2001:db8::1")).toBe("2001:db8:0:0::/64");
  });

  it("IPv4-mapped IPv6 視為該 IPv4", () => {
    expect(normalizeIp("::ffff:203.0.113.5")).toBe("203.0.113.5");
    expect(normalizeIp("::ffff:cb00:7105")).toBe("203.0.113.5");
  });

  it("處理中括號與 zone id", () => {
    expect(normalizeIp("[2001:db8::1]")).toBe(normalizeIp("2001:db8::1"));
    expect(normalizeIp("fe80::1%eth0")).toBe(normalizeIp("fe80::1"));
  });

  it("其他內嵌 IPv4 的寫法不丟例外", () => {
    expect(normalizeIp("64:ff9b::192.0.2.33")).toBe("64:ff9b:0:0::/64");
    expect(normalizeIp("::1")).toBe("0:0:0:0::/64");
  });

  it.each([null, undefined, "", "   ", "unknown", "999.1.1.1", "1.2.3", "2001:db8::g", "1:2:3:4:5:6:7:8:9", "a, b"])(
    "不合法或空值回 null：%j",
    (raw) => {
      expect(normalizeIp(raw)).toBeNull();
    },
  );
});

describe("ipBucket", () => {
  it("同 IP 同金鑰結果固定；金鑰不同結果不同", () => {
    expect(ipBucket("203.0.113.5", SECRET)).toBe(ipBucket("203.0.113.5", SECRET));
    expect(ipBucket("203.0.113.5", SECRET)).not.toBe(ipBucket("203.0.113.5", `${SECRET}-other`));
  });

  it("不同 IP 落在不同 bucket", () => {
    expect(ipBucket("203.0.113.5", SECRET)).not.toBe(ipBucket("203.0.113.6", SECRET));
  });

  it("格式為 ip:<64 位十六進位>，不含明文 IP", () => {
    const bucket = ipBucket("203.0.113.5", SECRET);
    expect(bucket).toMatch(/^ip:[0-9a-f]{64}$/);
    expect(bucket).not.toContain("203");
    expect(bucket).not.toContain("113");
  });
});

describe("getClientIp", () => {
  const ORIGINAL_VERCEL = process.env.VERCEL;
  beforeEach(() => {
    process.env.VERCEL = "1";
  });
  afterEach(() => {
    if (ORIGINAL_VERCEL === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = ORIGINAL_VERCEL;
  });

  it("在 Vercel 上讀取 x-real-ip", () => {
    expect(getClientIp(new Headers({ "x-real-ip": "203.0.113.5" }))).toBe("203.0.113.5");
  });

  it.each([undefined, "", "0"])("不在 Vercel 上（VERCEL=%j）一律回 null：標頭可被偽造", (value) => {
    if (value === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = value;
    expect(getClientIp(new Headers({ "x-real-ip": "203.0.113.5" }))).toBeNull();
  });

  it("沒有 x-real-ip（即使有 x-forwarded-for）回 null：不採用可偽造的標頭", () => {
    expect(getClientIp(new Headers({ "x-forwarded-for": "198.51.100.1" }))).toBeNull();
  });
});

describe("checkDemoEntryLimit", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env.DEMO_RATE_LIMIT_SECRET = SECRET;
    rpcMock.mockReset();
    receivedSignals.length = 0;
    createClientMock.mockReset();
    createClientMock.mockReturnValue({ rpc: (...args: unknown[]) => fakeRpcResult(rpcMock(...args)) });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  it("兩個 bucket 都通過 → 允許；先查每 IP、再查全站，參數正確", async () => {
    rpcMock.mockReturnValue({ data: true, error: null });

    await expect(checkDemoEntryLimit("203.0.113.5")).resolves.toEqual({ allowed: true });

    expect(rpcMock).toHaveBeenCalledTimes(2);
    expect(rpcMock).toHaveBeenNthCalledWith(1, "demo_entry_check", {
      p_bucket: ipBucket("203.0.113.5", SECRET),
      p_limit: DEMO_ENTRY_IP_LIMIT,
      p_window_seconds: DEMO_ENTRY_IP_WINDOW_SECONDS,
    });
    expect(rpcMock).toHaveBeenNthCalledWith(2, "demo_entry_check", {
      p_bucket: GLOBAL_BUCKET,
      p_limit: DEMO_ENTRY_GLOBAL_LIMIT,
      p_window_seconds: DEMO_ENTRY_GLOBAL_WINDOW_SECONDS,
    });
  });

  it("送給資料庫的參數裡沒有明文 IP", async () => {
    rpcMock.mockReturnValue({ data: true, error: null });
    await checkDemoEntryLimit("2001:db8:aaaa:bbbb::1");
    expect(JSON.stringify(rpcMock.mock.calls)).not.toContain("2001");
    expect(JSON.stringify(rpcMock.mock.calls)).not.toContain("db8");
  });

  it("同一個 /64 的兩個 IPv6 位址使用同一個 bucket", async () => {
    rpcMock.mockReturnValue({ data: true, error: null });
    await checkDemoEntryLimit("2001:db8:aaaa:bbbb::1");
    await checkDemoEntryLimit("2001:db8:aaaa:bbbb:ffff::2");
    const ipBuckets = rpcMock.mock.calls.map((c) => c[1].p_bucket).filter((b: string) => b !== GLOBAL_BUCKET);
    expect(ipBuckets).toHaveLength(2);
    expect(ipBuckets[0]).toBe(ipBuckets[1]);
  });

  it("不同 IPv4 位址使用不同 bucket", async () => {
    rpcMock.mockReturnValue({ data: true, error: null });
    await checkDemoEntryLimit("203.0.113.5");
    await checkDemoEntryLimit("203.0.113.6");
    const ipBuckets = rpcMock.mock.calls.map((c) => c[1].p_bucket).filter((b: string) => b !== GLOBAL_BUCKET);
    expect(ipBuckets).toHaveLength(2);
    expect(ipBuckets[0]).not.toBe(ipBuckets[1]);
  });

  it("每 IP 超過上限 → 不允許（ip_limit），且不累加全站", async () => {
    rpcMock.mockReturnValueOnce({ data: false, error: null });

    await expect(checkDemoEntryLimit("203.0.113.5")).resolves.toEqual({ allowed: false, reason: "ip_limit" });
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it("全站超過上限 → 不允許（global_limit）", async () => {
    rpcMock.mockReturnValueOnce({ data: true, error: null }).mockReturnValueOnce({ data: false, error: null });

    await expect(checkDemoEntryLimit("203.0.113.5")).resolves.toEqual({ allowed: false, reason: "global_limit" });
  });

  it.each([null, undefined, "", "not-an-ip"])("取不到或不合法的 IP（%j）→ 只檢查全站", async (ip) => {
    rpcMock.mockReturnValue({ data: true, error: null });

    await expect(checkDemoEntryLimit(ip)).resolves.toEqual({ allowed: true });
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock.mock.calls[0][1].p_bucket).toBe(GLOBAL_BUCKET);
  });

  it("沒有 IP 時不需要金鑰", async () => {
    delete process.env.DEMO_RATE_LIMIT_SECRET;
    rpcMock.mockReturnValue({ data: true, error: null });

    await expect(checkDemoEntryLimit(null)).resolves.toEqual({ allowed: true });
  });

  describe("出錯一律不允許（不得放行）", () => {
    it("RPC 回傳 error（例如權限錯誤）", async () => {
      rpcMock.mockReturnValue({ data: null, error: { code: "42501", message: "permission denied" } });
      await expect(checkDemoEntryLimit("203.0.113.5")).resolves.toEqual({ allowed: false, reason: "error" });
    });

    it("全站那一次 RPC 出錯", async () => {
      rpcMock.mockReturnValueOnce({ data: true, error: null }).mockReturnValueOnce({ data: null, error: { code: "57014" } });
      await expect(checkDemoEntryLimit("203.0.113.5")).resolves.toEqual({ allowed: false, reason: "error" });
    });

    it("沒有 IP 時全站 RPC 出錯", async () => {
      rpcMock.mockReturnValue({ data: null, error: { code: "PGRST000" } });
      await expect(checkDemoEntryLimit(null)).resolves.toEqual({ allowed: false, reason: "error" });
    });

    it("每次 RPC 都帶著尚未中止的 AbortSignal（沒有逾時保護就會被這項抓到）", async () => {
      rpcMock.mockReturnValue({ data: true, error: null });
      await checkDemoEntryLimit("203.0.113.5");

      expect(receivedSignals).toHaveLength(2);
      for (const signal of receivedSignals) {
        expect(signal).toBeInstanceOf(AbortSignal);
        expect(signal.aborted).toBe(false);
      }
    });

    it("RPC 卡住不回應 → 約 3 秒後逾時，回不允許", async () => {
      rpcMock.mockReturnValue(HANG);
      const started = Date.now();

      await expect(checkDemoEntryLimit("203.0.113.5")).resolves.toEqual({ allowed: false, reason: "error" });

      expect(Date.now() - started).toBeGreaterThanOrEqual(2500);
      expect(Date.now() - started).toBeLessThan(8000);
      expect(rpcMock).toHaveBeenCalledTimes(1);
    }, 15000);

    it("網路錯誤（abortSignal 的 promise 被 reject）", async () => {
      rpcMock.mockReturnValue(new Error("fetch failed"));
      await expect(checkDemoEntryLimit("203.0.113.5")).resolves.toEqual({ allowed: false, reason: "error" });
    });

    it.each([null, undefined, "true", 1, {}])("RPC 回傳的不是布林（%j）", async (data) => {
      rpcMock.mockReturnValue({ data, error: null });
      await expect(checkDemoEntryLimit("203.0.113.5")).resolves.toEqual({ allowed: false, reason: "error" });
    });

    it("建立 service role client 丟例外（缺環境變數）", async () => {
      createClientMock.mockImplementation(() => {
        throw new Error("缺少 SUPABASE_SERVICE_ROLE_KEY");
      });
      await expect(checkDemoEntryLimit("203.0.113.5")).resolves.toEqual({ allowed: false, reason: "error" });
    });

    it.each([undefined, "", "   ", "too-short-secret"])("有 IP 但缺少或太短的雜湊金鑰（%j）→ 拒絕，且不呼叫 RPC", async (secret) => {
      if (secret === undefined) delete process.env.DEMO_RATE_LIMIT_SECRET;
      else process.env.DEMO_RATE_LIMIT_SECRET = secret;

      await expect(checkDemoEntryLimit("203.0.113.5")).resolves.toEqual({ allowed: false, reason: "error" });
      expect(rpcMock).not.toHaveBeenCalled();
    });

    it("log 不含 IP、bucket 與金鑰", async () => {
      rpcMock.mockReturnValue({ data: null, error: { code: "42501", message: `bucket ${ipBucket("203.0.113.5", SECRET)}` } });
      await checkDemoEntryLimit("203.0.113.5");

      const logged = JSON.stringify((console.error as unknown as ReturnType<typeof vi.fn>).mock.calls);
      expect(logged).not.toContain("203.0.113.5");
      expect(logged).not.toContain(SECRET);
      expect(logged).not.toContain("ip:");
    });
  });
});

describe("bucket 長度", () => {
  it("最長的 bucket（ip: + 64 位十六進位）符合資料庫 200 字元的限制", () => {
    expect(ipBucket("2001:db8:ffff:ffff::/64", SECRET).length).toBeLessThanOrEqual(200);
    expect(GLOBAL_BUCKET.length).toBeGreaterThanOrEqual(1);
  });
});

describe("常數", () => {
  it("每 IP 10 次／10 分鐘", () => {
    expect(DEMO_ENTRY_IP_LIMIT).toBe(10);
    expect(DEMO_ENTRY_IP_WINDOW_SECONDS).toBe(600);
  });

  it("全站窗長與 Supabase 登入限額同為 5 分鐘，且上限的 2 倍（固定窗交界）低於 Dashboard 的 30 次", () => {
    const SUPABASE_SIGN_IN_LIMIT_PER_5_MIN = 30; // Dashboard 實際值，使用者 2026-10-30 確認
    expect(DEMO_ENTRY_GLOBAL_WINDOW_SECONDS).toBe(300);
    expect(DEMO_ENTRY_GLOBAL_LIMIT * 2).toBeLessThan(SUPABASE_SIGN_IN_LIMIT_PER_5_MIN);
  });
});
