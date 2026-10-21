import { defineConfig } from "vitest/config";

// 專供 `npm run test:mfa-rls` 使用：只跑 TASK-079（資料庫層強制 MFA）的整合測試
// （對真實 Supabase 專案跑），獨立於其他 test:* 與預設 `npm test`。
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/mfa-rls.integration.test.ts"],
    testTimeout: 30000,
  },
});
