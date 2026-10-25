"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { createClient } from "@/lib/supabase/client";
import { getDesignerFilterOptions, type DesignerFilterOption } from "@/lib/admin/designers";
import {
  buildDesignerChips,
  countActiveAppointments,
  resolveEffectiveSelection,
  toggleDesigner,
} from "@/lib/admin/designer-filter";
import {
  buildTrend,
  fetchReportAppointments,
  filterByDesigners,
  getReportPeriod,
  shiftReportPeriod,
  summarize,
  toReportAppointmentLike,
  type ReportAppointment,
  type ReportGranularity,
} from "@/lib/admin/reports";
import { buildServiceRanking } from "@/lib/admin/reports-ranking";
import { getTaipeiToday } from "@/lib/admin/week-range";
import { DesignerFilterChips } from "./DesignerFilterChips";
import { ReportsDashboardPanel } from "./ReportsDashboardPanel";
import type { ReportsPanelProps } from "./ReportsStates";
import { ReportsTablePanel } from "./ReportsTablePanel";
import { ReportsTabs, type ReportsTabValue } from "./ReportsTabs";
import { ReportsToolbar } from "./ReportsToolbar";
import { ServiceRankingBars } from "./ServiceRankingBars";
import { ServiceRankingTable } from "./ServiceRankingTable";

// 儀表板與報表（/admin/reports）的容器：持有頁籤、粒度、錨點日、設計師勾選，抓一份期間資料，
// 兩個頁籤（日後的匯出也是）吃同一份計算結果，數字天然一致。
// 只有「期間」改變才重新查詢；切頁籤、切設計師只對同一份資料重算（與預約週曆一致）。
// 查詢結果存 {key, status, appointments}，render 時比較目前期間與最後完成的 key 推導載入中
// （寫法比照 AdminDashboard，避免違反 react-hooks/set-state-in-effect）。
// 競態：每次 effect 重跑都會作廢前一次的回應（等同遞增請求序號），較慢的舊請求回來時丟棄。

type FetchResult = { key: string; status: "loaded" | "error"; appointments: ReportAppointment[] };

export function ReportsView() {
  const supabase = React.useMemo(() => createClient(), []);
  const today = React.useMemo(() => getTaipeiToday(), []);

  const [tab, setTab] = React.useState<ReportsTabValue>("dashboard");
  const [granularity, setGranularity] = React.useState<ReportGranularity>("month");
  const [anchor, setAnchor] = React.useState(today);
  // 設計師勾選只存在記憶體（切期間、切頁籤保留，重新整理重設為「全部」），空陣列＝全部。
  // 這裡存的是原始勾選，使用前一律經 resolveEffectiveSelection 與目前 chip 列取交集。
  const [selectedDesignerIds, setSelectedDesignerIds] = React.useState<string[]>([]);
  const [designerOptions, setDesignerOptions] = React.useState<DesignerFilterOption[] | null>(null);

  const [result, setResult] = React.useState<FetchResult | null>(null);
  // 最後一次成功載入的資料，只給設計師 chip 列用：切換期間時 chip 維持可操作，不必換成骨架。
  const [lastLoaded, setLastLoaded] = React.useState<ReportAppointment[] | null>(null);
  const [refetchToken, setRefetchToken] = React.useState(0);

  const period = React.useMemo(() => getReportPeriod(granularity, anchor, today), [granularity, anchor, today]);
  const key = `${period.from}~${period.to}`;

  React.useEffect(() => {
    let cancelled = false;

    fetchReportAppointments(supabase, { from: period.from, to: period.to }).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setResult({ key, status: "loaded", appointments: res.data });
        setLastLoaded(res.data);
      } else {
        setResult({ key, status: "error", appointments: [] });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [supabase, period.from, period.to, key, refetchToken]);

  // 設計師清單掛載時查一次（比照 AdminDashboard）。失敗時視為沒有 chip 列（等同「全部」），不阻擋報表。
  React.useEffect(() => {
    let cancelled = false;

    getDesignerFilterOptions(supabase).then((res) => {
      if (cancelled) return;
      setDesignerOptions(res.ok ? res.data : []);
    });

    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const matchesRequest = result?.key === key;
  const status: "loading" | "loaded" | "error" = matchesRequest ? result!.status : "loading";
  const appointments = React.useMemo(() => (matchesRequest ? result!.appointments : []), [matchesRequest, result]);

  // chip 的數字＝期間內預約量（不含已取消）。載入中暫時沿用上一份已載入的資料（讓 chip 維持可操作，第一次載入
  // 才顯示骨架）；錯誤時隱藏 chip 列，不拿別的期間的數字冒充這個期間（勾選保留，重試成功後回來）。
  const chipSource = status === "loaded" ? appointments : status === "loading" ? lastLoaded : null;
  const chipAppointments = React.useMemo(() => (chipSource ?? []).map(toReportAppointmentLike), [chipSource]);
  const designerChips = React.useMemo(
    () => (designerOptions && chipSource ? buildDesignerChips(designerOptions, chipAppointments) : []),
    [designerOptions, chipSource, chipAppointments],
  );
  const effectiveDesignerIds = React.useMemo(
    () => resolveEffectiveSelection(selectedDesignerIds, designerChips),
    [selectedDesignerIds, designerChips],
  );

  const visible = React.useMemo(
    () => filterByDesigners(appointments, effectiveDesignerIds),
    [appointments, effectiveDesignerIds],
  );
  const totals = React.useMemo(() => summarize(visible), [visible]);
  const trend = React.useMemo(() => buildTrend(period, visible), [period, visible]);
  const ranking = React.useMemo(() => buildServiceRanking(visible), [visible]);

  // 切粒度：本期（含今天）以今天為錨，其他期間以該期間的起始日為錨。
  function handleGranularityChange(next: ReportGranularity) {
    if (next === granularity) return;
    setAnchor(period.isCurrent ? today : period.from);
    setGranularity(next);
  }

  function handleShift(delta: 1 | -1) {
    setAnchor(shiftReportPeriod(period, delta, today).from);
  }

  function handleRetry() {
    setResult(null);
    setRefetchToken((token) => token + 1);
  }

  let panelProps: ReportsPanelProps;
  if (status === "loading") {
    panelProps = { status: "loading" };
  } else if (status === "error") {
    panelProps = { status: "error", onRetry: handleRetry };
  } else if (appointments.length === 0) {
    panelProps = { status: "empty", filtered: false };
  } else if (visible.length === 0) {
    // 有勾選設計師、篩選後沒有；「全部已取消」仍有資料，不會走到這裡。
    panelProps = { status: "empty", filtered: true };
  } else {
    panelProps = {
      status: "ready",
      period,
      today,
      totals,
      trend,
      ranking: tab === "dashboard" ? <ServiceRankingBars rows={ranking} /> : <ServiceRankingTable rows={ranking} />,
    };
  }

  return (
    <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", p: 3 }}>
      <Typography variant="h6" component="h2" sx={{ mb: 2 }}>
        儀表板與報表
      </Typography>

      <ReportsTabs
        value={tab}
        onChange={setTab}
        controls={
          <Box sx={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <ReportsToolbar
              period={period}
              onGranularityChange={handleGranularityChange}
              onPrevious={() => handleShift(-1)}
              onNext={() => handleShift(1)}
              onToday={() => setAnchor(today)}
            />
            <DesignerFilterChips
              loading={designerOptions === null || (chipSource === null && status === "loading")}
              chips={designerChips}
              selectedIds={effectiveDesignerIds}
              totalCount={countActiveAppointments(chipAppointments)}
              // 以有效選取為基礎切換，順手清掉殘留的（已不在 chip 列的）id。
              onToggle={(designerId) => setSelectedDesignerIds(toggleDesigner(effectiveDesignerIds, designerId))}
              onClear={() => setSelectedDesignerIds([])}
            />
          </Box>
        }
      >
        {tab === "dashboard" ? <ReportsDashboardPanel {...panelProps} /> : <ReportsTablePanel {...panelProps} />}
      </ReportsTabs>
    </Box>
  );
}
