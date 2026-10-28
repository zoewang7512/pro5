"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import type { ReportGranularity, ReportPeriod } from "@/lib/admin/reports";

// 儀表板與報表兩個頁籤共用的工具列：日／週／月、上一期／下一期、期間標籤、回到本期，右側 actions 插槽
// （匯出按鈕由 TASK-093 放入，只在報表頁籤）。純展示、受控：期間與粒度由容器持有，這裡只回報操作。

const GRANULARITY_LABELS: Record<ReportGranularity, string> = { day: "日", week: "週", month: "月" };
const UNIT_LABELS: Record<ReportGranularity, string> = { day: "天", week: "週", month: "個月" };

export type ReportsToolbarProps = {
  period: ReportPeriod;
  onGranularityChange: (granularity: ReportGranularity) => void;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
  // 右側插槽（例如匯出按鈕）。
  actions?: React.ReactNode;
};

export function ReportsToolbar({ period, onGranularityChange, onPrevious, onNext, onToday, actions }: ReportsToolbarProps) {
  const unit = UNIT_LABELS[period.granularity];
  return (
    <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4 }}>
      <ToggleButtonGroup
        exclusive
        size="small"
        value={period.granularity}
        aria-label="統計單位"
        // 再點已選取的那一項會得到 null：忽略，單選不能取消。
        onChange={(_event, value: ReportGranularity | null) => value && onGranularityChange(value)}
      >
        {(Object.keys(GRANULARITY_LABELS) as ReportGranularity[]).map((value) => (
          <ToggleButton key={value} value={value} sx={{ px: 5, fontWeight: 500 }}>
            {GRANULARITY_LABELS[value]}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      <Box sx={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
        <Button
          variant="outlined"
          color="inherit"
          aria-label={`上一${unit}`}
          onClick={onPrevious}
          sx={{ minWidth: 36, width: 36, height: 36, p: 0, borderColor: "divider", color: "text.secondary" }}
        >
          ‹
        </Button>
        <Box
          // 期間切換後螢幕閱讀器會讀出新的期間。
          aria-live="polite"
          sx={{ minWidth: 160, textAlign: "center", fontSize: 16, fontWeight: 600, px: 2, fontVariantNumeric: "tabular-nums" }}
        >
          {period.label}
        </Box>
        <Button
          variant="outlined"
          color="inherit"
          aria-label={`下一${unit}`}
          onClick={onNext}
          sx={{ minWidth: 36, width: 36, height: 36, p: 0, borderColor: "divider", color: "text.secondary" }}
        >
          ›
        </Button>
        <Button
          variant="outlined"
          color="inherit"
          size="small"
          disabled={period.isCurrent}
          onClick={onToday}
          sx={{ borderColor: "divider", fontWeight: 600 }}
        >
          回到本期
        </Button>
      </Box>

      {actions && <Box sx={{ ml: "auto", display: "inline-flex", alignItems: "center", gap: 2 }}>{actions}</Box>}
    </Box>
  );
}
