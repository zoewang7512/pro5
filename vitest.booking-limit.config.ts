import { defineConfig } from "vitest/config";

// 專供 `npm run test:booking-limit` 使用：只跑 TASK-120（0030 的 create_appointment 滾動視窗）的整合測試
// （對真實 Supabase 專案跑，Email 案例會寄出約 4 封確認信到 Resend 測試位址 delivered+...@resend.dev），
// 獨立於其他 test:* 與預設 `npm test`。
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/booking-limit.integration.test.ts"],
    testTimeout: 90000,
    hookTimeout: 120000,
  },
});
