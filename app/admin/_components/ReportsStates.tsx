"use client";

import * as React from "react";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import type { Theme } from "@mui/material/styles";
import { formatPrice } from "@/lib/admin/format";
import { REPORT_ROW_LIMIT, type ReportPeriod, type ReportTotals, type TrendBucket } from "@/lib/admin/reports";

// 儀表板頁籤（ReportsDashboardPanel）與報表頁籤（ReportsTablePanel）共用的 props 約定與狀態畫面。
// 兩個面板只吃 props、不接觸 Supabase：資料由 TASK-092 的容器抓取、彙總（lib/admin/reports.ts）後傳入，
// 口徑只在 summarize 一處定義，面板不重新計算。

export type ReportsReadyProps = {
  status: "ready";
  period: ReportPeriod;
  // 台北今天 YYYY-MM-DD，用來標示今天的格／列（日粒度是小時，沒有「今天」可標）。
  today: string;
  totals: ReportTotals;
  trend: TrendBucket[];
  // 熱門服務排行（TASK-091 的橫條／表格）；預約量為 0 時面板不渲染它，改顯示「沒有被預約的服務」。
  ranking: React.ReactNode;
};

export type ReportsPanelProps =
  // 切換期間時：工具列與篩選維持可操作，只有內容區換成骨架。
  | { status: "loading" }
  // 期間內（含全部設計師）沒有預約；filtered＝有勾選設計師、篩選後沒有。「全部已取消」算有資料，不走這裡。
  | { status: "empty"; filtered: boolean }
  // 不顯示部分數字。
  | { status: "error"; onRetry: () => void }
  // 期間內預約筆數超過上限：重試沒有意義，不提供重試；工具列仍可操作，改用較短的期間。
  | { status: "too_large" }
  | ReportsReadyProps;

export const RANKING_EMPTY_TEXT = "此期間沒有被預約的服務";

export const REPORTS_ERROR_TEXT = "無法載入報表，請稍後再試。";

export const REPORTS_TOO_LARGE_TITLE = `此期間的預約筆數超過上限（${REPORT_ROW_LIMIT.toLocaleString("en-US")} 筆）`;
export const REPORTS_TOO_LARGE_HINT = "請改用較短的期間（日或週）。";

// 數字顯示：筆數加「筆」、金額 NT$ 千分位。
export function formatCount(count: number): string {
  return `${count} 筆`;
}

export function formatMoney(amount: number): string {
  return formatPrice(amount);
}

// 營收主數字、「今天」標籤用的強調色：亮色 primary.dark（對白底 7:1），暗色的 primary.dark 太暗，改用 primary.main。
export function accentText(theme: Theme) {
  const palette = (theme.vars ?? theme).palette;
  return { color: palette.primary.dark, ...theme.applyStyles("dark", { color: palette.primary.main }) };
}

// 「今天」的淡底色：主色 12% 疊在 paper 上（theme 沒有 primary.50；與 TrendBarChart 斜紋底色同一組合）。
export function todayTint(theme: Theme): string {
  const palette = (theme.vars ?? theme).palette;
  return `color-mix(in srgb, ${palette.primary.main} 12%, ${palette.background.paper})`;
}

// 面板用 MUI Paper（圓角 radius.md、陰影 elevation1 皆來自 theme override），內距 24px。
export const panelSx = { p: 6 } as const;

// flush：標題自己在已有內距的容器裡（表格面板），不再留下方間距。
export function ReportsPanelHeading({ children, hint, flush }: { children: React.ReactNode; hint?: string; flush?: boolean }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 4, mb: flush ? 0 : 5 }}>
      <Box component="h3" sx={{ m: 0, fontSize: 16, fontWeight: 600, lineHeight: 1.3 }}>
        {children}
      </Box>
      {hint && (
        <Box component="span" sx={{ fontSize: 12, color: "text.secondary" }}>
          {hint}
        </Box>
      )}
    </Box>
  );
}

export function ReportsEmptyState({ filtered }: { filtered: boolean }) {
  return (
    <Alert severity="info">
      <AlertTitle>{filtered ? "所選設計師在此期間沒有預約" : "此期間沒有預約"}</AlertTitle>
      {filtered ? "換一個期間，或清除設計師篩選看看。" : "換一個期間看看。"}
    </Alert>
  );
}

export function ReportsErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <Alert
      severity="error"
      action={
        <Button color="inherit" size="small" onClick={onRetry}>
          重試
        </Button>
      }
    >
      {REPORTS_ERROR_TEXT}
    </Alert>
  );
}

// 超量：不是暫時性錯誤，所以用 warning、沒有重試按鈕，文案告訴店長出路。
export function ReportsTooLargeState() {
  return (
    <Alert severity="warning">
      <AlertTitle>{REPORTS_TOO_LARGE_TITLE}</AlertTitle>
      {REPORTS_TOO_LARGE_HINT}
    </Alert>
  );
}

// 骨架：每個方塊的高度對應實際內容區塊，切換前後版面不跳動。
export function ReportsSkeleton({ heights }: { heights: number[] }) {
  return (
    <Stack spacing={4} role="status" aria-busy="true" aria-label="載入中">
      {heights.map((height, index) => (
        // borderRadius 1.5 ＝ 12px（radius.md），與 Paper 面板一致。
        <Skeleton key={index} variant="rounded" height={height} sx={{ borderRadius: 1.5 }} />
      ))}
    </Stack>
  );
}
