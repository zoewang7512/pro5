"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import Typography from "@mui/material/Typography";
import Link from "next/link";

// MUI 沒有對應單一 Sidebar 元件，比照 components/ui/Nav.tsx 的做法，
// 用 MUI Box／List／ListItemButton 拼出，樣式對照 mockup 的 .sidebar／.nav-item class。

export type SidebarItem = {
  label: string;
  href: string;
  active?: boolean;
  disabled?: boolean;
};

export function Sidebar({
  title,
  items,
  logoutSlot,
}: {
  title: string;
  items: SidebarItem[];
  logoutSlot?: React.ReactNode;
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
      <Typography variant="subtitle2" sx={{ px: 2.5, mb: 2.5, fontWeight: 700 }}>
        {title}
      </Typography>

      <List sx={{ py: 0 }}>
        {items.map((item) =>
          item.disabled ? (
            <ListItemButton key={item.href} disabled sx={{ px: 2.5, py: 1.25 }}>
              <Typography variant="subtitle2" sx={{ color: "text.disabled" }}>
                {item.label}
              </Typography>
            </ListItemButton>
          ) : (
            <ListItemButton
              key={item.href}
              component={Link}
              href={item.href}
              selected={item.active}
              sx={{
                px: 2.5,
                py: 1.25,
                borderRight: "3px solid",
                borderColor: item.active ? "primary.main" : "transparent",
                "&.Mui-selected": { bgcolor: "grey.200" },
                "&.Mui-selected:hover": { bgcolor: "grey.200" },
              }}
            >
              <Typography
                variant="subtitle2"
                sx={{
                  color: item.active ? "primary.dark" : "text.secondary",
                  fontWeight: item.active ? 600 : 500,
                }}
              >
                {item.label}
              </Typography>
            </ListItemButton>
          ),
        )}
      </List>

      {logoutSlot && (
        <Box sx={{ mt: "auto", px: 2.5, pt: 5 }}>
          {logoutSlot}
        </Box>
      )}
    </Box>
  );
}
