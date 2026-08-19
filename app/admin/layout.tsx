import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AdminShell } from "./_components/AdminShell";
import { AdminProfileProvider } from "./_components/AdminProfileContext";
import { getAdminProfile, resolveAdminAvatarUrl } from "@/lib/admin/account";
import { isAalSatisfied } from "@/lib/auth/aal";

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

  // 已啟用 MFA 但尚未通過 TOTP 驗證（aal 未滿足）不得看到任何 /admin 頁面內容——與
  // lib/supabase/middleware.ts 各自獨立檢查（既有的縱深防禦慣例，本檔案下方「登入 ≠
  // 有權限」註解已說明同一原則），修正 TASK-044 C1。放在 is_admin() RPC 之前：不需要
  // 為它多發一次 is_admin() RPC 查詢（architect 審查發現，F3）。isAalSatisfied() 需要
  // 上面已驗證過的 user（伺服器端權威的 factor 清單，見 lib/auth/aal.ts 說明），不會
  // 另外新增網路請求。
  if (!(await isAalSatisfied(supabase, user))) {
    redirect("/login");
  }

  // 登入 ≠ 有權限：只有登記在 admins 表的唯一設計師帳號才能看到後台內容，
  // 避免（例如 Supabase 專案未關閉公開註冊時）任何自行註冊的帳號長驅直入。
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) {
    redirect("/login");
  }

  // 個人資料（顯示名稱／大頭貼）在伺服器端讀取一次，透過 AdminProfileProvider 灌入單一
  // context，Sidebar／帳號設定頁皆消費同一份，不再各自重複呼叫 get_admin_profile()
  // （architect TASK-038 審查發現，見 AdminProfileContext.tsx 檔頭說明）。讀取失敗時
  // 降級為「兩者皆未設定」，不阻擋既有後台頁面渲染。
  const profileResult = await getAdminProfile(supabase);
  const displayName = profileResult.ok ? profileResult.data.displayName : null;
  const avatarUrl = profileResult.ok ? resolveAdminAvatarUrl(profileResult.data.avatarUrl) : null;

  return (
    <AdminProfileProvider
      initialDisplayName={displayName}
      initialAvatarUrl={avatarUrl}
      email={user.email ?? ""}
      initialPendingEmail={user.new_email ?? null}
    >
      <AdminShell>{children}</AdminShell>
    </AdminProfileProvider>
  );
}
