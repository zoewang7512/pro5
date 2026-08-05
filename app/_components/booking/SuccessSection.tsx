"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { AppointmentConfirmation } from "@/lib/booking/types";

export function SuccessSection({ confirmation }: { confirmation: AppointmentConfirmation }) {
  return (
    <Box sx={{ textAlign: "center" }}>
      <Box
        sx={{
          width: 56,
          height: 56,
          borderRadius: "50%",
          bgcolor: "success.main",
          color: "success.contrastText",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 28,
          mx: "auto",
          mb: 2,
        }}
      >
        ✓
      </Box>
      <Typography variant="h5" component="h1" sx={{ mb: 0.5 }}>
        預約成功！
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        已為您保留時段
      </Typography>
      <Paper variant="outlined" sx={{ p: 2.5, textAlign: "left", borderRadius: 1.5 }}>
        <SummaryRow label="服務" value={confirmation.service_name} />
        <SummaryRow label="時段" value={formatSlot(confirmation.start_at)} />
        <SummaryRow label="姓名" value={confirmation.customer_name} />
        <SummaryRow label="電話" value={confirmation.customer_phone} last />
      </Paper>
    </Box>
  );
}

function SummaryRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <Stack
      direction="row"
      sx={{
        justifyContent: "space-between",
        py: 1,
        borderBottom: last ? "none" : "1px solid",
        borderColor: "divider",
      }}
    >
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2">{value}</Typography>
    </Stack>
  );
}

function formatSlot(iso: string): string {
  const date = new Date(iso);
  const datePart = date.toLocaleDateString("zh-Hant-TW", {
    timeZone: "Asia/Taipei",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  });
  const timePart = date.toLocaleTimeString("zh-Hant-TW", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${datePart} ${timePart}`;
}
