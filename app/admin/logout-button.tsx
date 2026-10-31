"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAdminProfile } from "./_components/AdminProfileContext";
import { useUnsavedChangesActions } from "./_components/UnsavedChangesProvider";

export function LogoutButton() {
  const router = useRouter();
  const { confirmIfDirty } = useUnsavedChangesActions();
  const { isDemo } = useAdminProfile();

  async function handleLogout() {
    const supabase = createClient();
    // Demo 帳號由所有面試官共用同一個帳戶：預設的 global 登出會撤銷這個帳戶的所有 session，
    // 任何一位按「登出」都會把其他正在體驗的人踢掉（架構筆記 D6），所以只清目前這個瀏覽器的 session。
    // 非 Demo 維持原本的預設行為。
    await (isDemo ? supabase.auth.signOut({ scope: "local" }) : supabase.auth.signOut());
    router.replace("/login");
    router.refresh();
  }

  // 有未儲存變更時先提示（TASK-081），選「放棄變更」才登出；登出本身的 router.replace 是程式化導覽，
  // 不再攔截。leaving：登出後若退回整頁導覽，不會在已選過「放棄變更」後又跳一次瀏覽器原生提示。
  return (
    <button
      onClick={() =>
        confirmIfDirty(
          () => {
            void handleLogout();
          },
          { leaving: true },
        )
      }
      style={{ width: "100%" }}
    >
      登出
    </button>
  );
}
