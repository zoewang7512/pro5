import { defineConfig } from "vitest/config";

// 專供 `npm run test:booking` 使用：只跑顧客預約流程的整合測試（對真實 Supabase
// 專案跑），獨立於 `test:rls`（見 vitest.integration.config.ts）與預設 `npm test`
// （見 vitest.config.ts），避免互相撿到彼此的測試檔案。
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/booking.integration.test.ts"],
    testTimeout: 30000,
  },
});
