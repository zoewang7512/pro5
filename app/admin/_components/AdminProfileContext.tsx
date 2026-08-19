"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
import { getAdminProfile, resolveAdminAvatarUrl } from "@/lib/admin/account";

// 個人資料的單一狀態來源，由 app/admin/layout.tsx（server component）在伺服器端讀取一次
// 個人資料與 email，透過 Provider 的 initial props 灌入，Sidebar／AccountSettingsView 皆
// 消費同一份 context，不再各自獨立呼叫 get_admin_profile()（architect TASK-038 審查發現：
// 原本 AdminShell／AccountSettingsView 各自 fetch，/admin/account 會重複呼叫兩次 RPC，且
// Sidebar 的 state 被關在 AdminShell 內部沒有對外更新通道，TASK-041 存檔後無法讓 Sidebar
// 即時反映新名稱）。refresh() 供 TASK-041 存檔成功後呼叫，重新拉一次個人資料並讓所有消費者
// 一起更新，不需要重新整理整頁。
//
// displayName／avatarUrl 皆維持「原始值」（null 代表未設定）——Sidebar 顯示時才套用
// resolveAdminDisplayName() 的預設文案；帳號設定頁的可編輯欄位需要原始值而非預設文案，
// 避免使用者未改欄位就儲存時，把「設計師」這個純顯示用的回退文字寫成真實 display_name
// （architect TASK-038 審查發現）。

export type AdminProfileContextValue = {
  displayName: string | null;
  avatarUrl: string | null;
  email: string;
  pendingEmail: string | null;
  refresh: () => Promise<void>;
};

const AdminProfileContext = React.createContext<AdminProfileContextValue | null>(null);

export function AdminProfileProvider({
  initialDisplayName,
  initialAvatarUrl,
  email: initialEmail,
  initialPendingEmail,
  children,
}: {
  initialDisplayName: string | null;
  initialAvatarUrl: string | null;
  email: string;
  initialPendingEmail: string | null;
  children: React.ReactNode;
}) {
  const supabase = React.useMemo(() => createClient(), []);
  const [displayName, setDisplayName] = React.useState(initialDisplayName);
  const [avatarUrl, setAvatarUrl] = React.useState(initialAvatarUrl);
  // email 也改成 state（而非固定的 SSR 初始值）：管理員可能在別的分頁／裝置完成了 email
  // 變更確認信的連結，這裡的 refresh() 需要能反映最新值，否則會出現「pendingEmail 已經
  // 因為變更完成而變成 null，但 email 欄位仍顯示舊值」的矛盾畫面（architect TASK-042
  // 審查發現）。
  const [email, setEmail] = React.useState(initialEmail);
  // pendingEmail 代表「已送出但尚未經信件連結確認」的登入 email 變更請求（Supabase 的
  // user.new_email），來源是伺服器實際狀態、不是前端自己記的樂觀 UI，重新整理頁面也不會
  // 消失（security-reviewer TASK-042 審查發現：原本只用一個純前端 boolean 記錄「剛剛送出
  // 成功」，重新整理就看不到進行中的變更請求，管理員無從察覺是否有一個自己沒發起的變更
  // 正在進行）。
  const [pendingEmail, setPendingEmail] = React.useState(initialPendingEmail);

  const refresh = React.useCallback(async () => {
    // 兩次呼叫互不相依，平行送出省一趟 round-trip。任一邊失敗都保留舊值、不覆蓋成
    // null／清空——原本 getUser() 那支完全沒檢查 error 就直接 setPendingEmail(user?.new_email
    // ?? null)，暫時性網路錯誤會把 user 錯誤地讀成 null、把待確認 banner 悄悄清掉，
    // 這正是 pendingEmail 這條線想避免的「狀態莫名消失」（architect TASK-042 審查發現的
    // 真實 bug，不是本來就這樣設計）。
    const [profileResult, userResult] = await Promise.all([getAdminProfile(supabase), supabase.auth.getUser()]);

    if (profileResult.ok) {
      setDisplayName(profileResult.data.displayName);
      setAvatarUrl(resolveAdminAvatarUrl(profileResult.data.avatarUrl));
    }

    if (!userResult.error && userResult.data.user) {
      setEmail(userResult.data.user.email ?? "");
      setPendingEmail(userResult.data.user.new_email ?? null);
    }
  }, [supabase]);

  const value = React.useMemo(
    () => ({ displayName, avatarUrl, email, pendingEmail, refresh }),
    [displayName, avatarUrl, email, pendingEmail, refresh],
  );

  return <AdminProfileContext.Provider value={value}>{children}</AdminProfileContext.Provider>;
}

export function useAdminProfile(): AdminProfileContextValue {
  const context = React.useContext(AdminProfileContext);
  if (!context) {
    throw new Error("useAdminProfile 必須在 AdminProfileProvider 底下使用");
  }
  return context;
}
