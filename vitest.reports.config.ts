import path from "node:path";
import { defineConfig } from "vitest/config";

// 專供 `npm run test:reports` 使用：只跑「儀表板與報表」的整合測試（對真實 Supabase
// 專案跑），獨立於 test:rls／test:audit-log 等其他整合套件與預設 `npm test`，
// 避免互相撿到彼此的測試檔案。
// alias：TASK-088 起的整合案例會直接呼叫 lib/admin/reports.ts 等後台函式（內含 @/ 路徑）。
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    environment: "node",
    include: ["tests/reports.integration.test.ts"],
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
