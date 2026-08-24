import { afterEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

// server-only 依賴 Next.js 建置時才會設定的 "react-server" resolve condition 區分
// 伺服器/client 兩種 export，Vitest 走一般 Node 解析一律拿到會直接 throw 的版本。
// mock 成空模組讓測試能執行到真正要測的業務邏輯（比照 tests/lib/email-resend-client.test.ts
// 的既有寫法）。
vi.mock("server-only", () => ({}));

describe("createServiceRoleClient", () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("缺少 SUPABASE_SERVICE_ROLE_KEY 時拋出例外，不靜默用了錯誤的 client", () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => createServiceRoleClient()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("缺少 NEXT_PUBLIC_SUPABASE_URL 時拋出例外", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(() => createServiceRoleClient()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("環境變數齊備時成功建立 client", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
    expect(() => createServiceRoleClient()).not.toThrow();
  });
});
