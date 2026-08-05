"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Link from "@mui/material/Link";

// 兩個區塊（服務列表／選時段）共用的區塊標題與「已完成收合為摘要列」樣式，
// 比照 customer-flow-variant-b.html mockup 的互動語言。

export function SectionHeader({
  step,
  label,
  done,
  onEdit,
}: {
  step?: number;
  label: string;
  done?: boolean;
  onEdit?: () => void;
}) {
  return (
    <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center", mb: 1.5 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        {done ? (
          <Typography variant="overline" color="success.main" sx={{ fontWeight: 700 }}>
            ✓
          </Typography>
        ) : (
          <Box
            sx={{
              width: 20,
              height: 20,
              borderRadius: "50%",
              bgcolor: "primary.main",
              color: "primary.contrastText",
              fontSize: 12,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {step}
          </Box>
        )}
        <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700 }}>
          {label}
        </Typography>
      </Stack>
      {done && onEdit && (
        <Link component="button" type="button" variant="body2" onClick={onEdit} sx={{ fontWeight: 600 }}>
          修改
        </Link>
      )}
    </Stack>
  );
}

export function SummaryLine({ primary, secondary }: { primary: string; secondary?: string }) {
  return (
    <Paper variant="outlined" sx={{ px: 2, py: 1.5, display: "flex", justifyContent: "space-between", borderRadius: 1.5 }}>
      <Typography variant="body2">{primary}</Typography>
      {secondary && (
        <Typography variant="body2" color="text.secondary">
          {secondary}
        </Typography>
      )}
    </Paper>
  );
}

export function formatPrice(price: number): string {
  return `NT$${price.toLocaleString("zh-Hant-TW")}`;
}
