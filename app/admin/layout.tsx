import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AdminShell } from "./_components/AdminShell";

// 明確宣告動態渲染：目前雖然透過 createClient() 內部的 cookies() 隱含觸發動態渲染，
// 但這是全站唯一的驗證關卡，用顯式宣告當作萬一未來重構動了 createClient() 內部實作、
// 不小心讓它變成靜態渲染的攔截網。
export const dynamic = "force-dynamic";

// 原本每個 /admin 頁面各自檢查一次（見 TASK-014），第二個頁面
// （/admin/business-hours）出現後上移到這裡，涵蓋 /admin 底下所有頁面，不必重複貼一次。
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
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

  return <AdminShell>{children}</AdminShell>;
}
