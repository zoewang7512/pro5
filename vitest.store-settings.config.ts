import { defineConfig } from "vitest/config";

// 專供 `npm run test:store-settings` 使用：只跑「商店基本資料設定」的整合測試
// （對真實 Supabase 專案跑），獨立於 test:rls／test:booking／test:admin-booking／
// test:business-hours 與預設 `npm test`，避免互相撿到彼此的測試檔案。
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/store-settings.integration.test.ts"],
    testTimeout: 30000,
  },
});
