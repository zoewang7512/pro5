import { defineConfig } from "vitest/config";

// 專供 `npm run test:services` 使用：只跑「服務項目管理」的整合測試（對真實 Supabase
// 專案跑），獨立於 test:rls／test:booking／test:admin-booking／test:business-hours／
// test:store-settings 與預設 `npm test`，避免互相撿到彼此的測試檔案。
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/services.integration.test.ts"],
    testTimeout: 30000,
  },
});
