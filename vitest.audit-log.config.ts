import path from "node:path";
import { defineConfig } from "vitest/config";

// 專供 `npm run test:audit-log` 使用：只跑「稽核紀錄」的整合測試（對真實 Supabase
// 專案跑），獨立於 test:rls／test:services 等其他整合套件與預設 `npm test`，
// 避免互相撿到彼此的測試檔案。
// alias：TASK-085 的整合案例會直接呼叫 lib/admin/designers.ts 等後台函式（內含 @/ 路徑）。
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    environment: "node",
    include: ["tests/audit-log.integration.test.ts"],
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
