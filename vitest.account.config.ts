import { defineConfig } from "vitest/config";

// 專供 `npm run test:account` 使用：只跑「設計師登入與帳號安全」的整合測試
// （對真實 Supabase 專案跑），獨立於 test:rls／test:booking／test:admin-booking／
// test:business-hours／test:store-settings／test:services 與預設 `npm test`，避免互相
// 撿到彼此的測試檔案。
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/account.integration.test.ts"],
    testTimeout: 30000,
  },
});
