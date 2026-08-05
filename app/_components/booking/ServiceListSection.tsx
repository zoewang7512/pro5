"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import Stack from "@mui/material/Stack";
import Skeleton from "@mui/material/Skeleton";
import Alert from "@mui/material/Alert";
import Typography from "@mui/material/Typography";
import type { Service } from "@/lib/booking/types";
import { SectionHeader, SummaryLine, formatPrice } from "./SectionChrome";

export type ServiceListSectionProps = {
  status: "loading" | "loaded" | "error";
  services: Service[];
  selectedService: Service | null;
  collapsed: boolean;
  onSelect: (service: Service) => void;
  onEdit: () => void;
};

export function ServiceListSection({
  status,
  services,
  selectedService,
  collapsed,
  onSelect,
  onEdit,
}: ServiceListSectionProps) {
  if (collapsed && selectedService) {
    return (
      <Box component="section" sx={{ mb: 3 }}>
        <SectionHeader done label="服務" onEdit={onEdit} />
        <SummaryLine
          primary={`${selectedService.name} · ${selectedService.duration_minutes} 分鐘`}
          secondary={formatPrice(selectedService.price)}
        />
      </Box>
    );
  }

  return (
    <Box component="section" sx={{ mb: 3 }}>
      <SectionHeader step={1} label="選擇服務" />

      {status === "loading" && (
        <Stack spacing={1.5} aria-label="服務項目載入中">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} variant="rounded" height={72} sx={{ borderRadius: 1.5 }} />
          ))}
        </Stack>
      )}

      {status === "error" && <Alert severity="error">無法載入服務項目，請重新整理頁面再試一次。</Alert>}

      {status === "loaded" && services.length === 0 && (
        <Alert severity="info">目前尚無可預約的服務項目，請稍後再回來看看。</Alert>
      )}

      {status === "loaded" && services.length > 0 && (
        <Stack spacing={1.5}>
          {services.map((service) => {
            const selected = service.id === selectedService?.id;
            return (
              <Card
                key={service.id}
                variant="outlined"
                sx={{
                  borderColor: selected ? "primary.main" : "divider",
                  borderWidth: selected ? 2 : 1,
                }}
              >
                <CardActionArea onClick={() => onSelect(service)} sx={{ px: 2, py: 1.5 }}>
                  <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center" }}>
                    <Box>
                      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                        {service.name}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {service.duration_minutes} 分鐘
                      </Typography>
                    </Box>
                    <Typography variant="subtitle1">{formatPrice(service.price)}</Typography>
                  </Stack>
                </CardActionArea>
              </Card>
            );
          })}
        </Stack>
      )}
    </Box>
  );
}
