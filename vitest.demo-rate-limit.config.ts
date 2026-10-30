import { defineConfig } from "vitest/config";

// 專供 `npm run test:demo-rate-limit` 使用：只跑 TASK-102（一鍵進入限流：demo_entry_attempts 與 demo_entry_check RPC）
// 的整合測試（對真實 Supabase 專案跑），獨立於其他 test:* 與預設 `npm test`。
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/demo-rate-limit.integration.test.ts"],
    testTimeout: 60000,
  },
});
