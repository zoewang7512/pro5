"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import Chip from "@mui/material/Chip";
import Skeleton from "@mui/material/Skeleton";
import Alert from "@mui/material/Alert";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { WeekDay } from "@/lib/admin/week-range";
import type { WeekAppointment } from "@/lib/admin/appointments";
import { STATUS_COLOR, STATUS_LABEL, formatTimeRange, toTaipeiDate } from "@/lib/admin/format";

// MUI 沒有現成的週曆格狀元件，比照 mockup 變體 B「展開事件卡」：7 欄日期格，
// 每格顯示完整資訊事件卡。事件卡只在有傳入 onEventClick 時才用 CardActionArea 包裹
// （TASK-015 接上開啟 Modal 的邏輯後才會是可點擊狀態）——本卡尚未接上時，
// 卡片維持純顯示，不要讓使用者看到可點擊回饋卻點了沒反應。

export type WeekCalendarProps = {
  weekDays: WeekDay[];
  todayDate: string;
  status: "loading" | "loaded" | "error";
  appointments: WeekAppointment[];
  closedWeekdays: Set<number>;
  closedDates: Set<string>;
  onEventClick?: (appointment: WeekAppointment) => void;
};

export function WeekCalendar({
  weekDays,
  todayDate,
  status,
  appointments,
  closedWeekdays,
  closedDates,
  onEventClick,
}: WeekCalendarProps) {
  const appointmentsByDate = React.useMemo(() => {
    const map = new Map<string, WeekAppointment[]>();
    for (const appointment of appointments) {
      const date = toTaipeiDate(appointment.start_at);
      const list = map.get(date) ?? [];
      list.push(appointment);
      map.set(date, list);
    }
    return map;
  }, [appointments]);

  if (status === "error") {
    return <Alert severity="error">無法載入本週預約，請重新整理頁面再試一次。</Alert>;
  }

  return (
    <Stack spacing={1.5} sx={{ flex: 1, minHeight: 0 }}>
      {status === "loaded" && appointments.length === 0 && <Alert severity="info">本週沒有預約</Alert>}

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: 1.5,
          flex: 1,
          minHeight: 0,
        }}
      >
      {weekDays.map((day) => {
        const isToday = day.date === todayDate;
        const isClosed = closedWeekdays.has(day.weekday) || closedDates.has(day.date);
        const dayAppointments = appointmentsByDate.get(day.date) ?? [];

        return (
          <Card
            key={day.date}
            variant="outlined"
            sx={{
              p: 1.25,
              minHeight: 260,
              display: "flex",
              flexDirection: "column",
              gap: 1,
              overflowY: "auto",
              bgcolor: isClosed ? "grey.200" : "background.paper",
              opacity: isClosed ? 0.6 : 1,
              outline: isToday ? "2px solid" : "2px solid transparent",
              outlineColor: isToday ? "primary.main" : "transparent",
            }}
          >
            <Typography variant="caption" sx={{ fontWeight: 700, color: "text.secondary" }}>
              {day.weekdayLabel} {day.month}/{day.day}
              {isClosed ? " · 公休" : ""}
            </Typography>

            {status === "loading" && <Skeleton variant="rounded" height={56} />}

            {status === "loaded" && dayAppointments.length === 0 && isClosed === false && (
              <Typography variant="caption" sx={{ color: "text.disabled" }}>
                —
              </Typography>
            )}

            {status === "loaded" &&
              dayAppointments.map((appointment) => {
                const eventContent = (
                  <Stack spacing={0.25}>
                    <Typography variant="caption" sx={{ fontWeight: 600, color: "text.secondary" }}>
                      {formatTimeRange(appointment.start_at, appointment.end_at)}
                    </Typography>
                    <Typography
                      variant="body2"
                      sx={{
                        fontWeight: 700,
                        textDecoration: appointment.status === "cancelled" ? "line-through" : "none",
                      }}
                    >
                      {appointment.customer_name}
                    </Typography>
                    <Typography variant="caption" sx={{ color: "text.secondary" }}>
                      {appointment.service_name}
                    </Typography>
                    <Chip
                      size="small"
                      label={STATUS_LABEL[appointment.status]}
                      color={STATUS_COLOR[appointment.status]}
                      sx={{ height: 20, fontSize: 11, alignSelf: "flex-start", mt: 0.5 }}
                    />
                  </Stack>
                );

                return (
                  <Card
                    key={appointment.id}
                    variant="outlined"
                    sx={{ opacity: appointment.status === "cancelled" ? 0.55 : 1 }}
                  >
                    {onEventClick ? (
                      <CardActionArea onClick={() => onEventClick(appointment)} sx={{ px: 1.25, py: 1 }}>
                        {eventContent}
                      </CardActionArea>
                    ) : (
                      <Box sx={{ px: 1.25, py: 1 }}>{eventContent}</Box>
                    )}
                  </Card>
                );
              })}
          </Card>
        );
      })}
      </Box>
    </Stack>
  );
}
