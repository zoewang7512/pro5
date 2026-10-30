import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDemoConfig, isDemoEntryEnabled, isDemoUser } from "@/lib/demo/config";
import { DEMO_RESET_LABEL } from "@/lib/demo/notice-copy";
import { DEMO_RESET_LABEL as DEMO_RESET_LABEL_FROM_CONFIG } from "@/lib/demo/config";

// server-only 在 Vitest 的一般 Node 解析下會直接 throw，mock 成空模組
// （比照 tests/lib/supabase-service-role.test.ts）。
vi.mock("server-only", () => ({}));

describe("isDemoUser", () => {
  it.each([
    ["is_demo 為 true", { app_metadata: { is_demo: true } }, true],
    ["is_demo 為字串 'true'", { app_metadata: { is_demo: "true" } }, false],
    ["is_demo 為數字 1", { app_metadata: { is_demo: 1 } }, false],
    ["is_demo 為 false", { app_metadata: { is_demo: false } }, false],
    ["is_demo 為 null", { app_metadata: { is_demo: null } }, false],
    ["app_metadata 沒有 is_demo 欄位", { app_metadata: { provider: "email" } }, false],
    ["app_metadata 為空物件", { app_metadata: {} }, false],
    ["app_metadata 為 null", { app_metadata: null }, false],
    ["沒有 app_metadata", {}, false],
    ["user 為 null", null, false],
    ["user 為 undefined", undefined, false],
  ])("%s → %s", (_label, user, expected) => {
    expect(isDemoUser(user)).toBe(expected);
  });

  it("只認 app_metadata，user_metadata 的 is_demo 不算（使用者本人可改 user_metadata）", () => {
    expect(isDemoUser({ user_metadata: { is_demo: true } } as never)).toBe(false);
  });
});

describe("getDemoConfig／isDemoEntryEnabled", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env.DEMO_ENABLED = "true";
    process.env.DEMO_EMAIL = "hair_demo@example.com";
    process.env.DEMO_PASSWORD = "a-long-random-demo-password";
    process.env.DESIGNER_EMAIL = "designer@example.com";
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("全部齊備時回傳 email 與 password，入口啟用", () => {
    expect(getDemoConfig()).toEqual({ email: "hair_demo@example.com", password: "a-long-random-demo-password" });
    expect(isDemoEntryEnabled()).toBe(true);
  });

  it.each([undefined, "", "false", "TRUE", "1", "yes", " true"])("DEMO_ENABLED 為 %j 時回傳 null（只有 'true' 才啟用）", (value) => {
    if (value === undefined) delete process.env.DEMO_ENABLED;
    else process.env.DEMO_ENABLED = value;
    expect(getDemoConfig()).toBeNull();
    expect(isDemoEntryEnabled()).toBe(false);
  });

  it.each(["DEMO_EMAIL", "DEMO_PASSWORD"])("缺少 %s 時回傳 null", (name) => {
    delete process.env[name];
    expect(getDemoConfig()).toBeNull();
  });

  it.each(["DEMO_EMAIL", "DEMO_PASSWORD"])("%s 為空字串或只有空白時回傳 null", (name) => {
    process.env[name] = "";
    expect(getDemoConfig()).toBeNull();
    process.env[name] = "   ";
    expect(getDemoConfig()).toBeNull();
  });

  it.each(["designer@example.com", "DESIGNER@Example.com", "  designer@example.com  "])(
    "DEMO_EMAIL（%j）與 DESIGNER_EMAIL 相同（不分大小寫與前後空白）時回傳 null",
    (email) => {
      process.env.DEMO_EMAIL = email;
      expect(getDemoConfig()).toBeNull();
      expect(isDemoEntryEnabled()).toBe(false);
    },
  );

  it("沒有設定 DESIGNER_EMAIL 時不做比對，仍可啟用", () => {
    delete process.env.DESIGNER_EMAIL;
    expect(getDemoConfig()).not.toBeNull();
  });

  it("每次呼叫都重新讀環境變數，不在載入時快取", () => {
    expect(getDemoConfig()).not.toBeNull();
    process.env.DEMO_ENABLED = "false";
    expect(getDemoConfig()).toBeNull();
  });

  it("isDemoEntryEnabled 只回布林，不帶任何設定內容", () => {
    expect(isDemoEntryEnabled()).toBe(true);
    expect(JSON.stringify(isDemoEntryEnabled())).not.toContain("password");
  });
});

describe("DEMO_RESET_LABEL", () => {
  it("定案文案；config 重新匯出的是同一個值", () => {
    expect(DEMO_RESET_LABEL).toBe("每日凌晨 3 點左右");
    expect(DEMO_RESET_LABEL_FROM_CONFIG).toBe(DEMO_RESET_LABEL);
  });
});
