import type { AppointmentDesigner, WeekAppointment } from "./appointments";
import type { DesignerFilterOption, DesignerLeaveEntry } from "./designers";

// 預約週曆／列表的設計師多選篩選規則（純函式，畫面層只負責呼叫與渲染）。選取狀態用 string[]：
// 空陣列＝「全部」，所以「什麼都不顯示」的狀態不可能出現。篩選只在前端過濾，不重新查詢。
//
// 一律先把使用者的勾選轉成「有效選取」（resolveEffectiveSelection）再使用：停用中設計師的 chip 只在本週有預約
// 時才出現，切週後 chip 消失，殘留的 id 不能讓畫面變成空白，也不能影響「全部」亮起與「清除篩選」顯示。

export type DesignerChip = {
  id: string;
  name: string;
  avatarUrl: string | null;
  isActive: boolean;
  // 本週預約數，排除已取消。
  count: number;
};

export function countActiveAppointments(appointments: WeekAppointment[]): number {
  return appointments.filter((appointment) => appointment.status !== "cancelled").length;
}

// 啟用中的設計師一律出現；停用中的設計師只在本週有預約（含已取消，週曆上仍看得到它們）時出現，否則那些預約
// 就無法被篩選出來。順序依 sort_order（相同時保留查詢順序，Array.prototype.sort 為穩定排序），啟用與停用混排。
export function buildDesignerChips(options: DesignerFilterOption[], appointments: WeekAppointment[]): DesignerChip[] {
  const total = new Map<string, number>();
  const active = new Map<string, number>();
  for (const appointment of appointments) {
    total.set(appointment.designer_id, (total.get(appointment.designer_id) ?? 0) + 1);
    if (appointment.status !== "cancelled") {
      active.set(appointment.designer_id, (active.get(appointment.designer_id) ?? 0) + 1);
    }
  }

  return [...options]
    .sort((a, b) => a.sort_order - b.sort_order)
    .filter((option) => option.is_active || (total.get(option.id) ?? 0) > 0)
    .map((option) => ({
      id: option.id,
      name: option.name,
      avatarUrl: option.avatar_url,
      isActive: option.is_active,
      count: active.get(option.id) ?? 0,
    }));
}

// 使用者勾選與目前 chip 列的交集（依 chip 列順序）。交集為空＝「全部」。
export function resolveEffectiveSelection(selected: string[], chips: Pick<DesignerChip, "id">[]): string[] {
  const picked = new Set(selected);
  return chips.filter((chip) => picked.has(chip.id)).map((chip) => chip.id);
}

// 切換一位設計師的勾選。呼叫端要傳「有效選取」而不是原始勾選，任何一次互動都順手清掉殘留的 id。
// 取消最後一個勾選時回傳空陣列＝回到「全部」。
export function toggleDesigner(effective: string[], id: string): string[] {
  return effective.includes(id) ? effective.filter((selectedId) => selectedId !== id) : [...effective, id];
}

export function filterAppointments(appointments: WeekAppointment[], effective: string[]): WeekAppointment[] {
  if (effective.length === 0) return appointments;
  const picked = new Set(effective);
  return appointments.filter((appointment) => picked.has(appointment.designer_id));
}

// 只勾選一位時，事件卡的設計師列是多餘的資訊而隱藏；全部（0 位）或 2 位以上保留。
export function shouldShowDesignerRow(effective: string[]): boolean {
  return effective.length !== 1;
}

// 日期 → 該日請假的、且被勾選的設計師名稱。只對「明確勾選」的設計師標示，「全部」不標示（否則每格都是請假字樣）。
// 名稱依有效選取的順序（即 chip 列順序）。
export function buildLeaveLabels(
  leaves: DesignerLeaveEntry[],
  effective: string[],
  chips: Pick<DesignerChip, "id" | "name">[],
): Map<string, string[]> {
  const labels = new Map<string, string[]>();
  if (effective.length === 0) return labels;

  const nameById = new Map(chips.map((chip) => [chip.id, chip.name]));
  for (const designerId of effective) {
    const name = nameById.get(designerId);
    if (name === undefined) continue;
    for (const leave of leaves) {
      if (leave.designer_id !== designerId) continue;
      labels.set(leave.date, [...(labels.get(leave.date) ?? []), name]);
    }
  }
  return labels;
}

// 篩選後該週沒有預約的空狀態標題，例如「王大明本週沒有預約」、多位時「林小美、陳阿傑本週沒有預約」。
export function formatFilteredEmptyTitle(effective: string[], chips: Pick<DesignerChip, "id" | "name">[]): string {
  const nameById = new Map(chips.map((chip) => [chip.id, chip.name]));
  const names = effective.map((id) => nameById.get(id)).filter((name): name is string => name !== undefined);
  return `${names.join("、")}本週沒有預約`;
}

// 事件卡、列表、詳情共用：embed 缺漏時顯示的名稱。
export function designerDisplayName(designer: AppointmentDesigner | null): string {
  return designer?.name ?? "—";
}
