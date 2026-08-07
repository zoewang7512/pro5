"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import { WEEKDAY_LABELS } from "@/lib/admin/week-range";
import { buildMonthDays, formatMonthLabel, getNextMonth, getPreviousMonth } from "@/lib/admin/month-range";

// MUI 沒有現成的月曆格狀選取元件，比照 mockup 變體 B（business-hours-closures-variant-b.html
// 的 .cal-grid／.cal-day）與既有 WeekCalendar.tsx 的視覺模式（今天 outline、Box grid 拼版面）
// 客製而成。純展示元件：目前年月、已標記日期皆由 props 控制，元件本身不呼叫 Supabase、
// 不管理年月 state（controlled component，比照 AdminDashboard 的 weekStart 由頁面層控制）。

export type MonthPickerProps = {
  year: number;
  month: number; // 1-12
  todayDate: string; // "YYYY-MM-DD"
  markedDates: Set<string>;
  onDayClick: (date: string) => void;
  onMonthChange: (year: number, month: number) => void;
};

export function MonthPicker({ year, month, todayDate, markedDates, onDayClick, onMonthChange }: MonthPickerProps) {
  const days = buildMonthDays(year, month);
  const leadingBlanks = days[0].weekday;

  const handlePrevious = () => {
    const { year: y, month: m } = getPreviousMonth(year, month);
    onMonthChange(y, m);
  };

  const handleNext = () => {
    const { year: y, month: m } = getNextMonth(year, month);
    onMonthChange(y, m);
  };

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1.25 }}>
        <IconButton
          size="small"
          onClick={handlePrevious}
          aria-label="上個月"
          sx={{ width: 26, height: 26, border: "1px solid", borderColor: "grey.300", fontSize: 12 }}
        >
          ‹
        </IconButton>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {formatMonthLabel(year, month)}
        </Typography>
        <IconButton
          size="small"
          onClick={handleNext}
          aria-label="下個月"
          sx={{ width: 26, height: 26, border: "1px solid", borderColor: "grey.300", fontSize: 12 }}
        >
          ›
        </IconButton>
      </Box>

      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 1 }}>
        {WEEKDAY_LABELS.map((label) => (
          <Typography
            key={label}
            variant="caption"
            sx={{ textAlign: "center", fontWeight: 600, color: "text.secondary", pb: 0.5 }}
          >
            {label}
          </Typography>
        ))}

        {Array.from({ length: leadingBlanks }, (_, i) => (
          <Box key={`blank-${i}`} sx={{ height: 38 }} />
        ))}

        {days.map((day) => {
          const isToday = day.date === todayDate;
          const isMarked = markedDates.has(day.date);
          const isPast = day.date < todayDate;
          const isDisabled = isPast;

          const handleActivate = () => {
            if (!isDisabled) onDayClick(day.date);
          };

          return (
            <Box
              key={day.date}
              role="button"
              tabIndex={isDisabled ? -1 : 0}
              aria-disabled={isDisabled}
              aria-pressed={isMarked}
              onClick={isDisabled ? undefined : handleActivate}
              onKeyDown={
                isDisabled
                  ? undefined
                  : (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleActivate();
                      }
                    }
              }
              sx={{
                position: "relative",
                height: 38,
                borderRadius: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                fontWeight: isToday || isMarked ? 700 : 400,
                // 用 background.paper／text.disabled 而非 grey.100／grey.500：lib/theme/index.ts
                // 的暗色 colorScheme 目前沒有覆寫 grey 色階（design-system.md 已記錄的既知
                // 限制），grey.100／grey.500 在暗色模式下會 fallback 回 MUI 預設灰階，跟這個
                // 專案暗色模式的 text.primary（近白）配色不搭，數字幾乎融進背景、看起來過淺。
                // background.paper／text.disabled 兩個 slot 在 light／dark 都有明確定義，
                // 語意上也更正確（「過去日期」本來就是停用狀態，理應用 text.disabled）。
                bgcolor: isMarked ? "warning.light" : "background.paper",
                color: isPast ? "text.disabled" : isMarked ? "warning.main" : "text.primary",
                cursor: isDisabled ? "default" : "pointer",
                outline: isToday ? "2px solid" : "2px solid transparent",
                outlineColor: isToday ? "primary.main" : "transparent",
                outlineOffset: -2,
                "&:focus-visible": isDisabled
                  ? undefined
                  : { boxShadow: (theme) => `0 0 0 2px ${theme.palette.primary.main}` },
              }}
            >
              {day.day}
              {isMarked && (
                <Box
                  sx={{
                    position: "absolute",
                    bottom: 4,
                    width: 4,
                    height: 4,
                    borderRadius: "50%",
                    bgcolor: "warning.main",
                  }}
                />
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
