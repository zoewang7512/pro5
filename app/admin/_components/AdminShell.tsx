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

// 導覽圖示：手繪 SVG，比照 components/ui/ColorModeToggle.tsx 既有慣例
// （stroke="currentColor"，本專案未安裝 @mui/icons-material，TASK-064 mockup-decision
// 核准維持此慣例，不為 6 個圖示新增相依套件）。圖示與業務對應（哪個導覽項目用哪個
// 圖示）屬於呼叫端 AdminShell 的決定，Sidebar.tsx 本身不假設，只負責渲染傳入的 icon。
const ICON_PROPS = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function CalendarIcon() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}

function ScissorsIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="6" cy="6" r="2.2" />
      <circle cx="6" cy="18" r="2.2" />
      <path d="M7.8 7.8L20 20M20 4L7.8 16.2" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  );
}

function ClipboardCheckIcon() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 3.5h6a1 1 0 011 1V6H8V4.5a1 1 0 011-1z" />
      <path d="M9 13l2 2 4-4" />
    </svg>
  );
}

function StorefrontIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M4 9l1-5h14l1 5" />
      <path d="M4 9a2 2 0 004 0 2 2 0 004 0 2 2 0 004 0 2 2 0 004 0" />
      <path d="M5 9v11h14V9" />
      <path d="M10 20v-6h4v6" />
    </svg>
  );
}

function UserCircleIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="10" r="3" />
      <path d="M6.5 19a6 6 0 0111 0" />
    </svg>
  );
}

const NAV_ITEMS: Array<{ label: string; href: string; disabled?: boolean; icon: React.ReactNode }> = [
  { label: "預約", href: "/admin", icon: <CalendarIcon /> },
  { label: "服務設定", href: "/admin/services", icon: <ScissorsIcon /> },
  { label: "營業時間", href: "/admin/business-hours", icon: <ClockIcon /> },
  { label: "預約規則", href: "/admin/booking-policy", icon: <ClipboardCheckIcon /> },
  { label: "商店設定", href: "/admin/store-settings", icon: <StorefrontIcon /> },
  { label: "帳號設定", href: "/admin/account", icon: <UserCircleIcon /> },
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
