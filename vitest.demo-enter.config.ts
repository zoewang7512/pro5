import path from "node:path";
import { defineConfig } from "vitest/config";

// 專供 `npm run test:demo-enter` 使用：只跑 TASK-103（一鍵進入端點 POST /api/demo/enter）的整合測試
// （對真實 Supabase 專案跑），獨立於其他 test:* 與預設 `npm test`。
// 測試直接匯入 Route Handler，所以需要 "@" 別名（`server-only` 在測試檔內以 vi.mock 取代）。
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    environment: "node",
    include: ["tests/demo-enter.integration.test.ts"],
    testTimeout: 60000,
  },
});
