import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BAN_DURATION,
  DEMO_DISPLAY_NAME,
  describePlan,
  disableDemo,
  enableDemo,
  findDemoUser,
  parseArgs,
  readState,
} from "../../scripts/disable-demo.mjs";

// scripts/disable-demo.mjs（TASK-111）：緊急關閉／恢復。這裡用假 client 測行為與順序；
// 對真實 Supabase 的拋棄式帳號實測在 tests/demo-disable.integration.test.ts（npm run test:demo-disable）。

const SCRIPT_PATH = path.resolve(__dirname, "..", "..", "scripts", "disable-demo.mjs");
const DEMO_ID = "11111111-2222-3333-4444-555555555555";

type FakeUser = { id: string; email: string; app_metadata: Record<string, unknown>; banned_until?: string | null };

function makeFake(options: {
  users?: FakeUser[];
  registered?: boolean;
  failSteps?: Array<"delete" | "ban" | "unban" | "revoke" | "insert">;
  revokedCount?: number;
}) {
  const calls: string[] = [];
  const state = {
    registered: options.registered ?? true,
    users: (options.users ?? [{ id: DEMO_ID, email: "demo@example.test", app_metadata: { is_demo: true } }]).map((u) => ({ ...u })),
  };
  const fails = new Set(options.failSteps ?? []);

  const adminsBuilder = () => {
    let op: "select" | "delete" | "insert" = "select";
    let insertRow: Record<string, unknown> | null = null;
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.delete = () => {
      op = "delete";
      return chain;
    };
    chain.insert = (row: Record<string, unknown>) => {
      op = "insert";
      insertRow = row;
      return chain;
    };
    chain.eq = () => chain;
    chain.maybeSingle = async () => ({ data: state.registered ? { user_id: DEMO_ID } : null, error: null });
    chain.then = (resolve: (value: unknown) => void) => {
      if (op === "delete") {
        calls.push("delete_admins");
        if (fails.has("delete")) return resolve({ data: null, error: { message: "delete boom" } });
        const had = state.registered;
        state.registered = false;
        return resolve({ data: had ? [{ user_id: DEMO_ID }] : [], error: null });
      }
      if (op === "insert") {
        calls.push(`insert_admins:${String(insertRow?.display_name)}`);
        if (fails.has("insert")) return resolve({ error: { message: "insert boom" } });
        state.registered = true;
        return resolve({ error: null });
      }
      return resolve({ data: null, error: null });
    };
    return chain;
  };

  const supabase = {
    from: (table: string) => {
      if (table !== "admins") throw new Error(`unexpected table ${table}`);
      return adminsBuilder();
    },
    rpc: async (name: string) => {
      calls.push(`rpc:${name}`);
      if (fails.has("revoke")) return { data: null, error: { message: "revoke boom" } };
      return { data: options.revokedCount ?? 2, error: null };
    },
    auth: {
      admin: {
        listUsers: async ({ page, perPage }: { page: number; perPage: number }) => ({
          data: { users: state.users.slice((page - 1) * perPage, page * perPage) },
          error: null,
        }),
        getUserById: async (id: string) => {
          const user = state.users.find((u) => u.id === id);
          return user ? { data: { user }, error: null } : { data: { user: null }, error: { message: "not found" } };
        },
        updateUserById: async (id: string, attrs: { ban_duration?: string }) => {
          const unban = attrs.ban_duration === "none";
          calls.push(unban ? "unban" : `ban:${attrs.ban_duration}`);
          if (fails.has(unban ? "unban" : "ban")) return { error: { message: "ban boom" } };
          const user = state.users.find((u) => u.id === id)!;
          user.banned_until = unban ? null : new Date(Date.now() + 3_600_000).toISOString();
          return { data: { user }, error: null };
        },
      },
    },
  };
  return { supabase: supabase as never, calls, state };
}

describe("parseArgs", () => {
  it("沒有 --disable／--enable → 錯誤", () => {
    expect(parseArgs([])).toHaveProperty("error");
    expect(parseArgs(["--yes"])).toHaveProperty("error");
  });
  it("兩個模式同時出現 → 錯誤", () => {
    expect(parseArgs(["--disable", "--enable"])).toHaveProperty("error");
  });
  it("不認得的參數（含試圖指定帳號）→ 錯誤", () => {
    expect(parseArgs(["--disable", "--user-id=abc"])).toHaveProperty("error");
    expect(parseArgs(["--disable", "yes"])).toHaveProperty("error");
  });
  it("預設 yes 為 false；--yes 才為 true", () => {
    expect(parseArgs(["--disable"])).toEqual({ mode: "disable", yes: false });
    expect(parseArgs(["--enable", "--yes"])).toEqual({ mode: "enable", yes: true });
    expect(parseArgs(["--yes", "--disable"])).toEqual({ mode: "disable", yes: true });
  });
});

describe("findDemoUser", () => {
  it("沒有 Demo 帳戶 → 錯誤", async () => {
    const { supabase } = makeFake({ users: [{ id: "a", email: "a@x.test", app_metadata: {} }] });
    expect(await findDemoUser(supabase)).toHaveProperty("error");
  });
  it("is_demo 不是布林 true（字串 'true'、缺鍵）不算 Demo", async () => {
    const { supabase } = makeFake({
      users: [
        { id: "a", email: "a@x.test", app_metadata: { is_demo: "true" } },
        { id: "b", email: "b@x.test", app_metadata: {} },
      ],
    });
    expect(await findDemoUser(supabase)).toHaveProperty("error");
  });
  it("兩個以上 Demo 帳戶 → 錯誤，不猜要動哪個", async () => {
    const { supabase } = makeFake({
      users: [
        { id: "a", email: "a@x.test", app_metadata: { is_demo: true } },
        { id: "b", email: "b@x.test", app_metadata: { is_demo: true } },
      ],
    });
    const result = await findDemoUser(supabase);
    expect(result).toHaveProperty("error");
  });
  it("DEMO_EMAIL 與找到的帳戶不同 → 錯誤；相同（不分大小寫）→ 通過", async () => {
    const { supabase } = makeFake({});
    expect(await findDemoUser(supabase, { demoEmail: "other@example.test" })).toHaveProperty("error");
    expect(await findDemoUser(supabase, { demoEmail: "DEMO@example.test" })).toHaveProperty("user");
    expect(await findDemoUser(supabase, { demoEmail: null })).toHaveProperty("user");
  });
  it("會翻頁：Demo 帳戶在第 2 頁也找得到", async () => {
    const filler: FakeUser[] = Array.from({ length: 200 }, (_, i) => ({ id: `u${i}`, email: `u${i}@x.test`, app_metadata: {} }));
    const { supabase } = makeFake({ users: [...filler, { id: DEMO_ID, email: "demo@example.test", app_metadata: { is_demo: true } }] });
    const result = await findDemoUser(supabase);
    expect(result).toHaveProperty("user.id", DEMO_ID);
  });
});

describe("readState", () => {
  it("目標沒有 is_demo 標記 → 拒絕（非 Demo 帳戶不可被處理）", async () => {
    const { supabase } = makeFake({ users: [{ id: DEMO_ID, email: "x@x.test", app_metadata: {} }] });
    const state = await readState(supabase, DEMO_ID);
    expect(state).toHaveProperty("error");
  });
  it("過期的 banned_until 不算封鎖", async () => {
    const { supabase } = makeFake({
      users: [{ id: DEMO_ID, email: "x@x.test", app_metadata: { is_demo: true }, banned_until: "2000-01-01T00:00:00Z" }],
    });
    expect(await readState(supabase, DEMO_ID)).toMatchObject({ registered: true, banned: false });
  });
});

describe("disableDemo", () => {
  it("順序：先刪 admins（立即失效）→ 再封鎖 → 最後撤銷 session，並做事後檢查", async () => {
    const { supabase, calls } = makeFake({});
    const result = await disableDemo(supabase, DEMO_ID);
    expect(result.ok).toBe(true);
    expect(calls).toEqual(["delete_admins", `ban:${BAN_DURATION}`, "rpc:demo_revoke_sessions"]);
    expect(result.steps.map((s) => s.name)).toEqual(["刪除 admins 登記", "封鎖帳戶", "撤銷 session", "事後檢查"]);
  });
  it("可重複執行：已經沒有 admins 登記也不算失敗", async () => {
    const { supabase } = makeFake({ registered: false });
    const result = await disableDemo(supabase, DEMO_ID);
    expect(result.ok).toBe(true);
    expect(result.steps[0].detail).toContain("略過");
  });
  it("某一步失敗不會阻止其他步驟，整體回報失敗", async () => {
    const { supabase, calls } = makeFake({ failSteps: ["delete"] });
    const result = await disableDemo(supabase, DEMO_ID);
    expect(result.ok).toBe(false);
    expect(calls).toEqual(["delete_admins", `ban:${BAN_DURATION}`, "rpc:demo_revoke_sessions"]);
    expect(result.steps.filter((s) => !s.ok).map((s) => s.name)).toEqual(["刪除 admins 登記", "事後檢查"]);
  });
  it("封鎖失敗 → 事後檢查也失敗（不信任各步驟自己的回報）", async () => {
    const { supabase } = makeFake({ failSteps: ["ban"] });
    const result = await disableDemo(supabase, DEMO_ID);
    expect(result.ok).toBe(false);
    expect(result.steps.at(-1)).toMatchObject({ name: "事後檢查", ok: false });
  });
  it("撤銷 session 失敗 → 整體失敗，但 admins 已刪、已封鎖", async () => {
    const { supabase, state } = makeFake({ failSteps: ["revoke"] });
    const result = await disableDemo(supabase, DEMO_ID);
    expect(result.ok).toBe(false);
    expect(state.registered).toBe(false);
    expect(state.users[0].banned_until).toBeTruthy();
  });
});

describe("enableDemo", () => {
  it("先解除封鎖，再以固定顯示名稱重新登記 admins", async () => {
    const { supabase, calls } = makeFake({
      registered: false,
      users: [{ id: DEMO_ID, email: "x@x.test", app_metadata: { is_demo: true }, banned_until: "2999-01-01T00:00:00Z" }],
    });
    const result = await enableDemo(supabase, DEMO_ID);
    expect(result.ok).toBe(true);
    expect(calls).toEqual(["unban", `insert_admins:${DEMO_DISPLAY_NAME}`]);
  });
  it("已經登記 → 不重複寫入", async () => {
    const { supabase, calls } = makeFake({ registered: true });
    const result = await enableDemo(supabase, DEMO_ID);
    expect(result.ok).toBe(true);
    expect(calls).toEqual(["unban"]);
  });
  it("登記失敗 → 整體失敗", async () => {
    const { supabase } = makeFake({ registered: false, failSteps: ["insert"] });
    expect((await enableDemo(supabase, DEMO_ID)).ok).toBe(false);
  });
});

describe("describePlan 與原始碼檢查", () => {
  it("disable 的計畫有三步、enable 有兩步", () => {
    expect(describePlan("disable")).toHaveLength(3);
    expect(describePlan("enable")).toHaveLength(2);
  });
  it("原始碼不碰密碼：沒有 DEMO_PASSWORD、沒有 signIn、不印出 service role key", () => {
    const source = readFileSync(SCRIPT_PATH, "utf8");
    expect(source).not.toMatch(/DEMO_PASSWORD/);
    expect(source).not.toMatch(/signIn/);
    const logLines = source.split("\n").filter((line) => /console\.(log|warn|error)/.test(line));
    // 訊息裡可以「提到」變數名稱（缺少 SUPABASE_SERVICE_ROLE_KEY），但不可以把它的值內插進輸出。
    for (const line of logLines) expect(line).not.toMatch(/\$\{[^}]*(serviceRoleKey|SERVICE_ROLE)/);
    for (const line of logLines) expect(line).not.toMatch(/,\s*serviceRoleKey/);
  });
  it("原始碼的寫入只有：刪除與新增 admins、updateUserById、demo_revoke_sessions（沒有其他表、其他 RPC）", () => {
    const source = readFileSync(SCRIPT_PATH, "utf8");
    expect(source.match(/\.from\("([a-z_]+)"\)/g)).toSatisfy((hits: string[]) => hits.every((h) => h === '.from("admins")'));
    expect(source.match(/\.rpc\("([a-z_]+)"/g)).toEqual(['.rpc("demo_revoke_sessions"']);
    // 還原函式不在 .rpc 清單內，上一行的 .rpc 比對已涵蓋（掃描測試不允許本檔出現還原函式的名稱）。
    expect(source).not.toMatch(/deleteUser|createUser|resetPasswordForEmail/);
  });
});
