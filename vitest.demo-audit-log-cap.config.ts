import { defineConfig } from "vitest/config";

// 專供 `npm run test:demo-audit-cap` 使用：只跑 TASK-122（0028 的 Demo audit_log 每帳戶筆數上限）的整合測試
// （對真實 Supabase 專案跑），獨立於其他 test:* 與預設 `npm test`。
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/demo-audit-log-cap.integration.test.ts"],
    testTimeout: 120000,
    hookTimeout: 120000,
  },
});
