import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAalSatisfied } from "@/lib/auth/aal";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    // 只有真的是管理者才導去 /admin；已登入但非管理者的帳號留在登入頁，
    // 避免跟 /admin 的 is_admin() 檢查互相導向造成無限迴圈。
    const { data: isAdmin } = await supabase.rpc("is_admin");
    // 已啟用 MFA 但尚未通過 TOTP 驗證（aal 未滿足）不自動導向 /admin，維持顯示登入表單
    // ——修正 TASK-044 C1：使用者在登入頁 MFA 驗證碼畫面重新整理頁面時，若沒有這道檢查，
    // 這裡的 is_admin() 判斷仍會通過（帳密已驗證），直接繞過尚未完成的 TOTP 驗證。
    // 重新整理後會回到帳密輸入表單（而非自動接續顯示驗證碼步驟），需要重新輸入帳密才能
    // 再次觸發 login-form.tsx 既有的 MFA 挑戰流程，這是已與人工確認的已知 UX 取捨。
    if (isAdmin && (await isAalSatisfied(supabase, user))) {
      redirect("/admin");
    }
  }

  return <LoginForm />;
}
