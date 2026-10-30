import { defineConfig } from "vitest/config";

// 專供 `npm run test:seed-demo-account` 使用：只跑 TASK-099（Demo 帳戶建立腳本）的整合測試
// （對真實 Supabase 專案跑），獨立於其他 test:* 與預設 `npm test`。
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/seed-demo-account.integration.test.ts"],
    testTimeout: 90000,
  },
});
