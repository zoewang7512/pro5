import { defineConfig } from "vitest/config";

// 專供 `npm run test:demo-reminder-guard` 使用：只跑 TASK-121（0031 的 Demo 預約提醒標記觸發器）的整合測試
// （對真實 Supabase 專案跑、全部是拋棄式資料、不寄信），獨立於其他 test:* 與預設 `npm test`。
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/demo-reminder-guard.integration.test.ts"],
    testTimeout: 60000,
    hookTimeout: 120000,
  },
});
