import { defineConfig } from "vitest/config";

// 專供 `npm run test:demo-disable` 使用：只跑 TASK-111（demo:disable／demo:enable 緊急關閉）的整合測試
// （對真實 Supabase 專案跑，使用拋棄式帳號），獨立於其他 test:* 與預設 `npm test`。
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/demo-disable.integration.test.ts"],
    testTimeout: 90000,
    hookTimeout: 60000,
  },
});
