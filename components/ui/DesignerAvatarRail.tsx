"use client";

import * as React from "react";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Typography from "@mui/material/Typography";
import { designerInitial } from "@/lib/designers";

// 橫向頭像列（類似 IG 限時動態）：每個頭像是一顆 button（Tab 切換、Enter／空白鍵選取），選取態是
// 2px primary 外框。純展示元件，不碰資料；avatarUrl 必須是呼叫端已過白名單的網址。列本身不處理左右留白——
// 要讓超出畫面的頭像露出一半（暗示可橫向捲動），由呼叫端用 sx 讓它延伸到容器邊緣（見 DesignerPickerSection）。

export type DesignerAvatarRailItem = {
  key: string;
  label: string;
  avatarUrl?: string | null;
  // "any" 是「不指定」：沒有頭像，顯示 ✦。
  variant?: "any" | "person";
};

export type DesignerAvatarRailProps = {
  items: DesignerAvatarRailItem[];
  selectedKey: string;
  onSelect: (key: string) => void;
  ariaLabel: string;
  sx?: React.ComponentProps<typeof Box>["sx"];
};

const AVATAR_SIZE = 72;

export function DesignerAvatarRail({ items, selectedKey, onSelect, ariaLabel, sx }: DesignerAvatarRailProps) {
  return (
    <Box
      role="group"
      aria-label={ariaLabel}
      sx={[
        { display: "flex", gap: 2, overflowX: "auto", pt: 0.5, pb: 1.5 },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      {items.map((item) => {
        const selected = item.key === selectedKey;
        return (
          <ButtonBase
            key={item.key}
            aria-pressed={selected}
            onClick={() => onSelect(item.key)}
            sx={{
              flex: "0 0 auto",
              width: AVATAR_SIZE,
              flexDirection: "column",
              alignItems: "center",
              alignSelf: "flex-start",
              borderRadius: 1,
            }}
          >
            <Box
              sx={{
                width: AVATAR_SIZE,
                height: AVATAR_SIZE,
                p: "3px",
                borderRadius: "50%",
                border: 2,
                borderColor: selected ? "primary.main" : "transparent",
              }}
            >
              {item.variant === "any" ? (
                <Avatar sx={{ width: "100%", height: "100%", bgcolor: "grey.200", color: "text.secondary", fontSize: 22 }}>
                  ✦
                </Avatar>
              ) : (
                <Avatar
                  src={item.avatarUrl ?? undefined}
                  alt=""
                  slotProps={{ img: { referrerPolicy: "no-referrer" } }}
                  sx={{ width: "100%", height: "100%", bgcolor: "primary.main", color: "primary.contrastText", fontSize: 22 }}
                >
                  {designerInitial(item.label)}
                </Avatar>
              )}
            </Box>
            <Typography
              variant="caption"
              sx={{
                mt: 0.75,
                maxWidth: "100%",
                textAlign: "center",
                overflowWrap: "anywhere",
                color: selected ? "text.primary" : "text.secondary",
                fontWeight: selected ? 600 : 400,
              }}
            >
              {item.label}
            </Typography>
          </ButtonBase>
        );
      })}
    </Box>
  );
}
