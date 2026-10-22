import path from "node:path";
import { defineConfig } from "vitest/config";

// 專供 `npm run test:business-hours` 使用：只跑「營業時間與可預約時段管理」的整合測試
// （對真實 Supabase 專案跑），獨立於 `test:rls`（見 vitest.integration.config.ts）、
// `test:booking`（見 vitest.booking.config.ts）、`test:admin-booking`（見
// vitest.admin-booking.config.ts）與預設 `npm test`，避免互相撿到彼此的測試檔案。
// alias：整合測試會呼叫 lib/admin/reschedule-slots.ts、designers.ts 的真實查詢函式，它們用 `@/` 路徑匯入（TASK-075）。
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    environment: "node",
    include: ["tests/business-hours.integration.test.ts"],
    testTimeout: 30000,
  },
});
