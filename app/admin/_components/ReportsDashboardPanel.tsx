"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { TrendBarChart, type TrendBarBucket } from "@/components/ui/TrendBarChart";
import type { ReportPeriod, TrendBucket } from "@/lib/admin/reports";
import { WEEKDAY_LABELS, getWeekday } from "@/lib/admin/week-range";
import {
  RANKING_EMPTY_TEXT,
  ReportsEmptyState,
  ReportsErrorState,
  ReportsPanelHeading,
  ReportsSkeleton,
  accentText,
  formatCount,
  formatMoney,
  panelSx,
  type ReportsPanelProps,
} from "./ReportsStates";

// 儀表板頁籤（mockup 變體 B）：營收主角摘要列 → 預約量圖與營收圖並排 → 排行。
// 純展示：數字全部來自 props（summarize／buildTrend 的結果），這裡只做版面與圖表資料的格式轉換。

// y 軸上限（對應長條區頂端）：取 ≥ 最大值的最小「好看」數，且一半、全部都是整數刻度（頂／中／底三個刻度）。
// 候選＝{2,4,6,8,10,12,16,20,24,30,40,50,60,80,100}×10^k。minMax 避免全零時刻度擠成 0。
const NICE_BASES = [2, 4, 6, 8, 10, 12, 16, 20, 24, 30, 40, 50, 60, 80, 100];

export function niceMax(peak: number, minMax: number): number {
  const target = Math.max(peak, minMax);
  for (let scale = 1; ; scale *= 10) {
    for (const base of NICE_BASES) {
      if (base * scale >= target) return base * scale;
    }
  }
}

// 營收刻度：12000 → "12k"，500 → "500"（金額固定整數刻度）。
export function formatMoneyTick(value: number): string {
  if (value >= 1000) return `${Number((value / 1000).toFixed(1))}k`;
  return String(value);
}

type ChartMetric = "count" | "money";

const MIN_MAX: Record<ChartMetric, number> = { count: 4, money: 1000 };

function dayOfMonth(date: string): number {
  return Number(date.slice(8, 10));
}

// x 軸標籤：月＝日期數字（只標 1 與每 5 日；今天一定標，並讓緊鄰今天的兩側不標，避免擠在一起）、
// 週＝「一 10/19」、日＝「10:00」。
function xAxisLabel(period: ReportPeriod, bucket: TrendBucket): string {
  if (period.granularity === "month") return String(dayOfMonth(bucket.key));
  if (period.granularity === "week") {
    const [, month, day] = bucket.key.split("-").map(Number);
    return `${WEEKDAY_LABELS[getWeekday(bucket.key)]} ${month}/${day}`;
  }
  return bucket.label;
}

function showXAxisLabel(period: ReportPeriod, index: number, bucket: TrendBucket, todayIndex: number): boolean {
  if (period.granularity !== "month") return true;
  if (index === todayIndex) return true;
  if (todayIndex >= 0 && Math.abs(index - todayIndex) <= 1) return false;
  const day = dayOfMonth(bucket.key);
  return day === 1 || day % 5 === 0;
}

// 兩張圖共用同一組 tooltip／aria-label（日期、預約量（完成／待完成）、營收、預估營收），數字與表格一致。
function describeBucket(bucket: TrendBucket): { tooltip: string[]; ariaLabel: string } {
  const tooltip = [
    bucket.label,
    `預約量 ${formatCount(bucket.booked)}（完成 ${bucket.completed} ・ 待完成 ${bucket.pending}）`,
    `營收 ${formatMoney(bucket.revenue)}`,
    `預估營收 ${formatMoney(bucket.estimated)}`,
  ];
  return { tooltip, ariaLabel: tooltip.join("，") };
}

export function buildChartBuckets(
  period: ReportPeriod,
  trend: TrendBucket[],
  today: string,
  metric: ChartMetric,
): TrendBarBucket[] {
  const todayIndex = period.granularity === "day" ? -1 : trend.findIndex((bucket) => bucket.key === today);
  return trend.map((bucket, index) => ({
    key: bucket.key,
    label: xAxisLabel(period, bucket),
    showLabel: showXAxisLabel(period, index, bucket, todayIndex),
    today: index === todayIndex,
    segments:
      metric === "count"
        ? [
            { value: bucket.completed, kind: "solid" },
            { value: bucket.pending, kind: "striped" },
          ]
        : [
            { value: bucket.revenue, kind: "solid" },
            { value: bucket.estimated, kind: "striped" },
          ],
    ...describeBucket(bucket),
  }));
}

function chartMax(trend: TrendBucket[], metric: ChartMetric): number {
  const peak = Math.max(
    0,
    ...trend.map((bucket) => (metric === "count" ? bucket.completed + bucket.pending : bucket.revenue + bucket.estimated)),
  );
  return niceMax(peak, MIN_MAX[metric]);
}

function SummaryItem({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Box sx={{ fontSize: 13, fontWeight: 500, color: "text.secondary" }}>{label}</Box>
      <Box sx={{ fontSize: 24, fontWeight: 600, lineHeight: 1.25, mt: 1, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
        {value}
      </Box>
      <Box sx={{ fontSize: 12, color: "text.secondary" }}>{sub}</Box>
    </Box>
  );
}

export function ReportsDashboardPanel(props: ReportsPanelProps) {
  if (props.status === "loading") return <ReportsSkeleton heights={[112, 300, 220]} />;
  if (props.status === "empty") return <ReportsEmptyState filtered={props.filtered} />;
  if (props.status === "error") return <ReportsErrorState onRetry={props.onRetry} />;

  const { period, today, totals, trend, ranking } = props;
  const unit = period.granularity === "day" ? "每小時" : "每日";
  const charts: { metric: ChartMetric; title: string; legend: { solid: string; striped: string } }[] = [
    { metric: "count", title: `預約量（${unit}）`, legend: { solid: "已完成", striped: "待完成" } },
    { metric: "money", title: `營收（${unit}）`, legend: { solid: "營收（已完成）", striped: "預估（待完成）" } },
  ];

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <Paper sx={{ ...panelSx, display: "flex", alignItems: "flex-end", flexWrap: "wrap", gap: "24px 40px" }}>
        <Box sx={{ minWidth: 0 }}>
          <Box sx={{ fontSize: 13, fontWeight: 500, color: "text.secondary" }}>{`營收（已完成 ${totals.completed} 筆）`}</Box>
          <Box
            data-testid="revenue-main"
            sx={(theme) => ({
              fontSize: 36,
              fontWeight: 700,
              lineHeight: 1.25,
              mt: 1,
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
              ...accentText(theme),
            })}
          >
            {formatMoney(totals.revenue)}
          </Box>
        </Box>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(3, auto)",
            justifyContent: "start",
            gap: "16px 40px",
            flex: "1 1 360px",
            minWidth: 0,
          }}
        >
          <SummaryItem label="預約量" value={formatCount(totals.booked)} sub={`完成 ${totals.completed} ・ 待完成 ${totals.pending}`} />
          <SummaryItem label="預估營收" value={formatMoney(totals.estimated)} sub="待完成，未計入營收" />
          <SummaryItem label="已取消" value={formatCount(totals.cancelled)} sub="不計入預約量" />
        </Box>
      </Paper>

      {/* 寬視窗並排；容器不夠兩張圖各 320px 時自動上下堆疊。 */}
      <Box data-testid="chart-row" sx={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {charts.map((chart) => (
          <Paper key={chart.metric} sx={{ ...panelSx, flex: "1 1 320px", minWidth: 0 }}>
            <ReportsPanelHeading>{chart.title}</ReportsPanelHeading>
            <TrendBarChart
              ariaLabel={`${chart.title}，${period.label}`}
              buckets={buildChartBuckets(period, trend, today, chart.metric)}
              max={chartMax(trend, chart.metric)}
              formatTick={chart.metric === "money" ? formatMoneyTick : undefined}
              legend={chart.legend}
            />
          </Paper>
        ))}
      </Box>

      <Paper sx={panelSx}>
        <ReportsPanelHeading>熱門服務排行</ReportsPanelHeading>
        {totals.booked === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {RANKING_EMPTY_TEXT}
          </Typography>
        ) : (
          ranking
        )}
      </Paper>
    </Box>
  );
}
