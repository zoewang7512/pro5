import { defineConfig } from "vitest/config";

// 專供 `npm run test:text-length` 使用：只跑 TASK-123（0029 的 services／store_settings 文字欄位長度 CHECK）的整合測試
// （對真實 Supabase 專案跑），獨立於其他 test:* 與預設 `npm test`。
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/text-length-checks.integration.test.ts"],
    testTimeout: 120000,
    hookTimeout: 120000,
  },
});
