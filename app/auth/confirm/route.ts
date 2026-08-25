import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// TASK-058：忘記密碼信件連結的伺服器端驗證端點。取代原本依賴 @supabase/ssr
// createBrowserClient 強制使用的 PKCE flow（code_verifier 只存在申請當下那台瀏覽器的
// 本地儲存空間，換裝置/換瀏覽器開信會被誤判為連結已逾時或已使用，見 TASK-040 審查發現）。
// 這裡改用 supabase.auth.verifyOtp({ type: "recovery", token_hash }) 在伺服器端驗證，
// session 透過 Set-Cookie 建立，不依賴瀏覽器本地儲存的 code_verifier，解決跨裝置問題。
//
// **`type` 寫死只接受 `"recovery"`，不是泛用的 EmailOtpType 白名單**（architect／
// security-reviewer 於本卡總覽審查一致提出的 MUST FIX：本端點的唯一用途是忘記密碼，
// 若接受 `email_change`／`magiclink` 等其他類型的 token，等於讓任何 OTP-based 確認信
// 都能在這裡兌換出 session，而 /reset-password 判斷「是否來自合法 recovery 連結」的
// 依據是 amr claim 的 method 值為 `"otp"`——這個值不分 verifyOtp 呼叫時傳入的 type，
// 任何類型的 token 驗證後都會是 `"otp"`。收斂成只接受 recovery，才能真正把「這個 otp
// session 一定來自忘記密碼流程」這個假設鎖在單一守門點，而不是只寫在註解裡）。
//
// **不接受 `next` 查詢參數，固定導向 `/reset-password`**（security-reviewer 提出的
// NICE TO HAVE：Supabase Email Template 的 `{{ .RedirectTo }}` 實際渲染出來是絕對
// 網址，例如 `resetPasswordForEmail` 傳入的 `${siteUrl}/reset-password`，永遠不會通過
// 「必須是站內相對路徑」的檢查，等於這個參數形同虛設、只有攻擊者自帶的相對路徑才會被
// 採用——本端點唯一用途就是忘記密碼，目的地本來就只有一個，移除這個參數同時消除了整個
// 開放重導向攻擊面，不需要另外寫 safeNext 檢查邏輯）。
//
// Supabase Dashboard 的 Recovery Email Template 需要改成：
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery
// 這是 Supabase 專案後台設定，不在版控範圍內，只能由使用者本人在 Dashboard 操作。
//
// `/reset-password`（reset-password-form.tsx）如何判斷「這個 session 真的來自合法
// recovery 連結」而非「任何已登入的既有 session」，見該檔案註解與
// ai/artifacts/設計師登入與帳號安全/task-cards/TASK-058.md 的實測記錄與審查發現。

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  // 目的地固定為 /reset-password，不用 request 的 origin（可能受 forwarded host 影響），
  // 比照 app/login/login-form.tsx 既有的 NEXT_PUBLIC_SITE_URL 慣例。
  const destination = `${process.env.NEXT_PUBLIC_SITE_URL}/reset-password`;

  // token_hash 缺失或 type 不是 "recovery" 一律 fail closed，不呼叫 verifyOtp——避免
  // 把未經檢查的值直接丟給 SDK，也避免本端點被拿去驗證非忘記密碼用途的 token（見上方
  // 檔頭說明）。
  if (!tokenHash || type !== "recovery") {
    return NextResponse.redirect(destination);
  }

  const supabase = await createClient();
  // 這裡不需要根據 verifyOtp 是否成功分岔導向不同頁面：成功會透過 Set-Cookie 建立
  // session，失敗則不會有任何 session；兩種情況都導回同一個 /reset-password，實際
  // 「連結是否有效」完全交給該頁面自己依 session claim 判斷（單一事實來源，不在這裡
  // 重複一份判斷邏輯）。
  await supabase.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });

  return NextResponse.redirect(destination);
}
