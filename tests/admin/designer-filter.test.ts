import { describe, expect, it } from "vitest";
import type { WeekAppointment } from "@/lib/admin/appointments";
import type { DesignerFilterOption } from "@/lib/admin/designers";
import {
  buildDesignerChips,
  buildLeaveLabels,
  countActiveAppointments,
  filterAppointments,
  formatFilteredEmptyTitle,
  resolveEffectiveSelection,
  shouldShowDesignerRow,
  toggleDesigner,
} from "@/lib/admin/designer-filter";

const LIN = "00000000-0000-4000-8000-000000000001";
const CHEN = "00000000-0000-4000-8000-000000000002";
const WANG = "00000000-0000-4000-8000-000000000003";

function option(id: string, name: string, sortOrder: number, isActive = true): DesignerFilterOption {
  return { id, name, avatar_url: null, is_active: isActive, sort_order: sortOrder };
}

function appointment(id: string, designerId: string, status: WeekAppointment["status"] = "confirmed"): WeekAppointment {
  return {
    id,
    customer_name: "顧客",
    start_at: "2026-10-21T03:00:00+00:00",
    end_at: "2026-10-21T04:00:00+00:00",
    status,
    service_name: "剪髮",
    duration_minutes: 60,
    buffer_minutes: 0,
    designer_id: designerId,
    designer: { id: designerId, name: "x", avatar_url: null },
  };
}

const OPTIONS = [option(LIN, "林小美", 0), option(CHEN, "陳阿傑", 1), option(WANG, "王大明", 2)];

describe("buildDesignerChips", () => {
  it("啟用中的設計師一律出現（即使本週沒有預約），計數排除已取消", () => {
    const chips = buildDesignerChips(OPTIONS, [
      appointment("a1", LIN),
      appointment("a2", LIN, "completed"),
      appointment("a3", LIN, "cancelled"),
      appointment("a4", CHEN),
    ]);
    expect(chips.map((chip) => [chip.id, chip.count])).toEqual([
      [LIN, 2],
      [CHEN, 1],
      [WANG, 0],
    ]);
  });

  it("停用中的設計師只在本週有預約時出現，並標示 isActive=false", () => {
    const options = [option(LIN, "林小美", 0), option(CHEN, "陳阿傑", 1, false)];
    expect(buildDesignerChips(options, [appointment("a1", LIN)]).map((chip) => chip.id)).toEqual([LIN]);

    const chips = buildDesignerChips(options, [appointment("a1", CHEN)]);
    expect(chips.map((chip) => [chip.id, chip.isActive, chip.count])).toEqual([
      [LIN, true, 0],
      [CHEN, false, 1],
    ]);
  });

  it("停用中設計師本週只剩已取消的預約：仍出現（才篩得出那些預約），計數為 0", () => {
    const chips = buildDesignerChips([option(CHEN, "陳阿傑", 1, false)], [appointment("a1", CHEN, "cancelled")]);
    expect(chips).toHaveLength(1);
    expect(chips[0].count).toBe(0);
  });

  it("停用與啟用的設計師混排，依 sort_order；相同時保留查詢順序", () => {
    const options = [option(WANG, "王大明", 5), option(CHEN, "陳阿傑", 1, false), option(LIN, "林小美", 1)];
    const chips = buildDesignerChips(options, [appointment("a1", CHEN)]);
    expect(chips.map((chip) => chip.id)).toEqual([CHEN, LIN, WANG]);
  });

  it("不改動傳入的陣列", () => {
    const options = [option(WANG, "王大明", 2), option(LIN, "林小美", 0)];
    buildDesignerChips(options, []);
    expect(options.map((o) => o.id)).toEqual([WANG, LIN]);
  });
});

describe("countActiveAppointments", () => {
  it("排除已取消", () => {
    expect(
      countActiveAppointments([appointment("a1", LIN), appointment("a2", LIN, "cancelled"), appointment("a3", CHEN, "pending")]),
    ).toBe(2);
  });
});

describe("toggleDesigner", () => {
  it("勾選一位、再勾選另一位（可複選）", () => {
    expect(toggleDesigner([], LIN)).toEqual([LIN]);
    expect(toggleDesigner([LIN], CHEN)).toEqual([LIN, CHEN]);
  });

  it("再點一次取消勾選", () => {
    expect(toggleDesigner([LIN, CHEN], LIN)).toEqual([CHEN]);
  });

  it("取消最後一個勾選時回到空陣列（＝全部），不會出現什麼都不顯示的狀態", () => {
    expect(toggleDesigner([LIN], LIN)).toEqual([]);
  });

  it("不改動傳入的陣列", () => {
    const selected = [LIN];
    toggleDesigner(selected, CHEN);
    expect(selected).toEqual([LIN]);
  });
});

describe("resolveEffectiveSelection", () => {
  const chips = [{ id: LIN }, { id: CHEN }, { id: WANG }];

  it("沒有勾選＝全部（空陣列）", () => {
    expect(resolveEffectiveSelection([], chips)).toEqual([]);
  });

  it("依 chip 列順序回傳，與勾選順序無關", () => {
    expect(resolveEffectiveSelection([WANG, LIN], chips)).toEqual([LIN, WANG]);
  });

  it("勾選的設計師已不在 chip 列（切週後停用設計師的 chip 消失）：只留下仍在的", () => {
    expect(resolveEffectiveSelection([LIN, "gone"], chips)).toEqual([LIN]);
  });

  it("勾選的全都不在 chip 列：交集為空，回到全部，不會顯示空白", () => {
    expect(resolveEffectiveSelection(["gone"], chips)).toEqual([]);
  });

  it("切週後殘留 id：以有效選取為基礎切換，順手清掉殘留的 id", () => {
    // 原本勾選 [陳（停用，本週有預約）]；切到沒有他預約的週次，chip 消失 → 有效選取為空（全部）。
    const chipsNextWeek = [{ id: LIN }, { id: WANG }];
    const effective = resolveEffectiveSelection([CHEN], chipsNextWeek);
    expect(effective).toEqual([]);
    // 這時點林小美：結果是只勾林，而不是 [陳, 林]。
    expect(toggleDesigner(effective, LIN)).toEqual([LIN]);
  });

  it("勾選全部設計師：維持使用者的勾選（不自動變成空），過濾結果與「全部」相同", () => {
    const effective = resolveEffectiveSelection([LIN, CHEN, WANG], chips);
    expect(effective).toEqual([LIN, CHEN, WANG]);
    const appointments = [appointment("a1", LIN), appointment("a2", CHEN), appointment("a3", WANG)];
    expect(filterAppointments(appointments, effective)).toEqual(appointments);
  });

  it("全部勾選後切到多一位停用設計師的週次：交集的結果，那位的預約被隱藏（維持使用者勾選）", () => {
    const selected = [LIN, CHEN, WANG];
    const chipsNextWeek = [{ id: LIN }, { id: CHEN }, { id: WANG }, { id: "stopped" }];
    const effective = resolveEffectiveSelection(selected, chipsNextWeek);
    expect(effective).toEqual([LIN, CHEN, WANG]);
    const appointments = [appointment("a1", LIN), appointment("a2", "stopped")];
    expect(filterAppointments(appointments, effective).map((a) => a.id)).toEqual(["a1"]);
  });
});

describe("filterAppointments", () => {
  const appointments = [appointment("a1", LIN), appointment("a2", CHEN), appointment("a3", WANG), appointment("a4", LIN)];

  it("空選取＝全部", () => {
    expect(filterAppointments(appointments, [])).toBe(appointments);
  });

  it("只勾一位", () => {
    expect(filterAppointments(appointments, [LIN]).map((a) => a.id)).toEqual(["a1", "a4"]);
  });

  it("勾兩位（多選）", () => {
    expect(filterAppointments(appointments, [LIN, WANG]).map((a) => a.id)).toEqual(["a1", "a3", "a4"]);
  });

  it("已取消的預約也照設計師過濾（週曆上仍會顯示，只是淡化）", () => {
    const withCancelled = [appointment("a1", LIN, "cancelled"), appointment("a2", CHEN)];
    expect(filterAppointments(withCancelled, [LIN]).map((a) => a.id)).toEqual(["a1"]);
  });
});

describe("shouldShowDesignerRow", () => {
  it("全部（0 位）顯示、兩位以上顯示、只勾一位隱藏", () => {
    expect(shouldShowDesignerRow([])).toBe(true);
    expect(shouldShowDesignerRow([LIN])).toBe(false);
    expect(shouldShowDesignerRow([LIN, CHEN])).toBe(true);
    expect(shouldShowDesignerRow([LIN, CHEN, WANG])).toBe(true);
  });
});

describe("buildLeaveLabels", () => {
  const chips = [
    { id: LIN, name: "林小美" },
    { id: CHEN, name: "陳阿傑" },
    { id: WANG, name: "王大明" },
  ];
  const leaves = [
    { designer_id: LIN, date: "2026-10-23" },
    { designer_id: CHEN, date: "2026-10-23" },
    { designer_id: WANG, date: "2026-10-24" },
  ];

  it("「全部」狀態不標示任何請假", () => {
    expect(buildLeaveLabels(leaves, [], chips).size).toBe(0);
  });

  it("只勾一位：只標示那位的請假日", () => {
    const labels = buildLeaveLabels(leaves, [LIN], chips);
    expect([...labels.entries()]).toEqual([["2026-10-23", ["林小美"]]]);
  });

  it("勾多位：每位勾選設計師的請假日都標示；同一天多位請假依 chip 順序", () => {
    const labels = buildLeaveLabels(leaves, [LIN, CHEN], chips);
    expect(labels.get("2026-10-23")).toEqual(["林小美", "陳阿傑"]);
    expect(labels.has("2026-10-24")).toBe(false);
  });

  it("勾選全部設計師：仍依勾選標示（維持使用者的勾選狀態）", () => {
    const labels = buildLeaveLabels(leaves, [LIN, CHEN, WANG], chips);
    expect(labels.get("2026-10-24")).toEqual(["王大明"]);
  });

  it("沒有請假日、或名稱查不到時不標示", () => {
    expect(buildLeaveLabels([], [LIN], chips).size).toBe(0);
    expect(buildLeaveLabels(leaves, [LIN], []).size).toBe(0);
  });
});

describe("formatFilteredEmptyTitle", () => {
  const chips = [
    { id: LIN, name: "林小美" },
    { id: WANG, name: "王大明" },
  ];

  it("單一設計師：「○○本週沒有預約」", () => {
    expect(formatFilteredEmptyTitle([WANG], chips)).toBe("王大明本週沒有預約");
  });

  it("多位：名字依有效選取順序以「、」串接", () => {
    expect(formatFilteredEmptyTitle([LIN, WANG], chips)).toBe("林小美、王大明本週沒有預約");
  });
});

// TASK-088：參數型別放寬為 Pick<WeekAppointment, "designer_id" | "status">，行為不變。
describe("只有設計師與狀態的最小資料（報表轉接）", () => {
  const minimal = [
    { designer_id: LIN, status: "confirmed" as const },
    { designer_id: LIN, status: "cancelled" as const },
    { designer_id: CHEN, status: "completed" as const },
  ];

  it("buildDesignerChips：計數規則與完整預約相同（排除已取消）", () => {
    expect(buildDesignerChips(OPTIONS, minimal).map((chip) => [chip.id, chip.count])).toEqual([
      [LIN, 1],
      [CHEN, 1],
      [WANG, 0],
    ]);
  });

  it("countActiveAppointments：排除已取消", () => {
    expect(countActiveAppointments(minimal)).toBe(2);
  });
});
