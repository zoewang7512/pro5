"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import Typography from "@mui/material/Typography";
import Avatar from "@mui/material/Avatar";
import Link from "next/link";
import { ColorModeToggle } from "./ColorModeToggle";

// MUI 沒有對應單一 Sidebar 元件，比照 components/ui/Nav.tsx 的做法，
// 用 MUI Box／List／ListItemButton 拼出，樣式對照 mockup 的 .sidebar／.nav-item class。

export type SidebarItem = {
  label: string;
  href: string;
  active?: boolean;
  disabled?: boolean;
  // 圖示由呼叫端傳入（例如 AdminShell.tsx 的 NAV_ITEMS）——Sidebar 是跨頁共用的通用
  // 元件，不假設「哪個導覽項目該用哪個圖示」這種業務對應（TASK-064）。
  icon?: React.ReactNode;
};

export function Sidebar({
  title,
  items,
  logoutSlot,
  profileName,
  profileAvatarUrl,
}: {
  title: string;
  items: SidebarItem[];
  logoutSlot?: React.ReactNode;
  // 目前登入設計師的顯示名稱／大頭貼（TASK-038），顯示於 logoutSlot 上方。皆為選填：
  // 未傳入時（例如尚未載入完成）不渲染這個區塊，不佔版位、不顯示空白骨架——比照既有
  // 「非阻塞式次要資訊」的既有慣例（見 BrandHeaderSection 獨立 fetch 不阻塞主流程）。
  profileName?: string;
  profileAvatarUrl?: string | null;
}) {
  return (
    <Box
      component="nav"
      sx={{
        width: 200,
        flexShrink: 0,
        bgcolor: "background.paper",
        borderRight: "1px solid",
        borderColor: "divider",
        py: 2.5,
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}
    >
      <Typography variant="subtitle2" sx={{ px: 2.5, mb: 2.5, fontWeight: 700, fontSize: 18 }}>
        {title}
      </Typography>

      <List sx={{ py: 0 }}>
        {items.map((item) =>
          item.disabled ? (
            <ListItemButton
              key={item.href}
              disabled
              sx={{ px: 2.5, py: 3, display: "flex", alignItems: "center", gap: 2 }}
            >
              {item.icon && (
                <Box sx={{ width: 20, height: 20, flexShrink: 0, "& svg": { width: 20, height: 20 } }}>
                  {item.icon}
                </Box>
              )}
              <Typography sx={{ fontSize: 16, color: "text.disabled" }}>{item.label}</Typography>
            </ListItemButton>
          ) : (
            <ListItemButton
              key={item.href}
              component={Link}
              href={item.href}
              selected={item.active}
              sx={{
                px: 2.5,
                py: 3,
                display: "flex",
                alignItems: "center",
                gap: 2,
                borderRight: "3px solid",
                borderColor: item.active ? "primary.main" : "transparent",
                color: item.active ? "primary.dark" : "text.secondary",
                "&.Mui-selected": { bgcolor: "grey.200" },
                "&.Mui-selected:hover": { bgcolor: "grey.200" },
              }}
            >
              {item.icon && (
                <Box sx={{ width: 20, height: 20, flexShrink: 0, "& svg": { width: 20, height: 20 } }}>
                  {item.icon}
                </Box>
              )}
              <Typography sx={{ fontSize: 16, fontWeight: item.active ? 600 : 500, color: "inherit" }}>
                {item.label}
              </Typography>
            </ListItemButton>
          ),
        )}
      </List>

      {profileName && (
        <Box
          sx={{
            mt: "auto",
            px: 2.5,
            pt: 5,
            display: "flex",
            alignItems: "center",
            gap: 1,
            borderTop: logoutSlot ? "1px solid" : undefined,
            borderColor: "divider",
            pb: logoutSlot ? 2 : 0,
          }}
        >
          <Avatar src={profileAvatarUrl ?? undefined} sx={{ width: 28, height: 28, fontSize: 13 }}>
            {[...profileName][0]}
          </Avatar>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, flex: 1, minWidth: 0 }}>
            {profileName}
          </Typography>
          <ColorModeToggle />
        </Box>
      )}

      {logoutSlot && (
        <Box sx={{ mt: profileName ? 0 : "auto", px: 2.5, pt: profileName ? 0 : 5 }}>
          {logoutSlot}
        </Box>
      )}
    </Box>
  );
}
