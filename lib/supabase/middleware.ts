import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAalSatisfied } from "@/lib/auth/aal";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // 一律用 getUser()（會向 Supabase Auth 伺服器驗證），不用只讀 cookie 的 getSession()。
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isAdminRoute = request.nextUrl.pathname.startsWith("/admin");

  // getUser() 若觸發 token 刷新或清除（例如 access token 已失效），異動後的 cookie 會
  // 寫進上面的 response（見 setAll 回呼），但 NextResponse.redirect() 建立的是另一個
  // 全新的 response，不會自動帶上——需要手動複製，否則使用者被導回 /login 後反而遺失
  // 剛刷新的 session 或殘留已失效的 cookie（architect 審查發現，F2；兩個重導向分支
  // 皆適用，不只 aal 未滿足那一支）。
  function redirectToLogin() {
    const loginUrl = new URL("/login", request.url);
    const redirectResponse = NextResponse.redirect(loginUrl);
    for (const cookie of response.cookies.getAll()) {
      redirectResponse.cookies.set(cookie);
    }
    return redirectResponse;
  }

  if (isAdminRoute && !user) {
    return redirectToLogin();
  }

  // 已啟用 MFA 但尚未通過 TOTP 驗證（aal 未滿足）的 session 不得進入 /admin 任何頁面——
  // 修正 TASK-044 C1：使用者在登入頁 MFA 驗證碼畫面重新整理頁面時，若沒有這道檢查，
  // is_admin() 頁面層判斷仍會通過（帳密已驗證），等同繞過 MFA。與 app/admin/layout.tsx
  // 各自獨立檢查（既有的縱深防禦慣例，見該檔案註解），不共用同一次判斷結果。
  if (isAdminRoute && user && !(await isAalSatisfied(supabase, user))) {
    return redirectToLogin();
  }

  return response;
}
