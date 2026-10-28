// 報表畫面元件測試共用的資料：用真正的 lib/admin/reports.ts（getReportPeriod／buildTrend／summarize）算出
// 面板收到的 period／totals／trend，確保測試的形狀就是正式串接時的形狀。今天固定為 2026-10-24（週六）。
import type { ReactNode } from "react";
import {
  buildTrend,
  getReportPeriod,
  summarize,
  type ReportAppointment,
  type ReportGranularity,
} from "@/lib/admin/reports";
import { toTaipeiDate } from "@/lib/admin/format";

export const REPORT_TODAY = "2026-10-24";

let seq = 0;
export function reportAppointment(startAt: string, status: ReportAppointment["status"], price: number): ReportAppointment {
  seq += 1;
  return {
    id: `r${seq}`,
    startAt,
    status,
    price,
    serviceId: "svc-1",
    serviceName: "剪髮",
    serviceIsActive: true,
    designerId: "des-1",
  };
}

// 月（2026 年 10 月）：完成 5、待完成 3、已取消 1；營收 10,100、預估 4,400。
export function sampleAppointments(): ReportAppointment[] {
  return [
    reportAppointment("2026-10-01T10:00:00+08:00", "completed", 3000),
    reportAppointment("2026-10-05T10:00:00+08:00", "completed", 1200),
    reportAppointment("2026-10-05T14:00:00+08:00", "completed", 1200),
    reportAppointment("2026-10-12T16:00:00+08:00", "cancelled", 800),
    reportAppointment("2026-10-23T10:00:00+08:00", "completed", 3200),
    reportAppointment("2026-10-24T11:00:00+08:00", "completed", 1500),
    reportAppointment("2026-10-24T14:30:00+08:00", "pending", 2000),
    reportAppointment("2026-10-25T15:00:00+08:00", "confirmed", 1200),
    reportAppointment("2026-10-28T15:00:00+08:00", "pending", 1200),
  ];
}

export function readyProps(
  granularity: ReportGranularity = "month",
  appointments: ReportAppointment[] = sampleAppointments(),
  ranking: ReactNode = null,
) {
  const period = getReportPeriod(granularity, REPORT_TODAY, REPORT_TODAY);
  const inPeriod = appointments.filter((a) => {
    const date = toTaipeiDate(a.startAt);
    return date >= period.from && date <= period.to;
  });
  return {
    status: "ready" as const,
    period,
    today: REPORT_TODAY,
    totals: summarize(inPeriod),
    trend: buildTrend(period, appointments),
    ranking,
  };
}
