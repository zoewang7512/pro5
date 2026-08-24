import path from "node:path";
import { defineConfig } from "vitest/config";

// 專供 `npm run test:notifications` 使用：只跑 Email 通知與提醒 Epic 的前後端串接
// 整合測試（對真實 Supabase 專案跑），獨立於 test:rls／test:booking／
// test:admin-booking／test:business-hours／test:store-settings／test:booking-policy／
// test:services／test:account 與預設 `npm test`，避免互相撿到彼此的測試檔案。
//
// 需要 `resolve.alias`（其他 *.integration.test.ts 都不需要）：本檔案直接
// import webhook／cron 兩支 API Route handler（`app/api/**/route.ts`），這兩個
// 檔案內部用 `@/lib/...` 絕對路徑匯入，需要在這裡（而不是只在測試檔案自己的
// import）解析，否則 Vitest 找不到模組。
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    environment: "node",
    include: ["tests/notifications.integration.test.ts"],
    testTimeout: 30000,
  },
});
