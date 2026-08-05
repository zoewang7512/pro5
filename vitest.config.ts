import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // 打真實 Supabase 專案的整合測試不放進預設 `npm test`，避免每個開發者/CI
    // 意外連線遠端資料庫、還需要設計師密碼。改用 `npm run test:rls`（見
    // vitest.integration.config.ts）獨立執行。
    exclude: ["node_modules/**", "tests/**/*.integration.test.ts"],
    setupFiles: ["tests/setup.ts"],
  },
});
