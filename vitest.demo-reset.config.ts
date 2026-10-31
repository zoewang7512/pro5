import { defineConfig } from "vitest/config";

// 專供 `npm run test:demo-reset` 使用：只跑 TASK-108（reset_demo_data 與 demo_list_storage_objects）的整合測試
// （對真實 Supabase 專案跑，**只做 dry-run**），獨立於其他 test:* 與預設 `npm test`。
export default defineConfig({
  test: {
    environment: "node",
    // 掃描測試一定要跟著跑：它把關「整合測試只准 dry-run」（見 tests/lib/demo-reset-test-scan.test.ts）。
    include: ["tests/demo-reset.integration.test.ts", "tests/lib/demo-reset-test-scan.test.ts"],
    testTimeout: 120000,
    hookTimeout: 120000,
  },
});
