"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import { usePathname } from "next/navigation";
import { Sidebar, type SidebarItem } from "@/components/ui/Sidebar";
import { LogoutButton } from "../logout-button";
import { useAdminProfile } from "./AdminProfileContext";
import { resolveAdminDisplayName } from "@/lib/admin/account";

// Sidebar 導覽上移到這裡（第二個後台頁面 /admin/business-hours 出現，比照
// TASK-014 完成證據記錄的既知殘留風險：導覽項目原本寫在 AdminDashboard.tsx 頁面層，
// 第二個頁面出現時應上移到 layout 並用 usePathname() 推導 active 狀態，避免每個
// 頁面各自複製一份 items 陣列、日後對不起來）。

const NAV_ITEMS: Array<{ label: string; href: string; disabled?: boolean }> = [
  { label: "預約", href: "/admin" },
  { label: "服務設定", href: "/admin/services" },
  { label: "營業時間", href: "/admin/business-hours" },
  { label: "預約規則", href: "/admin/booking-policy" },
  { label: "商店設定", href: "/admin/store-settings" },
  { label: "帳號設定", href: "/admin/account" },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { displayName, avatarUrl } = useAdminProfile();
  const items: SidebarItem[] = NAV_ITEMS.map((item) => ({
    ...item,
    active: pathname === item.href,
  }));

  return (
    <Box sx={{ display: "flex", height: "100vh" }}>
      <Sidebar
        title="理髮廳後台"
        items={items}
        logoutSlot={<LogoutButton />}
        profileName={resolveAdminDisplayName(displayName)}
        profileAvatarUrl={avatarUrl}
      />
      <Box component="main" sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {children}
      </Box>
    </Box>
  );
}
