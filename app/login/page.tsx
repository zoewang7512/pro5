import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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
    if (isAdmin) {
      redirect("/admin");
    }
  }

  return <LoginForm />;
}
