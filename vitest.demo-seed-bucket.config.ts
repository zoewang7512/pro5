import { defineConfig } from "vitest/config";

// 專供 `npm run test:demo-seed-bucket` 使用：只跑 TASK-107（私有 demo-seed bucket 與 scripts/upload-demo-images.mjs）
// 的整合測試（對真實 Supabase 專案跑），獨立於其他 test:* 與預設 `npm test`。
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/demo-seed-bucket.integration.test.ts"],
    testTimeout: 60000,
  },
});
