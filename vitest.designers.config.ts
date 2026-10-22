import path from "node:path";
import { defineConfig } from "vitest/config";

// 專供 `npm run test:designers` 使用：只跑「多位設計師」的整合測試（對真實 Supabase 專案跑），
// 獨立於 test:rls／test:booking／test:admin-booking／test:business-hours／test:store-settings／
// test:services 與預設 `npm test`，避免互相撿到彼此的測試檔案。
// hookTimeout：beforeAll 要做十幾次連續的網路往返（建帳號、登入、建測試資料），預設 10 秒在網路慢時
// 會讓整個套件一起逾時。alias：整合測試會直接呼叫 lib/admin/designers.ts 的真實查詢函式。
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    environment: "node",
    include: ["tests/designers.integration.test.ts"],
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
