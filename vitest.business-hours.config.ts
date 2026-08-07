import { defineConfig } from "vitest/config";

// 專供 `npm run test:business-hours` 使用：只跑「營業時間與可預約時段管理」的整合測試
// （對真實 Supabase 專案跑），獨立於 `test:rls`（見 vitest.integration.config.ts）、
// `test:booking`（見 vitest.booking.config.ts）、`test:admin-booking`（見
// vitest.admin-booking.config.ts）與預設 `npm test`，避免互相撿到彼此的測試檔案。
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/business-hours.integration.test.ts"],
    testTimeout: 30000,
  },
});
