import type { AvailableSlot, DesignerSelection } from "./types";

// BookingFlow 的重置規則與區塊顯示規則抽成純函式，才能單元測試；元件本身仍用原本的 useState，
// 這裡只回傳「要改成什麼」，不碰 React。

export const ANY_DESIGNER: DesignerSelection = { kind: "any" };

export function designerIdOf(selection: DesignerSelection): string | null {
  return selection.kind === "designer" ? selection.designer.id : null;
}

export function isSameSelection(a: DesignerSelection, b: DesignerSelection): boolean {
  return designerIdOf(a) === designerIdOf(b);
}

export type ServiceChangeReset = {
  designerSelection: DesignerSelection;
  selectedSlot: null;
  editingDesigner: false;
  editingSlot: false;
};

// 換服務（id 不同）→ 設計師回到「不指定」、清掉時段；選回同一個服務不重置（回傳 null）。
export function resetForServiceChange(currentServiceId: string | null, nextServiceId: string): ServiceChangeReset | null {
  if (currentServiceId === nextServiceId) return null;
  return { designerSelection: ANY_DESIGNER, selectedSlot: null, editingDesigner: false, editingSlot: false };
}

export type DesignerChangeReset = { selectedSlot: null; editingSlot: false };

// 換設計師（id 不同）→ 清掉時段；選回同一位不重置（回傳 null），呼叫端只需要收合設計師步驟。
export function resetForDesignerChange(
  current: DesignerSelection,
  next: DesignerSelection,
): DesignerChangeReset | null {
  if (isSameSelection(current, next)) return null;
  return { selectedSlot: null, editingSlot: false };
}

export type SectionVisibilityInput = {
  hasService: boolean;
  editingService: boolean;
  editingDesigner: boolean;
  editingSlot: boolean;
  selectedSlot: AvailableSlot | null;
  designersStatus: "loading" | "loaded" | "error";
  designerCount: number;
};

export type SectionVisibility = {
  designerStep: boolean;
  designerCollapsed: boolean;
  slotStep: boolean;
  contactForm: boolean;
};

// 修改服務時下游區塊全部隱藏（沿用既有行為）；時段步驟要等設計師名單載入成功且不是空的才出現，
// 名單失敗或為空時只顯示設計師步驟的 Alert，顧客可以從服務摘要列的「修改」回頭換服務。
export function getSectionVisibility(input: SectionVisibilityInput): SectionVisibility {
  const designerStep = input.hasService && !input.editingService;
  const designersReady = input.designersStatus === "loaded" && input.designerCount > 0;
  const slotStep = designerStep && designersReady;
  return {
    designerStep,
    designerCollapsed: slotStep && input.selectedSlot !== null && !input.editingDesigner,
    slotStep,
    contactForm: slotStep && input.selectedSlot !== null && !input.editingDesigner && !input.editingSlot,
  };
}
