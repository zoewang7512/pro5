import "server-only";

// **僅限伺服器端使用**：`DEMO_PASSWORD` 只會從這個模組被讀出來。`import "server-only"` 讓
// 「被拉進 client 匯入鏈」變成建置期失敗（比照 lib/supabase/service-role.ts）。前端要用的
// 文案（含 DEMO_RESET_LABEL）放在不含 server-only 的 ./notice-copy。
//
// 所有環境變數都在呼叫當下才讀，不在模組載入時快取：測試可以任意改 process.env，
// 也避免 Vercel 建置階段（沒有這些變數）因為模組頂層取值而出事。

export { DEMO_RESET_LABEL } from "./notice-copy";

// 只認 `app_metadata.is_demo === true`（嚴格布林）。`app_metadata` 只有 service_role 能寫，
// 使用者本人改不了（`user_metadata` 才可以，所以不能用它）。字串 "true"、1、缺欄位、null 一律
// 視為「非 Demo」——讀不到寧可當成一般管理員，真正的鎖由資料庫保證，這裡只是前端提示。
export function isDemoUser(user: { app_metadata?: Record<string, unknown> | null } | null | undefined): boolean {
  return user?.app_metadata?.is_demo === true;
}

export type DemoConfig = { email: string; password: string };

// 回傳 null 代表「Demo 入口整個關閉」。條件缺一不可：總開關為 "true"、帳號密碼皆非空、
// 且 DEMO_EMAIL 不得等於設計師的 DESIGNER_EMAIL（不分大小寫）——否則一鍵進入會變成
// 「任何人一鍵登入真正的店長帳號」。DESIGNER_EMAIL 沒設定時這道比對形同沒作用，
// 主要防線仍是一鍵進入端點對 `is_demo` 的驗證（見架構筆記 D2）。
export function getDemoConfig(): DemoConfig | null {
  if (process.env.DEMO_ENABLED !== "true") return null;

  const email = process.env.DEMO_EMAIL?.trim();
  const password = process.env.DEMO_PASSWORD;
  if (!email || !password || !password.trim()) return null;

  const designerEmail = process.env.DESIGNER_EMAIL?.trim();
  if (designerEmail && designerEmail.toLowerCase() === email.toLowerCase()) return null;

  return { email, password };
}

// 供登入頁伺服器元件決定要不要顯示入口。只回布林，密碼不會經過呼叫端。
export function isDemoEntryEnabled(): boolean {
  return getDemoConfig() !== null;
}
