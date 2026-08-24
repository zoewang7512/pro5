import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// **僅限伺服器端使用**（API Route／Server Action），絕不可被任何 client component
// 匯入——`SUPABASE_SERVICE_ROLE_KEY` 具完整資料庫權限，繞過所有 RLS policy。
// `import "server-only"` 讓這件事從「只靠註解拜託大家小心」變成編譯期強制：這個
// 模組一旦出現在任何 client component 的匯入鏈上，Next.js 建置就會直接失敗，而不是
// 靜默通過再指望 code review 抓到（architect／security-reviewer 於 TASK-051
// 審查提出）。
//
// 真正的風險說明（審查後修正）：Next.js 只會把 `NEXT_PUBLIC_` 前綴的環境變數 inline
// 進瀏覽器端 bundle，`SUPABASE_SERVICE_ROLE_KEY` 本身不會被打包外洩；真正的風險是
// 這個 client 在 Server Component／Server Action 情境被誤用，讓原本應該受 RLS
// 保護的查詢整段繞過權限檢查（例如把它當成一般 `lib/supabase/server.ts` 的替代品，
// 在會員自己的頁面裡查出其他人的資料）。`server-only` 防的是「被拉進 client 匯入鏈」
// 這一種誤用；「在伺服器端但用錯情境」仍要靠命名（`createServiceRoleClient` vs
// 既有 `createClient`）與 code review 提醒。
//
// 與既有 `lib/supabase/server.ts`（用 `NEXT_PUBLIC_SUPABASE_ANON_KEY`、走 cookie
// session、受 RLS 約束）刻意分成獨立檔案、獨立函式名稱，不共用或合併，避免日後有人
// 在一般頁面情境誤用略過 RLS 的 client（TASK-051 任務卡「實作備註」要求）。
//
// 目前唯一預期呼叫端：TASK-052／053／054 的 webhook／排程 API Route，這些端點本身
// 用 `lib/webhooks/verify-secret.ts` 驗證請求來源，通過驗證後才需要用 service role
// 權限讀取 `appointments`——anon 對這張表沒有 select policy（見
// `0001_core_schema.sql`），webhook／排程請求沒有使用者 session、等同 anon，
// 因此需要 service role 才能讀到寄信所需的預約詳情；`is_admin()` 的 authenticated
// 使用者（後台已登入的設計師）其實可以透過既有 `admin full access to appointments`
// policy 直接讀取，不需要 service role（service role 是給「完全沒有使用者 session」
// 的伺服器對伺服器請求用的）。
//
// 不快取成單例：Next.js Route Handler 在無伺服器環境下每次請求可能是不同的執行環境，
// 建立成本極低（純物件初始化，無網路 I/O），比照 `@supabase/supabase-js` 官方文件對
// service role client 的既有建議寫法，不做連線池化。
export function createServiceRoleClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("createServiceRoleClient: 缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
