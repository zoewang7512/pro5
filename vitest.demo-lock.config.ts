import { defineConfig } from "vitest/config";

// 專供 `npm run test:demo-lock` 使用：只跑 TASK-100（Demo 帳戶鎖定：auth 觸發器與 demo_revoke_sessions）的整合測試
// （對真實 Supabase 專案跑），獨立於其他 test:* 與預設 `npm test`。
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/demo-lock.integration.test.ts"],
    testTimeout: 60000,
  },
});
