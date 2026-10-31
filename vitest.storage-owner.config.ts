import { defineConfig } from "vitest/config";

// 專供 `npm run test:storage-owner` 使用：只跑 TASK-113（0025 的 Storage 擁有者限制與 Demo 上傳上限）的整合測試
// （對真實 Supabase 專案跑），獨立於其他 test:* 與預設 `npm test`。
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/storage-owner.integration.test.ts"],
    testTimeout: 60000,
    hookTimeout: 120000,
  },
});
