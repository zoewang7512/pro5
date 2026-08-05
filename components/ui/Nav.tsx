"use client";

import * as React from "react";
import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import Link from "next/link";

export type NavItem = { label: string; href: string; active?: boolean };

export function Nav({ title, items }: { title: string; items: NavItem[] }) {
  return (
    <AppBar
      position="static"
      color="transparent"
      elevation={0}
      sx={{ borderBottom: "1px solid", borderColor: "divider" }}
    >
      <Toolbar sx={{ gap: 3, flexWrap: "wrap" }}>
        <Typography variant="h6" component="span" sx={{ flexGrow: 1 }}>
          {title}
        </Typography>
        <Box component="nav" sx={{ display: "flex", gap: 3 }}>
          {items.map((item) => (
            <Typography
              key={item.href}
              component={Link}
              href={item.href}
              variant="subtitle2"
              sx={{
                color: item.active ? "primary.main" : "text.secondary",
                fontWeight: item.active ? 600 : 500,
                "&:hover": { color: "primary.main" },
              }}
            >
              {item.label}
            </Typography>
          ))}
        </Box>
      </Toolbar>
    </AppBar>
  );
}
