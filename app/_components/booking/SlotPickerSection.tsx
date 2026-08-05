"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Chip from "@mui/material/Chip";
import Button from "@mui/material/Button";
import Skeleton from "@mui/material/Skeleton";
import Alert from "@mui/material/Alert";
import type { AvailableSlot } from "@/lib/booking/types";
import type { DateOption } from "@/lib/booking/date-range";
import type { SlotCell } from "@/lib/booking/slot-grid";
import { SectionHeader, SummaryLine } from "./SectionChrome";

export type SlotPickerSectionProps = {
  dateOptions: DateOption[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
  status: "loading" | "loaded" | "error";
  cells: SlotCell[];
  selectedSlot: AvailableSlot | null;
  onSelectSlot: (cell: SlotCell) => void;
  collapsed: boolean;
  onEdit: () => void;
};

export function SlotPickerSection({
  dateOptions,
  selectedDate,
  onSelectDate,
  status,
  cells,
  selectedSlot,
  onSelectSlot,
  collapsed,
  onEdit,
}: SlotPickerSectionProps) {
  const selectedDateOption = dateOptions.find((d) => d.date === selectedDate);

  if (collapsed && selectedSlot && selectedDateOption) {
    return (
      <Box component="section" sx={{ mb: 3 }}>
        <SectionHeader done label="時段" onEdit={onEdit} />
        <SummaryLine
          primary={`週${selectedDateOption.weekdayLabel} ${formatMonthDay(selectedDateOption.date)}`}
          secondary={formatTaipeiClock(selectedSlot.start_at)}
        />
      </Box>
    );
  }

  const hasAvailable = cells.some((cell) => !cell.disabled);

  return (
    <Box component="section" sx={{ mb: 3 }}>
      <SectionHeader step={2} label="選擇時段" />

      <Stack direction="row" spacing={1} sx={{ overflowX: "auto", pb: 1, mb: 2 }}>
        {dateOptions.map((option) => (
          <Chip
            key={option.date}
            label={`週${option.weekdayLabel} ${option.day}`}
            clickable
            color={option.date === selectedDate ? "primary" : "default"}
            variant={option.date === selectedDate ? "filled" : "outlined"}
            onClick={() => onSelectDate(option.date)}
            sx={{ flex: "0 0 auto" }}
          />
        ))}
      </Stack>

      {status === "loading" && (
        <Box aria-label="時段載入中" sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1 }}>
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} variant="rounded" height={40} sx={{ borderRadius: 1 }} />
          ))}
        </Box>
      )}

      {status === "error" && <Alert severity="error">無法載入可預約時段，請重新整理頁面再試一次。</Alert>}

      {status === "loaded" && !hasAvailable && (
        <Alert severity="info">
          {cells.length === 0 ? "當日公休，請選擇其他日期。" : "當日時段皆已被預約，請選擇其他日期。"}
        </Alert>
      )}

      {status === "loaded" && hasAvailable && (
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1 }}>
          {cells.map((cell) => {
            const selected = selectedSlot?.start_at === cell.startAt;
            return (
              <Button
                key={cell.startAt}
                variant={selected ? "contained" : "outlined"}
                disabled={cell.disabled}
                onClick={() => onSelectSlot(cell)}
              >
                {cell.timeLabel}
              </Button>
            );
          })}
        </Box>
      )}
    </Box>
  );
}

function formatMonthDay(date: string): string {
  return date.slice(5).replace("-", "/");
}

function formatTaipeiClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("zh-Hant-TW", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Taipei",
  });
}
