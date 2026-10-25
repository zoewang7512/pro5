import { summarize, type ReportAppointment } from "./reports";

// 熱門服務排行（純函式）。儀表板的橫條與報表的表格共用同一份結果。
// 預約量與營收的口徑不在這裡重新定義：每個服務的 count／revenue 直接取 summarize 的 booked／revenue。

export type RankingRow = {
  serviceId: string;
  name: string;
  // 服務目前仍上架；false 時畫面標示「已下架」。
  isActive: boolean;
  // 預約量（pending＋confirmed＋completed，不含已取消）。
  count: number;
  // 已完成預約的價格快照加總。
  revenue: number;
};

// 排序：預約量降序 → 營收降序 → 名稱（zh-Hant）→ serviceId（最後保底，同名也有固定順序）。
function compareRows(a: RankingRow, b: RankingRow): number {
  return (
    b.count - a.count ||
    b.revenue - a.revenue ||
    a.name.localeCompare(b.name, "zh-Hant") ||
    (a.serviceId < b.serviceId ? -1 : a.serviceId > b.serviceId ? 1 : 0)
  );
}

// 排除已取消 → 依 serviceId 分組 → 排序。預約量為 0 的服務不列、不設上限。
// 輸入應已依期間與設計師篩選過（由容器負責）。
export function buildServiceRanking(appointments: ReportAppointment[]): RankingRow[] {
  const groups = new Map<string, ReportAppointment[]>();
  for (const appointment of appointments) {
    if (appointment.status === "cancelled") continue;
    const group = groups.get(appointment.serviceId);
    if (group) group.push(appointment);
    else groups.set(appointment.serviceId, [appointment]);
  }

  const rows: RankingRow[] = [];
  for (const [serviceId, group] of groups) {
    const totals = summarize(group);
    if (totals.booked === 0) continue;
    rows.push({
      serviceId,
      name: group[0].serviceName,
      isActive: group[0].serviceIsActive,
      count: totals.booked,
      revenue: totals.revenue,
    });
  }
  return rows.sort(compareRows);
}

// 占比＝該服務預約量 ÷ 排行內預約量總和，四捨五入到整數百分比（各列加總不一定剛好 100%）。
export function rankingShare(count: number, rows: RankingRow[]): number {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return total === 0 ? 0 : Math.round((count / total) * 100);
}

// 橫條長度（0–100）＝count ÷ 排行內最大預約量；最小可見寬度避免 1 對 1000 的條幾乎看不到。
export const MIN_BAR_PERCENT = 2;

export function rankingBarPercent(count: number, rows: RankingRow[]): number {
  const max = rows.reduce((peak, row) => Math.max(peak, row.count), 0);
  if (max === 0 || count <= 0) return 0;
  return Math.max((count / max) * 100, MIN_BAR_PERCENT);
}
