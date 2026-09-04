"use client";

import * as React from "react";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { StoreDisplayInfo } from "@/lib/store-settings";
import { ColorModeToggle } from "@/components/ui/ColorModeToggle";

// mockup 變體 B（精簡頁首列＋矮版封面圖）：見
// ai/artifacts/商店基本資料設定/mockups/customer-brand-variant-b.html。
// 缺項（無 Logo／簡介／封面圖／地址／電話）各自省略對應顯示區塊，不顯示空欄位或錯誤。

export function BrandHeaderSectionSkeleton() {
  return (
    <Box sx={{ mb: 3 }} aria-label="品牌資訊載入中">
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
        <Skeleton variant="circular" width={36} height={36} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Skeleton variant="text" width="50%" height={24} />
          <Skeleton variant="text" width="70%" height={16} />
        </Box>
      </Stack>
    </Box>
  );
}

// 封面圖沒有 MUI Avatar 內建的「載入失敗回退」機制，得自己用 onError 隱藏，
// 否則已刪除的 Storage 物件會顯示瀏覽器破圖圖示，違反「載入失敗需靜默降級」的驗收標準
// （architect TASK-032 審查發現）。
function CoverImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = React.useState(false);
  if (failed) return null;

  return (
    <Box
      component="img"
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      sx={{ width: "100%", height: 64, objectFit: "cover", borderRadius: 1, mt: 1.5, display: "block" }}
    />
  );
}

export function BrandHeaderSection({ display }: { display: StoreDisplayInfo }) {
  return (
    <Box component="header" sx={{ mb: 3 }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
        <Avatar
          src={display.logoUrl ?? undefined}
          slotProps={{ img: { referrerPolicy: "no-referrer" } }}
          sx={{ width: 36, height: 36, bgcolor: "primary.light", color: "primary.dark", fontSize: 14 }}
        >
          {[...display.name][0]}
        </Avatar>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography
            component="h1"
            variant="h6"
            sx={(theme) => ({ fontFamily: theme.typography.h1.fontFamily, fontWeight: 700, lineHeight: 1.2 })}
          >
            {display.name}
          </Typography>
          {display.description && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              {display.description}
            </Typography>
          )}
        </Box>
        <ColorModeToggle />
      </Stack>

      {display.coverImageUrl && <CoverImage src={display.coverImageUrl} alt={`${display.name} 封面圖`} />}

      {(display.address || display.phone) && (
        <Stack direction="row" spacing={2} sx={{ mt: 1.5, flexWrap: "wrap" }}>
          {display.address && (
            <Typography variant="caption" color="text.secondary">
              📍 {display.address}
            </Typography>
          )}
          {display.phone && (
            <Typography variant="caption" color="text.secondary">
              ☎ {display.phone}
            </Typography>
          )}
        </Stack>
      )}
    </Box>
  );
}
