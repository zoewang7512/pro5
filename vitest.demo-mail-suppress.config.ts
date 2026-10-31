import { defineConfig } from "vitest/config";

// 專供 `npm run test:demo-mail-suppress` 使用：只跑 TASK-114（0026 的 Demo 改期／取消不寄信）的整合測試
// （對真實 Supabase 專案跑，且會寄出 1 封真實信件到 DEMO_MAIL_TEST_EMAIL），獨立於其他 test:* 與預設 `npm test`。
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/demo-mail-suppress.integration.test.ts"],
    testTimeout: 90000,
    hookTimeout: 120000,
  },
});
