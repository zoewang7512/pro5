"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableFooter from "@mui/material/TableFooter";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import type { ReportTotals, TrendBucket } from "@/lib/admin/reports";
import {
  RANKING_EMPTY_TEXT,
  ReportsEmptyState,
  ReportsErrorState,
  ReportsPanelHeading,
  ReportsSkeleton,
  ReportsTooLargeState,
  accentText,
  formatCount,
  formatMoney,
  panelSx,
  todayTint,
  type ReportsPanelProps,
} from "./ReportsStates";

// 報表頁籤（mockup 變體 C）：彙總列（六個數字）→ 熱門服務排行 → 逐日（日粒度為逐小時）明細表。
// 明細表的「合計」直接顯示 summarize 的結果（props.totals），不是在這裡把各列加總——全頁只有一處口徑。

const ZERO_DASH = "—";

// 零值顯示「—」，讓有數字的格子更突出；合計列同一規則。
function cell(count: number, format: (n: number) => string = String): string {
  return count === 0 ? ZERO_DASH : format(count);
}

function SummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Box sx={{ fontSize: 12, fontWeight: 500, color: "text.secondary" }}>{label}</Box>
      <Box sx={{ fontSize: 18, fontWeight: 700, lineHeight: 1.3, mt: 1, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
        {value}
      </Box>
    </Box>
  );
}

const HEAD_CELL_SX = { fontSize: 12, fontWeight: 600, color: "text.secondary", whiteSpace: "nowrap", bgcolor: "background.paper" };
const NUMBER_CELL_SX = { textAlign: "right", fontVariantNumeric: "tabular-nums" } as const;

type DetailRow = { bucket: TrendBucket; isToday: boolean };

function DetailTable({ granularity, rows, totals }: { granularity: "day" | "week" | "month"; rows: DetailRow[]; totals: ReportTotals }) {
  const heading = granularity === "day" ? "逐小時明細" : "逐日明細";
  return (
    <Paper sx={{ overflow: "hidden" }}>
      <Box sx={{ px: 6, pt: 6, pb: 2 }}>
        <ReportsPanelHeading flush hint="表頭固定，內容可捲動">{heading}</ReportsPanelHeading>
      </Box>
      <TableContainer sx={{ maxHeight: 440 }}>
        <Table stickyHeader size="small" aria-label={heading} sx={{ minWidth: 480 }}>
          <TableHead>
            <TableRow>
              <TableCell sx={HEAD_CELL_SX}>{granularity === "day" ? "時段" : "日期"}</TableCell>
              <TableCell sx={{ ...HEAD_CELL_SX, ...NUMBER_CELL_SX }}>預約量</TableCell>
              <TableCell sx={{ ...HEAD_CELL_SX, ...NUMBER_CELL_SX }}>已完成</TableCell>
              <TableCell sx={{ ...HEAD_CELL_SX, ...NUMBER_CELL_SX }}>待完成</TableCell>
              <TableCell sx={{ ...HEAD_CELL_SX, ...NUMBER_CELL_SX }}>已取消</TableCell>
              <TableCell sx={{ ...HEAD_CELL_SX, ...NUMBER_CELL_SX }}>營收</TableCell>
              <TableCell sx={{ ...HEAD_CELL_SX, ...NUMBER_CELL_SX }}>預估營收</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map(({ bucket, isToday }) => (
              <TableRow
                key={bucket.key}
                data-today={isToday ? "true" : undefined}
                sx={isToday ? { "& td": { bgcolor: (theme) => todayTint(theme) } } : undefined}
              >
                <TableCell component="th" scope="row" sx={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                  {bucket.label}
                  {isToday && (
                    <Box
                      component="span"
                      sx={(theme) => ({
                        ml: 2,
                        px: 2,
                        borderRadius: "999px",
                        fontSize: 11,
                        fontWeight: 500,
                        bgcolor: "action.selected",
                        ...accentText(theme),
                      })}
                    >
                      今天
                    </Box>
                  )}
                </TableCell>
                <TableCell sx={{ ...NUMBER_CELL_SX, color: bucket.booked === 0 ? "text.disabled" : undefined }}>{cell(bucket.booked)}</TableCell>
                <TableCell sx={{ ...NUMBER_CELL_SX, color: bucket.completed === 0 ? "text.disabled" : undefined }}>{cell(bucket.completed)}</TableCell>
                <TableCell sx={{ ...NUMBER_CELL_SX, color: bucket.pending === 0 ? "text.disabled" : undefined }}>{cell(bucket.pending)}</TableCell>
                <TableCell sx={{ ...NUMBER_CELL_SX, color: bucket.cancelled === 0 ? "text.disabled" : undefined }}>{cell(bucket.cancelled)}</TableCell>
                <TableCell sx={{ ...NUMBER_CELL_SX, color: bucket.revenue === 0 ? "text.disabled" : undefined }}>{cell(bucket.revenue, formatMoney)}</TableCell>
                <TableCell sx={{ ...NUMBER_CELL_SX, color: bucket.estimated === 0 ? "text.disabled" : undefined }}>{cell(bucket.estimated, formatMoney)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            {/* 合計列固定在底部：內容區捲動時永遠看得到。 */}
            <TableRow
              sx={{
                "& td, & th": {
                  position: "sticky",
                  bottom: 0,
                  fontWeight: 700,
                  fontSize: 14,
                  color: "text.primary",
                  bgcolor: "background.default",
                  borderTop: 1,
                  borderColor: "divider",
                },
              }}
            >
              <TableCell component="th" scope="row">
                合計
              </TableCell>
              <TableCell sx={NUMBER_CELL_SX}>{cell(totals.booked)}</TableCell>
              <TableCell sx={NUMBER_CELL_SX}>{cell(totals.completed)}</TableCell>
              <TableCell sx={NUMBER_CELL_SX}>{cell(totals.pending)}</TableCell>
              <TableCell sx={NUMBER_CELL_SX}>{cell(totals.cancelled)}</TableCell>
              <TableCell sx={NUMBER_CELL_SX}>{cell(totals.revenue, formatMoney)}</TableCell>
              <TableCell sx={NUMBER_CELL_SX}>{cell(totals.estimated, formatMoney)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </TableContainer>
    </Paper>
  );
}

export function ReportsTablePanel(props: ReportsPanelProps) {
  if (props.status === "loading") return <ReportsSkeleton heights={[80, 220, 440]} />;
  if (props.status === "empty") return <ReportsEmptyState filtered={props.filtered} />;
  if (props.status === "error") return <ReportsErrorState onRetry={props.onRetry} />;
  if (props.status === "too_large") return <ReportsTooLargeState />;

  const { period, today, totals, trend, ranking } = props;
  // 日粒度的列是小時，沒有「今天」可標；其餘粒度以日期比對。
  const rows: DetailRow[] = trend.map((bucket) => ({
    bucket,
    isToday: period.granularity !== "day" && bucket.key === today,
  }));

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <Paper
        data-testid="summary-row"
        sx={{ ...panelSx, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "16px 24px" }}
      >
        <SummaryCell label="預約量" value={formatCount(totals.booked)} />
        <SummaryCell label="已完成" value={formatCount(totals.completed)} />
        <SummaryCell label="待完成" value={formatCount(totals.pending)} />
        <SummaryCell label="已取消" value={formatCount(totals.cancelled)} />
        <SummaryCell label="營收（已完成）" value={formatMoney(totals.revenue)} />
        <SummaryCell label="預估營收（待完成）" value={formatMoney(totals.estimated)} />
      </Paper>

      <Paper sx={{ overflow: "hidden" }}>
        <Box sx={{ px: 6, pt: 6, pb: 2 }}>
          <ReportsPanelHeading flush hint="占比＝該服務預約量 ÷ 全部預約量">熱門服務排行</ReportsPanelHeading>
        </Box>
        {totals.booked === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ px: 6, pb: 6 }}>
            {RANKING_EMPTY_TEXT}
          </Typography>
        ) : (
          ranking
        )}
      </Paper>

      <DetailTable granularity={period.granularity} rows={rows} totals={totals} />
    </Box>
  );
}
