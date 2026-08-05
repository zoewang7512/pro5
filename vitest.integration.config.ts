import { defineConfig } from "vitest/config";

// 專供 `npm run test:rls` 使用：只跑 RLS 邊界整合測試（對真實 Supabase 專案跑），
// 不會被預設 `npm test`（見 vitest.config.ts）撿到。刻意只 include 這一個檔案，
// 不用萬用字元——顧客預約流程的整合測試（`tests/booking.integration.test.ts`）
// 屬於 `npm run test:booking`（見 vitest.booking.config.ts），兩者各自獨立執行，
// 避免其中一個指令意外把另一邊有副作用（建立測試資料／併發測試）的案例也跑了。
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/rls.integration.test.ts"],
  },
});
