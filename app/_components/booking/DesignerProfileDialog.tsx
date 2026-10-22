"use client";

import * as React from "react";
import AppBar from "@mui/material/AppBar";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Container from "@mui/material/Container";
import Dialog from "@mui/material/Dialog";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import { PortfolioGrid } from "@/components/ui/PortfolioGrid";
import { designerInitial, instagramProfileUrl } from "@/lib/designers";
import type { PublicDesigner } from "@/lib/booking/types";

// 全頁仿 IG 個人頁（mockup Variant B 畫面 3、5）。純展示元件：開關與瀏覽器歷史紀錄由呼叫端
// （DesignerPickerSection）管理。`open` 與 `designer` 分開：關閉時呼叫端先把 open 設成 false，等淡出動畫結束
// （onExited）才清掉 designer，淡出期間內容不會變空白。名字、簡介、專長、帳號一律當純文字節點渲染。

export type DesignerProfileDialogProps = {
  open: boolean;
  designer: PublicDesigner | null;
  // 返回鍵、Esc、「選擇○○」之外沒有其他關閉入口；三者都由呼叫端走同一條關閉流程。
  onClose: () => void;
  onSelect: (designer: PublicDesigner) => void;
  onExited?: () => void;
};

const visuallyHidden = {
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
} as const;

export function DesignerProfileDialog({ open, designer, onClose, onSelect, onExited }: DesignerProfileDialogProps) {
  const titleId = React.useId();

  return (
    <Dialog
      fullScreen
      open={open}
      onClose={onClose}
      aria-labelledby={titleId}
      slotProps={{ transition: { onExited } }}
    >
      {designer && <ProfileContent designer={designer} titleId={titleId} onClose={onClose} onSelect={onSelect} />}
    </Dialog>
  );
}

function ProfileContent({
  designer,
  titleId,
  onClose,
  onSelect,
}: {
  designer: PublicDesigner;
  titleId: string;
  onClose: () => void;
  onSelect: (designer: PublicDesigner) => void;
}) {
  // href 一律取渲染當下 instagramProfileUrl 的回傳值（固定網域、帳號格式驗證）；null 就不畫按鈕。
  const instagramUrl = instagramProfileUrl(designer.instagram_handle);
  const appBarTitle = instagramUrl && designer.instagram_handle ? designer.instagram_handle : designer.name;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, bgcolor: "background.paper" }}>
      <AppBar
        position="static"
        color="inherit"
        elevation={0}
        sx={{ bgcolor: "background.paper", borderBottom: 1, borderColor: "divider", borderRadius: 0 }}
      >
        <Container maxWidth="sm" disableGutters>
          <Toolbar disableGutters sx={{ px: 1, gap: 1, minHeight: 52 }}>
            <IconButton aria-label="關閉個人頁" onClick={onClose} sx={{ fontSize: 24, width: 40, height: 40 }}>
              ‹
            </IconButton>
            <Typography variant="subtitle1" noWrap sx={{ fontWeight: 700, minWidth: 0 }}>
              <bdi>{appBarTitle}</bdi>
            </Typography>
          </Toolbar>
        </Container>
      </AppBar>

      <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain" }}>
        <Container maxWidth="sm" disableGutters>
          <Box sx={{ px: 2, pt: 2, overflow: "hidden" }}>
            <Stack direction="row" sx={{ alignItems: "center", gap: 3 }}>
              <Avatar
                src={designer.avatar_url ?? undefined}
                alt=""
                slotProps={{ img: { referrerPolicy: "no-referrer" } }}
                sx={{ width: 84, height: 84, fontSize: 30, bgcolor: "primary.main", color: "primary.contrastText", flex: "0 0 auto" }}
              >
                {designerInitial(designer.name)}
              </Avatar>
              <Stack direction="row" sx={{ flex: 1, justifyContent: "space-around", textAlign: "center" }}>
                <Stat value={designer.portfolio.length} label="作品" />
                <Stat value={designer.specialties.length} label="專長" />
              </Stack>
            </Stack>

            <Typography id={titleId} component="h2" variant="subtitle2" sx={{ mt: 1.5, fontWeight: 700, overflowWrap: "anywhere" }}>
              <bdi>{designer.name}</bdi>
            </Typography>

            {designer.bio && (
              <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: "pre-line", overflowWrap: "anywhere" }}>
                {designer.bio}
              </Typography>
            )}

            {designer.specialties.length > 0 && (
              <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.5, mt: 1 }}>
                {designer.specialties.map((tag) => (
                  <Chip key={tag} label={tag} size="small" variant="outlined" sx={{ maxWidth: "100%" }} />
                ))}
              </Stack>
            )}

            {instagramUrl && (
              <Button
                component="a"
                href={instagramUrl}
                target="_blank"
                rel="noopener noreferrer"
                variant="outlined"
                color="inherit"
                fullWidth
                sx={{ mt: 1.5 }}
              >
                前往 Instagram ↗<Box component="span" sx={visuallyHidden}>（另開新分頁）</Box>
              </Button>
            )}
          </Box>

          <Box sx={{ mt: 2, borderTop: 1, borderColor: "divider" }}>
            <PortfolioGrid
              key={designer.id}
              ownerName={designer.name}
              images={designer.portfolio.map((image) => ({ id: image.id, src: image.image_url }))}
            />
          </Box>
        </Container>
      </Box>

      <Box sx={{ borderTop: 1, borderColor: "divider", bgcolor: "background.paper" }}>
        <Container maxWidth="sm" disableGutters sx={{ px: 2, pt: 1.5, pb: "calc(12px + env(safe-area-inset-bottom, 0px))" }}>
          <Button variant="contained" size="large" fullWidth onClick={() => onSelect(designer)}>
            選擇<bdi>{designer.name}</bdi>
          </Button>
        </Container>
      </Box>
    </Box>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <Box>
      <Typography component="span" sx={{ display: "block", fontSize: 16, fontWeight: 700 }}>
        {value}
      </Typography>
      <Typography component="span" variant="caption" color="text.secondary">
        {label}
      </Typography>
    </Box>
  );
}
