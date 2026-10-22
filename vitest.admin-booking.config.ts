import path from "node:path";
import { defineConfig } from "vitest/config";

// 專供 `npm run test:admin-booking` 使用：只跑預約管理後台的整合測試（對真實
// Supabase 專案跑），獨立於 `test:rls`（見 vitest.integration.config.ts）、
// `test:booking`（見 vitest.booking.config.ts）與預設 `npm test`（見
// vitest.config.ts），避免互相撿到彼此的測試檔案。
// alias：整合測試會呼叫 lib/admin/reschedule-slots.ts、designers.ts 的真實查詢函式，它們用 `@/` 路徑匯入（TASK-075）。
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    environment: "node",
    include: ["tests/admin-booking.integration.test.ts"],
    testTimeout: 30000,
  },
});
