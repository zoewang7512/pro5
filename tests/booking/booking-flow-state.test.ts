import { describe, expect, it } from "vitest";
import {
  ANY_DESIGNER,
  designerIdOf,
  getSectionVisibility,
  isSameSelection,
  resetForDesignerChange,
  resetForServiceChange,
  type SectionVisibilityInput,
} from "@/lib/booking/booking-flow-state";
import type { DesignerSelection, PublicDesigner } from "@/lib/booking/types";

function designer(id: string): PublicDesigner {
  return {
    id,
    name: `設計師${id}`,
    bio: null,
    specialties: [],
    instagram_handle: null,
    avatar_url: null,
    sort_order: 0,
    portfolio: [],
  };
}

const mei: DesignerSelection = { kind: "designer", designer: designer("a") };
const jie: DesignerSelection = { kind: "designer", designer: designer("b") };

describe("designerIdOf／isSameSelection", () => {
  it("不指定是 null，指定是設計師 id；同 id 視為同一個選擇（即使物件不同）", () => {
    expect(designerIdOf(ANY_DESIGNER)).toBeNull();
    expect(designerIdOf(mei)).toBe("a");
    expect(isSameSelection(ANY_DESIGNER, { kind: "any" })).toBe(true);
    expect(isSameSelection(mei, { kind: "designer", designer: designer("a") })).toBe(true);
    expect(isSameSelection(mei, jie)).toBe(false);
    expect(isSameSelection(mei, ANY_DESIGNER)).toBe(false);
  });
});

describe("resetForServiceChange", () => {
  it("換服務：設計師回到不指定、清時段、結束編輯狀態", () => {
    expect(resetForServiceChange("s1", "s2")).toEqual({
      designerSelection: ANY_DESIGNER,
      selectedSlot: null,
      editingDesigner: false,
      editingSlot: false,
    });
  });

  it("第一次選服務（目前沒有服務）也視為換服務，回到預設", () => {
    expect(resetForServiceChange(null, "s1")).not.toBeNull();
  });

  it("選回同一個服務不重置（回傳 null）", () => {
    expect(resetForServiceChange("s1", "s1")).toBeNull();
  });
});

describe("resetForDesignerChange", () => {
  it("換設計師（含不指定 ↔ 指定）：清時段", () => {
    expect(resetForDesignerChange(ANY_DESIGNER, mei)).toEqual({ selectedSlot: null, editingSlot: false });
    expect(resetForDesignerChange(mei, jie)).toEqual({ selectedSlot: null, editingSlot: false });
    expect(resetForDesignerChange(mei, ANY_DESIGNER)).toEqual({ selectedSlot: null, editingSlot: false });
  });

  it("選回同一位（或再按一次不指定）不清時段（回傳 null）", () => {
    expect(resetForDesignerChange(mei, mei)).toBeNull();
    expect(resetForDesignerChange(ANY_DESIGNER, ANY_DESIGNER)).toBeNull();
  });
});

describe("getSectionVisibility", () => {
  const slot = { start_at: "2026-10-23T02:00:00Z", end_at: "2026-10-23T03:00:00Z" };
  const base: SectionVisibilityInput = {
    hasService: true,
    editingService: false,
    editingDesigner: false,
    editingSlot: false,
    selectedSlot: null,
    designersStatus: "loaded",
    designerCount: 2,
  };

  it("還沒選服務：全部不顯示", () => {
    expect(getSectionVisibility({ ...base, hasService: false })).toEqual({
      designerStep: false,
      designerCollapsed: false,
      slotStep: false,
      contactForm: false,
    });
  });

  it("選好服務、名單載入成功：設計師步驟（展開）與時段步驟都顯示，聯絡表單還沒有", () => {
    expect(getSectionVisibility(base)).toEqual({
      designerStep: true,
      designerCollapsed: false,
      slotStep: true,
      contactForm: false,
    });
  });

  it("名單載入中、失敗、為空：只顯示設計師步驟（由它顯示骨架或 Alert），不顯示時段", () => {
    for (const patch of [
      { designersStatus: "loading" as const },
      { designersStatus: "error" as const },
      { designerCount: 0 },
    ]) {
      const v = getSectionVisibility({ ...base, ...patch });
      expect(v.designerStep).toBe(true);
      expect(v.slotStep).toBe(false);
      expect(v.contactForm).toBe(false);
    }
  });

  it("已選時段：設計師步驟收合、聯絡表單顯示", () => {
    expect(getSectionVisibility({ ...base, selectedSlot: slot })).toEqual({
      designerStep: true,
      designerCollapsed: true,
      slotStep: true,
      contactForm: true,
    });
  });

  it("已選時段後按設計師的「修改」：設計師步驟展開、時段維持顯示、聯絡表單隱藏", () => {
    expect(getSectionVisibility({ ...base, selectedSlot: slot, editingDesigner: true })).toEqual({
      designerStep: true,
      designerCollapsed: false,
      slotStep: true,
      contactForm: false,
    });
  });

  it("已選時段後按時段的「修改」：聯絡表單隱藏，設計師步驟維持收合", () => {
    const v = getSectionVisibility({ ...base, selectedSlot: slot, editingSlot: true });
    expect(v.designerCollapsed).toBe(true);
    expect(v.contactForm).toBe(false);
  });

  it("修改服務時下游區塊全部隱藏（沿用既有行為）", () => {
    expect(getSectionVisibility({ ...base, selectedSlot: slot, editingService: true })).toEqual({
      designerStep: false,
      designerCollapsed: false,
      slotStep: false,
      contactForm: false,
    });
  });
});
