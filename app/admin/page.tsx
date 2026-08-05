import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LogoutButton } from "./logout-button";

export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // 登入 ≠ 有權限：只有登記在 admins 表的唯一設計師帳號才能看到後台內容，
  // 避免（例如 Supabase 專案未關閉公開註冊時）任何自行註冊的帳號長驅直入。
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) {
    redirect("/login");
  }

  return (
    <main style={{ padding: 32 }}>
      <h1>後台首頁（暫代）</h1>
      <p>已登入：{user.email}</p>
      <LogoutButton />
    </main>
  );
}
