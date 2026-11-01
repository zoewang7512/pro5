import { defineConfig } from "vitest/config";

// 專供 `npm run test:demo-row-caps` 使用：只跑 TASK-116（0027 的 Demo 專屬資料筆數上限）的整合測試
// （對真實 Supabase 專案跑），獨立於其他 test:* 與預設 `npm test`。
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/demo-row-caps.integration.test.ts"],
    testTimeout: 60000,
    hookTimeout: 120000,
  },
});
