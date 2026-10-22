"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useUnsavedChangesActions } from "./_components/UnsavedChangesProvider";

export function LogoutButton() {
  const router = useRouter();
  const { confirmIfDirty } = useUnsavedChangesActions();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
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
