"use client";

import * as React from "react";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { AppointmentConfirmation } from "@/lib/booking/types";
import { designerInitial } from "@/lib/designers";

export type SuccessDesigner = { name: string; avatarUrl: string | null };

// designer 一律來自 create_appointment 回傳的資料庫值（不是前端的選取值），頭像由呼叫端從已載入名單查出
// （avatarUrl 已過白名單，查不到就是 null，退回首字頭像）；回傳沒有名字時傳 null，不顯示設計師列。
export function SuccessSection({
  confirmation,
  designer,
  requestedAny,
}: {
  confirmation: AppointmentConfirmation;
  designer: SuccessDesigner | null;
  requestedAny: boolean;
}) {
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
        {designer && (
          <SummaryRow
            label="設計師"
            value={
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Avatar
                  src={designer.avatarUrl ?? undefined}
                  alt=""
                  slotProps={{ img: { referrerPolicy: "no-referrer" } }}
                  sx={{ width: 24, height: 24, fontSize: 12, bgcolor: "primary.main", color: "primary.contrastText" }}
                >
                  {designerInitial(designer.name)}
                </Avatar>
                <Typography variant="body2">{designer.name}</Typography>
              </Stack>
            }
          />
        )}
        <SummaryRow label="時段" value={formatSlot(confirmation.start_at)} />
        <SummaryRow label="姓名" value={confirmation.customer_name} />
        <SummaryRow label="電話" value={confirmation.customer_phone} last />
      </Paper>
      {designer && requestedAny && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          你選擇了「不指定設計師」，系統已為你安排{designer.name}。
        </Typography>
      )}
    </Box>
  );
}

function SummaryRow({ label, value, last }: { label: string; value: React.ReactNode; last?: boolean }) {
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
      {typeof value === "string" ? <Typography variant="body2">{value}</Typography> : value}
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
